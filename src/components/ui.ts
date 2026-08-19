// SPDX-FileCopyrightText: 2026 Ben Richardson
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Small shared render helpers. Every one returns HTML strings so views can compose a
// whole page in one innerHTML assignment rather than a hundred appendChild calls.

import { esc, tipAttr } from '../format.ts';

export interface StatSpec {
  value: string;
  label: string;
  note?: string;
  tone?: 'alert' | 'warn' | 'good';
  tip?: string;
}

export function statRow(stats: StatSpec[]): string {
  return `<div class="stat-row">${stats
    .map(
      (s) => `<div class="stat${s.tone ? ` is-${s.tone}` : ''}"${s.tip ? ` data-tip="${tipAttr(s.tip)}"` : ''}>
        <div class="stat-value">${esc(s.value)}</div>
        <div class="stat-label">${s.label}</div>
        ${s.note ? `<div class="stat-note">${s.note}</div>` : ''}
      </div>`
    )
    .join('')}</div>`;
}

export function viewHead(title: string, sub: string): string {
  return `<header class="view-head">
    <h1 class="view-title">${title}</h1>
    <p class="view-sub">${sub}</p>
  </header>`;
}

export function loading(label = 'Loading…'): string {
  return `<div class="state-block">
    <div>
      <div class="skeleton" style="width:min(420px,80vw);height:14px;margin:0 auto 10px"></div>
      <div class="skeleton" style="width:min(320px,66vw);height:14px;margin:0 auto 10px"></div>
      <div class="skeleton" style="width:min(380px,72vw);height:14px;margin:0 auto"></div>
      <p style="margin-top:1rem">${esc(label)}</p>
    </div>
  </div>`;
}

export function errorState(message: string, retryId = 'retry'): string {
  return `<div class="state-block">
    <div>
      <h3>Could not load this view</h3>
      <p>${esc(message)}</p>
      <button type="button" class="retry-button" id="${esc(retryId)}">Try again</button>
    </div>
  </div>`;
}

export function emptyState(title: string, message: string): string {
  return `<div class="state-block">
    <div>
      <h3>${esc(title)}</h3>
      <p>${esc(message)}</p>
    </div>
  </div>`;
}

/** A horizontal bar with a label, a value and a track. The fill is a block element —
 *  a width percentage on a bare inline <span> renders nothing at all. */
export function bar(
  label: string,
  value: string,
  fraction: number,
  colour: string,
  tip: string,
  attrs = ''
): string {
  const width = Math.max(0, Math.min(100, fraction * 100));
  return `<div class="bar-row" data-tip="${tipAttr(tip)}" ${attrs}>
    <span class="bar-label">${esc(label)}</span>
    <span class="bar-value">${esc(value)}</span>
    <span class="bar-track"><span class="bar-fill" style="width:${width.toFixed(2)}%;background:${colour}"></span></span>
  </div>`;
}

export function legend(items: { colour: string; label: string }[]): string {
  return `<div class="legend">${items
    .map(
      (i) =>
        `<span class="legend-item"><span class="legend-swatch" style="background:${i.colour}"></span>${esc(i.label)}</span>`
    )
    .join('')}</div>`;
}

/** Render a table with a sticky head. `rows` are pre-rendered <tr> strings. */
export function table(headers: string, rows: string, note?: string): string {
  return `<div class="table-wrap">
      <table>
        <thead><tr>${headers}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${note ? `<p class="view-sub" style="margin-top:.5rem;font-size:var(--fs-sm)">${note}</p>` : ''}`;
}
