// SPDX-FileCopyrightText: 2026 Ben Richardson
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Training package × AQF level, shaded by the MEDIAN number of providers per qualification
// in that cell. This is the aggregate cross-tab that shows which corners of the training
// system are richly supplied and which run one provider deep.

import { loadMatrix, loadSupply } from '../data.ts';
import { clip, esc, num, tipAttr } from '../format.ts';
import { glossaryRef } from '../glossary.ts';
import type { MatrixPackage, SupplyRow } from '../types.ts';
import { errorState, legend, loading, viewHead } from '../components/ui.ts';

let sortBy: 'quals' | 'orphans' | 'thinnest' = 'quals';

export async function renderSystem(root: HTMLElement): Promise<void> {
  root.innerHTML = loading('Loading the system matrix…');
  try {
    const [matrix, supply] = await Promise.all([loadMatrix(), loadSupply()]);
    paint(root, matrix.levels, matrix.packages, supply);
  } catch (error) {
    root.innerHTML = errorState(error instanceof Error ? error.message : String(error), 'sys-retry');
    root.querySelector('#sys-retry')?.addEventListener('click', () => void renderSystem(root));
  }
}

const cellColour = (medianProviders: number, orphans: number): string => {
  if (orphans > 0 && medianProviders === 0) return '#9f1239';
  if (medianProviders === 0) return '#c2410c';
  if (medianProviders <= 2) return '#d97706';
  if (medianProviders <= 5) return '#b45309';
  if (medianProviders <= 15) return '#0d9488';
  if (medianProviders <= 40) return '#0f766e';
  return '#1d4ed8';
};

