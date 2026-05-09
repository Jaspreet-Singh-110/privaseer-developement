import { describe, it, expect } from 'vitest';
import {
  assertEdgeFunctionContract,
  loadEdgeFunctionSource,
} from './edge-function-test-harness';

describe('Supabase edge function handler contracts', () => {
  it('auth-token handler keeps core auth and signature guards', async () => {
    await assertEdgeFunctionContract({
      functionPath: 'auth-token/index.ts',
      requiredPatterns: [
        /denoRuntime\.serve\(/,
        /if\s*\(req\.method\s*===\s*"OPTIONS"\)/,
        /if\s*\(req\.method\s*!==\s*"POST"\)/,
        /Invalid installationId/,
        /Stale or missing timestamp/,
        /Missing signature/,
        /Invalid signature/,
        /new jose\.SignJWT/,
      ],
    });
  });

  it('generate-burner-email handler enforces JWT and rate limits', async () => {
    await assertEdgeFunctionContract({
      functionPath: 'generate-burner-email/index.ts',
      requiredPatterns: [
        /denoRuntime\.serve\(/,
        /authenticateRequest\(/,
        /jwtVerify\(/,
        /enforceRateLimit\(/,
        /check_generation_limits/,
        /log_generation_event/,
        /Missing authorization/,
        /Rate limit exceeded|Hourly burner email limit reached|Daily burner email limit reached/,
      ],
    });
  });

  it('inbound-email handler wires validation, throttling, and forwarding', async () => {
    await assertEdgeFunctionContract({
      functionPath: 'inbound-email/index.ts',
      requiredPatterns: [
        /Deno\.serve\(/,
        /if\s*\(req\.method\s*===\s*"OPTIONS"\)/,
        /validateEmailPayload/,
        /checkRateLimit/,
        /detectSpamSpike/,
        /handleRateLimitViolation/,
        /forwardEmail\(/,
        /lookupBurnerEmail\(/,
      ],
    });
  });

  it('submit-feedback handler validates routes and required payload fields', async () => {
    await assertEdgeFunctionContract({
      functionPath: 'submit-feedback/index.ts',
      requiredPatterns: [
        /Deno\.serve\(/,
        /if\s*\(req\.method\s*===\s*"OPTIONS"\)/,
        /endpoint\s*===\s*"feedback"/,
        /endpoint\s*===\s*"telemetry"/,
        /Missing required fields: installationId, feedbackText/,
        /feedbackText exceeds \$\{MAX_FEEDBACK_LENGTH\} characters/,
        /Missing required fields: installationId, eventType, extensionVersion/,
      ],
    });
  });

  it('each handler declares CORS headers', async () => {
    const [authSource, generateSource, inboundSource, submitFeedbackSource] = await Promise.all([
      loadEdgeFunctionSource('auth-token/index.ts'),
      loadEdgeFunctionSource('generate-burner-email/index.ts'),
      loadEdgeFunctionSource('inbound-email/index.ts'),
      loadEdgeFunctionSource('submit-feedback/index.ts'),
    ]);

    expect(authSource).toContain('Access-Control-Allow-Origin');
    expect(generateSource).toContain('Access-Control-Allow-Origin');
    expect(inboundSource).toContain('Access-Control-Allow-Origin');
    expect(submitFeedbackSource).toContain('Access-Control-Allow-Origin');
  });
});
