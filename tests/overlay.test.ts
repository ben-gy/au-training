// SPDX-FileCopyrightText: 2026 Ben Richardson
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The modal dismissal contract, asserted by STATE rather than by "the handler ran".
//
// This test exists because a sibling site shipped with a working ✕, a working scrim
// handler AND working Escape, and was still impossible to dismiss: a missing `[hidden]`
// guard meant the CSS kept the overlay displayed no matter what the handlers set. Every
// handler fired correctly every time and none could take effect. The only thing that
// catches that is asserting the element is GONE — which is why this implementation
// detaches the panel from the DOM rather than hiding it.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { closeOverlay, isOverlayOpen, openOverlay } from '../src/overlay.ts';

const scrim = () => document.querySelector('.overlay-scrim');
const panel = () => document.querySelector('.overlay-panel');
const closeButton = () => document.querySelector<HTMLElement>('.overlay-close');

/** A real pointer sequence, not `.click()`. A synthetic click sails straight through a
 *  transparent blocking overlay and "passes" on interactions that are dead for real users. */
function pointer(el: Element, type: 'pointerdown' | 'pointerup', pointerType = 'mouse'): void {
  // jsdom has no PointerEvent constructor; MouseEvent carries the fields we read.
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, composed: true });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  el.dispatchEvent(event);
}

describe('the overlay dismissal contract', () => {
  beforeEach(() => {
    closeOverlay();
    document.body.innerHTML = '';
    document.body.style.overflow = '';
  });

  it('BASELINE: nothing is open or leaking before anything is opened', () => {
    expect(panel()).toBeNull();
    expect(scrim()).toBeNull();
    expect(isOverlayOpen()).toBe(false);
    // Nothing carrying the `hidden` attribute may be rendered.
    const leaking = [...document.querySelectorAll('[hidden]')].filter(
      (el) => getComputedStyle(el).display !== 'none'
    );
    expect(leaking).toEqual([]);
  });

  it('opens with a panel, a scrim, and a titled dialog role', () => {
    openOverlay({ variant: 'modal', title: 'About' });
    expect(panel()).not.toBeNull();
    expect(scrim()).not.toBeNull();
    expect(panel()!.getAttribute('role')).toBe('dialog');
    expect(panel()!.getAttribute('aria-modal')).toBe('true');
    expect(panel()!.getAttribute('aria-label')).toBe('About');
  });

  // EXIT 1 — the close control
  it('exit 1: the ✕ removes the overlay from the DOM entirely', () => {
    openOverlay({ variant: 'modal', title: 'About' });
    pointer(closeButton()!, 'pointerdown');
    expect(panel(), 'the panel must be detached, not merely hidden').toBeNull();
    expect(scrim()).toBeNull();
    expect(isOverlayOpen()).toBe(false);
  });

  // EXIT 2 — tap outside, with a mouse
  it('exit 2: pointerdown on the scrim removes the overlay', () => {
    openOverlay({ variant: 'drawer', title: 'Provider' });
    pointer(scrim()!, 'pointerdown');
    expect(panel()).toBeNull();
    expect(scrim()).toBeNull();
  });

  // EXIT 3 — Escape
  it('exit 3: Escape removes the overlay from anywhere in the document', () => {
    openOverlay({ variant: 'modal', title: 'About' });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(panel()).toBeNull();
  });

  // EXIT 4 — a real TOUCH sequence
  it('exit 4: a real touch pointerdown+pointerup outside closes it, and does NOT reopen', () => {
    // A control wired to both touchstart and click double-fires: it closes and instantly
    // reopens, which the user experiences as a dead close button. One event family only.
    openOverlay({ variant: 'drawer', title: 'Provider' });
    const target = scrim()!;
    pointer(target, 'pointerdown', 'touch');
    pointer(target, 'pointerup', 'touch');
    expect(panel(), 'a touch tap outside must close it').toBeNull();
    expect(isOverlayOpen(), 'and it must not immediately reopen').toBe(false);
  });

  it('the ✕ does not double-fire when pointerdown is followed by a click', () => {
    openOverlay({ variant: 'modal', title: 'About' });
    const button = closeButton()!;
    pointer(button, 'pointerdown');
    expect(panel()).toBeNull();
    // A trailing synthetic click must not resurrect anything.
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(panel()).toBeNull();
    expect(isOverlayOpen()).toBe(false);
  });

  it('the scrim is a real, full-viewport hit area and is not pointer-events: none', () => {
    openOverlay({ variant: 'modal', title: 'About' });
    const style = getComputedStyle(scrim()!);
    expect(style.pointerEvents).not.toBe('none');
    expect(scrim()!.className).toContain('overlay-scrim');
  });

  it('restores body scroll after closing, and does not clobber a pre-existing value', () => {
    document.body.style.overflow = 'auto';
    openOverlay({ variant: 'modal', title: 'About' });
    expect(document.body.style.overflow).toBe('hidden');
    closeOverlay();
    expect(document.body.style.overflow).toBe('auto');
  });

  it('calls onClose exactly once, however it was dismissed', () => {
    let calls = 0;
    openOverlay({ variant: 'modal', title: 'About', onClose: () => (calls += 1) });
    pointer(closeButton()!, 'pointerdown');
    expect(calls).toBe(1);
    // Closing again must not fire it a second time.
    closeOverlay();
    expect(calls).toBe(1);
  });

  it('opening a second overlay closes the first, so overlays never stack', () => {
    openOverlay({ variant: 'modal', title: 'First' });
    openOverlay({ variant: 'drawer', title: 'Second' });
    expect(document.querySelectorAll('.overlay-panel')).toHaveLength(1);
    expect(document.querySelectorAll('.overlay-scrim')).toHaveLength(1);
    expect(panel()!.getAttribute('aria-label')).toBe('Second');
  });

  it('closeOverlay is safe when nothing is open', () => {
    expect(() => closeOverlay()).not.toThrow();
    expect(isOverlayOpen()).toBe(false);
  });

  it('leaves no orphaned nodes behind after repeated open/close cycles', () => {
    for (let i = 0; i < 5; i += 1) {
      openOverlay({ variant: 'drawer', title: `Panel ${i}` });
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    }
    expect(document.querySelectorAll('.overlay-panel')).toHaveLength(0);
    expect(document.querySelectorAll('.overlay-scrim')).toHaveLength(0);
  });

  it('Escape after close does not throw — the listener was removed', () => {
    openOverlay({ variant: 'modal', title: 'About' });
    closeOverlay();
    expect(() =>
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    ).not.toThrow();
  });

  it('gives the close control a 44px hit area in the stylesheet', () => {
    // Asserted at source: jsdom does not lay out, so a computed size here would be a lie.
    const text = readFileSync(join(import.meta.dirname, '..', 'src', 'styles.css'), 'utf8');
    const rule = /\.overlay-close\s*\{([^}]*)\}/.exec(text)?.[1] ?? '';
    expect(rule).toMatch(/width:\s*44px/);
    expect(rule).toMatch(/height:\s*44px/);
  });
});
