// SPDX-FileCopyrightText: 2026 Ben Richardson
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// parse.mjs is imported directly and has no dependencies, so these run on a bare CI runner.

import { describe, expect, it } from 'vitest';
import {
  DEAD_STATUSES,
  ON_REGISTER_STATUSES,
  TEACHING_STATUSES,
  assertNoContactDetails,
  canDeliver,
  canTeachToday,
  cleanDate,
  countBy,
  deliveryRowStates,
  deliveryStates,
  htmlToText,
  isLiveDelivery,
  median,
  normaliseState,
  orphanHistory,
  providerHistogram,
  redactContacts,
  slimDecision,
  slimDelivery,
  slimOrganisation,
  slimQualification,
  stateCoverage,
  supplyTier,
  supplyVariants,
} from '../pipeline/parse.mjs';

const deliveryRow = (over = {}) => ({
  code: '12345',
  status: 'current',
  isHistory: false,
  extentLabel: 'Deliver and assess',
  deliveryNsw: true,
  deliveryVic: false,
  scopeStartDate: '2020-01-01',
  scopeEndDate: null,
  ...over,
});

describe('cleanDate', () => {
  it('passes a real date through', () => {
    expect(cleanDate('2025-06-30')).toBe('2025-06-30');
  });
  it('collapses the far-future sentinel to null', () => {
    expect(cleanDate('9999-12-31')).toBeNull();
    expect(cleanDate('9999-12-30T14:00:00.000Z')).toBeNull();
  });
  it('trims a timestamp to the day', () => {
    expect(cleanDate('2025-06-30T14:24:33.23+00:00')).toBe('2025-06-30');
  });
  it('rejects junk rather than inventing a date', () => {
    expect(cleanDate('not a date')).toBeNull();
    expect(cleanDate('')).toBeNull();
    expect(cleanDate(null)).toBeNull();
    expect(cleanDate(undefined)).toBeNull();
  });
  it('rejects an implausible year that is not a known sentinel', () => {
    expect(cleanDate('1066-10-14')).toBeNull();
  });
});

describe('normaliseState', () => {
  it('reads the nested abbreviation the API actually sends', () => {
    expect(normaliseState({ abbreviation: 'WA', name: 'Western Australia' })).toBe('WA');
  });
  it('accepts a bare code', () => {
    expect(normaliseState('QLD')).toBe('QLD');
  });
  it('maps a long form to its code', () => {
    expect(normaliseState({ name: 'New South Wales' })).toBe('NSW');
  });
  it('returns null for an overseas or unknown value rather than guessing', () => {
    expect(normaliseState({ abbreviation: 'DELAWARE' })).toBeNull();
    expect(normaliseState(null)).toBeNull();
    expect(normaliseState('')).toBeNull();
  });
});

describe('delivery state flags', () => {
  it('reads the eight organisation booleans', () => {
    expect(deliveryStates({ nsw: true, vic: false, qld: true, international: true })).toEqual(['NSW', 'QLD']);
  });
  it('reads the differently-spelled delivery-row flags', () => {
    expect(deliveryRowStates(deliveryRow({ deliveryQld: true }))).toEqual(['NSW', 'QLD']);
  });
  it('returns an empty list rather than throwing on junk', () => {
    expect(deliveryStates(null)).toEqual([]);
    expect(deliveryRowStates(undefined)).toEqual([]);
  });
});

