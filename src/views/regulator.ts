// SPDX-FileCopyrightText: 2026 Ben Richardson
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Regulatory action: what the regulators have done, to whom, under which power, and when.
//
// This is the view that makes adverse statements about named businesses, so it is written
// conservatively: decisions are reproduced verbatim from the register, "in force" is
// defined explicitly and shown, and the interface says plainly that a condition of
// registration is not a finding of wrongdoing.

import { loadProviderIndex, loadRegulatory, loadSummary } from '../data.ts';
import { clip, debounce, esc, longDate, num, tipAttr, year } from '../format.ts';
import { glossaryRef } from '../glossary.ts';
import type { Decision, Provider, Summary } from '../types.ts';
import { bar, emptyState, errorState, loading, statRow, table, viewHead } from '../components/ui.ts';

interface State {
  search: string;
  type: string;
  inForceOnly: boolean;
}

const state: State = { search: '', type: 'all', inForceOnly: true };

export async function renderRegulator(root: HTMLElement): Promise<void> {
  root.innerHTML = loading('Loading regulatory record…');
  try {
    const [summary, regulatory, providers] = await Promise.all([
      loadSummary(),
      loadRegulatory(),
      loadProviderIndex(),
    ]);
    paint(root, summary, regulatory.decisions, providers);
  } catch (error) {
    root.innerHTML = errorState(error instanceof Error ? error.message : String(error), 'reg-retry');
    root.querySelector('#reg-retry')?.addEventListener('click', () => void renderRegulator(root));
  }
}

function paint(root: HTMLElement, summary: Summary, decisions: Decision[], providers: Map<string, Provider>): void {
  const types = Object.keys(summary.decisionTypes);
  const byYear = new Map<number, number>();
  for (const d of decisions) {
    const y = year(d.effective ?? d.start);
    if (y) byYear.set(y, (byYear.get(y) ?? 0) + 1);
  }
  const years = [...byYear.keys()].sort();
  const maxYear = Math.max(...byYear.values(), 1);

  root.innerHTML = `
    ${viewHead(
      'What the regulator has done',
      `Every ${glossaryRef('regulatoryDecision', 'regulatory decision')} and
       ${glossaryRef('restriction', 'restriction')} the register publishes for providers currently carrying one —
       the power it was made under, when it takes effect, and what it requires.`
    )}

    <p class="notice is-warn" style="margin-bottom:1.25rem">
      A regulatory decision is a matter of public record, not a verdict. Most are conditions imposed on a
      provider's registration — often requiring it to report to the regulator — rather than findings of
      misconduct. Read the decision text before drawing a conclusion about any provider, and check
      <a href="https://training.gov.au/" target="_blank" rel="noopener">training.gov.au</a>, which is the
      authoritative and current source.
    </p>

    ${statRow([
      {
        value: num(summary.flaggedProviders),
        label: 'providers under a decision in force',
        note: `of ${num(summary.registeredRtos)} on the register`,
        tone: 'warn',
      },
      {
        value: num(summary.currentDecisionCount),
        label: 'decisions in force',
        note: `${num(summary.decisions)} recorded in total`,
      },
      { value: num(summary.restrictions), label: 'restrictions recorded' },
      {
        value: num(summary.staleNonHistoricDecisions),
        label: 'expired but still marked live upstream',
        note: 'Excluded from the counts above',
        tip:
          'The register\'s own isHistoric flag is stale: some decisions are marked not-historic and "In effect"\n' +
          'with an end date years in the past. Trusting that flag would describe providers as currently\n' +
          'sanctioned long after the condition lapsed, so this site also requires that the end date has not passed.',
      },
    ])}

    <div class="panel" style="margin-bottom:1.5rem">
      <div class="panel-head">
        <div class="panel-title">Decisions by year they took effect</div>
        <div class="panel-sub">This counts decisions held by providers who currently carry at least one —
          it is not a complete history of enforcement, because the register only exposes the decision record
          for providers presently flagged. Read it as the shape of what is live now, not as a trend.</div>
      </div>
      <div class="panel-body">
        ${years
          .map((y) =>
            bar(
              String(y),
              num(byYear.get(y) ?? 0),
              (byYear.get(y) ?? 0) / maxYear,
              'var(--amber)',
              `${y}\n${num(byYear.get(y) ?? 0)} decision${(byYear.get(y) ?? 0) === 1 ? '' : 's'} took effect`
            )
          )
          .join('')}
      </div>
    </div>

    <div class="controls">
      <div class="field" style="flex:1 1 260px">
        <label class="sr-only" for="reg-search">Search decisions</label>
        <input type="search" id="reg-search" placeholder="Search provider or decision text…" value="${esc(state.search)}" />
      </div>
      <div class="field">
        <label for="reg-type">Decision type</label>
        <select id="reg-type">
          <option value="all">All types</option>
          ${types
            .map(
              (t) => `<option value="${esc(t)}"${state.type === t ? ' selected' : ''}>${esc(clip(t, 36))}</option>`
            )
            .join('')}
        </select>
      </div>
      <div class="chip-row">
        <button type="button" class="chip" id="reg-force" aria-pressed="${state.inForceOnly}">In force only</button>
      </div>
    </div>

    <div id="reg-table"></div>
  `;

  const host = root.querySelector<HTMLElement>('#reg-table')!;
  const draw = () => {
    host.innerHTML = renderTable(decisions, providers);
  };
  draw();

  const search = root.querySelector<HTMLInputElement>('#reg-search')!;
  search.addEventListener(
    'input',
    debounce(() => {
      state.search = search.value.trim().toLowerCase();
      draw();
    }, 300)
  );
  root.querySelector<HTMLSelectElement>('#reg-type')!.addEventListener('change', (e) => {
    state.type = (e.target as HTMLSelectElement).value;
    draw();
  });
  const force = root.querySelector<HTMLElement>('#reg-force')!;
  force.addEventListener('click', () => {
    state.inForceOnly = !state.inForceOnly;
    force.setAttribute('aria-pressed', String(state.inForceOnly));
    draw();
  });
}

