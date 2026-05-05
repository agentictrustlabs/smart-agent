// Contract: @smart-agent/sdk/pools
// Phase 1 design artifact for spec 002 — Intent Marketplace (Pool Lane).
//
// Class hierarchy & T-Box mapping (Audit § 2 O3, § 4 F2, § 8.1):
//   sa:Pool subClassOf sa:OrganizationAgent  — formal typing for pool agents
//   sa:Fund subClassOf sa:Pool                 — fund-shaped pools (governanceModel=fund)
//   SHACL sa:FundGovernanceModelConsistencyShape enforces governanceModel="fund" on
//   sa:Fund instances so the SDK property-as-discriminator stays consistent with the
//   class subsumption.
//
// Pool extension predicates (also in `docs/ontology/tbox/pool-pledge.ttl`):
//   sa:acceptsUnit       (multi-valued; the unit registry is open string-enum, Q1)
//   sa:ceilingPolicy     (range sa:CeilingPolicy)
//   sa:capacityCeiling
//   sa:acceptsOpenCalls  (used by spec 003)
//   sa:pledgedTotal      (derived aggregate; written to pool's org-mcp)
//   sa:availableTotal    (derived: pledgedTotal − allocatedTotal)
//   sa:addressedMembers  (private pools only; lives in fund's org-mcp ONLY — no anchor, IA § 2.5)
//   sa:steward / sa:stewardshipAgent

export type PoolDomain =
  | "funding"
  | "coaching"
  | "prayer"
  | "skills"
  | "hospitality"
  | string;

export type PoolGovernanceModel =
  | "DAF"
  | "giving-circle"
  | "mission-cooperative"
  | "mutual-aid"
  | "faith-promise"
  | "fund";

export type AcceptedRestrictions = {
  kinds?: string[];
  geoRoots?: string[];
  notForAdmin?: boolean;
  notForDiscretionary?: boolean;
};

export type CeilingPolicy = "block" | "waitlist" | "accept";

/**
 * The base Pool type (TS-side mirror of `sa:Pool subClassOf sa:OrganizationAgent`).
 * Public agent-profile fields live on the on-chain agent metadata; the body lives
 * in the pool's org-mcp tenant (org_principal = id).
 */
export type Pool = {
  id: string;
  name: string;
  domain: PoolDomain;
  mandate: string;
  governanceModel: PoolGovernanceModel;
  acceptedRestrictions: AcceptedRestrictions;
  acceptedUnits: string[]; // Q1: open string-enum
  capacityCeiling?: number;
  ceilingPolicy: CeilingPolicy; // defaults to 'accept' when undeclared (Q3)
  addressedTo: string;
  addressedMembers?: string[]; // private pools only
  visibility: "public" | "private";
  stewardshipAgent: string;
  stewards: string[];
  acceptsOpenCalls: boolean; // used by spec 003
  pledgedTotal: number;
  allocatedTotal: number;
  availableTotal: number;
};

/**
 * Fund — a Pool with `governanceModel: 'fund'` (SHACL-enforced).
 * Subtype is exposed for clearer typing on round-operating funds (spec 003) and for
 * SDK callers that want to narrow without re-checking the discriminator.
 */
export type Fund = Pool & { governanceModel: "fund" };

export type PoolListFilters = {
  hubId: string;
  domain?: PoolDomain;
  governanceModel?: PoolGovernanceModel;
  geo?: string;
  search?: string;
  viewerAgentId: string; // for visibility gate
};

export type PoolAllocationSummary = {
  // Read-only here; written by the downstream allocation spec.
  // Aggregation honours each allocation's storyPermissions.
  amount: number;
  unit: string;
  awardedTo: string | "anonymized" | { kind: "aggregated"; count: number };
  awardedAt: string; // ISO-8601
  outcomeStatus?: "fulfilled" | "abandoned" | "in-progress";
};

/**
 * Reads of public pools come from `@smart-agent/discovery` (the GraphDB public mirror
 * populated by the on-chain → GraphDB sync). Private-pool detail and the pool's
 * private aggregate state live in the pool's org-mcp tenant.
 */
export interface PoolClient {
  list(filters: PoolListFilters): Promise<Pool[]>;
  getById(id: string, viewerAgentId: string): Promise<Pool | null>;
  getRecentAllocations(
    poolId: string,
    viewerAgentId: string,
    limit?: number
  ): Promise<PoolAllocationSummary[]>;
}
