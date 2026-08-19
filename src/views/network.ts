// SPDX-FileCopyrightText: 2026 Ben Richardson
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The bipartite delivery graph: qualifications on one side, the providers that can teach
// them on the other. Filtered to one training package at a time — the whole graph is
// ~29,000 edges and a uniform dot-cloud of that size answers no question at all.
//
// The layout is run to completion synchronously before any DOM is created, so the graph is
// motionless from the first frame. Anchoring: qualifications are pinned on a vertical
// spine ordered by supply, providers settle around them. That structure is what turns a
// hairball into a readable picture of market concentration.

import { loadNetwork, loadProviderIndex, loadSupply } from '../data.ts';
import { clip, esc, num, packageColour, tipAttr } from '../format.ts';
import { glossaryRef } from '../glossary.ts';
import type { Provider, SupplyRow } from '../types.ts';
import { forceLayout, mulberry32, type SimLink, type SimNode } from '../utils/forceLayout.ts';
import { attachSvgZoom } from '../utils/svgZoom.ts';
import { errorState, legend, loading, viewHead } from '../components/ui.ts';

const W = 1200;
const MIN_H = 620;
/** Beyond this the SVG is scaled down to fit and the extra height buys nothing. */
const MAX_H = 1100;
/** Vertical room each qualification needs on the spine before its label is legible. */
const ROW_PITCH = 19;
/** Below this spacing a label collides with its neighbour, so it is suppressed. */
const LABEL_MIN_PITCH = 13;

let chosen = '';

interface Node extends SimNode {
  id: string;
  label: string;
  kind: 'qual' | 'rto';
  degree: number;
  fixed?: boolean;
}

export async function renderNetwork(root: HTMLElement): Promise<void> {
  root.innerHTML = loading('Loading the delivery graph…');
  try {
    const [{ edges }, supply, providers] = await Promise.all([
      loadNetwork(),
      loadSupply(),
      loadProviderIndex(),
    ]);
    paint(root, edges, supply, providers);
  } catch (error) {
    root.innerHTML = errorState(error instanceof Error ? error.message : String(error), 'net-retry');
    root.querySelector('#net-retry')?.addEventListener('click', () => void renderNetwork(root));
  }
}

