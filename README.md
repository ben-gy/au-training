# Training Register

**Which nationally recognised qualifications can nobody in Australia teach — and who is allowed to teach the rest.**

🔗 **Live:** [https://au-training.benrichardson.dev](https://au-training.benrichardson.dev)

## What is this?

Australia's National Training Register is the authoritative record of vocational education: every
registered training organisation, every nationally recognised qualification, and exactly which
provider is permitted to deliver which qualification in which state. It is excellent at looking one
thing up. It cannot answer a single question about the system as a whole.

This site is the same register turned sideways. It reads the register's public API, joins the pieces
together, and answers the aggregate questions the official interface has no way to ask — starting
with the one that turns out to matter most: **144 of Australia's 1,164 current qualifications have no
registered provider able to teach them anywhere in the country.** Another 137 have exactly one. At
the other end, a single business diploma is sold by 809 different providers.

The more useful number for an individual is per-state. Roughly 200 qualifications have no provider
approved to deliver them in any given jurisdiction — around one in six. "No provider anywhere in
Australia" is a national curiosity; "no provider in my state" is what actually stops somebody
enrolling.

The site also surfaces the regulatory record: which providers are operating under a condition,
suspension or other decision right now, under which section of which Act, reproduced verbatim.

## Who is this for?

- **Prospective students and their parents**, checking a college before handing over money. The VET
  sector has a long history of collapses and predatory providers; "is this place actually registered,
  and has the regulator done anything to it?" is a question the register can answer but does not make
  easy.
- **Employers and apprenticeship coordinators** looking for someone who can deliver a specific
  qualification in their state, and discovering — often late — that nobody can.
- **RTO compliance staff and trainers** checking who else holds scope for a qualification, and how a
  training product has changed across releases.
- **Journalists, policy analysts and researchers** working on skills shortages, thin training markets
  and regulatory enforcement.

## Data Sources

| Source | What it provides | Update frequency |
|--------|-------------------|-----------------|
| [National Training Register](https://training.gov.au/) NTR Web API | 13,146 organisations, 8,034 qualifications, the full RTO↔qualification delivery graph, and every published regulatory decision and restriction | Continuously; harvested monthly |
| ABS ASGS state boundaries | Real state and territory polygons for the map | Static |

Both are Creative Commons Attribution 4.0 International. No API key, no registration, no login.

## Features

- **Supply leaderboard** — every current qualification ranked by how many providers can actually
  teach it, thinnest first, with the never-supplied, recently-released and confidential cases labelled
  rather than lumped together.
- **State coverage matrix** — qualification × jurisdiction, surfacing training deserts.
- **Provider lookup** — search 3,982 registered providers by name, code or ABN; see scope, states,
  regulator, registration history and any regulatory action.
- **Regulatory register** — every decision in force, with the legislative provision and decision events.
- **Delivery network** — the bipartite RTO↔qualification graph, per training package, on a supply-ordered spine.
- **Map** — providers on real ABS boundaries, shaded by provider count or by qualifications unavailable.
- **System matrix** — training package × AQF level, shaded by median providers per qualification.
- **Lineage** — supersedes/superseded-by chains, distinguishing equivalent from non-equivalent transitions.
- **Method** — the headline recomputed five defensible ways, so you can see how much it depends on
  the judgement calls behind it.

## Tech Stack

- **Runtime:** Vanilla TypeScript (no framework)
- **Build:** Vite 6, with per-view code splitting
- **Testing:** Vitest — 174 tests
- **Hosting:** GitHub Pages (static, no backend)
- **Data:** GitHub Actions pipeline, monthly
- **Maps:** Leaflet 1.9 (the only runtime dependency)

## Local Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Run tests
npm test

# Production build
npm run build

# Preview production build
npm run preview
```

To refresh the data:

```bash
npm run collect && npm run aggregate
```

## How it works

`pipeline/collect.mjs` harvests the register into `pipeline/cache/`; `pipeline/aggregate.mjs` turns
that cache into the JSON in `public/data/` that the site loads. Only `summary.json` and `supply.json`
are fetched at boot — everything else arrives when the view that needs it is opened.

Two things about the upstream API are worth knowing, because both would otherwise produce a
confidently wrong site:

1. **Offset paging over the search endpoints is lossy under the default ordering.** The result order
   is stable for a given offset but not across offsets, so a sweep returns the right *number* of rows
   and the wrong rows — about 12,100 distinct organisations out of 13,146, silently dropping a
   thousand providers including entire universities, while a `rows.length === totalCount` check passes
   throughout. Passing an explicit `orderBy` makes paging deterministic; the harvest is then reconciled
   against the endpoint's own `totalCount`, and a second sweep at a different page size must add nothing.
2. **The delivery-scope endpoint truncates at the page size with no total to check against.** It
   returns a full page plus a `next-page` link. Reading one page reports the country's most widely
   offered qualification as having 721 providers instead of 809. Every request follows the link chain
   to exhaustion, and the build refuses any result whose row count is an exact multiple of the page
   size with no terminating page.

Thirteen fatal gates run before anything is written. The most important one refuses to publish if any
generated file contains an email- or phone-shaped string: the source register publishes personal
contact details for the chief executive of every provider, and many providers are one-person
businesses. Records are built from an explicit field allowlist so that a new upstream contact field
is dropped by default rather than published by default.

## License

[GNU Affero General Public License v3.0 or later](./LICENSE), with an attribution
requirement added under section 7(b) — see [ADDITIONAL-TERMS.md](./ADDITIONAL-TERMS.md).

A separate commercial licence without the AGPL's source-disclosure obligations is
available on request: <hi@ben.gy>.

Third-party components keep their own licences — see [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md).
Data sources keep theirs, and their attribution requirements are listed in the site's
own methodology/sources section.
