// SPDX-FileCopyrightText: 2026 Ben Richardson
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Where the providers are. Real ABS state boundaries (never hand-authored geometry), real
// head-office coordinates from the register, Leaflet from npm.

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { loadBoundaries, loadProviders, loadSummary } from '../data.ts';
import { STATES, clip, esc, num, pct } from '../format.ts';
import { glossaryRef } from '../glossary.ts';
import type { Provider, StateCode, Summary } from '../types.ts';
import { errorState, legend, loading, statRow, viewHead } from '../components/ui.ts';

let mode: 'providers' | 'gaps' = 'providers';

export async function renderMap(root: HTMLElement): Promise<void> {
  root.innerHTML = loading('Loading the map…');
  try {
    const [summary, providers, boundaries] = await Promise.all([
      loadSummary(),
      loadProviders(),
      loadBoundaries(),
    ]);
    paint(root, summary, providers, boundaries);
  } catch (error) {
    root.innerHTML = errorState(error instanceof Error ? error.message : String(error), 'map-retry');
    root.querySelector('#map-retry')?.addEventListener('click', () => void renderMap(root));
  }
}

function paint(
  root: HTMLElement,
  summary: Summary,
  providers: Provider[],
  boundaries: GeoJSON.FeatureCollection
): void {
  const mappable = providers.filter((p) => p.lat != null && p.lon != null);

  root.innerHTML = `
    ${viewHead(
      'Where the providers are',
      `The head office of every ${glossaryRef('rto', 'registered training organisation')} that publishes
       coordinates, over real state boundaries. Shade the states by how many providers are based there, or by
       how many qualifications have no provider approved to deliver in them.`
    )}

    ${statRow([
      { value: num(summary.registeredRtos), label: 'providers on the register' },
      {
        value: num(summary.geocodedRtos),
        label: 'have mappable coordinates',
        note: `${pct(summary.geocodedRtos, summary.registeredRtos)} of the register`,
        tip:
          'A provider without coordinates is not missing from the site — it simply has no location in the\n' +
          'register, so it cannot be drawn. It still appears everywhere else.',
      },
      {
        value: num(summary.registeredRtos - summary.geocodedRtos),
        label: 'cannot be placed on this map',
        note: 'Shown in every other view',
        tone: 'warn',
      },
      { value: num(summary.teachingEdges), label: 'teaching relationships nationally' },
    ])}

    <div class="controls">
      <div class="chip-row" role="group" aria-label="Map shading">
        <button type="button" class="chip" data-mode="providers" aria-pressed="${mode === 'providers'}">Providers based here</button>
        <button type="button" class="chip" data-mode="gaps" aria-pressed="${mode === 'gaps'}">Qualifications unavailable here</button>
      </div>
    </div>

    <div class="map-frame"><div class="map-canvas" id="map-canvas"></div></div>
    <div id="map-legend"></div>
    <p class="view-sub" style="margin-top:.75rem;font-size:var(--fs-sm)">
      A head office is not a campus — many providers deliver across several states from one address, and
      online delivery is not geographic at all. Select a state to shade it, or a marker to open the provider.
    </p>
  `;

  const canvas = root.querySelector<HTMLElement>('#map-canvas')!;
  const legendHost = root.querySelector<HTMLElement>('#map-legend')!;

  const map = L.map(canvas, {
    minZoom: 3,
    maxZoom: 12,
    zoomControl: true,
    scrollWheelZoom: false,
    // Never animate the zoom. An animation interrupted by a layout pass welds a transform
    // onto the tile container and the map renders exactly one zoom level too far out,
    // silently and with getZoom() still reporting the truth.
    zoomAnimation: false,
  });
  map.attributionControl.setPrefix(false);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: 'Tiles © CARTO',
    subdomains: 'abcd',
    minZoom: 3,
    maxZoom: 12,
  }).addTo(map);

  const valueFor = (code: StateCode): number =>
    mode === 'providers'
      ? (summary.byState[code]?.providers ?? 0)
      : (summary.byState[code]?.qualsUnavailable ?? 0);

  const values = STATES.map(valueFor);
  const maxValue = Math.max(...values, 1);
  const minValue = Math.min(...values);

  const shade = (code: StateCode): string => {
    const v = valueFor(code);
    const t = maxValue === minValue ? 0.5 : (v - minValue) / (maxValue - minValue);
    if (mode === 'providers') {
      const ramp = ['#e0f2f1', '#a7dad5', '#5cbdb4', '#199e93', '#0d7d74'];
      return ramp[Math.min(ramp.length - 1, Math.floor(t * ramp.length))];
    }
    const ramp = ['#fde9ec', '#f7c2ca', '#ec93a3', '#cf5570', '#9f1239'];
    return ramp[Math.min(ramp.length - 1, Math.floor(t * ramp.length))];
  };

  const stateOf = (props: Record<string, unknown>): StateCode | null => {
    const code = String(props.code ?? props.STATE_CODE ?? '').toUpperCase();
    if (STATES.includes(code as StateCode)) return code as StateCode;
    const name = String(props.name ?? '').toUpperCase();
    const found = STATES.find((s) => name.startsWith(s));
    return found ?? null;
  };

  const layer = L.geoJSON(boundaries, {
    attribution: 'Boundaries: ABS ASGS (CC BY 4.0) · Register: training.gov.au (CC BY 4.0)',
    style: (feature) => {
      const code = stateOf((feature?.properties ?? {}) as Record<string, unknown>);
      return {
        fillColor: code ? shade(code) : '#e2e8f0',
        fillOpacity: 0.82,
        color: '#ffffff',
        weight: 1,
      };
    },
    onEachFeature: (feature, lyr) => {
      const code = stateOf((feature.properties ?? {}) as Record<string, unknown>);
      if (!code) return;
      const st = summary.byState[code];
      lyr.bindTooltip(
        `<strong>${code}</strong><br>${num(st.providers)} providers based here<br>` +
          `${num(st.deliverHere)} approved to deliver here<br>` +
          `${num(st.qualsUnavailable)} qualifications unavailable here`,
        { sticky: true, className: 'map-tip' }
      );
      lyr.on({
        mouseover: () => (lyr as L.Path).setStyle({ weight: 2.5, color: '#0f1b2d' }),
        mouseout: () => layer.resetStyle(lyr as L.Path),
      });
    },
  }).addTo(map);

  // Providers, as a lightweight canvas-rendered marker layer.
  const markers = L.layerGroup().addTo(map);
  const renderer = L.canvas({ padding: 0.4 });
  for (const p of mappable) {
    const flagged = p.currentDecisions > 0;
    const marker = L.circleMarker([p.lat!, p.lon!], {
      renderer,
      radius: flagged ? 5 : Math.max(2.5, Math.min(7, 2 + Math.sqrt(p.scope) * 0.55)),
      fillColor: flagged ? '#b45309' : '#1d4ed8',
      fillOpacity: 0.75,
      color: '#ffffff',
      weight: flagged ? 1.2 : 0.6,
    });
    marker.bindTooltip(
      `<strong>${esc(clip(p.name, 52))}</strong><br>${esc(p.suburb ?? '')} ${esc(p.state ?? '')}<br>` +
        `${num(p.scope)} qualification${p.scope === 1 ? '' : 's'}` +
        (flagged ? '<br><em>Under a regulatory decision</em>' : ''),
      { direction: 'top', opacity: 0.96, className: 'map-tip' }
    );
    marker.on('click', () => {
      void import('../components/dossier.ts').then((m) => m.openProvider(p.code));
    });
    markers.addLayer(marker);
  }

  const paintLegend = () => {
    legendHost.innerHTML = legend(
      mode === 'providers'
        ? [
            { colour: '#e0f2f1', label: 'Fewest providers' },
            { colour: '#0d7d74', label: 'Most providers' },
            { colour: '#1d4ed8', label: 'A provider (sized by how much it can teach)' },
            { colour: '#b45309', label: 'Provider under a regulatory decision' },
          ]
        : [
            { colour: '#fde9ec', label: 'Fewest qualifications unavailable' },
            { colour: '#9f1239', label: 'Most qualifications unavailable' },
            { colour: '#1d4ed8', label: 'A provider' },
            { colour: '#b45309', label: 'Provider under a regulatory decision' },
          ]
    );
  };
  paintLegend();

  for (const chip of root.querySelectorAll<HTMLElement>('[data-mode]')) {
    chip.addEventListener('click', () => {
      mode = chip.dataset.mode as 'providers' | 'gaps';
      for (const other of root.querySelectorAll<HTMLElement>('[data-mode]')) {
        other.setAttribute('aria-pressed', String(other === chip));
      }
      layer.setStyle((feature) => {
        const code = stateOf((feature?.properties ?? {}) as Record<string, unknown>);
        return { fillColor: code ? shade(code) : '#e2e8f0' };
      });
      paintLegend();
    });
  }

  // Fit only once the container actually has height. fitBounds on a 0x0 box returns
  // MAXIMUM zoom and renders a perfect map of one street corner, silently.
  const bounds = layer.getBounds();
  const fit = () => {
    map.invalidateSize();
    if (bounds.isValid() && canvas.clientHeight > 50) map.fitBounds(bounds, { padding: [12, 12] });
  };
  const observer = new ResizeObserver(() => {
    if (canvas.clientHeight > 50) {
      fit();
      observer.disconnect();
    }
  });
  observer.observe(canvas);
  setTimeout(fit, 400);
}
