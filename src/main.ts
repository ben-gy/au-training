// SPDX-FileCopyrightText: 2026 Ben Richardson
// SPDX-License-Identifier: AGPL-3.0-or-later

import './styles.css';

import { openAbout } from './about.ts';
import { initDossierLinks, openProvider, openQualification } from './components/dossier.ts';
import { initTooltip } from './components/tooltip.ts';
import { errorState } from './components/ui.ts';
import { initGlossary } from './glossary.ts';
import { closeOverlay } from './overlay.ts';
import { VIEWS, buildHash, navigate, onRoute, parseRoute, type Route } from './router.ts';

const app = document.getElementById('app');
if (!app) throw new Error('#app is missing from the document');

app.innerHTML = `
  <header class="site-header">
    <div class="header-inner">
      <a class="brand" href="#/supply">
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <rect x="2" y="6" width="28" height="20" rx="3" fill="none" stroke="currentColor" stroke-width="2"/>
          <path d="M7 13h8M7 18h12M20 12l3 3-3 3" fill="none" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span class="brand-text">
          <span class="brand-name">Training Register</span>
          <span class="brand-sub">Who can teach what, and where</span>
        </span>
      </a>
      <nav class="site-nav" id="site-nav" aria-label="Views">
        ${VIEWS.map((v) => `<a class="nav-tab" href="${buildHash(v.id)}" data-view="${v.id}">${v.label}</a>`).join('')}
      </nav>
      <div class="header-actions">
        <button type="button" class="icon-button" id="about-button" aria-label="About this site">?</button>
      </div>
    </div>
  </header>

  <main class="main-content" id="view-root" tabindex="-1"></main>

  <footer class="site-footer">
    <div class="footer-inner">
      <p>
        Data: the <a href="https://training.gov.au/" target="_blank" rel="noopener">National Training Register</a>
        (Australian Government), <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>.
        Boundaries: ABS ASGS, CC BY 4.0. This is a derived monthly snapshot, not the authoritative record —
        check the register itself before relying on any registration status.
      </p>
      <p>
        Built by <a href="https://benrichardson.dev/">benrichardson.dev</a> ·
        <a href="https://lab.benrichardson.dev" target="_blank" rel="noopener">more tools &amp; sites</a>
      </p>
    </div>
  </footer>
`;

const viewRoot = document.getElementById('view-root') as HTMLElement;

initTooltip();
initGlossary();
initDossierLinks(document);

document.getElementById('about-button')!.addEventListener('click', () => void openAbout());

/** Views are code-split: the map pulls in Leaflet, and nobody who never opens it should pay for that. */
const LOADERS: Record<string, () => Promise<(root: HTMLElement) => Promise<void> | void>> = {
  supply: () => import('./views/supply.ts').then((m) => m.renderSupply),
  coverage: () => import('./views/coverage.ts').then((m) => m.renderCoverage),
  providers: () => import('./views/providers.ts').then((m) => m.renderProviders),
  regulator: () => import('./views/regulator.ts').then((m) => m.renderRegulator),
  network: () => import('./views/network.ts').then((m) => m.renderNetwork),
  map: () => import('./views/map.ts').then((m) => m.renderMap),
  system: () => import('./views/system.ts').then((m) => m.renderSystem),
  lineage: () => import('./views/lineage.ts').then((m) => m.renderLineage),
  method: () => import('./views/method.ts').then((m) => m.renderMethod),
};

let currentView = '';
let openedFromUrl = false;

async function show(route: Route): Promise<void> {
  for (const tab of document.querySelectorAll<HTMLElement>('.nav-tab')) {
    const active = tab.dataset.view === route.view;
    if (active) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }

  if (route.view !== currentView) {
    currentView = route.view;
    // A view change while a drawer is open would otherwise leave the drawer floating over
    // content it no longer belongs to.
    closeOverlay();
    viewRoot.innerHTML = '<div class="view wrap"></div>';
    const host = viewRoot.querySelector<HTMLElement>('.view')!;
    try {
      const render = await LOADERS[route.view]();
      await render(host);
    } catch (error) {
      host.innerHTML = errorState(
        error instanceof Error ? error.message : String(error),
        'view-retry'
      );
      host.querySelector('#view-retry')?.addEventListener('click', () => {
        currentView = '';
        void show(parseRoute());
      });
    }
  }

  // Deep links open their dossier once, on first load. Re-opening on every route change
  // would fight the user closing it.
  if (!openedFromUrl) {
    openedFromUrl = true;
    const qual = route.params.get('qual');
    const rto = route.params.get('rto');
    if (qual) void openQualification(qual);
    else if (rto) void openProvider(rto);
  }
}

onRoute((route) => void show(route));

if (!location.hash) navigate('supply');
