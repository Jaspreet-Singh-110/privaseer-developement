import { useEffect, useState, useRef, type KeyboardEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { Shield, ShieldOff, Activity, AlertTriangle, CheckCircle2, XCircle, Info, Mail, Settings, TrendingUp, TrendingDown, Minus, Award, Sparkles, Target, Eye, Lock, Zap } from 'lucide-react';
import type {
  StorageData,
  Alert as AlertType,
  Message,
  OnboardingState,
  CreditScoreResult,
  FalsePositiveReason,
  FalsePositiveStatus,
  MetricsAggregation,
} from '../types';
import { logger } from '../utils/logger';
import { toError } from '../utils/type-guards';
import { BurnerEmailsSection } from './burner-emails-section';
import { SettingsPage, type SettingsSection, type SettingsPageProps } from './settings-page';
import { ThemeManager } from '../utils/theme-manager';
import { ONBOARDING, CREDIT_SCORE } from '../utils/constants';
import '../index.css';

type ReportableSettingsPageProps = SettingsPageProps & {
  reportContext?: AlertType | null;
  onReportClear?: () => void;
};

const ReportableSettingsPage = SettingsPage as (props: ReportableSettingsPageProps) => JSX.Element;

function normalizeDomain(domain: string): string {
  const normalized = domain.trim().toLowerCase();
  return normalized.startsWith('www.') ? normalized.slice(4) : normalized;
}

// Helper: compute the next tier threshold and label above the current score
function getNextTier(score: number): { nextThreshold: number; nextLabel: string; pointsNeeded: number } | null {
  const tiers = [
    { threshold: CREDIT_SCORE.LABELS.EXCELLENT, label: 'Excellent' },
    { threshold: CREDIT_SCORE.LABELS.GOOD, label: 'Good' },
    { threshold: CREDIT_SCORE.LABELS.FAIR, label: 'Fair' },
    { threshold: CREDIT_SCORE.LABELS.POOR, label: 'Poor' },
  ];
  for (const tier of tiers) {
    if (score < tier.threshold) {
      return { nextThreshold: tier.threshold, nextLabel: tier.label, pointsNeeded: tier.threshold - score };
    }
  }
  return null; // Already at the top tier
}

// Helper: get the hex color for a score (used for SVG strokes)
function getScoreHex(s: number): string {
  if (s >= CREDIT_SCORE.LABELS.EXCELLENT) return '#10B981';
  if (s >= CREDIT_SCORE.LABELS.GOOD) return '#22C55E';
  if (s >= CREDIT_SCORE.LABELS.FAIR) return '#F59E0B';
  if (s >= CREDIT_SCORE.LABELS.POOR) return '#F97316';
  return '#EF4444';
}

interface ScoreFactorCardProps {
  icon: React.ReactNode;
  label: string;
  impact: number;
  description: string;
}

function ScoreFactorCard({ icon, label, impact, description }: ScoreFactorCardProps) {
  const isPositive = impact >= 0;
  return (
    <div
      className={`flex items-start gap-2.5 p-2.5 rounded-lg border ${
        isPositive
          ? 'border-green-100 dark:border-green-900/40 bg-green-50/50 dark:bg-green-900/10'
          : 'border-red-100 dark:border-red-900/40 bg-red-50/50 dark:bg-red-900/10'
      }`}
      title={description}
      aria-label={`${label}: ${isPositive ? '+' : ''}${impact} points. ${description}`}
    >
      <div className={`mt-0.5 flex-shrink-0 ${
        isPositive ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'
      }`}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className={`text-xs font-semibold ${
            isPositive ? 'text-green-800 dark:text-green-200' : 'text-red-800 dark:text-red-200'
          }`}>{label}</span>
          <span className={`text-xs font-bold ml-1 ${
            isPositive ? 'text-green-700 dark:text-green-300' : 'text-red-600 dark:text-red-300'
          }`}>{isPositive ? '+' : ''}{impact}</span>
        </div>
        <p className={`text-[10px] mt-0.5 ${
          isPositive ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'
        }`}>{description}</p>
      </div>
    </div>
  );
}

interface GamificationBadgeProps {
  icon: React.ReactNode;
  label: string;
  earned: boolean;
  tooltip: string;
}

function GamificationBadge({ icon, label, earned, tooltip }: GamificationBadgeProps) {
  return (
    <div
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold transition-all ${
        earned
          ? 'bg-gradient-to-r from-indigo-500/10 to-purple-500/10 dark:from-indigo-500/20 dark:to-purple-500/20 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 animate-badge-appear'
          : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 border border-gray-200 dark:border-gray-700 opacity-50'
      }`}
      title={tooltip}
      aria-label={`${label} badge${earned ? ' — earned' : ' — not yet earned'}`}
    >
      {icon}
      {label}
    </div>
  );
}

function CreditScoreMeter({ creditScore, dailyTrackersBlocked, cleanSitesVisited }: {
  creditScore: CreditScoreResult | null;
  dailyTrackersBlocked?: number;
  cleanSitesVisited?: number;
}) {
  const [animatedScore, setAnimatedScore] = useState<number>(CREDIT_SCORE.BASE);
  const animationRef = useRef<number>();
  const startValueRef = useRef<number>(CREDIT_SCORE.BASE);
  const score = creditScore?.score ?? CREDIT_SCORE.BASE;
  const label = creditScore?.label ?? 'Fair';
  const trend = creditScore?.trend ?? 'stable';

  // Determine colors based on score
  const getScoreColor = (s: number) => {
    if (s >= CREDIT_SCORE.LABELS.EXCELLENT) return { text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500', ring: 'ring-emerald-200' };
    if (s >= CREDIT_SCORE.LABELS.GOOD) return { text: 'text-green-600 dark:text-green-400', bg: 'bg-green-500', ring: 'ring-green-200' };
    if (s >= CREDIT_SCORE.LABELS.FAIR) return { text: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500', ring: 'ring-amber-200' };
    if (s >= CREDIT_SCORE.LABELS.POOR) return { text: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-500', ring: 'ring-orange-200' };
    return { text: 'text-red-600 dark:text-red-400', bg: 'bg-red-500', ring: 'ring-red-200' };
  };

  const scoreColors = getScoreColor(score);
  const scoreHex = getScoreHex(score);

  useEffect(() => {
    startValueRef.current = animatedScore;
  }, [animatedScore]);

  // Animate score on change
  useEffect(() => {
    let startTime: number;
    const startValue = startValueRef.current;
    const duration = 1200;

    const animate = (currentTime: number) => {
      if (!startTime) startTime = currentTime;
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easeOutCubic = 1 - Math.pow(1 - progress, 3);
      const currentScore = Math.round(startValue + (score - startValue) * easeOutCubic);

      setAnimatedScore(currentScore);

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        startValueRef.current = currentScore;
      }
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [score]);

  const TrendIcon = trend === 'improving' ? TrendingUp : trend === 'declining' ? TrendingDown : Minus;
  const trendColor =
    trend === 'improving' ? 'text-green-600 dark:text-green-400' : trend === 'declining' ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400';

  const contributions = creditScore
    ? [
        { name: 'Protection', impact: creditScore.factors.protectionConsistency.impact },
        { name: 'Clean Sites', impact: creditScore.factors.cleanBrowsing.impact },
        { name: 'High-Risk', impact: creditScore.factors.highRiskExposure.impact },
        { name: 'Violations', impact: creditScore.factors.violations.impact },
      ]
    : [];

  const positive = contributions.filter(c => c.impact > 0).sort((a, b) => b.impact - a.impact).slice(0, 2);
  const negative = contributions.filter(c => c.impact < 0).sort((a, b) => a.impact - b.impact).slice(0, 2);

  // Calculate progress percentage for the arc (300-850 range)
  const progressPercent = ((score - CREDIT_SCORE.MIN) / (CREDIT_SCORE.MAX - CREDIT_SCORE.MIN)) * 100;

  // Score delta from factor impacts (net effect)
  const totalDelta = creditScore
    ? creditScore.factors.protectionConsistency.impact +
      creditScore.factors.cleanBrowsing.impact +
      creditScore.factors.highRiskExposure.impact +
      creditScore.factors.violations.impact
    : 0;

  // Next tier progress
  const nextTier = getNextTier(score);
  const tierProgressPercent = nextTier
    ? Math.max(0, Math.min(100, ((score - (nextTier.nextThreshold - 100)) / 100) * 100))
    : 100;

  // Gamification badges (UI-only, computed from runtime data)
  const isPrivacyGuardian = score >= CREDIT_SCORE.LABELS.EXCELLENT;
  const isCleanSurfer = (cleanSitesVisited ?? 0) > 10;
  const isTrackerDefender = (dailyTrackersBlocked ?? 0) > 50;

  return (
    <div className="w-full">
      {/* Score Display */}
      <div className="flex items-center gap-6">
        {/* Circular Progress Indicator with Glow */}
        <div className="relative w-24 h-24 flex-shrink-0">
          <svg className="w-24 h-24 transform -rotate-90 animate-pulse-glow" viewBox="0 0 100 100">
            {/* Background circle */}
            <circle
              cx="50"
              cy="50"
              r="42"
              fill="none"
              stroke="currentColor"
              strokeWidth="8"
              className="text-gray-200 dark:text-gray-700"
            />
            {/* Progress arc */}
            <circle
              cx="50"
              cy="50"
              r="42"
              fill="none"
              stroke={scoreHex}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={`${progressPercent * 2.64} 264`}
              className="animate-score-ring"
              style={{ transition: 'stroke-dasharray 1.2s ease-out' }}
            />
          </svg>
          {/* Score number in center */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={`text-2xl font-bold ${scoreColors.text}`}>{animatedScore}</span>
            {totalDelta !== 0 && (
              <span className={`text-[9px] font-semibold ${
                totalDelta > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'
              }`}>
                {totalDelta > 0 ? '+' : ''}{totalDelta} pts
              </span>
            )}
          </div>
        </div>

        {/* Score Details */}
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-lg font-bold ${scoreColors.text}`}>{label}</span>
            <div className={`flex items-center gap-1 ${trendColor}`}>
              <TrendIcon className="w-4 h-4" />
              <span className="text-xs font-medium capitalize">{trend}</span>
            </div>
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
            Score: {score} / {CREDIT_SCORE.MAX}
          </div>

          {/* Progress to Next Tier */}
          {nextTier && (
            <div className="mb-2" title={`${nextTier.pointsNeeded} points to ${nextTier.nextLabel}`} aria-label={`${nextTier.pointsNeeded} points to reach ${nextTier.nextLabel} tier`}>
              <div className="flex items-center justify-between text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">
                <span className="flex items-center gap-1"><Target className="w-3 h-3" />{nextTier.pointsNeeded} pts to {nextTier.nextLabel}</span>
              </div>
              <div className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full animate-progress-fill"
                  style={{
                    '--progress-width': `${tierProgressPercent}%`,
                    width: `${tierProgressPercent}%`,
                    backgroundColor: scoreHex,
                  } as React.CSSProperties}
                />
              </div>
            </div>
          )}
          {!nextTier && (
            <div className="mb-2 flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">
              <Sparkles className="w-3 h-3" />Top tier achieved!
            </div>
          )}

          {/* Factor Pills */}
          {contributions.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {positive.slice(0, 1).map(item => (
                <span key={item.name} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
                  <TrendingUp className="w-3 h-3" />
                  {item.name} +{item.impact}
                </span>
              ))}
              {negative.slice(0, 1).map(item => (
                <span key={item.name} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300">
                  <TrendingDown className="w-3 h-3" />
                  {item.name} {item.impact}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Gamification Badges */}
      {(isPrivacyGuardian || isCleanSurfer || isTrackerDefender) && (
        <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Earned badges">
          <GamificationBadge
            icon={<Award className="w-3 h-3" />}
            label="Privacy Guardian"
            earned={isPrivacyGuardian}
            tooltip="Score 750+ to earn this badge"
          />
          <GamificationBadge
            icon={<CheckCircle2 className="w-3 h-3" />}
            label="Clean Surfer"
            earned={isCleanSurfer}
            tooltip="Visit 10+ safe sites to earn this badge"
          />
          <GamificationBadge
            icon={<Shield className="w-3 h-3" />}
            label="Tracker Defender"
            earned={isTrackerDefender}
            tooltip="Block 50+ trackers to earn this badge"
          />
        </div>
      )}

      {/* "Why This Score?" Breakdown */}
      {creditScore && (
        <div className="mt-4">
          <p className="text-[10px] font-semibold text-gray-600 dark:text-gray-300 mb-2 uppercase tracking-wide flex items-center gap-1">
            <Eye className="w-3 h-3" /> Why This Score?
          </p>
          <div className="grid grid-cols-2 gap-2">
            <ScoreFactorCard
              icon={<Shield className="w-3.5 h-3.5" />}
              label="Protection"
              impact={creditScore.factors.protectionConsistency.impact}
              description="Keeping protection active boosts your score"
            />
            <ScoreFactorCard
              icon={<CheckCircle2 className="w-3.5 h-3.5" />}
              label="Safe Sites"
              impact={creditScore.factors.cleanBrowsing.impact}
              description="Visiting privacy-respecting sites helps"
            />
            <ScoreFactorCard
              icon={<AlertTriangle className="w-3.5 h-3.5" />}
              label="High-Risk"
              impact={creditScore.factors.highRiskExposure.impact}
              description="Exposure to risky trackers lowers your score"
            />
            <ScoreFactorCard
              icon={<XCircle className="w-3.5 h-3.5" />}
              label="Violations"
              impact={creditScore.factors.violations.impact}
              description="Sites ignoring your consent hurt your score"
            />
          </div>
        </div>
      )}

      {/* Actionable Improvement Tips */}
      {score < CREDIT_SCORE.LABELS.EXCELLENT && (
        <div className="mt-4 rounded-xl border border-indigo-100 dark:border-indigo-900/40 bg-indigo-50/50 dark:bg-indigo-900/10 p-3">
          <p className="text-[10px] font-semibold text-indigo-700 dark:text-indigo-300 mb-2 uppercase tracking-wide flex items-center gap-1">
            <Zap className="w-3 h-3" /> How to Improve Your Score
          </p>
          <ul className="space-y-1.5">
            {score < CREDIT_SCORE.LABELS.GOOD && (
              <li className="flex items-start gap-2 text-[11px] text-indigo-700 dark:text-indigo-300">
                <Mail className="w-3 h-3 mt-0.5 flex-shrink-0" />
                <span>Use burner emails on untrusted sites</span>
              </li>
            )}
            <li className="flex items-start gap-2 text-[11px] text-indigo-700 dark:text-indigo-300">
              <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
              <span>Avoid high-risk domains with aggressive trackers</span>
            </li>
            <li className="flex items-start gap-2 text-[11px] text-indigo-700 dark:text-indigo-300">
              <Lock className="w-3 h-3 mt-0.5 flex-shrink-0" />
              <span>Reject optional cookies when prompted</span>
            </li>
            {score < CREDIT_SCORE.LABELS.FAIR && (
              <li className="flex items-start gap-2 text-[11px] text-indigo-700 dark:text-indigo-300">
                <Sparkles className="w-3 h-3 mt-0.5 flex-shrink-0" />
                <span>Prefer privacy-friendly alternatives for popular services</span>
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

export function Popup() {
  const [data, setData] = useState<StorageData | null>(null);
  const [falsePositiveStatuses, setFalsePositiveStatuses] = useState<Record<string, FalsePositiveStatus>>({});
  const [loading, setLoading] = useState(true);
  const [expandedAlerts, setExpandedAlerts] = useState<Set<string>>(new Set());
  const [showSuccessBanner, setShowSuccessBanner] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [currentTab, setCurrentTab] = useState<chrome.tabs.Tab | null>(null);
  const [showProtectionToast, setShowProtectionToast] = useState(false);
  const [protectionToastMessage, setProtectionToastMessage] = useState('');
  const [protectionToastState, setProtectionToastState] = useState(false);
  const [isTogglingProtection, setIsTogglingProtection] = useState(false);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'burner'>('dashboard');
  const [settingsDeepLink, setSettingsDeepLink] = useState<SettingsSection | null>(null);
  const [highlightBurnerToggle, setHighlightBurnerToggle] = useState(false);
  const [reportingAlert, setReportingAlert] = useState<AlertType | null>(null);
  const [onboardingState, setOnboardingState] = useState<OnboardingState | null>(null);
  const [metricsPeriod, setMetricsPeriod] = useState<'week' | 'month' | 'all-time'>('week');
  const [metricsAggregation, setMetricsAggregation] = useState<MetricsAggregation | null>(null);
  const [isLoadingAggregation, setIsLoadingAggregation] = useState(false);
  const [consentAction, setConsentAction] = useState<{ action: string; timestamp: number } | null>(null);
  const dataRef = useRef<StorageData | null>(null);
  const tabs: Array<'dashboard' | 'burner'> = ['dashboard', 'burner'];
  const queryParams = new URLSearchParams(window.location.search);
  const querySource = queryParams.get('source');
  const querySection = queryParams.get('section');
  const isOnboardingBurnerRedirect =
    querySource === 'onboarding' && querySection === 'burner-services';

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    if (currentTab?.url && (currentTab.url.startsWith('http://') || currentTab.url.startsWith('https://'))) {
      try {
        const domain = new URL(currentTab.url).hostname;
        void chrome.storage.local.get(`consent_action_${domain}`).then(result => {
          if (result[`consent_action_${domain}`]) {
            setConsentAction(result[`consent_action_${domain}`]);
          }
        });
      } catch (e) {
        // invalid URL
      }
    }
  }, [currentTab?.url]);

  useEffect(() => {
    checkCurrentTab();
    loadData();
    loadOnboardingState();

    const listener = (message: Message) => {
      if (message.type === 'STATE_UPDATE' || message.type === 'CREDIT_SCORE_UPDATED') {
        loadData();
        loadOnboardingState();
      } else if (message.type === 'THEME_CHANGED') {
        const { theme } = message.data as { theme: 'light' | 'dark' | 'system' };
        if (theme) {
          ThemeManager.updatePreference(theme);
        }
      }
    };

    chrome.runtime.onMessage.addListener(listener);

    const interval = setInterval(() => {
      if (!dataRef.current) {
        loadData();
      }
    }, 2000);

    return () => {
      chrome.runtime.onMessage.removeListener(listener);
      clearInterval(interval);
    };
     
  }, []); // Empty deps - only run once on mount to prevent re-render loop

  useEffect(() => {
    initializeTheme();

    return () => {
      ThemeManager.cleanup();
    };
  }, []);

  const initializeTheme = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_THEME' });
      if (response.success && response.theme) {
        ThemeManager.initialize(response.theme);
      } else {
        ThemeManager.initialize('system');
      }
    } catch (error) {
      logger.error('Popup', 'Failed to initialize theme', toError(error));
      ThemeManager.initialize('system');
    }
  };

  const checkCurrentTab = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      setCurrentTab(tab);
    } catch (error) {
      logger.error('Popup', 'Failed to get current tab', toError(error));
    }
  };

  const loadData = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_STATE' }) as {
        success?: boolean;
        data?: StorageData;
        falsePositiveStatuses?: Record<string, FalsePositiveStatus>;
      };
      if (response && response.success) {
        if (response.data) {
          setData(response.data);
        }
        setFalsePositiveStatuses(response.falsePositiveStatuses ?? {});
      }
    } catch (error) {
      const err = toError(error);
      const errorMessage = err.message;
      if (errorMessage.includes('Could not establish connection') ||
          errorMessage.includes('Receiving end does not exist')) {
        // Stryker disable next-line all: logging only
        logger.debug('Popup', 'Service worker not ready yet');
      } else {
        logger.error('Popup', 'Failed to load data', err);
      }
    } finally {
      setLoading(false);
    }
  };

  const loadOnboardingState = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_ONBOARDING_STATE' });
      if (response?.success && response.onboarding) {
        setOnboardingState(response.onboarding);
      }
    } catch (error) {
      logger.error('Popup', 'Failed to load onboarding state', toError(error));
    }
  };

  const loadMetricsAggregation = async (period: 'week' | 'month' | 'all-time') => {
    setIsLoadingAggregation(true);
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_METRICS_AGGREGATION',
        data: { period },
      }) as {
        success?: boolean;
        aggregation?: MetricsAggregation;
      };

      if (response?.success && response.aggregation) {
        setMetricsAggregation(response.aggregation);
      } else {
        setMetricsAggregation(null);
      }
    } catch (error) {
      logger.error('Popup', 'Failed to load aggregated metrics', toError(error));
      setMetricsAggregation(null);
    } finally {
      setIsLoadingAggregation(false);
    }
  };

  useEffect(() => {
    if (activeTab !== 'dashboard') {
      return;
    }
    void loadMetricsAggregation(metricsPeriod);
     
  }, [activeTab, metricsPeriod]);

  const openWelcomeGuide = () => {
    chrome.tabs.create(
      {
        url: chrome.runtime.getURL(ONBOARDING.WELCOME_PAGE_PATH),
        active: true,
      },
      () => {
        if (chrome.runtime.lastError) {
          logger.warn('Popup', 'Unable to open welcome guide', {
            error: chrome.runtime.lastError.message,
          });
        } else {
          window.close();
        }
      }
    );
  };

  const openSettingsToBurner = () => {
    setSettingsDeepLink('burner-services');
    setHighlightBurnerToggle(true);
    setShowSettings(true);
  };

  const toggleProtection = async () => {
    if (isTogglingProtection) return;

    setIsTogglingProtection(true);

    const timeout = setTimeout(() => {
      setIsTogglingProtection(false);
      // Stryker disable next-line all: logging only
      logger.warn('Popup', 'Toggle protection timed out');
    }, 5000);

    try {
      const response = await chrome.runtime.sendMessage({ type: 'TOGGLE_PROTECTION' });
      clearTimeout(timeout);

      if (response && response.success) {
        const newState = response.enabled;

        await loadData();

        setProtectionToastState(newState);
        setProtectionToastMessage(newState ? 'Protection Enabled' : 'Protection Paused');
        setShowProtectionToast(true);
        setTimeout(() => setShowProtectionToast(false), 3000);

        // Stryker disable next-line all: logging only
        logger.info('Popup', 'Protection toggled', { enabled: newState });
      }
    } catch (error) {
      clearTimeout(timeout);
      const err = toError(error);
      const errorMessage = err.message;
      if (errorMessage.includes('Could not establish connection') ||
          errorMessage.includes('Receiving end does not exist')) {
        // Stryker disable next-line all: logging only
        logger.debug('Popup', 'Service worker not ready for toggle');
      } else {
        logger.error('Popup', 'Failed to toggle protection', err);
      }
    } finally {
      setIsTogglingProtection(false);
    }
  };

  const toggleExpanded = (alertId: string) => {
    setExpandedAlerts((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(alertId)) {
        newSet.delete(alertId);
      } else {
        newSet.add(alertId);
      }
      return newSet;
    });
  };

  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    tab: 'dashboard' | 'burner'
  ) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft' && event.key !== 'Home' && event.key !== 'End') {
      return;
    }

    event.preventDefault();

    if (event.key === 'Home') {
      setActiveTab('dashboard');
      return;
    }

    if (event.key === 'End') {
      setActiveTab('burner');
      return;
    }

    const currentIndex = tabs.indexOf(tab);
    const step = event.key === 'ArrowRight' ? 1 : -1;
    const nextIndex = (currentIndex + step + tabs.length) % tabs.length;
    setActiveTab(tabs[nextIndex]);
  };

  const handleFeedbackSuccess = () => {
    setShowSuccessBanner(true);
    setTimeout(() => setShowSuccessBanner(false), 3000);
  };

  /**
   * Opens the settings modal to the feedback tab with alert context so the user can report violations.
   */
  const openReportDialog = (alert: AlertType) => {
    setReportingAlert(alert);
    setSettingsDeepLink('feedback');
    setShowSettings(true);
  };

  const isValidWebPage = currentTab?.url &&
    (currentTab.url.startsWith('http://') || currentTab.url.startsWith('https://'));
  const isPopupExtensionPage =
    Boolean(currentTab?.url) && Boolean(currentTab?.url?.startsWith(chrome.runtime.getURL('src/popup/popup.html')));
  const shouldAllowStandaloneSettings = isOnboardingBurnerRedirect && isPopupExtensionPage;

  useEffect(() => {
    if (!shouldAllowStandaloneSettings) {
      return;
    }

    const previousInlineStyles = {
      width: document.body.style.width,
      minHeight: document.body.style.minHeight,
      maxHeight: document.body.style.maxHeight,
      overflow: document.body.style.overflow,
    };

    document.body.style.width = '100%';
    document.body.style.minHeight = '100vh';
    document.body.style.maxHeight = 'none';
    document.body.style.overflow = 'auto';

    return () => {
      document.body.style.width = previousInlineStyles.width;
      document.body.style.minHeight = previousInlineStyles.minHeight;
      document.body.style.maxHeight = previousInlineStyles.maxHeight;
      document.body.style.overflow = previousInlineStyles.overflow;
    };
  }, [shouldAllowStandaloneSettings]);

  if (loading || !data) {
    return (
      <div className="w-full h-[500px] flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <Activity className="w-6 h-6 animate-spin text-blue-600 dark:text-blue-400" />
      </div>
    );
  }

  if (shouldAllowStandaloneSettings) {
    return (
      <div className="w-full min-h-screen bg-gray-100 dark:bg-gray-900">
        <ReportableSettingsPage
          isOpen={true}
          onClose={() => window.close()}
          currentTab={currentTab}
          onFeedbackSuccess={handleFeedbackSuccess}
          deepLinkSection="burner-services"
          highlightBurnerToggle={true}
          onBurnerHighlightComplete={undefined}
          reportContext={null}
          onReportClear={undefined}
          standalone={true}
        />
      </div>
    );
  }

  if (!isValidWebPage && !shouldAllowStandaloneSettings) {
    return (
      <div className="w-full h-[500px] flex flex-col bg-white dark:bg-gray-900">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <h1 className="text-lg font-bold text-gray-900 dark:text-white">Privaseer</h1>
          </div>
          <button
            onClick={() => setShowSettings(true)}
            className="p-2 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white transition-colors"
            title="Settings"
            aria-label="Open settings"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-8 flex flex-col items-center justify-center flex-1">
          <div className="w-16 h-16 bg-blue-50 dark:bg-blue-900/30 rounded-full flex items-center justify-center mb-4">
            <Shield className="w-8 h-8 text-blue-600 dark:text-blue-400" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Welcome</h3>
          <p className="text-sm text-gray-600 dark:text-gray-400 text-center max-w-xs mb-6">
            Open this extension on a website to see privacy insights and tracker blocking.
          </p>
          <div className="text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 px-4 py-2 rounded-lg">
            Navigate to any http:// or https:// website
          </div>
        </div>

        {showSettings && (
          <ReportableSettingsPage
            isOpen={showSettings}
            onClose={() => setShowSettings(false)}
            currentTab={currentTab}
            onFeedbackSuccess={handleFeedbackSuccess}
          />
        )}

        {showSuccessBanner && (
          <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-50 animate-fade-in">
            <div className="bg-gradient-to-r from-green-500 to-emerald-600 text-white px-6 py-3 rounded-lg shadow-2xl flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5" />
              <div>
                <p className="font-semibold text-sm">Feedback Submitted!</p>
                <p className="text-xs text-green-100">Thank you for helping us improve</p>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  const creditScore = data.creditScore ?? null;
  const currentCreditScore = creditScore?.score ?? CREDIT_SCORE.BASE;
  
  // Background color based on credit score
  const getScoreBg = (score: number) => {
    if (score >= CREDIT_SCORE.LABELS.EXCELLENT) return 'bg-gradient-to-br from-emerald-50 to-green-50 dark:from-gray-900 dark:to-gray-800';
    if (score >= CREDIT_SCORE.LABELS.GOOD) return 'bg-gradient-to-br from-green-50 to-lime-50 dark:from-gray-900 dark:to-gray-800';
    if (score >= CREDIT_SCORE.LABELS.FAIR) return 'bg-gradient-to-br from-amber-50 to-yellow-50 dark:from-gray-900 dark:to-gray-800';
    if (score >= CREDIT_SCORE.LABELS.POOR) return 'bg-gradient-to-br from-orange-50 to-amber-50 dark:from-gray-900 dark:to-gray-800';
    return 'bg-gradient-to-br from-red-50 to-orange-50 dark:from-gray-900 dark:to-gray-800';
  };
  const scoreBg = getScoreBg(currentCreditScore);

  return (
    <div className="w-full h-[600px] flex flex-col bg-white dark:bg-gray-900">
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <h1 className="text-lg font-bold text-gray-900 dark:text-white">Privaseer</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSettings(true)}
              className="p-2 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white transition-colors"
              title="Settings"
              aria-label="Open settings"
            >
              <Settings className="w-4 h-4" />
            </button>
            <button
              onClick={toggleProtection}
              disabled={isTogglingProtection}
              role="switch"
              aria-checked={data.settings.protectionEnabled}
              aria-label="Toggle tracker protection"
              className={`p-2 rounded-lg transition-colors ${
                isTogglingProtection
                  ? 'bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed'
                  : data.settings.protectionEnabled
                  ? 'bg-blue-600 dark:bg-blue-500 text-white hover:bg-blue-700 dark:hover:bg-blue-600'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-300 dark:hover:bg-gray-600'
              }`}
              title={isTogglingProtection ? 'Processing...' : data.settings.protectionEnabled ? 'Protection Enabled' : 'Protection Paused'}
            >
              {isTogglingProtection ? (
                <Activity className="w-4 h-4 animate-spin" />
              ) : data.settings.protectionEnabled ? (
                <Shield className="w-4 h-4" />
              ) : (
                <ShieldOff className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>

        <div className="flex gap-2 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg" role="tablist" aria-label="Main navigation">
          <button
            id="tab-dashboard"
            role="tab"
            aria-selected={activeTab === 'dashboard'}
            aria-controls="panel-dashboard"
            onClick={() => setActiveTab('dashboard')}
            onKeyDown={(event) => handleTabKeyDown(event, 'dashboard')}
            className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-all ${
              activeTab === 'dashboard'
                ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            <div className="flex items-center justify-center gap-2">
              <Activity className="w-4 h-4" />
              <span>Dashboard</span>
            </div>
          </button>
          <button
            id="tab-burner"
            role="tab"
            aria-selected={activeTab === 'burner'}
            aria-controls="panel-burner"
            onClick={() => setActiveTab('burner')}
            onKeyDown={(event) => handleTabKeyDown(event, 'burner')}
            className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-all ${
              activeTab === 'burner'
                ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            <div className="flex items-center justify-center gap-2">
              <Mail className="w-4 h-4" />
              <span>Burner Emails</span>
            </div>
          </button>
        </div>
      </div>

      {!onboardingState?.hasCompletedOnboarding && (
        <div className="mx-6 mt-4 flex items-center justify-between rounded-lg border border-sky-100 bg-sky-50 px-4 py-3 text-sm text-sky-900 shadow-sm dark:border-sky-900/50 dark:bg-sky-900/30 dark:text-sky-100">
          <div>
            <p className="font-semibold">Complete setup</p>
            <p className="text-xs text-sky-700 dark:text-sky-300">
              Finish the 2-minute welcome tour to unlock tips and shortcuts.
            </p>
          </div>
          <button
            onClick={openWelcomeGuide}
            className="rounded-md bg-sky-600 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white shadow hover:bg-sky-500"
          >
            Resume
          </button>
        </div>
      )}

      {activeTab === 'burner' && (
        <div
          className="flex-1 overflow-y-auto"
          role="tabpanel"
          id="panel-burner"
          aria-labelledby="tab-burner"
        >
          <BurnerEmailsSection 
            onOpenSettings={openSettingsToBurner}
            isActive={true}
          />
        </div>
      )}
      {activeTab === 'dashboard' && (
        <div role="tabpanel" id="panel-dashboard" aria-labelledby="tab-dashboard" className="flex-1 flex flex-col min-h-0">
      <div className={`px-6 py-5 ${scoreBg} border-b border-gray-200 dark:border-gray-700`}>
        <CreditScoreMeter creditScore={creditScore} dailyTrackersBlocked={data.privacyScore.daily.trackersBlocked} cleanSitesVisited={data.privacyScore.daily.cleanSitesVisited} />

        {/* Stats Row */}
        <div className="mt-4 flex items-center justify-center gap-6 text-sm">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm">
            <Shield className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <span className="font-semibold text-gray-900 dark:text-white">{data.privacyScore.daily.trackersBlocked}</span>
            <span className="text-gray-600 dark:text-gray-400">prevented today</span>
          </div>
          {data.privacyScore.daily.cleanSitesVisited > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm">
              <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400" />
              <span className="font-semibold text-gray-900 dark:text-white">{data.privacyScore.daily.cleanSitesVisited}</span>
              <span className="text-gray-600 dark:text-gray-400">safe sites</span>
            </div>
          )}
        </div>

        <div className="mt-4 rounded-xl border border-white/70 dark:border-gray-700 bg-white/70 dark:bg-gray-900/40 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">Aggregated Analytics</p>
            <div className="flex items-center gap-1 rounded-lg bg-gray-100 dark:bg-gray-800 p-1">
              {(['week', 'month', 'all-time'] as const).map((period) => (
                <button
                  key={period}
                  onClick={() => setMetricsPeriod(period)}
                  className={`px-2 py-1 text-[11px] rounded-md transition-colors ${
                    metricsPeriod === period
                      ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400'
                      : 'text-gray-600 dark:text-gray-400'
                  }`}
                >
                  {period === 'week' ? 'Week' : period === 'month' ? 'Month' : 'All-time'}
                </button>
              ))}
            </div>
          </div>

          {isLoadingAggregation ? (
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">Loading analytics...</p>
          ) : metricsAggregation ? (
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg bg-gray-50 dark:bg-gray-800 p-2">
                <p className="text-gray-500 dark:text-gray-400">Trackers Prevented</p>
                <p className="font-semibold text-gray-900 dark:text-white">{metricsAggregation.totalTrackersBlocked}</p>
              </div>
              <div className="rounded-lg bg-gray-50 dark:bg-gray-800 p-2">
                <p className="text-gray-500 dark:text-gray-400">Average Privacy Score</p>
                <p className="font-semibold text-gray-900 dark:text-white">{metricsAggregation.averagePrivacyScore}</p>
              </div>
              <div className="rounded-lg bg-gray-50 dark:bg-gray-800 p-2">
                <p className="text-gray-500 dark:text-gray-400">Safe vs Risky Sites</p>
                <p className="font-semibold text-gray-900 dark:text-white">
                  {metricsAggregation.cleanSitesVisited} / {metricsAggregation.nonCompliantSites}
                </p>
              </div>
              <div className="rounded-lg bg-gray-50 dark:bg-gray-800 p-2">
                <p className="text-gray-500 dark:text-gray-400">Risky Categories</p>
                <p className="font-semibold text-gray-900 dark:text-white">
                  {Object.entries(metricsAggregation.trackersByCategory)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 2)
                    .map(([category]) => category)
                    .join(', ') || 'No risky activity detected yet'}
                </p>
              </div>
            </div>
          ) : (
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              Start browsing to build your analytics. We'll show trends once we have data.
            </p>
          )}
        </div>

        {/* Consent Activity Section */}
        {currentTab?.url && (currentTab.url.startsWith('http://') || currentTab.url.startsWith('https://')) && (
          <div className="mt-4 rounded-xl border border-white/70 dark:border-gray-700 bg-white/70 dark:bg-gray-900/40 p-3">
            <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">Consent Activity (This Site)</p>
            <div className="flex items-center justify-between bg-gray-50 dark:bg-gray-800 rounded-lg p-2 text-xs">
              <div>
                <p className="text-gray-500 dark:text-gray-400">Last Action</p>
                <p className={`font-semibold ${consentAction?.action === 'Rejected' ? 'text-blue-600 dark:text-blue-400' : consentAction?.action === 'Accepted' ? 'text-green-600 dark:text-green-400' : 'text-gray-600 dark:text-gray-400'}`}>
                  {consentAction ? consentAction.action : 'Unknown'}
                </p>
              </div>
              <div>
                <p className="text-gray-500 dark:text-gray-400">Violations</p>
                {(() => {
                  try {
                    const domain = new URL(currentTab.url).hostname;
                    const siteViolations = data.alerts.filter(a => a.type === 'post_consent_violation' && a.domain === domain).length;
                    return (
                      <p className={`font-semibold ${siteViolations > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                        {siteViolations}
                      </p>
                    );
                  } catch (e) {
                    return <p className="font-semibold text-gray-600">0</p>;
                  }
                })()}
              </div>
              <div>
                <p className="text-gray-500 dark:text-gray-400">Last Event</p>
                <p className="font-semibold text-gray-900 dark:text-white">
                  {consentAction?.timestamp ? new Date(consentAction.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-'}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="px-6 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Recent Activity</h2>
          {data.alerts.length > 0 && (
            <button
              onClick={async () => {
                try {
                  await chrome.runtime.sendMessage({ type: 'CLEAR_ALERTS' });
                  await loadData();
                } catch (error) {
                  logger.error('Popup', 'Failed to clear alerts', toError(error));
                }
              }}
              className="text-xs text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 font-medium transition-colors"
              aria-label="Clear all alerts"
            >
              Clear All
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto" role="list" aria-label="Recent privacy alerts">
          {data.alerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400 dark:text-gray-500 px-6 text-center">
              <CheckCircle2 className="w-12 h-12 mb-3" />
              <p className="text-sm font-medium">Start browsing to see your privacy insights</p>
              <p className="text-xs mt-1">Great start! We'll track your privacy health as you browse.</p>
            </div>
          ) : (
            data.alerts.map((alert) => (
                <AlertItem
                key={alert.id}
                alert={alert}
                isExpanded={expandedAlerts.has(alert.id)}
                  onToggleExpanded={() => toggleExpanded(alert.id)}
                  onReport={openReportDialog}
                  falsePositiveStatus={falsePositiveStatuses[normalizeDomain(alert.domain)]}
              />
            ))
          )}
        </div>
      </div>
        </div>
      )}

      {showSettings && (
        <ReportableSettingsPage
          isOpen={showSettings}
          onClose={() => {
            setShowSettings(false);
            setSettingsDeepLink(null);
            setHighlightBurnerToggle(false);
            setReportingAlert(null);
          }}
          currentTab={currentTab}
          onFeedbackSuccess={handleFeedbackSuccess}
          deepLinkSection={settingsDeepLink}
          highlightBurnerToggle={highlightBurnerToggle}
          onBurnerHighlightComplete={() => {
            setHighlightBurnerToggle(false);
            setSettingsDeepLink(null);
          }}
          reportContext={reportingAlert}
          onReportClear={() => setReportingAlert(null)}
        />
      )}

      {showSuccessBanner && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-50 animate-fade-in">
          <div className="bg-gradient-to-r from-green-500 to-emerald-600 text-white px-6 py-3 rounded-lg shadow-2xl flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5" />
            <div>
              <p className="font-semibold text-sm">Feedback Submitted!</p>
              <p className="text-xs text-green-100">Thank you for helping us improve</p>
            </div>
          </div>
        </div>
      )}

      {showProtectionToast && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-50 animate-fade-in">
          <div className={`${protectionToastState ? 'bg-gradient-to-r from-blue-500 to-blue-600' : 'bg-gradient-to-r from-gray-500 to-gray-600'} text-white px-6 py-3 rounded-lg shadow-2xl flex items-center gap-3`}>
            {protectionToastState ? (
              <Shield className="w-5 h-5" />
            ) : (
              <ShieldOff className="w-5 h-5" />
            )}
            <div>
              <p className="font-semibold text-sm">{protectionToastMessage}</p>
              <p className="text-xs opacity-90">
                {protectionToastState ? 'Trackers are now being blocked' : 'Trackers are not being blocked'}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function AlertItem({
  alert,
  isExpanded,
  onToggleExpanded,
  onReport,
  falsePositiveStatus,
}: {
  alert: AlertType;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onReport: (alert: AlertType) => void;
  falsePositiveStatus?: FalsePositiveStatus;
}) {
  const [trackerInfo, setTrackerInfo] = useState<{ description: string; alternative: string } | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [reportStatus, setReportStatus] = useState<'idle' | 'sending' | 'sent' | 'already_reported' | 'error'>('idle');
  const [reportReason, setReportReason] = useState<FalsePositiveReason>('wrong_detection');
  const [customReason, setCustomReason] = useState('');
  const [reportCount, setReportCount] = useState<number>(falsePositiveStatus?.reportCount ?? 0);

  const getSeverityIcon = () => {
    switch (alert.severity) {
      case 'high':
        return <div className="w-2 h-2 rounded-full bg-red-500" />;
      case 'medium':
        return <div className="w-2 h-2 rounded-full bg-amber-500" />;
      default:
        return <div className="w-2 h-2 rounded-full bg-green-500" />;
    }
  };

  const getTypeIcon = () => {
    switch (alert.type) {
      case 'high_risk':
        return <AlertTriangle className="w-4 h-4 text-red-600" />;
      case 'non_compliant_site':
        return <XCircle className="w-4 h-4 text-amber-600" />;
      case 'post_consent_violation':
        return <AlertTriangle className="w-4 h-4 text-red-600" />;
      default:
        return <Shield className="w-4 h-4 text-blue-600" />;
    }
  };

  const timeAgo = (timestamp: number) => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  };

  const loadTrackerInfo = async () => {
    if (trackerInfo) {
      onToggleExpanded();
      return;
    }

    setLoadingInfo(true);
    try {
      const trackerDomain = alert.message.replace('Blocked ', '').trim();
      const response = await chrome.runtime.sendMessage({
        type: 'GET_TRACKER_INFO',
        data: { domain: trackerDomain }
      });

      if (response.success && response.info) {
        setTrackerInfo(response.info);
        onToggleExpanded();
      }
    } catch (error) {
      logger.error('Popup', 'Failed to load tracker info', toError(error));
    } finally {
      setLoadingInfo(false);
    }
  };

  const isTrackerAlert = alert.type === 'tracker_blocked' || alert.type === 'high_risk';
  const isCookieBannerAlert = alert.type === 'non_compliant_site';
  const isPostConsentViolation = alert.type === 'post_consent_violation';
  const isFeedbackReportable = isPostConsentViolation;
  const isFalsePositiveReportable = isCookieBannerAlert;
  const hasBannerDetails = isCookieBannerAlert && Boolean(alert.deceptivePatterns?.length);
  const hasViolationDetails = isPostConsentViolation && Boolean(alert.blockedTrackers?.length);

  const handleAlertClick = () => {
    if (isTrackerAlert) {
      loadTrackerInfo();
    } else if (hasBannerDetails || hasViolationDetails) {
      onToggleExpanded();
    }
  };

  const handleAlertKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleAlertClick();
    }
  };

  const hasExpandableInfo = isTrackerAlert || hasBannerDetails || hasViolationDetails;
  const alertToggleLabel = isExpanded ? 'Collapse alert details' : 'Expand alert details';
  const userAlreadyReported = reportStatus === 'already_reported' || reportStatus === 'sent' || Boolean(falsePositiveStatus?.userReported);
  const communityCount = Math.max(reportCount, falsePositiveStatus?.reportCount ?? 0);
  const communityLabel = userAlreadyReported && communityCount > 1
    ? `You and ${communityCount - 1} others reported this`
    : userAlreadyReported
      ? 'You reported this'
      : communityCount > 0
        ? `Reported by ${communityCount} users`
        : null;

  useEffect(() => {
    if (falsePositiveStatus?.userReported) {
      setReportStatus('already_reported');
    }
    if (typeof falsePositiveStatus?.reportCount === 'number') {
      setReportCount(falsePositiveStatus.reportCount);
    }
  }, [falsePositiveStatus]);

  const handleFalsePositiveReport = async () => {
    if (reportStatus === 'sending' || reportStatus === 'sent' || reportStatus === 'already_reported') return;
    setReportStatus('sending');

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'REPORT_FALSE_POSITIVE',
        data: {
          domain: alert.domain,
          url: alert.url || '',
          detectedPatterns: alert.deceptivePatterns || [],
          reason: reportReason,
          userReason: reportReason === 'other' ? customReason.trim() : undefined,
          timestamp: Date.now(),
          installationId: '',
          scanConfidence: alert.scanConfidence ?? 0,
        },
      });

      if (response?.alreadyReported) {
        setReportStatus('already_reported');
        if (typeof response.reportCount === 'number') {
          setReportCount(response.reportCount);
        }
        return;
      }

      if (response?.success) {
        setReportStatus('sent');
        if (typeof response.reportCount === 'number') {
          setReportCount(response.reportCount);
        }
      } else {
        setReportStatus('error');
      }
    } catch (error) {
      logger.error('Popup', 'Failed to report false positive', toError(error));
      setReportStatus('error');
    }
  };

  return (
    <div className="hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors border-b border-gray-100 dark:border-gray-700" role="listitem">
      <div
        className="px-6 py-3 cursor-pointer"
        onClick={handleAlertClick}
        role="button"
        tabIndex={0}
        onKeyDown={handleAlertKeyDown}
        aria-expanded={hasExpandableInfo ? isExpanded : undefined}
        aria-label={`${alert.message} from ${alert.domain}. ${hasExpandableInfo ? alertToggleLabel : ''}`.trim()}
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5">{getSeverityIcon()}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start gap-2 mb-1">
              <div className="mt-0.5">{getTypeIcon()}</div>
              <span className={`text-xs font-medium text-gray-900 dark:text-gray-100 flex-1 ${isExpanded ? '' : 'truncate'}`}>
                {alert.message}
              </span>
              {hasExpandableInfo && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleAlertClick();
                  }}
                  className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors flex-shrink-0"
                  aria-label={alertToggleLabel}
                  title={
                    isTrackerAlert
                      ? 'Show tracker info'
                      : isPostConsentViolation
                        ? 'Show violation details'
                        : 'Show banner details'
                  }
                  disabled={loadingInfo}
                >
                  {loadingInfo ? (
                    <Activity className="w-3 h-3 animate-spin text-gray-400" />
                  ) : (
                    <Info className="w-3 h-3 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400" />
                  )}
                </button>
              )}
              {isFeedbackReportable && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onReport(alert);
                  }}
                  className="text-xs text-red-600 dark:text-red-400 hover:underline font-medium ml-2"
                  aria-label="Report privacy issue"
                >
                  Report
                </button>
              )}
              {isFalsePositiveReportable && (
                <div className="ml-2 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                  {(reportStatus === 'sent' || reportStatus === 'already_reported') ? (
                    <span className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">
                      {reportStatus === 'already_reported' ? 'Already reported' : 'Reported'}
                    </span>
                  ) : (
                    <>
                      <select
                        value={reportReason}
                        onChange={(event) => setReportReason(event.target.value as FalsePositiveReason)}
                        className="text-xs rounded border border-amber-200 dark:border-amber-700 bg-white dark:bg-gray-800 text-amber-800 dark:text-amber-300 px-1.5 py-0.5"
                        aria-label="False positive reason"
                      >
                        <option value="wrong_detection">Wrong detection</option>
                        <option value="banner_compliant">Banner is compliant</option>
                        <option value="no_banner_present">No banner present</option>
                        <option value="other">Other</option>
                      </select>
                      <button
                        onClick={() => {
                          void handleFalsePositiveReport();
                        }}
                        className="text-xs text-amber-700 dark:text-amber-400 hover:underline font-medium"
                        aria-label="Report false positive"
                        disabled={reportStatus === 'sending' || (reportReason === 'other' && !customReason.trim())}
                      >
                        {reportStatus === 'sending' ? 'Reporting...' : 'Report'}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
            {isFalsePositiveReportable && reportReason === 'other' && reportStatus !== 'sent' && reportStatus !== 'already_reported' && (
              <div className="mt-2">
                <input
                  type="text"
                  value={customReason}
                  onChange={(event) => setCustomReason(event.target.value)}
                  onClick={(event) => event.stopPropagation()}
                  className="w-full text-xs rounded border border-amber-200 dark:border-amber-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 px-2 py-1"
                  placeholder="Tell us what was incorrect"
                  maxLength={200}
                  aria-label="Custom false positive reason"
                />
              </div>
            )}
            {isFalsePositiveReportable && communityLabel && (
              <div className="mt-1">
                <span className="inline-flex items-center rounded-full bg-amber-100 dark:bg-amber-900/30 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:text-amber-300">
                  {communityLabel}
                </span>
              </div>
            )}
            <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
              <span className="truncate">{alert.domain}</span>
              <span className="ml-2 whitespace-nowrap">{timeAgo(alert.timestamp)}</span>
            </div>
          </div>
        </div>
      </div>

      {isExpanded && trackerInfo && isTrackerAlert && (
        <div className="px-6 pb-3">
          <div className="ml-5 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg text-xs">
            <div className="mb-2">
              <span className="font-semibold text-blue-900 dark:text-blue-300">What it does: </span>
              <span className="text-blue-800 dark:text-blue-400">{trackerInfo.description}</span>
            </div>
            <div>
              <span className="font-semibold text-blue-900 dark:text-blue-300">Alternative: </span>
              <span className="text-blue-800 dark:text-blue-400">{trackerInfo.alternative}</span>
            </div>
          </div>
        </div>
      )}

      {isExpanded && isCookieBannerAlert && alert.deceptivePatterns && alert.deceptivePatterns.length > 0 && (
        <div className="px-6 pb-3">
          <div className="ml-5 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg text-xs">
            <div className="mb-2">
              <span className="font-semibold text-amber-900 dark:text-amber-300">Banner observations:</span>
            </div>
            <ul className="space-y-1 text-amber-800 dark:text-amber-400">
              {alert.deceptivePatterns.map((pattern, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <span className="text-amber-600 dark:text-amber-500 mt-0.5">•</span>
                  <span>
                    {pattern === 'forcedConsent' && 'Limited consent options available'}
                    {pattern === 'acceptButtonProminence' && 'Accept option appears more prominent than reject'}
                    {pattern === 'hiddenRejectButton' && 'Reject option may require scrolling'}
                    {pattern === 'preCheckedBoxes' && 'Some options are pre-selected'}
                    {!['forcedConsent', 'acceptButtonProminence', 'hiddenRejectButton', 'preCheckedBoxes'].includes(pattern) &&
                      'Potential banner issue detected'}
                  </span>
                </li>
              ))}
            </ul>
            {alert.url && (
              <div className="mt-2 pt-2 border-t border-amber-200 dark:border-amber-800">
                <span className="font-semibold text-amber-900 dark:text-amber-300">URL: </span>
                <span className="text-amber-800 dark:text-amber-400 break-all">{alert.url}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {isExpanded && hasViolationDetails && alert.blockedTrackers && (
        <div className="px-6 pb-3">
          <div className="ml-5 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-xs">
            <div className="mb-2">
              <span className="font-semibold text-red-900 dark:text-red-300">Potential privacy issue</span>
            </div>
            <p className="text-red-800 dark:text-red-400 mb-2">
              This site loaded trackers after you denied consent.
            </p>
            <div className="mt-2">
              <span className="font-semibold text-red-900 dark:text-red-300">Trackers loaded:</span>
              <ul className="mt-1 space-y-1 text-red-800 dark:text-red-400">
                {alert.blockedTrackers.map((tracker, idx) => (
                  <li key={`${tracker}-${idx}`} className="flex items-start gap-2">
                    <span className="text-red-600 dark:text-red-500 mt-0.5">•</span>
                    <span>{tracker}</span>
                  </li>
                ))}
              </ul>
            </div>
            {typeof alert.trackerCount === 'number' && (
              <div className="mt-2 text-red-900 dark:text-red-300">
                Total trackers detected after denial: <span className="font-semibold">{alert.trackerCount}</span>
              </div>
            )}
            {alert.url && (
              <div className="mt-2 pt-2 border-t border-red-200 dark:border-red-800">
                <span className="font-semibold text-red-900 dark:text-red-300">URL: </span>
                <span className="text-red-800 dark:text-red-400 break-all">{alert.url}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<Popup />);
}
