import { Shield, Stars } from 'lucide-react';
import type { StepContentProps } from './types';

export function WelcomeStep({ theme }: StepContentProps): JSX.Element {
  const isDark = theme === 'dark';
  const chipClasses = isDark
    ? 'border-gray-700 bg-gray-800 text-gray-300'
    : 'border-gray-200 bg-gray-100 text-gray-700';
  const titleClass = isDark ? 'text-white' : 'text-gray-900';
  const bodyClass = isDark ? 'text-gray-300' : 'text-gray-700';
  const cardBg = isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-white shadow-sm';
  const iconColor = isDark ? 'text-blue-400' : 'text-blue-600';

  return (
    <section className="flex flex-col gap-6">
      <div
        className={`inline-flex items-center gap-2 rounded-full border px-4 py-1 text-xs uppercase tracking-[0.2em] ${chipClasses}`}
      >
        <Stars className="h-3 w-3" />
        Welcome
      </div>

      <header className="space-y-4">
        <h1 className={`text-4xl font-extrabold leading-tight ${titleClass}`}>
          Your privacy copilot for every website you visit.
        </h1>
        <p className={`text-base max-w-2xl ${bodyClass}`}>
          Privaseer blocks trackers in real time, audits dark patterns, and helps you stay in control
          with burner emails and privacy credit scores.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        {[
          {
            title: 'Real-time blocking',
            description: 'Stops fingerprinting, ads, and data brokers before they load.',
          },
          {
            title: 'Consent guardrails',
            description: 'Identifies deceptive cookie banners & highlights violations.',
          },
          {
            title: 'Secure identities',
            description: 'Create single-use burner emails with instant forwarding.',
          },
        ].map((item) => (
          <article key={item.title} className={`rounded-2xl border p-4 ${cardBg}`}>
            <div className={`mb-3 flex items-center gap-2 text-sm font-semibold ${titleClass}`}>
              <Shield className={`h-4 w-4 ${iconColor}`} />
              {item.title}
            </div>
            <p className={`text-sm ${bodyClass}`}>{item.description}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

