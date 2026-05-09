import type { ScoringConfig } from '../types';
import { logger } from '../utils/logger';
import { SCORING_CONFIG, SUPABASE } from '../utils/constants';
import { toError } from '../utils/type-guards';

const SCORING_CONFIG_ENDPOINT = `${SUPABASE.URL}${SCORING_CONFIG.ENDPOINT}`;

let scoringConfigCache: ScoringConfig | null = null;

const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  version: SCORING_CONFIG.DEFAULT_VERSION,
  riskWeights: { ...SCORING_CONFIG.DEFAULTS.riskWeights },
  creditFactors: { ...SCORING_CONFIG.DEFAULTS.creditFactors },
  decay: { ...SCORING_CONFIG.DEFAULTS.decay },
};

function toNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeScoringConfig(input: unknown): ScoringConfig {
  const raw = (input ?? {}) as Partial<ScoringConfig>;
  const rawRiskWeights = (raw.riskWeights ?? {}) as Record<string, unknown>;
  const rawCreditFactors = (raw.creditFactors ?? {}) as Record<string, unknown>;
  const rawDecay = (raw.decay ?? {}) as Record<string, unknown>;

  return {
    version:
      typeof raw.version === 'string' && raw.version.trim().length > 0
        ? raw.version
        : SCORING_CONFIG.DEFAULT_VERSION,
    riskWeights: {
      analytics: toNumber(rawRiskWeights.analytics, SCORING_CONFIG.DEFAULTS.riskWeights.analytics),
      advertising: toNumber(rawRiskWeights.advertising, SCORING_CONFIG.DEFAULTS.riskWeights.advertising),
      social: toNumber(rawRiskWeights.social, SCORING_CONFIG.DEFAULTS.riskWeights.social),
      fingerprinting: toNumber(
        rawRiskWeights.fingerprinting,
        SCORING_CONFIG.DEFAULTS.riskWeights.fingerprinting
      ),
      beacons: toNumber(rawRiskWeights.beacons, SCORING_CONFIG.DEFAULTS.riskWeights.beacons),
      cryptomining: toNumber(rawRiskWeights.cryptomining, SCORING_CONFIG.DEFAULTS.riskWeights.cryptomining),
      malware: toNumber(rawRiskWeights.malware, SCORING_CONFIG.DEFAULTS.riskWeights.malware),
      unknown: toNumber(rawRiskWeights.unknown, SCORING_CONFIG.DEFAULTS.riskWeights.unknown),
    },
    creditFactors: {
      protectionMultiplier: toNumber(
        rawCreditFactors.protectionMultiplier,
        SCORING_CONFIG.DEFAULTS.creditFactors.protectionMultiplier
      ),
      protectionCap: toNumber(rawCreditFactors.protectionCap, SCORING_CONFIG.DEFAULTS.creditFactors.protectionCap),
      cleanBrowsingMultiplier: toNumber(
        rawCreditFactors.cleanBrowsingMultiplier,
        SCORING_CONFIG.DEFAULTS.creditFactors.cleanBrowsingMultiplier
      ),
      cleanBrowsingCap: toNumber(
        rawCreditFactors.cleanBrowsingCap,
        SCORING_CONFIG.DEFAULTS.creditFactors.cleanBrowsingCap
      ),
      highRiskCap: toNumber(rawCreditFactors.highRiskCap, SCORING_CONFIG.DEFAULTS.creditFactors.highRiskCap),
      violationMultiplier: toNumber(
        rawCreditFactors.violationMultiplier,
        SCORING_CONFIG.DEFAULTS.creditFactors.violationMultiplier
      ),
      violationCap: toNumber(rawCreditFactors.violationCap, SCORING_CONFIG.DEFAULTS.creditFactors.violationCap),
      dailyHighRiskCap: toNumber(
        rawCreditFactors.dailyHighRiskCap,
        SCORING_CONFIG.DEFAULTS.creditFactors.dailyHighRiskCap
      ),
    },
    decay: {
      enabled: typeof rawDecay.enabled === 'boolean' ? rawDecay.enabled : SCORING_CONFIG.DEFAULTS.decay.enabled,
      base: toNumber(rawDecay.base, SCORING_CONFIG.DEFAULTS.decay.base),
      maxOccurrences: toNumber(rawDecay.maxOccurrences, SCORING_CONFIG.DEFAULTS.decay.maxOccurrences),
    },
  };
}

function cloneConfig(config: ScoringConfig): ScoringConfig {
  return JSON.parse(JSON.stringify(config)) as ScoringConfig;
}

export function getScoringConfig(): ScoringConfig {
  return cloneConfig(scoringConfigCache ?? DEFAULT_SCORING_CONFIG);
}

export async function fetchScoringConfig(): Promise<void> {
  try {
    const response = await fetch(SCORING_CONFIG_ENDPOINT, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SUPABASE.ANON_KEY}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch scoring config: ${response.status}`);
    }

    const payload = (await response.json()) as { config?: unknown };
    scoringConfigCache = normalizeScoringConfig(payload.config);

    logger.debug('ScoringConfig', 'Scoring config refreshed', {
      version: scoringConfigCache.version,
    });
  } catch (error) {
    logger.error('ScoringConfig', 'Error fetching scoring config', toError(error));
  }
}

export function resetScoringConfigCache(): void {
  scoringConfigCache = null;
}
