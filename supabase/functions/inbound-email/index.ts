// supabase:verify_jwt=false
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { sanitizeEmail, generateSanitizationReport, sanitizeSubject } from "./email-sanitizer.ts";
import {
  checkRateLimit,
  detectSpamSpike,
  generateRateLimitResponse,
  handleRateLimitViolation,
  handleSpamSpike,
} from "./rate-limiter.ts";
import { validateEmailPayload, createValidationErrorResponse } from "../shared/input-validation.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface InboundEmailPayload {
  recipient: string;
  sender: string;
  from: string;
  subject: string;
  bodyPlain?: string;
  bodyHtml?: string;
  strippedText?: string;
  strippedSignature?: string;
  messageHeaders?: string;
  contentIdMap?: string;
  timestamp?: number;
}

interface BurnerEmailRecord {
  id: string;
  email_address: string;
  real_email: string;
  is_active: boolean;
  expires_at: string | null;
}

async function fetchResendEmailContent(
  emailId: string,
  resendApiKey: string
): Promise<{ html?: string; text?: string }> {
  const tryFetch = async (path: string) => {
    const resp = await fetch(`https://api.resend.com/${path}/${emailId}`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
    });

    const bodyText = await resp.text();
    if (!resp.ok) {
      throw new Error(`${path} ${resp.status} - ${bodyText}`);
    }

    let json: any;
    try {
      json = JSON.parse(bodyText);
    } catch {
      throw new Error(`${path} returned non-JSON response`);
    }

    const data = json?.data ?? json;
    return {
      html: typeof data?.html === "string" ? data.html : undefined,
      text: typeof data?.text === "string" ? data.text : undefined,
    };
  };

  // Resend receiving API endpoint: /emails/receiving/{id}
  console.log("Fetching full email content from Resend receiving API", { email_id: emailId });
  return await tryFetch("emails/receiving");
}

