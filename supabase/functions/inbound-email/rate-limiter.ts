interface RateLimitResult {
  allowed: boolean;
  reason?: string;
  emailsInLastHour?: number;
  hourlyLimit?: number;
}

interface SpamSpikeResult {
  isSpike: boolean;
  reason?: string;
  emailsLast5Min: number;
  emailsLast15Min: number;
  emailsLastHour: number;
}

interface RateLimitStats {
  hourlyLimit: number;
  emailsLastHour: number;
  emailsLast24h: number;
  isPaused: boolean;
  pausedReason?: string;
  remainingHour: number;
}

export async function checkRateLimit(
  supabase: any,
  burnerEmailId: string,
  hourlyLimit: number = 50
): Promise<RateLimitResult> {
  try {
    const { data, error } = await supabase.rpc('check_rate_limit', {
      p_burner_email_id: burnerEmailId,
      p_hourly_limit: hourlyLimit,
    });

    if (error) {
      console.error('Rate limit check error:', error);
      return { allowed: true };
    }

    return {
      allowed: data.allowed,
      reason: data.reason,
      emailsInLastHour: data.emails_in_last_hour,
      hourlyLimit: data.hourly_limit,
    };
  } catch (error) {
    console.error('Rate limit check exception:', error);
    return { allowed: true };
  }
}

export async function detectSpamSpike(
  supabase: any,
  burnerEmailId: string
): Promise<SpamSpikeResult> {
  try {
    const { data, error } = await supabase.rpc('detect_spam_spike', {
      p_burner_email_id: burnerEmailId,
    });

    if (error) {
      console.error('Spam spike detection error:', error);
      return {
        isSpike: false,
        emailsLast5Min: 0,
        emailsLast15Min: 0,
        emailsLastHour: 0,
      };
    }

    return {
      isSpike: data.is_spike,
      reason: data.reason,
      emailsLast5Min: data.emails_last_5min,
      emailsLast15Min: data.emails_last_15min,
      emailsLastHour: data.emails_last_hour,
    };
  } catch (error) {
    console.error('Spam spike detection exception:', error);
    return {
      isSpike: false,
      emailsLast5Min: 0,
      emailsLast15Min: 0,
      emailsLastHour: 0,
    };
  }
}

export async function pauseBurnerEmail(
  supabase: any,
  burnerEmailId: string,
  reason: string
): Promise<void> {
  try {
    const { error } = await supabase.rpc('pause_burner_email', {
      p_burner_email_id: burnerEmailId,
      p_reason: reason,
    });

    if (error) {
      console.error('Failed to pause burner email:', error);
    } else {
      console.log('Burner email paused:', { burnerEmailId, reason });
    }
  } catch (error) {
    console.error('Pause burner email exception:', error);
  }
}

export async function unpauseBurnerEmail(
  supabase: any,
  burnerEmailId: string
): Promise<void> {
  try {
    const { error } = await supabase.rpc('unpause_burner_email', {
      p_burner_email_id: burnerEmailId,
    });

    if (error) {
      console.error('Failed to unpause burner email:', error);
    } else {
      console.log('Burner email unpaused:', { burnerEmailId });
    }
  } catch (error) {
    console.error('Unpause burner email exception:', error);
  }
}

export async function getRateLimitStats(
  supabase: any,
  burnerEmailId: string
): Promise<RateLimitStats | null> {
  try {
    const { data, error } = await supabase.rpc('get_rate_limit_stats', {
      p_burner_email_id: burnerEmailId,
    });

    if (error) {
      console.error('Get rate limit stats error:', error);
      return null;
    }

    return {
      hourlyLimit: data.hourly_limit,
      emailsLastHour: data.emails_last_hour,
      emailsLast24h: data.emails_last_24h,
      isPaused: data.is_paused,
      pausedReason: data.paused_reason,
      remainingHour: data.remaining_hour,
    };
  } catch (error) {
    console.error('Get rate limit stats exception:', error);
    return null;
  }
}

export function generateRateLimitResponse(result: RateLimitResult): string {
  if (result.reason === 'paused') {
    return 'This burner email has been paused due to suspicious activity. Please contact support.';
  }

  if (result.reason === 'rate_limit') {
    return `Rate limit exceeded. This burner email can receive up to ${result.hourlyLimit} emails per hour. Received ${result.emailsInLastHour} in the last hour. Please try again later.`;
  }

  return 'Email rejected due to rate limiting.';
}

export function shouldAutoNotify(spike: SpamSpikeResult): boolean {
  return spike.isSpike && (
    spike.emailsLast5Min >= 10 ||
    spike.emailsLast15Min >= 25
  );
}

export async function handleRateLimitViolation(
  supabase: any,
  burnerEmailId: string,
  emailAddress: string,
  rateLimitResult: RateLimitResult
): Promise<void> {
  console.warn('Rate limit violation:', {
    burnerEmailId,
    emailAddress,
    reason: rateLimitResult.reason,
    emailsInLastHour: rateLimitResult.emailsInLastHour,
  });

  try {
    await supabase
      .from('email_logs')
      .insert({
        burner_email_id: burnerEmailId,
        from_address: 'RATE_LIMIT_VIOLATION',
        subject: 'Rate limit exceeded',
        received_at: new Date().toISOString(),
        forwarded: false,
        error_message: generateRateLimitResponse(rateLimitResult),
      });
  } catch (error) {
    console.error('Failed to log rate limit violation:', error);
  }
}

export async function handleSpamSpike(
  supabase: any,
  burnerEmailId: string,
  emailAddress: string,
  spike: SpamSpikeResult
): Promise<void> {
  console.warn('Spam spike detected:', {
    burnerEmailId,
    emailAddress,
    reason: spike.reason,
    emailsLast5Min: spike.emailsLast5Min,
    emailsLast15Min: spike.emailsLast15Min,
  });

  await pauseBurnerEmail(supabase, burnerEmailId, spike.reason || 'Spam spike detected');

  try {
    await supabase
      .from('email_logs')
      .insert({
        burner_email_id: burnerEmailId,
        from_address: 'SPAM_SPIKE_DETECTED',
        subject: 'Auto-paused due to spam spike',
        received_at: new Date().toISOString(),
        forwarded: false,
        error_message: spike.reason,
      });
  } catch (error) {
    console.error('Failed to log spam spike:', error);
  }
}
