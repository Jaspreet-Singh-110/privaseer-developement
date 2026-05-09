export const STORAGE_KEY = 'privacyData' as const;

export const RULESET_ID = 'tracker_blocklist' as const;

export const PRIVACY_SCORE = {
  MAX: 100,
  MIN: 0,
  INITIAL: 100,
  TRACKER_PENALTY: -1,
  CLEAN_SITE_REWARD: 2,
  NON_COMPLIANT_PENALTY: -5,
} as const;

export const CREDIT_SCORE = {
  MIN: 300,
  MAX: 850,
  BASE: 550,

  PROTECTION_CAP: 150,
  CLEAN_BROWSING_CAP: 100,
  HIGH_RISK_CAP: -200,
  VIOLATION_CAP: -100,

  DAILY_HIGH_RISK_CAP: 30,

  CLEAN_SITE_TRACKER_MAX: 3,
  METRICS_RETENTION_DAYS: 30,

  LABELS: {
    EXCELLENT: 750,
    GOOD: 650,
    FAIR: 550,
    POOR: 400,
  },
} as const;

export const SCORING_CONFIG = {
  REFRESH_INTERVAL_MS: 60 * 60 * 1000,
  ENDPOINT: '/functions/v1/get-scoring-config',
  DEFAULT_VERSION: '1.0',
  DEFAULTS: {
    riskWeights: {
      analytics: 1,
      advertising: 2,
      social: 2,
      fingerprinting: 5,
      beacons: 2,
      cryptomining: 10,
      malware: 20,
      unknown: 1,
    },
    creditFactors: {
      protectionMultiplier: 50,
      protectionCap: 150,
      cleanBrowsingMultiplier: 10,
      cleanBrowsingCap: 100,
      highRiskCap: -200,
      violationMultiplier: 25,
      violationCap: -100,
      dailyHighRiskCap: 30,
    },
    decay: {
      enabled: true,
      base: 0.5,
      maxOccurrences: 4,
    },
  },
} as const;

export const TIME = {
  ONE_WEEK_MS: 7 * 24 * 60 * 60 * 1000,
  ONE_DAY_MS: 24 * 60 * 60 * 1000,
  ONE_HOUR_MS: 60 * 60 * 1000,
  FIVE_SECONDS_MS: 5000,
  TWO_SECONDS_MS: 2000,
  POPUP_REFRESH_INTERVAL_MS: 2000,
} as const;

export const LIMITS = {
  MAX_ALERTS: 100,
  MAX_HISTORY_DAYS: 30,
  ALERTS_DISPLAY_COUNT: 20,
} as const;

export const BADGE = {
  BACKGROUND_COLOR: '#DC2626',
} as const;

export const SCANNER = {
  INITIAL_SCAN_DELAY_MS: 2000,
  MUTATION_DEBOUNCE_MS: 500,
} as const;

export const CONSENT_VIOLATION = {
  REJECTION_WINDOW_MS: 60000,
  AGGREGATION_DELAY_MS: 2000,
} as const;

export const ONBOARDING = {
  TOTAL_STEPS: 6,
  AUTO_OPEN_DELAY_MS: 500,
  REMINDER_THRESHOLD_DAYS: 7,
  WELCOME_PAGE_PATH: 'src/welcome/welcome.html',
  ABANDONMENT_TIMEOUT_MS: 30 * 60 * 1000,
  EVENTS: {
    STARTED: 'onboarding_started',
    STEP_VIEWED: 'onboarding_step_viewed',
    STEP_COMPLETED: 'onboarding_step_completed',
    SKIPPED: 'onboarding_skipped',
    COMPLETED: 'onboarding_completed',
    ABANDONED: 'onboarding_abandoned',
  },
} as const;

export const CONSENT_BANNER = {
  MAX_TEXT_LENGTH: 2000,
  BUTTON_SIZE_PROMINENCE_THRESHOLD: 1.5,
  FONT_SIZE_PROMINENCE_THRESHOLD: 1.2,
} as const;

export const CONFIDENCE = {
  ALERT_THRESHOLD: 80,
  HIGH_CONFIDENCE: 90,
  MEDIUM_CONFIDENCE: 70,
  LOW_CONFIDENCE: 50,
  WEIGHTS: {
    BANNER_DETECTION: 0.25,
    BUTTON_DETECTION: 0.3,
    CMP_RECOGNITION: 0.25,
    CONTEXTUAL: 0.2,
  },
} as const;

export const DATA_EXPORT = {
  FORMAT: 'privaseer-data-export',
  VERSION: '2.0',
  MAX_SNAPSHOT_DAYS: 30,
  GDPR: {
    DATA_CONTROLLER: 'Privaseer local extension',
    PURPOSE: 'Privacy protection analytics and user data portability',
    LEGAL_BASIS: 'User consent and GDPR Article 20 portability request',
    RETENTION_POLICY: 'Data retained locally for up to 30 days where applicable',
    DATA_CATEGORIES: [
      'Privacy scores',
      'Tracker blocking statistics',
      'Site compliance assessments',
      'Burner email usage statistics',
      'Extension settings',
    ],
  },
} as const;

export const FALSE_POSITIVE_FEEDBACK = {
  BASE_THRESHOLD: 80,
  MIN_REPORTERS_FOR_OVERRIDE: 3,
  MAX_OVERRIDE_THRESHOLD: 95,
  REPORT_DECAY_DAYS: 90,
  LOCAL_REPORT_EXPIRY_DAYS: 30,
  OVERRIDE_REFRESH_INTERVAL_MS: 60 * 60 * 1000,
  OVERRIDES_ENDPOINT: '/functions/v1/get-fp-overrides',
} as const;

export const SCAN_PHASES = {
  QUICK_DELAY_MS: 0,
  INTERACTION_DELAY_MS: 5000,
  DELAYED_DELAY_MS: 10000,
  MAX_PHASES: 3,
} as const;

export const CMP_CONFIG = {
  REFRESH_INTERVAL_MS: 60 * 60 * 1000,
  ENDPOINT: '/functions/v1/get-cmp-config',
} as const;

export const ALLOWLIST = {
  USER_ENTRY_EXPIRY_DAYS: 90,
  VERIFIED_REFRESH_DAYS: 7,
} as const;

export const DAILY_RECOVERY = {
  CLEAN_DAY_THRESHOLD: 10,
  VERY_CLEAN_DAY_THRESHOLD: 5,
  CLEAN_DAY_REWARD: 1,
  VERY_CLEAN_DAY_REWARD: 2,
} as const;

export const STORAGE_RETRY = {
  MAX_ATTEMPTS: 3,
  INITIAL_DELAY_MS: 1000,
  BACKOFF_MULTIPLIER: 2,
} as const;

export const SUPABASE = {
  URL: 'https://llffqxdhpgsqnpzeznaq.supabase.co',
  ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
};

export const BURNER_AUTH = {
  TOKEN_REFRESH_BUFFER_MS: 60 * 1000,
  MAX_TOKEN_RETRIES: 2,
  AUTH_ENDPOINT: '/functions/v1/auth-token',
  SECRET_STORAGE_KEY: 'installationSecret',
} as const;