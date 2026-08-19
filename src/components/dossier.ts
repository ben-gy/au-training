// SPDX-FileCopyrightText: 2026 Ben Richardson
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The two drill-downs. Every clickable entity anywhere on the site opens one of these,
// deep-linked via ?qual= or ?rto= so the panel can be shared or reloaded into.

import { loadNetwork, loadProviderIndex, loadRegulatory, loadSupplyIndex } from '../data.ts';
import {
  STATES,
  TIER_COLOUR,
  TIER_LABEL,
  clip,
  esc,
  longDate,
  num,
  packageColour,
  tipAttr,
} from '../format.ts';
import { glossaryRef } from '../glossary.ts';
import { openOverlay } from '../overlay.ts';
import { setParam } from '../router.ts';
import type { Decision, Provider, Restriction, SupplyRow } from '../types.ts';
import { loading } from './ui.ts';

/** Cached qualification → provider codes, built once from the edge list. */
let byQual: Promise<Map<string, string[]>> | null = null;
let byRto: Promise<Map<string, string[]>> | null = null;

function buildIndexes() {
  const built = loadNetwork().then(({ edges }) => {
    const q = new Map<string, string[]>();
    const r = new Map<string, string[]>();
    for (const [qual, rto] of edges) {
      const forQual = q.get(qual);
      if (forQual) forQual.push(rto);
      else q.set(qual, [rto]);

      const forRto = r.get(rto);
      if (forRto) forRto.push(qual);
      else r.set(rto, [qual]);
    }
    return { q, r };
  });
  byQual = built.then((b) => b.q);
  byRto = built.then((b) => b.r);
}

function qualIndex() {
  if (!byQual) buildIndexes();
  return byQual!;
}
function rtoIndex() {
  if (!byRto) buildIndexes();
  return byRto!;
}

