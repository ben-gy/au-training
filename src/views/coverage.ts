// SPDX-FileCopyrightText: 2026 Ben Richardson
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The state-coverage matrix — and, for most readers, the more useful half of the site.
// "No provider anywhere in Australia" is 144 qualifications; "no provider in MY state" is
// around 200, and that is the number that actually stops somebody enrolling.

import { loadSummary, loadSupply } from '../data.ts';
import { STATES, clip, debounce, esc, num, packageColour, pct, tipAttr } from '../format.ts';
import { glossaryRef } from '../glossary.ts';
import type { StateCode, SupplyRow, Summary } from '../types.ts';
import { bar, emptyState, errorState, legend, loading, statRow, table, viewHead } from '../components/ui.ts';

interface State {
  focus: StateCode | 'ALL';
  search: string;
  onlyGaps: boolean;
}

const state: State = { focus: 'ALL', search: '', onlyGaps: true };

const CELL_COLOUR = (n: number): string => {
  if (n === 0) return 'var(--rose)';
  if (n === 1) return '#c2410c';
  if (n <= 3) return '#b45309';
  if (n <= 10) return '#0d7d74';
  if (n <= 40) return '#0f766e';
  return '#1d4ed8';
};

export async function renderCoverage(root: HTMLElement): Promise<void> {
  root.innerHTML = loading('Loading state coverage…');
  try {
    const [summary, rows] = await Promise.all([loadSummary(), loadSupply()]);
    paint(root, summary, rows);
  } catch (error) {
    root.innerHTML = errorState(error instanceof Error ? error.message : String(error), 'cov-retry');
    root.querySelector('#cov-retry')?.addEventListener('click', () => void renderCoverage(root));
  }
}

