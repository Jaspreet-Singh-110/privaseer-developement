// Privacy Advisor types
export type RiskLevel = 'low' | 'medium' | 'high';
export type PrivacyDataType = 'email' | 'location' | 'behavioral' | 'fingerprint' | 'advertising' | 'social' | 'unknown';

export interface PrivacyAlternative {
  name: string;
  url: string;
  description: string;
}

export interface PrivacyAdvisorAlert {
  collectorName: string;
  dataType: PrivacyDataType;
  riskLevel: RiskLevel;
  domain: string;
  category: string;
  actions: string[];
}

export interface Alert {
  id: string;
  type: 'tracker_blocked' | 'non_compliant_site' | 'high_risk' | 'post_consent_violation';
  severity: 'low' | 'medium' | 'high';
  message: string;
  domain: string;
  timestamp: number;
  url?: string;
  deceptivePatterns?: string[];
  trackerCount?: number;
  blockedTrackers?: string[];
  scanConfidence?: number;
}

export interface PrivacyScore {
  current: number;
  daily: {
    trackersBlocked: number;
    cleanSitesVisited: number;
    nonCompliantSites: number;
  };
  history: Array<{
    date: string;
    score: number;
    trackersBlocked: number;
  }>;
}

export interface DailyCreditMetrics {
  date: string;
  trackersBlocked: number;
  cleanSitesVisited: number;
  highRiskScore: number;
  postConsentViolations: number;
  protectionActiveMinutes: number;
}

export type CreditScoreLabel = 'Excellent' | 'Good' | 'Fair' | 'Poor' | 'Very Poor';
export type ScoreTrend = 'improving' | 'stable' | 'declining';

export interface CreditScoreFactors {
  protectionConsistency: { value: number; impact: number };
  cleanBrowsing: { value: number; impact: number };
  highRiskExposure: { value: number; impact: number };
  violations: { value: number; impact: number };
}

export interface CreditScoreResult {
  score: number;
  label: CreditScoreLabel;
  trend: ScoreTrend;
  formulaVersion: string;
  factors: CreditScoreFactors;
  lastCalculated: number;
}

export interface ScoringConfig {
  version: string;
  riskWeights: Record<string, number>;
  creditFactors: {
    protectionMultiplier: number;
    protectionCap: number;
    cleanBrowsingMultiplier: number;
    cleanBrowsingCap: number;
    highRiskCap: number;
    violationMultiplier: number;
    violationCap: number;
    dailyHighRiskCap: number;
  };
  decay: {
    enabled: boolean;
    base: number;
    maxOccurrences: number;
  };
}

export interface TrackerData {
  domain: string;
  category: string;
  isHighRisk: boolean;
  blockedCount: number;
  lastBlocked: number;
}

export interface DeceptivePatternRule {
  id: string;
  name: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  penalty: number;
}

export interface DeceptivePatternViolation {
  id: string;
  name: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  penalty: number;
}

export interface ConfidenceFactor {
  name: string;
  score: number;
  weight: number;
  reasoning: string;
}

export interface ScanConfidence {
  overall: number;
  bannerDetection: ConfidenceFactor;
  buttonDetection: ConfidenceFactor;
  cmpRecognition: ConfidenceFactor;
  contextualAnalysis: ConfidenceFactor;
  factors: ConfidenceFactor[];
  reasoning: string[];
  shouldAlert: boolean;
}

export interface AllowlistEntry {
  domain: string;
  addedAt: number;
  source: 'user' | 'verified' | 'community';
  expiresAt?: number;
}

export type FalsePositiveReason =
  | 'banner_compliant'
  | 'no_banner_present'
  | 'wrong_detection'
  | 'other';

export interface ReportedFalsePositive {
  timestamp: number;
  reason: FalsePositiveReason;
}

export interface FalsePositiveStatus {
  threshold: number;
  reportCount: number;
  hasOverride: boolean;
  userReported: boolean;
  userReason?: FalsePositiveReason;
  reportedAt?: number;
}

export interface FalsePositiveAggregation {
  reportCount: number;
  overrideThreshold: number | null;
  shouldOverride: boolean;
}

export interface FalsePositiveReport {
  domain: string;
  url: string;
  detectedPatterns: string[];
  reason: FalsePositiveReason;
  userReason?: string;
  timestamp: number;
  installationId: string;
  scanConfidence: number;
}

export interface PrivacyRules {
  version: string;
  cookieBannerSelectors: string[];
  rejectButtonPatterns: string[];
  acceptButtonPatterns: string[];
  complianceChecks: {
    rejectButtonRequired: boolean;
    rejectButtonVisibleWithoutScroll: boolean;
    equalProminence: boolean;
    noPreCheckedBoxes: boolean;
    explicitConsent: boolean;
  };
  deceptivePatterns: DeceptivePatternRule[];
}

