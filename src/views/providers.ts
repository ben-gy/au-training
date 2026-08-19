// SPDX-FileCopyrightText: 2026 Ben Richardson
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The lookup workhorse: is this college real, what can it teach, and has the regulator
// done anything to it. Most visitors who arrive with a specific worry end up here.

import { loadProviders, loadSummary } from '../data.ts';
import { STATES, clip, debounce, esc, num, shortDate, tipAttr } from '../format.ts';
import { glossaryRef } from '../glossary.ts';
import type { Provider, Summary } from '../types.ts';
import { emptyState, errorState, loading, statRow, table, viewHead } from '../components/ui.ts';

type SortKey = 'name' | 'scope' | 'state' | 'code' | 'regStart';

interface State {
  search: string;
  region: string;
  regulator: string;
  flaggedOnly: boolean;
  sort: SortKey;
  desc: boolean;
}

const state: State = {
  search: '',
  region: 'all',
  regulator: 'all',
  flaggedOnly: false,
  sort: 'scope',
  desc: true,
};

export async function renderProviders(root: HTMLElement): Promise<void> {
  root.innerHTML = loading('Loading providers…');
  try {
    const [summary, rows] = await Promise.all([loadSummary(), loadProviders()]);
    paint(root, summary, rows);
  } catch (error) {
    root.innerHTML = errorState(error instanceof Error ? error.message : String(error), 'prov-retry');
    root.querySelector('#prov-retry')?.addEventListener('click', () => void renderProviders(root));
  }
}

function paint(root: HTMLElement, summary: Summary, rows: Provider[]): void {
  const regulators = Object.keys(summary.regulators);

  root.innerHTML = `
    ${viewHead(
      'Look up a training provider',
      `Every ${glossaryRef('rto', 'registered training organisation')} on the national register —
       ${num(summary.registeredRtos)} of them. Search by name, provider code or ABN to see what a provider is
       approved to teach, where, and whether the ${glossaryRef('regulator', 'regulator')} has taken any action
       against it.`
    )}

    ${statRow([
      { value: num(summary.registeredRtos), label: 'providers on the register', note: `${num(summary.fullyCurrentRtos)} fully current` },
      {
        value: num(summary.flaggedProviders),
        label: 'have a regulatory decision in force',
        note: `${num(summary.flaggedFullyCurrent)} of them fully registered`,
        tone: 'warn',
        tip:
          'A decision that is not marked historic and whose end date has not passed.\n' +
          'Many are routine conditions of registration, not findings of wrongdoing.',
      },
      {
        value: num(summary.rtosWithNoScope),
        label: 'can teach no current qualification',
        note: 'Scope may be units or skill sets only',
        tip:
          'These providers hold no scope for any current qualification. That is not necessarily a problem —\n' +
          'many legitimately deliver only units of competency, skill sets or accredited courses, which this site does not cover.',
      },
      { value: num(summary.trainingPackages), label: 'training packages covered' },
    ])}

    <div class="controls">
      <div class="field" style="flex:1 1 280px">
        <label class="sr-only" for="prov-search">Search providers</label>
        <input type="search" id="prov-search" placeholder="Provider name, code or ABN…" value="${esc(state.search)}" />
      </div>
      <div class="field">
        <label for="prov-state">State</label>
        <select id="prov-state">
          <option value="all">All</option>
          ${STATES.map((s) => `<option value="${s}"${state.region === s ? ' selected' : ''}>${s}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label for="prov-reg">Regulator</label>
        <select id="prov-reg">
          <option value="all">All</option>
          ${regulators
            .map(
              (r) => `<option value="${esc(r)}"${state.regulator === r ? ' selected' : ''}>${esc(clip(r, 34))}</option>`
            )
            .join('')}
        </select>
      </div>
      <div class="chip-row">
        <button type="button" class="chip" id="prov-flagged" aria-pressed="${state.flaggedOnly}">
          Regulatory action only
        </button>
      </div>
    </div>

    <div id="prov-table"></div>
  `;

  const host = root.querySelector<HTMLElement>('#prov-table')!;
  const draw = () => {
    host.innerHTML = renderTable(rows);
  };
  draw();

  const search = root.querySelector<HTMLInputElement>('#prov-search')!;
  search.addEventListener(
    'input',
    debounce(() => {
      state.search = search.value.trim().toLowerCase();
      draw();
    }, 300)
  );

  root.querySelector<HTMLSelectElement>('#prov-state')!.addEventListener('change', (e) => {
    state.region = (e.target as HTMLSelectElement).value;
    draw();
  });
  root.querySelector<HTMLSelectElement>('#prov-reg')!.addEventListener('change', (e) => {
    state.regulator = (e.target as HTMLSelectElement).value;
    draw();
  });

  const flagged = root.querySelector<HTMLElement>('#prov-flagged')!;
  flagged.addEventListener('click', () => {
    state.flaggedOnly = !state.flaggedOnly;
    flagged.setAttribute('aria-pressed', String(state.flaggedOnly));
    draw();
  });

  host.addEventListener('click', (event) => {
    const th = (event.target as Element).closest<HTMLElement>('th.sortable');
    if (!th?.dataset.sort) return;
    const key = th.dataset.sort as SortKey;
    if (state.sort === key) state.desc = !state.desc;
    else {
      state.sort = key;
      state.desc = key === 'scope';
    }
    draw();
  });
}

function filtered(rows: Provider[]): Provider[] {
  let out = rows;
  if (state.region !== 'all') out = out.filter((p) => p.state === state.region);
  if (state.regulator !== 'all') out = out.filter((p) => p.regulator === state.regulator);
  if (state.flaggedOnly) out = out.filter((p) => p.currentDecisions > 0);
  if (state.search) {
    const q = state.search;
    out = out.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.code.includes(q) ||
        (p.abn ?? '').includes(q.replace(/\s/g, '')) ||
        p.tradingNames.some((t) => t.toLowerCase().includes(q))
    );
  }

  const dir = state.desc ? -1 : 1;
  return [...out].sort((a, b) => {
    switch (state.sort) {
      case 'scope':
        return dir * (a.scope - b.scope) || a.name.localeCompare(b.name);
      case 'state':
        return dir * (a.state ?? '').localeCompare(b.state ?? '');
      case 'code':
        return dir * a.code.localeCompare(b.code);
      case 'regStart':
        return dir * (a.regInitial ?? '').localeCompare(b.regInitial ?? '');
      default:
        return dir * a.name.localeCompare(b.name);
    }
  });
}

function sortHeader(key: SortKey, label: string, cls = ''): string {
  const active = state.sort === key;
  const mark = active ? `<span class="sort-mark">${state.desc ? '▼' : '▲'}</span>` : '';
  return `<th class="sortable ${cls}" data-sort="${key}" aria-sort="${
    active ? (state.desc ? 'descending' : 'ascending') : 'none'
  }">${label}${mark}</th>`;
}

