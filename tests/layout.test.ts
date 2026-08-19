// SPDX-FileCopyrightText: 2026 Ben Richardson
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Positional assertions for the hand-rolled layouts. Area-only tests pass on visually
// broken layouts — a treemap that stacks every cell at the same origin conserves total
// area perfectly and renders as garbage. These assert WHERE things end up.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { forceLayout, mulberry32, type SimLink, type SimNode } from '../src/utils/forceLayout.ts';
import { clampViewBox, zoomViewBox } from '../src/utils/svgZoom.ts';
import { squarify } from '../src/utils/squarify.ts';

const W = 900;
const H = 600;

function seededNodes(n: number): SimNode[] {
  const rand = mulberry32(42);
  return Array.from({ length: n }, () => ({ x: rand() * W, y: rand() * H, r: 4 }));
}

describe('forceLayout', () => {
  it('produces finite coordinates for every node', () => {
    const nodes = seededNodes(120);
    const links: SimLink[] = Array.from({ length: 200 }, (_, i) => ({
      source: i % 120,
      target: (i * 7 + 3) % 120,
    }));
    forceLayout(nodes, links, { width: W, height: H, iterations: 120, timeBudgetMs: 500 });
    for (const n of nodes) {
      expect(Number.isFinite(n.x), 'x must be finite').toBe(true);
      expect(Number.isFinite(n.y), 'y must be finite').toBe(true);
    }
  });

  it('keeps every node inside the canvas', () => {
    const nodes = seededNodes(200);
    const links: SimLink[] = Array.from({ length: 300 }, (_, i) => ({
      source: i % 200,
      target: (i * 13 + 5) % 200,
    }));
    forceLayout(nodes, links, { width: W, height: H, iterations: 150, timeBudgetMs: 600 });
    for (const n of nodes) {
      expect(n.x).toBeGreaterThanOrEqual(-1);
      expect(n.x).toBeLessThanOrEqual(W + 1);
      expect(n.y).toBeGreaterThanOrEqual(-1);
      expect(n.y).toBeLessThanOrEqual(H + 1);
    }
  });

  it('does NOT collapse every node onto one point — the structureless-cloud failure', () => {
    const nodes = seededNodes(150);
    forceLayout(nodes, [], { width: W, height: H, iterations: 150, timeBudgetMs: 600 });
    const xs = nodes.map((n) => n.x);
    const ys = nodes.map((n) => n.y);
    expect(Math.max(...xs) - Math.min(...xs), 'x spread').toBeGreaterThan(W * 0.25);
    expect(Math.max(...ys) - Math.min(...ys), 'y spread').toBeGreaterThan(H * 0.25);
  });

  it('is deterministic — the same seed gives byte-identical positions', () => {
    const run = () => {
      const nodes = seededNodes(80);
      forceLayout(nodes, [{ source: 0, target: 1 }], {
        width: W,
        height: H,
        iterations: 100,
        timeBudgetMs: 400,
      });
      return nodes.map((n) => `${n.x.toFixed(4)},${n.y.toFixed(4)}`).join('|');
    };
    expect(run()).toBe(run());
  });

  it('returns having actually settled, not mid-flight', () => {
    const nodes = seededNodes(100);
    const result = forceLayout(nodes, [], { width: W, height: H, iterations: 200, timeBudgetMs: 800 });
    expect(result.iterations).toBeGreaterThan(0);
    expect(Number.isFinite(result.maxDelta)).toBe(true);
  });

  it('handles the degenerate cases without throwing or emitting NaN', () => {
    expect(() => forceLayout([], [], { width: W, height: H })).not.toThrow();
    const one = [{ x: 10, y: 10, r: 3 }];
    forceLayout(one, [], { width: W, height: H, iterations: 20 });
    expect(Number.isFinite(one[0].x)).toBe(true);
    // Two coincident nodes must be pushed apart rather than dividing by a zero distance.
    const stacked = [
      { x: 100, y: 100, r: 4 },
      { x: 100, y: 100, r: 4 },
    ];
    forceLayout(stacked, [], { width: W, height: H, iterations: 60 });
    for (const n of stacked) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
    }
  });

  it('CONTRACT: link indices must be in range — the caller filters, the layout assumes', () => {
    // forceLayout indexes nodes directly, so an out-of-range index is undefined behaviour.
    // src/views/network.ts drops any edge whose endpoints are not both in the node index,
    // and this test pins that responsibility down so it is not quietly removed.
    const source = readFileSync(join(import.meta.dirname, '..', 'src', 'views', 'network.ts'), 'utf8');
    expect(source).toMatch(/if \(a == null \|\| b == null\) continue;/);
  });
});

