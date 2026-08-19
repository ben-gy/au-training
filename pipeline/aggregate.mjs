// SPDX-FileCopyrightText: 2026 Ben Richardson
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Turn pipeline/cache/ into the JSON the site ships. Every published number passes a
// fatal gate before it is written; see gates.mjs for what each one defends against.

import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ON_REGISTER_STATUSES,
  STATE_CODES,
  cleanDate,
  median,
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
} from './parse.mjs';
import {
  gateCountsWithinFleet,
  gateDecisionsWellFormed,
  gateDeliveryNotTruncated,
  gateEdgesResolve,
  gateHeadlineSameUniverse,
  gateLiveFilterDiscriminates,
  gateNoBadNumbers,
  gateNoPersonalData,
  gateRegulatoryInForce,
  gatePendingCountsAsLive,
  gateStateWithinNational,
  runGates,
} from './gates.mjs';
import { ATTRIBUTION } from './sources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, 'cache');
const OUT = join(HERE, '..', 'public', 'data');
const GEO_SOURCE = join(HERE, '..', '..', '..', 'patterns', 'geo', 'au-states.geojson');

const log = (...a) => process.stdout.write(a.join(' ') + '\n');
const readCache = async (name) => JSON.parse(await readFile(join(CACHE, name), 'utf8'));

async function writeJson(name, value) {
  await mkdir(OUT, { recursive: true });
  const json = JSON.stringify(value);
  await writeFile(join(OUT, name), json, 'utf8');
  log(`  wrote ${name} — ${(Buffer.byteLength(json) / 1024).toFixed(0)} KB`);
  return json;
}

