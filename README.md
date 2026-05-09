# Privaseer: Privacy-First Browser Extension

## Project Overview

Privaseer is a Manifest V3 Chrome extension focused on local-first privacy protection. It combines declarative tracker blocking, consent-banner analysis, privacy scoring, burner-email workflows, and optional feedback/telemetry integrations backed by Supabase edge functions.

Current stack:

- TypeScript 5.5 (strict mode)
- React 18.3 + Tailwind CSS
- Vite 7.2 + `vite-plugin-web-extension`
- Vitest + Testing Library + Happy DOM
- Playwright E2E tests

## Core Capabilities

### 1) Tracking Protection

- DeclarativeNetRequest rules in `public/data/blocking-rules.json`
- Tracker catalog and categories in `public/data/tracker-lists.json`
- Service worker orchestration through `src/background/firewall-engine.ts`
- Badge + alert updates via `src/utils/tab-manager.ts` and `src/utils/message-bus.ts`

### 2) Consent and CMP Analysis

- Consent scanning via `src/content-scripts/consent-scanner.ts`
- Rule and pattern definitions in `public/data/privacy-rules.json`
- Persistence and alerting through `src/background/storage.ts`
- False-positive reporting and override support through:
  - `src/background/false-positive-service.ts`
  - `supabase/functions/report-false-positive/index.ts`
  - `supabase/functions/get-fp-overrides/index.ts`

### 3) Privacy Scoring and Insights

- Core score lifecycle in `src/background/privacy-score.ts`
- Aggregated analytics in `src/background/metrics-aggregation.ts`
- Remote scoring config integration in `src/background/scoring-config.ts`
- Dashboard period summaries (week/month/all-time) exposed via service-worker message handlers

### 4) Burner Email Workflows

- Background logic in `src/background/burner-email-service.ts`
- Autofill integration in `src/content-scripts/email-autofill.ts`
- UI management in `src/popup/burner-emails-section.tsx`
- Supabase support functions:
  - `supabase/functions/generate-burner-email/index.ts`
  - `supabase/functions/inbound-email/index.ts`
  - `supabase/functions/auth-token/index.ts`

### 5) Data Portability and Local Data Control

- GDPR-oriented export generation in `src/background/data-export-service.ts`
- JSON and CSV export modes
- URL sanitization before export using `src/utils/sanitizer.ts`
- Optional forwarding-email inclusion (explicit opt-in)
- Local data deletion flow via `DELETE_ALL_DATA` service-worker handler

### 6) UI Surfaces

- Popup UI in `src/popup/popup.tsx`
- Settings modal in `src/popup/settings-page.tsx`
- Welcome/onboarding flow in `src/welcome/welcome.tsx` and `src/welcome/steps/*`

## Technical Architecture

- **Background layer**: Service worker and background modules in `src/background/`
- **Content-script layer**: Runtime page scanning and autofill in `src/content-scripts/`
- **Popup layer**: User-facing controls and analytics in `src/popup/`
- **Onboarding layer**: Multi-step welcome experience in `src/welcome/`
- **Shared utilities/types**: Guards, validation, constants, logging, and contracts under `src/utils/` and `src/types/`
- **Backend integration**: Supabase edge functions and SQL migrations in `supabase/`

## Project Structure

