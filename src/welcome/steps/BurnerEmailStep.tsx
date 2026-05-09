import { ShieldPlus, Mail, AlertTriangle } from 'lucide-react';
import type { StepContentProps } from './types';

const featureCards = [
  {
    title: 'Instant Forwarding',
    description: 'Aliases deliver to your real inbox immediately with end-to-end encryption.',
    icon: ShieldPlus,
  },
  {
    title: 'Single-use Identities',
    description: 'Generate burner addresses per-site to isolate data sharing and stop profiling.',
    icon: Mail,
  },
  {
    title: 'Spam Detox',
    description: 'Deactivate any alias the moment a company gets sketchy—no inbox cleanup needed.',
    icon: AlertTriangle,
  },
];

export function BurnerEmailStep({
  theme,
  emailConfigured = false,
  onConfigureEmail,
}: StepContentProps): JSX.Element {
  const isDark = theme === 'dark';
  const containerBg = isDark
    ? 'border-gray-700 bg-gray-800 text-white'
    : 'border-gray-200 bg-white text-gray-900';
  const subtitle = isDark ? 'text-gray-400' : 'text-gray-600';

  return (
    <section className={`rounded-3xl border p-8 backdrop-blur ${containerBg}`}>
      <header className="mb-6 space-y-2">
        <p className={`text-sm uppercase tracking-[0.3em] ${subtitle}`}>Burner identities</p>
        <h2 className="text-3xl font-semibold leading-tight">
          Protect your inbox with aliases that forward instantly and expire on demand.
        </h2>
        <p className={`text-base max-w-3xl ${subtitle}`}>
          Generate privacy-first aliases, forward them to your real inbox, and revoke access the
          moment a company violates trust. Nothing ever touches our servers unencrypted.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        {featureCards.map(({ title, description, icon: Icon }) => (
          <article
            key={title}
            className={`rounded-2xl border border-gray-200/40 bg-white/70 p-5 text-gray-900 shadow-sm dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-100`}
          >
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Icon className="h-4 w-4 text-sky-500 dark:text-sky-300" />
              {title}
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-300">{description}</p>
          </article>
        ))}
      </div>

      <div className="mt-6 rounded-2xl border border-dashed border-gray-300/60 bg-gray-50/80 p-4 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-300">
        {emailConfigured ? (
          <p aria-live="polite">Forwarding email is configured. You are ready to generate aliases.</p>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p>Set your forwarding email now so burner aliases work immediately.</p>
            <button
              type="button"
              onClick={() => {
                if (!onConfigureEmail) {
                  return;
                }
                void onConfigureEmail();
              }}
              className={`rounded-xl border px-4 py-2 text-xs font-semibold uppercase tracking-[0.15em] ${
                isDark
                  ? 'border-sky-400/60 bg-sky-500/10 text-sky-100 hover:bg-sky-500/20'
                  : 'border-sky-300 bg-sky-100 text-sky-700 hover:bg-sky-200'
              }`}
            >
              Configure email now
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

