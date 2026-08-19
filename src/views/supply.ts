// SPDX-FileCopyrightText: 2026 Ben Richardson
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The default view: every current qualification ranked by how many providers can actually
// teach it, thinnest first. This is where the site's headline lives, so it is also where
// the caveats live — a qualification released last month with no provider yet is not the
// same story as one nobody has been able to teach for eight years.

import { loadSummary, loadSupply } from '../data.ts';
import {
  TIER_COLOUR,
  TIER_LABEL,
  clip,
  debounce,
  esc,
  num,
  packageColour,
  pct,
  tipAttr,
} from '../format.ts';
import { glossaryRef } from '../glossary.ts';
import type { SupplyRow, Summary } from '../types.ts';
import { bar, emptyState, errorState, legend, loading, statRow, table, viewHead } from '../components/ui.ts';

type SortKey = 'providers' | 'title' | 'code' | 'level' | 'package';

interface State {
  search: string;
  tier: string;
  pack: string;
  sort: SortKey;
  desc: boolean;
}

const state: State = { search: '', tier: 'all', pack: 'all', sort: 'providers', desc: false };

export async function renderSupply(root: HTMLElement): Promise<void> {
  root.innerHTML = loading('Loading qualifications…');
  try {
    const [summary, rows] = await Promise.all([loadSummary(), loadSupply()]);
    paint(root, summary, rows);
  } catch (error) {
    root.innerHTML = errorState(error instanceof Error ? error.message : String(error), 'supply-retry');
    root.querySelector('#supply-retry')?.addEventListener('click', () => void renderSupply(root));
  }
}

function paint(root: HTMLElement, summary: Summary, rows: SupplyRow[]): void {
  const packages = [...new Set(rows.map((r) => r.package).filter(Boolean))].sort() as string[];
  const packageTitles = new Map(rows.map((r) => [r.package, r.packageTitle]));

  root.innerHTML = `
    ${viewHead(
      'What can nobody teach?',
      `Australia has ${num(summary.currentQualifications)} current nationally recognised
       ${glossaryRef('qualification', 'qualifications')}. This ranks every one of them by how many
       ${glossaryRef('rto', 'registered training organisations')} currently hold
       ${glossaryRef('scope', 'scope')} to actually deliver it — thinnest markets first.`
    )}

    ${statRow([
      {
        value: num(summary.orphans),
        label: 'have no provider who can teach them',
        note: `${pct(summary.orphans, summary.currentQualifications)} of all current qualifications`,
        tone: 'alert',
        tip:
          'A current, nationally recognised qualification that no registered provider holds live scope to deliver.\n' +
          'You cannot enrol in it anywhere in Australia today.',
      },
      {
        value: num(summary.single),
        label: 'have exactly one provider',
        note: 'One withdrawal from being unavailable',
        tone: 'warn',
      },
      {
        value: num(summary.oneToFive),
        label: 'have between one and five',
        note: `${num(summary.fiveOrFewer)} have five or fewer once the zeros are included`,
        tone: 'warn',
        tip:
          'These two numbers are different populations and are easy to confuse.\n' +
          `One to five: ${num(summary.oneToFive)}. Five or fewer (which includes the ${num(summary.orphans)} with none): ${num(summary.fiveOrFewer)}.`,
      },
      {
        value: num(summary.maxProviders),
        label: `providers for ${esc(summary.maxProvidersCode ?? '')}`,
        note: esc(clip(summary.maxProvidersTitle ?? '', 44)),
        tone: 'good',
        tip: `${summary.maxProvidersTitle}\nThe most heavily supplied qualification in the country. The median is ${summary.medianProviders}.`,
      },
    ])}

    <div class="panel" style="margin-bottom:1.5rem">
      <div class="panel-head">
        <div class="panel-title">How supply is distributed</div>
        <div class="panel-sub">Number of current qualifications in each provider-count band. The market is
          not merely uneven — it is bimodal, with a large cluster of near-unsupplied qualifications and a
          small cluster that hundreds of providers all sell.</div>
      </div>
      <div class="panel-body">${histogram(summary)}</div>
    </div>

    <div class="controls">
      <div class="field" style="flex:1 1 260px">
        <label class="sr-only" for="supply-search">Search qualifications</label>
        <input type="search" id="supply-search" placeholder="Search by title, code or occupation…"
               value="${esc(state.search)}" />
      </div>
      <div class="field">
        <label for="supply-package">Training package</label>
        <select id="supply-package">
          <option value="all">All packages</option>
          ${packages
            .map(
              (p) =>
                `<option value="${esc(p)}"${state.pack === p ? ' selected' : ''}>${esc(p)} — ${esc(
                  clip(packageTitles.get(p) ?? '', 38)
                )}</option>`
            )
            .join('')}
        </select>
      </div>
      <div class="chip-row" role="group" aria-label="Filter by supply">
        ${[
          ['all', 'All'],
          ['none', 'No provider'],
          ['single', 'One provider'],
          ['thin', '2–5'],
          ['moderate', '6–50'],
          ['crowded', '50+'],
        ]
          .map(
            ([id, label]) =>
              `<button type="button" class="chip" data-tier="${id}" aria-pressed="${state.tier === id}">${label}</button>`
          )
          .join('')}
      </div>
    </div>

    <div id="supply-table"></div>
  `;

  const tableHost = root.querySelector<HTMLElement>('#supply-table')!;
  const draw = () => {
    tableHost.innerHTML = renderTable(rows);
  };
  draw();

  const search = root.querySelector<HTMLInputElement>('#supply-search')!;
  search.addEventListener(
    'input',
    debounce(() => {
      state.search = search.value.trim().toLowerCase();
      draw();
    }, 300)
  );

  root.querySelector<HTMLSelectElement>('#supply-package')!.addEventListener('change', (e) => {
    state.pack = (e.target as HTMLSelectElement).value;
    draw();
  });

  for (const chip of root.querySelectorAll<HTMLElement>('[data-tier]')) {
    chip.addEventListener('click', () => {
      state.tier = chip.dataset.tier ?? 'all';
      for (const other of root.querySelectorAll<HTMLElement>('[data-tier]')) {
        other.setAttribute('aria-pressed', String(other === chip));
      }
      draw();
    });
  }

  tableHost.addEventListener('click', (event) => {
    const th = (event.target as Element).closest<HTMLElement>('th.sortable');
    if (!th?.dataset.sort) return;
    const key = th.dataset.sort as SortKey;
    if (state.sort === key) state.desc = !state.desc;
    else {
      state.sort = key;
      state.desc = key === 'providers' ? false : false;
    }
    draw();
  });
}

