export const MAX_DECAY_OCCURRENCES = 4;
export const DEFAULT_DECAY_BASE = 0.5;

interface DecayOptions {
  maxOccurrences?: number;
  base?: number;
}

export function calculateDecayFactor(occurrenceCount: number, options: DecayOptions = {}): number {
  const maxOccurrences =
    typeof options.maxOccurrences === 'number' && Number.isFinite(options.maxOccurrences)
      ? options.maxOccurrences
      : MAX_DECAY_OCCURRENCES;
  const base =
    typeof options.base === 'number' && Number.isFinite(options.base)
      ? options.base
      : DEFAULT_DECAY_BASE;
  const normalizedCount = Number.isFinite(occurrenceCount) ? occurrenceCount : 0;
  const cappedCount = Math.min(Math.max(normalizedCount, 0), Math.max(maxOccurrences, 0));
  return Math.pow(base, cappedCount);
}

export function calculateDecayedPenalty(
  baseRiskWeight: number,
  occurrenceCount: number,
  options: DecayOptions = {}
): number {
  const decayFactor = calculateDecayFactor(occurrenceCount, options);
  return baseRiskWeight * decayFactor;
}

export function getDecayPercentage(occurrenceCount: number, options: DecayOptions = {}): number {
  return calculateDecayFactor(occurrenceCount, options) * 100;
}
