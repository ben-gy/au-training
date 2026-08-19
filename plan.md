# Site Plan: Training Register

## Overview
- **Name:** Training Register
- **Repo name:** au-training
- **Tagline:** Who is allowed to teach every nationally recognised qualification in Australia — and who the regulator has acted against.

### Naming
Plain topic name, no country code. The country (`AU`) lives in the index entry's `country` field.

## Target Audience

Four distinct groups, in descending order of size:

1. **Prospective VET students and their parents**, checking a provider before handing over money. Australia's VET sector has a long history of collapses and predatory providers (the VET FEE-HELP scandal). The question "is this college actually registered, and has the regulator done anything to it?" is answerable today only by knowing to look on training.gov.au and knowing how to read it. Mostly on a phone, non-expert, mildly anxious.
2. **Employers and apprenticeship coordinators** who need to find a provider that can deliver a specific qualification in their state — and who discover, often late, that nobody nearby can.
3. **VET sector staff** (RTO compliance managers, trainers) checking who else holds scope for a qualification, what a training package release changed, and which qualifications are being superseded out from under them.
4. **Journalists, policy analysts and researchers** working on skills shortages, thin markets and regulatory enforcement.

## Value Proposition

training.gov.au is the authoritative register and is genuinely good at *lookup* — if you already know the code you want. It is very bad at *aggregate* questions, because it has no cross-sectional views at all. Nothing anywhere answers:

- Which nationally recognised qualifications have **no provider at all**?
- Which qualifications can be delivered in Queensland but nowhere in Tasmania?
- Which providers is the regulator acting against **right now**, and under what section of which Act?
- How concentrated is the training market — how many RTOs sell the same handful of business diplomas while the trades run one-provider-deep?

This site is the register turned sideways: same authoritative data, aggregate-first.

## Data Sources

| Source | URL | What it provides | Update frequency | Auth required? |
|--------|-----|-------------------|-----------------|----------------|
| NTR organisation search | `training.gov.au/api/search/organisation` | 13,146 organisations; 3,911 currently registered RTOs; legal + trading names, ABN, head-office address with lat/lon, per-state delivery rights, regulator, RTO type, registration dates and status | Continuous | **No** |
| NTR training component search | `training.gov.au/api/search/training` | 8,034 qualifications (1,164 current) with AQF level, training package, ANZSCO occupation, ASCED field of education, industry/occupation taxonomy, supersedes/supersededBy lineage | Continuous | **No** |
| NTR qualification delivery scope | `training.gov.au/api/training/{code}/delivery` | The RTO↔qualification edge set — who may deliver each qualification, in which states, and whether they may deliver or only assess | Continuous | **No** |
| NTR regulatory decisions | `training.gov.au/api/organisation/{code}/regulatorydecision` | Sanctions, conditions, suspensions and cancellations with the legislative provision, decision events and review status | Continuous | **No** |
| NTR restrictions | `training.gov.au/api/organisation/{code}/restrictions` | Currently-in-force restrictions on a provider | Continuous | **No** |
| ABS state boundaries | `patterns/geo/au-states.geojson` (fleet file, ABS ASGS-derived) | Real state/territory polygons for the map | Static | No |

**Licence:** Creative Commons Attribution 4.0 International, stated at `training.gov.au/copyright-information`. Boundaries CC BY 4.0 (ABS ASGS).

## Two things the research got wrong, verified first-hand

1. **`?pageSize=1000` on `/delivery` silently truncates.** It returns exactly 1000 rows *and* a `links[].rel == "next-page"` pointer. Counting the returned array — which is what the research did — undercounts every popular qualification. BSB50420 was reported as 724 providers; paged properly it is **817**. The collector must follow `next-page` until it is absent, and must never trust a round number.
2. **There is no `count` field on `/delivery`** (unlike `/scope`, which has one). So there is no total to reconcile against — the only defence is the pagination link plus a gate that refuses any qualification whose row count is an exact multiple of the page size without a terminating page.

## Key Features