function histogram(summary: Summary): string {
  const max = Math.max(...summary.histogram.map((b) => b.count), 1);
  return `${summary.histogram
    .map((b) => {
      const colour =
        b.label === '0' ? TIER_COLOUR.none : b.label === '1' ? TIER_COLOUR.single : TIER_COLOUR.moderate;
      return bar(
        `${b.label} provider${b.label === '1' ? '' : 's'}`,
        num(b.count),
        b.count / max,
        colour,
        `${num(b.count)} qualification${b.count === 1 ? '' : 's'} have ${b.label} provider${b.label === '1' ? '' : 's'}\n` +
          `${pct(b.count, summary.currentQualifications)} of all current qualifications`
      );
    })
    .join('')}
    ${legend([
      { colour: TIER_COLOUR.none, label: 'Cannot be taught anywhere' },
      { colour: TIER_COLOUR.single, label: 'A single point of failure' },
      { colour: TIER_COLOUR.moderate, label: 'Has a market' },
    ])}`;
}

function filtered(rows: SupplyRow[]): SupplyRow[] {
  let out = rows;
  if (state.tier !== 'all') out = out.filter((r) => r.tier === state.tier);
  if (state.pack !== 'all') out = out.filter((r) => r.package === state.pack);
  if (state.search) {
    const q = state.search;
    out = out.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.code.toLowerCase().includes(q) ||
        (r.anzsco ?? '').toLowerCase().includes(q) ||
        (r.field ?? '').toLowerCase().includes(q)
    );
  }

  const dir = state.desc ? -1 : 1;
  return [...out].sort((a, b) => {
    switch (state.sort) {
      case 'title':
        return dir * a.title.localeCompare(b.title);
      case 'code':
        return dir * a.code.localeCompare(b.code);
      case 'level':
        return dir * (a.level ?? '').localeCompare(b.level ?? '');
      case 'package':
        return dir * (a.package ?? '').localeCompare(b.package ?? '');
      default:
        return dir * (a.providers - b.providers) || a.code.localeCompare(b.code);
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

function renderTable(rows: SupplyRow[]): string {
  const shown = filtered(rows);
  if (!shown.length) {
    return emptyState('No qualifications match', 'Try a different search term, package or supply band.');
  }

  const body = shown
    .slice(0, 600)
    .map((r) => {
      const notes: string[] = [];
      if (r.providers === 0 && r.isNew) notes.push('released in the last year');
      if (r.providers === 0 && r.confidential) notes.push('confidential — provider list may be withheld');
      if (r.providers === 0 && !r.everSupplied && !r.isNew) notes.push('never had a provider');
      if (r.providers === 0 && r.everSupplied) notes.push('had providers once');
      if (r.assessOnly > 0) notes.push(`${r.assessOnly} can assess only`);

      return `<tr class="clickable" data-qual="${esc(r.code)}">
        <td>
          <span class="cell-title">${esc(clip(r.title, 68))}</span>
          <div class="cell-code" style="color:${packageColour(r.package)}">${esc(r.code)}${
            r.level ? ` · ${esc(r.level)}` : ''
          }</div>
          ${notes.length ? `<div class="cell-sub">${esc(notes.join(' · '))}</div>` : ''}
        </td>
        <td>${esc(r.packageTitle ? clip(r.packageTitle, 30) : '—')}</td>
        <td class="num" data-tip="${tipAttr(
          `${r.title}\n${r.providers} provider${r.providers === 1 ? '' : 's'} can deliver this` +
            (r.assessOnly ? `\n${r.assessOnly} more can assess only` : '')
        )}">${num(r.providers)}</td>
        <td><span class="tier-pill" style="background:${TIER_COLOUR[r.tier]}">${TIER_LABEL[r.tier]}</span></td>
      </tr>`;
    })
    .join('');

  const headers =
    sortHeader('title', 'Qualification') +
    sortHeader('package', 'Package') +
    sortHeader('providers', 'Providers', 'num') +
    '<th>Supply</th>';

  return table(
    headers,
    body,
    `Showing ${num(Math.min(600, shown.length))} of ${num(shown.length)} matching qualifications. Select any row for the full record.`
  );
}
