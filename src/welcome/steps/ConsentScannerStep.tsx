import { AlertTriangle, EyeOff } from 'lucide-react';
import type { StepContentProps } from './types';

const patterns = [
  { title: 'Forced consent', description: 'Accept button only, reject buried after scroll.' },
  { title: 'Hidden reject', description: 'Reject button color matches background.' },
  { title: 'Pre-checked boxes', description: 'Vendors pre-enabled despite GDPR.' },
];

export function ConsentScannerStep({ theme, onRunDemoScan }: StepContentProps): JSX.Element {
  const isDark = theme === 'dark';
  const containerBg = isDark ? 'border-gray-700 bg-gray-800 text-white' : 'border-gray-200 bg-white text-gray-900 shadow';
  const subtitle = isDark ? 'text-gray-400' : 'text-gray-600';
  const secondary = isDark ? 'text-gray-300' : 'text-gray-700';
  const cardBorder = isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-50';
  const violationCard = isDark
    ? 'border-gray-700 bg-amber-900/30'
    : 'border-amber-200 bg-amber-50';

  return (
    <section className={`rounded-3xl border p-8 backdrop-blur ${containerBg}`}>
      <header className="space-y-3">
        <p className={`text-sm uppercase tracking-[0.3em] ${subtitle}`}>Consent intelligence</p>
        <h2 className="text-3xl font-semibold">
          Detect dark patterns before you click anything.
        </h2>
        <p className={`text-base max-w-3xl ${secondary}`}>
          Our content script inspects cookie banners in an isolated world, scores each UI pattern,
          and reports violations without leaking browsing data.
        </p>
      </header>

      <div className="mt-6 grid gap-6 md:grid-cols-[1.1fr_0.9fr]">
        <article className={`rounded-2xl border p-6 ${cardBorder}`}>
          <div className={`mb-4 flex items-center gap-2 text-sm uppercase tracking-[0.3em] ${subtitle}`}>
            <EyeOff className="h-4 w-4 text-amber-300" />
            Banner audit
          </div>
          <div className={`rounded-2xl ${isDark ? 'bg-white/5' : 'bg-white'} p-5`}>
            {patterns.map((pattern) => (
              <div key={pattern.title} className="mb-4 last:mb-0">
                <p className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-slate-800'}`}>
                  {pattern.title}
                </p>
                <p className={`text-xs ${secondary}`}>{pattern.description}</p>
              </div>
            ))}
          </div>
        </article>

        <article
          className={`rounded-2xl border bg-gradient-to-br p-6 ${violationCard}`}
        >
          <div className="mb-3 flex items-center gap-3">
            <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${isDark ? 'bg-black/20' : 'bg-amber-200/50'}`}>
              <AlertTriangle className={`h-6 w-6 ${isDark ? 'text-amber-200' : 'text-amber-700'}`} />
            </div>
            <div>
              <p className={`text-xs uppercase tracking-[0.2em] ${isDark ? 'text-white/60' : 'text-amber-700'}`}>Violation</p>
              <p className={`text-xl font-semibold ${isDark ? 'text-white' : 'text-amber-900'}`}>GDPR risk detected</p>
            </div>
          </div>
          <ul className={`space-y-3 text-sm ${isDark ? 'text-white/80' : 'text-amber-800'}`}>
            <li>• Reject button hidden behind accordion</li>
            <li>• Vendor list auto-expanded with 187 trackers</li>
            <li>• CMP persists consent without interaction</li>
          </ul>
        </article>
      </div>

      <div className="mt-6">
        <button
          type="button"
          onClick={() => {
            if (!onRunDemoScan) {
              return;
            }
            void onRunDemoScan();
          }}
          className={`rounded-2xl border px-5 py-3 text-sm font-semibold transition ${
            isDark
              ? 'border-sky-400/60 bg-sky-500/10 text-sky-100 hover:bg-sky-500/20'
              : 'border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100'
          }`}
        >
          Try a demo scan on a real website
        </button>
      </div>
    </section>
  );
}

