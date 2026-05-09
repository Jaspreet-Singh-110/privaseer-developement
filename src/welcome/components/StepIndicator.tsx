import type { Theme } from '../welcome';

interface StepIndicatorProps {
  currentStep: number;
  totalSteps: number;
  labels?: string[];
  theme: Theme;
}

export function StepIndicator({
  currentStep,
  totalSteps,
  labels = [],
  theme,
}: StepIndicatorProps): JSX.Element {
  const isDark = theme === 'dark';
  const counterText = isDark ? 'text-gray-400' : 'text-gray-600';
  const labelText = isDark ? 'text-gray-500' : 'text-gray-500';

  return (
    <div className="space-y-3">
      <div
        className={`flex items-center justify-between text-xs font-semibold uppercase tracking-[0.3em] ${counterText}`}
      >
        <span>Step {currentStep + 1}</span>
        <span>{totalSteps} total</span>
      </div>
      <div className="flex items-center gap-3">
        {Array.from({ length: totalSteps }).map((_, index) => {
          const isActive = index === currentStep;
          const isComplete = index < currentStep;

          return (
            <div key={index} className="flex-1">
              <div
                className={`h-2 rounded-full ${
                  isActive
                    ? 'bg-blue-600 dark:bg-blue-400'
                    : isComplete
                      ? 'bg-gray-400 dark:bg-gray-600'
                      : 'bg-gray-300 dark:bg-gray-700'
                }`}
              />
              {labels[index] && (
                <p className={`mt-2 text-[10px] uppercase tracking-[0.25em] ${labelText}`}>
                  {labels[index]}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

