// SPDX-FileCopyrightText: 2026 Ben Richardson
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Pure, dependency-free transforms over the training.gov.au NTR Web API.
// Nothing in this file touches the network or the filesystem, so the whole of it
// is reachable from tests on a CI runner with no npm install.

// ---------------------------------------------------------------------------
// PRIVACY — the single most important thing in this repository.
//
// The organisation feed ships personal contact details of named individuals:
// ceo.{name,email,phone}, and the same again under publicEnquiries and
// registrationEnquiries. Many RTOs are one- or two-person businesses, so these
// are private mobile numbers and personal email addresses of real people.
//
// We therefore build every published record by ALLOWLIST — naming the fields we
// keep — and never by deleting the fields we don't want. A denylist is defeated
// the first time the upstream renames a field or adds a new contact block, and
// the failure is silent: the data ships, gets committed, and a public git
// history cannot be un-published by a later commit.
//
// `assertNoContactDetails` below is the second line of defence and runs in CI.
// ---------------------------------------------------------------------------

/** Dates the register uses to mean "no end date". */
const DATE_SENTINELS = new Set(['9999-12-31', '9999-12-30', '9999-01-01']);

/** Statuses that mean the provider is still ON the register in some form.
 *  `pending` is "Current (Re-registration pending)"; `suspended` is "Current (Suspended)". */
export const ON_REGISTER_STATUSES = Object.freeze(['current', 'pending', 'suspended']);
const ON_REGISTER_SET = new Set(ON_REGISTER_STATUSES);

/** Statuses that mean the provider can actually TEACH today.
 *
 *  `suspended` is deliberately NOT here, and that is a considered judgement rather than an
 *  oversight. A suspension is precisely the regulator stopping the provider from operating
 *  — every suspended RTO carries a restriction record saying so — and counting suspended
 *  scope as delivery capacity would overstate what a student can actually enrol in.
 *  `pending` IS here: those providers are lawfully operating while a re-registration
 *  application sits with the regulator.
 *
 *  This choice is measured, not assumed: `supplyVariants` below recomputes the headline
 *  under every plausible alternative so the site can publish how sensitive it is. */
export const TEACHING_STATUSES = Object.freeze(['current', 'pending']);
const TEACHING_SET = new Set(TEACHING_STATUSES);

/** Kept as an alias so older call sites keep meaning what they meant. */
export const LIVE_STATUSES = ON_REGISTER_STATUSES;

/** Statuses that mean the provider has left the register for this component. */
export const DEAD_STATUSES = Object.freeze(['withdrawn', 'cancelled', 'nonCurrent', 'expired']);

export const STATE_CODES = Object.freeze(['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT']);

