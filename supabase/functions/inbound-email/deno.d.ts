// Type declarations for Deno runtime
// These types are provided by edge-runtime.d.ts at runtime, but needed for TypeScript compilation
declare namespace Deno {
  function serve(
    handler: (req: Request) => Response | Promise<Response>
  ): void;
  
  const env: {
    get(key: string): string | undefined;
  };
}

// Type declarations for Deno runtime
// These types are provided by edge-runtime.d.ts at runtime, but needed for TypeScript compilation
declare namespace Deno {
  function serve(
    handler: (req: Request) => Response | Promise<Response>
  ): void;
  
  const env: {
    get(key: string): string | undefined;
  };
}

// Specific declaration for @supabase/supabase-js
declare module "npm:@supabase/supabase-js@2" {
  export function createClient(
    supabaseUrl: string,
    supabaseKey: string,
    options?: any
  ): any;
}

// Allow npm: and jsr: import specifiers (generic fallback)
declare module "npm:*" {
  const content: any;
  export = content;
}

declare module "jsr:*" {
  const content: any;
  export = content;
}

declare module "jsr:*" {
  const content: any;
  export = content;
}
