import type { RiskLevel, PrivacyAlternative, PrivacyDataType } from '../types';

export interface ToastData {
  collectorName: string;
  dataType: PrivacyDataType;
  riskLevel: RiskLevel;
  domain: string;
  category: string;
  alternatives: PrivacyAlternative[];
  showBurnerEmail?: boolean;
}

const TOAST_ID = 'privaseer-privacy-toast';
const TOAST_STYLE_ID = 'privaseer-toast-styles';
const AUTO_DISMISS_MS = 10000;

let activeToast: HTMLElement | null = null;
let autoDismissTimer: ReturnType<typeof setTimeout> | null = null;
let stylesInjected = false;

function getRiskColor(level: RiskLevel): string {
  switch (level) {
    case 'high': return '#ef4444';
    case 'medium': return '#f59e0b';
    case 'low': return '#10b981';
  }
}

function getRiskLabel(level: RiskLevel): string {
  switch (level) {
    case 'high': return 'High Risk';
    case 'medium': return 'Medium';
    case 'low': return 'Low Risk';
  }
}

function getDataTypeLabel(dataType: PrivacyDataType): string {
  switch (dataType) {
    case 'email': return 'email address';
    case 'location': return 'location data';
    case 'behavioral': return 'browsing behavior';
    case 'fingerprint': return 'browser fingerprint';
    case 'advertising': return 'ad tracking data';
    case 'social': return 'social activity';
    case 'unknown': return 'personal data';
  }
}