describe('the live / teaching rules — the guards the headline depends on', () => {
  it('treats a plain current row as live and teaching', () => {
    const row = deliveryRow();
    expect(isLiveDelivery(row)).toBe(true);
    expect(canTeachToday(row)).toBe(true);
  });

  it('REJECTS a historical row even though its status still reads "current"', () => {
    // This is the specific upstream behaviour that inflates provider counts by ~17%:
    // isHistory rows keep status 'current', so a status-only filter keeps departed providers.
    const row = deliveryRow({ isHistory: true, status: 'current' });
    expect(isLiveDelivery(row)).toBe(false);
    expect(canTeachToday(row)).toBe(false);
  });

  it('counts a provider mid re-registration as able to teach', () => {
    // A naive status === 'current' filter calls a qualification an orphan when its only
    // provider is pending. That is the error this test exists to prevent.
    const row = deliveryRow({ status: 'pending' });
    expect(canTeachToday(row)).toBe(true);
  });

  it('does NOT count a suspended provider as able to teach, but does count it as on the register', () => {
    const row = deliveryRow({ status: 'suspended' });
    expect(isLiveDelivery(row)).toBe(true);
    expect(canTeachToday(row)).toBe(false);
  });

  it.each(DEAD_STATUSES)('rejects a %s provider outright', (status) => {
    expect(isLiveDelivery(deliveryRow({ status }))).toBe(false);
    expect(canTeachToday(deliveryRow({ status }))).toBe(false);
  });

  it('excludes assess-only scope from teaching', () => {
    const row = deliveryRow({ extentLabel: 'Assess only' });
    expect(canDeliver(row)).toBe(false);
    expect(isLiveDelivery(row)).toBe(true);
    expect(canTeachToday(row)).toBe(false);
  });

  it('keeps the two status vocabularies distinct and correctly ordered', () => {
    expect(ON_REGISTER_STATUSES).toContain('suspended');
    expect(TEACHING_STATUSES).not.toContain('suspended');
    for (const s of TEACHING_STATUSES) expect(ON_REGISTER_STATUSES).toContain(s);
  });

  it('survives malformed rows', () => {
    expect(isLiveDelivery(null)).toBe(false);
    expect(isLiveDelivery({})).toBe(false);
    expect(canTeachToday('nonsense')).toBe(false);
  });
});

describe('supplyVariants — the sensitivity analysis', () => {
  // A qualification whose ONLY provider is pending. Under a naive current-only rule this
  // is an orphan; under the real rule it is not. This is the exact failure the guard
  // exists to catch, so the fixture is built where the failure lives.
  const rows = {
    PENDING_ONLY: [deliveryRow({ code: 'A1', status: 'pending' })],
    SUSPENDED_ONLY: [deliveryRow({ code: 'A2', status: 'suspended' })],
    ASSESS_ONLY: [deliveryRow({ code: 'A3', extentLabel: 'Assess only' })],
    HEALTHY: [deliveryRow({ code: 'A4' }), deliveryRow({ code: 'A5' })],
    NEVER: [],
    HISTORY_ONLY: [deliveryRow({ code: 'A6', isHistory: true })],
  };

  const { counts, variants } = supplyVariants(rows, { releasedWithinYear: new Set(['NEVER']) });

  it('does not call a pending-only qualification an orphan', () => {
    expect(counts.get('PENDING_ONLY')).toBe(1);
  });

  it('DOES call a suspended-only qualification an orphan, because a suspension stops delivery', () => {
    expect(counts.get('SUSPENDED_ONLY')).toBe(0);
  });

  it('treats assess-only supply as no supply for teaching', () => {
    expect(counts.get('ASSESS_ONLY')).toBe(0);
  });

  it('counts distinct providers, not rows', () => {
    expect(counts.get('HEALTHY')).toBe(2);
  });

  it('does not count providers who have left', () => {
    expect(counts.get('HISTORY_ONLY')).toBe(0);
  });

  it('reports a different orphan count under each alternative rule', () => {
    // headline: SUSPENDED_ONLY, ASSESS_ONLY, NEVER, HISTORY_ONLY = 4
    expect(variants.headline.orphans).toBe(4);
    // counting assess-only supply rescues ASSESS_ONLY
    expect(variants.includeAssessOnly.orphans).toBe(3);
    // counting suspended providers rescues SUSPENDED_ONLY
    expect(variants.includeSuspended.orphans).toBe(3);
    // requiring full currency loses PENDING_ONLY as well
    expect(variants.strictCurrentOnly.orphans).toBe(5);
    // excluding the brand-new qualification drops NEVER from the tally
    expect(variants.excludingNewQualifications.orphans).toBe(3);
  });

  it('gives every variant a human-readable label and note', () => {
    for (const v of Object.values(variants)) {
      expect(v.label.length).toBeGreaterThan(8);
      expect(v.note.length).toBeGreaterThan(20);
      expect(Number.isInteger(v.orphans)).toBe(true);
    }
  });
});

