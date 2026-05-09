import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface CmpConfigRow {
  cmp_name: string;
  cookie_patterns: string[] | null;
  banner_selectors: string[] | null;
  consent_parsers: Record<string, "generic" | "onetrust" | "cookiebot"> | null;
  version: string | null;
  updated_at: string | null;
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
      .from("cmp_configs")
      .select("cmp_name, cookie_patterns, banner_selectors, consent_parsers, version, updated_at")
      .eq("is_active", true)
      .order("cmp_name", { ascending: true });

    if (error) {
      throw error;
    }

    const configs = ((data ?? []) as CmpConfigRow[]).map((row) => ({
      name: row.cmp_name,
      cookiePatterns: row.cookie_patterns ?? [],
      bannerSelectors: row.banner_selectors ?? [],
      consentParsers: row.consent_parsers ?? {},
      version: row.version ?? "1.0",
      lastUpdated: row.updated_at ?? new Date(0).toISOString(),
    }));

    return new Response(
      JSON.stringify({ success: true, configs }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