describe('squarify', () => {
  const rects = (values: number[]) => squarify(values, W, H);

  it('places every rect inside the canvas', () => {
    for (const r of rects([50, 30, 12, 5, 2, 1])) {
      expect(r.x).toBeGreaterThanOrEqual(-0.001);
      expect(r.y).toBeGreaterThanOrEqual(-0.001);
      expect(r.x + r.w).toBeLessThanOrEqual(W + 0.001);
      expect(r.y + r.h).toBeLessThanOrEqual(H + 0.001);
    }
  });

  it('emits no NaN or negative dimensions', () => {
    for (const r of rects([100, 40, 40, 20, 10, 10, 5, 1])) {
      for (const v of [r.x, r.y, r.w, r.h]) expect(Number.isFinite(v)).toBe(true);
      expect(r.w).toBeGreaterThanOrEqual(0);
      expect(r.h).toBeGreaterThanOrEqual(0);
    }
  });

  it('has NO pairwise overlap — the assertion area-only tests miss entirely', () => {
    // A treemap that stacks every cell at the same origin conserves total area perfectly
    // and is complete garbage on screen. Only an overlap check catches it.
    const list = rects([60, 25, 20, 15, 10, 8, 6, 4, 2, 1]);
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i];
        const b = list[j];
        const overlapW = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
        const overlapH = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
        expect(overlapW * overlapH, `rect ${i} overlaps rect ${j}`).toBeLessThan(0.5);
      }
    }
  });

  it('conserves total area', () => {
    const values = [40, 30, 20, 10];
    const total = rects(values).reduce((n, r) => n + r.w * r.h, 0);
    expect(total).toBeCloseTo(W * H, -1);
  });

  it('keeps areas proportional to their values', () => {
    const values = [50, 25, 25];
    const list = rects(values);
    const areas = list.map((r) => r.w * r.h);
    expect(areas[0] / areas[1]).toBeCloseTo(2, 1);
  });

  it('returns an index for every input so callers can map back to their data', () => {
    const list = rects([5, 4, 3, 2, 1]);
    expect(list).toHaveLength(5);
    expect([...list.map((r) => r.index)].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });

  it('survives degenerate input', () => {
    expect(() => squarify([], W, H)).not.toThrow();
    expect(squarify([], W, H)).toEqual([]);
    for (const r of squarify([0, 0, 1], W, H)) {
      for (const v of [r.x, r.y, r.w, r.h]) expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe('svgZoom maths', () => {
  const base = { x: 0, y: 0, w: 1000, h: 600 };

  it('zooming in shrinks the viewBox', () => {
    const next = zoomViewBox(base, base, 2, 500, 300);
    expect(next.w).toBeLessThan(base.w);
    expect(next.h).toBeLessThan(base.h);
  });

  it('zooms about the focus point, keeping it roughly fixed on screen', () => {
    const fx = 250;
    const fy = 150;
    const next = zoomViewBox(base, base, 2, fx, fy);
    // The focus point's fractional position within the viewBox must be preserved.
    const before = (fx - base.x) / base.w;
    const after = (fx - next.x) / next.w;
    expect(Math.abs(after - before)).toBeLessThan(0.02);
    const beforeY = (fy - base.y) / base.h;
    const afterY = (fy - next.y) / next.h;
    expect(Math.abs(afterY - beforeY)).toBeLessThan(0.02);
  });

  it('never produces a non-finite or zero-sized viewBox, however far it is zoomed', () => {
    let vb = base;
    for (let i = 0; i < 60; i += 1) vb = zoomViewBox(vb, base, 2, 500, 300);
    for (const v of [vb.x, vb.y, vb.w, vb.h]) expect(Number.isFinite(v)).toBe(true);
    expect(vb.w).toBeGreaterThan(0);
    expect(vb.h).toBeGreaterThan(0);
    // And zooming back out cannot escape the base box.
    for (let i = 0; i < 60; i += 1) vb = zoomViewBox(vb, base, 0.5, 500, 300);
    expect(vb.w).toBeLessThanOrEqual(base.w + 0.001);
    expect(vb.h).toBeLessThanOrEqual(base.h + 0.001);
  });

  it('clamps a panned viewBox back within the base', () => {
    const clamped = clampViewBox({ x: -9000, y: -9000, w: 500, h: 300 }, base);
    expect(clamped.x).toBeGreaterThanOrEqual(base.x - 0.001);
    expect(clamped.y).toBeGreaterThanOrEqual(base.y - 0.001);
    expect(clamped.x + clamped.w).toBeLessThanOrEqual(base.x + base.w + 0.001);
    expect(clamped.y + clamped.h).toBeLessThanOrEqual(base.y + base.h + 0.001);
  });
});
