import type { RiskLevel, PrivacyDataType } from '../types';

const HIGH_RISK_TRACKERS = new Set([
  'fingerprintjs.com',
  'creepjs.com',
  'coinhive.com',
  'cryptoloot.com',
  'coin-hive.com',
]);

const CATEGORY_RISK_MAP: Record<string, RiskLevel> = {
  fingerprinting: 'high',
  cryptomining: 'high',
  malware: 'high',
  advertising: 'medium',
  social: 'medium',
  beacons: 'medium',
  analytics: 'low',
  unknown: 'low',
};

const CATEGORY_DATA_TYPE_MAP: Record<string, PrivacyDataType> = {
  analytics: 'behavioral',
  advertising: 'advertising',
  social: 'social',
  fingerprinting: 'fingerprint',
  beacons: 'behavioral',
  cryptomining: 'unknown',
  malware: 'unknown',
  unknown: 'unknown',
};

export function classifyRisk(
  domain: string,
  category: string,
  trackerCount: number = 1
): RiskLevel {
  // Domain-specific high-risk overrides
  for (const highRisk of HIGH_RISK_TRACKERS) {
    if (domain.includes(highRisk)) {
      return 'high';
    }
  }

  // Category-based risk
  const categoryRisk = CATEGORY_RISK_MAP[category] ?? 'low';

  // Escalate risk if many trackers from same domain
  if (trackerCount >= 5 && categoryRisk === 'low') {
    return 'medium';
  }
  if (trackerCount >= 10 && categoryRisk === 'medium') {
    return 'high';
  }

  return categoryRisk;
}

export function getDataType(category: string): PrivacyDataType {
  return CATEGORY_DATA_TYPE_MAP[category] ?? 'unknown';
}

export function getRiskLabel(level: RiskLevel): string {
  switch (level) {
    case 'high':
      return 'High Risk';
    case 'medium':
      return 'Medium Risk';
    case 'low':
      return 'Low Risk';
  }
}

export function getDataTypeLabel(dataType: PrivacyDataType): string {
  switch (dataType) {
    case 'email':
      return 'Email Address';
    case 'location':
      return 'Location Data';
    case 'behavioral':
      return 'Behavioral Data';
    case 'fingerprint':
      return 'Browser Fingerprint';
    case 'advertising':
      return 'Advertising Data';
    case 'social':
      return 'Social Activity';
    case 'unknown':
      return 'Unknown Data';
  }
}
