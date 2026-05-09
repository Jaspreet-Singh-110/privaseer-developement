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

interface CmpSuggestionRequest {
  installationId: string;
  domain: string;
  pageUrl: string;
  cookieNames?: string[];
  bannerSelectors?: string[];
  bannerTextSnippet?: string;
  language?: string;
  timestamp?: number;
}

function validateString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} is required`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new Error(`${field} exceeds max length`);
  }
  return trimmed;
}

function sanitizeArray(value: unknown, maxItems: number, maxItemLength: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item.length <= maxItemLength)
    .slice(0, maxItems);
}

denoRuntime.serve(async (req: Request) => {
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

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    const body = (await req.json()) as CmpSuggestionRequest;
    const installationId = validateString(body.installationId, "installationId", 128);
    const domain = validateString(body.domain, "domain", 255).toLowerCase();
    const pageUrl = validateString(body.pageUrl, "pageUrl", 1024);
    const cookieNames = sanitizeArray(body.cookieNames, 20, 128);
    const bannerSelectors = sanitizeArray(body.bannerSelectors, 20, 256);
    const bannerTextSnippet =
      typeof body.bannerTextSnippet === "string"
        ? body.bannerTextSnippet.slice(0, 300)
        : null;
    const language =
      typeof body.language === "string" && body.language.trim().length > 0
        ? body.language.trim().slice(0, 16)
        : null;

    const { error } = await supabase
      .from("cmp_suggestions")
      .insert({
        installation_id: installationId,
        domain,
        page_url: pageUrl,
        cookie_names: cookieNames,
        banner_selectors: bannerSelectors,
        banner_text_snippet: bannerTextSnippet,
        language,
      });

    if (error) {
      throw error;
    }

    return new Response(
      JSON.stringify({ success: true, recordedAt: new Date().toISOString() }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
