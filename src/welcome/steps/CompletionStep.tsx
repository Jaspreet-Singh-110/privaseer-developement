import { CheckCircle2, ShieldCheck } from 'lucide-react';
import type { StepContentProps } from './types';

export function CompletionStep({ theme }: StepContentProps): JSX.Element {
  const isDark = theme === 'dark';
  const containerBg = isDark
    ? 'border-green-700 bg-green-900/30 text-white'
    : 'border-green-200 bg-green-50 text-gray-900';
  const subtitle = isDark ? 'text-green-400' : 'text-green-600';
  const cardBorder = isDark ? 'border-gray-700 bg-gray-800 text-white' : 'border-gray-200 bg-white text-gray-900';
  const helperBg = isDark
    ? 'border-gray-700 bg-gray-800 text-gray-300'
    : 'border-gray-200 bg-gray-50 text-gray-700';

  return (
    <section className={`rounded-3xl border p-8 backdrop-blur ${containerBg}`}>
      <header className="space-y-3">
        <p className={`text-sm uppercase tracking-[0.3em] ${subtitle}`}>All set</p>
        <h2 className="text-3xl font-semibold leading-tight">
          Privaseer is guarding every tab. You can close this guide anytime.
        </h2>
        <p className={`text-base max-w-3xl ${isDark ? 'text-white/70' : 'text-slate-600'}`}>
          Real-time blocking, consent monitoring, and burner email protections are active. You can
          revisit this walkthrough anytime from Settings → About.
        </p>
      </header>

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <article className={`flex items-start gap-4 rounded-2xl border px-6 py-5 ${cardBorder}`}>
          <ShieldCheck className={`mt-1 h-6 w-6 ${subtitle}`} />
          <div>
            <p className="text-lg font-semibold">Protection active</p>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Trackers are getting blocked, consent violations are flagged, and alerts land locally.
            </p>
          </div>
        </article>
        <article className={`flex items-start gap-4 rounded-2xl border px-6 py-5 ${cardBorder}`}>
          <CheckCircle2 className={`mt-1 h-6 w-6 ${subtitle}`} />
          <div>
            <p className="text-lg font-semibold">Burner email ready</p>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Launch the popup whenever you need aliases or to tweak your forwarding address.
            </p>
          </div>
        </article>
        <article className={`md:col-span-2 rounded-2xl border px-6 py-5 ${cardBorder}`}>
          <p className="text-lg font-semibold mb-3">Privacy Credit at a Glance</p>
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
            Your 300-850 score is built from four factors:
          </p>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-emerald-500">+</span>
              <span>Protection Consistency</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-emerald-500">+</span>
              <span>Clean Browsing</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-red-500">−</span>
              <span>High-Risk Exposure</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-red-500">−</span>
              <span>Consent Violations</span>
            </div>
          </div>
        </article>
      </div>

      <div className={`mt-6 flex items-center gap-3 rounded-2xl border px-5 py-4 text-sm ${helperBg}`}>
        <CheckCircle2 className={`h-5 w-5 ${subtitle}`} />
        <span>Tip: Use the Finish button below to close the tour. You can re-open it anytime from the popup settings panel.</span>
      </div>
    </section>
  );
}