function injectStyles(): void {
  if (stylesInjected) return;

  const style = document.createElement('style');
  style.id = TOAST_STYLE_ID;
  style.textContent = `
    @keyframes pvSlideIn {
      from { opacity: 0; transform: translateY(16px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes pvSlideOut {
      from { opacity: 1; transform: translateY(0); }
      to { opacity: 0; transform: translateY(16px); }
    }

    #${TOAST_ID} {
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: 380px;
      max-width: calc(100vw - 48px);
      background: #1e1e2e;
      color: #cdd6f4;
      border-radius: 16px;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.06);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      font-size: 13px;
      z-index: 2147483646;
      animation: pvSlideIn 0.3s ease-out;
      overflow: hidden;
    }
    #${TOAST_ID}.privaseer-dismissing {
      animation: pvSlideOut 0.25s ease-in forwards;
    }
    #${TOAST_ID} * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    /* ── Header ── */
    .pv-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 18px 20px 14px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    }
    .pv-icon {
      width: 38px;
      height: 38px;
      border-radius: 10px;
      background: linear-gradient(135deg, #667eea, #764ba2);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .pv-header-text {
      flex: 1;
      min-width: 0;
    }
    .pv-title {
      font-size: 14px;
      font-weight: 700;
      color: #fff;
      letter-spacing: -0.2px;
    }
    .pv-subtitle {
      font-size: 11px;
      color: #585b70;
      margin-top: 2px;
    }
    .pv-badge {
      font-size: 10px;
      font-weight: 700;
      padding: 3px 10px;
      border-radius: 20px;
      letter-spacing: 0.3px;
      text-transform: uppercase;
      flex-shrink: 0;
    }
    .pv-close {
      width: 28px;
      height: 28px;
      border: none;
      background: none;
      color: #585b70;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      border-radius: 8px;
      transition: all 0.15s;
    }
    .pv-close:hover {
      background: rgba(255, 255, 255, 0.06);
      color: #cdd6f4;
    }

    /* ── Body ── */
    .pv-body {
      padding: 16px 20px 14px;
    }
    .pv-collector {
      font-size: 14px;
      font-weight: 700;
      color: #cdd6f4;
      margin-bottom: 6px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .pv-collector-favicon {
      width: 18px;
      height: 18px;
      border-radius: 4px;
      flex-shrink: 0;
    }
    .pv-detail {
      font-size: 13px;
      color: #a6adc8;
      line-height: 1.6;
      margin-bottom: 10px;
    }
    .pv-detail strong {
      color: #cdd6f4;
      font-weight: 600;
    }
    .pv-tip {
      font-size: 12px;
      color: #585b70;
      padding: 8px 12px;
      background: rgba(255, 255, 255, 0.03);
      border-radius: 8px;
      border-left: 3px solid;
    }

    /* ── Actions ── */
    .pv-actions {
      display: flex;
      gap: 8px;
      padding: 4px 20px 18px;
    }
    .pv-btn {
      padding: 9px 18px;
      border: none;
      border-radius: 10px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s;
      font-family: inherit;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .pv-btn:hover {
      filter: brightness(1.1);
    }
    .pv-btn-primary {
      background: linear-gradient(135deg, #667eea, #764ba2);
      color: #fff;
      box-shadow: 0 2px 10px rgba(102, 126, 234, 0.25);
    }
    .pv-btn-primary:hover {
      box-shadow: 0 4px 16px rgba(102, 126, 234, 0.35);
      transform: translateY(-1px);
    }
    .pv-btn-secondary {
      background: rgba(255, 255, 255, 0.07);
      color: #bac2de;
    }
    .pv-btn-secondary:hover {
      background: rgba(255, 255, 255, 0.11);
    }
    .pv-btn-ghost {
      background: none;
      color: #585b70;
      padding: 9px 14px;
    }
    .pv-btn-ghost:hover {
      color: #a6adc8;
    }

    /* ── Alternatives Panel ── */
    .pv-alts {
      max-height: 0;
      overflow: hidden;
      opacity: 0;
      transition: max-height 0.35s ease, opacity 0.25s ease, padding 0.35s ease;
      padding: 0 20px;
      border-top: 0px solid transparent;
    }
    .pv-alts.pv-open {
      max-height: 320px;
      opacity: 1;
      padding: 14px 20px 16px;
      border-top: 1px solid rgba(255, 255, 255, 0.05);
    }
    .pv-alts-label {
      font-size: 10px;
      font-weight: 700;
      color: #585b70;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      margin-bottom: 10px;
    }
    .pv-alt {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 12px;
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.03);
      margin-bottom: 6px;
      transition: background 0.15s;
    }
    .pv-alt:last-child {
      margin-bottom: 0;
    }
    .pv-alt:hover {
      background: rgba(255, 255, 255, 0.06);
    }
    .pv-alt-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: linear-gradient(135deg, #667eea, #764ba2);
      flex-shrink: 0;
    }
    .pv-alt-info {
      flex: 1;
      min-width: 0;
    }
    .pv-alt-name {
      font-size: 13px;
      font-weight: 600;
      color: #cdd6f4;
    }
    .pv-alt-desc {
      font-size: 11px;
      color: #585b70;
      margin-top: 2px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .pv-alt-go {
      padding: 6px 14px;
      border: none;
      border-radius: 8px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      background: rgba(102, 126, 234, 0.12);
      color: #667eea;
      transition: all 0.15s;
      font-family: inherit;
      flex-shrink: 0;
    }
    .pv-alt-go:hover {
      background: rgba(102, 126, 234, 0.22);
    }

    /* ── Progress ── */
    .pv-progress {
      height: 2px;
      background: rgba(255, 255, 255, 0.04);
    }
    .pv-progress-bar {
      height: 100%;
      width: 100%;
      background: linear-gradient(90deg, #667eea, #764ba2);
      transition: width 0.1s linear;
    }
  `;
  document.head.appendChild(style);
  stylesInjected = true;
}

function shieldSvg(): string {
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
}

function closeSvg(): string {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
}

export function dismissToast(): void {
  if (!activeToast) return;
  if (autoDismissTimer) { clearTimeout(autoDismissTimer); autoDismissTimer = null; }
  activeToast.classList.add('privaseer-dismissing');
  const t = activeToast;
  setTimeout(() => { t.remove(); if (activeToast === t) activeToast = null; }, 250);
}