/** Normalise a date-ish value, collapsing the register's far-future sentinels to null. */
export function cleanDate(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  const day = s.slice(0, 10);
  if (DATE_SENTINELS.has(day)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  // A year outside the register's plausible span is a sentinel we haven't seen before.
  const year = Number(day.slice(0, 4));
  if (year < 1900 || year > 2100) return null;
  return day;
}

/** The register stores state as an abbreviation on a nested object; normalise to a code or null. */
export function normaliseState(raw) {
  if (!raw) return null;
  const abbr = typeof raw === 'string' ? raw : (raw.abbreviation ?? raw.name ?? '');
  const up = String(abbr).trim().toUpperCase();
  if (!up) return null;
  if (STATE_CODES.includes(up)) return up;
  const long = {
    'NEW SOUTH WALES': 'NSW',
    VICTORIA: 'VIC',
    QUEENSLAND: 'QLD',
    'SOUTH AUSTRALIA': 'SA',
    'WESTERN AUSTRALIA': 'WA',
    TASMANIA: 'TAS',
    'NORTHERN TERRITORY': 'NT',
    'AUSTRALIAN CAPITAL TERRITORY': 'ACT',
  };
  return long[up] ?? null;
}

/** Per-state delivery rights, from the API's eight booleans, as a compact code array. */
export function deliveryStates(delivery) {
  if (!delivery || typeof delivery !== 'object') return [];
  const map = {
    nsw: 'NSW', vic: 'VIC', qld: 'QLD', sa: 'SA',
    wa: 'WA', tas: 'TAS', nt: 'NT', act: 'ACT',
  };
  const out = [];
  for (const [key, code] of Object.entries(map)) if (delivery[key] === true) out.push(code);
  return out;
}

/** Same, but for a delivery row, which spells the flags deliveryNsw / deliveryVic / … */
export function deliveryRowStates(row) {
  if (!row || typeof row !== 'object') return [];
  const out = [];
  for (const code of STATE_CODES) {
    const key = 'delivery' + code.charAt(0) + code.slice(1).toLowerCase();
    if (row[key] === true) out.push(code);
  }
  return out;
}

/** Decode the HTML the register puts in decisionDetails into readable plain text.
 *  The field carries <p>/<ul>/<li> markup, entity-encoded apostrophes and \n\t noise. */
export function htmlToText(html) {
  if (html == null) return '';
  let s = String(html);
  s = s.replace(/<\s*(br|\/p|\/li|\/div|\/h[1-6])\s*\/?\s*>/gi, '\n');
  s = s.replace(/<\s*li[^>]*>/gi, '• ');
  // Non-greedy, and anchored so an unclosed '<' in prose is not treated as a tag.
  s = s.replace(/<[^<>]*>/g, '');
  const entities = {
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
    '&#39;': "'", '&apos;': "'", '&nbsp;': ' ', '&ndash;': '–', '&mdash;': '—',
  };
  s = s.replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp|ndash|mdash);/g, (m) => entities[m] ?? m);
  s = s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
  s = s.replace(/[ \t]+/g, ' ');
  s = s.replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

/** Is this scope record live — i.e. current rather than a historical scope entry, held by
 *  a provider still on the register in some form?
 *
 *  BOTH conditions are load-bearing and neither implies the other:
 *   - isHistory marks a superseded scope record. The upstream leaves status == 'current'
 *     on those rows, so filtering on status alone keeps thousands of departed providers.
 *   - status filters withdrawn / cancelled / nonCurrent providers out of the live rows. */
export function isLiveDelivery(row) {
  if (!row || typeof row !== 'object') return false;
  if (row.isHistory === true) return false;
  return ON_REGISTER_SET.has(row.status);
}

/** Can a student actually enrol with this provider for this qualification today?
 *  Live scope + a provider that is not suspended + scope that permits teaching, not
 *  merely assessing. This is the rule behind every provider count the site publishes. */
export function canTeachToday(row) {
  if (!isLiveDelivery(row)) return false;
  if (!TEACHING_SET.has(row.status)) return false;
  return canDeliver(row);
}

/** Can this RTO actually TEACH the qualification, or only assess it?
 *  'Assess only' scope cannot deliver training — counting it as supply overstates the
 *  market, and it matters most on exactly the thin qualifications the site is about. */
export function canDeliver(row) {
  const extent = String(row?.extentLabel ?? '').toLowerCase();
  return extent.includes('deliver');
}

// ---------------------------------------------------------------------------
// Allowlisted record builders
// ---------------------------------------------------------------------------