describe('orphanHistory', () => {
  it('separates never-supplied from lost-supply, which are different stories', () => {
    const rows = {
      NEVER: [],
      LOST: [deliveryRow({ isHistory: true })],
      FINE: [deliveryRow()],
    };
    const counts = countBy(rows, canTeachToday);
    const { never, lost } = orphanHistory(rows, counts);
    expect(never).toEqual(['NEVER']);
    expect(lost).toEqual(['LOST']);
  });
});

describe('stateCoverage', () => {
  it('counts only providers who can teach, per state', () => {
    const edges = [
      slimDelivery(deliveryRow({ code: 'A', deliveryQld: true })),
      slimDelivery(deliveryRow({ code: 'B', status: 'suspended', deliveryQld: true })),
      slimDelivery(deliveryRow({ code: 'C', extentLabel: 'Assess only', deliveryQld: true })),
    ];
    const coverage = stateCoverage(edges);
    expect(coverage.NSW).toBe(1);
    expect(coverage.QLD).toBe(1);
    expect(coverage.VIC).toBe(0);
  });

  it('reports every state, so a zero is explicit rather than missing', () => {
    const coverage = stateCoverage([]);
    expect(Object.keys(coverage)).toHaveLength(8);
    expect(Object.values(coverage).every((n) => n === 0)).toBe(true);
  });
});

describe('supplyTier and histogram', () => {
  it.each([
    [0, 'none'],
    [1, 'single'],
    [5, 'thin'],
    [6, 'moderate'],
    [50, 'moderate'],
    [51, 'crowded'],
    [800, 'crowded'],
  ])('buckets %i as %s', (n, tier) => {
    expect(supplyTier(n)).toBe(tier);
  });

  it('gives zero its own histogram bin, separate from one', () => {
    const bins = providerHistogram([0, 0, 1, 3, 400]);
    expect(bins.find((b) => b.label === '0')!.count).toBe(2);
    expect(bins.find((b) => b.label === '1')!.count).toBe(1);
    expect(bins.find((b) => b.label === '2–5')!.count).toBe(1);
    expect(bins.find((b) => b.label === '251+')!.count).toBe(1);
  });

  it('conserves the total across all bins', () => {
    const values = [0, 1, 2, 7, 20, 30, 80, 200, 900];
    const total = providerHistogram(values).reduce((n, b) => n + b.count, 0);
    expect(total).toBe(values.length);
  });
});

