import type { Check } from './checks/types.js';

export interface Score {
  value: number;
  label: string;
  emoji: string;
}

export function score(checks: Check[]): Score {
  let value = Math.min(100, checks.reduce((sum, c) => sum + c.risk, 0));
  if (checks.some(c => c.critical)) value = Math.max(value, 80);

  if (value >= 80) return { value, label: 'High risk', emoji: '🔴' };
  if (value >= 60) return { value, label: 'Caution', emoji: '🟠' };
  if (value >= 30) return { value, label: 'Medium risk', emoji: '🟡' };
  return { value, label: 'Low risk', emoji: '🟢' };
}