function paint(root: HTMLElement, levels: string[], packages: MatrixPackage[], supply: SupplyRow[]): void {
  root.innerHTML = `
    ${viewHead(
      'The shape of the system',
      `Every ${glossaryRef('trainingPackage', 'training package')} against every
       ${glossaryRef('aqf', 'AQF level')}. Each cell is shaded by the <em>median</em> number of providers per
       qualification in it — so a dark red cell is a corner of the training system that runs one provider deep
       or none at all, regardless of how many qualifications sit there.`
    )}

    <div class="controls">
      <div class="field">
        <label for="sys-sort">Order packages by</label>
        <select id="sys-sort">
          <option value="quals"${sortBy === 'quals' ? ' selected' : ''}>Number of qualifications</option>
          <option value="orphans"${sortBy === 'orphans' ? ' selected' : ''}>Qualifications with no provider</option>
          <option value="thinnest"${sortBy === 'thinnest' ? ' selected' : ''}>Thinnest supply</option>
        </select>
      </div>
    </div>

    <div id="sys-matrix"></div>
    ${legend([
      { colour: '#9f1239', label: 'Median of none — nobody can teach the typical qualification here' },
      { colour: '#d97706', label: 'One or two providers' },
      { colour: '#b45309', label: 'Three to five' },
      { colour: '#0d9488', label: 'Six to fifteen' },
      { colour: '#1d4ed8', label: 'Over forty' },
    ])}
    <p class="view-sub" style="margin-top:.75rem;font-size:var(--fs-sm)">
      A blank cell means the package has no current qualification at that level. Select a cell to see its
      qualifications.
    </p>
  `;

  const host = root.querySelector<HTMLElement>('#sys-matrix')!;
  const draw = () => {
    host.innerHTML = renderMatrix(levels, sorted(packages), supply);
  };
  draw();

  root.querySelector<HTMLSelectElement>('#sys-sort')!.addEventListener('change', (e) => {
    sortBy = (e.target as HTMLSelectElement).value as typeof sortBy;
    draw();
  });

  // Every cell is clickable — a mark that looks interactive must do something.
  host.addEventListener('click', (event) => {
    const cell = (event.target as Element).closest<HTMLElement>('td[data-package][data-level]');
    if (!cell) return;
    const pack = cell.dataset.package!;
    const level = cell.dataset.level!;
    const detail = root.querySelector<HTMLElement>('#sys-detail');
    const rows = supply
      .filter((q) => q.package === pack && q.level === level)
      .sort((a, b) => a.providers - b.providers);
    if (!detail || !rows.length) return;
    detail.innerHTML = `
      <div class="panel-head">
        <div class="panel-title">${esc(pack)} · ${esc(level)}</div>
        <div class="panel-sub">${num(rows.length)} current qualification${rows.length === 1 ? '' : 's'}</div>
      </div>
      <div class="panel-body">
        <div class="table-wrap" style="max-height:20rem">
          <table><thead><tr><th>Qualification</th><th class="num">Providers</th></tr></thead>
          <tbody>${rows
            .map(
              (q) => `<tr class="clickable" data-qual="${esc(q.code)}">
                <td><span class="cell-title">${esc(clip(q.title, 60))}</span>
                    <div class="cell-code">${esc(q.code)}</div></td>
                <td class="num">${num(q.providers)}</td>
              </tr>`
            )
            .join('')}</tbody></table>
        </div>
      </div>`;
    detail.hidden = false;
    detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
}

function sorted(packages: MatrixPackage[]): MatrixPackage[] {
  const orphansIn = (p: MatrixPackage) => Object.values(p.cells).reduce((n, c) => n + c.orphans, 0);
  const medianOf = (p: MatrixPackage) => {
    const medians = Object.values(p.cells).map((c) => c.median);
    return medians.length ? medians.reduce((a, b) => a + b, 0) / medians.length : 0;
  };
  return [...packages].sort((a, b) => {
    if (sortBy === 'orphans') return orphansIn(b) - orphansIn(a) || b.quals - a.quals;
    if (sortBy === 'thinnest') return medianOf(a) - medianOf(b) || b.quals - a.quals;
    return b.quals - a.quals;
  });
}

function renderMatrix(levels: string[], packages: MatrixPackage[], supply: SupplyRow[]): string {
  const used = levels.filter((l) => packages.some((p) => p.cells[l]));

  const rows = packages
    .map((p) => {
      const cells = used
        .map((level) => {
          const cell = p.cells[level];
          if (!cell) return '<td class="num" style="color:var(--text-muted)"></td>';
          const colour = cellColour(cell.median, cell.orphans);
          const examples = supply
            .filter((q) => q.package === p.code && q.level === level)
            .sort((a, b) => a.providers - b.providers)
            .slice(0, 3)
            .map((q) => `  ${q.code} — ${q.providers} provider(s)`)
            .join('\n');
          return `<td class="num clickable" data-package="${esc(p.code)}" data-level="${esc(level)}"
            style="background:${colour};color:#fff;font-weight:650;cursor:pointer"
            data-tip="${tipAttr(
              `${p.code} · ${level}\n${cell.n} qualification${cell.n === 1 ? '' : 's'}\n` +
                `Median providers: ${cell.median}\n` +
                `${cell.orphans} with no provider at all\n\nThinnest:\n${examples}`
            )}">${cell.median}</td>`;
        })
        .join('');

      const orphans = Object.values(p.cells).reduce((n, c) => n + c.orphans, 0);
      return `<tr>
        <td>
          <span class="cell-title">${esc(p.code)}</span>
          <div class="cell-sub">${esc(clip(p.title ?? '', 40))}</div>
        </td>
        <td class="num">${num(p.quals)}</td>
        <td class="num" style="color:${orphans ? 'var(--rose)' : 'var(--text-tertiary)'};font-weight:${
          orphans ? 700 : 400
        }">${orphans || '·'}</td>
        ${cells}
      </tr>`;
    })
    .join('');

  return `<div class="table-wrap">
      <table>
        <thead><tr>
          <th>Package</th><th class="num">Quals</th><th class="num">None</th>
          ${used.map((l) => `<th class="num">${esc(l.replace(/^Certificate /, 'Cert '))}</th>`).join('')}
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="panel" id="sys-detail" style="margin-top:1rem" hidden></div>`;
}
