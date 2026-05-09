import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type DenoRuntime = {
  env: { get(key: string): string | undefined };
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
};

const denoRuntime = (globalThis as typeof globalThis & { Deno?: DenoRuntime }).Deno;
if (!denoRuntime) throw new Error("Deno runtime is required");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface ConsentStateRequest {
  installationId: string;
  domain: string;
  cmpType: string;
  consentStatus: 'accepted' | 'rejected' | 'partial' | 'unknown';
  hasRejectButton: boolean;
  isCompliant: boolean;
  cookieNames: string[];
  tcfVersion?: string;
  detectionMethod: 'cookie' | 'api' | 'banner' | 'hybrid';
  confidenceScore: number;
}

denoRuntime.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "Method not allowed" }),
        { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = denoRuntime.env.get("SUPABASE_URL");
    const supabaseServiceKey = denoRuntime.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Missing Supabase configuration");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json() as ConsentStateRequest;

    // Validate required fields
    if (!body.installationId || !body.domain || !body.cmpType) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: installationId, domain, cmpType" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if consent state already exists for this installation + domain
    const { data: existing } = await supabase
      .from("consent_state")
      .select("id")
      .eq("installation_id", body.installationId)
      .eq("domain", body.domain)
      .single();

    if (existing) {
      // Update existing record
      const { error: updateError } = await supabase
        .from("consent_state")
        .update({
          cmp_type: body.cmpType,
          consent_status: body.consentStatus,
          has_reject_button: body.hasRejectButton,
          is_compliant: body.isCompliant,
          cookie_names: body.cookieNames,
          tcf_version: body.tcfVersion || null,
          last_verified: new Date().toISOString(),
        })
        .eq("id", existing.id);

      if (updateError) throw updateError;
    } else {
      // Insert new record
      const { error: insertError } = await supabase
        .from("consent_state")
        .insert({
          installation_id: body.installationId,
          domain: body.domain,
          cmp_type: body.cmpType,
          consent_status: body.consentStatus,
          has_reject_button: body.hasRejectButton,
          is_compliant: body.isCompliant,
          cookie_names: body.cookieNames,
          tcf_version: body.tcfVersion || null,
        });

      if (insertError) throw insertError;
    }

    // Log CMP detection for analytics
    await supabase
      .from("cmp_detections")
      .insert({
        installation_id: body.installationId,
        domain: body.domain,
        cmp_type: body.cmpType,
        detection_method: body.detectionMethod,
        confidence_score: body.confidenceScore,
      });

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error persisting consent state:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