1. **Orphan and thin-market leaderboard** — every current qualification ranked by how many providers can actually deliver it, with the zero-provider and one-provider tiers called out.
2. **Provider search and dossier** — look up any RTO by name, code or ABN: its scope, its states, its regulator, its registration history, and any regulatory action against it, verbatim.
3. **Regulatory action register** — every current restriction and decision, with the Act and section, decision events and dates.
4. **State coverage matrix** — qualification availability by state, surfacing training deserts.
5. **RTO ↔ qualification network** — the bipartite delivery graph, filterable to a training package.
6. **Map of registered providers** — real ABS boundaries, providers by regulator and scope breadth.
7. **Training package × AQF level matrix** — where the system is richly supplied and where it is one-provider-deep.
8. **Qualification lineage** — the supersedes/superseded-by chains, with equivalent vs non-equivalent transitions distinguished.

## Style Direction

**Tone:** civic / authoritative, leaning consumer-friendly. This is a register a worried parent might land on.
**Colour palette:** light theme. Deep navy/slate for structure, a single warm amber for the regulatory-action accent (it must read as "attention", not "danger" — a condition on registration is not a scandal), teal for the supply/coverage encoding. Government-portal legibility without government-portal dreariness.
**UI density:** balanced. Dense enough for the matrix and network views; roomy enough that the provider dossier reads like a document.
**Dark/light theme:** light, with a full dark-mode variant driven by `prefers-color-scheme`.
**Reference sites for tone:** the ACNC charity register (au-charities' source) for the "look up an organisation" flow; machineryofgovernment.uk for the structural views.

## Technical Architecture

- **Stack:** Vanilla TypeScript + Vite 6. No framework — this is views over a static dataset, not a component tree.
- **Data strategy:** **pipeline**. The register changes continuously as regulators make decisions, but the factory's fastest permitted cadence is monthly, and the aggregate picture moves slowly enough that monthly is genuinely proportional. Cron: day 9, off-hour.
- **Key libraries:** Leaflet 1.9 (map) — the only runtime dependency. Everything else is hand-rolled SVG from `patterns/`.

## PRIVACY — the hard rule for this build

The organisation feed ships **personal contact details of named individuals**: `ceo.name`, `ceo.email`, `ceo.phone`, and the same again under `publicEnquiries` and `registrationEnquiries`. I confirmed this on the very first record returned. Many RTOs are one-person businesses, so these are private mobile numbers and personal email addresses.

- The parser uses an **explicit field allowlist**, never a denylist — a denylist is defeated by any upstream field rename.
- A **CI gate** scans every generated JSON file for email-shaped and phone-shaped strings and fails the build.
- This is enforced by a failing test, not by care.

Publishing these once to a public git history cannot be undone by a later commit.

## Layout

Sticky header (nav = words only, no counts) → view container → sticky footer. The provider/qualification dossier is a right-hand drawer on desktop, a full-screen sheet on mobile, **detached from the DOM when closed** (the iOS off-canvas scroll trap). Deep-linked via `?rto=` / `?qual=`.

## Visualization Strategy

Nine views. For each, the question it answers and why no other view answers it:

1. **Supply** (default) — ranked list of current qualifications by live provider count, with the 0-provider and 1-provider tiers pinned at top. *Q: what can nobody teach?* The headline lives here; no other view is a ranking.
2. **Provider search** — filterable table of all 3,911 current RTOs. *Q: is this college real, and what can it teach?* The lookup workhorse.
3. **Regulatory action** — timeline + table of decisions and restrictions. *Q: who is the regulator acting against, and under what power?* Event-shaped; nothing else is.
4. **State coverage matrix** — qualification (row) × state (column) heatmap of provider counts. *Q: where are the training deserts?* Only a matrix shows availability holes across two dimensions at once.
5. **Delivery network** — bipartite RTO↔qualification force graph, filtered by training package. *Q: how concentrated is this market?* Only a network shows the shared-provider structure.
6. **Map** — registered providers on real ABS boundaries. *Q: where are providers, and which regions are thin?* Geography is a dimension no other view carries.
7. **System matrix** — training package × AQF level, shaded by median providers per qualification. *Q: which corners of the system are one-provider-deep?* An aggregate cross-tab, distinct from view 4's per-qualification detail.
8. **Lineage** — supersedes/superseded-by chains for a chosen qualification family. *Q: how has this trade's qualification mutated, and where did equivalence break?* A DAG; nothing else is.
9. **Distribution** — histogram of providers-per-qualification on a log scale. *Q: is this a normal market or a power law?* Shows the shape the leaderboard only implies.

Every mark gets a `[data-tip]` tooltip. The network gets `attachSvgZoom`. The force layout settles synchronously before first paint.
