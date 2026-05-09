import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { AllSettingsResponse } from '../types';
import { ONBOARDING } from '../utils/constants';
import { logger } from '../utils/logger';
import { toError } from '../utils/type-guards';
import '../index.css';
import { StepIndicator } from './components/StepIndicator';
import { NavigationButtons } from './components/NavigationButtons';
import { WelcomeStep } from './steps/WelcomeStep';
import { ProtectionStep } from './steps/ProtectionStep';
import { PrivacyCreditStep } from './steps/PrivacyCreditStep';
import { ConsentScannerStep } from './steps/ConsentScannerStep';
import { BurnerEmailStep } from './steps/BurnerEmailStep';
import { CompletionStep } from './steps/CompletionStep';
import type { StepContentProps } from './steps/types';

export type Theme = 'light' | 'dark';
type StepId =
  | 'welcome'
  | 'protection'
  | 'privacy-credit'
  | 'consent'
  | 'burner-email'
  | 'completion';

interface StepDefinition {
  id: StepId;
  label: string;
  Component: (props: StepContentProps) => JSX.Element;
  primaryLabel?: string;
  showSkip?: boolean;
  condition?: (ctx: OnboardingContext) => boolean;
}

interface ActiveStepDefinition extends StepDefinition {
  originalIndex: number;
}

interface OnboardingContext {
  protectionEnabled: boolean;
  burnerEmailEnabled: boolean;
  hasRealEmail: boolean;
  hasCreditScore: boolean;
}

const steps: StepDefinition[] = [
  { id: 'welcome', label: 'Welcome', Component: WelcomeStep, primaryLabel: 'Get started' },
  { id: 'protection', label: 'Protection', Component: ProtectionStep },
  { id: 'privacy-credit', label: 'Privacy Credit', Component: PrivacyCreditStep },
  { id: 'consent', label: 'Consent Scanner', Component: ConsentScannerStep },
  {
    id: 'burner-email',
    label: 'Burner Email',
    Component: BurnerEmailStep,
    condition: ({ burnerEmailEnabled, hasRealEmail }) => !burnerEmailEnabled || !hasRealEmail,
  },
  {
    id: 'completion',
    label: 'Finish',
    Component: CompletionStep,
    primaryLabel: 'Finish',
    showSkip: false,
  },
];

const POPUP_PAGE_PATH = 'src/popup/popup.html?source=onboarding&section=burner-services';
const DEMO_SCAN_URL = 'https://www.bbc.com';

function buildActiveSteps(context: OnboardingContext): ActiveStepDefinition[] {
  return steps
    .map((step, index) => ({ ...step, originalIndex: index }))
    .filter((step) => (step.condition ? step.condition(context) : true));
}