```text
privaseer/
├── src/
│   ├── background/                         # 11 modules
│   │   ├── burner-email-service.ts
│   │   ├── data-export-service.ts
│   │   ├── event-emitter.ts
│   │   ├── false-positive-service.ts
│   │   ├── feedback-telemetry-service.ts
│   │   ├── firewall-engine.ts
│   │   ├── metrics-aggregation.ts
│   │   ├── privacy-score.ts
│   │   ├── scoring-config.ts
│   │   ├── service-worker.ts
│   │   └── storage.ts
│   ├── content-scripts/
│   │   ├── consent-scanner.ts
│   │   └── email-autofill.ts
│   ├── popup/                              # 4 components
│   │   ├── BurnerEmailDisabled.tsx
│   │   ├── burner-emails-section.tsx
│   │   ├── popup.tsx
│   │   └── settings-page.tsx
│   ├── welcome/
│   │   ├── welcome.tsx
│   │   ├── welcome.html
│   │   ├── components/
│   │   │   ├── NavigationButtons.tsx
│   │   │   └── StepIndicator.tsx
│   │   └── steps/
│   │       ├── WelcomeStep.tsx
│   │       ├── ProtectionStep.tsx
│   │       ├── ConsentScannerStep.tsx
│   │       ├── BurnerEmailStep.tsx
│   │       ├── PrivacyCreditStep.tsx
│   │       ├── CompletionStep.tsx
│   │       └── types.ts
│   ├── utils/                              # 16 utility modules
│   │   ├── allowlist-manager.ts
│   │   ├── cmp-detector.ts
│   │   ├── consent-validator.ts
│   │   ├── constants.ts
│   │   ├── i18n-patterns.ts
│   │   ├── logger.ts
│   │   ├── message-bus.ts
│   │   ├── penalty-decay.ts
│   │   ├── privacy-credit-engine.ts
│   │   ├── sanitizer.ts
│   │   ├── scan-confidence.ts
│   │   ├── tab-manager.ts
│   │   ├── theme-helper.ts
│   │   ├── theme-manager.ts
│   │   ├── type-guards.ts
│   │   └── validation.ts
│   ├── types/
│   │   └── index.ts
│   ├── tests/                              # 80+ Vitest suites
│   ├── index.css
│   └── manifest.json
├── tests/e2e/                              # Playwright E2E suites
├── public/
│   ├── data/
│   │   ├── blocking-rules.json
│   │   ├── privacy-rules.json
│   │   └── tracker-lists.json
│   └── icons/
├── supabase/
│   ├── functions/                          # 10 edge functions
│   │   ├── auth-token/
│   │   ├── generate-burner-email/
│   │   ├── get-cmp-config/
│   │   ├── get-fp-overrides/
│   │   ├── get-scoring-config/
│   │   ├── inbound-email/
│   │   ├── persist-consent-state/
│   │   ├── report-false-positive/
│   │   ├── submit-feedback/
│   │   └── suggest-cmp-pattern/
│   ├── migrations/                         # 22 SQL migrations
│   │   ├── 20251112_create_feedback_system.sql
│   │   ├── 20251114_create_consent_persistence.sql
│   │   ├── 20251119_create_burner_email_system.sql
│   │   ├── 20251205_add_expires_at_column.sql
│   │   ├── 20251205_fix_function_search_paths.sql
│   │   ├── 20251211_fix_email_column_name.sql
│   │   ├── 20251215_add_email_logs_and_rate_limit.sql
│   │   ├── 20251216_add_jwt_auth_system.sql
│   │   ├── 20251216_enable_rls_jwt_tables.sql
│   │   ├── 20260120_create_false_positives.sql
│   │   ├── 20260129_fix_burner_emails_rls_policies.sql
│   │   ├── 20260129_fix_consent_state_rls_policies.sql
│   │   ├── 20260129_fix_jwt_tables_rls_policies.sql
│   │   ├── 20260129_fix_telemetry_rls_policies.sql
│   │   ├── 20260216_create_domain_confidence_overrides.sql
│   │   ├── 20260216_create_fp_aggregation_function.sql
│   │   ├── 20260216_drop_duplicate_telemetry_index.sql
│   │   ├── 20260224_create_scoring_config.sql
│   │   ├── 20260225_create_cmp_configs.sql
│   │   ├── 20260225_create_cmp_suggestions.sql
│   │   ├── 20260305_add_false_positive_reason.sql
│   │   └── 20260305_update_fp_aggregation_decay.sql
│   └── security_enhancements.sql
├── .github/workflows/ci.yml
├── .husky/pre-commit
├── eslint.config.js
├── postcss.config.js
├── playwright.config.ts
├── stryker.config.json
├── tailwind.config.js
├── vite.config.ts
├── vitest.config.ts
└── tsconfig*.json
```

