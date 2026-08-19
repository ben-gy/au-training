// SPDX-FileCopyrightText: 2026 Ben Richardson
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Every gate is fed the EXACT failure it exists to catch, and asserted to stop the build.
// A guard that has only ever been measured on convenient data is not a guard — this fleet
// has shipped 28.8 million hectares of phantom fire by testing a dedupe rule on the one
// season where it happened to be a no-op.

import { describe, expect, it } from 'vitest';
import {
  GateError,
  gateCountsWithinFleet,
  gateDecisionsWellFormed,
  gateDeliveryNotTruncated,
  gateEdgesResolve,
  gateHeadlineSameUniverse,
  gateLiveFilterDiscriminates,
  gateNoBadNumbers,
  gateNoPersonalData,
  gatePendingCountsAsLive,
  gateRegulatoryInForce,
  gateStateWithinNational,
} from '../pipeline/gates.mjs';

const row = (over = {}) => ({
  code: '100',
  status: 'current',
  isHistory: false,
  extentLabel: 'Deliver and assess',
  ...over,
});

describe('gateDeliveryNotTruncated', () => {
  it('passes on ordinary page counts', () => {
    expect(gateDeliveryNotTruncated({ A: new Array(37).fill(row()), B: [] }).pass).toBe(true);
  });

  it('FAILS on an exact multiple of the page size — the silent-truncation signature', () => {
    // This is precisely the shape that reported the country's most-supplied qualification
    // as having 721 providers instead of 809: a full page, and nobody followed next-page.
    expect(() => gateDeliveryNotTruncated({ BSB50420: new Array(1000).fill(row()) })).toThrow(GateError);
    expect(() => gateDeliveryNotTruncated({ BSB50420: new Array(2000).fill(row()) })).toThrow(/truncation/i);
  });

  it('respects a different page size', () => {
    expect(() => gateDeliveryNotTruncated({ A: new Array(500).fill(row()) }, 500)).toThrow(GateError);
    expect(gateDeliveryNotTruncated({ A: new Array(500).fill(row()) }, 1000).pass).toBe(true);
  });
});

describe('gateLiveFilterDiscriminates', () => {
  it('passes when the filter removes some rows but not all', () => {
    const rows = [row(), row(), row({ isHistory: true }), row({ status: 'cancelled' })];
    expect(gateLiveFilterDiscriminates(rows).pass).toBe(true);
  });

  it('FAILS when the filter removes nothing — history is being published as current', () => {
    expect(() => gateLiveFilterDiscriminates([row(), row(), row()])).toThrow(/history rows are not being excluded/);
  });

  it('FAILS when the filter removes everything', () => {
    expect(() => gateLiveFilterDiscriminates([row({ isHistory: true }), row({ isHistory: true })])).toThrow(
      /rejected all/
    );
  });

  it('FAILS on an empty harvest rather than reporting a clean pass over nothing', () => {
    expect(() => gateLiveFilterDiscriminates([])).toThrow(/no delivery rows/);
  });
});

describe('gatePendingCountsAsLive', () => {
  it('passes when a pending-only qualification is counted as supplied', () => {
    const rows = { A: [row({ status: 'pending' })], B: [row()] };
    const counts = new Map([['A', 1], ['B', 1]]);
    expect(gatePendingCountsAsLive(rows, counts).pass).toBe(true);
  });

  it('FAILS when a pending-only qualification is wrongly called an orphan', () => {
    // The naive status === 'current' filter produces exactly this, and it is what turns a
    // correct orphan count into an inflated one.
    const rows = { A: [row({ status: 'pending' })] };
    const counts = new Map([['A', 0]]);
    expect(() => gatePendingCountsAsLive(rows, counts)).toThrow(/manufactures orphan qualifications/);
  });

  it('falls back to asserting the vocabulary when no pending-only qualification exists', () => {
    const rows = { A: [row(), row({ status: 'pending' }), row({ status: 'suspended' })] };
    expect(gatePendingCountsAsLive(rows, new Map([['A', 2]])).pass).toBe(true);
  });

  it('FAILS if the upstream renames a status the live filter is keyed on', () => {
    // Silent vocabulary drift would otherwise make every provider count quietly wrong.
    const rows = { A: [row({ status: 'CURRENT_V2' })] };
    expect(() => gatePendingCountsAsLive(rows, new Map([['A', 0]]))).toThrow(/no longer contains/);
  });
});

describe('gateHeadlineSameUniverse', () => {
  const base = { currentCodes: ['A', 'B'], harvestedCodes: ['A', 'B'], orphanCodes: ['A'] };

  it('passes when numerator and denominator are the same set', () => {
    expect(gateHeadlineSameUniverse(base).pass).toBe(true);
  });

  it('FAILS when a current qualification has no harvested scope — a shrunken denominator', () => {
    expect(() =>
      gateHeadlineSameUniverse({ ...base, currentCodes: ['A', 'B', 'C'] })
    ).toThrow(/smaller denominator/);
  });

  it('FAILS when a non-current qualification pads the denominator', () => {
    expect(() => gateHeadlineSameUniverse({ ...base, harvestedCodes: ['A', 'B', 'Z'] })).toThrow(/pad the denominator/);
  });

  it('FAILS when an orphan sits outside the current set', () => {
    expect(() => gateHeadlineSameUniverse({ ...base, orphanCodes: ['A', 'Q'] })).toThrow(/outside the current set/);
  });
});

