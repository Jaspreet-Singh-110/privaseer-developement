import { Activity, ShieldCheck, AlertTriangle } from 'lucide-react';
import type { StepContentProps } from './types';

type FactorTone = 'green' | 'red';
type Factor = {
  name: string;
  impact: string;
  color: FactorTone;
  description: string;
  icon: typeof ShieldCheck;
};

const sampleHistory = [
  { label: 'Mon', value: 680 },
  { label: 'Tue', value: 695 },
  { label: 'Wed', value: 710 },
  { label: 'Thu', value: 720 },
  { label: 'Fri', value: 715 },
];

const factors: Factor[] = [
  {
    name: 'Protection Consistency',
    impact: '+87',
    color: 'green',
    description: 'Keep protection enabled daily',
    icon: ShieldCheck,
  },
  {
    name: 'Clean Browsing',
    impact: '+34',
    color: 'green',
    description: 'Visit privacy-respecting sites',
    icon: ShieldCheck,
  },
  {
    name: 'High-Risk Exposure',
    impact: '-12',
    color: 'red',
    description: 'Avoid high-risk trackers',
    icon: AlertTriangle,
  },
  {
    name: 'Violations',
    impact: '-25',
    color: 'red',
    description: 'Sites that ignore your consent',
    icon: AlertTriangle,
  },
];

const getFactorStyles = (theme: 'light' | 'dark', tone: 'green' | 'red') => {
  if (tone === 'green') {
    return theme === 'dark'
      ? 'border-emerald-900/60 bg-emerald-900/20 text-emerald-200'
      : 'border-emerald-200 bg-emerald-50 text-emerald-700';
  }
  return theme === 'dark'
    ? 'border-red-900/60 bg-red-900/20 text-red-200'
    : 'border-red-200 bg-red-50 text-red-700';
};

const getScoreLabel = (score: number | null): string => {
  if (score === null) {
    return 'No data yet';
  }
  if (score >= 750) {
    return 'Excellent';
  }
  if (score >= 650) {
    return 'Good';
  }
  if (score >= 550) {
    return 'Fair';
  }
  if (score >= 400) {
    return 'Poor';
  }
  return 'Very Poor';
};

export function PrivacyCreditStep({ theme, creditScore = null }: StepContentProps): JSX.Element {
  const isDark = theme === 'dark';
  const sectionBackground = isDark
    ? 'border-gray-700 bg-gray-800 text-white'
    : 'border-gray-200 bg-white text-gray-900';
  const subtitle = isDark ? 'text-gray-400' : 'text-gray-600';
  const secondary = isDark ? 'text-gray-300' : 'text-gray-700';
  const panelBorder = isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-white';
  const statsBorder = isDark
    ? 'border-gray-700 bg-gray-800 text-white'
    : 'border-gray-200 bg-gray-50 text-gray-900';
  const scoreLabel = getScoreLabel(creditScore);
  const scoreDisplay = creditScore === null ? '--' : String(creditScore);
  const scoreTone =
    creditScore === null
      ? isDark
        ? 'text-gray-300'
        : 'text-gray-500'
      : isDark
        ? 'text-emerald-200'
        : 'text-emerald-600';

  return (
    <section className={`rounded-3xl border bg-gradient-to-br p-8 backdrop-blur ${sectionBackground}`}>
      <header className="space-y-3">
        <p className={`text-sm uppercase tracking-[0.3em] ${subtitle}`}>Privacy credit</p>
        <h2 className="text-3xl font-semibold leading-tight">
          A credit-style score that reflects your long-term privacy health.
        </h2>
        <p className={`text-base max-w-3xl ${secondary}`}>
          Your 300-850 score updates with logarithmic scaling for stability. We blend protection
          consistency, clean browsing, and consent enforcement to keep your progress meaningful.
        </p>
      </header>

      <div className="mt-8 grid gap-6 md:grid-cols-[1.1fr_0.9fr]">
        <div className={`flex flex-col gap-5 rounded-2xl border p-6 ${panelBorder}`}>
          <div className="flex items-baseline gap-3">
            <span className="text-6xl font-black" aria-live="polite">{scoreDisplay}</span>
            <span className={`text-lg uppercase tracking-[0.3em] ${scoreTone}`}>{scoreLabel}</span>
          </div>
          <p className={`text-sm ${secondary}`}>
            {creditScore === null
              ? 'Browse a few sites with Privaseer enabled to generate your first Privacy Credit score.'
              : 'Your score reflects 30 days of browsing. Good habits compound over time.'}
          </p>

          <div className="rounded-2xl border border-dashed p-4 text-sm">
            <p className={`mb-3 ${secondary}`}>Score scale</p>
            <div className="grid grid-cols-4 gap-2 text-center">
              <div>
                <p className={isDark ? 'text-white/80 font-semibold' : 'text-slate-700 font-semibold'}>300</p>
                <p className={`text-xs uppercase tracking-[0.2em] ${subtitle}`}>Poor</p>
              </div>
              <div>
                <p className={isDark ? 'text-white/80 font-semibold' : 'text-slate-700 font-semibold'}>550</p>
                <p className={`text-xs uppercase tracking-[0.2em] ${subtitle}`}>Fair</p>
              </div>
              <div>
                <p className={isDark ? 'text-white/80 font-semibold' : 'text-slate-700 font-semibold'}>750</p>
                <p className={`text-xs uppercase tracking-[0.2em] ${subtitle}`}>Good</p>
              </div>
              <div>
                <p className={isDark ? 'text-white/80 font-semibold' : 'text-slate-700 font-semibold'}>850</p>
                <p className={`text-xs uppercase tracking-[0.2em] ${subtitle}`}>Excellent</p>
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            {sampleHistory.map((entry) => (
              <div key={entry.label} className="flex-1 text-center">
                <div
                  className={`mb-2 h-24 rounded-full ${
                    isDark ? 'bg-white/10' : 'bg-slate-100 shadow-inner'
                  }`}
                >
                  <div
                    className={`mx-auto mt-auto h-full w-full rounded-full bg-gradient-to-t ${
                      isDark ? 'from-emerald-300 to-white' : 'from-emerald-500 to-sky-100'
                    }`}
                    style={{ height: `${Math.round((entry.value / 850) * 100)}%` }}
                  />
                </div>
                <p className={`text-xs uppercase tracking-wide ${subtitle}`}>{entry.label}</p>
                <p className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-slate-800'}`}>
                  {entry.value}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className={`rounded-2xl border p-6 ${statsBorder}`}>
          <div className={`mb-4 flex items-center gap-2 text-sm uppercase tracking-[0.3em] ${subtitle}`}>
            <Activity className="h-4 w-4" />
            How your score is built
          </div>
          <ul className="space-y-4">
            {factors.map((factor) => {
              const Icon = factor.icon;
              return (
                <li
                  key={factor.name}
                  className={`rounded-2xl border px-4 py-3 text-sm ${getFactorStyles(theme, factor.color)}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-semibold">
                      <Icon className="h-4 w-4" />
                      {factor.name}
                    </div>
                    <span className="font-semibold">{factor.impact}</span>
                  </div>
                  <p className="mt-2 text-xs">{factor.description}</p>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}