export interface ConsentScanResult {
  url: string;
  hasBanner: boolean;
  hasRejectButton: boolean;
  isCompliant: boolean;
  deceptivePatterns: string[];
  violations?: DeceptivePatternViolation[];
  complianceScore?: number;
  timestamp: number;
  cmpDetection?: CMPDetectionResult;
  hasPersistedConsent?: boolean;
}

export interface ConsentScanResultV2 extends ConsentScanResult {
  confidence: ScanConfidence;
  pageLanguage?: string;
  scanPhase: 'quick' | 'interaction' | 'delayed';
}

export interface CMPDetectionResult {
  detected: boolean;
  cmpType: string;
  detectionMethod: 'cookie' | 'api' | 'banner' | 'hybrid';
  confidenceScore: number;
  consentStatus?: 'accepted' | 'rejected' | 'partial' | 'unknown';
  cookieNames: string[];
  tcfVersion?: string;
  hasRejectButton?: boolean;
}

export interface RemoteCMPConfig {
  name: string;
  cookiePatterns: string[];
  bannerSelectors: string[];
  consentParsers: Record<string, 'generic' | 'onetrust' | 'cookiebot'>;
  version: string;
  lastUpdated: string;
}

export interface CMPSuggestion {
  domain: string;
  pageUrl: string;
  cookieNames: string[];
  bannerSelectors: string[];
  bannerTextSnippet?: string;
  language?: string;
  installationId?: string;
  timestamp: number;
}

export interface ConsentState {
  id: string;
  installationId: string;
  domain: string;
  cmpType: string;
  consentStatus: 'accepted' | 'rejected' | 'partial' | 'unknown';
  hasRejectButton: boolean;
  isCompliant: boolean;
  cookieNames: string[];
  tcfVersion?: string;
  firstSeen: string;
  lastVerified: string;
  createdAt: string;
}

export interface LocalConsentState {
  domain: string;
  consentStatus: 'accepted' | 'rejected' | 'dismissed' | 'unknown';
  cmpId: string;
  timestamp: number;
  choice: 'explicit' | 'implied' | 'none';
  expiresAt?: number;
}

export interface DailyMetricsSnapshot {
  date: string;
  privacyScore: number;
  trackersBlocked: number;
  trackersByCategory: Record<string, number>;
  cleanSitesVisited: number;
  nonCompliantSites: number;
  complianceScores: number[];
  burnerEmailsGenerated: number;
  burnerEmailsForwarded: number;
}

export interface MetricsAggregation {
  period: 'week' | 'month' | 'all-time';
  totalTrackersBlocked: number;
  trackersByCategory: Record<string, number>;
  averagePrivacyScore: number;
  averageComplianceScore: number;
  cleanSitesVisited: number;
  nonCompliantSites: number;
  burnerEmailsGenerated: number;
  burnerEmailsForwarded: number;
  topBlockedDomains: Array<{ domain: string; count: number }>;
}

export interface TelemetryReport {
  installationId: string;
  reportDate: string;
  dailyMetrics: DailyMetricsSnapshot;
  weeklyAggregation: MetricsAggregation;
  extensionVersion: string;
  privacyScoreTrend: Array<{ date: string; score: number }>;
}

export interface StorageData {
  privacyScore: PrivacyScore;
  creditScore?: CreditScoreResult;
  dailyCreditMetrics?: DailyCreditMetrics[];
  alerts: Alert[];
  trackers: Record<string, TrackerData>;
  settings: {
    protectionEnabled: boolean;
    showNotifications: boolean;
    theme: 'light' | 'dark' | 'system';
    burnerEmailEnabled: boolean;
    telemetryEnabled: boolean;
  };
  lastReset: number;
  penalizedDomains?: Record<string, number>;
  consentStates: Record<string, LocalConsentState>;
  allowlist?: Record<string, AllowlistEntry>;
  reportedFalsePositives?: Record<string, ReportedFalsePositive>;
  domainOccurrences: Record<string, number>;
  dailySnapshots?: DailyMetricsSnapshot[];
  burnerEmailStats?: {
    generated: number;
    forwarded: number;
  };
  complianceScores?: number[];
  realEmail?: string; // User's real email for forwarding
  onboarding: OnboardingState;
}

export type ExportFormat = 'json' | 'csv';

export interface GdprExportMetadata {
  dataController: string;
  purpose: string;
  legalBasis: string;
  retentionPolicy: string;
  dataCategories: string[];
}

export interface SanitizedExportData extends Omit<StorageData, 'realEmail' | 'alerts'> {
  alerts: Alert[];
  realEmail?: string | null;
}

