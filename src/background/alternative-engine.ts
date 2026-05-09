import type { PrivacyAlternative, RiskLevel, PrivacyDataType } from '../types';
import { classifyRisk, getDataType } from '../utils/risk-classifier';
import { logger } from '../utils/logger';

interface AlternativesData {
  alternatives: Record<string, PrivacyAlternative[]>;
  trackerAlternatives: Record<string, PrivacyAlternative[]>;
}

let alternativesData: AlternativesData | null = null;

async function loadAlternatives(): Promise<AlternativesData> {
  if (alternativesData) return alternativesData;

  try {
    const url = chrome.runtime.getURL('data/alternatives.json');
    const response = await fetch(url);
    alternativesData = await response.json();
    logger.debug('AlternativeEngine', 'Alternatives loaded', {
      siteCount: Object.keys(alternativesData!.alternatives).length,
      trackerCount: Object.keys(alternativesData!.trackerAlternatives).length,
    });
    return alternativesData!;
  } catch (error) {
    logger.error('AlternativeEngine', 'Failed to load alternatives data', error as Error);
    alternativesData = { alternatives: {}, trackerAlternatives: {} };
    return alternativesData;
  }
}

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^www\./, '');
}

export async function getAlternatives(domain: string): Promise<PrivacyAlternative[]> {
  const data = await loadAlternatives();
  const normalized = normalizeDomain(domain);

  // Direct match
  if (data.alternatives[normalized]) {
    return data.alternatives[normalized];
  }

  // Partial match (e.g., "mail.google.com" matches "google.com")
  for (const [key, alternatives] of Object.entries(data.alternatives)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return alternatives;
    }
  }

  return [];
}

export async function getTrackerAlternatives(trackerDomain: string): Promise<PrivacyAlternative[]> {
  const data = await loadAlternatives();
  const normalized = normalizeDomain(trackerDomain);

  // Direct match
  if (data.trackerAlternatives[normalized]) {
    return data.trackerAlternatives[normalized];
  }

  // Partial match
  for (const [key, alternatives] of Object.entries(data.trackerAlternatives)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return alternatives;
    }
  }

  return [];
}

export async function classifyAndSuggest(
  domain: string,
  category: string,
  trackerCount: number = 1
): Promise<{
  riskLevel: RiskLevel;
  dataType: PrivacyDataType;
  alternatives: PrivacyAlternative[];
}> {
  const riskLevel = classifyRisk(domain, category, trackerCount);
  const dataType = getDataType(category);

  // Get alternatives for both the site and the tracker
  const siteAlternatives = await getAlternatives(domain);
  const trackerAlts = await getTrackerAlternatives(domain);

  // Combine and deduplicate
  const allAlternatives = [...siteAlternatives];
  for (const alt of trackerAlts) {
    if (!allAlternatives.some(a => a.url === alt.url)) {
      allAlternatives.push(alt);
    }
  }

  return {
    riskLevel,
    dataType,
    alternatives: allAlternatives,
  };
}

export async function initAlternativeEngine(): Promise<void> {
  await loadAlternatives();
}
