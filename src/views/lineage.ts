// SPDX-FileCopyrightText: 2026 Ben Richardson
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Qualification lineage: the supersedes / superseded-by chain for a trade, drawn as a
// left-to-right DAG. The thing worth seeing is where EQUIVALENCE BREAKS — a "not
// equivalent" transition means the new qualification demands something materially
// different, which matters to anyone holding the old certificate.

import { loadLineage, loadSupplyIndex } from '../data.ts';
import { clip, debounce, esc, num, tipAttr, year } from '../format.ts';
import { glossaryRef } from '../glossary.ts';
import type { LineageQual } from '../types.ts';
import { attachSvgZoom } from '../utils/svgZoom.ts';
import { emptyState, errorState, legend, loading, viewHead } from '../components/ui.ts';

let selected = '';
let search = '';

export async function renderLineage(root: HTMLElement): Promise<void> {
  root.innerHTML = loading('Loading qualification lineage…');
  try {
    const [{ quals }, supply] = await Promise.all([loadLineage(), loadSupplyIndex()]);
    paint(root, quals, supply);
  } catch (error) {
    root.innerHTML = errorState(error instanceof Error ? error.message : String(error), 'lin-retry');
    root.querySelector('#lin-retry')?.addEventListener('click', () => void renderLineage(root));
  }
}

function paint(root: HTMLElement, quals: LineageQual[], supply: Map<string, unknown>): void {
  const byCode = new Map(quals.map((q) => [q.code, q]));
  const current = quals.filter((q) => q.isCurrent && (q.supersedes.length || q.supersededBy.length));
  const withHistory = [...current].sort((a, b) => chainSize(b, byCode) - chainSize(a, byCode));
  if (!selected || !byCode.has(selected)) selected = withHistory[0]?.code ?? quals[0]?.code ?? '';

  root.innerHTML = `
    ${viewHead(
      'How a qualification changed',
      `Qualifications are reissued every few years. Each new version is marked
       ${glossaryRef('superseded', 'equivalent or not equivalent')} to the one it replaces — and a
       non-equivalent transition means the skills genuinely changed, which matters to anyone holding the
       older certificate.`
    )}

    <div class="controls">
      <div class="field" style="flex:1 1 320px">
        <label class="sr-only" for="lin-search">Find a qualification</label>
        <input type="search" id="lin-search" placeholder="Find a qualification to trace…" value="${esc(search)}" />
      </div>
      <div class="field">
        <label for="lin-pick">Qualification</label>
        <select id="lin-pick"></select>
      </div>
    </div>

    <div class="chart-frame" id="lin-frame"></div>
    ${legend([
      { colour: '#0d7d74', label: 'Equivalent — the skills were judged the same' },
      { colour: '#b45309', label: 'Not equivalent — the requirements materially changed' },
      { colour: '#1d4ed8', label: 'The current version' },
      { colour: '#94a3b8', label: 'A superseded version' },
    ])}
    <p class="view-sub" style="margin-top:.75rem;font-size:var(--fs-sm)">
      Time runs left to right. Scroll to zoom, drag to pan, double-click to reset. Select any node for its record.
    </p>
  `;

  const picker = root.querySelector<HTMLSelectElement>('#lin-pick')!;
  const frame = root.querySelector<HTMLElement>('#lin-frame')!;

  const fillPicker = () => {
    const q = search.toLowerCase();
    const options = withHistory
      .filter((c) => !q || c.title.toLowerCase().includes(q) || c.code.toLowerCase().includes(q))
      .slice(0, 300);
    picker.innerHTML = options.length
      ? options
          .map(
            (c) =>
              `<option value="${esc(c.code)}"${c.code === selected ? ' selected' : ''}>${esc(c.code)} — ${esc(
                clip(c.title, 46)
              )}</option>`
          )
          .join('')
      : '<option value="">No match</option>';
    if (options.length && !options.some((o) => o.code === selected)) {
      selected = options[0].code;
      picker.value = selected;
    }
  };

  const draw = () => {
    const root2 = byCode.get(selected);
    frame.innerHTML = root2 ? build(root2, byCode) : emptyState('Nothing to trace', 'Pick a qualification.');
    const svg = frame.querySelector('svg');
    if (svg) attachSvgZoom(svg);
  };

  fillPicker();
  draw();

  picker.addEventListener('change', () => {
    selected = picker.value;
    draw();
  });

  const input = root.querySelector<HTMLInputElement>('#lin-search')!;
  input.addEventListener(
    'input',
    debounce(() => {
      search = input.value.trim();
      fillPicker();
      draw();
    }, 300)
  );

  void supply;
}

/** How many qualifications are in this one's ancestry — used to pick a good default. */
function chainSize(q: LineageQual, byCode: Map<string, LineageQual>): number {
  const seen = new Set<string>();
  const walk = (code: string, depth: number) => {
    if (depth > 12 || seen.has(code)) return;
    seen.add(code);
    const node = byCode.get(code);
    if (!node) return;
    for (const l of node.supersedes) walk(l.code, depth + 1);
  };
  walk(q.code, 0);
  return seen.size;
}

