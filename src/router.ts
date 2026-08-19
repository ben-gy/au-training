// SPDX-FileCopyrightText: 2026 Ben Richardson
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Hash routing: #/view?param=value. Deep links to a provider or qualification dossier
// live in the query so they survive a view change and can be shared.

export interface Route {
  view: string;
  params: URLSearchParams;
}

export const VIEWS = [
  { id: 'supply', label: 'Supply' },
  { id: 'coverage', label: 'By state' },
  { id: 'providers', label: 'Providers' },
  { id: 'regulator', label: 'Regulator' },
  { id: 'network', label: 'Network' },
  { id: 'map', label: 'Map' },
  { id: 'system', label: 'System' },
  { id: 'lineage', label: 'Lineage' },
  { id: 'method', label: 'Method' },
] as const;

export const DEFAULT_VIEW = 'supply';

const VIEW_IDS = new Set(VIEWS.map((v) => v.id as string));

export function parseRoute(hash: string = location.hash): Route {
  const raw = hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const view = VIEW_IDS.has(path) ? path : DEFAULT_VIEW;
  return { view, params: new URLSearchParams(query) };
}

export function buildHash(view: string, params?: URLSearchParams | Record<string, string>): string {
  const search =
    params instanceof URLSearchParams
      ? params
      : new URLSearchParams(Object.entries(params ?? {}).filter(([, v]) => v));
  const query = search.toString();
  return `#/${view}${query ? `?${query}` : ''}`;
}

export function navigate(view: string, params?: URLSearchParams | Record<string, string>): void {
  const next = buildHash(view, params);
  if (location.hash === next) {
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    return;
  }
  location.hash = next;
}

/** Change one query parameter without leaving the current view, and without pushing a
 *  history entry the user then has to press Back through. */
export function setParam(key: string, value: string | null): void {
  const { view, params } = parseRoute();
  if (value == null || value === '') params.delete(key);
  else params.set(key, value);
  history.replaceState(null, '', buildHash(view, params));
}

export function onRoute(handler: (route: Route) => void): void {
  window.addEventListener('hashchange', () => handler(parseRoute()));
  handler(parseRoute());
}