function paint(
  root: HTMLElement,
  edges: [string, string][],
  supply: SupplyRow[],
  providers: Map<string, Provider>
): void {
  const packages = new Map<string, { title: string; quals: number }>();
  for (const q of supply) {
    if (!q.package) continue;
    const entry = packages.get(q.package) ?? { title: q.packageTitle ?? q.package, quals: 0 };
    entry.quals += 1;
    packages.set(q.package, entry);
  }
  const options = [...packages.entries()].sort((a, b) => b[1].quals - a[1].quals);
  if (!chosen || !packages.has(chosen)) chosen = options[0]?.[0] ?? '';

  root.innerHTML = `
    ${viewHead(
      'Who teaches what',
      `Each ${glossaryRef('trainingPackage', 'training package')} as a two-sided graph: qualifications down the
       centre, and the ${glossaryRef('rto', 'providers')} approved to deliver them arranged around. A
       qualification with one lonely satellite is a single point of failure; the dense clusters are where
       hundreds of providers all sell the same thing.`
    )}

    <div class="controls">
      <div class="field">
        <label for="net-package">Training package</label>
        <select id="net-package">
          ${options
            .map(
              ([code, meta]) =>
                `<option value="${esc(code)}"${code === chosen ? ' selected' : ''}>${esc(code)} — ${esc(
                  clip(meta.title, 44)
                )} (${meta.quals})</option>`
            )
            .join('')}
        </select>
      </div>
      <span class="view-sub" id="net-summary"></span>
    </div>

    <div class="chart-frame" id="net-frame"></div>
    ${legend([
      { colour: '#1d4ed8', label: 'Qualification' },
      { colour: 'var(--rose)', label: 'Qualification nobody can teach' },
      { colour: '#0d7d74', label: 'Provider' },
      { colour: 'var(--amber)', label: 'Provider under a regulatory decision' },
    ])}
    <p class="view-sub" style="margin-top:.75rem;font-size:var(--fs-sm)">
      Scroll to zoom, drag to pan, double-click to reset. Select any node to open its full record.
      Providers appear once per package, so a provider active in several packages appears in several graphs.
    </p>
  `;

  const frame = root.querySelector<HTMLElement>('#net-frame')!;
  const summary = root.querySelector<HTMLElement>('#net-summary')!;

  const draw = () => {
    const qualSet = new Set(supply.filter((q) => q.package === chosen).map((q) => q.code));
    const scoped = edges.filter(([q]) => qualSet.has(q));
    frame.innerHTML = build(scoped, qualSet, supply, providers);
    summary.textContent = `${num(qualSet.size)} qualifications · ${num(
      new Set(scoped.map(([, r]) => r)).size
    )} providers · ${num(scoped.length)} teaching relationships`;
    const svg = frame.querySelector('svg');
    if (svg) attachSvgZoom(svg);
  };
  draw();

  root.querySelector<HTMLSelectElement>('#net-package')!.addEventListener('change', (e) => {
    chosen = (e.target as HTMLSelectElement).value;
    draw();
  });

  // Selecting a node highlights its neighbourhood as well as opening the record —
  // a click that only opens a panel wastes the visualisation.
  frame.addEventListener('pointerdown', (event) => {
    const node = (event.target as Element).closest<SVGElement>('[data-node]');
    const svg = frame.querySelector('svg');
    if (!svg) return;
    if (!node) {
      svg.querySelectorAll('.dim').forEach((el) => el.classList.remove('dim'));
      return;
    }
    const id = node.getAttribute('data-node')!;
    const related = new Set<string>([id]);
    for (const line of svg.querySelectorAll<SVGLineElement>('line[data-a]')) {
      const a = line.getAttribute('data-a')!;
      const b = line.getAttribute('data-b')!;
      if (a === id) related.add(b);
      else if (b === id) related.add(a);
    }
    for (const el of svg.querySelectorAll<SVGElement>('[data-node]')) {
      el.classList.toggle('dim', !related.has(el.getAttribute('data-node')!));
    }
    for (const line of svg.querySelectorAll<SVGLineElement>('line[data-a]')) {
      const touches = line.getAttribute('data-a') === id || line.getAttribute('data-b') === id;
      line.classList.toggle('dim', !touches);
    }
  });
}

