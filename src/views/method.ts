// SPDX-FileCopyrightText: 2026 Ben Richardson
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// How the numbers were made, and how much they would move if the judgement calls had gone
// the other way. A site that leads with "144 qualifications nobody can teach" owes the
// reader the four decisions that produced 144 and what each is worth.

import { loadSummary } from '../data.ts';
import { esc, longDate, num, pct } from '../format.ts';
import { glossaryRef } from '../glossary.ts';
import type { Summary } from '../types.ts';
import { bar, errorState, loading, viewHead } from '../components/ui.ts';

export async function renderMethod(root: HTMLElement): Promise<void> {
  root.innerHTML = loading('Loading method…');
  try {
    paint(root, await loadSummary());
  } catch (error) {
    root.innerHTML = errorState(error instanceof Error ? error.message : String(error), 'method-retry');
    root.querySelector('#method-retry')?.addEventListener('click', () => void renderMethod(root));
  }
}

function paint(root: HTMLElement, s: Summary): void {
  const variants = Object.entries(s.supplyVariants);
  const maxOrphans = Math.max(...variants.map(([, v]) => v.orphans), 1);

  root.innerHTML = `
    ${viewHead(
      'How these numbers were made',
      `Every figure on this site comes from the National Training Register's public API, harvested on
       ${longDate(s.harvestedAt.slice(0, 10))}. The headline depends on four judgement calls, and this page
       shows what each one is worth.`
    )}

    <div class="panel" style="margin-bottom:1.5rem">
      <div class="panel-head">
        <div class="panel-title">How sensitive is “${num(s.orphans)} qualifications with no provider”?</div>
        <div class="panel-sub">The same question, counted five defensible ways. The spread is narrow, which is
          the point: this finding does not depend on picking a flattering definition.</div>
      </div>
      <div class="panel-body">
        ${variants
          .map(([key, v]) =>
            bar(
              v.label,
              num(v.orphans),
              v.orphans / maxOrphans,
              key === 'headline' ? 'var(--rose)' : 'var(--text-tertiary)',
              `${v.label}\n${num(v.orphans)} qualifications\n\n${v.note}`
            )
          )
          .join('')}
        <p class="stat-note" style="margin-top:1rem">
          The first row is the rule this site uses everywhere. The narrowest reading gives
          ${num(Math.min(...variants.map(([, v]) => v.orphans)))} and the widest
          ${num(Math.max(...variants.map(([, v]) => v.orphans)))}.
        </p>
      </div>
    </div>

    ${panel(
      'The four judgement calls',
      `
      <h4>1. Teaching, not assessing</h4>
      <p>Scope comes in two extents, and only one of them lets a provider teach you.
        ${glossaryRef('deliverAssess', '“Assess only”')} scope means a provider can recognise skills you already
        have but cannot run the course. This site counts only deliver-and-assess scope, which is why its
        headline (${num(s.orphans)}) is higher than the ${num(s.supplyVariants.includeAssessOnly.orphans)} you
        would get from training.gov.au's own provider search — that search counts assess-only providers too.
        Both numbers are honest answers to different questions. If you want to be taught, ours is the one that
        matters.</p>

      <h4>2. Suspended providers are not counted as supply</h4>
      <p>A suspension is the regulator stopping a provider from operating. Counting suspended scope as
        available training would overstate what you can actually enrol in, so it is excluded. It makes no
        difference to the headline — the count is ${num(s.supplyVariants.includeSuspended.orphans)} either
        way — but it does change ${num(s.assessOnlyEdges)}-odd edges elsewhere on the site.</p>

      <h4>3. Providers mid re-registration are counted</h4>
      <p>An RTO whose re-registration application is with the regulator is still lawfully operating and can
        still enrol you. Excluding them as well would push the headline to
        ${num(s.supplyVariants.strictCurrentOnly.orphans)}.</p>

      <h4>4. Brand-new qualifications are counted, but flagged</h4>
      <p>${num(s.orphansRecentlyReleased)} of the ${num(s.orphans)} were released in the last twelve months.
        Providers must apply to add a new qualification to their scope, so having none yet is administrative
        lag rather than a market that has failed. Excluding them gives
        ${num(s.supplyVariants.excludingNewQualifications.orphans)}. They are counted, and labelled wherever
        they appear.</p>
    `
    )}

    ${panel(
      `What the ${num(s.orphans)} actually are`,
      `
      <p>They are not one story. Splitting them:</p>
      <ul>
        <li><strong>${num(s.orphansNeverSupplied)}</strong> have never had a single provider — no organisation
          has ever held scope to deliver them. Many are enterprise or agency-specific qualifications
          (defence, policing) that were never meant for an open training market.</li>
        <li><strong>${num(s.orphansLostSupply)}</strong> did have providers and lost them. This is the real
          market-exit signal, and the more interesting half.</li>
        <li><strong>${num(s.orphansRecentlyReleased)}</strong> are new enough that nobody has applied yet.</li>
        <li><strong>${num(s.orphansConfidential)}</strong> are flagged confidential in the register, so their
          provider list may be deliberately withheld. A zero there may mean “not published” rather than
          “nobody”, and they should not be read as thin markets.</li>
      </ul>
      <p>One explanation that gets offered for orphan qualifications is that providers simply have not
        migrated their scope from the superseded version yet. That was tested and it does not hold: of the
        orphans that supersede an earlier qualification, almost none have a predecessor that still has live
        providers.</p>
    `
    )}

    ${panel(
      'Where the data comes from',
      `
      <p>The <a href="${esc(s.attribution.register.url)}" target="_blank" rel="noopener">${esc(
        s.attribution.register.name
      )}</a> is published by the ${esc(s.attribution.register.publisher)} under a
        <a href="${esc(s.attribution.register.licenceUrl)}" target="_blank" rel="noopener">${esc(
          s.attribution.register.licence
        )}</a> licence. This site reads its public API and republishes a derived, aggregated view.</p>
      <p>Boundaries on the map are ${esc(s.attribution.boundaries.name)} from the
        ${esc(s.attribution.boundaries.publisher)}, also ${esc(s.attribution.boundaries.licence)}.</p>
      <p><strong>This site is not the authoritative record and is not live.</strong> The register changes
        every working day as regulators make decisions; this copy was taken on
        ${longDate(s.harvestedAt.slice(0, 10))} and refreshes monthly. Before you act on anything here —
        especially before enrolling with a provider or relying on its registration status — check
        <a href="https://training.gov.au/" target="_blank" rel="noopener">training.gov.au</a> itself.</p>
    `
    )}

    ${panel(
      'What is deliberately not here',
      `
      <ul>
        <li><strong>Contact details.</strong> The register publishes names, email addresses and mobile numbers
          for the chief executive and enquiry contacts of every provider, and many providers are one-person
          businesses. None of that is republished here. The data is built by naming the fields to keep rather
          than the fields to drop, and the build fails if anything email- or phone-shaped reaches a published
          file.</li>
        <li><strong>Student numbers.</strong> This is the supply side only — who is allowed to teach what.
          Enrolment, completion and apprentice counts are held by NCVER, whose site is not machine-readable
          without an account.</li>
        <li><strong>Units, skill sets and accredited courses.</strong> The register holds
          ${num(s.qualifications)} qualifications but also tens of thousands of units of competency and
          thousands of accredited courses. Only training-package qualifications are covered here, so
          “${num(s.currentQualifications)} current qualifications” is not the whole register.</li>
        <li><strong>Quality.</strong> Nothing here says whether a provider is any good. It says what it is
          permitted to do and what the regulator has formally recorded.</li>
      </ul>
    `
    )}

    ${panel(
      'Two things about the API worth recording',
      `
      <p>Both were found by trying to break the numbers rather than by reading documentation, and both would
        have produced a confidently wrong site.</p>
      <p><strong>Paging silently loses records.</strong> Under the search API's default ordering, walking
        through results by offset returns the right <em>number</em> of rows but not the right rows: an
        unordered sweep of the ${num(s.organisations)}-organisation index returns only about 12,100 distinct
        providers, quietly dropping roughly a thousand — including entire universities — while a
        row-count check passes. Imposing an explicit sort order makes paging deterministic, and the result is
        then reconciled against the register's own total.</p>
      <p><strong>One endpoint truncates without saying so.</strong> The scope endpoint returns exactly one
        page and a link to the next, with no total to check against. Reading a single page reports the
        country's most widely offered qualification as having 721 providers instead of
        ${num(s.maxProviders)}. Every request follows the link chain to exhaustion, and the build refuses any
        result whose row count is an exact multiple of the page size with no terminating page.</p>
    `
    )}

    ${panel(
      'Checks the build has to pass',
      `
      <p>The data pipeline runs a set of fatal checks and refuses to publish if any fails. Among them: no
        published file may contain anything email- or phone-shaped; every scope record must resolve to a
        provider that exists in the register; per-state provider counts may never exceed the national count
        for the same qualification; the headline's numerator and denominator must be drawn from exactly the
        same set of qualifications; and the rule used to decide whether a regulatory decision is in force must
        agree with the register's own flag to within a few per cent — currently
        ${num(s.flaggedFullyCurrent)} providers by our rule against ${num(s.decisions)} decisions on record.</p>
      <p>The last one exists because the register's “historic” flag is unreliable:
        ${num(s.staleNonHistoricDecisions)} decisions are marked live but expired years ago. Publishing on the
        flag alone would describe providers as currently sanctioned when they are not.</p>
    `
    )}

    <p class="stat-note">Register snapshot taken ${longDate(s.harvestedAt.slice(0, 10))} ·
      ${num(s.organisations)} organisations · ${num(s.currentQualifications)} current qualifications ·
      ${num(s.teachingEdges)} teaching relationships (${pct(s.orphans, s.currentQualifications)} of
      qualifications have none).</p>
  `;
}

function panel(title: string, body: string): string {
  return `<div class="panel" style="margin-bottom:1.5rem">
    <div class="panel-head"><div class="panel-title">${title}</div></div>
    <div class="panel-body prose">${body}</div>
  </div>`;
}