export interface GdprExportPayload {
  format: string;
  version: string;
  exportedAt: string;
  gdpr: GdprExportMetadata;
  data: SanitizedExportData;
}

// Backward compatibility alias for older references.
export type DataExportPayload = GdprExportPayload;

export interface DomainConfidenceOverride {
  threshold: number;
  reportCount: number;
  lastUpdated: string;
}

export type OnboardingEventType =
  | 'onboarding_started'
  | 'onboarding_step_viewed'
  | 'onboarding_step_completed'
  | 'onboarding_skipped'
  | 'onboarding_completed'
  | 'onboarding_abandoned';

export interface OnboardingStepTiming {
  stepIndex: number;
  stepId: string;
  enteredAt: number;
  exitedAt?: number;
  durationMs?: number;
}

export interface OnboardingState {
  hasCompletedOnboarding: boolean;
  currentStep: number;
  completedAt?: number;
  skippedAt?: number;
  emailConfigured?: boolean;
  startedAt?: number;
  stepTimings?: OnboardingStepTiming[];
}

export type MessageType =
  | 'STATE_UPDATE'
  | 'GET_STATE'
  | 'GET_ALL_SETTINGS'
  | 'TOGGLE_PROTECTION'
  | 'GET_CREDIT_SCORE'
  | 'GET_SCORING_CONFIG'
  | 'CREDIT_SCORE_UPDATED'
  | 'CONSENT_SCAN_RESULT'
  | 'GET_TRACKER_INFO'
  | 'TRACKER_BLOCKED'
  | 'POST_CONSENT_VIOLATION'
  | 'TAB_ACTIVATED'
  | 'TAB_UPDATED'
  | 'TAB_REMOVED'
  | 'CLEAR_ALERTS'
  | 'EXTENSION_READY'
  | 'GENERATE_BURNER_EMAIL'
  | 'GET_BURNER_EMAILS'
  | 'DELETE_BURNER_EMAIL'
  | 'GET_BURNER_EMAIL_SETTING'
  | 'SET_BURNER_EMAIL_SETTING'
  | 'BURNER_EMAIL_SETTING_CHANGED'
  | 'GET_TELEMETRY_SETTING'
  | 'SET_TELEMETRY_SETTING'
  | 'SUBMIT_FEEDBACK'
  | 'TRACK_EVENT'
  | 'RECORD_COMPLIANCE_SCORE'
  | 'GET_METRICS_AGGREGATION'
  | 'GET_PRIVACY_SCORE_TREND'
  | 'EXPORT_USER_DATA'
  | 'DELETE_ALL_DATA'
  | 'SET_THEME'
  | 'GET_THEME'
  | 'THEME_CHANGED'
  | 'GET_REAL_EMAIL'
  | 'SET_REAL_EMAIL'
  | 'GET_ONBOARDING_STATE'
  | 'SET_ONBOARDING_STEP'
  | 'COMPLETE_ONBOARDING'
  | 'SKIP_ONBOARDING'
  | 'REPORT_FALSE_POSITIVE'
  | 'REFRESH_CMP_CONFIG'
  | 'SUGGEST_CMP_PATTERN'
  | 'GET_ALLOWLIST'
  | 'ADD_TO_ALLOWLIST'
  | 'REMOVE_FROM_ALLOWLIST'
  | 'GET_ALTERNATIVES'
  | 'CLASSIFY_RISK'
  | 'PRIVACY_ADVISOR_ALERT'
  | 'CONSENT_REJECT_CLICKED';

export interface AllSettingsResponse {
  theme: 'light' | 'dark' | 'system';
  burnerEmailEnabled: boolean;
  telemetryEnabled: boolean;
  realEmail: string | null;
}

// Message data types for type-safe messaging
export interface GetTrackerInfoData {
  domain: string;
}

export interface GetTrackerInfoResponse {
  success: boolean;
  info?: {
    description: string;
    alternative: string;
  };
  error?: string;
}

export interface GetStateResponse {
  success: boolean;
  data?: StorageData;
  error?: string;
}

export interface ToggleProtectionResponse {
  success: boolean;
  enabled?: boolean;
  error?: string;
}

export interface MessageResponse {
  success: boolean;
  error?: string;
  [key: string]: unknown;
}

// Map of message types to their data types
export interface TabSummary {
  id: number;
  url?: string;
  title?: string;
  active: boolean;
  blockCount: number;
  lastUpdate: number;
  status?: 'loading' | 'complete';
}