function build(
  edges: [string, string][],
  qualSet: Set<string>,
  supply: SupplyRow[],
  providers: Map<string, Provider>
): string {
  const qualRows = supply.filter((q) => qualSet.has(q.code)).sort((a, b) => a.providers - b.providers);
  const rtoCodes = [...new Set(edges.map(([, r]) => r))];

  if (!qualRows.length) return '<p class="state-block">Nothing to draw for this package.</p>';

  // The canvas grows with the package so the spine keeps a legible pitch. A fixed height
  // packed 79 qualifications into ~9px each and the labels overlapped into a grey smear.
  const spineTop = 56;
  const H = Math.min(MAX_H, Math.max(MIN_H, qualRows.length * ROW_PITCH + spineTop * 2));
  const spineGap = qualRows.length > 1 ? (H - 2 * spineTop) / (qualRows.length - 1) : 0;

  const nodes: Node[] = [];
  const index = new Map<string, number>();

  // Qualifications are PINNED on a central spine, ordered by supply. This is the anchor
  // that stops the graph collapsing into a structureless cloud.
  qualRows.forEach((q, i) => {
    index.set(q.code, nodes.length);
    nodes.push({
      id: q.code,
      label: q.code,
      kind: 'qual',
      degree: q.providers,
      x: W / 2,
      y: qualRows.length > 1 ? spineTop + i * spineGap : H / 2,
      r: Math.max(6, Math.min(20, 5 + Math.sqrt(q.providers) * 1.5)),
      fixed: true,
    });
  });

  const rand = mulberry32(0x5eed);
  for (const code of rtoCodes) {
    index.set(code, nodes.length);
    const side = rand() < 0.5 ? -1 : 1;
    nodes.push({
      id: code,
      label: providers.get(code)?.name ?? code,
      kind: 'rto',
      degree: 0,
      x: W / 2 + side * (120 + rand() * 420),
      y: 60 + rand() * (H - 120),
      r: 3.2,
    });
  }

  const links: SimLink[] = [];
  for (const [q, r] of edges) {
    const a = index.get(q);
    const b = index.get(r);
    if (a == null || b == null) continue;
    links.push({ source: a, target: b });
    nodes[b].degree += 1;
  }

  // Settle to completion BEFORE any DOM exists. The graph must be motionless on first paint.
  forceLayout(nodes, links, {
    width: W,
    height: H,
    iterations: 220,
    cutoff: 70,
    linkDistance: 46,
    linkStrength: 0.16,
    gravity: 0.02,
    timeBudgetMs: 900,
  });

  // Re-pin the spine: forceLayout does not know about `fixed`.
  qualRows.forEach((q, i) => {
    const n = nodes[index.get(q.code)!];
    n.x = W / 2;
    n.y = qualRows.length > 1 ? spineTop + i * spineGap : H / 2;
  });

  const lines = links
    .map((l) => {
      const a = nodes[l.source];
      const b = nodes[l.target];
      return `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(
        1
      )}" data-a="${esc(a.id)}" data-b="${esc(b.id)}" />`;
    })
    .join('');

  const rtoDots = nodes
    .filter((n) => n.kind === 'rto')
    .map((n) => {
      const p = providers.get(n.id);
      const flagged = (p?.currentDecisions ?? 0) > 0;
      return `<circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${flagged ? 4.6 : 3.2}"
        fill="${flagged ? 'var(--amber)' : '#0d7d74'}" class="net-node" data-node="${esc(n.id)}" data-rto="${esc(n.id)}"
        data-tip="${tipAttr(
          `${p?.name ?? n.id}\n${n.degree} qualification${n.degree === 1 ? '' : 's'} in this package` +
            (p?.state ? `\n${p.state}` : '') +
            (flagged ? '\nUnder a regulatory decision in force' : '')
        )}" tabindex="0" role="button" aria-label="${esc(p?.name ?? n.id)}" />`;
    })
    .join('');

  // Label only what can be read. Where the spine is crowded, label the ends of the
  // distribution — the qualifications nobody can teach, and the handful everybody sells —
  // because those are the ones the view exists to show. Everything else labels on hover.
  const roomy = spineGap >= LABEL_MIN_PITCH || qualRows.length === 1;
  const alwaysLabel = new Set<string>([
    ...qualRows.filter((q) => q.providers === 0).slice(0, 6).map((q) => q.code),
    ...qualRows.slice(-4).map((q) => q.code),
  ]);

  const qualMarks = qualRows
    .map((q) => {
      const n = nodes[index.get(q.code)!];
      const colour = q.providers === 0 ? 'var(--rose)' : packageColour(q.package);
      const label =
        roomy || alwaysLabel.has(q.code)
          ? `<text x="${(n.x + n.r + 6).toFixed(1)}" y="${(n.y + 3.5).toFixed(1)}" class="net-label">${esc(
              clip(q.title, 34)
            )}</text>`
          : '';
      return `<g data-node="${esc(q.code)}" data-qual="${esc(q.code)}" class="net-node" tabindex="0" role="button"
        aria-label="${esc(q.title)}"
        data-tip="${tipAttr(
          `${q.title}\n${q.code}\n${
            q.providers === 0 ? 'No provider can teach this' : `${q.providers} provider(s) can teach this`
          }`
        )}">
        <circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${n.r.toFixed(1)}" fill="${colour}" stroke="#fff" stroke-width="1.4" />
        ${label}
      </g>`;
    })
    .join('');

  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img"
      aria-label="Bipartite graph of qualifications and the providers approved to deliver them">
    <style>
      .net-node { cursor: pointer; }
      .net-node:hover circle { stroke: #0f1b2d; stroke-width: 2; }
      .net-label { font: 500 11px var(--font-sans); fill: var(--text-secondary); pointer-events: none; }
      line { stroke: #94a3b8; stroke-opacity: .28; stroke-width: .7; }
      .dim { opacity: .07; }
    </style>
    <g>${lines}</g>
    <g>${rtoDots}</g>
    <g>${qualMarks}</g>
  </svg>`;
}