function WelcomeApp(): JSX.Element {
  const [themePreference, setThemePreference] = useState<'light' | 'dark' | 'system'>('system');
  const [resolvedTheme, setResolvedTheme] = useState<Theme>('dark');
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [emailConfigured, setEmailConfigured] = useState(false);
  const [trackerCount, setTrackerCount] = useState(0);
  const [creditScore, setCreditScore] = useState<number | null>(null);
  const [context, setContext] = useState<OnboardingContext>({
    protectionEnabled: true,
    burnerEmailEnabled: false,
    hasRealEmail: false,
    hasCreditScore: false,
  });
  const stepEnteredAtRef = useRef<number>(Date.now());
  const currentStepRef = useRef(0);
  const activeStepsRef = useRef<ActiveStepDefinition[]>([]);
  const hasExitedFlowRef = useRef(false);

  const activeSteps = useMemo(() => buildActiveSteps(context), [context]);
  const totalSteps = activeSteps.length;

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');

    const applyTheme = (preference: 'light' | 'dark' | 'system', matches: boolean) => {
      const nextTheme = preference === 'system' ? (matches ? 'dark' : 'light') : preference;
      setResolvedTheme(nextTheme);
      document.documentElement.classList.toggle('dark', nextTheme === 'dark');
    };

    applyTheme(themePreference, media.matches);

    const listener = (event: MediaQueryListEvent) => {
      if (themePreference === 'system') {
        applyTheme('system', event.matches);
      }
    };

    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [themePreference]);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const [onboardingResponse, settingsResponse, stateResponse, creditScoreResponse] = await Promise.all([
          chrome.runtime.sendMessage({ type: 'GET_ONBOARDING_STATE' }),
          chrome.runtime.sendMessage({ type: 'GET_ALL_SETTINGS' }) as Promise<{
            success: boolean;
            settings: AllSettingsResponse;
          }>,
          chrome.runtime.sendMessage({ type: 'GET_STATE' }) as Promise<{
            success: boolean;
            data?: {
              privacyScore?: { daily?: { trackersBlocked?: number } };
              settings?: { protectionEnabled?: boolean; burnerEmailEnabled?: boolean };
              realEmail?: string | null;
              creditScore?: { score?: number };
            };
          }>,
          chrome.runtime.sendMessage({ type: 'GET_CREDIT_SCORE' }) as Promise<{
            success: boolean;
            creditScore?: number | { score?: number };
          }>,
        ]);

        const settings = settingsResponse?.success ? settingsResponse.settings : undefined;
        const rawCreditScore = creditScoreResponse?.success
          ? typeof creditScoreResponse.creditScore === 'number'
            ? creditScoreResponse.creditScore
            : creditScoreResponse.creditScore?.score
          : undefined;
        const resolvedCreditScore =
          typeof rawCreditScore === 'number'
            ? rawCreditScore
            : stateResponse?.data?.creditScore?.score;
        const resolvedTrackerCount = stateResponse?.data?.privacyScore?.daily?.trackersBlocked ?? 0;
        const hasRealEmail = Boolean(settings?.realEmail ?? stateResponse?.data?.realEmail);
        const protectionEnabled = stateResponse?.data?.settings?.protectionEnabled ?? true;
        const burnerEmailEnabled =
          settings?.burnerEmailEnabled ??
          stateResponse?.data?.settings?.burnerEmailEnabled ??
          false;

        setTrackerCount(resolvedTrackerCount);
        setCreditScore(typeof resolvedCreditScore === 'number' ? resolvedCreditScore : null);
        setContext({
          protectionEnabled,
          burnerEmailEnabled,
          hasRealEmail,
          hasCreditScore: typeof resolvedCreditScore === 'number',
        });

        const nextActiveSteps = buildActiveSteps({
          protectionEnabled,
          burnerEmailEnabled,
          hasRealEmail,
          hasCreditScore: typeof resolvedCreditScore === 'number',
        });

        if (onboardingResponse?.success && onboardingResponse.onboarding) {
          const currentOriginalStep = Math.max(0, onboardingResponse.onboarding.currentStep ?? 0);
          const resolvedStepIndex = nextActiveSteps.findIndex(
            (step) => step.originalIndex === currentOriginalStep
          );
          const clampedStep = Math.min(
            Math.max(nextActiveSteps.length - 1, 0),
            resolvedStepIndex === -1 ? 0 : resolvedStepIndex
          );
          setCurrentStep(clampedStep);
          currentStepRef.current = clampedStep;
          stepEnteredAtRef.current = Date.now();

          const emailAlreadyConfigured =
            Boolean(onboardingResponse.onboarding.emailConfigured) || hasRealEmail;
          setEmailConfigured(emailAlreadyConfigured);

          if (!onboardingResponse.onboarding.startedAt) {
            void chrome.runtime.sendMessage({
              type: 'TRACK_EVENT',
              data: {
                eventType: ONBOARDING.EVENTS.STARTED,
                eventData: {
                  source: 'welcome_flow',
                  stepId: nextActiveSteps[clampedStep]?.id ?? 'welcome',
                },
              },
            });
          }
        }

        if (settings) {
          setEmailConfigured((prev) => prev || Boolean(settings.realEmail));
          setThemePreference(settings.theme ?? 'system');
        }
      } catch (err) {
        const errorObj = toError(err);
        setError(errorObj.message);
        logger.error('Welcome', 'Failed to load initial data', errorObj);
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  useEffect(() => {
    activeStepsRef.current = activeSteps;
    if (activeSteps.length === 0) {
      return;
    }
    if (currentStep > activeSteps.length - 1) {
      const clamped = activeSteps.length - 1;
      setCurrentStep(clamped);
      currentStepRef.current = clamped;
    }
  }, [activeSteps, currentStep]);

  useEffect(() => {
    currentStepRef.current = currentStep;
  }, [currentStep]);

  const goToStep = useCallback(
    async (nextStep: number) => {
      const clamped = Math.max(0, Math.min(totalSteps - 1, nextStep));
      const previousStepDefinition = activeSteps[currentStep];
      const nextStepDefinition = activeSteps[clamped];
      if (!nextStepDefinition) {
        return;
      }

      const exitedAt = Date.now();
      const durationMs = Math.max(0, exitedAt - stepEnteredAtRef.current);
      stepEnteredAtRef.current = exitedAt;
      setCurrentStep(clamped);
      try {
        await chrome.runtime.sendMessage({
          type: 'SET_ONBOARDING_STEP',
          data: {
            step: nextStepDefinition.originalIndex,
            stepId: nextStepDefinition.id,
            previousStepId: previousStepDefinition?.id,
            enteredAt: exitedAt,
            exitedAt,
            durationMs,
          },
        });
      } catch (err) {
        logger.warn('Welcome', 'Failed to persist onboarding step', toError(err));
      }
    },
    [activeSteps, currentStep, totalSteps]
  );

  const completeOnboarding = useCallback(
    async (skip = false, reason: 'skipped' | 'abandoned' = 'skipped') => {
      const activeStep = activeSteps[currentStep];
      try {
        if (skip) {
          await chrome.runtime.sendMessage({
            type: 'SKIP_ONBOARDING',
            data: { atStep: activeStep?.originalIndex ?? currentStep, reason },
          });
        } else {
          await chrome.runtime.sendMessage({
            type: 'COMPLETE_ONBOARDING',
            data: { emailConfigured },
          });
        }
      } catch (err) {
        logger.warn('Welcome', 'Failed to update onboarding completion', toError(err));
      }
    },
    [activeSteps, currentStep, emailConfigured]
  );

  const handleNext = useCallback(async () => {
    const isLast = currentStep === totalSteps - 1;
    if (isLast) {
      hasExitedFlowRef.current = true;
      await completeOnboarding(false);
      window.close();
      return;
    }
    await goToStep(currentStep + 1);
  }, [completeOnboarding, currentStep, goToStep, totalSteps]);

  const handleBack = useCallback(async () => {
    await goToStep(currentStep - 1);
  }, [currentStep, goToStep]);

  const handleSkip = useCallback(async () => {
    hasExitedFlowRef.current = true;
    await completeOnboarding(true, 'skipped');
    window.close();
  }, [completeOnboarding]);

  const handleToggleProtection = useCallback(async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'TOGGLE_PROTECTION' });
      if (response?.success) {
        setContext((prev) => ({
          ...prev,
          protectionEnabled: Boolean(response.enabled),
        }));
      }
    } catch (err) {
      logger.warn('Welcome', 'Failed to toggle protection', toError(err));
    }
  }, []);

  const handleConfigureEmail = useCallback(async () => {
    try {
      await chrome.runtime.sendMessage({
        type: 'SET_BURNER_EMAIL_SETTING',
        data: { enabled: true },
      });

      setContext((prev) => ({ ...prev, burnerEmailEnabled: true }));
      const targetUrl = chrome.runtime.getURL(POPUP_PAGE_PATH);

      await chrome.tabs.create({ url: targetUrl, active: true });
    } catch (err) {
      logger.warn('Welcome', 'Failed to open email configuration', toError(err));
    }
  }, [activeSteps, context.burnerEmailEnabled, context.hasRealEmail, currentStep]);

  const handleRunDemoScan = useCallback(async () => {
    try {
      await chrome.tabs.create({ url: DEMO_SCAN_URL, active: true });
    } catch (err) {
      logger.warn('Welcome', 'Failed to open demo scan tab', toError(err));
    }
  }, []);

  useEffect(() => {
    const handleBeforeUnload = () => {
      if (hasExitedFlowRef.current) {
        return;
      }
      const stepsSnapshot = activeStepsRef.current;
      if (stepsSnapshot.length === 0) {
        return;
      }
      void completeOnboarding(true, 'abandoned');
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [completeOnboarding]);

  const currentStepDefinition = activeSteps[currentStep];
  const StepComponent = currentStepDefinition?.Component ?? CompletionStep;
  const labels = useMemo(() => activeSteps.map((step) => step.label), [activeSteps]);

  const stepProps: StepContentProps = {
    theme: resolvedTheme,
    trackerCount,
    creditScore,
    protectionEnabled: context.protectionEnabled,
    emailConfigured,
    onToggleProtection: handleToggleProtection,
    onConfigureEmail: handleConfigureEmail,
    onRunDemoScan: handleRunDemoScan,
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white dark:bg-gray-900">
        <p className="text-sm uppercase tracking-[0.3em] text-gray-400 dark:text-gray-500">Loading guide…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white dark:bg-gray-900">
        <div className="rounded-3xl border border-red-500/40 bg-red-500/10 px-8 py-6 text-center">
          <p className="text-lg font-semibold text-gray-900 dark:text-white">Unable to load onboarding</p>
          <p className="text-sm text-gray-600 dark:text-gray-400">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white">
      <div className="mx-auto flex max-w-5xl flex-col gap-10 px-6 py-10">
        <StepIndicator
          currentStep={currentStep}
          totalSteps={totalSteps}
          labels={labels}
          theme={resolvedTheme}
        />
        <main className="flex flex-col gap-6">
          <StepComponent {...stepProps} />
          <NavigationButtons
            currentStep={currentStep}
            totalSteps={totalSteps}
            onBack={handleBack}
            onNext={handleNext}
            onSkip={handleSkip}
            primaryLabel={currentStepDefinition.primaryLabel}
            showSkip={currentStepDefinition.showSkip ?? true}
            theme={resolvedTheme}
          />
        </main>
      </div>
    </div>
  );
}

export { WelcomeApp };

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<WelcomeApp />);
}

