// SPDX-FileCopyrightText: 2026 Ben Richardson
// SPDX-License-Identifier: AGPL-3.0-or-later

import { loadSummary } from './data.ts';
import { longDate, num } from './format.ts';
import { openOverlay } from './overlay.ts';

export async function openAbout(): Promise<void> {
  const { body } = openOverlay({ variant: 'modal', title: 'About Training Register' });
  body.innerHTML = '<p>Loading…</p>';
  try {
    const s = await loadSummary();
    body.innerHTML = `
      <div class="prose">
        <p><strong>Training Register</strong> turns Australia's National Training Register sideways. The
          register itself is excellent at looking one thing up; it cannot answer questions about the system as
          a whole. This site can.</p>

        <h3>What you can find out</h3>
        <ul>
          <li>Which nationally recognised qualifications <strong>nobody in Australia can currently teach</strong>
            — ${num(s.orphans)} of ${num(s.currentQualifications)} of them.</li>
          <li>Which qualifications have no provider <strong>in your state</strong> — around 200 in every
            jurisdiction, which is the number that actually stops someone enrolling.</li>
          <li>Whether a particular college is genuinely registered, what it is approved to teach, and whether
            the regulator has taken action against it.</li>
          <li>How concentrated the training market is: the most popular qualification is sold by
            ${num(s.maxProviders)} providers, while the median qualification has ${num(s.medianProviders)}.</li>
        </ul>

        <h3>Where the data comes from</h3>
        <p>The <a href="https://training.gov.au/" target="_blank" rel="noopener">National Training Register</a>,
          published by the Australian Government under a
          <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>
          licence. Boundaries are ABS ASGS state boundaries, also CC BY 4.0. This snapshot was taken on
          <strong>${longDate(s.harvestedAt.slice(0, 10))}</strong> and refreshes monthly.</p>

        <h3>Important limits</h3>
        <p>This is a derived copy, not the authoritative record, and it is not live. The register changes every
          working day. <strong>Before enrolling with a provider or relying on its registration status, check
          <a href="https://training.gov.au/" target="_blank" rel="noopener">training.gov.au</a> itself.</strong></p>
        <p>It covers the supply side only — who is permitted to teach what. It holds no student numbers, no
          completion rates and no judgement about whether a provider is any good. It also covers only
          training-package qualifications, not units of competency, skill sets or accredited courses.</p>
        <p>A regulatory decision is a public record, not a verdict. Most are routine conditions on a
          provider's registration rather than findings of wrongdoing.</p>
        <p>No personal contact details are republished here, although the source register does publish them.</p>

        <h3>How the counting works</h3>
        <p>The headline depends on four judgement calls, and the <strong>Method</strong> tab shows what each one
          is worth — the same question counted five defensible ways, so you can see the finding does not
          depend on a flattering definition.</p>
      </div>`;
  } catch {
    body.innerHTML =
      '<p>Training Register is an independent view of Australia\'s National Training Register ' +
      '(training.gov.au, CC BY 4.0). The summary data could not be loaded just now.</p>';
  }
}
