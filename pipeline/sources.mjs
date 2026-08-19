// SPDX-FileCopyrightText: 2026 Ben Richardson
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Every URL this project touches, in one place.
//
// The National Training Register's Web API is public and unauthenticated: its
// Swagger index at /swagger/index.js lists eight specs, every one of which has an
// empty securitySchemes block. Data is Creative Commons Attribution 4.0
// International (training.gov.au/copyright-information).

export const NTR = 'https://training.gov.au';

/** Component type ids used by /api/search/training's OData filter. */
export const COMPONENT_TYPE = Object.freeze({
  trainingPackage: 1,
  qualification: 2,
  unit: 4,
  skillSet: 8,
  accreditedCourse: 32,
  accreditedUnit: 64,
});

// `orderBy` is the whole ballgame on these two endpoints. Under the DEFAULT ordering
// (relevance) offset paging is lossy — the order is stable for a given offset but not
// across offsets, so a sweep both duplicates and SKIPS records: an unordered sweep of the
// organisation index returns only ~12,100–12,550 distinct of 13,146. Imposing a total
// order with `orderBy` makes paging deterministic and exhaustive in a single sweep, which
// is both cheaper and — unlike sweeping repeatedly until a union stops growing — provably
// complete, because the result can be reconciled against the endpoint's own totalCount.
//
// `includeTotalCount=true` is not optional: without it there is NO totalCount field at
// all, so a `rows.length === totalCount` check compares against undefined and passes
// vacuously. And `page=` is silently IGNORED — only `offset=` moves the cursor.
export const organisationSearch = (offset, pageSize) =>
  `${NTR}/api/search/organisation?pageSize=${pageSize}&offset=${offset}` +
  `&includeTotalCount=true&orderBy=${encodeURIComponent('CodeInt asc')}`;

export const trainingSearch = (typeId, offset, pageSize) =>
  `${NTR}/api/search/training?pageSize=${pageSize}&offset=${offset}` +
  `&includeTotalCount=true&orderBy=${encodeURIComponent('Code asc')}` +
  `&filter=${encodeURIComponent(`Type/Id eq ${typeId}`)}`;

/** WARNING: this endpoint has NO total-count field and silently truncates at pageSize,
 *  returning a links[] entry with rel === 'next-page'. Always follow it to exhaustion.
 *  Counting a single page under-reports every popular qualification. */
export const qualificationDelivery = (code, offset, pageSize) =>
  `${NTR}/api/training/${encodeURIComponent(code)}/delivery?pageSize=${pageSize}&offset=${offset}`;

export const organisationDecisions = (code) =>
  `${NTR}/api/organisation/${encodeURIComponent(code)}/regulatorydecision`;

export const organisationRestrictions = (code) =>
  `${NTR}/api/organisation/${encodeURIComponent(code)}/restrictions`;

export const ATTRIBUTION = Object.freeze({
  register: {
    name: 'National Training Register (training.gov.au)',
    publisher: 'Australian Government — Department of Employment and Workplace Relations',
    licence: 'CC BY 4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
    url: 'https://training.gov.au/',
  },
  boundaries: {
    name: 'Australian state and territory boundaries',
    publisher: 'Australian Bureau of Statistics (ASGS)',
    licence: 'CC BY 4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
    url: 'https://www.abs.gov.au/statistics/standards/australian-statistical-geography-standard-asgs-edition-3',
  },
});