/** Build the published organisation record. ALLOWLIST — see the note at the top. */
export function slimOrganisation(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const addr = raw.headOfficeAddress ?? {};
  const coords = addr.location?.coordinates ?? {};
  const reg = raw.registration ?? {};
  const lat = Number(coords.latitude);
  const lon = Number(coords.longitude);
  const hasCoords =
    Number.isFinite(lat) && Number.isFinite(lon) &&
    lat >= -60 && lat <= 0 && lon >= 90 && lon <= 180;

  return {
    code: String(raw.code ?? ''),
    name: String(raw.legalName ?? '').trim(),
    tradingNames: Array.isArray(raw.tradingNames)
      ? raw.tradingNames.map((t) => String(t?.name ?? t ?? '').trim()).filter(Boolean).slice(0, 8)
      : [],
    abn: Array.isArray(raw.abns) && raw.abns.length ? String(raw.abns[0]) : null,
    isRto: raw.isRto === true,
    isCurrent: raw.isCurrent === true,
    status: String(reg.status ?? '') || null,
    statusLabel: String(reg.statusLabel ?? '') || null,
    regStart: cleanDate(reg.startDate),
    regEnd: cleanDate(reg.endDate),
    regInitial: cleanDate(reg.initialRegistrationDate),
    legalAuthority: String(reg.legalAuthority ?? '') || null,
    regulator: raw.registrationManager?.shortName ?? raw.registrationManager?.name ?? null,
    rtoType: raw.rtoType?.name ?? null,
    // Address, but only the parts that describe a place of business — never a person.
    suburb: String(addr.suburb ?? '').trim() || null,
    state: normaliseState(addr.state),
    postcode: String(addr.postCode ?? '').trim() || null,
    country: addr.country?.name ?? null,
    lat: hasCoords ? Number(lat.toFixed(5)) : null,
    lon: hasCoords ? Number(lon.toFixed(5)) : null,
    deliversIn: deliveryStates(raw.delivery),
    deliversInternational: raw.delivery?.international === true,
    flagged: raw.hasCurrentRestrictionOrRegulatoryDecision === true,
    website: firstWebAddress(raw.webAddresses),
  };
}

/** A provider's own website is business contact info, not personal — but only take a URL,
 *  and only an http(s) one, so a `mailto:` can never leak an address through this field. */
function firstWebAddress(list) {
  if (!Array.isArray(list)) return null;
  for (const entry of list) {
    const url = String(entry?.address ?? entry?.url ?? entry ?? '').trim();
    if (/^https?:\/\/[^\s@]+$/i.test(url)) return url.slice(0, 200);
  }
  return null;
}

/** Build the published qualification record. ALLOWLIST. */
export function slimQualification(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const code = String(raw.code ?? '').trim();
  if (!code) return null;
  return {
    code,
    title: String(raw.title ?? '').trim(),
    level: raw.qualificationLevel?.name ?? null,
    levelCode: raw.qualificationLevel?.code ?? null,
    package: raw.trainingPackage?.code ?? null,
    packageTitle: raw.trainingPackage?.title ?? null,
    status: raw.status?.id ?? null,
    statusLabel: raw.status?.name ?? null,
    isCurrent: raw.status?.isCurrent === true,
    // Fourteen current qualifications (all POL, police) are flagged confidential. Their
    // provider data may be deliberately withheld, so a zero there can mean "not published"
    // rather than "nobody" — it must never be presented as a thin market.
    confidential: raw.isConfidential === true,
    start: cleanDate(raw.currencyPeriod?.startDate),
    end: cleanDate(raw.currencyPeriod?.endDate),
    anzsco: raw.anzsco?.name ?? null,
    anzscoCode: raw.anzsco?.code ?? null,
    field: raw.asced4?.name ?? null,
    industry: Array.isArray(raw.taxonomyIndustry)
      ? [...new Set(raw.taxonomyIndustry.map((t) => t?.industrySector).filter(Boolean))].slice(0, 4)
      : [],
    occupations: Array.isArray(raw.taxonomyOccupation)
      ? [...new Set(raw.taxonomyOccupation.map((t) => t?.occupation).filter(Boolean))].slice(0, 6)
      : [],
    supersedes: mapLineage(raw.supersedes),
    supersededBy: mapLineage(raw.supersededBy),
    releaseDate: cleanDate(raw.latestRelease?.date),
    releaseNumber: raw.latestRelease?.number ?? null,
  };
}

function mapLineage(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((l) => ({
      code: String(l?.code ?? '').trim(),
      title: String(l?.title ?? '').trim(),
      equivalent: l?.isEquivalent === true,
    }))
    .filter((l) => l.code);
}

/** Build the published delivery edge. ALLOWLIST. */
export function slimDelivery(row) {
  if (!row || typeof row !== 'object') return null;
  const code = String(row.code ?? '').trim();
  if (!code) return null;
  return {
    rto: code,
    status: String(row.status ?? '') || null,
    live: isLiveDelivery(row),
    deliver: canDeliver(row),
    teaches: canTeachToday(row),
    states: deliveryRowStates(row),
    start: cleanDate(row.scopeStartDate),
    end: cleanDate(row.scopeEndDate),
  };
}

