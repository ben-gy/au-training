// SPDX-FileCopyrightText: 2026 Ben Richardson
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Source-level rules that are invisible in jsdom and expensive to discover in production.
// Each of these encodes a defect that has shipped somewhere in this fleet before.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

const CSS = read('src/styles.css');
const HTML = read('index.html');
const SOURCES = [...walk('src'), ...walk('pipeline').filter((f) => f.endsWith('.mjs'))];

/** These scanners must read CODE, not the comments explaining the code. Several of the
 *  rules below are documented in a comment that necessarily quotes the banned construct
 *  ("`overflow-x: hidden` kills sticky"), and a naive scan then flags its own explanation.
 *  Strip comments first — fix the scanner, never delete the explanation. */
const stripCssComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const stripJsComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const CSS_CODE = stripCssComments(CSS);

describe('the [hidden] guard', () => {
  it('is present, uses !important, and comes before any component rule', () => {
    // An author rule like `.overlay-panel{display:grid}` outranks the UA stylesheet's
    // `[hidden]{display:none}` regardless of specificity. Without this line, an element
    // hidden by attribute renders from first paint and `el.hidden = true` does nothing —
    // which shipped a modal that could not be dismissed by ✕, scrim OR Escape.
    expect(CSS).toMatch(/\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/);
    const guardAt = CSS.indexOf('[hidden]');
    const firstDisplayRule = CSS.search(/\.[a-z-]+[^{]*\{[^}]*display:/);
    expect(guardAt).toBeGreaterThanOrEqual(0);
    expect(guardAt).toBeLessThan(firstDisplayRule);
  });
});

describe('the tooltip needs both of its rules', () => {
  it('defines .hover-tip AND .hover-tip.visible', () => {
    // initTooltip shows and hides purely by toggling `visible`. Without the .visible rule
    // the tooltip is painted on first hover and never hidden again — it simply follows the
    // pointer around the page forever, and no handler test can see it.
    expect(CSS).toMatch(/\.hover-tip\s*\{/);
    expect(CSS).toMatch(/\.hover-tip\.visible\s*\{[^}]*opacity:\s*1/);
  });
});

describe('scroll and sticky traps', () => {
  it('uses overflow-x: clip rather than hidden on the page root', () => {
    // `overflow-x: hidden` silently kills position:sticky on every descendant.
    expect(CSS_CODE).not.toMatch(/overflow-x:\s*hidden/);
    expect(CSS_CODE).toMatch(/overflow-x:\s*clip/);
  });

  it('keeps the sticky header below the overlay layer', () => {
    // If the header outranks the scrim, dialogs paint underneath the nav.
    const header = Number(/--z-header:\s*(\d+)/.exec(CSS)?.[1]);
    const scrim = Number(/--z-scrim:\s*(\d+)/.exec(CSS)?.[1]);
    const panel = Number(/--z-panel:\s*(\d+)/.exec(CSS)?.[1]);
    expect(header).toBeLessThan(scrim);
    expect(scrim).toBeLessThan(panel);
  });

  it('puts every overlay layer above Leaflet, which reaches z-index 1000', () => {
    for (const name of ['--z-scrim', '--z-panel', '--z-tooltip', '--z-popover']) {
      const value = Number(new RegExp(`${name}:\\s*(\\d+)`).exec(CSS)?.[1]);
      expect(value, `${name} must clear Leaflet's 1000`).toBeGreaterThan(1000);
    }
  });

  it('isolates the map container so Leaflet panes cannot escape to the page root', () => {
    // Without a stacking context, Leaflet's own z-indexed children paint OVER modals.
    const frame = /\.map-frame\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? '';
    expect(frame).toMatch(/isolation:\s*isolate/);
    expect(frame).toMatch(/z-index:\s*0/);
  });
});

describe('mobile overflow rules', () => {
  it('gives truncating grid children min-width: 0', () => {
    // A nowrap child refuses to shrink below its content width and forces the whole page
    // to scroll sideways. This is the single commonest cause of mobile overflow.
    const label = /\.bar-label\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? '';
    expect(label).toMatch(/min-width:\s*0/);
    expect(label).toMatch(/text-overflow:\s*ellipsis/);
  });

  it('never sizes an auto-fit grid with a bare 1fr', () => {
    // `1fr` is `minmax(auto, 1fr)`, and the auto minimum reintroduces the blowout.
    const bareFr = CSS.match(/repeat\(auto-(?:fit|fill),\s*minmax\((?!min\(|0)/g) ?? [];
    expect(bareFr, `found un-clamped auto-fit tracks: ${bareFr.join(', ')}`).toHaveLength(0);
  });

  it('scrolls wide tables inside their own container', () => {
    expect(/\.table-wrap\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? '').toMatch(/overflow-x:\s*auto/);
  });
});

describe('the bar fill must be a block', () => {
  it('gives .bar-fill display: block', () => {
    // A width percentage on a bare inline <span> renders nothing at all — inline boxes
    // ignore width, so the bar is invisible and the view looks empty.
    expect(/\.bar-fill\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? '').toMatch(/display:\s*block/);
  });
});

describe('required third-party integrations', () => {
  it('ships the Cloudflare analytics beacon', () => {
    expect(HTML).toContain('static.cloudflareinsights.com/beacon.min.js');
  });

  it('ships the hosted feedback widget and does NOT vendor a local copy', () => {
    expect(HTML).toContain('https://feedback.benrichardson.dev/w.js');
    expect(SOURCES).not.toContain('src/feedback.ts');
    for (const file of SOURCES) {
      expect(read(file)).not.toMatch(/mountFeedback/);
    }
  });

  it('has no canonical link, which would trip source hygiene', () => {
    expect(HTML).not.toMatch(/rel=["']canonical["']/);
  });
});

describe('the site must not look like a repository', () => {
  it('links to no GitHub repository anywhere in the UI', () => {
    for (const file of SOURCES) {
      const text = read(file);
      expect(text, `${file} links to GitHub`).not.toMatch(/https:\/\/github\.com\//);
    }
    expect(HTML).not.toMatch(/https:\/\/github\.com\//);
  });

  it('carries the required attribution and the directory backlink in the footer', () => {
    const main = read('src/main.ts');
    expect(main).toContain('https://benrichardson.dev/');
    expect(main).toContain('https://lab.benrichardson.dev');
  });

  it('keeps licence copy out of the interface', () => {
    // Data attribution is required and stays; code-licence copy belongs in the repo only.
    // The SPDX header itself names AGPL, so scan the code rather than the comments.
    for (const file of SOURCES.filter((f) => f.startsWith('src/') && !f.endsWith('.css'))) {
      expect(stripJsComments(read(file)), `${file} puts code-licence copy in the UI`).not.toMatch(
        /AGPL|GNU Affero/
      );
    }
  });
});

describe('navigation tabs are words only', () => {
  it('has no numeric count in any nav label', () => {
    const router = read('src/router.ts');
    const labels = [...router.matchAll(/label:\s*'([^']+)'/g)].map((m) => m[1]);
    expect(labels.length).toBeGreaterThan(4);
    for (const label of labels) {
      expect(label, `nav label "${label}" contains a count`).not.toMatch(/\d/);
    }
  });
});

describe('geometry provenance', () => {
  it('ships a real boundary file, not hand-authored coordinates', () => {
    // A boundary file under 50 KB is an automatic fail — that is how rectangles for the
    // Northern Territory once shipped as a "map".
    const size = statSync(join(ROOT, 'public/data/au-states.geojson')).size;
    expect(size).toBeGreaterThan(50_000);
  });

  it('has no hand-written coordinate arrays in the source', () => {
    for (const file of SOURCES.filter((f) => f.startsWith('src/'))) {
      const text = read(file);
      // Three or more consecutive lat/lon-looking pairs is a hand-authored polygon.
      expect(text, `${file} looks like it contains hand-authored geometry`).not.toMatch(
        /\[\s*-?1[0-5]\d\.\d+\s*,\s*-[1-4]\d\.\d+\s*\]\s*,\s*\[\s*-?1[0-5]\d\.\d+/
      );
    }
  });
});

describe('the force layout must settle before paint', () => {
  it('never animates the network layout with requestAnimationFrame', () => {
    const network = read('src/views/network.ts');
    expect(network).toContain('forceLayout');
    expect(network, 'the graph must be motionless from the first frame').not.toMatch(
      /requestAnimationFrame/
    );
  });
});

describe('the map must not animate its zoom', () => {
  it('sets zoomAnimation: false', () => {
    // An interrupted zoom animation welds a scale() onto the tile container and the map
    // renders exactly one level too far out, silently, with getZoom() still truthful.
    expect(read('src/views/map.ts')).toMatch(/zoomAnimation:\s*false/);
  });

  it('loads Leaflet from npm rather than a CDN', () => {
    const map = read('src/views/map.ts');
    expect(map).toMatch(/^import L from 'leaflet';/m);
    expect(map).not.toMatch(/unpkg\.com|cdn\.jsdelivr/);
  });

  it('defends against fitting a zero-height container', () => {
    // fitBounds on a 0x0 box returns MAXIMUM zoom and renders one street corner, silently.
    const map = read('src/views/map.ts');
    expect(map).toMatch(/clientHeight\s*>\s*50/);
    expect(map).toContain('invalidateSize');
  });
});

describe('SPDX headers', () => {
  it('is on every first-party source file', () => {
    for (const file of SOURCES) {
      if (file.endsWith('.css')) continue;
      expect(read(file).slice(0, 200), `${file} has no SPDX header`).toMatch(/SPDX-License-Identifier/);
    }
    expect(CSS.slice(0, 200)).toMatch(/SPDX-License-Identifier/);
  });
});

describe('no debug output ships', () => {
  it('has no console.log or console.error in src/', () => {
    for (const file of SOURCES.filter((f) => f.startsWith('src/') && f.endsWith('.ts'))) {
      expect(read(file), `${file} logs to the console`).not.toMatch(/console\.(log|error|warn|debug)\(/);
    }
  });
});