function renderTable(decisions: Decision[], providers: Map<string, Provider>): string {
  const today = new Date().toISOString().slice(0, 10);
  const inForce = (d: Decision) => !d.historic && (d.end == null || d.end >= today);

  let shown = decisions;
  if (state.inForceOnly) shown = shown.filter(inForce);
  if (state.type !== 'all') shown = shown.filter((d) => d.type === state.type);
  if (state.search) {
    const q = state.search;
    shown = shown.filter(
      (d) =>
        (providers.get(d.rto)?.name ?? '').toLowerCase().includes(q) ||
        (d.decision ?? '').toLowerCase().includes(q) ||
        d.detail.toLowerCase().includes(q) ||
        d.rto.includes(q)
    );
  }

  if (!shown.length) {
    return emptyState('No decisions match', 'Try a different search term or decision type.');
  }

  shown = [...shown].sort((a, b) => (b.effective ?? b.start ?? '').localeCompare(a.effective ?? a.start ?? ''));

  const body = shown
    .slice(0, 400)
    .map((d) => {
      const provider = providers.get(d.rto);
      const live = inForce(d);
      return `<tr class="clickable" data-rto="${esc(d.rto)}">
        <td>
          <span class="cell-title">${esc(clip(provider?.name ?? `Provider ${d.rto}`, 52))}</span>
          <div class="cell-code">${esc(d.rto)}${provider?.state ? ` · ${esc(provider.state)}` : ''}</div>
        </td>
        <td>
          <span class="cell-title">${esc(clip(d.decision ?? '—', 60))}</span>
          <div class="cell-sub">${esc(d.type ?? '')}${d.status ? ` · ${esc(d.status)}` : ''}</div>
        </td>
        <td>${
          d.madeUnderUrl
            ? `<a href="${esc(d.madeUnderUrl)}" target="_blank" rel="noopener" data-tip="${tipAttr(
                d.madeUnder ?? ''
              )}">${esc(clip(d.madeUnder ?? 'legislation', 34))}</a>`
            : esc(clip(d.madeUnder ?? '—', 34))
        }</td>
        <td class="num" data-tip="${tipAttr(
          `Effective ${longDate(d.effective ?? d.start)}\n` +
            `${d.end ? `Ends ${longDate(d.end)}` : 'No end date'}\n` +
            `${live ? 'In force' : 'Not in force'}`
        )}">${longDate(d.effective ?? d.start)}</td>
        <td>${live ? '<span class="flag-pill">in force</span>' : '<span class="cell-sub">ended</span>'}</td>
      </tr>`;
    })
    .join('');

  return table(
    '<th>Provider</th><th>Decision</th><th>Made under</th><th class="num">Effective</th><th>Status</th>',
    body,
    `Showing ${num(Math.min(400, shown.length))} of ${num(shown.length)} decisions. Select a row to read the decision in full.`
  );
}