function kv(pairs: [string, string][]): string {
  const rows = pairs.filter(([, v]) => v && v !== '—');
  if (!rows.length) return '';
  return `<dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
}

function section(heading: string, body: string): string {
  if (!body) return '';
  return `<section class="dossier-section">
    <h3 class="dossier-heading">${heading}</h3>
    ${body}
  </section>`;
}

// ---------------------------------------------------------------------------
// Qualification
// ---------------------------------------------------------------------------

export async function openQualification(code: string): Promise<void> {
  const { body, panel } = openOverlay({
    variant: 'drawer',
    title: code,
    className: 'dossier',
    onClose: () => setParam('qual', null),
  });
  body.innerHTML = loading('Loading qualification…');
  setParam('qual', code);

  try {
    const [supply, providers, index] = await Promise.all([
      loadSupplyIndex(),
      loadProviderIndex(),
      qualIndex(),
    ]);
    const qual = supply.get(code);
    if (!qual) {
      body.innerHTML = `<p class="notice">No current qualification with the code ${esc(code)}.</p>`;
      return;
    }

    panel.querySelector('.overlay-title')!.textContent = qual.title;

    const rtoCodes = index.get(code) ?? [];
    const rtos = rtoCodes
      .map((c) => providers.get(c))
      .filter((p): p is Provider => Boolean(p))
      .sort((a, b) => a.name.localeCompare(b.name));

    body.innerHTML = renderQualification(qual, rtos);
  } catch (error) {
    body.innerHTML = `<p class="notice">Could not load this qualification. ${esc(
      error instanceof Error ? error.message : String(error)
    )}</p>`;
  }
}

function renderQualification(qual: SupplyRow, rtos: Provider[]): string {
  const tierColour = TIER_COLOUR[qual.tier];
  const stateBits = STATES.map((s) => {
    const n = qual.states[s] ?? 0;
    const colour = n === 0 ? 'var(--rose)' : n <= 3 ? 'var(--amber)' : 'var(--teal)';
    return `<span class="flag-pill" style="background:transparent;border-color:${colour};color:${colour}"
      data-tip="${tipAttr(`${s}: ${n === 0 ? 'no provider can teach this here' : `${n} provider${n === 1 ? '' : 's'}`}`)}">${s} ${n}</span>`;
  }).join(' ');

  const caveats: string[] = [];
  if (qual.confidential) {
    caveats.push(
      'This qualification is flagged confidential in the register. Its provider list may be deliberately ' +
        'restricted, so a count of zero here can mean “not published” rather than “nobody”.'
    );
  }
  if (qual.providers === 0 && qual.isNew) {
    caveats.push(
      'This qualification was released in the last twelve months. Providers must apply to add it to their ' +
        'scope, so having none yet reflects application lag rather than a market that has failed.'
    );
  }
  if (qual.providers === 0 && !qual.everSupplied && !qual.isNew) {
    caveats.push('No provider has ever held scope to deliver this qualification.');
  }
  if (qual.providers === 0 && qual.everSupplied) {
    caveats.push('This qualification did have providers once. All of them have since left its scope.');
  }
  if (qual.providers === 0 && qual.assessOnly > 0) {
    caveats.push(
      `${qual.assessOnly} provider${qual.assessOnly === 1 ? '' : 's'} can assess this qualification but not teach it — ` +
        'useful only if you already have the skills and want them recognised.'
    );
  }

  return `
    ${section(
      'Supply',
      `<p><span class="tier-pill" style="background:${tierColour}">${TIER_LABEL[qual.tier]}</span></p>
       <p style="margin-top:.6rem">${
         qual.providers === 0
           ? 'No registered training organisation currently holds scope to <strong>deliver</strong> this qualification anywhere in Australia.'
           : `<strong class="num">${num(qual.providers)}</strong> registered training organisation${qual.providers === 1 ? '' : 's'} can deliver this qualification.`
       }${qual.assessOnly > 0 ? ` A further <strong class="num">${num(qual.assessOnly)}</strong> can ${glossaryRef('deliverAssess', 'assess only')}.` : ''}</p>
       ${caveats.map((c) => `<p class="notice is-warn" style="margin-top:.6rem">${c}</p>`).join('')}`
    )}

    ${section('Where you can study it', `<div class="chip-row">${stateBits}</div>
      <p class="stat-note" style="margin-top:.5rem">Counts are providers approved to deliver in each state or territory.
      A ${glossaryRef('trainingDesert', 'training desert')} is a jurisdiction showing zero.</p>`)}

    ${section(
      'The qualification',
      kv([
        ['Code', `<span class="num">${esc(qual.code)}</span>`],
        ['Level', esc(qual.level ?? '—')],
        ['Training package', qual.package ? `${esc(qual.package)} — ${esc(qual.packageTitle ?? '')}` : '—'],
        ['Field of education', esc(qual.field ?? '—')],
        ['Target occupation', esc(qual.anzsco ?? '—')],
        ['Industry', qual.industry.length ? esc(qual.industry.join(', ')) : '—'],
        ['Current since', longDate(qual.start)],
        ['Latest release', longDate(qual.releaseDate)],
      ])
    )}

    ${section(
      'Lineage',
      [
        qual.supersedes.length
          ? `<p><strong>Supersedes</strong></p><ul style="margin:.25rem 0 .75rem 1.1rem">${qual.supersedes
              .map(
                (l) =>
                  `<li><span class="num">${esc(l.code)}</span> ${esc(l.title)} — ${
                    l.equivalent
                      ? '<span style="color:var(--teal)">equivalent</span>'
                      : '<span style="color:var(--amber)">not equivalent</span>'
                  }</li>`
              )
              .join('')}</ul>`
          : '',
        qual.supersededBy.length
          ? `<p><strong>Superseded by</strong></p><ul style="margin:.25rem 0 0 1.1rem">${qual.supersededBy
              .map((l) => `<li><span class="num">${esc(l.code)}</span> ${esc(l.title)}</li>`)
              .join('')}</ul>`
          : '',
      ].join('')
    )}

    ${section(
      `Who can deliver it${rtos.length ? ` (${num(rtos.length)})` : ''}`,
      rtos.length
        ? `<div class="table-wrap" style="max-height:24rem">
             <table><thead><tr><th>Provider</th><th>State</th><th class="num">Scope</th></tr></thead>
             <tbody>${rtos
               .slice(0, 400)
               .map(
                 (p) => `<tr class="clickable" data-rto="${esc(p.code)}">
                   <td><span class="cell-title">${esc(clip(p.name, 58))}</span>
                       ${p.currentDecisions > 0 ? ' <span class="flag-pill">regulator action</span>' : ''}
                       <div class="cell-code">${esc(p.code)}</div></td>
                   <td>${esc(p.state ?? '—')}</td>
                   <td class="num">${num(p.scope)}</td>
                 </tr>`
               )
               .join('')}</tbody></table>
           </div>
           ${rtos.length > 400 ? `<p class="stat-note">Showing the first 400 of ${num(rtos.length)}.</p>` : ''}`
        : ''
    )}

    <p class="stat-note">Source: National Training Register (training.gov.au), CC BY 4.0.
      This is a derived copy — <a href="https://training.gov.au/training/details/${esc(qual.code)}" target="_blank" rel="noopener">check the register itself</a> before relying on it.</p>
  `;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export async function openProvider(code: string): Promise<void> {
  const { body, panel } = openOverlay({
    variant: 'drawer',
    title: code,
    className: 'dossier',
    onClose: () => setParam('rto', null),
  });
  body.innerHTML = loading('Loading provider…');
  setParam('rto', code);

  try {
    const [providers, supply, index, regulatory] = await Promise.all([
      loadProviderIndex(),
      loadSupplyIndex(),
      rtoIndex(),
      loadRegulatory(),
    ]);
    const provider = providers.get(code);
    if (!provider) {
      body.innerHTML = `<p class="notice">No registered provider with the code ${esc(code)}.</p>`;
      return;
    }
    panel.querySelector('.overlay-title')!.textContent = provider.name;

    const quals = (index.get(code) ?? [])
      .map((c) => supply.get(c))
      .filter((q): q is SupplyRow => Boolean(q))
      .sort((a, b) => a.providers - b.providers || a.code.localeCompare(b.code));

    const decisions = regulatory.decisions
      .filter((d) => d.rto === code)
      .sort((a, b) => (b.effective ?? '').localeCompare(a.effective ?? ''));
    const restrictions = regulatory.restrictions.filter((r) => r.rto === code);

    body.innerHTML = renderProvider(provider, quals, decisions, restrictions);
  } catch (error) {
    body.innerHTML = `<p class="notice">Could not load this provider. ${esc(
      error instanceof Error ? error.message : String(error)
    )}</p>`;
  }
}

function renderProvider(
  p: Provider,
  quals: SupplyRow[],
  decisions: Decision[],
  restrictions: Restriction[]
): string {
  const statusNote =
    p.status === 'pending'
      ? 'This provider is operating while a re-registration application sits with the regulator.'
      : p.status === 'suspended'
        ? 'This provider’s registration is suspended. It cannot currently deliver training, and its scope is excluded from every provider count on this site.'
        : '';

  const rare = quals.filter((q) => q.providers <= 3);

  return `
    ${statusNote ? `<p class="notice is-warn" style="margin-bottom:1rem">${statusNote}</p>` : ''}

    ${section(
      'Registration',
      kv([
        ['Provider code', `<span class="num">${esc(p.code)}</span>`],
        ['Status', esc(p.statusLabel ?? p.status ?? '—')],
        ['Regulator', esc(p.regulator ?? '—')],
        ['Registered under', esc(p.legalAuthority ?? '—')],
        ['First registered', longDate(p.regInitial)],
        ['Current period', `${longDate(p.regStart)} – ${p.regEnd ? longDate(p.regEnd) : 'no end date'}`],
        ['Provider type', esc(p.rtoType ?? '—')],
        ['ABN', p.abn ? `<span class="num">${esc(p.abn)}</span>` : '—'],
        ['Trading as', p.tradingNames.length ? esc(p.tradingNames.join(', ')) : '—'],
        ['Location', [p.suburb, p.state, p.postcode].filter(Boolean).map(esc).join(' ') || '—'],
        [
          'Website',
          p.website ? `<a href="${esc(p.website)}" target="_blank" rel="noopener nofollow">${esc(clip(p.website, 48))}</a>` : '—',
        ],
        ['Approved to deliver in', p.deliversIn.length ? p.deliversIn.join(', ') : 'no state recorded'],
      ])
    )}

    ${
      decisions.length || restrictions.length
        ? section(
            'Regulatory action',
            `${
              restrictions.length
                ? `<p class="notice is-warn" style="margin-bottom:.75rem">${restrictions.length} restriction${
                    restrictions.length === 1 ? '' : 's'
                  } recorded against this provider.</p>`
                : ''
            }
            ${decisions
              .map(
                (d) => `<article class="decision-card${d.historic ? '' : ' is-current'}">
                  <strong>${esc(d.decision ?? 'Decision')}</strong>
                  <div class="cell-sub">${esc(d.type ?? '')}${d.status ? ` · ${esc(d.status)}` : ''}${
                    d.historic ? ' · historic' : ''
                  }</div>
                  ${kv([
                    ['Effective', longDate(d.effective ?? d.start)],
                    ['Ends', d.end ? longDate(d.end) : 'no end date'],
                    ['Decision maker', esc(d.maker ?? '—')],
                    [
                      'Made under',
                      d.madeUnderUrl
                        ? `<a href="${esc(d.madeUnderUrl)}" target="_blank" rel="noopener">${esc(d.madeUnder ?? 'legislation')}</a>`
                        : esc(d.madeUnder ?? '—'),
                    ],
                    ['Review', esc(d.reviewStatus ?? '—')],
                    ['Reference', d.reference ? `<span class="num">${esc(d.reference)}</span>` : '—'],
                  ])}
                  ${d.detail ? `<div class="decision-detail">${esc(d.detail)}</div>` : ''}
                </article>`
              )
              .join('')}
            <p class="stat-note">Reproduced from the register. A regulatory decision is a matter of public record and is
              not by itself a finding of wrongdoing — many are routine conditions of registration.</p>`
          )
        : section(
            'Regulatory action',
            '<p class="notice">No restriction or regulatory decision is recorded against this provider.</p>'
          )
    }

    ${section(
      `Scope — what it can teach (${num(quals.length)})`,
      quals.length
        ? `${
            rare.length
              ? `<p class="stat-note" style="margin-bottom:.5rem">${num(rare.length)} of these are qualifications that
                 three or fewer providers in Australia can deliver.</p>`
              : ''
          }
          <div class="table-wrap" style="max-height:26rem">
            <table><thead><tr><th>Qualification</th><th class="num">Providers</th></tr></thead>
            <tbody>${quals
              .slice(0, 500)
              .map(
                (q) => `<tr class="clickable" data-qual="${esc(q.code)}">
                  <td><span class="cell-title">${esc(clip(q.title, 56))}</span>
                      <div class="cell-code" style="color:${packageColour(q.package)}">${esc(q.code)}</div></td>
                  <td class="num" data-tip="${tipAttr(`${q.providers} provider(s) nationally`)}">${num(q.providers)}</td>
                </tr>`
              )
              .join('')}</tbody></table>
          </div>
          ${quals.length > 500 ? `<p class="stat-note">Showing the first 500 of ${num(quals.length)}.</p>` : ''}`
        : `<p class="notice">This provider holds no scope to deliver any <em>current</em> qualification.
             It may still hold scope for units, skill sets, accredited courses, or superseded qualifications,
             none of which this site covers.</p>`
    )}

    <p class="stat-note">Source: National Training Register (training.gov.au), CC BY 4.0.
      <a href="https://training.gov.au/organisation/details/${esc(p.code)}" target="_blank" rel="noopener">View this provider on the register</a>,
      which is the authoritative and up-to-the-minute record.</p>
  `;
}

/** One delegated listener for every dossier-opening element on the page. */
export function initDossierLinks(root: HTMLElement | Document = document): void {
  root.addEventListener('click', (event) => {
    const target = event.target as Element | null;
    if (!target || target.closest('.glossary-link') || target.closest('a')) return;
    const qual = target.closest<HTMLElement>('[data-qual]');
    if (qual?.dataset.qual) {
      event.preventDefault();
      void openQualification(qual.dataset.qual);
      return;
    }
    const rto = target.closest<HTMLElement>('[data-rto]');
    if (rto?.dataset.rto) {
      event.preventDefault();
      void openProvider(rto.dataset.rto);
    }
  });
}
