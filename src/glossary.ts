// SPDX-FileCopyrightText: 2026 Ben Richardson
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Assume the reader knows nothing about vocational education. Every piece of jargon the
// interface uses appears here, and every use of it in the UI gets a clickable info icon.

export interface Term {
  term: string;
  definition: string;
}

export const GLOSSARY: Record<string, Term> = {
  vet: {
    term: 'VET',
    definition:
      'Vocational Education and Training — the part of the education system that teaches job-specific skills, ' +
      'as opposed to university degrees. It covers apprenticeships, trade certificates, and diplomas in ' +
      'everything from aged care to aviation. Around four million Australians enrol in VET each year.',
  },
  rto: {
    term: 'RTO',
    definition:
      'Registered Training Organisation — a college, TAFE, business, school or industry body that a government ' +
      'regulator has approved to deliver nationally recognised training. Only an RTO can issue a nationally ' +
      'recognised qualification. If a provider is not an RTO, the certificate it issues is not nationally recognised.',
  },
  qualification: {
    term: 'Qualification',
    definition:
      'A complete, nationally recognised credential — for example CPC30220 Certificate III in Carpentry. Every ' +
      'qualification has a code, sits at a level on the Australian Qualifications Framework, and is made up of ' +
      'units of competency. A qualification means the same thing no matter which provider issues it.',
  },
  scope: {
    term: 'Scope of registration',
    definition:
      'The specific list of qualifications and units an RTO is approved to deliver. An RTO cannot legally deliver ' +
      'nationally recognised training outside its scope. Scope is granted, varied and removed by the regulator, ' +
      'and it is the single most useful thing to check about a provider.',
  },
  provider: {
    term: 'Provider (on this site)',
    definition:
      'A currently registered RTO that holds live scope to DELIVER a given qualification — not merely to assess it. ' +
      'Providers whose registration has been withdrawn, cancelled or has lapsed are excluded, and so are historical ' +
      'scope records. Providers mid re-registration or under suspension are still counted, because they are still ' +
      'on the register.',
  },
  deliverAssess: {
    term: 'Deliver and assess vs assess only',
    definition:
      'Scope comes in two extents. "Deliver and assess" means the RTO can teach the qualification and assess the ' +
      'student. "Assess only" means it can only assess skills the student already has — usually for recognition of ' +
      'prior learning. An assess-only provider cannot teach you, so this site counts only deliver-and-assess scope ' +
      'when it says how many providers a qualification has.',
  },
  trainingPackage: {
    term: 'Training package',
    definition:
      'A set of qualifications and units for one industry, developed with that industry and endorsed nationally. ' +
      'BSB is Business Services, CPC is Construction and Plumbing, HLT is Health, SIT is Tourism and Hospitality. ' +
      'The first letters of a qualification code tell you its training package.',
  },
  aqf: {
    term: 'AQF level',
    definition:
      'The Australian Qualifications Framework ranks credentials by depth, from Certificate I (introductory) through ' +
      'Certificate II, III and IV, then Diploma, Advanced Diploma, and Graduate Certificate and Diploma. A trade ' +
      'apprenticeship is usually Certificate III.',
  },
  current: {
    term: 'Current',
    definition:
      'A qualification is "current" when it is the version in force today. Older versions become "superseded" and ' +
      'eventually stop being deliverable. This site measures supply only for current qualifications, because a ' +
      'superseded one having no provider is expected rather than a finding.',
  },
  superseded: {
    term: 'Superseded',
    definition:
      'Replaced by a newer version. The replacement is marked "equivalent" if the skills are judged the same, and ' +
      '"not equivalent" if the new version demands something materially different — which matters to anyone holding ' +
      'the old certificate.',
  },
  orphan: {
    term: 'Qualification with no provider',
    definition:
      'A qualification that is formally current — it exists, it is nationally recognised, an employer can ask for it — ' +
      'but no registered training organisation anywhere in Australia currently holds scope to deliver it. You cannot ' +
      'enrol in it today, anywhere.',
  },
  regulator: {
    term: 'Regulator',
    definition:
      'The body that registers and polices RTOs. ASQA (the Australian Skills Quality Authority) is the national ' +
      'regulator and covers most providers. Western Australia (TAC) and Victoria (VRQA) retain their own regulators ' +
      'for providers that operate only in those states.',
  },
  regulatoryDecision: {
    term: 'Regulatory decision',
    definition:
      'A formal action a regulator has taken about a provider — imposing a condition on its registration, suspending ' +
      'or cancelling part of its scope, rejecting an application, or cancelling its registration outright. A decision ' +
      'is a matter of public record and is published with the section of the Act it was made under. It is not by ' +
      'itself proof of wrongdoing, and many are administrative.',
  },
  restriction: {
    term: 'Restriction',
    definition:
      'A limit currently in force on what a provider may do — for example a condition requiring it to report to the ' +
      'regulator, or a bar on enrolling new students in particular qualifications.',
  },
  anzsco: {
    term: 'ANZSCO',
    definition:
      'The Australian and New Zealand Standard Classification of Occupations — the official occupation code a ' +
      'qualification is aimed at. It is what links a training product to a job title in labour-market statistics.',
  },
  trainingDesert: {
    term: 'Training desert',
    definition:
      'Used on this site to mean a state or territory in which no registered provider holds scope to deliver a given ' +
      'qualification. Someone in that state must travel, study online with an interstate provider if one offers it, ' +
      'or go without.',
  },
};

/** Wrap a label in a clickable glossary reference. Returns HTML. */
export function glossaryRef(key: keyof typeof GLOSSARY | string, label?: string): string {
  const entry = GLOSSARY[key];
  if (!entry) return label ?? String(key);
  const text = label ?? entry.term;
  return `${text}<button type="button" class="glossary-link" data-term="${key}" aria-label="What does ${entry.term} mean?">i</button>`;
}

let popover: HTMLDivElement | null = null;

/** One delegated handler for every glossary icon on the page. */
export function initGlossary(): void {
  document.addEventListener('click', (event) => {
    const target = (event.target as Element | null)?.closest<HTMLElement>('.glossary-link');
    if (!target) {
      hideGlossary();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const key = target.dataset.term ?? '';
    const entry = GLOSSARY[key];
    if (!entry) return;
    show(entry, target);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hideGlossary();
  });

  window.addEventListener('resize', hideGlossary);
  window.addEventListener('scroll', hideGlossary, true);
}

function show(entry: Term, anchor: HTMLElement): void {
  if (!popover) {
    popover = document.createElement('div');
    popover.className = 'glossary-popover';
    popover.setAttribute('role', 'tooltip');
    document.body.appendChild(popover);
  }
  popover.innerHTML = `<strong>${entry.term}</strong><p>${entry.definition}</p>`;
  popover.classList.add('visible');

  const rect = anchor.getBoundingClientRect();
  const width = Math.min(320, window.innerWidth - 24);
  popover.style.width = `${width}px`;
  const box = popover.getBoundingClientRect();

  let left = rect.left + rect.width / 2 - width / 2;
  left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
  let top = rect.bottom + 8;
  if (top + box.height > window.innerHeight - 12) top = Math.max(12, rect.top - box.height - 8);

  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
}

export function hideGlossary(): void {
  popover?.classList.remove('visible');
}