describe('median', () => {
  it('averages the middle pair on an even count', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
  it('takes the middle of an odd count', () => {
    expect(median([5, 1, 3])).toBe(3);
  });
  it('returns 0 for an empty list rather than NaN', () => {
    expect(median([])).toBe(0);
  });
  it('ignores non-finite values instead of poisoning the result', () => {
    expect(median([1, Number.NaN, 3, Number.POSITIVE_INFINITY])).toBe(2);
  });
});

describe('htmlToText', () => {
  it('decodes the entity-encoded apostrophe the register uses', () => {
    expect(htmlToText('<p>the provider&#39;s registration</p>')).toBe("the provider's registration");
  });
  it('turns list items into bullets and block ends into newlines', () => {
    expect(htmlToText('<ul><li>one</li><li>two</li></ul>')).toBe('• one\n• two');
  });
  it('strips tags without eating surrounding prose', () => {
    expect(htmlToText('a <strong>b</strong> c')).toBe('a b c');
  });
  it('does not treat a stray less-than in prose as a tag', () => {
    expect(htmlToText('fewer than 5 < 10 students')).toContain('5 < 10');
  });
  it('handles null and empty input', () => {
    expect(htmlToText(null)).toBe('');
    expect(htmlToText('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Privacy — the most important tests in this repository.
// ---------------------------------------------------------------------------

describe('privacy: the allowlist', () => {
  const raw = {
    code: '52958',
    legalName: 'Global Transport Training Pty Ltd',
    isRto: true,
    isCurrent: true,
    abns: ['86632705796'],
    // Every one of these is real personal data on a named individual.
    ceo: { name: 'A Person', email: 'admin@example.com', phone: '0483326916', jobTitle: 'CEO' },
    publicEnquiries: { name: 'A Person', email: 'admin@example.com', phone: '0483326916' },
    registrationEnquiries: { name: 'A Person', email: 'admin@example.com', phone: '0483326916' },
    registration: { status: 'current', statusLabel: 'Current', startDate: '2025-05-01', endDate: '2027-04-30' },
    registrationManager: { shortName: 'ASQA' },
    rtoType: { name: 'Private RTO' },
    headOfficeAddress: {
      suburb: 'Beckenham',
      postCode: '6107',
      state: { abbreviation: 'WA' },
      country: { name: 'Australia' },
      location: { coordinates: { latitude: -32.02189, longitude: 115.95214 } },
    },
    delivery: { nsw: true, wa: true },
    webAddresses: [{ address: 'https://example.com' }],
  };

  const slim = slimOrganisation(raw);

  it('keeps the fields the site needs', () => {
    expect(slim.code).toBe('52958');
    expect(slim.name).toBe('Global Transport Training Pty Ltd');
    expect(slim.state).toBe('WA');
    expect(slim.lat).toBeCloseTo(-32.02189, 4);
    expect(slim.deliversIn).toEqual(['NSW', 'WA']);
  });

  it('drops every contact block', () => {
    expect('ceo' in slim).toBe(false);
    expect('publicEnquiries' in slim).toBe(false);
    expect('registrationEnquiries' in slim).toBe(false);
  });

  it('leaks nothing contact-shaped into the serialised record', () => {
    expect(() => assertNoContactDetails(slim, 'organisation')).not.toThrow();
  });

  it('is an ALLOWLIST — an unknown new contact field the upstream adds is dropped automatically', () => {
    // A denylist would ship this. This is the whole reason the parser names what it keeps.
    // The injected domain is deliberately NOT the fixture's legitimate website domain, so
    // this asserts the new field was dropped rather than accidentally matching a field we
    // are supposed to keep.
    const withNewField = slimOrganisation({
      ...raw,
      emergencyContact: { name: 'Someone', email: 'someone@private-inbox.test', mobile: '0400000000' },
      ownerMobile: '0411111111',
    });
    const json = JSON.stringify(withNewField);
    expect(() => assertNoContactDetails(withNewField, 'organisation')).not.toThrow();
    expect(json).not.toContain('private-inbox.test');
    expect(json).not.toContain('0411111111');
    expect(json).not.toContain('emergencyContact');
    // …while the legitimate business website it IS meant to keep survives.
    expect(withNewField.website).toBe('https://example.com');
  });

  it('refuses a mailto: masquerading as a website', () => {
    const withMailto = slimOrganisation({ ...raw, webAddresses: [{ address: 'mailto:ceo@example.com' }] });
    expect(withMailto.website).toBeNull();
  });

  it('rejects coordinates outside Australia rather than plotting them', () => {
    const overseas = slimOrganisation({
      ...raw,
      headOfficeAddress: { ...raw.headOfficeAddress, location: { coordinates: { latitude: 51.5, longitude: -0.12 } } },
    });
    expect(overseas.lat).toBeNull();
    expect(overseas.lon).toBeNull();
  });
});

describe('privacy: the CI gate', () => {
  it('throws on an email address anywhere in the payload', () => {
    expect(() => assertNoContactDetails({ note: 'write to a.person@example.com' }, 'x')).toThrow(/email-shaped/);
  });

  it.each([
    ['0412 345 678', 'mobile with spaces'],
    ['0412345678', 'bare mobile'],
    ['+61 412 345 678', 'international mobile'],
    ['(02) 9999 8888'.replace(/[()\s]/g, ''), 'landline'],
    ['1300 123 456', 'service number'],
  ])('throws on %s (%s)', (phone) => {
    expect(() => assertNoContactDetails({ note: `call ${phone}` }, 'x')).toThrow(/phone-shaped/);
  });

  it('throws on a forbidden key even when its value looks harmless', () => {
    expect(() => assertNoContactDetails({ ceo: { name: 'redacted' } }, 'x')).toThrow(/forbidden key/);
  });

  it('accepts a clean payload', () => {
    expect(assertNoContactDetails({ code: '123', name: 'A College', scope: 42 }, 'x')).toBe(true);
  });

  it('accepts text that has already been redacted', () => {
    expect(() => assertNoContactDetails({ detail: 'report to [email removed] annually' }, 'x')).not.toThrow();
  });

  it('does not mistake a date or an ABN for a phone number', () => {
    expect(() => assertNoContactDetails({ start: '2025-06-30', abn: '86632705796' }, 'x')).not.toThrow();
  });
});

describe('redactContacts', () => {
  it('removes an agency mailbox from regulator prose but keeps the sentence', () => {
    const text = 'provide a report annually to integrity@asqa.gov.au detailing the following';
    const out = redactContacts(text);
    expect(out).not.toContain('@asqa.gov.au');
    expect(out).toContain('provide a report annually to');
    expect(out).toContain('detailing the following');
  });
  it('leaves clean prose untouched', () => {
    expect(redactContacts('Impose a condition under s 29(1) of the NVR Act')).toBe(
      'Impose a condition under s 29(1) of the NVR Act'
    );
  });
});

describe('slimQualification', () => {
  const raw = {
    code: 'CPC30220',
    title: 'Certificate III in Carpentry',
    qualificationLevel: { name: 'Certificate III', code: '514' },
    trainingPackage: { code: 'CPC', title: 'Construction, Plumbing and Services' },
    status: { id: 'current', name: 'Current', isCurrent: true },
    currencyPeriod: { startDate: '2020-11-26', endDate: '9999-12-31' },
    anzsco: { name: 'Carpenter', code: '331212' },
    asced4: { name: 'Building' },
    isConfidential: false,
    supersedes: [{ code: 'CPC30211', title: 'Certificate III in Carpentry', isEquivalent: true }],
    supersededBy: [],
    latestRelease: { date: '2024-12-24', number: '6' },
  };

  it('reads the fields the site displays', () => {
    const q = slimQualification(raw);
    expect(q.code).toBe('CPC30220');
    expect(q.level).toBe('Certificate III');
    expect(q.package).toBe('CPC');
    expect(q.isCurrent).toBe(true);
  });

  it('nulls the 9999 end-date sentinel so timelines do not run to the year 9999', () => {
    expect(slimQualification(raw).end).toBeNull();
  });

  it('preserves whether a lineage step was equivalent', () => {
    expect(slimQualification(raw).supersedes[0].equivalent).toBe(true);
  });

  it('carries the confidential flag through', () => {
    expect(slimQualification({ ...raw, isConfidential: true }).confidential).toBe(true);
  });

  it('rejects a record with no code rather than emitting a blank row', () => {
    expect(slimQualification({ title: 'orphaned' })).toBeNull();
    expect(slimQualification(null)).toBeNull();
  });
});

describe('slimDecision', () => {
  const raw = {
    reference: 'RD0005788',
    decision: "Impose condition(s) on the provider's registration",
    decisionDetails: '<p>report to integrity@asqa.gov.au</p>',
    decisionType: 'Condition(s)',
    decisionStatus: 'In effect',
    isHistoric: false,
    effectiveDate: '2025-06-30',
    endDate: '2027-07-01',
    decisionMadeUnderUrl: 'https://www.legislation.gov.au/Details/C2011A00012',
    decisionEvents: [{ eventDate: '2025-06-30', eventStatus: 'Imposed', decisionMaker: 'National VET Regulator' }],
  };

  it('converts the HTML detail to readable text AND redacts the mailbox', () => {
    const d = slimDecision(raw, '45151');
    expect(d.detail).toContain('report to');
    expect(d.detail).not.toContain('@asqa.gov.au');
  });

  it('keeps only an http(s) legislation link', () => {
    expect(slimDecision(raw, '1').madeUnderUrl).toMatch(/^https:\/\//);
    expect(slimDecision({ ...raw, decisionMadeUnderUrl: 'javascript:alert(1)' }, '1').madeUnderUrl).toBeNull();
  });

  it('preserves the decision events', () => {
    expect(slimDecision(raw, '1').events).toHaveLength(1);
    expect(slimDecision(raw, '1').events[0].status).toBe('Imposed');
  });

  it('passes the privacy gate', () => {
    expect(() => assertNoContactDetails(slimDecision(raw, '45151'), 'decision')).not.toThrow();
  });
});
