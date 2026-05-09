import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface OverrideRow {
  domain: string;
  override_threshold: number;
  report_count: number;
  last_updated: string | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Missing Supabase configuration");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    const { data, error } = await supabase
      .from("domain_confidence_overrides")
      .select("domain, override_threshold, report_count, last_updated");

    if (error) {
      throw error;
    }

    const overrides: Record<string, { threshold: number; reportCount: number; lastUpdated: string }> = {};
    for (const row of (data ?? []) as OverrideRow[]) {
      if (!row.domain || typeof row.override_threshold !== "number") {
        continue;
      }
      overrides[row.domain] = {
        threshold: row.override_threshold,
        reportCount: typeof row.report_count === "number" ? row.report_count : 0,
        lastUpdated: row.last_updated ?? new Date(0).toISOString(),
      };
    }

    return new Response(
      JSON.stringify({ success: true, overrides }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Internal server error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
