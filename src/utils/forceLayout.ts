// SPDX-FileCopyrightText: 2026 Ben Richardson
// SPDX-License-Identifier: AGPL-3.0-or-later
// Pure synchronous force-directed layout. No DOM, no animation — callers run it
// to completion and render the final positions once. A uniform grid buckets the
// repulsion pass (only nodes within `cutoff` interact), and Fruchterman–Reingold
// temperature cooling guarantees the layout is settled when it returns.

export interface SimNode { x: number; y: number; r: number }
export interface SimLink { source: number; target: number }

export interface ForceOptions {
  width: number;
  height: number;
  /** Max iterations (early-exits once movement dies down). */
  iterations?: number;
  /** Repulsion radius and grid cell size, px. */
  cutoff?: number;
  /** Repulsion constant k (FR force = k²/d). Defaults to sqrt(area/n) capped at 60. */
  repulsion?: number;
  /** Ideal edge length, px. */
  linkDistance?: number;
  linkStrength?: number;
  /** Pull toward canvas centre. */
  gravity?: number;
  /** Hard wall-clock cap, ms. */
  timeBudgetMs?: number;
}

export interface ForceResult { iterations: number; elapsedMs: number; maxDelta: number }

/** Deterministic PRNG — same seed, same layout. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function forceLayout(nodes: SimNode[], links: SimLink[], opts: ForceOptions): ForceResult {
  const w = opts.width;
  const h = opts.height;
  const n = nodes.length;
  const maxIterations = opts.iterations ?? 150;
  const cutoff = opts.cutoff ?? 90;
  const k = opts.repulsion ?? Math.min(60, Math.sqrt((w * h) / Math.max(1, n)));
  const linkDistance = opts.linkDistance ?? 60;
  const linkStrength = opts.linkStrength ?? 0.5;
  const gravity = opts.gravity ?? 0.03;
  const timeBudgetMs = opts.timeBudgetMs ?? 900;

  const t0 = now();
  if (n === 0) return { iterations: 0, elapsedMs: 0, maxDelta: 0 };

  const cx = w / 2;
  const cy = h / 2;
  const cols = Math.max(1, Math.ceil(w / cutoff));
  const rows = Math.max(1, Math.ceil(h / cutoff));
  const cutoffSq = cutoff * cutoff;
  const dx = new Float64Array(n);
  const dy = new Float64Array(n);

  let temp = Math.min(w, h) / 4;
  let iter = 0;
  let maxDelta = Infinity;

  for (; iter < maxIterations; iter++) {
    dx.fill(0);
    dy.fill(0);

    // Bucket nodes into the grid.
    const buckets = new Map<number, number[]>();
    for (let i = 0; i < n; i++) {
      const gx = Math.min(cols - 1, Math.max(0, Math.floor(nodes[i].x / cutoff)));
      const gy = Math.min(rows - 1, Math.max(0, Math.floor(nodes[i].y / cutoff)));
      const key = gx + gy * cols;
      const bucket = buckets.get(key);
      if (bucket) bucket.push(i);
      else buckets.set(key, [i]);
    }

    // Repulsion: each node vs nodes in its own + 8 neighbouring cells.
    for (let i = 0; i < n; i++) {
      const a = nodes[i];
      const gx = Math.min(cols - 1, Math.max(0, Math.floor(a.x / cutoff)));
      const gy = Math.min(rows - 1, Math.max(0, Math.floor(a.y / cutoff)));
      for (let oy = -1; oy <= 1; oy++) {
        const ny = gy + oy;
        if (ny < 0 || ny >= rows) continue;
        for (let ox = -1; ox <= 1; ox++) {
          const nx = gx + ox;
          if (nx < 0 || nx >= cols) continue;
          const bucket = buckets.get(nx + ny * cols);
          if (!bucket) continue;
          for (const j of bucket) {
            if (j === i) continue;
            const b = nodes[j];
            let ddx = a.x - b.x;
            let ddy = a.y - b.y;
            let distSq = ddx * ddx + ddy * ddy;
            if (distSq >= cutoffSq) continue;
            if (distSq < 1e-4) {
              // Coincident nodes: deterministic opposite nudges so they separate.
              ddx = (i < j ? 1 : -1) * 0.1;
              ddy = (i < j ? 0.5 : -0.5) * 0.1;
              distSq = ddx * ddx + ddy * ddy;
            }
            const dist = Math.sqrt(distSq);
            const force = (k * k) / dist;
            dx[i] += (ddx / dist) * force;
            dy[i] += (ddy / dist) * force;
          }
        }
      }
    }

    // Link springs toward linkDistance.
    for (const l of links) {
      const s = nodes[l.source];
      const t = nodes[l.target];
      const ddx = t.x - s.x;
      const ddy = t.y - s.y;
      const dist = Math.sqrt(ddx * ddx + ddy * ddy) + 0.001;
      const force = (dist - linkDistance) * linkStrength;
      const fx = (ddx / dist) * force;
      const fy = (ddy / dist) * force;
      dx[l.source] += fx;
      dy[l.source] += fy;
      dx[l.target] -= fx;
      dy[l.target] -= fy;
    }

    // Gravity toward the centre.
    for (let i = 0; i < n; i++) {
      dx[i] += (cx - nodes[i].x) * gravity;
      dy[i] += (cy - nodes[i].y) * gravity;
    }

    // Apply displacements, capped by the current temperature, and cool.
    maxDelta = 0;
    for (let i = 0; i < n; i++) {
      const node = nodes[i];
      const d = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]);
      if (d > 0) {
        const capped = Math.min(d, temp) / d;
        const mx = dx[i] * capped * 0.05;
        const my = dy[i] * capped * 0.05;
        node.x += mx;
        node.y += my;
        const moved = Math.sqrt(mx * mx + my * my);
        if (moved > maxDelta) maxDelta = moved;
      }
      node.x = Math.max(node.r, Math.min(w - node.r, node.x));
      node.y = Math.max(node.r, Math.min(h - node.r, node.y));
    }
    temp *= 0.97;

    if (maxDelta < 0.15) { iter++; break; }
    if (now() - t0 > timeBudgetMs) { iter++; break; }
  }

  return { iterations: iter, elapsedMs: now() - t0, maxDelta };
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
