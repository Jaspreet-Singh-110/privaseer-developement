type PatternSet = {
  accept: string[];
  reject: string[];
  preferences: string[];
};

const DEFAULT_LANGUAGE = 'en';

const BUTTON_PATTERNS: Record<string, PatternSet> = {
  en: {
    accept: ['accept all', 'accept cookies', 'allow all', 'agree', 'i accept', 'consent', 'ok', 'got it', 'continue'],
    reject: [
      'reject all',
      'reject cookies',
      'decline all',
      'deny all',
      'refuse all',
      'opt out',
      'necessary only',
      'essential only',
      'no thanks',
      'disable all',
      'do not sell',
      'only required',
    ],
    preferences: ['manage preferences', 'customize', 'settings', 'preferences', 'manage cookies'],
  },
  fr: {
    accept: ['tout accepter', 'accepter', "j'accepte", "d'accord", 'continuer'],
    reject: ['tout refuser', 'refuser', 'rejeter', 'tout rejeter', 'refuser tout'],
    preferences: ['parametres', 'preferences', 'personnaliser', 'gerer'],
  },
  de: {
    accept: ['alle akzeptieren', 'akzeptieren', 'zustimmen', 'einverstanden', 'weiter'],
    reject: ['alle ablehnen', 'ablehnen', 'verweigern', 'alles ablehnen'],
    preferences: ['einstellungen', 'praferenzen', 'anpassen', 'verwalten'],
  },
  es: {
    accept: ['aceptar todo', 'aceptar', 'de acuerdo', 'continuar'],
    reject: ['rechazar todo', 'rechazar', 'denegar', 'rechazar todas'],
    preferences: ['configuracion', 'preferencias', 'personalizar', 'gestionar'],
  },
  it: {
    accept: ['accetta tutto', 'accetta', 'accetto', 'continua'],
    reject: ['rifiuta tutto', 'rifiuta', 'nega', 'rifiuta tutti'],
    preferences: ['impostazioni', 'preferenze', 'personalizza', 'gestisci'],
  },
  nl: {
    accept: ['alles accepteren', 'accepteren', 'akkoord', 'doorgaan'],
    reject: ['alles weigeren', 'weigeren', 'afwijzen'],
    preferences: ['instellingen', 'voorkeuren', 'aanpassen', 'beheren'],
  },
  pt: {
    accept: ['aceitar tudo', 'aceitar', 'concordo', 'continuar'],
    reject: ['rejeitar tudo', 'rejeitar', 'recusar'],
    preferences: ['configuracoes', 'preferencias', 'personalizar', 'gerir'],
  },
  pl: {
    accept: ['zaakceptuj wszystko', 'zaakceptuj', 'zgadzam sie', 'kontynuuj'],
    reject: ['odrzuc wszystko', 'odrzuc', 'odmow'],
    preferences: ['ustawienia', 'preferencje', 'dostosuj', 'zarzadzaj'],
  },
  sv: {
    accept: ['acceptera alla', 'acceptera', 'godkann', 'fortsatt'],
    reject: ['avvisa alla', 'avvisa', 'neka'],
    preferences: ['installningar', 'preferenser', 'anpassa', 'hantera'],
  },
  da: {
    accept: ['accepter alle', 'accepter', 'godkend', 'fortsaet'],
    reject: ['afvis alle', 'afvis', 'afsla'],
    preferences: ['indstillinger', 'praeferencer', 'tilpas', 'administrer'],
  },
  no: {
    accept: ['godta alle', 'godta', 'aksepter', 'fortsett'],
    reject: ['avslatt alle', 'avslatt', 'avvis'],
    preferences: ['innstillinger', 'preferanser', 'tilpass', 'administrer'],
  },
  fi: {
    accept: ['hyvaksy kaikki', 'hyvaksy', 'jatka'],
    reject: ['hylkaa kaikki', 'hylkaa', 'kielto'],
    preferences: ['asetukset', 'mieltymykset', 'muokkaa', 'hallinnoi'],
  },
  cs: {
    accept: ['prijmout vse', 'prijmout', 'souhlasim', 'pokracovat'],
    reject: ['odmitnout vse', 'odmitnout', 'odmitam'],
    preferences: ['nastaveni', 'predvolby', 'upravit', 'spravovat'],
  },
  ro: {
    accept: ['accepta tot', 'accepta', 'sunt de acord', 'continua'],
    reject: ['refuza tot', 'refuza', 'respinge'],
    preferences: ['setari', 'preferinte', 'personalizeaza', 'gestioneaza'],
  },
  hu: {
    accept: ['osszes elfogadasa', 'elfogadom', 'elfogad'],
    reject: ['osszes elutasitasa', 'elutasit', 'elutasitom'],
    preferences: ['beallitasok', 'preferenciak', 'testreszab', 'kezeles'],
  },
  el: {
    accept: ['apodoxi olon', 'apodoxi', 'symfono', 'synexise'],
    reject: ['aporripsi olon', 'aporripsi', 'arnoumai'],
    preferences: ['rythmiseis', 'protimiseis', 'prosarmogi'],
  },
  tr: {
    accept: ['tumunu kabul et', 'kabul et', 'kabul ediyorum', 'devam et'],
    reject: ['tumunu reddet', 'reddet', 'kabul etme'],
    preferences: ['ayarlar', 'tercihler', 'ozellestir', 'yonet'],
  },
  ja: {
    accept: ['すべて同意', '同意する', '同意', '許可', '受け入れる'],
    reject: ['すべて拒否', '拒否する', '拒否', '同意しない'],
    preferences: ['設定', '詳細設定', 'カスタマイズ', '選択する'],
  },
  ko: {
    accept: ['모두 동의', '동의', '수락', '허용'],
    reject: ['모두 거부', '거부', '동의 안 함', '거절'],
    preferences: ['설정', '기본 설정', '맞춤 설정', '관리'],
  },
  zh: {
    accept: ['全部接受', '同意', '允许', '接受'],
    reject: ['全部拒绝', '拒绝', '不同意'],
    preferences: ['设置', '偏好设置', '自定义', '管理'],
  },
  'zh-hant': {
    accept: ['全部接受', '同意', '允許', '接受'],
    reject: ['全部拒絕', '拒絕', '不同意'],
    preferences: ['設定', '偏好設定', '自訂', '管理'],
  },
};

const normalizeText = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

const normalizeLanguage = (lang: string | null | undefined): string => {
  if (!lang) return DEFAULT_LANGUAGE;
  const normalized = lang.toLowerCase().trim();
  if (normalized.startsWith('zh-hant') || normalized.includes('zh-hant')) return 'zh-hant';
  return normalized.split('-')[0] || DEFAULT_LANGUAGE;
};

export const detectPageLanguage = (): string => {
  const htmlLang = normalizeLanguage(document.documentElement.lang);
  if (htmlLang) return htmlLang;

  const metaLang =
    document.querySelector('meta[name="language"]')?.getAttribute('content') ??
    document.querySelector('meta[http-equiv="content-language"]')?.getAttribute('content');

  return normalizeLanguage(metaLang);
};

export const getLocalizedPatterns = (lang: string): PatternSet => {
  const normalized = normalizeLanguage(lang);
  return BUTTON_PATTERNS[normalized] ?? BUTTON_PATTERNS[DEFAULT_LANGUAGE];
};

export const matchesAnyPattern = (text: string, patterns: string[]): boolean => {
  const normalized = normalizeText(text);
  return patterns.some((pattern) => normalized.includes(normalizeText(pattern)));
};

export { BUTTON_PATTERNS };