async function main() {
  log('aggregating National Training Register');

  const rawOrgs = await readCache('organisations.json');
  const rawQuals = await readCache('qualifications.json');
  const rawDelivery = await readCache('delivery.json');
  const rawRegulatory = await readCache('regulatory.json');
  const meta = await readCache('meta.json');

  // -- organisations ---------------------------------------------------------
  const orgs = rawOrgs.map(slimOrganisation).filter((o) => o && o.code);
  const orgByCode = new Map(orgs.map((o) => [o.code, o]));

  // The provider population is every RTO still ON the register — current, mid
  // re-registration, or suspended. Using "current only" here would be internally
  // inconsistent with the scope rules, which admit pending and suspended providers: 81
  // RTOs appear as live providers in the delivery graph while sitting outside a
  // current-only headline, so the site would advertise a smaller population than its own
  // charts draw from. Whether a provider can TEACH is a separate question, answered
  // per-edge by canTeachToday.
  const registeredRtos = orgs.filter((o) => o.isRto && ON_REGISTER_STATUSES.includes(o.status ?? ''));
  const fullyCurrentRtos = registeredRtos.filter((o) => o.status === 'current');
  log(
    `  ${orgs.length.toLocaleString()} organisations, ` +
      `${registeredRtos.length.toLocaleString()} RTOs on the register ` +
      `(${fullyCurrentRtos.length.toLocaleString()} fully current)`
  );

  // -- qualifications --------------------------------------------------------
  const quals = rawQuals.map(slimQualification).filter(Boolean);
  const currentQuals = quals.filter((q) => q.isCurrent);
  const qualByCode = new Map(quals.map((q) => [q.code, q]));
  log(`  ${quals.length.toLocaleString()} qualifications, ${currentQuals.length.toLocaleString()} current`);

  // -- delivery edges --------------------------------------------------------
  const allRawRows = [];
  const edgesByQual = new Map();
  for (const [code, rows] of Object.entries(rawDelivery)) {
    allRawRows.push(...rows);
    edgesByQual.set(code, rows.map(slimDelivery).filter(Boolean));
  }

  // Qualifications released in the last twelve months: a brand-new qualification with no
  // provider yet is scope-application lag, not a thin market, and must not be counted as
  // a market failure without saying so.
  const HARVEST_DAY = String(meta.harvestedAt).slice(0, 10);
  const yearAgo = new Date(`${HARVEST_DAY}T00:00:00Z`);
  yearAgo.setUTCFullYear(yearAgo.getUTCFullYear() - 1);
  const yearAgoIso = yearAgo.toISOString().slice(0, 10);
  const releasedWithinYear = new Set(
    currentQuals.filter((q) => (q.releaseDate ?? q.start ?? '') >= yearAgoIso).map((q) => q.code)
  );

  const { counts: providerCount, variants } = supplyVariants(rawDelivery, { releasedWithinYear });
  const { never: neverHadProvider, lost: lostAllProviders } = orphanHistory(rawDelivery, providerCount);

  // Providers who may only ASSESS this qualification, never teach it — reported
  // separately rather than folded into the provider count.
  const assessOnlyCount = new Map();
  const coverageByQual = {};
  for (const [code, edges] of edgesByQual) {
    const teaching = new Set(edges.filter((e) => e.teaches).map((e) => e.rto));
    const assessing = new Set();
    for (const e of edges) if (e.live && !e.deliver && !teaching.has(e.rto)) assessing.add(e.rto);
    assessOnlyCount.set(code, assessing.size);
    coverageByQual[code] = stateCoverage(edges);
  }

  const orphanCodes = [...providerCount].filter(([, n]) => n === 0).map(([c]) => c);
  const singleCodes = [...providerCount].filter(([, n]) => n === 1).map(([c]) => c);
  const liveEdges = [...edgesByQual.values()].flat().filter((e) => e.live);
  const teachingEdges = [...edgesByQual.values()].flat().filter((e) => e.teaches);
  const assessOnlyEdges = liveEdges.filter((e) => !e.deliver).length;

  // -- regulatory ------------------------------------------------------------
  const decisions = [];
  const restrictions = [];
  for (const [code, record] of Object.entries(rawRegulatory)) {
    for (const d of record.decisions ?? []) {
      const slim = slimDecision(d, code);
      if (slim) decisions.push(slim);
    }
    for (const r of record.restrictions ?? []) {
      restrictions.push({
        rto: code,
        type: String(r?.restrictionType ?? '') || null,
        // Regulator-authored text, kept verbatim except that any contact address in it is
        // removed. These are usually ASQA reporting mailboxes rather than personal
        // addresses, but the rule is applied without exception: nothing contact-shaped
        // ships, and readers do not need the mailbox to understand the condition.
        text: redactContacts(String(r?.restriction ?? '').trim()),
        start: cleanDate(r?.startDate),
        end: cleanDate(r?.endDate),
      });
    }
  }
  // IS THIS DECISION ACTUALLY IN FORCE?
  //
  // `isHistoric` alone is NOT the answer, and getting this wrong makes an adverse,
  // publishable claim about a named business. The flag is stale: dozens of decisions carry
  // isHistoric:false and decisionStatus "In effect" with an endDate that has already
  // passed — Gordon Institute of TAFE and Box Hill Institute both hold conditions that
  // expired in 2023 and are still marked non-historic. Trusting the flag would brand those
  // providers as currently sanctioned years after the condition lapsed, and the register's
  // own hasCurrentRestrictionOrRegulatoryDecision flag says otherwise.
  //
  // The rule is therefore: not historic AND not expired. Two independent routes (that
  // rule, and the register's own flag) agree on the resulting provider count, which is
  // why it is safe to publish.
  const isInForce = (d) => !d.historic && (d.end == null || d.end >= HARVEST_DAY);
  const currentDecisions = decisions.filter(isInForce);
  const staleNonHistoric = decisions.filter((d) => !d.historic && !isInForce(d)).length;
  log(
    `  ${decisions.length} regulatory decisions — ${currentDecisions.length} in force, ` +
      `${staleNonHistoric} marked non-historic but already expired; ${restrictions.length} restrictions`
  );

  // -- gates -----------------------------------------------------------------
  log('gates');
  runGates([
    ['delivery pagination terminated', () => gateDeliveryNotTruncated(rawDelivery)],
    ['live filter discriminates', () => gateLiveFilterDiscriminates(allRawRows)],
    ['pending/suspended count as live', () => gatePendingCountsAsLive(rawDelivery, providerCount)],
    [
      'headline over one universe',
      () =>
        gateHeadlineSameUniverse({
          currentCodes: currentQuals.map((q) => q.code),
          harvestedCodes: Object.keys(rawDelivery),
          orphanCodes,
        }),
    ],
    ['counts within fleet', () => gateCountsWithinFleet(providerCount, new Set(orgByCode.keys()))],
    ['edges resolve to providers', () => gateEdgesResolve(liveEdges, new Set(orgByCode.keys()))],
    ['state coverage ≤ national', () => gateStateWithinNational(coverageByQual, providerCount)],
    ['decisions well formed', () => gateDecisionsWellFormed(decisions, new Set(orgByCode.keys()))],
  ]);

  // -- derived views ---------------------------------------------------------
  const packages = new Map();
  for (const q of currentQuals) {
    if (!q.package) continue;
    if (!packages.has(q.package)) {
      packages.set(q.package, { code: q.package, title: q.packageTitle, quals: [], levels: {} });
    }
    packages.get(q.package).quals.push(q.code);
  }

  const supply = currentQuals
    .map((q) => ({
      code: q.code,
      title: q.title,
      level: q.level,
      package: q.package,
      packageTitle: q.packageTitle,
      field: q.field,
      anzsco: q.anzsco,
      industry: q.industry,
      providers: providerCount.get(q.code) ?? 0,
      assessOnly: assessOnlyCount.get(q.code) ?? 0,
      tier: supplyTier(providerCount.get(q.code) ?? 0),
      states: coverageByQual[q.code] ?? {},
      start: q.start,
      releaseDate: q.releaseDate,
      confidential: q.confidential,
      isNew: releasedWithinYear.has(q.code),
      everSupplied: (rawDelivery[q.code] ?? []).length > 0,
      supersedes: q.supersedes,
      supersededBy: q.supersededBy,
    }))
    .sort((a, b) => a.providers - b.providers || a.code.localeCompare(b.code));

  // Package × AQF-level matrix, shaded by median providers per qualification.
  const levels = [...new Set(currentQuals.map((q) => q.level).filter(Boolean))].sort(
    (a, b) =>
      (currentQuals.find((q) => q.level === a)?.levelCode ?? '').localeCompare(
        currentQuals.find((q) => q.level === b)?.levelCode ?? ''
      )
  );
  const matrix = [...packages.values()]
    .map((p) => {
      const cells = {};
      for (const level of levels) {
        const inCell = currentQuals.filter((q) => q.package === p.code && q.level === level);
        if (!inCell.length) continue;
        const counts = inCell.map((q) => providerCount.get(q.code) ?? 0);
        cells[level] = {
          n: inCell.length,
          median: median(counts),
          orphans: counts.filter((c) => c === 0).length,
        };
      }
      return { code: p.code, title: p.title, quals: p.quals.length, cells };
    })
    .filter((p) => Object.keys(p.cells).length)
    .sort((a, b) => b.quals - a.quals);

  // Provider records, with the scope size each holds.
  const scopeSize = new Map();
  for (const edges of edgesByQual.values()) {
    for (const e of edges) {
      if (!e.teaches) continue;
      scopeSize.set(e.rto, (scopeSize.get(e.rto) ?? 0) + 1);
    }
  }
  const decisionsByRto = new Map();
  for (const d of decisions) {
    if (!decisionsByRto.has(d.rto)) decisionsByRto.set(d.rto, []);
    decisionsByRto.get(d.rto).push(d);
  }

  const providers = registeredRtos
    .map((o) => ({
      ...o,
      scope: scopeSize.get(o.code) ?? 0,
      decisions: (decisionsByRto.get(o.code) ?? []).length,
      currentDecisions: (decisionsByRto.get(o.code) ?? []).filter(isInForce).length,
    }))
    .sort((a, b) => b.scope - a.scope);

  // The qualification → provider edge list. Built from the SAME predicate as every
  // provider count, so the graph total and the per-qualification numbers add up.
  const network = [];
  for (const [code, edges] of edgesByQual) {
    for (const e of edges) {
      if (!e.teaches) continue;
      network.push([code, e.rto]);
    }
  }

  const byState = Object.fromEntries(
    STATE_CODES.map((s) => [
      s,
      {
        providers: registeredRtos.filter((o) => o.state === s).length,
        deliverHere: registeredRtos.filter((o) => o.deliversIn.includes(s)).length,
        qualsAvailable: Object.values(coverageByQual).filter((c) => (c[s] ?? 0) > 0).length,
        qualsUnavailable: Object.values(coverageByQual).filter((c) => (c[s] ?? 0) === 0).length,
      },
    ])
  );

  const counts = [...providerCount.values()];
  const summary = {
    harvestedAt: meta.harvestedAt,
    organisations: orgs.length,
    registeredRtos: registeredRtos.length,
    fullyCurrentRtos: fullyCurrentRtos.length,
    geocodedRtos: registeredRtos.filter((o) => o.lat != null).length,
    rtosWithNoScope: providers.filter((p) => p.scope === 0).length,
    qualifications: quals.length,
    currentQualifications: currentQuals.length,
    trainingPackages: packages.size,

    // Edge totals, computed over the SAME predicate as every provider count so the
    // figures on different views add up. Assess-only scope is reported separately rather
    // than folded in, because it cannot teach anyone.
    teachingEdges: teachingEdges.length,
    liveScopeEntries: liveEdges.length,
    assessOnlyEdges,

    orphans: orphanCodes.length,
    single: singleCodes.length,
    // Two different populations that are easy to conflate, so both are named explicitly:
    // "one to five" EXCLUDES the zeros, "five or fewer" INCLUDES them.
    oneToFive: counts.filter((n) => n >= 1 && n <= 5).length,
    fiveOrFewer: counts.filter((n) => n <= 5).length,
    orphansNeverSupplied: neverHadProvider.length,
    orphansLostSupply: lostAllProviders.length,
    orphansRecentlyReleased: orphanCodes.filter((c) => releasedWithinYear.has(c)).length,
    orphansConfidential: orphanCodes.filter((c) => qualByCode.get(c)?.confidential).length,
    supplyVariants: variants,

    medianProviders: median(counts),
    maxProviders: Math.max(0, ...counts),
    maxProvidersCode: supply[supply.length - 1]?.code ?? null,
    maxProvidersTitle: supply[supply.length - 1]?.title ?? null,

    flaggedProviders: providers.filter((p) => p.currentDecisions > 0).length,
    flaggedFullyCurrent: providers.filter((p) => p.status === 'current' && p.currentDecisions > 0).length,
    decisions: decisions.length,
    currentDecisionCount: currentDecisions.length,
    staleNonHistoricDecisions: staleNonHistoric,
    restrictions: restrictions.length,
    decisionStatuses: tally(currentDecisions.map((d) => d.status)),

    histogram: providerHistogram(counts),
    byState,
    regulators: tally(registeredRtos.map((o) => o.regulator)),
    rtoTypes: tally(registeredRtos.map((o) => o.rtoType)),
    decisionTypes: tally(decisions.map((d) => d.type)),
    attribution: ATTRIBUTION,
  };

  // -- final safety gates ----------------------------------------------------
  const payloads = { summary, supply, providers, decisions, restrictions, matrix };
  runGates([
    ['regulatory in-force rule agrees with the register', () => gateRegulatoryInForce(providers)],
    ['no personal data', () => gateNoPersonalData(payloads)],
    ['no bad numbers (summary)', () => gateNoBadNumbers(summary, 'summary')],
    ['no bad numbers (supply)', () => gateNoBadNumbers(supply, 'supply')],
    ['no bad numbers (providers)', () => gateNoBadNumbers(providers, 'providers')],
  ]);

  // -- write -----------------------------------------------------------------
  log('writing');
  await writeJson('summary.json', summary);
  await writeJson('supply.json', supply);
  await writeJson('providers.json', providers);
  await writeJson('regulatory.json', { decisions, restrictions });
  await writeJson('matrix.json', { levels, packages: matrix });
  await writeJson('network.json', { edges: network });
  await writeJson('lineage.json', {
    quals: quals.map((q) => ({
      code: q.code,
      title: q.title,
      level: q.level,
      package: q.package,
      status: q.status,
      isCurrent: q.isCurrent,
      start: q.start,
      end: q.end,
      supersedes: q.supersedes,
      supersededBy: q.supersededBy,
    })),
  });

  if (existsSync(GEO_SOURCE)) {
    await copyFile(GEO_SOURCE, join(OUT, 'au-states.geojson'));
    log('  copied au-states.geojson (ABS ASGS, CC BY 4.0)');
  } else {
    throw new Error(`boundary file missing at ${GEO_SOURCE} — the map cannot ship without real geometry`);
  }

  log('\nheadline figures');
  log(`  ${summary.orphans} of ${summary.currentQualifications} current qualifications have NO provider able to teach them`);
  log(`    of those: ${summary.orphansNeverSupplied} never had one, ${summary.orphansLostSupply} lost theirs, ` +
      `${summary.orphansRecentlyReleased} released in the last year, ${summary.orphansConfidential} confidential`);
  log(`  ${summary.single} have exactly one provider; ${summary.oneToFive} have one to five; ${summary.fiveOrFewer} have five or fewer`);
  log(`  median providers per qualification: ${summary.medianProviders}`);
  log(`  most-supplied: ${summary.maxProvidersCode} ${summary.maxProvidersTitle} — ${summary.maxProviders} providers`);
  log(`  ${summary.teachingEdges.toLocaleString()} teaching edges (+${summary.assessOnlyEdges} assess-only)`);
  log(`  ${summary.flaggedProviders} providers under a regulatory decision in force`);
  log('\n  sensitivity of the orphan count to the rule used:');
  for (const [key, v] of Object.entries(summary.supplyVariants)) {
    log(`    ${String(v.orphans).padStart(4)}  ${v.label}  [${key}]`);
  }
  log('\n  qualifications with no provider IN A GIVEN STATE:');
  for (const [state, s] of Object.entries(summary.byState)) {
    log(`    ${state.padEnd(4)} ${String(s.qualsUnavailable).padStart(4)} unavailable of ${summary.currentQualifications}`);
  }
}

function tally(values) {
  const out = {};
  for (const v of values) {
    const key = v ?? 'Unknown';
    out[key] = (out[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
}

main().catch((error) => {
  process.stderr.write(`aggregate failed: ${error?.stack ?? error}\n`);
  process.exit(1);
});