async function parseEmailPayload(
  req: Request,
  emailProvider: string,
  emailApiKey: string
): Promise<InboundEmailPayload> {
  const contentType = req.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const jsonPayload = await req.json();

    if (jsonPayload.type === "email.received" && jsonPayload.data) {
      const data = jsonPayload.data;
      const recipient = Array.isArray(data.to) && data.to.length > 0
        ? data.to[0]
        : (data.to || "");

      let bodyPlain = data.text || data.bodyPlain || "";
      let bodyHtml = data.html || data.bodyHtml || "";

      // Resend's `email.received` webhook commonly omits the email body and only includes an `email_id`.
      // In that case, fetch the full email content from Resend before sanitizing/forwarding.
      if (
        emailProvider === "resend" &&
        typeof data.email_id === "string" &&
        data.email_id.length > 0 &&
        (!bodyPlain && !bodyHtml)
      ) {
        try {
          console.log("Resend webhook missing body; fetching full email content", { email_id: data.email_id });
          const full = await fetchResendEmailContent(data.email_id, emailApiKey);
          bodyPlain = full.text || "";
          bodyHtml = full.html || "";
        } catch (err) {
          console.error("Failed to fetch full email content from Resend; forwarding without body", {
            email_id: data.email_id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      return {
        recipient: recipient,
        sender: data.from || "",
        from: data.from || "",
        subject: data.subject || "",
        bodyPlain,
        bodyHtml,
        strippedText: data.strippedText || "",
        strippedSignature: data.strippedSignature || "",
        messageHeaders: data.messageHeaders || "",
        timestamp: data.created_at
          ? new Date(data.created_at).getTime()
          : Date.now(),
      };
    }

    return jsonPayload;
  }

  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    const formData = await req.formData();
    const payload: InboundEmailPayload = {
      recipient: formData.get("recipient") as string || "",
      sender: formData.get("sender") as string || "",
      from: formData.get("from") as string || "",
      subject: formData.get("subject") as string || "",
      bodyPlain: formData.get("body-plain") as string || formData.get("text") as string,
      bodyHtml: formData.get("body-html") as string || formData.get("html") as string,
      strippedText: formData.get("stripped-text") as string,
      strippedSignature: formData.get("stripped-signature") as string,
      messageHeaders: formData.get("message-headers") as string,
      timestamp: Date.now(),
    };
    return payload;
  }

  throw new Error("Unsupported content type");
}

async function lookupBurnerEmail(supabase: any, emailAddress: string): Promise<BurnerEmailRecord | null> {
  const cleanEmail = emailAddress.toLowerCase().trim();

  const { data, error } = await supabase
    .from("burner_emails")
    .select("id, email_address, real_email, is_active, expires_at")
    .eq("email_address", cleanEmail)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    console.error("Database lookup error:", error);
    return null;
  }

  if (!data) {
    return null;
  }

  if (data.expires_at) {
    const expiresAt = new Date(data.expires_at);
    if (expiresAt < new Date()) {
      console.log("Burner email expired:", emailAddress);
      return null;
    }
  }

  return data;
}

async function forwardEmail(
  emailProvider: string,
  apiKey: string,
  payload: InboundEmailPayload,
  targetEmail: string
): Promise<{ success: boolean; error?: string; trackersRemoved?: number }> {
  try {
    console.log("=== FORWARD EMAIL START ===");
    console.log("Email Provider:", emailProvider);
    console.log("Target Email:", targetEmail);
    console.log("API Key Present:", !!apiKey);
    console.log("API Key Length:", apiKey ? apiKey.length : 0);
    console.log("Payload sender:", payload.sender || payload.from);
    console.log("Payload recipient:", payload.recipient);
    console.log("Payload subject:", payload.subject);

    const htmlContent = payload.bodyHtml || `<p>${payload.bodyPlain || payload.strippedText}</p>`;
    const textContent = payload.bodyPlain || payload.strippedText || '';

    console.log("Content lengths - HTML:", htmlContent.length, "Text:", textContent.length);

    const sanitized = sanitizeEmail(htmlContent, textContent);

    const trackersRemoved =
      sanitized.trackersRemoved.trackingPixels +
      sanitized.trackersRemoved.remoteImages +
      sanitized.trackersRemoved.trackingLinks;

    const sanitizationReport = generateSanitizationReport(sanitized);
    const cleanSubject = sanitizeSubject(payload.subject);

    console.log("Sanitization complete:", {
      trackingPixels: sanitized.trackersRemoved.trackingPixels,
      remoteImages: sanitized.trackersRemoved.remoteImages,
      trackingLinks: sanitized.trackersRemoved.trackingLinks,
      total: trackersRemoved,
    });

    if (emailProvider === "resend") {
      // Extract sender username (part before @) for cleaner display
      const senderName = payload.from.split('@')[0];
      const emailPayload = {
        from: `${senderName} via Privaseer <forwarded@burner.privaseer.co.uk>`,
        to: targetEmail,
        subject: cleanSubject,
        text: sanitized.text + sanitizationReport,
        html: sanitized.html + sanitizationReport.replace(/\n/g, '<br>'),
        reply_to: payload.sender,
        headers: {
          "X-Original-From": payload.from,
          "X-Original-To": payload.recipient,
          "X-Privaseer-Trackers-Removed": trackersRemoved.toString(),
        },
      };

      console.log("Sending to Resend API...");
      console.log("Email payload (sanitized):", {
        from: emailPayload.from,
        to: emailPayload.to,
        subject: emailPayload.subject,
        textLength: emailPayload.text.length,
        htmlLength: emailPayload.html.length,
        reply_to: emailPayload.reply_to,
      });

      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(emailPayload),
      });

      console.log("Resend API Response Status:", response.status);
      console.log("Resend API Response Headers:", Object.fromEntries(response.headers.entries()));

      const responseText = await response.text();
      console.log("Resend API Response Body:", responseText);

      if (!response.ok) {
        console.error("Resend API error - Status:", response.status);
        console.error("Resend API error - Body:", responseText);
        return { success: false, error: `Resend error: ${response.status} - ${responseText}` };
      }

      let responseData;
      try {
        responseData = JSON.parse(responseText);
        console.log("Resend API Success Response:", responseData);
      } catch (e) {
        console.log("Resend API response is not JSON, raw text:", responseText);
        responseData = { message: responseText };
      }

      console.log("=== FORWARD EMAIL SUCCESS ===");
      return { success: true, trackersRemoved };
    } else if (emailProvider === "mailgun") {
      const domain = Deno.env.get("MAILGUN_DOMAIN") || "burner.privaseer.co.uk";
      console.log("Using Mailgun with domain:", domain);
      
      // Extract sender username (part before @) for cleaner display
      const senderName = payload.from.split('@')[0];
      const mailgunPayload = new URLSearchParams({
        from: `${senderName} via Privaseer <forwarded@burner.privaseer.co.uk>`,
        to: targetEmail,
        subject: cleanSubject,
        text: sanitized.text + sanitizationReport,
        html: sanitized.html + sanitizationReport.replace(/\n/g, '<br>'),
        "h:Reply-To": payload.sender,
        "h:X-Original-From": payload.from,
        "h:X-Original-To": payload.recipient,
        "h:X-Privaseer-Trackers-Removed": trackersRemoved.toString(),
      });

      console.log("Sending to Mailgun API...");
      console.log("Mailgun payload (sanitized):", {
        from: mailgunPayload.get("from"),
        to: mailgunPayload.get("to"),
        subject: mailgunPayload.get("subject"),
      });

      const response = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
        method: "POST",
        headers: {
          "Authorization": `Basic ${btoa(`api:${apiKey}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: mailgunPayload,
      });

      console.log("Mailgun API Response Status:", response.status);
      const responseText = await response.text();
      console.log("Mailgun API Response Body:", responseText);

      if (!response.ok) {
        console.error("Mailgun API error - Status:", response.status);
        console.error("Mailgun API error - Body:", responseText);
        return { success: false, error: `Mailgun error: ${response.status} - ${responseText}` };
      }

      console.log("=== FORWARD EMAIL SUCCESS (Mailgun) ===");
      return { success: true, trackersRemoved };
    }

    console.error("Unknown email provider:", emailProvider);
    return { success: false, error: `Unknown email provider: ${emailProvider}` };
  } catch (error) {
    console.error("=== FORWARD EMAIL EXCEPTION ===");
    console.error("Error type:", error instanceof Error ? error.constructor.name : typeof error);
    console.error("Error message:", error instanceof Error ? error.message : String(error));
    console.error("Error stack:", error instanceof Error ? error.stack : "No stack trace");
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

async function logEmail(
  supabase: any,
  burnerEmailId: string,
  payload: InboundEmailPayload,
  forwarded: boolean,
  trackersRemoved: number = 0,
  errorMessage?: string
): Promise<void> {
  const { error } = await supabase
    .from("email_logs")
    .insert({
      burner_email_id: burnerEmailId,
      from_address: payload.sender || payload.from,
      subject: payload.subject || "",
      received_at: payload.timestamp ? new Date(payload.timestamp).toISOString() : new Date().toISOString(),
      forwarded,
      forwarded_at: forwarded ? new Date().toISOString() : null,
      error_message: errorMessage || null,
      trackers_removed: trackersRemoved,
    });

  if (error) {
    console.error("Failed to log email:", error);
  }
}

async function incrementCounters(supabase: any, emailAddress: string, forwarded: boolean): Promise<void> {
  const { error: incrementError } = await supabase.rpc(
    "increment_email_received",
    { p_email_address: emailAddress }
  );

  if (incrementError) {
    console.error("Failed to increment received counter:", incrementError);
  }

  if (forwarded) {
    const { data: burnerEmail } = await supabase
      .from("burner_emails")
      .select("id")
      .eq("email_address", emailAddress)
      .maybeSingle();

    if (burnerEmail) {
      const { error: forwardError } = await supabase.rpc(
        "increment_email_forwarded",
        { p_burner_email_id: burnerEmail.id }
      );

      if (forwardError) {
        console.error("Failed to increment forwarded counter:", forwardError);
      }
    }
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  try {
    console.log("=== INBOUND EMAIL FUNCTION START ===");
    console.log("Request Method:", req.method);
    console.log("Request URL:", req.url);
    console.log("Request Headers:", Object.fromEntries(req.headers.entries()));

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const emailProvider = Deno.env.get("EMAIL_PROVIDER") || "resend";
    const emailApiKey = Deno.env.get("EMAIL_API_KEY");

    console.log("Configuration check:");
    console.log("  SUPABASE_URL:", supabaseUrl ? "✓ Set" : "✗ Missing");
    console.log("  SUPABASE_ANON_KEY:", supabaseKey ? "✓ Set" : "✗ Missing");
    console.log("  EMAIL_PROVIDER:", emailProvider);
    console.log("  EMAIL_API_KEY:", emailApiKey ? "✓ Set (length: " + emailApiKey.length + ")" : "✗ Missing");

    if (!emailApiKey) {
      console.error("EMAIL_API_KEY not configured");
      return new Response(
        JSON.stringify({ error: "Email forwarding not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log("Parsing email payload...");
    const rawPayload = await parseEmailPayload(req, emailProvider, emailApiKey);
    console.log("Raw payload received:", {
      recipient: rawPayload.recipient,
      sender: rawPayload.sender,
      from: rawPayload.from,
      subject: rawPayload.subject,
      hasBodyPlain: !!rawPayload.bodyPlain,
      hasBodyHtml: !!rawPayload.bodyHtml,
    });

    const validation = validateEmailPayload(rawPayload);
    if (!validation.valid) {
      console.warn("Invalid email payload:", validation.error);
      return createValidationErrorResponse(validation.error!);
    }

    const payload = validation.sanitized!;

    console.log("Inbound email received (validated):", {
      recipient: payload.recipient,
      from: payload.sender || payload.from,
      subject: payload.subject,
      bodyPlainLength: payload.bodyPlain?.length || 0,
      bodyHtmlLength: payload.bodyHtml?.length || 0,
    });

    console.log("Looking up burner email:", payload.recipient);
    const burnerEmail = await lookupBurnerEmail(supabase, payload.recipient);

    if (!burnerEmail) {
      console.log("Burner email not found or inactive:", payload.recipient);
      return new Response(
        JSON.stringify({
          error: "Burner email not found or inactive",
          message: "Email rejected",
        }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log("Burner email found:", {
      id: burnerEmail.id,
      email_address: burnerEmail.email_address,
      real_email: burnerEmail.real_email,
      is_active: burnerEmail.is_active,
      expires_at: burnerEmail.expires_at,
    });

    const rateLimitCheck = await checkRateLimit(supabase, burnerEmail.id);

    if (!rateLimitCheck.allowed) {
      console.warn("Rate limit exceeded:", {
        burnerEmail: payload.recipient,
        reason: rateLimitCheck.reason,
      });

      await handleRateLimitViolation(
        supabase,
        burnerEmail.id,
        burnerEmail.email_address,
        rateLimitCheck
      );

      return new Response(
        JSON.stringify({
          error: "Rate limit exceeded",
          message: generateRateLimitResponse(rateLimitCheck),
        }),
        {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const spamCheck = await detectSpamSpike(supabase, burnerEmail.id);

    if (spamCheck.isSpike) {
      console.warn("Spam spike detected, auto-pausing:", {
        burnerEmail: payload.recipient,
        reason: spamCheck.reason,
      });

      await handleSpamSpike(
        supabase,
        burnerEmail.id,
        burnerEmail.email_address,
        spamCheck
      );

      return new Response(
        JSON.stringify({
          error: "Spam spike detected",
          message: "This burner email has been automatically paused due to suspicious activity.",
        }),
        {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log("=== STARTING EMAIL FORWARD ===");
    console.log("Forwarding email to:", burnerEmail.real_email);
    console.log("Using provider:", emailProvider);

    const forwardResult = await forwardEmail(
      emailProvider,
      emailApiKey,
      payload,
      burnerEmail.real_email
    );

    console.log("Forward result:", {
      success: forwardResult.success,
      error: forwardResult.error,
      trackersRemoved: forwardResult.trackersRemoved || 0,
    });

    console.log("Logging email to database...");
    await logEmail(
      supabase,
      burnerEmail.id,
      payload,
      forwardResult.success,
      forwardResult.trackersRemoved || 0,
      forwardResult.error
    );
    console.log("Email logged to database");

    console.log("Incrementing counters...");
    await incrementCounters(
      supabase,
      burnerEmail.email_address,
      forwardResult.success
    );
    console.log("Counters incremented");

    if (forwardResult.success) {
      console.log("=== EMAIL FORWARD SUCCESS ===");
      console.log("Email forwarded successfully", {
        trackersRemoved: forwardResult.trackersRemoved || 0,
        to: burnerEmail.real_email,
      });
      return new Response(
        JSON.stringify({
          success: true,
          message: "Email forwarded successfully",
          trackersRemoved: forwardResult.trackersRemoved || 0,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    } else {
      console.error("=== EMAIL FORWARD FAILED ===");
      console.error("Email forwarding failed:", forwardResult.error);
      return new Response(
        JSON.stringify({
          error: "Failed to forward email",
          details: forwardResult.error,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
  } catch (error) {
    console.error("=== EDGE FUNCTION EXCEPTION ===");
    console.error("Error type:", error instanceof Error ? error.constructor.name : typeof error);
    console.error("Error message:", error instanceof Error ? error.message : String(error));
    console.error("Error stack:", error instanceof Error ? error.stack : "No stack trace");
    return new Response(
      JSON.stringify({
        error: "Internal server error",
        details: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
