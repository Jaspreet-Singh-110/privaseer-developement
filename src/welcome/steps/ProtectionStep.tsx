import { ShieldCheck, WifiOff } from 'lucide-react';
import type { StepContentProps } from './types';

export function ProtectionStep({
  theme,
  trackerCount = 0,
  protectionEnabled = true,
  onToggleProtection,
}: StepContentProps): JSX.Element {
  const isDark = theme === 'dark';
  const containerBg = isDark
    ? 'bg-gray-800 text-white border border-gray-700'
    : 'bg-white text-gray-900 shadow-lg border border-gray-200';
  const accentText = isDark ? 'text-blue-400' : 'text-blue-600';
  const secondaryText = isDark ? 'text-gray-300' : 'text-gray-700';
  const cardBorder = isDark ? 'border-gray-700' : 'border-gray-200';
  const cardBgPrimary = isDark ? 'bg-gray-700' : 'bg-gray-50';
  const cardBgSecondary = isDark ? 'bg-gray-800' : 'bg-white shadow';
  const chipText = isDark ? 'text-gray-400' : 'text-gray-600';
  const blockedText = protectionEnabled
    ? isDark
      ? 'text-green-400'
      : 'text-green-600'
    : isDark
      ? 'text-gray-300'
      : 'text-gray-500';
  const handleToggle = () => {
    if (!onToggleProtection) {
      return;
    }
    void onToggleProtection();
  };

  return (
    <section className={`flex flex-col gap-6 rounded-3xl p-8 backdrop-blur ${containerBg}`}>
      <header className="space-y-2">
        <p className={`text-sm uppercase tracking-[0.3em] ${accentText}`}>Real-time protection</p>
        <h2 className="text-3xl font-semibold leading-snug">
          Firewall-grade blocking before trackers ever reach your browser.
        </h2>
        <p className={`text-base max-w-3xl ${secondaryText}`}>
          Privaseer pairs the Chrome Declarative Net Request API with adaptive risk scores. Every
          request is fingerprinted, categorized, and either blocked or allowed within milliseconds —
          even when service workers go to sleep.
        </p>
      </header>

      <div className="grid gap-6 md:grid-cols-2">
        <article className={`rounded-2xl border ${cardBorder} ${cardBgPrimary} p-5`}>
          <div className="mb-4 flex items-center gap-3">
            <div
              className={`flex h-12 w-12 items-center justify-center rounded-2xl ${
                isDark ? 'bg-sky-500/20 text-sky-200' : 'bg-sky-100 text-sky-600'
              }`}
            >
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div>
              <p className={`text-xs uppercase tracking-[0.2em] ${chipText}`}>Protected Tabs</p>
              <p className="text-lg font-semibold">Live Firewall</p>
            </div>
          </div>
          <ul className={`space-y-2 text-sm ${secondaryText}`}>
            <li>• Debounced badge updates prevent flicker</li>
            <li>• Domain intelligence + threat taxonomy</li>
            <li>• High-risk trackers trigger severity alerts</li>
          </ul>
        </article>

        <article className={`rounded-2xl border ${cardBorder} ${cardBgSecondary} p-5`}>
          <p className={`text-xs uppercase tracking-[0.2em] ${chipText}`}>Live protection</p>
          <div className="mt-4 space-y-4">
            <div
              className={`rounded-2xl border ${
                isDark ? 'border-white/10 bg-black/20 text-white/80' : 'border-slate-200 bg-slate-50 text-slate-700'
              } px-4 py-3`}
            >
              <p className="text-sm font-semibold">Trackers blocked so far</p>
              <p className="mt-1 text-2xl font-black" aria-live="polite">
                {trackerCount}
              </p>
              <p className="mt-1 text-xs">
                {protectionEnabled
                  ? 'Protection is active and blocking in real time.'
                  : 'Protection is paused. Turn it on to resume blocking.'}
              </p>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={protectionEnabled}
              onClick={handleToggle}
              className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-sm font-semibold transition ${
                protectionEnabled
                  ? isDark
                    ? 'border-emerald-500/50 bg-emerald-500/10'
                    : 'border-emerald-200 bg-emerald-50'
                  : isDark
                    ? 'border-gray-700 bg-gray-900'
                    : 'border-gray-200 bg-white'
              }`}
            >
              <span>{protectionEnabled ? 'Protection enabled' : 'Protection disabled'}</span>
              <span className={`inline-flex items-center gap-1 ${blockedText}`}>
                <WifiOff className="h-3.5 w-3.5" />
                {protectionEnabled ? 'blocking on' : 'blocking off'}
              </span>
            </button>
          </div>
        </article>
      </div>
    </section>
  );
}