export interface MessageDataMap {
  STATE_UPDATE: undefined;
  GET_STATE: undefined;
  GET_ALL_SETTINGS: undefined;
  TOGGLE_PROTECTION: undefined;
  GET_CREDIT_SCORE: undefined;
  GET_SCORING_CONFIG: undefined;
  CREDIT_SCORE_UPDATED: { creditScore: CreditScoreResult };
  CONSENT_SCAN_RESULT: ConsentScanResultV2;
  GET_TRACKER_INFO: GetTrackerInfoData;
  TRACKER_BLOCKED: undefined;
  POST_CONSENT_VIOLATION: { domain: string; count: number; trackers: string[] };
  TAB_ACTIVATED: { tabId: number; tab?: TabSummary };
  TAB_UPDATED: { tabId: number; changeInfo?: Record<string, unknown>; tab?: TabSummary };
  TAB_REMOVED: { tabId: number };
  CLEAR_ALERTS: undefined;
  EXTENSION_READY: undefined;
  GENERATE_BURNER_EMAIL: { domain: string; url?: string; label?: string };
  GET_BURNER_EMAILS: undefined;
  DELETE_BURNER_EMAIL: { emailId: string };
  SUBMIT_FEEDBACK: { feedbackText: string; url?: string; domain?: string };
  GET_BURNER_EMAIL_SETTING: undefined;
  SET_BURNER_EMAIL_SETTING: { enabled: boolean };
  BURNER_EMAIL_SETTING_CHANGED: { enabled: boolean };
  GET_METRICS_AGGREGATION: { period?: 'week' | 'month' | 'all-time' } | undefined;
  GET_PRIVACY_SCORE_TREND: undefined;
  EXPORT_USER_DATA: { format?: ExportFormat; includeEmail?: boolean } | undefined;
  DELETE_ALL_DATA: undefined;
  GET_TELEMETRY_SETTING: undefined;
  SET_TELEMETRY_SETTING: { enabled: boolean };
  GET_REAL_EMAIL: undefined;
  SET_REAL_EMAIL: { email: string };
  SET_THEME: { theme: 'light' | 'dark' | 'system' };
  GET_THEME: undefined;
  THEME_CHANGED: { theme: 'light' | 'dark' | 'system' };
  TRACK_EVENT: { eventType: string; eventData?: Record<string, unknown> };
  RECORD_COMPLIANCE_SCORE: { score: number };
  GET_ONBOARDING_STATE: undefined;
  SET_ONBOARDING_STEP: {
    step: number;
    stepId?: string;
    previousStepId?: string;
    enteredAt?: number;
    exitedAt?: number;
    durationMs?: number;
  };
  COMPLETE_ONBOARDING: { emailConfigured?: boolean };
  SKIP_ONBOARDING: { atStep: number; reason?: 'skipped' | 'abandoned' };
  REPORT_FALSE_POSITIVE: FalsePositiveReport;
  REFRESH_CMP_CONFIG: undefined;
  SUGGEST_CMP_PATTERN: CMPSuggestion;
  GET_ALLOWLIST: undefined;
  ADD_TO_ALLOWLIST: { domain: string; source?: 'user' };
  REMOVE_FROM_ALLOWLIST: { domain: string };
  GET_ALTERNATIVES: { domain: string };
  CLASSIFY_RISK: { domain: string; category: string; trackerCount?: number };
  PRIVACY_ADVISOR_ALERT: { trackerDomain: string; category: string; siteDomain: string };
  CONSENT_REJECT_CLICKED: { domain: string };
}

export interface Message<T extends MessageType = MessageType> {
  type: T;
  data?: MessageDataMap[T];
  requestId?: string;
  timestamp?: number;
}

export interface MessageHandler<T extends MessageType = MessageType> {
  (data: MessageDataMap[T], sender: chrome.runtime.MessageSender): Promise<unknown> | unknown;
}

// Backward compatibility alias
export type MessagePayload = Message;

export interface TrackerLists {
  version: string;
  lastUpdated: string;
  categories: {
    analytics: string[];
    advertising: string[];
    social: string[];
    fingerprinting: string[];
    beacons: string[];
  };
  highRisk: string[];
}

export interface BurnerEmail {
  id: string;
  email_address: string;
  domain: string;
  url?: string;
  label?: string;
  is_active: boolean;
  times_used: number;
  created_at: string;
}

export type BurnerEmailError =
  | 'disabled'
  | 'no_real_email'
  | 'auth_failed'
  | 'rate_limited'
  | 'blocked'
  | 'unknown';

// Behavioral Tracker Detection types
export interface BehavioralTrackerResult {
  domain: string;
  detectionType: string[];
  riskLevel: 'Low risk' | 'Medium risk' | 'High risk';
  reason: string;
  timestamp: number;
  tabUrl: string;
  tabId: number;
}

export interface ComplianceViolationResult {
  tracker: BehavioralTrackerResult;
  violationType: string;
  timestamp: number;
}
