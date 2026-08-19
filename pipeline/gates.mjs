// SPDX-FileCopyrightText: 2026 Ben Richardson
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Fatal reconciliation gates. Every one of these throws rather than warns: a build that
// ships wrong numbers is worse than a build that does not ship.
//
// The discipline this file follows, learned the hard way elsewhere in this fleet:
//  - Gate on the FAILURE, not on the happy path. A guard that has only ever been
//    measured on convenient data is not a guard.
//  - Never compute the two sides of a ratio over differently-filtered subsets.
//  - Distrust a finding in proportion to how quotable it is.

import { LIVE_STATUSES, assertNoContactDetails, isLiveDelivery } from './parse.mjs';

export class GateError extends Error {
  constructor(gate, message) {
    super(`GATE FAILED [${gate}]: ${message}`);
    this.name = 'GateError';
    this.gate = gate;
  }
}

const ok = (gate, detail) => ({ gate, pass: true, detail });

/** 1. No personal contact details anywhere in anything we publish. */
export function gateNoPersonalData(payloads) {
  for (const [label, payload] of Object.entries(payloads)) {
    try {
      assertNoContactDetails(payload, label);
    } catch (error) {
      throw new GateError('no-personal-data', error.message);
    }
  }
  return ok('no-personal-data', `${Object.keys(payloads).length} payloads clean`);
}

/** 2. The delivery harvest terminated properly for every qualification.
 *  An exact multiple of the page size with no terminating page is the truncation
 *  signature; this re-checks the collector's own guarantee against the cached data. */
export function gateDeliveryNotTruncated(deliveryByQual, pageSize = 1000) {
  const suspect = [];
  for (const [code, rows] of Object.entries(deliveryByQual)) {
    if (rows.length > 0 && rows.length % pageSize === 0) suspect.push(`${code}=${rows.length}`);
  }
  if (suspect.length) {
    throw new GateError(
      'delivery-not-truncated',
      `${suspect.length} qualification(s) returned an exact multiple of the ${pageSize}-row page ` +
        `size, which is the silent-truncation signature: ${suspect.slice(0, 8).join(', ')}`
    );
  }
  return ok('delivery-not-truncated', `${Object.keys(deliveryByQual).length} qualifications paged to exhaustion`);
}

/** 3. The live-edge filter is doing real work.
 *  If `!isHistory` and the status filter select identical sets, one of them is redundant and
 *  we want to know — but the failure we actually guard is the opposite: a filter that drops
 *  NOTHING (so history is being published as current) or drops EVERYTHING. */
export function gateLiveFilterDiscriminates(allRows) {
  const total = allRows.length;
  const notHistory = allRows.filter((r) => r.isHistory !== true).length;
  const live = allRows.filter(isLiveDelivery).length;

  if (total === 0) throw new GateError('live-filter', 'no delivery rows at all');
  if (live === total) {
    throw new GateError(
      'live-filter',
      `every one of ${total} scope rows passed the live filter — history rows are not being ` +
        `excluded, which inflates every provider count`
    );
  }
  if (live === 0) throw new GateError('live-filter', `the live filter rejected all ${total} rows`);
  if (live > notHistory) {
    throw new GateError('live-filter', `live (${live}) exceeds non-history (${notHistory}) — impossible`);
  }
  return ok(
    'live-filter',
    `${live.toLocaleString()} live of ${total.toLocaleString()} rows ` +
      `(${notHistory.toLocaleString()} non-history; status filter removed a further ${notHistory - live})`
  );
}

/** 4. `pending` and `suspended` providers are counted as live.
 *
 *  This is the guard that decides whether the site's headline number is right. A naive
 *  status === 'current' filter calls a qualification an orphan when its only provider is
 *  mid-re-registration. We assert against a real case rather than against the aggregate:
 *  find a qualification whose ONLY live providers are pending or suspended, and require
 *  that it is not counted as having zero providers. */