describe('gateCountsWithinFleet', () => {
  it('passes when no qualification claims more providers than exist', () => {
    expect(gateCountsWithinFleet(new Map([['A', 3]]), new Set(['1', '2', '3'])).pass).toBe(true);
  });

  it('FAILS when a count exceeds the whole fleet — the duplicate-edge signature', () => {
    expect(() => gateCountsWithinFleet(new Map([['A', 9]]), new Set(['1', '2']))).toThrow(/duplicate edges/);
  });
});

describe('gateEdgesResolve', () => {
  it('passes when every edge points at a known provider', () => {
    expect(gateEdgesResolve([{ rto: '1' }, { rto: '2' }], new Set(['1', '2'])).pass).toBe(true);
  });

  it('FAILS on a dangling edge — the missing-provider signature that lossy paging produces', () => {
    // This is exactly how the incomplete organisation harvest first announced itself:
    // real providers, including a university, absent from a register that looked complete.
    expect(() => gateEdgesResolve([{ rto: '60131' }], new Set(['1']))).toThrow(/not in the organisation harvest/);
  });
});

describe('gateStateWithinNational', () => {
  it('passes when each state count sits under the national count', () => {
    expect(gateStateWithinNational({ A: { NSW: 2, VIC: 1 } }, new Map([['A', 3]])).pass).toBe(true);
  });

  it('FAILS when a state reports more providers than the country', () => {
    expect(() => gateStateWithinNational({ A: { NSW: 9 } }, new Map([['A', 3]]))).toThrow(/national count is 3/);
  });
});

describe('gateDecisionsWellFormed', () => {
  it('passes on well-formed decisions', () => {
    expect(gateDecisionsWellFormed([{ rto: '1', decision: 'Condition', reference: 'R1' }], new Set(['1'])).pass).toBe(
      true
    );
  });

  it('FAILS when a decision attaches to an unknown provider', () => {
    expect(() => gateDecisionsWellFormed([{ rto: '999', decision: 'x' }], new Set(['1']))).toThrow(/unknown RTO/);
  });

  it('FAILS on a decision with no text — an adverse record with nothing to read', () => {
    expect(() => gateDecisionsWellFormed([{ rto: '1', decision: '' }], new Set(['1']))).toThrow(/no decision text/);
  });
});

describe('gateRegulatoryInForce', () => {
  const providers = (over = []) => [
    { status: 'current', currentDecisions: 1, flagged: true },
    { status: 'current', currentDecisions: 1, flagged: true },
    { status: 'current', currentDecisions: 0, flagged: false },
    ...over,
  ];

  it('passes when the date rule and the register flag agree', () => {
    expect(gateRegulatoryInForce(providers()).pass).toBe(true);
  });

  it('FAILS when trusting the stale isHistoric flag inflates the count', () => {
    // The real upstream failure: decisions marked non-historic and "In effect" whose end
    // date passed years ago. Publishing on the flag alone brands a provider as currently
    // sanctioned when the register itself says otherwise.
    const inflated = [
      ...providers(),
      ...Array.from({ length: 20 }, () => ({ status: 'current', currentDecisions: 1, flagged: false })),
    ];
    expect(() => gateRegulatoryInForce(inflated)).toThrow(/changed meaning/);
  });

  it('FAILS if either route finds nothing at all', () => {
    expect(() =>
      gateRegulatoryInForce([{ status: 'current', currentDecisions: 0, flagged: false }])
    ).toThrow(/one route found nothing/);
  });

  it('ignores providers that are not fully current, so the two routes compare like with like', () => {
    const withSuspended = [...providers(), { status: 'suspended', currentDecisions: 1, flagged: true }];
    expect(gateRegulatoryInForce(withSuspended).pass).toBe(true);
  });
});

describe('gateNoPersonalData', () => {
  it('passes on clean payloads', () => {
    expect(gateNoPersonalData({ a: [{ code: '1', name: 'A College' }] }).pass).toBe(true);
  });

  it('FAILS the whole build on one leaked email', () => {
    expect(() => gateNoPersonalData({ providers: [{ email: 'ceo@example.com' }] })).toThrow(GateError);
  });

  it('FAILS on a leaked mobile number', () => {
    expect(() => gateNoPersonalData({ providers: [{ note: 'call 0412 345 678' }] })).toThrow(GateError);
  });

  it('names the payload that leaked so it can be found', () => {
    expect(() => gateNoPersonalData({ restrictions: [{ text: 'a@b.com' }] })).toThrow(/restrictions/);
  });
});

describe('gateNoBadNumbers', () => {
  it('passes on finite numbers', () => {
    expect(gateNoBadNumbers({ n: 4, m: 0, x: -2.5 }).pass).toBe(true);
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('FAILS on %s, which renders as a blank or off-canvas bar', (_label, value) => {
    expect(() => gateNoBadNumbers({ providers: value }, 'summary')).toThrow(/non-finite/);
  });

  it('FAILS on a null where a count belongs', () => {
    expect(() => gateNoBadNumbers({ count: null, total: 1 }, 'summary')).toThrow(/null where a count/);
  });

  it('finds a bad number nested deep in an array', () => {
    expect(() => gateNoBadNumbers({ rows: [{ a: 1 }, { a: Number.NaN }] }, 'supply')).toThrow(/non-finite/);
  });
});
