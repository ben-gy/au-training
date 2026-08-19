// SPDX-FileCopyrightText: 2026 Ben Richardson
// SPDX-License-Identifier: AGPL-3.0-or-later
// Squarified treemap layout. Pure geometry — no DOM, no libs.
// Ported from the nsw-pokies implementation (canonical factory pattern).

export interface Rect { x: number; y: number; w: number; h: number; index: number }

/**
 * Squarified treemap layout. Returns a rectangle per value (same order as input).
 * Values must be positive. Based on Bruls, Huizing & van Wijk (2000).
 */
export function squarify(values: number[], width: number, height: number): Rect[] {
  const total = values.reduce((a, b) => a + b, 0);
  const items = values.map((v, index) => ({ index, area: total > 0 ? (v / total) * width * height : 0 }));
  const rects: Rect[] = new Array(values.length);
  let x = 0, y = 0, w = width, h = height;
  let row: typeof items = [];
  const worst = (r: typeof items, side: number): number => {
    if (!r.length || side === 0) return Infinity;
    const areas = r.map((i) => i.area);
    const sum = areas.reduce((a, b) => a + b, 0);
    const max = Math.max(...areas);
    const min = Math.min(...areas);
    const s2 = sum * sum;
    return Math.max((side * side * max) / s2, s2 / (side * side * min));
  };
  const layoutRow = (r: typeof items) => {
    const sum = r.reduce((a, b) => a + b.area, 0);
    const vertical = w >= h; // fill along the shorter side
    if (vertical) {
      const rw = h > 0 ? sum / h : 0;
      let cy = y;
      for (const it of r) {
        const rh = rw > 0 ? it.area / rw : 0;
        rects[it.index] = { x, y: cy, w: rw, h: rh, index: it.index };
        cy += rh;
      }
      x += rw; w -= rw;
    } else {
      const rh = w > 0 ? sum / w : 0;
      let cx = x;
      for (const it of r) {
        const rwid = rh > 0 ? it.area / rh : 0;
        rects[it.index] = { x: cx, y, w: rwid, h: rh, index: it.index };
        cx += rwid;
      }
      y += rh; h -= rh;
    }
  };
  const queue = [...items];
  while (queue.length) {
    const side = Math.min(w, h);
    const next = queue[0];
    if (row.length === 0 || worst(row, side) >= worst([...row, next], side)) {
      row.push(next);
      queue.shift();
    } else {
      layoutRow(row);
      row = [];
    }
  }
  if (row.length) layoutRow(row);
  // guard against NaN/undefined
  return rects.map((r, i) => r || { x: 0, y: 0, w: 0, h: 0, index: i });
}
