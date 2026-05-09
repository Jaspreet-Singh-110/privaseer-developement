import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface FeedbackRequest {
  installationId: string;
  feedbackText: string;
  url?: string;
  domain?: string;
  extensionVersion?: string;
  browserVersion?: string;
}

interface TelemetryRequest {
  installationId: string;
  eventType: string;
  eventData?: Record<string, unknown>;
  extensionVersion: string;
  browserVersion?: string;
}

const MAX_FEEDBACK_LENGTH = 5000;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const url = new URL(req.url);
    const endpoint = url.pathname.split('/').pop();

    if (req.method === "POST" && endpoint === "feedback") {
      const body: FeedbackRequest = await req.json();
      const trimmedFeedback = body.feedbackText?.trim() ?? "";

      if (!body.installationId || !trimmedFeedback) {
        return new Response(
          JSON.stringify({ error: "Missing required fields: installationId, feedbackText" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      if (trimmedFeedback.length > MAX_FEEDBACK_LENGTH) {
        return new Response(
          JSON.stringify({ error: `feedbackText exceeds ${MAX_FEEDBACK_LENGTH} characters` }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const { data, error } = await supabase
        .from("user_feedback")
        .insert({
          installation_id: body.installationId,
          feedback_text: trimmedFeedback,
          url: body.url || null,
          domain: body.domain || null,
          extension_version: body.extensionVersion || null,
          browser_version: body.browserVersion || null,
        })
        .select()
        .single();

      if (error) {
        console.error("Database error:", error);
        return new Response(
          JSON.stringify({ error: "Failed to submit feedback" }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      return new Response(
        JSON.stringify({ success: true, feedback: data }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (req.method === "POST" && endpoint === "telemetry") {
      const body: TelemetryRequest = await req.json();

      if (!body.installationId || !body.eventType || !body.extensionVersion) {
        return new Response(
          JSON.stringify({ error: "Missing required fields: installationId, eventType, extensionVersion" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const { error } = await supabase
        .from("telemetry_events")
        .insert({
          installation_id: body.installationId,
          event_type: body.eventType,
          event_data: body.eventData || {},
          extension_version: body.extensionVersion,
          browser_version: body.browserVersion || null,
        });

      if (error) {
        console.error("Database error:", error);
        return new Response(
          JSON.stringify({ error: "Failed to submit telemetry" }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      return new Response(
        JSON.stringify({ success: true }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({ error: "Invalid endpoint or method" }),
      {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Edge function error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
