// SPDX-FileCopyrightText: 2026 Ben Richardson
// SPDX-License-Identifier: AGPL-3.0-or-later

export type StateCode = 'NSW' | 'VIC' | 'QLD' | 'SA' | 'WA' | 'TAS' | 'NT' | 'ACT';

export type SupplyTier = 'none' | 'single' | 'thin' | 'moderate' | 'crowded';

export interface Lineage {
  code: string;
  title: string;
  equivalent: boolean;
}

export interface SupplyRow {
  code: string;
  title: string;
  level: string | null;
  package: string | null;
  packageTitle: string | null;
  field: string | null;
  anzsco: string | null;
  industry: string[];
  providers: number;
  assessOnly: number;
  tier: SupplyTier;
  states: Partial<Record<StateCode, number>>;
  start: string | null;
  releaseDate: string | null;
  /** Flagged confidential upstream — a zero provider count may mean "withheld", not "none". */
  confidential: boolean;
  /** Released in the last twelve months, so no providers yet is application lag. */
  isNew: boolean;
  /** Has any provider ever held scope for this, live or historical? */
  everSupplied: boolean;
  supersedes: Lineage[];
  supersededBy: Lineage[];
}

export interface Provider {
  code: string;
  name: string;
  tradingNames: string[];
  abn: string | null;
  isRto: boolean;
  isCurrent: boolean;
  status: string | null;
  statusLabel: string | null;
  regStart: string | null;
  regEnd: string | null;
  regInitial: string | null;
  legalAuthority: string | null;
  regulator: string | null;
  rtoType: string | null;
  suburb: string | null;
  state: StateCode | null;
  postcode: string | null;
  country: string | null;
  lat: number | null;
  lon: number | null;
  deliversIn: StateCode[];
  deliversInternational: boolean;
  flagged: boolean;
  website: string | null;
  scope: number;
  decisions: number;
  currentDecisions: number;
}

export interface DecisionEvent {
  date: string | null;
  status: string | null;
  maker: string | null;
  detail: string | null;
}

export interface Decision {
  rto: string;
  reference: string | null;
  decision: string | null;
  detail: string;
  type: string | null;
  status: string | null;
  level: string | null;
  madeUnder: string | null;
  madeUnderUrl: string | null;
  maker: string | null;
  historic: boolean;
  effective: string | null;
  start: string | null;
  end: string | null;
  reviewStatus: string | null;
  events: DecisionEvent[];
}

export interface Restriction {
  rto: string;
  type: string | null;
  text: string;
  start: string | null;
  end: string | null;
}

export interface MatrixCell {
  n: number;
  median: number;
  orphans: number;
}

export interface MatrixPackage {
  code: string;
  title: string | null;
  quals: number;
  cells: Record<string, MatrixCell>;
}

export interface LineageQual {
  code: string;
  title: string;
  level: string | null;
  package: string | null;
  status: string | null;
  isCurrent: boolean;
  start: string | null;
  end: string | null;
  supersedes: Lineage[];
  supersededBy: Lineage[];
}

export interface Attribution {
  name: string;
  publisher: string;
  licence: string;
  licenceUrl: string;
  url: string;
}

export interface SupplyVariant {
  label: string;
  note: string;
  orphans: number;
}

export interface Summary {
  harvestedAt: string;
  organisations: number;
  /** Every RTO still on the register: current, re-registration pending, or suspended. */
  registeredRtos: number;
  /** The subset whose registration is fully current. */
  fullyCurrentRtos: number;
  geocodedRtos: number;
  rtosWithNoScope: number;
  qualifications: number;
  currentQualifications: number;
  trainingPackages: number;

  /** Edges where a provider can actually TEACH the qualification. */
  teachingEdges: number;
  /** All live scope entries, including assess-only. */
  liveScopeEntries: number;
  assessOnlyEdges: number;

  orphans: number;
  single: number;
  /** Between one and five providers — EXCLUDES the zeros. */
  oneToFive: number;
  /** Five or fewer providers — INCLUDES the zeros. */
  fiveOrFewer: number;
  orphansNeverSupplied: number;
  orphansLostSupply: number;
  orphansRecentlyReleased: number;
  orphansConfidential: number;
  supplyVariants: Record<string, SupplyVariant>;

  medianProviders: number;
  maxProviders: number;
  maxProvidersCode: string | null;
  maxProvidersTitle: string | null;

  flaggedProviders: number;
  flaggedFullyCurrent: number;
  decisions: number;
  currentDecisionCount: number;
  staleNonHistoricDecisions: number;
  restrictions: number;
  decisionStatuses: Record<string, number>;

  histogram: { label: string; count: number }[];
  byState: Record<StateCode, {
    providers: number;
    deliverHere: number;
    qualsAvailable: number;
    qualsUnavailable: number;
  }>;
  regulators: Record<string, number>;
  rtoTypes: Record<string, number>;
  decisionTypes: Record<string, number>;
  attribution: { register: Attribution; boundaries: Attribution };
}