function renderTable(rows: Provider[]): string {
  const shown = filtered(rows);
  if (!shown.length) {
    return emptyState('No providers match', 'Try a different name, code, state or regulator.');
  }

  const body = shown
    .slice(0, 500)
    .map(
      (p) => `<tr class="clickable" data-rto="${esc(p.code)}">
        <td>
          <span class="cell-title">${esc(clip(p.name, 62))}</span>
          ${p.currentDecisions > 0 ? '<span class="flag-pill">regulator action</span>' : ''}
          ${p.status !== 'current' ? `<span class="flag-pill">${esc(p.statusLabel ?? p.status ?? '')}</span>` : ''}
          <div class="cell-code">${esc(p.code)}${p.abn ? ` · ABN ${esc(p.abn)}` : ''}</div>
          ${p.tradingNames.length ? `<div class="cell-sub">trading as ${esc(clip(p.tradingNames.join(', '), 54))}</div>` : ''}
        </td>
        <td>${esc(p.suburb ? `${clip(p.suburb, 20)}, ` : '')}${esc(p.state ?? '—')}</td>
        <td class="num" data-tip="${tipAttr(
          `${p.name}\nApproved to deliver ${p.scope} current qualification${p.scope === 1 ? '' : 's'}` +
            `\nDelivers in: ${p.deliversIn.join(', ') || 'no state recorded'}`
        )}">${num(p.scope)}</td>
        <td class="num">${shortDate(p.regInitial)}</td>
      </tr>`
    )
    .join('');

  const headers =
    sortHeader('name', 'Provider') +
    sortHeader('state', 'Location') +
    sortHeader('scope', 'Qualifications', 'num') +
    sortHeader('regStart', 'Registered since', 'num');

  return table(
    headers,
    body,
    `Showing ${num(Math.min(500, shown.length))} of ${num(shown.length)} providers. Select any row for the full record.`
  );
}
