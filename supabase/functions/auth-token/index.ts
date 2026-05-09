// @ts-nocheck - Deno Deploy Edge Function
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import * as jose from "npm:jose@5";
import bcrypt from "npm:bcryptjs@2";

type DenoRuntime = {
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
  env: { get(key: string): string | undefined };
};

const denoRuntime = (globalThis as typeof globalThis & { Deno?: DenoRuntime }).Deno;
if (!denoRuntime) {
  throw new Error("Deno runtime is required for this function");
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const TOKEN_TTL = 15 * 60 * 1000; // 15 minutes
const MAX_SKEW_MS = 5 * 60 * 1000; // 5 minutes

const supabaseUrl = denoRuntime.env.get("SUPABASE_URL")!;
const serviceRoleKey = denoRuntime.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const jwtPrivateKeyJwkEnv = denoRuntime.env.get("JWT_PRIVATE_KEY")!;
const jwtIssuer = denoRuntime.env.get("JWT_ISSUER") ?? "privaseer-burner-auth";
const jwtKeyId = denoRuntime.env.get("JWT_KEY_ID") ?? "burner-v1";
const encryptionKeyEnv = denoRuntime.env.get("INSTALLATION_ENCRYPTION_KEY")!;

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

let cachedEncryptionKey: CryptoKey | null = null;
let cachedPrivateSigningKey: jose.KeyLike | null = null;

async function getEncryptionKey(): Promise<CryptoKey> {
  if (cachedEncryptionKey) return cachedEncryptionKey;
  const rawKey = decodeBase64(encryptionKeyEnv);
  if (rawKey.byteLength !== 32) {
    throw new Error("INSTALLATION_ENCRYPTION_KEY must be 32 bytes (base64-encoded)");
  }
  cachedEncryptionKey = await crypto.subtle.importKey(
    "raw",
    rawKey,
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
  return cachedEncryptionKey;
}

async function getPrivateSigningKey(): Promise<jose.KeyLike> {
  if (cachedPrivateSigningKey) return cachedPrivateSigningKey;
  if (!jwtPrivateKeyJwkEnv) {
    throw new Error("JWT private key not configured");
  }
  const jwk = JSON.parse(jwtPrivateKeyJwkEnv);
  cachedPrivateSigningKey = await jose.importJWK(jwk, "ES256");
  return cachedPrivateSigningKey;
}

function encodeBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  bytes.forEach(b => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function encryptSecret(secret: string): Promise<string> {
  const key = await getEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(secret),
  );
  return `${encodeBase64(iv)}.${encodeBase64(cipherBuffer)}`;
}

async function decryptSecret(cipherText: string): Promise<string> {
  const [ivB64, dataB64] = cipherText.split(".");
  if (!ivB64 || !dataB64) {
    throw new Error("Invalid cipher payload");
  }
  const key = await getEncryptionKey();
  const iv = decodeBase64(ivB64);
  const data = decodeBase64(dataB64);
  const plainBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    data,
  );
  return decoder.decode(plainBuffer);
}

function isValidUUID(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

async function computeSignature(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signatureBuffer = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return encodeBase64(signatureBuffer);
}

function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let result = 0;
  for (let i = 0; i < aBytes.length; i++) {
    result |= aBytes[i] ^ bBytes[i];
  }
  return result === 0;
}

async function issueJwt(installationId: string, limits: any): Promise<{ token: string; expiresAt: string }> {
  const exp = new Date(Date.now() + TOKEN_TTL);
  const payload = {
    sub: installationId,
    tier: "standard",
    hourly_remaining: limits?.hourly_remaining ?? limits?.hourly_limit ?? 20,
    daily_remaining: limits?.daily_remaining ?? limits?.daily_limit ?? 50,
  };

  const signingKey = await getPrivateSigningKey();

  const token = await new jose.SignJWT(payload)
    .setProtectedHeader({ alg: "ES256", kid: jwtKeyId, typ: "JWT" })
    .setIssuedAt()
    .setIssuer(jwtIssuer)
    .setExpirationTime(Math.floor(exp.getTime() / 1000))
    .sign(signingKey);

  return { token, expiresAt: exp.toISOString() };
}

denoRuntime.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const body = await req.json();
    const installationId = body?.installationId;
    const timestamp = body?.timestamp;
    const signature = body?.signature as string | undefined;

    if (!installationId || typeof installationId !== "string" || !isValidUUID(installationId)) {
      return new Response(
        JSON.stringify({ error: "Invalid installationId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (typeof timestamp !== "number" || Math.abs(Date.now() - timestamp) > MAX_SKEW_MS) {
      return new Response(
        JSON.stringify({ error: "Stale or missing timestamp" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: installation, error: lookupError } = await supabase
      .from("extension_installations")
      .select("*")
      .eq("installation_id", installationId)
      .maybeSingle();

    if (lookupError) {
      throw lookupError;
    }

    let secretToReturn: string | undefined;
    let secretForSignature: string;
    let secretHash: string;
    let secretCipher: string;

    if (!installation) {
      // Registration flow
      const rawSecret = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
      secretHash = await bcrypt.hash(rawSecret, 12);
      secretCipher = await encryptSecret(rawSecret);
      const { error: insertError } = await supabase
        .from("extension_installations")
        .insert({
          installation_id: installationId,
          secret_hash: secretHash,
          secret_cipher: secretCipher,
        });
      if (insertError) {
        throw insertError;
      }
      secretForSignature = rawSecret;
      secretToReturn = rawSecret;
    } else {
      if (!signature || typeof signature !== "string") {
        return new Response(
          JSON.stringify({ error: "Missing signature" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      secretForSignature = await decryptSecret(installation.secret_cipher);
      const hashMatches = await bcrypt.compare(secretForSignature, installation.secret_hash);
      if (!hashMatches) {
        return new Response(
          JSON.stringify({ error: "Invalid secret" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const expectedSignature = await computeSignature(secretForSignature, `${installationId}:${timestamp}`);
      if (!timingSafeEqual(expectedSignature, signature)) {
        return new Response(
          JSON.stringify({ error: "Invalid signature" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      if (installation.is_blocked) {
        return new Response(
          JSON.stringify({ error: "Installation blocked", reason: installation.blocked_reason }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    const { data: limits, error: limitError } = await supabase.rpc("check_generation_limits", {
      p_installation_id: installationId,
    });
    if (limitError) {
      throw limitError;
    }

    if (limits?.reason === "blocked") {
      return new Response(
        JSON.stringify({ error: "Installation blocked", reason: limits.blocked_reason }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { token, expiresAt } = await issueJwt(installationId, limits);

    await supabase
      .from("extension_installations")
      .update({ last_token_at: new Date().toISOString() })
      .eq("installation_id", installationId);

    return new Response(
      JSON.stringify({
        token,
        expiresAt,
        secret: secretToReturn,
        rateLimit: {
          hourly: {
            used: limits?.hourly_used ?? 0,
            limit: limits?.hourly_limit ?? 20,
            remaining: limits?.hourly_remaining ?? 20,
          },
          daily: {
            used: limits?.daily_used ?? 0,
            limit: limits?.daily_limit ?? 50,
            remaining: limits?.daily_remaining ?? 50,
          },
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("auth-token error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