export function gatePendingCountsAsLive(deliveryByQual, providerCount) {
  let witness = null;
  for (const [code, rows] of Object.entries(deliveryByQual)) {
    const live = rows.filter(isLiveDelivery);
    if (!live.length) continue;
    if (live.every((r) => r.status === 'pending' || r.status === 'suspended')) {
      witness = { code, statuses: [...new Set(live.map((r) => r.status))], n: live.length };
      break;
    }
  }
  if (!witness) {
    // No such qualification exists in this snapshot. Fall back to asserting the
    // vocabulary is still what we think it is, so a silent rename cannot slip past.
    const statuses = new Set();
    for (const rows of Object.values(deliveryByQual)) for (const r of rows) statuses.add(r.status);
    const missing = LIVE_STATUSES.filter((s) => !statuses.has(s));
    if (missing.length) {
      throw new GateError(
        'pending-counts-as-live',
        `the delivery status vocabulary no longer contains ${missing.join(', ')} — ` +
          `observed: ${[...statuses].sort().join(', ')}. The live filter is keyed on strings ` +
          `that no longer exist, so provider counts cannot be trusted.`
      );
    }
    return ok('pending-counts-as-live', `no pending-only qualification in this snapshot; vocabulary intact`);
  }

  const counted = providerCount.get(witness.code);
  if (!counted) {
    throw new GateError(
      'pending-counts-as-live',
      `${witness.code} has ${witness.n} live provider(s), all ${witness.statuses.join('/')}, ` +
        `but is counted as having ${counted} — a re-registering provider is being treated as gone, ` +
        `which manufactures orphan qualifications`
    );
  }
  return ok(
    'pending-counts-as-live',
    `${witness.code} (${witness.statuses.join('/')} only) correctly counted as ${counted} provider(s)`
  );
}

/** 5. The orphan headline is computed over ONE universe.
 *  Numerator and denominator must both be "current qualifications for which delivery scope
 *  was harvested" — not current qualifications on one side and harvested codes on the other.
 *  Mismatched subsets are how this fleet has manufactured false headlines before. */
export function gateHeadlineSameUniverse({ currentCodes, harvestedCodes, orphanCodes }) {
  const current = new Set(currentCodes);
  const harvested = new Set(harvestedCodes);

  const missing = [...current].filter((c) => !harvested.has(c));
  if (missing.length) {
    throw new GateError(
      'headline-same-universe',
      `${missing.length} current qualification(s) have no harvested delivery scope, so the ` +
        `orphan rate would be computed over a smaller denominator than it claims: ` +
        `${missing.slice(0, 6).join(', ')}`
    );
  }
  const extra = [...harvested].filter((c) => !current.has(c));
  if (extra.length) {
    throw new GateError(
      'headline-same-universe',
      `${extra.length} harvested qualification(s) are not current, so they would pad the denominator`
    );
  }
  const stray = orphanCodes.filter((c) => !current.has(c));
  if (stray.length) {
    throw new GateError('headline-same-universe', `${stray.length} orphan(s) are outside the current set`);
  }
  return ok(
    'headline-same-universe',
    `${current.size} current qualifications = ${harvested.size} harvested; ` +
      `${orphanCodes.length} orphans all inside that set`
  );
}

/** 6. Provider counts never exceed the number of registered RTOs that exist. */
export function gateCountsWithinFleet(providerCount, rtoCodes) {
  const fleet = rtoCodes.size ?? rtoCodes.length;
  for (const [code, n] of providerCount) {
    if (n > fleet) {
      throw new GateError(
        'counts-within-fleet',
        `${code} reports ${n} providers but only ${fleet} organisations exist — ` +
          `duplicate edges are being counted`
      );
    }
  }
  const max = Math.max(0, ...providerCount.values());
  return ok('counts-within-fleet', `max ${max} providers on one qualification, fleet size ${fleet}`);
}

/** 7. Every delivery edge points at an organisation we actually hold.
 *  A dangling edge means the graph view would render nodes with no label. */
export function gateEdgesResolve(edges, orgCodes) {
  const dangling = new Set();
  for (const e of edges) if (!orgCodes.has(e.rto)) dangling.add(e.rto);
  if (dangling.size) {
    throw new GateError(
      'edges-resolve',
      `${dangling.size} delivery edge target(s) are not in the organisation harvest: ` +
        `${[...dangling].slice(0, 8).join(', ')}`
    );
  }
  return ok('edges-resolve', `all edges resolve to known organisations`);
}