interface Placed {
  code: string;
  title: string;
  current: boolean;
  when: number | null;
  depth: number;
  x: number;
  y: number;
}

/** Walk the ancestry backwards, laying each generation out in its own column. */
function build(root: LineageQual, byCode: Map<string, LineageQual>): string {
  const generations: string[][] = [];
  const seen = new Set<string>([root.code]);
  const edges: { from: string; to: string; equivalent: boolean }[] = [];

  let frontier = [root.code];
  generations.push([root.code]);

  for (let depth = 0; depth < 10 && frontier.length; depth += 1) {
    const next: string[] = [];
    for (const code of frontier) {
      const node = byCode.get(code);
      if (!node) continue;
      for (const parent of node.supersedes) {
        edges.push({ from: parent.code, to: code, equivalent: parent.equivalent });
        if (seen.has(parent.code)) continue;
        seen.add(parent.code);
        next.push(parent.code);
      }
    }
    if (next.length) generations.push(next);
    frontier = next;
  }

  if (generations.length === 1 && !edges.length) {
    return `<div class="state-block"><div>
      <h3>${esc(root.code)} has no recorded predecessor</h3>
      <p>${esc(root.title)} does not supersede an earlier qualification, so there is no chain to draw.</p>
    </div></div>`;
  }

  // Oldest generation on the left.
  generations.reverse();

  const colWidth = 260;
  const rowHeight = 74;
  const width = Math.max(720, generations.length * colWidth + 80);
  const tallest = Math.max(...generations.map((g) => g.length), 1);
  const height = Math.max(260, tallest * rowHeight + 90);

  const placed = new Map<string, Placed>();
  generations.forEach((generation, column) => {
    const step = height / (generation.length + 1);
    generation.forEach((code, row) => {
      const node = byCode.get(code);
      placed.set(code, {
        code,
        title: node?.title ?? code,
        current: node?.isCurrent ?? false,
        when: year(node?.start ?? null),
        depth: column,
        x: 60 + column * colWidth,
        y: step * (row + 1),
      });
    });
  });

  const lines = edges
    .map((e) => {
      const a = placed.get(e.from);
      const b = placed.get(e.to);
      if (!a || !b) return '';
      const mid = (a.x + b.x) / 2;
      return `<path d="M ${a.x + 96} ${a.y} C ${mid} ${a.y}, ${mid} ${b.y}, ${b.x} ${b.y}"
        fill="none" stroke="${e.equivalent ? '#0d7d74' : '#b45309'}"
        stroke-width="${e.equivalent ? 1.6 : 2.6}" stroke-dasharray="${e.equivalent ? '' : '6 4'}"
        data-tip="${tipAttr(
          `${a.code} → ${b.code}\n${e.equivalent ? 'Equivalent — the skills were judged the same' : 'NOT equivalent — the requirements materially changed'}`
        )}" />`;
    })
    .join('');

  const boxes = [...placed.values()]
    .map(
      (p) => `<g data-qual="${esc(p.code)}" class="lin-node" tabindex="0" role="button"
        aria-label="${esc(p.title)}"
        data-tip="${tipAttr(`${p.title}\n${p.code}\n${p.current ? 'Current version' : 'Superseded'}${p.when ? `\nFrom ${p.when}` : ''}`)}">
        <rect x="${p.x}" y="${p.y - 22}" width="96" height="44" rx="6"
          fill="${p.current ? '#1d4ed8' : '#94a3b8'}" />
        <text x="${p.x + 48}" y="${p.y - 3}" text-anchor="middle" class="lin-code">${esc(p.code)}</text>
        <text x="${p.x + 48}" y="${p.y + 12}" text-anchor="middle" class="lin-year">${p.when ?? ''}</text>
        <text x="${p.x + 48}" y="${p.y + 34}" text-anchor="middle" class="lin-title">${esc(clip(p.title, 26))}</text>
      </g>`
    )
    .join('');

  const breaks = edges.filter((e) => !e.equivalent).length;

  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img"
      aria-label="Lineage of ${esc(root.code)}">
    <style>
      .lin-node { cursor: pointer; }
      .lin-node:hover rect { stroke: #0f1b2d; stroke-width: 2; }
      .lin-code { font: 700 12px var(--font-mono); fill: #fff; }
      .lin-year { font: 500 10px var(--font-sans); fill: rgba(255,255,255,.8); }
      .lin-title { font: 500 10px var(--font-sans); fill: var(--text-secondary); }
    </style>
    <g>${lines}</g>
    <g>${boxes}</g>
    <text x="16" y="${height - 12}" class="lin-title">
      ${num(placed.size)} versions · ${breaks} non-equivalent transition${breaks === 1 ? '' : 's'}
    </text>
  </svg>`;
}
