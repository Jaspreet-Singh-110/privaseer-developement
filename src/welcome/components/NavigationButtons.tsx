import { Loader2 } from 'lucide-react';
import type { Theme } from '../welcome';

interface NavigationButtonsProps {
  currentStep: number;
  totalSteps: number;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
  disableNext?: boolean;
  loading?: boolean;
  primaryLabel?: string;
  secondaryLabel?: string;
  showSkip?: boolean;
  theme: Theme;
}

export function NavigationButtons({
  currentStep,
  totalSteps,
  onBack,
  onNext,
  onSkip,
  disableNext = false,
  loading = false,
  primaryLabel,
  secondaryLabel,
  showSkip = true,
  theme,
}: NavigationButtonsProps): JSX.Element {
  const isFirst = currentStep === 0;
  const isLast = currentStep === totalSteps - 1;
  const primaryText = primaryLabel ?? (isLast ? 'Finish' : isFirst ? 'Get Started' : 'Continue');
  const secondaryText = secondaryLabel ?? 'Back';
  const isDark = theme === 'dark';
  const skipText = isDark ? 'text-gray-400 hover:text-gray-200' : 'text-gray-600 hover:text-gray-900';
  const secondaryButton = isDark
    ? 'border-gray-700 text-gray-300 hover:border-gray-600 hover:text-white'
    : 'border-gray-300 text-gray-700 hover:border-gray-400 hover:text-gray-900';
  const primaryButton = isDark
    ? 'bg-blue-600 hover:bg-blue-500 text-white'
    : 'bg-blue-600 hover:bg-blue-700 text-white';

  return (
    <div className="mt-10 flex items-center justify-between">
      {showSkip ? (
        <button
          type="button"
          onClick={onSkip}
          className={`text-xs font-semibold uppercase tracking-[0.3em] transition ${skipText}`}
        >
          Skip tour
        </button>
      ) : (
        <span />
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          disabled={isFirst}
          className={`h-11 rounded-xl border px-6 text-xs font-semibold uppercase tracking-[0.3em] transition disabled:cursor-not-allowed disabled:opacity-40 ${secondaryButton}`}
        >
          {secondaryText}
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={disableNext || loading}
          className={`inline-flex h-11 items-center justify-center rounded-xl px-8 text-xs font-semibold uppercase tracking-[0.3em] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 ${primaryButton}`}
        >
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Working…
            </>
          ) : (
            primaryText
          )}
        </button>
      </div>
    </div>
  );
}

