// SPDX-FileCopyrightText: 2026 Ben Richardson
// SPDX-License-Identifier: AGPL-3.0-or-later
// Wheel-zoom + drag-pan for any viewBox-based SVG, plus +/−/reset buttons.
// The pure viewBox math is exported separately so it can be unit-tested.

export interface ViewBox { x: number; y: number; w: number; h: number }

/**
 * Zoom `vb` by `factor` about the focus point (fx, fy) in viewBox coordinates,
 * clamped to [minScale, maxScale] relative to `base` and panned to stay inside it.
 */
export function zoomViewBox(
  vb: ViewBox,
  base: ViewBox,
  factor: number,
  fx: number,
  fy: number,
  minScale = 1,
  maxScale = 8,
): ViewBox {
  const curScale = base.w / vb.w;
  const newScale = Math.min(maxScale, Math.max(minScale, curScale * factor));
  const nw = base.w / newScale;
  const nh = base.h / newScale;
  const nx = fx - ((fx - vb.x) / vb.w) * nw;
  const ny = fy - ((fy - vb.y) / vb.h) * nh;
  return clampViewBox({ x: nx, y: ny, w: nw, h: nh }, base);
}

export function clampViewBox(vb: ViewBox, base: ViewBox): ViewBox {
  const x = Math.max(base.x, Math.min(base.x + base.w - vb.w, vb.x));
  const y = Math.max(base.y, Math.min(base.y + base.h - vb.h, vb.y));
  return { x, y, w: vb.w, h: vb.h };
}

export interface SvgZoomHandle {
  zoomIn(): void;
  zoomOut(): void;
  reset(): void;
  destroy(): void;
}

export function attachSvgZoom(
  svg: SVGSVGElement,
  opts: { minScale?: number; maxScale?: number; step?: number } = {},
): SvgZoomHandle {
  const minScale = opts.minScale ?? 1;
  const maxScale = opts.maxScale ?? 8;
  const step = opts.step ?? 1.4;

  const bv = svg.viewBox.baseVal;
  const base: ViewBox = { x: bv.x, y: bv.y, w: bv.width, h: bv.height };
  let vb: ViewBox = { ...base };

  const apply = () => svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);

  const toViewBox = (clientX: number, clientY: number): [number, number] => {
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return [vb.x + vb.w / 2, vb.y + vb.h / 2];
    return [vb.x + ((clientX - rect.left) / rect.width) * vb.w, vb.y + ((clientY - rect.top) / rect.height) * vb.h];
  };

  const zoomAbout = (factor: number, fx: number, fy: number) => {
    vb = zoomViewBox(vb, base, factor, fx, fy, minScale, maxScale);
    apply();
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const [fx, fy] = toViewBox(e.clientX, e.clientY);
    zoomAbout(Math.exp(-e.deltaY * 0.0015), fx, fy);
  };

  // Drag to pan. A capture-phase click listener swallows the click that ends a
  // drag so node click handlers don't fire after panning.
  //
  // Capture is deferred until movement actually exceeds the threshold. If we
  // captured on pointerdown, a plain click's pointerup (and the click it
  // generates) would retarget to the SVG and never reach child node handlers —
  // making every node click dead. Deferring means a click never captures.
  const THRESHOLD = 4;
  let pointerDown = false;
  let dragging = false;
  let moved = 0;
  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let lastY = 0;
  let activePointerId = -1;
  let suppressClick = false;

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    pointerDown = true;
    dragging = false;
    moved = 0;
    startX = lastX = e.clientX;
    startY = lastY = e.clientY;
    activePointerId = e.pointerId;
    // NOTE: no setPointerCapture and no cursor change here — see comment above.
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!pointerDown) return;
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    if (!dragging) {
      // Only promote to a drag (and capture) once past the threshold.
      if (Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY) <= THRESHOLD) return;
      dragging = true;
      try { svg.setPointerCapture(activePointerId); } catch { /* pointer already gone */ }
      svg.style.cursor = 'grabbing';
    }
    const pdx = e.clientX - lastX;
    const pdy = e.clientY - lastY;
    moved += Math.abs(pdx) + Math.abs(pdy);
    lastX = e.clientX;
    lastY = e.clientY;
    vb = clampViewBox({ x: vb.x - pdx * (vb.w / rect.width), y: vb.y - pdy * (vb.h / rect.height), w: vb.w, h: vb.h }, base);
    apply();
  };
  const onPointerUp = (e: PointerEvent) => {
    if (!pointerDown) return;
    pointerDown = false;
    if (dragging) {
      try { svg.releasePointerCapture(e.pointerId); } catch { /* nothing captured */ }
      svg.style.cursor = 'grab';
      if (moved > THRESHOLD) suppressClick = true;
    }
    dragging = false;
  };
  const onClickCapture = (e: MouseEvent) => {
    if (suppressClick) {
      suppressClick = false;
      e.stopPropagation();
      e.preventDefault();
    }
  };
  const onDblClick = () => { vb = { ...base }; apply(); };

  svg.addEventListener('wheel', onWheel, { passive: false });
  svg.addEventListener('pointerdown', onPointerDown);
  svg.addEventListener('pointermove', onPointerMove);
  svg.addEventListener('pointerup', onPointerUp);
  svg.addEventListener('pointercancel', onPointerUp);
  svg.addEventListener('click', onClickCapture, true);
  svg.addEventListener('dblclick', onDblClick);
  svg.style.cursor = 'grab';
  svg.style.touchAction = 'none';

  const controls = document.createElement('div');
  controls.className = 'svg-zoom-controls';
  controls.innerHTML = `
    <button type="button" data-zoom="in" aria-label="Zoom in">+</button>
    <button type="button" data-zoom="out" aria-label="Zoom out">−</button>
    <button type="button" data-zoom="reset" aria-label="Reset zoom">⤢</button>
  `;
  const parent = svg.parentElement;
  if (parent) parent.appendChild(controls);

  const centre = (): [number, number] => [vb.x + vb.w / 2, vb.y + vb.h / 2];
  const handle: SvgZoomHandle = {
    zoomIn: () => zoomAbout(step, ...centre()),
    zoomOut: () => zoomAbout(1 / step, ...centre()),
    reset: () => { vb = { ...base }; apply(); },
    destroy: () => {
      svg.removeEventListener('wheel', onWheel);
      svg.removeEventListener('pointerdown', onPointerDown);
      svg.removeEventListener('pointermove', onPointerMove);
      svg.removeEventListener('pointerup', onPointerUp);
      svg.removeEventListener('pointercancel', onPointerUp);
      svg.removeEventListener('click', onClickCapture, true);
      svg.removeEventListener('dblclick', onDblClick);
      controls.remove();
    },
  };
  controls.querySelector('[data-zoom="in"]')!.addEventListener('click', handle.zoomIn);
  controls.querySelector('[data-zoom="out"]')!.addEventListener('click', handle.zoomOut);
  controls.querySelector('[data-zoom="reset"]')!.addEventListener('click', handle.reset);
  return handle;
}