/** 8. Per-state coverage never exceeds the national count for the same qualification. */
export function gateStateWithinNational(coverageByQual, providerCount) {
  for (const [code, coverage] of Object.entries(coverageByQual)) {
    const national = providerCount.get(code) ?? 0;
    for (const [state, n] of Object.entries(coverage)) {
      if (n > national) {
        throw new GateError(
          'state-within-national',
          `${code}: ${state} shows ${n} providers but the national count is ${national}`
        );
      }
    }
  }
  return ok('state-within-national', `${Object.keys(coverageByQual).length} qualifications consistent`);
}

/** 9. Regulatory decisions attach to organisations that exist and carry a real provision. */
export function gateDecisionsWellFormed(decisions, orgCodes) {
  const problems = [];
  for (const d of decisions) {
    if (!orgCodes.has(d.rto)) problems.push(`${d.reference ?? '?'} → unknown RTO ${d.rto}`);
    if (!d.decision) problems.push(`${d.reference ?? '?'} has no decision text`);
  }
  if (problems.length) {
    throw new GateError('decisions-well-formed', `${problems.length}: ${problems.slice(0, 5).join('; ')}`);
  }
  return ok('decisions-well-formed', `${decisions.length} decisions attach to known providers`);
}

/** 10. The "in force" rule for regulatory decisions agrees with the register's own flag.
 *
 *  This exists because `isHistoric` is stale. Decisions carrying isHistoric:false and
 *  decisionStatus "In effect" with an endDate years in the past sit in the feed, and
 *  trusting that flag alone would publish an adverse claim about a named business whose
 *  condition lapsed long ago. Our rule adds "and not expired". Two independent routes must
 *  land on the same providers: our date-based rule, and the register's own
 *  hasCurrentRestrictionOrRegulatoryDecision flag. If they diverge materially, one of them
 *  has changed meaning and we stop rather than publish. */
export function gateRegulatoryInForce(providers, { tolerance = 0.05 } = {}) {
  const current = providers.filter((p) => p.status === 'current');
  const byRule = current.filter((p) => p.currentDecisions > 0).length;
  const byFlag = current.filter((p) => p.flagged).length;

  if (byRule === 0 || byFlag === 0) {
    throw new GateError('regulatory-in-force', `one route found nothing: rule=${byRule}, flag=${byFlag}`);
  }
  const drift = Math.abs(byRule - byFlag) / byFlag;
  if (drift > tolerance) {
    throw new GateError(
      'regulatory-in-force',
      `the date-based rule finds ${byRule} currently-registered providers under a decision in force, ` +
        `but the register's own flag finds ${byFlag} — ${(drift * 100).toFixed(1)}% apart. ` +
        `Either isHistoric or the flag has changed meaning; do not publish an adverse claim on a guess.`
    );
  }
  return ok(
    'regulatory-in-force',
    `${byRule} by the not-historic-and-not-expired rule vs ${byFlag} by the register's own flag ` +
      `(${(drift * 100).toFixed(1)}% apart)`
  );
}

/** 11. No published number is NaN, Infinity or undefined. Cheap, and catches a whole
 *  family of chart bugs that render as blank or as a bar off the top of the canvas. */
export function gateNoBadNumbers(payload, label = 'payload') {
  const json = JSON.stringify(payload, (_k, v) =>
    typeof v === 'number' && !Number.isFinite(v) ? `__BAD__${v}` : v
  );
  const hits = json.match(/__BAD__[^"]*/g);
  if (hits) {
    throw new GateError('no-bad-numbers', `${label} contains ${hits.length} non-finite number(s): ${hits.slice(0, 5)}`);
  }
  if (/:\s*null\s*,\s*"(count|total|providers)"/.test(json)) {
    // Not fatal on its own — counts are never legitimately null.
    throw new GateError('no-bad-numbers', `${label} has a null where a count is expected`);
  }
  return ok('no-bad-numbers', `${label} numerically clean`);
}

/** Run a list of gate thunks, printing each result. Any throw aborts the build. */
export function runGates(gates) {
  const results = [];
  for (const [name, thunk] of gates) {
    const result = thunk();
    results.push(result);
    process.stdout.write(`  ✓ ${name}: ${result.detail}\n`);
  }
  return results;
}