## Development Setup

### Prerequisites

- Node.js 18+
- npm 9+
- Chrome or Chromium (Manifest V3 capable)
- Python 3 (for local static server used by Playwright config)

### Install

```bash
npm install
```

### Main Commands

```bash
# Local dev
npm run dev
npm run build
npm run preview

# Quality gates
npm run typecheck
npm run lint

# Unit/integration tests (Vitest)
npm run test
npm run test:run
npm run test:ui
npm run test:coverage

# Mutation tests
npm run test:mutation
npm run test:mutation:changed

# End-to-end tests
npm run test:e2e
npm run test:e2e:ui
npm run test:e2e:debug
```

### Load the Extension in Chrome

1. Build with `npm run build`
2. Open `chrome://extensions`
3. Enable Developer mode
4. Click **Load unpacked** and select `dist/`

### Pre-commit Hook

Husky runs `lint-staged` on commit:

- `*.{ts,tsx}`: `eslint --fix` and `vitest related --run`
- `*.{json,md}`: `prettier --write`

## Service Worker Message API Highlights

The service worker in `src/background/service-worker.ts` currently includes handlers for:

- Settings/state retrieval and updates
- Consent-scan reporting and persistence
- Metrics aggregation and privacy trend retrieval
- User data export (`EXPORT_USER_DATA`)
- Local data deletion (`DELETE_ALL_DATA`)

Refer to `src/utils/message-bus.ts` and `src/types/index.ts` for message contracts.

## Privacy and Security

### Privacy Defaults

- `telemetryEnabled: false`
- `burnerEmailEnabled: false`
- `protectionEnabled: true`

### Storage and Retention

- Extension data is stored in `chrome.storage.local`
- Snapshot retention for export/reporting is controlled by `DATA_EXPORT.MAX_SNAPSHOT_DAYS`
- Alert and history retention constraints are enforced in storage and constants layers

### Manifest Permissions (Current)

- `storage`
- `declarativeNetRequest`
- `declarativeNetRequestFeedback`
- `tabs`

Host permissions:

- `https://llffqxdhpgsqnpzeznaq.supabase.co/*`

Content scripts match:

- `http://*/*`
- `https://*/*`

### Supabase Security Notes

- RLS hardening and audit policies are maintained in `supabase/security_enhancements.sql`
- JWT and auth-related tables/functions are introduced through migrations under `supabase/migrations/`
- Sensitive keys must be managed via secret stores and never committed

## Operational Notes for New Developers

- Start with `src/background/service-worker.ts`, `src/background/storage.ts`, and `src/utils/message-bus.ts` to understand runtime flow.
- Review `src/types/index.ts` before adding or changing message payloads.
- If adding privacy-impacting logic, update tests in `src/tests/background/` and relevant contract tests in `src/tests/contracts/`.
- For UI work, update both popup tests (`src/tests/popup/`) and onboarding tests (`src/tests/welcome/`).

## Troubleshooting

### Build or Load Failures

- Re-run `npm run build` and reload unpacked extension
- Verify Manifest V3-compatible Chrome/Chromium version

### Missing or Stale Popup Data

- Confirm the service worker is running
- Check message handler types and payload validation
- Validate local storage state via extension devtools

### Supabase Integration Issues

- Verify environment configuration and project keys
- Ensure migration state is current for your target Supabase project
- Check edge function logs for auth or payload validation errors

## Version Snapshot

- Package version: `1.0.0`
- Browser target: Manifest V3 Chrome/Chromium
- Codebase counts: 11 background modules, 2 content scripts, 4 popup components, 16 utilities, 10 edge functions, 22 migrations

## Archived Components

| File                                   | Original Location     | Archived Date | Reason                                                                     |
| -------------------------------------- | --------------------- | ------------- | -------------------------------------------------------------------------- |
| `archive/legacy-privacy-dashboard.tsx` | `src/popup/popup.tsx` | 2026-04-16    | Replaced by enhanced Privacy Score Dashboard UI with gamification elements |

## License

Privaseer is distributed under the MIT License.