export function showToast(data: ToastData): void {
  injectStyles();

  if (activeToast) {
    activeToast.remove(); activeToast = null;
    if (autoDismissTimer) { clearTimeout(autoDismissTimer); autoDismissTimer = null; }
  }

  const rc = getRiskColor(data.riskLevel);
  const rl = getRiskLabel(data.riskLevel);
  const dtl = getDataTypeLabel(data.dataType);
  const hasAlts = data.alternatives.length > 0;
  const faviconUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(data.collectorName)}&sz=32`;

  const tipText = data.riskLevel === 'high'
    ? 'We recommend switching to a privacy-friendly alternative.'
    : hasAlts
      ? 'Privacy-friendly alternatives are available below.'
      : 'Privaseer is keeping you informed about data collection.';

  const toast = document.createElement('div');
  toast.id = TOAST_ID;
  toast.setAttribute('role', 'alert');
  toast.setAttribute('aria-live', 'assertive');

  toast.innerHTML = `
    <div class="pv-header">
      <div class="pv-icon">${shieldSvg()}</div>
      <div class="pv-header-text">
        <div class="pv-title">Privacy Alert</div>
        <div class="pv-subtitle">Data collection detected</div>
      </div>
      <span class="pv-badge" style="background:${rc}18;color:${rc};">${rl}</span>
      <button class="pv-close" aria-label="Close">${closeSvg()}</button>
    </div>

    <div class="pv-body">
      <div class="pv-collector">
        <img class="pv-collector-favicon" src="${faviconUrl}" alt="" onerror="this.style.display='none'"/>
        ${escapeHtml(data.collectorName)}
      </div>
      <div class="pv-detail">
        This site is collecting your <strong>${dtl}</strong>. Your data may be shared with third-party trackers.
      </div>
      <div class="pv-tip" style="border-color: ${rc};">
        ${tipText}
      </div>
    </div>

    <div class="pv-actions">
      ${hasAlts ? `<button class="pv-btn pv-btn-primary" data-action="alternatives">View Alternatives</button>` : ''}
      ${data.showBurnerEmail ? `<button class="pv-btn pv-btn-secondary" data-action="burner">Use Burner Email</button>` : ''}
      <button class="pv-btn pv-btn-ghost" data-action="dismiss">Dismiss</button>
    </div>

    ${hasAlts ? `<div class="pv-alts" id="pv-alts-panel">
      <div class="pv-alts-label">Privacy-friendly alternatives</div>
      ${data.alternatives.map(a => `
        <div class="pv-alt">
          <div class="pv-alt-dot"></div>
          <div class="pv-alt-info">
            <div class="pv-alt-name">${escapeHtml(a.name)}</div>
            <div class="pv-alt-desc">${escapeHtml(a.description)}</div>
          </div>
          <button class="pv-alt-go" data-url="${escapeHtml(a.url)}">Visit</button>
        </div>
      `).join('')}
    </div>` : ''}

    <div class="pv-progress"><div class="pv-progress-bar" id="pv-progress"></div></div>
  `;

  document.body.appendChild(toast);
  activeToast = toast;

  toast.querySelector('.pv-close')?.addEventListener('click', (e) => { e.stopPropagation(); dismissToast(); });

  toast.querySelectorAll('.pv-btn').forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation();
    handleAction((e.currentTarget as HTMLElement).dataset.action);
  }));

  toast.querySelectorAll('.pv-alt-go').forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const url = (e.currentTarget as HTMLElement).dataset.url;
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  }));

  startAutoDismiss();
}

function startAutoDismiss(): void {
  const bar = document.getElementById('pv-progress');
  const start = Date.now();
  function tick() {
    const r = Math.max(0, 1 - (Date.now() - start) / AUTO_DISMISS_MS);
    if (bar) bar.style.width = `${r * 100}%`;
    if (r > 0 && activeToast) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  autoDismissTimer = setTimeout(dismissToast, AUTO_DISMISS_MS);
}

function handleAction(action: string | undefined): void {
  switch (action) {
    case 'alternatives': {
      const p = document.getElementById('pv-alts-panel');
      if (p) {
        const open = p.classList.toggle('pv-open');
        if (open && autoDismissTimer) { clearTimeout(autoDismissTimer); autoDismissTimer = null; }
      }
      break;
    }
    case 'burner': {
      const el = document.querySelector('input[type="email"], input[name*="email" i], input[autocomplete="email"]') as HTMLInputElement | null;
      if (el) { el.focus(); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      dismissToast();
      break;
    }
    case 'dismiss': dismissToast(); break;
  }
}

function escapeHtml(t: string): string {
  const d = document.createElement('div'); d.textContent = t; return d.innerHTML;
}

export function isToastVisible(): boolean { return activeToast !== null; }
