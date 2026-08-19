// SPDX-FileCopyrightText: 2026 Ben Richardson
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The one overlay implementation for this site. Every modal, drawer and drill-down goes
// through it, because getting this wrong makes the whole site unusable and the failure is
// invisible to any test that only checks "the handler ran".
//
// THE DISMISSAL CONTRACT — all four exits, every time, not alternatives:
//   1. A ✕ control inside the panel with a >= 44x44 hit area.
//   2. pointerdown anywhere outside the panel (the scrim is a real, full-viewport,
//      pointer-events-auto element sitting below the panel and above the page).
//   3. Escape, from anywhere in the document.
//   4. Real touch: the scrim listener is on `pointerdown`, which covers mouse, pen and
//      touch in ONE handler. We never pair `touchstart` with `click` on the same control —
//      that double-fires, closes and instantly reopens, and reads to the user as a dead
//      button.
//
// The panel is REMOVED FROM THE DOM when closed rather than hidden with a transform. A
// closed off-canvas drawer parked at translateX(100%) is still a real box on iOS Safari
// and scrolls the page sideways; `overflow-x: clip` on body neither fixes that nor lets
// scrollWidth detect it. Detaching is the only reliable fix.

export interface OverlayOptions {
  /** 'modal' centres a dialog; 'drawer' slides a panel in from the right. */
  variant: 'modal' | 'drawer';
  title: string;
  /** Called after the overlay is fully removed, for URL cleanup etc. */
  onClose?: () => void;
  /** Extra class on the panel. */
  className?: string;
}

interface OpenOverlay {
  panel: HTMLElement;
  body: HTMLElement;
  close: () => void;
}

let active: { host: HTMLElement; cleanup: () => void } | null = null;

function host(): HTMLElement {
  let el = document.getElementById('overlay-host');
  if (!el) {
    el = document.createElement('div');
    el.id = 'overlay-host';
    document.body.appendChild(el);
  }
  return el;
}

/** Close whatever is open. Safe to call when nothing is. */
export function closeOverlay(): void {
  active?.cleanup();
}

export function isOverlayOpen(): boolean {
  return active !== null;
}

export function openOverlay(options: OverlayOptions): OpenOverlay {
  closeOverlay();

  const root = host();
  const previouslyFocused = document.activeElement as HTMLElement | null;

  const scrim = document.createElement('div');
  scrim.className = 'overlay-scrim';

  const panel = document.createElement('section');
  panel.className = `overlay-panel overlay-${options.variant}${options.className ? ` ${options.className}` : ''}`;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', options.title);
  panel.tabIndex = -1;

  const header = document.createElement('header');
  header.className = 'overlay-head';

  const heading = document.createElement('h2');
  heading.className = 'overlay-title';
  heading.textContent = options.title;

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'overlay-close';
  closeButton.setAttribute('aria-label', `Close ${options.title}`);
  closeButton.innerHTML = '<span aria-hidden="true">✕</span>';

  header.append(heading, closeButton);

  const body = document.createElement('div');
  body.className = 'overlay-body';

  panel.append(header, body);
  root.append(scrim, panel);

  // Body scroll lock. Store the previous value so we restore rather than assume.
  const previousOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKeydown, true);
    scrim.removeEventListener('pointerdown', onScrimDown);
    closeButton.removeEventListener('pointerdown', onCloseDown);
    // Detach, do not hide.
    scrim.remove();
    panel.remove();
    document.body.style.overflow = previousOverflow;
    active = null;
    previouslyFocused?.focus?.();
    options.onClose?.();
  };

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      cleanup();
      return;
    }
    if (event.key === 'Tab') trapFocus(event, panel);
  }

  function onScrimDown(event: PointerEvent) {
    // The scrim covers the whole viewport under the panel, so any pointerdown that
    // reaches it is by definition outside the panel.
    event.preventDefault();
    cleanup();
  }

  function onCloseDown(event: PointerEvent) {
    event.preventDefault();
    event.stopPropagation();
    cleanup();
  }

  // ONE event family per control — pointerdown covers mouse, touch and pen.
  document.addEventListener('keydown', onKeydown, true);
  scrim.addEventListener('pointerdown', onScrimDown);
  closeButton.addEventListener('pointerdown', onCloseDown);

  active = { host: root, cleanup };
  panel.focus();

  return { panel, body, close: cleanup };
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function trapFocus(event: KeyboardEvent, panel: HTMLElement): void {
  const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.offsetParent !== null || el === document.activeElement
  );
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
