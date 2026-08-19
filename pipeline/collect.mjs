// SPDX-FileCopyrightText: 2026 Ben Richardson
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Harvest the National Training Register into pipeline/cache/ as raw JSON.
// aggregate.mjs turns that cache into the files the site actually ships.
//
// Uses Node's fetch (undici) deliberately. training.gov.au's TLS makes macOS
// curl (LibreSSL) hang mid-handshake and time out; undici/OpenSSL is unaffected.
// Do not "simplify" this to a shelled-out curl.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COMPONENT_TYPE,
  organisationDecisions,
  organisationRestrictions,
  organisationSearch,
  qualificationDelivery,
  trainingSearch,
} from './sources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, 'cache');

const PAGE = 500;
const DELIVERY_PAGE = 1000;
const CONCURRENCY = 8;

const log = (...a) => process.stdout.write(a.join(' ') + '\n');

async function getJson(url, { attempts = 5 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(120_000),
      });
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`HTTP ${res.status}`);
      }
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status} for ${url}`);
        err.status = res.status;
        throw err;
      }
      const text = await res.text();
      const declared = Number(res.headers.get('content-length'));
      // A truncated body is the failure mode that reads as a JSON syntax error three
      // frames away from its cause. Catch it where it happens.
      if (Number.isFinite(declared) && declared > 0 && Buffer.byteLength(text) !== declared) {
        throw new Error(
          `truncated response for ${url}: got ${Buffer.byteLength(text)} B, content-length said ${declared} B`
        );
      }
      return JSON.parse(text);
    } catch (error) {
      lastError = error;
      if (error.status === 404) throw error;
      if (attempt === attempts) break;
      await new Promise((r) => setTimeout(r, 400 * 2 ** (attempt - 1)));
    }
  }
  throw new Error(`giving up on ${url}: ${lastError?.message ?? lastError}`);
}

/** Run `worker` over `items` with a fixed concurrency, preserving input order. */
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

/** Page one full sweep of a /api/search/* endpoint at a given page size, keyed by `keyOf`. */
async function sweep(urlFor, pageSize, keyOf) {
  const first = await getJson(urlFor(0, pageSize));
  const total = Number(first.totalCount ?? first.count ?? 0);
  const seen = new Map();
  for (const row of first.data ?? []) seen.set(keyOf(row), row);

  const offsets = [];
  for (let offset = pageSize; offset < total; offset += pageSize) offsets.push(offset);
  const pages = await mapLimit(offsets, CONCURRENCY, (offset) => getJson(urlFor(offset, pageSize)));
  for (const page of pages) for (const row of page.data ?? []) seen.set(keyOf(row), row);

  return { total, seen };
}

/** Harvest a /api/search/* endpoint COMPLETELY.
 *
 *  THE TRAP THIS FUNCTION EXISTS FOR. Offset paging over /api/search/* is lossy under the
 *  endpoint's DEFAULT (relevance) ordering: the order is stable for a given offset but not
 *  across offsets, so a sweep both duplicates some records and SILENTLY SKIPS others.
 *  Measured on the organisation index, an unordered sweep returns 12,100–12,550 distinct
 *  records out of 13,146 depending on page size, and ~2,400 records appear in one sweep but
 *  not another. A naive `rows.length === totalCount` check PASSES throughout, because the
 *  row COUNT is right and only the identities are wrong — nearly a thousand providers,
 *  including the University of Tasmania, went missing from a harvest that looked complete.
 *
 *  The fix is `orderBy` (see sources.mjs): a total order makes offset paging deterministic
 *  and exhaustive in one sweep. We then reconcile against the endpoint's own totalCount,
 *  which is a real independent check rather than a convergence heuristic.
 *
 *  A second, differently-sized ordered sweep runs as a verification pass. It should add
 *  exactly nothing; if it adds anything, ordering is not doing its job and we refuse to
 *  ship rather than quietly falling back to a union.
 *
 *  (The bulk CSV export at POST /api/organisation/csv is NOT the answer either: it is
 *  deterministic but INCOMPLETE — 12,593 distinct codes — and it ships fourteen columns of
 *  personal contact details that this pipeline deliberately never reads.) */
async function harvestSearch(label, urlFor, keyOf = (r) => String(r.code)) {
  const { total, seen } = await sweep(urlFor, PAGE, keyOf);
  log(`  ${label}: ordered sweep → ${seen.size.toLocaleString()} distinct of ${total.toLocaleString()}`);

  if (!Number.isFinite(total) || total <= 0) {
    throw new Error(
      `${label}: no usable totalCount. includeTotalCount=true must be on the request, or every ` +
        `completeness check silently compares against undefined.`
    );
  }
  if (seen.size !== total) {
    throw new Error(
      `${label}: ordered sweep returned ${seen.size} distinct records but the API reports ${total}. ` +
        `Deterministic paging has failed — do not ship a partial register.`
    );
  }

  // Verification sweep at a deliberately awkward page size.
  const check = await sweep(urlFor, 337, keyOf);
  const added = [...check.seen.keys()].filter((k) => !seen.has(k));
  if (added.length) {
    throw new Error(
      `${label}: a second ordered sweep at a different page size found ${added.length} record(s) ` +
        `the first did not (e.g. ${added.slice(0, 5).join(', ')}). Paging is not deterministic.`
    );
  }
  log(`  ${label}: verified — second sweep at pageSize 337 added 0 records`);

  return [...seen.values()];
}

/** Page one qualification's delivery scope to exhaustion.
 *
 *  THE TRAP THIS FUNCTION EXISTS FOR: /delivery has no totalCount. It returns exactly
 *  `pageSize` rows and a links[] entry with rel === 'next-page' when there is more.
 *  Reading one page and counting the array under-reports every popular qualification —
 *  BSB50420 reads as 724 providers that way, and is really 817. There is no total to
 *  reconcile against, so exhausting the link is the ONLY defence; we additionally refuse
 *  any result whose length is an exact multiple of the page size with no terminating page. */
async function harvestDelivery(code) {
  const rows = [];
  let offset = 0;
  let sawTerminator = false;

  for (let page = 0; page < 60; page += 1) {
    const body = await getJson(qualificationDelivery(code, offset, DELIVERY_PAGE));
    const batch = Array.isArray(body) ? body : (body.value ?? body.data ?? []);
    rows.push(...batch);

    const links = Array.isArray(body?.links) ? body.links : [];
    const next = links.find((l) => l?.rel === 'next-page');
    if (!next || batch.length === 0) {
      sawTerminator = true;
      break;
    }
    offset += DELIVERY_PAGE;
  }

  if (!sawTerminator) {
    throw new Error(`${code}: delivery pagination never terminated after ${rows.length} rows`);
  }
  if (rows.length > 0 && rows.length % DELIVERY_PAGE === 0) {
    throw new Error(
      `${code}: delivery returned exactly ${rows.length} rows (a multiple of the page size) ` +
        `with no further page — refusing a probable silent truncation`
    );
  }
  return rows;
}

async function writeCache(name, value) {
  await mkdir(CACHE, { recursive: true });
  await writeFile(join(CACHE, name), JSON.stringify(value), 'utf8');
}

async function readCache(name) {
  const path = join(CACHE, name);
  if (!existsSync(path)) return null;
  return JSON.parse(await readFile(path, 'utf8'));
}

/** Reuse a cached harvest when running locally; CI always starts cold. */
async function cached(name, produce) {
  if (process.env.NTR_FRESH !== '1') {
    const hit = await readCache(name);
    if (hit) {
      log(`  ${name}: reused from cache (${Array.isArray(hit) ? hit.length.toLocaleString() : '?'} rows)`);
      return hit;
    }
  }
  const value = await produce();
  await writeCache(name, value);
  return value;
}

async function main() {
  const startedAt = new Date().toISOString();
  log(`National Training Register harvest — ${startedAt}`);

  log('organisations');
  const organisations = await cached('organisations.json', () =>
    harvestSearch('organisations', (offset, size) => organisationSearch(offset, size))
  );

  log('qualifications');
  const qualifications = await cached('qualifications.json', () =>
    harvestSearch('qualifications', (offset, size) =>
      trainingSearch(COMPONENT_TYPE.qualification, offset, size)
    )
  );

  // Training packages are NOT harvested separately. The component-type ids are not what
  // they look like — `Type/Id eq 1` returns 19,440 accredited courses, not the 259 training
  // packages — and every qualification already carries its own {code, title} package inline.
  // Deriving the package list from the qualifications is both cheaper and guaranteed
  // consistent with the qualifications we actually ship.

  // Delivery scope is only meaningful for qualifications that are current — a superseded
  // qualification having no provider is expected, not a finding.
  const currentCodes = qualifications
    .filter((q) => q?.status?.isCurrent === true)
    .map((q) => String(q.code))
    .filter(Boolean);
  log(`delivery scope for ${currentCodes.length.toLocaleString()} current qualifications`);

  const delivery = await cached('delivery.json', async () => {
    let done = 0;
    const entries = await mapLimit(currentCodes, CONCURRENCY, async (code) => {
      const rows = await harvestDelivery(code);
      done += 1;
      if (done % 200 === 0) log(`  …${done}/${currentCodes.length}`);
      return [code, rows];
    });
    const totalEdges = entries.reduce((n, [, rows]) => n + rows.length, 0);
    log(`  delivery: ${totalEdges.toLocaleString()} raw scope rows across ${entries.length} qualifications`);
    return Object.fromEntries(entries);
  });

  // Regulatory decisions and restrictions, for every organisation the register flags.
  const flagged = organisations
    .filter((o) => o?.hasCurrentRestrictionOrRegulatoryDecision === true)
    .map((o) => String(o.code))
    .filter(Boolean);
  log(`regulatory records for ${flagged.length.toLocaleString()} flagged organisations`);

  const regulatory = await cached('regulatory.json', async () => {
    const entries = await mapLimit(flagged, CONCURRENCY, async (code) => {
      const [decisions, restrictions] = await Promise.all([
        getJson(organisationDecisions(code)).catch(() => []),
        getJson(organisationRestrictions(code)).catch(() => []),
      ]);
      return [code, { decisions: decisions ?? [], restrictions: restrictions ?? [] }];
    });
    const n = entries.reduce((acc, [, v]) => acc + (v.decisions?.length ?? 0), 0);
    log(`  regulatory: ${n.toLocaleString()} decisions`);
    return Object.fromEntries(entries);
  });

  await writeCache('meta.json', {
    harvestedAt: startedAt,
    counts: {
      organisations: organisations.length,
      qualifications: qualifications.length,
      currentQualifications: currentCodes.length,
      flaggedOrganisations: flagged.length,
      regulatoryRecords: Object.keys(regulatory).length,
    },
  });

  log('harvest complete');
}

main().catch((error) => {
  process.stderr.write(`collect failed: ${error?.stack ?? error}\n`);
  process.exit(1);
});