/** Build the published regulatory decision. ALLOWLIST.
 *  `decisionDetails` is public regulatory reasoning and is kept verbatim (as text) —
 *  but it is written by ASQA and occasionally contains an agency mailbox, so it goes
 *  through the same redaction as everything else before it ships. */
export function slimDecision(raw, rtoCode) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    rto: String(rtoCode),
    reference: String(raw.reference ?? '') || null,
    decision: String(raw.decision ?? '').trim() || null,
    detail: redactContacts(htmlToText(raw.decisionDetails)),
    type: String(raw.decisionType ?? '') || null,
    status: String(raw.decisionStatus ?? '') || null,
    level: String(raw.decisionLevel ?? '') || null,
    madeUnder: String(raw.decisionMadeUnder ?? '').trim() || null,
    madeUnderUrl: /^https?:\/\//i.test(String(raw.decisionMadeUnderUrl ?? ''))
      ? String(raw.decisionMadeUnderUrl)
      : null,
    maker: String(raw.decisionMaker ?? '') || null,
    historic: raw.isHistoric === true,
    effective: cleanDate(raw.effectiveDate),
    start: cleanDate(raw.startDate),
    end: cleanDate(raw.endDate),
    reviewStatus: String(raw.reviewStatus ?? '') || null,
    events: Array.isArray(raw.decisionEvents)
      ? raw.decisionEvents.map((e) => ({
          date: cleanDate(e?.eventDate),
          status: String(e?.eventStatus ?? '') || null,
          maker: String(e?.decisionMaker ?? '') || null,
          detail: String(e?.eventDetails ?? '') || null,
        }))
      : [],
  };
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Australian phone shapes: 04xx xxx xxx, (02) xxxx xxxx, +61 ..., 1300/1800 ...
const PHONE_RE =
  /(?:\+61[\s-]?|\b0)(?:[23478](?:[\s-]?\d){8}|4(?:[\s-]?\d){8})\b|\b1[38]00[\s-]?\d{3}[\s-]?\d{3}\b/g;

/** Replace anything email- or phone-shaped in free prose with a marker.
 *  Applied to regulator-authored text, which we keep verbatim in every other respect. */
export function redactContacts(text) {
  if (!text) return '';
  return String(text)
    .replace(EMAIL_RE, '[email removed]')
    .replace(PHONE_RE, '[phone removed]');
}

/** CI gate: throw if any published payload still carries contact details.
 *  This is the second line of defence behind the allowlist, and it is deliberately
 *  blunt — a false positive costs a minute; a false negative is permanent. */
