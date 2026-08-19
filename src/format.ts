// SPDX-FileCopyrightText: 2026 Ben Richardson
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { StateCode, SupplyTier } from './types.ts';

export const STATES: StateCode[] = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT'];

const numberFormat = new Intl.NumberFormat('en-AU');

export function num(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return numberFormat.format(value);
}

export function pct(part: number, whole: number, digits = 1): string {
  if (!whole || !Number.isFinite(part / whole)) return '—';
  return `${((part / whole) * 100).toFixed(digits)}%`;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Dates arrive as YYYY-MM-DD. Parse them by hand: `new Date('2025-06-30')` is UTC
 *  midnight, which renders as the previous day for anyone west of Greenwich. */
export function longDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return '—';
  const [, y, mo, d] = m;
  return `${Number(d)} ${MONTHS[Number(mo) - 1]} ${y}`;
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return '—';
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export function year(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const m = /^(\d{4})/.exec(iso);
  return m ? Number(m[1]) : null;
}

export const TIER_LABEL: Record<SupplyTier, string> = {
  none: 'No provider',
  single: 'One provider',
  thin: '2–5 providers',
  moderate: '6–50 providers',
  crowded: 'Over 50 providers',
};

export const TIER_ORDER: SupplyTier[] = ['none', 'single', 'thin', 'moderate', 'crowded'];

/** Escape for insertion into innerHTML. */
export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escape for a data-tip attribute written via innerHTML.
 *
 *  Two different escapings are needed for tooltips and mixing them up is a real bug:
 *  `setAttribute` takes a RAW newline, but text going through innerHTML needs `&#10;`
 *  or the attribute is truncated at the newline. This is the innerHTML variant. */
export function tipAttr(value: unknown): string {
  return esc(value).replace(/\n/g, '&#10;');
}

/** Truncate for display without cutting mid-entity. */
export function clip(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trimEnd()}…`;
}

/** Slug-safe id for use in element ids and hashes. */
export function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Stable colour per training package, so a package is the same colour everywhere. */
const PACKAGE_PALETTE = [
  '#2563eb', '#0d9488', '#c2410c', '#7c3aed', '#0369a1',
  '#b45309', '#be123c', '#15803d', '#4338ca', '#a16207',
  '#0891b2', '#9333ea', '#dc2626', '#059669', '#d97706',
];

export function packageColour(code: string | null | undefined): string {
  if (!code) return '#94a3b8';
  let hash = 0;
  for (let i = 0; i < code.length; i += 1) hash = (hash * 31 + code.charCodeAt(i)) >>> 0;
  return PACKAGE_PALETTE[hash % PACKAGE_PALETTE.length];
}

/** Supply tier colour. Deliberately NOT a red-to-green "good/bad" ramp: a qualification
 *  with one provider is not a failure, it is a thin market, and one with 800 is not a
 *  success. The ramp runs scarce → abundant. */
export const TIER_COLOUR: Record<SupplyTier, string> = {
  none: '#9f1239',
  single: '#c2410c',
  thin: '#b45309',
  moderate: '#0d9488',
  crowded: '#1d4ed8',
};

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: A) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
