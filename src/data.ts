// SPDX-FileCopyrightText: 2026 Ben Richardson
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// One loader per dataset, each memoised, so a view can ask for what it needs without
// two views racing to download the same file. Only summary.json and supply.json are
// fetched at boot; everything else arrives when the view that needs it is opened.

import type {
  Decision,
  LineageQual,
  MatrixPackage,
  Provider,
  Restriction,
  Summary,
  SupplyRow,
} from './types.ts';

const BASE = 'data/';

class DataError extends Error {
  constructor(readonly file: string, cause: unknown) {
    super(`Could not load ${file}: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'DataError';
  }
}

const cache = new Map<string, Promise<unknown>>();

function load<T>(file: string): Promise<T> {
  const hit = cache.get(file);
  if (hit) return hit as Promise<T>;

  const promise = (async () => {
    try {
      const res = await fetch(BASE + file);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (error) {
      // Drop the rejected promise so a retry can actually retry.
      cache.delete(file);
      throw new DataError(file, error);
    }
  })();

  cache.set(file, promise);
  return promise as Promise<T>;
}

export const loadSummary = () => load<Summary>('summary.json');
export const loadSupply = () => load<SupplyRow[]>('supply.json');
export const loadProviders = () => load<Provider[]>('providers.json');
export const loadRegulatory = () =>
  load<{ decisions: Decision[]; restrictions: Restriction[] }>('regulatory.json');
export const loadMatrix = () =>
  load<{ levels: string[]; packages: MatrixPackage[] }>('matrix.json');
export const loadNetwork = () => load<{ edges: [string, string][] }>('network.json');
export const loadLineage = () => load<{ quals: LineageQual[] }>('lineage.json');
export const loadBoundaries = () => load<GeoJSON.FeatureCollection>('au-states.geojson');

/** Providers keyed by code — every view that renders an edge needs this. */
let providerIndex: Promise<Map<string, Provider>> | null = null;
export function loadProviderIndex(): Promise<Map<string, Provider>> {
  providerIndex ??= loadProviders().then((rows) => new Map(rows.map((p) => [p.code, p])));
  return providerIndex;
}

/** Qualifications keyed by code. */
let supplyIndex: Promise<Map<string, SupplyRow>> | null = null;
export function loadSupplyIndex(): Promise<Map<string, SupplyRow>> {
  supplyIndex ??= loadSupply().then((rows) => new Map(rows.map((q) => [q.code, q])));
  return supplyIndex;
}