export function assertNoContactDetails(payload, label = 'payload') {
  const json = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const problems = [];

  const emails = json.match(EMAIL_RE) ?? [];
  for (const hit of emails) if (!hit.startsWith('[email')) problems.push(`email-shaped string: ${hit}`);

  const phones = json.match(PHONE_RE) ?? [];
  for (const hit of phones) problems.push(`phone-shaped string: ${hit}`);

  for (const key of ['"ceo"', '"publicEnquiries"', '"registrationEnquiries"', '"jobTitle"']) {
    if (json.includes(key)) problems.push(`forbidden key present: ${key}`);
  }

  if (problems.length) {
    throw new Error(
      `${label}: personal contact details reached the published payload — ` +
        `${problems.length} problem(s). First 5: ${problems.slice(0, 5).join('; ')}`
    );
  }
  return true;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

/** Count providers per qualification under an arbitrary predicate over raw scope rows. */
export function countBy(rowsByQual, predicate) {
  const out = new Map();
  for (const [qual, rows] of Object.entries(rowsByQual)) {
    const seen = new Set();
    for (const row of rows) if (predicate(row)) seen.add(String(row.code));
    out.set(qual, seen.size);
  }
  return out;
}

const zeros = (counts) => [...counts.values()].filter((n) => n === 0).length;

/** Recompute the headline under every plausible alternative rule.
 *
 *  The site's central claim — "N current qualifications have no provider who can teach
 *  them" — depends on four judgement calls: whether assess-only scope counts, whether a
 *  suspended provider counts, whether a re-registering provider counts, and whether
 *  brand-new qualifications that nobody has applied to deliver yet should count at all.
 *  Rather than pick one and hope, we compute all of them and publish the spread. A finding
 *  that survives every reasonable definition is worth stating; one that only holds under
 *  ours is not, and the reader is entitled to see which this is. */
export function supplyVariants(rowsByQual, { releasedWithinYear = new Set() } = {}) {
  const headline = countBy(rowsByQual, canTeachToday);

  const variants = {
    headline: {
      label: 'No provider able to teach it',
      note: 'Live scope, provider on the register and not suspended, scope permits delivery (not assess-only).',
      orphans: zeros(headline),
    },
    includeAssessOnly: {
      label: 'No provider at all, counting assess-only',
      note: 'Also counts providers who may only assess. This is what training.gov.au’s own provider search shows.',
      orphans: zeros(countBy(rowsByQual, (r) => isLiveDelivery(r) && TEACHING_SET.has(r.status))),
    },
    includeSuspended: {
      label: 'Counting suspended providers as able to teach',
      note: 'Treats a provider the regulator has suspended as still delivering.',
      orphans: zeros(countBy(rowsByQual, (r) => isLiveDelivery(r) && canDeliver(r))),
    },
    strictCurrentOnly: {
      label: 'Only fully current providers',
      note: 'Excludes providers mid re-registration as well as suspended ones.',
      orphans: zeros(countBy(rowsByQual, (r) => isLiveDelivery(r) && r.status === 'current' && canDeliver(r))),
    },
    excludingNewQualifications: {
      label: 'Excluding qualifications released in the last 12 months',
      note: 'A brand-new qualification with no provider yet reflects application lag, not a thin market.',
      orphans: [...headline].filter(([code, n]) => n === 0 && !releasedWithinYear.has(code)).length,
    },
  };

  return { counts: headline, variants };
}

/** Split the zero-provider qualifications into two genuinely different stories:
 *  those that NEVER had a provider, and those that once had one and lost it. */
export function orphanHistory(rowsByQual, counts) {
  const never = [];
  const lost = [];
  for (const [code, n] of counts) {
    if (n !== 0) continue;
    const rows = rowsByQual[code] ?? [];
    (rows.length === 0 ? never : lost).push(code);
  }
  return { never, lost };
}

/** Per-state provider counts for one qualification, over rows that can teach today.
 *  This is the number that actually matters to a person: "no provider anywhere in
 *  Australia" is a national curiosity, "no provider in my state" is what stops them
 *  enrolling. */
export function stateCoverage(edges) {
  const counts = Object.fromEntries(STATE_CODES.map((s) => [s, 0]));
  for (const e of edges) {
    if (!e.teaches) continue;
    for (const s of e.states) if (s in counts) counts[s] += 1;
  }
  return counts;
}

/** Bucket a provider count into the supply tier the site is built around. */
export function supplyTier(n) {
  if (n === 0) return 'none';
  if (n === 1) return 'single';
  if (n <= 5) return 'thin';
  if (n <= 50) return 'moderate';
  return 'crowded';
}

/** Log-ish histogram of providers per qualification. Bin 0 is its own bucket because
 *  "no provider at all" is a categorically different thing from "one provider". */
export function providerHistogram(counts) {
  const bins = [
    { label: '0', min: 0, max: 0 },
    { label: '1', min: 1, max: 1 },
    { label: '2–5', min: 2, max: 5 },
    { label: '6–10', min: 6, max: 10 },
    { label: '11–25', min: 11, max: 25 },
    { label: '26–50', min: 26, max: 50 },
    { label: '51–100', min: 51, max: 100 },
    { label: '101–250', min: 101, max: 250 },
    { label: '251+', min: 251, max: Infinity },
  ].map((b) => ({ ...b, count: 0 }));
  for (const n of counts) {
    const bin = bins.find((b) => n >= b.min && n <= b.max);
    if (bin) bin.count += 1;
  }
  return bins.map(({ label, count }) => ({ label, count }));
}

export function median(values) {
  const xs = values.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
  if (!xs.length) return 0;
  const mid = xs.length >> 1;
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}