function paint(root: HTMLElement, summary: Summary, rows: SupplyRow[]): void {
  const worst = [...STATES].sort(
    (a, b) => summary.byState[b].qualsUnavailable - summary.byState[a].qualsUnavailable
  );
  const best = worst[worst.length - 1];
  const maxUnavailable = summary.byState[worst[0]].qualsUnavailable;

  root.innerHTML = `
    ${viewHead(
      'Where you can actually study it',
      `A qualification can be perfectly well supplied nationally and still be impossible to enrol in where you
       live. For every state and territory, this is how many of the ${num(summary.currentQualifications)}
       current qualifications have no provider approved to deliver them there — a
       ${glossaryRef('trainingDesert', 'training desert')}.`
    )}

    ${statRow([
      {
        value: num(summary.orphans),
        label: 'unavailable anywhere in Australia',
        note: 'The national figure',
        tone: 'alert',
      },
      {
        value: num(summary.byState[worst[0]].qualsUnavailable),
        label: `unavailable in ${worst[0]} — the thinnest jurisdiction`,
        note: `${pct(summary.byState[worst[0]].qualsUnavailable, summary.currentQualifications)} of all qualifications`,
        tone: 'warn',
      },
      {
        value: num(summary.byState[best].qualsUnavailable),
        label: `unavailable in ${best} — the best served`,
        note: `${pct(summary.byState[best].qualsUnavailable, summary.currentQualifications)} of all qualifications`,
        tone: 'good',
      },
      {
        value: num(summary.registeredRtos),
        label: 'providers on the register',
        note: `${num(summary.geocodedRtos)} have a mappable head office`,
      },
    ])}

    <div class="panel" style="margin-bottom:1.5rem">
      <div class="panel-head">
        <div class="panel-title">Qualifications with no provider, by jurisdiction</div>
        <div class="panel-sub">Even the best-served state cannot offer around one qualification in six.
          The gap between the largest and smallest jurisdictions is smaller than people expect — the
          constraint is thin national markets, not simply population.</div>
      </div>
      <div class="panel-body">
        ${worst
          .map((s) => {
            const st = summary.byState[s];
            return bar(
              s,
              num(st.qualsUnavailable),
              st.qualsUnavailable / maxUnavailable,
              CELL_COLOUR(st.qualsUnavailable > 210 ? 0 : st.qualsUnavailable > 200 ? 1 : 5),
              `${s}\n${num(st.qualsUnavailable)} of ${num(summary.currentQualifications)} qualifications have no provider here ` +
                `(${pct(st.qualsUnavailable, summary.currentQualifications)})\n` +
                `${num(st.qualsAvailable)} are available\n${num(st.providers)} providers are based here, ` +
                `${num(st.deliverHere)} are approved to deliver here`,
              `data-state="${s}"`
            );
          })
          .join('')}
        ${legend([
          { colour: 'var(--rose)', label: 'Over 210 unavailable' },
          { colour: '#c2410c', label: '200–210' },
          { colour: '#0d7d74', label: 'Under 200' },
        ])}
      </div>
    </div>

    <div class="controls">
      <div class="field" style="flex:1 1 240px">
        <label class="sr-only" for="cov-search">Search qualifications</label>
        <input type="search" id="cov-search" placeholder="Search qualifications…" value="${esc(state.search)}" />
      </div>
      <div class="field">
        <label for="cov-state">Show gaps in</label>
        <select id="cov-state">
          <option value="ALL"${state.focus === 'ALL' ? ' selected' : ''}>Any state</option>
          ${STATES.map(
            (s) => `<option value="${s}"${state.focus === s ? ' selected' : ''}>${s}</option>`
          ).join('')}
        </select>
      </div>
      <div class="chip-row">
        <button type="button" class="chip" id="cov-gaps" aria-pressed="${state.onlyGaps}">Only show gaps</button>
      </div>
    </div>

    <div id="cov-table"></div>
  `;

  const host = root.querySelector<HTMLElement>('#cov-table')!;
  const draw = () => {
    host.innerHTML = renderMatrix(rows);
  };
  draw();

  const search = root.querySelector<HTMLInputElement>('#cov-search')!;
  search.addEventListener(
    'input',
    debounce(() => {
      state.search = search.value.trim().toLowerCase();
      draw();
    }, 300)
  );

  root.querySelector<HTMLSelectElement>('#cov-state')!.addEventListener('change', (e) => {
    state.focus = (e.target as HTMLSelectElement).value as StateCode | 'ALL';
    draw();
  });

  const gaps = root.querySelector<HTMLElement>('#cov-gaps')!;
  gaps.addEventListener('click', () => {
    state.onlyGaps = !state.onlyGaps;
    gaps.setAttribute('aria-pressed', String(state.onlyGaps));
    draw();
  });

  // Clicking a jurisdiction bar focuses the matrix on it — a bar that looks
  // interactive must do something.
  for (const el of root.querySelectorAll<HTMLElement>('[data-state]')) {
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => {
      state.focus = el.dataset.state as StateCode;
      state.onlyGaps = true;
      root.querySelector<HTMLSelectElement>('#cov-state')!.value = state.focus;
      gaps.setAttribute('aria-pressed', 'true');
      draw();
      host.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
}

function filtered(rows: SupplyRow[]): SupplyRow[] {
  let out = rows;
  if (state.onlyGaps) {
    out = out.filter((r) =>
      state.focus === 'ALL'
        ? STATES.some((s) => (r.states[s] ?? 0) === 0)
        : (r.states[state.focus as StateCode] ?? 0) === 0
    );
  }
  if (state.search) {
    const q = state.search;
    out = out.filter((r) => r.title.toLowerCase().includes(q) || r.code.toLowerCase().includes(q));
  }
  return [...out].sort((a, b) => {
    const gapsA = STATES.filter((s) => (a.states[s] ?? 0) === 0).length;
    const gapsB = STATES.filter((s) => (b.states[s] ?? 0) === 0).length;
    return gapsB - gapsA || a.providers - b.providers || a.code.localeCompare(b.code);
  });
}

function renderMatrix(rows: SupplyRow[]): string {
  const shown = filtered(rows);
  if (!shown.length) {
    return emptyState(
      'No gaps match',
      state.onlyGaps
        ? 'Every qualification matching this search has a provider in the selected jurisdiction.'
        : 'Try a different search term.'
    );
  }

  const headers =
    '<th>Qualification</th><th class="num">National</th>' +
    STATES.map((s) => `<th class="num">${s}</th>`).join('');

  const body = shown
    .slice(0, 500)
    .map((r) => {
      const cells = STATES.map((s) => {
        const n = r.states[s] ?? 0;
        return `<td class="num" style="color:${CELL_COLOUR(n)};font-weight:${n === 0 ? 700 : 500}"
          data-tip="${tipAttr(
            `${r.title}\n${s}: ${
              n === 0 ? 'no provider approved to deliver here' : `${n} provider${n === 1 ? '' : 's'}`
            }`
          )}">${n === 0 ? '·' : num(n)}</td>`;
      }).join('');

      return `<tr class="clickable" data-qual="${esc(r.code)}">
        <td>
          <span class="cell-title">${esc(clip(r.title, 56))}</span>
          <div class="cell-code" style="color:${packageColour(r.package)}">${esc(r.code)}</div>
        </td>
        <td class="num" style="font-weight:600">${num(r.providers)}</td>
        ${cells}
      </tr>`;
    })
    .join('');

  return table(
    headers,
    body,
    `A dot means no provider is approved to deliver that qualification in that jurisdiction.
     Showing ${num(Math.min(500, shown.length))} of ${num(shown.length)} qualifications.
     A provider approved to deliver in a state need not have a campus there — distance and online delivery count.`
  );
}
