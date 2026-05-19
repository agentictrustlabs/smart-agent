# SC7 — Storage Layout Migration

> **Status**: Implementation spec; needs developer pickup.
> **Audience**: developer (executor), security lead (technical sponsor),
> engineering manager (ratifies CI guard).
> **Document type**: Implementation spec + ops policy.
> **Pairs with**: SC4 (governance multisig owns system-contract upgrades;
> this doc says how upgrades preserve state safely).
> **Prerequisite**: Spec 007 Phase A landed. Phase A introduced multiple new
> storage slots in AgentAccount (`_factory`,
> `_acceptedSessionDelegations`). This doc locks in the discipline going
> forward.

---

## 1. The problem

UUPS upgrades preserve the proxy's address but swap in new implementation
bytecode. The proxy's storage slots are **physical slot indexes** — slot
0, slot 1, slot 2, ... — and the new implementation MUST interpret them
identically. If a new implementation reorders, renames, or removes a
declared state variable, the storage slot meaning shifts and existing
state becomes corrupted.

Symptoms of a bad upgrade:

- `_owners` mapping references the wrong slot → all owners disappear.
- Two unrelated variables share a slot → writes to one corrupt the other.
- Inheritance order changes → all derived slots shift.

This is one of the most common ways to brick an upgradeable contract.
Multiple high-profile bricked-protocol incidents have been storage-layout
drift.

---

## 2. Current state inventory

### 2.1 UUPS-upgradeable contracts

Per Spec 007 Phase A and the current state of the code:

| Contract | UUPS? | Storage slots used | Storage gap? | Notes |
|---|---|---|---|---|
| `AgentAccount` | ✅ Yes | Owner set, factory addr, accepted session delegations, ERC-7201 isolated regions (passkeys, modules) | ❌ No explicit `__gap` | Critical to add |
| `AgentAccountFactory` | ❌ No (immutables only) | n/a | n/a | Re-deploy on change |
| `DelegationManager` | ❌ No (per SC4 §4.3.4) | Revoked-delegation mapping | n/a | Re-deploy on change |
| Caveat enforcers (stateless) | ❌ No | n/a | n/a | Re-deploy |
| Caveat enforcers (stateful) | ❌ No | Per-enforcer state | n/a | Re-deploy |
| Registries | ❌ No (concrete contracts) | Per-registry via AttributeStorage | n/a | Re-deploy + migrate |
| `AttributeStorage` (abstract base) | ❌ inheritable, but no proxy | 8 typed value mappings + indexing + version | n/a | Care needed for derived contracts |
| `SessionAgentAccountFactory` | ❌ No | n/a | n/a | Re-deploy |
| `SmartAgentPaymaster` | ❌ No | Dev-mode flag, accept-list | n/a | Re-deploy |

[OWE-REVIEWER] Verify the "UUPS? Yes" / "No" column per-contract via:

```
$ grep -rn 'UUPSUpgradeable\|upgradeToAndCall\|_authorizeUpgrade' packages/contracts/src/
```

Plan default based on §2.1 audit: only `AgentAccount` is UUPS in v1.

### 2.2 AgentAccount storage layout (post-Phase-A)

Reading `AgentAccount.sol:41-95`:

```
slot 0: _entryPoint            (immutable, stored in code not storage)
slot 1: _delegationManager     (address)
slot 2: _owners                (mapping)
slot 3: _ownerCount            (uint256)
slot 4: _factory               (address)        [Phase A]
slot 5: _acceptedSessionDelegations (mapping)   [Phase A]

ERC-7201 isolated regions (NOT in linear layout — namespaced via assembly):
- MODULES_STORAGE_SLOT = 0x1f14a6acc...c00  → modules struct
- PASSKEY_STORAGE_SLOT = 0x3b3ffcf51a0a...d00 → passkey struct
```

Cite: `AgentAccount.sol:49-65, 411-426, 843-861`.

The ERC-7201 pattern (used by modules + passkeys) is the **safe**
pattern: each struct lives in a slot computed from a deterministic
keccak (not the linear-layout sequence), so adding new linear-layout
state never collides with them.

The non-namespaced fields (slots 1-5) are the danger zone. Any new
variable added to the contract MUST go AFTER slot 5, and we MUST NOT
reorder or delete any existing slot.

---

## 3. The discipline

### 3.1 Rule 1: storage gap on every upgradeable contract

[DECISION] Every UUPS-upgradeable contract MUST end with a storage
gap:

```solidity
uint256[50] private __gap;
```

For `AgentAccount`, this lands at the **end** of the non-namespaced
state declarations. New variables added in future upgrades shrink the
gap by their slot count.

Why 50?

- 50 slots = 1600 bytes of headroom. Enough for ~50 simple
  variables or a few complex structs.
- If 50 fills up, the contract has structural problems independent
  of upgradeability — refactor before adding more.

### 3.2 Rule 2: ERC-7201 namespaced storage for new feature groups

Add a new ERC-7201 namespaced region for any new feature group with
multiple related variables. Example: spec 005 added settlement state
to `PledgeRegistry`; that state could have lived in its own ERC-7201
region.

Pattern:

```solidity
bytes32 private constant NEW_FEATURE_STORAGE_SLOT =
    keccak256("smart-agent.agent-account.new-feature.v1") & ~bytes32(uint256(0xff));
// or per ERC-7201 formula:
// slot = keccak256(abi.encode(uint256(keccak256("smart-agent.agent-account.new-feature.v1")) - 1)) & ~bytes32(uint256(0xff));

struct NewFeatureStorage {
    uint256 a;
    address b;
    mapping(bytes32 => bool) c;
}

function _newFeatureStorage() private pure returns (NewFeatureStorage storage $) {
    bytes32 slot = NEW_FEATURE_STORAGE_SLOT;
    assembly { $.slot := slot }
}
```

Cite the existing pattern: `AgentAccount.sol:412-426` (modules),
`:843-861` (passkeys).

### 3.3 Rule 3: storage layout is the new public API

Any change to storage layout in an upgradeable contract is a breaking
change. We treat it like a public-API change:

- Requires governance multisig approval (SC4).
- Requires CI storage-layout diff check.
- Requires foundry test against deployed state.
- Requires NEW audit pass (or auditor sign-off via retainer if
  small).

---

## 4. CI guard: storage-layout snapshot + diff

### 4.1 Baseline snapshot

`forge inspect <Contract> storage-layout --pretty > .storage/Contract.json`

Run for every UUPS contract. Output committed to repo at
`packages/contracts/.storage/AgentAccount.json` (and any future
upgradeable contracts).

### 4.2 CI guard

Add a CI step:

```bash
# .github/workflows/storage-layout.yml
- name: storage-layout-snapshot
  run: |
    forge inspect AgentAccount storage-layout --pretty > /tmp/AgentAccount.json
    diff -u packages/contracts/.storage/AgentAccount.json /tmp/AgentAccount.json \
      || (echo "Storage layout changed!" && exit 1)
```

Block PR on diff. Reviewer must either:

- Confirm the change is additive-only (new slots after the gap; gap
  shrinks accordingly).
- Update the baseline AND request explicit security review.

### 4.3 Upgrade-safety check (script)

Add `packages/contracts/script/CheckUpgrade.s.sol`:

```solidity
// Given an old impl address and new impl address, compares storage
// layouts and emits any incompatibility.
contract CheckUpgrade is Script {
    function run(address oldImpl, address newImpl) external {
        // Use forge-std's vm.parseJsonString on `forge inspect`
        // outputs to compare layouts slot-by-slot.
        // ...
    }
}
```

Run as part of any upgrade PR.

### 4.4 OpenZeppelin Upgrades Plugin (alternative)

OZ ships a Foundry-compatible upgrades plugin (foundry-upgrades) that
performs storage-layout safety automatically. URL:
https://github.com/OpenZeppelin/openzeppelin-foundry-upgrades.

[DECISION] **Adopt OpenZeppelin foundry-upgrades** as a CI dependency.
It's the industry-standard tool for storage-layout safety on UUPS.

This is a TOOL dependency, not a runtime substrate dependency.
Substrate-independence rule P1 forbids depending on OZ contracts at
runtime where we have our own; this is using OZ's tooling for our own
code. No conflict.

Add to CI:

```yaml
- name: upgrade-safety
  run: |
    cd packages/contracts
    pnpm openzeppelin-foundry-upgrades validate AgentAccount
```

---

## 5. Migration testing harness

Place under `packages/contracts/test/UpgradeMigration.t.sol`.

### 5.1 Test layout

```solidity
contract UpgradeMigrationTest is Test {
    function test_OldImplToNewImpl_PreservesOwners() external {
        // 1. Deploy old impl.
        // 2. Deploy proxy + initialize with user1 as owner.
        // 3. user1.addOwner(user2).
        // 4. Deploy new impl.
        // 5. Upgrade proxy → new impl via owner-signed authorization.
        // 6. Assert isOwner(user1), isOwner(user2), ownerCount == 2.
    }

    function test_OldImplToNewImpl_PreservesPasskeys() external {
        // Similar: register passkey, upgrade, assert passkey still
        // verifies signatures.
    }

    function test_OldImplToNewImpl_PreservesModules() external {
        // Install hook module, upgrade, assert hook still in module list.
    }

    function test_OldImplToNewImpl_PreservesAcceptedSessionDelegations() external {
        // Pre-authorize a session delegation, upgrade, assert acceptance
        // still recorded.
    }

    function test_OldImplToNewImpl_PreservesDelegationManager() external {
        // Set delegationManager, upgrade, assert delegationManager() returns same.
    }

    function test_OldImplToNewImpl_PreservesFactory() external {
        // Verify _factory survives.
    }
}
```

### 5.2 Adversarial upgrade tests

```solidity
function test_BadImpl_Reorders_DetectedByCheckUpgrade() external {
    // Deploy a "bad" impl that reorders state (e.g. _owners and
    // _ownerCount swapped). Run CheckUpgrade script. Assert
    // script detects the incompatibility.
}

function test_BadImpl_RemovesVariable_DetectedByCheckUpgrade() external {
    // Deploy a "bad" impl missing _factory. Run CheckUpgrade.
    // Assert script detects.
}
```

### 5.3 Fuzz: random upgrade path

```solidity
function fuzz_RandomStateThenUpgrade_PreservesAll(...) external {
    // Apply random sequence of state mutations on old impl.
    // Upgrade. Snapshot state. Compare to expected via predicate
    // sum.
}
```

---

## 6. Implementation plan

### 6.1 Phase 7.A — add storage gap to AgentAccount

[DECISION] Land before mainnet. Sequencing:

1. Snapshot current storage layout:
   ```
   forge inspect AgentAccount storage-layout --pretty > \
     packages/contracts/.storage/AgentAccount.v2_1_0.json
   ```
2. Modify `AgentAccount.sol`:
   ```solidity
   // ... existing state ...
   address private _factory;
   mapping(bytes32 => bool) private _acceptedSessionDelegations;

   /// @dev Storage gap to reserve slots for future variables in
   ///      upgradeable AgentAccount. Shrink when adding new state;
   ///      never reorder above this line.
   uint256[50] private __gap;
   ```
3. Snapshot new layout:
   ```
   forge inspect AgentAccount storage-layout --pretty > \
     packages/contracts/.storage/AgentAccount.json
   ```
4. Verify the diff shows ONLY the addition of __gap[50] at the end.
5. Land migration test (§5).
6. Bump `version()` to `2.2.0` (cite line 235).

[OWE-REVIEWER] Important: adding `__gap` to the END of currently-laid-out
contract is **backwards-incompatible** with any in-flight Variant B
state IF future upgrades expect __gap to absorb new slots. The slot
order shifts only if we INSERT __gap, not append. We append → safe.

### 6.2 Phase 7.B — ERC-7201 audit

For every existing namespaced region (MODULES_STORAGE_SLOT,
PASSKEY_STORAGE_SLOT), verify:

- The slot literal matches the documented ERC-7201 formula:
  `keccak256(abi.encode(uint256(keccak256(<namespace>)) - 1)) & ~bytes32(uint256(0xff))`.
- The namespace string is unique across the codebase.
- The struct is the only thing stored at that slot.

Quick check script:

```bash
grep -rn 'STORAGE_SLOT =' packages/contracts/src/
```

For each match, verify the literal is computed correctly.

### 6.3 Phase 7.C — CI integration

1. Add `.github/workflows/storage-layout.yml`.
2. Add `pnpm openzeppelin-foundry-upgrades` validation step.
3. Add `forge test --match-path test/UpgradeMigration.t.sol` to CI.
4. Block PRs on any failure.

### 6.4 Phase 7.D — policy documentation

Add `docs/runbooks/upgrade-checklist.md`:

> Before any UUPS upgrade ships:
> - [ ] `forge inspect` diff is reviewed and intentional.
> - [ ] Migration test added for any new state variable.
> - [ ] `__gap` shrunk appropriately (or unchanged).
> - [ ] Audit re-engagement scheduled if storage change is non-trivial.
> - [ ] Governance multisig proposal queued.
> - [ ] 48-hour timelock observed.

### 6.5 Phase 7.E — auditor handoff

Bundle into SC1 audit scope:

- Storage-layout snapshot baseline.
- Phase 7.A change.
- Migration test suite.
- CI guard.

Auditor confirms layout discipline.

---

## 7. Policy: storage-layout change requires audit re-engagement

[DECISION] Project policy:

> Any change to an upgradeable contract that modifies its storage
> layout (other than appending new variables before the storage gap)
> requires:
>
> 1. Governance multisig approval (SC4).
> 2. Storage-layout safety check passing in CI.
> 3. Migration test in `UpgradeMigration.t.sol`.
> 4. Auditor re-review (retainer mini-engagement per SC1 §8.3, ~$5-15k).

This policy is enforced by the upgrade-checklist (§6.4) and by the
multisig signer's review obligation (a signer who approves an
upgrade proposal without checking the storage layout has violated
their duty).

### 7.1 What counts as "non-trivial"?

- Adding a new state variable after the gap: trivial. Reviewer check
  + CI guard sufficient.
- Adding a new ERC-7201 region: trivial.
- Modifying an existing ERC-7201 struct: NON-trivial. The struct's
  layout is itself stored; reordering or removing fields corrupts
  state.
- Changing inheritance order: NON-trivial.
- Changing data type of any existing variable: NON-trivial.

NON-trivial changes require auditor sign-off.

---

## 8. Storage discipline for non-upgradeable contracts

DelegationManager, registries, enforcers, paymaster, factory — all
non-upgradeable in v1. When they need to change:

1. New contract deployed at new address.
2. Old contract continues to exist for in-flight state.
3. Migration script reads old state, writes to new.
4. Governance multisig coordinates pointer changes (e.g. SDK
   updates to new address).

[OWE-REVIEWER] For registries with on-chain state that other
contracts read by address: design a redirect / forwarder pattern, OR
accept that "redeploy" means "everyone updates references". Plan
default: accept; document the migration playbook per registry.

### 8.1 Per-registry migration playbook template

For each registry, document:

- What state is in this registry.
- How to read it (via SPARQL / direct RPC / SDK).
- How to write equivalent state to a new registry.
- Whether the registry's address is referenced by other on-chain
  state (if yes, where).
- The handover sequence.

Bundle into `docs/runbooks/registry-migration-<name>.md` per
registry, written when needed (not eagerly).

---

## 9. Risks

| # | Risk | Mitigation |
|---|---|---|
| S1 | Developer skips the storage-layout check; CI guard fails them. | §4.2 mandatory CI gate. |
| S2 | Developer manually updates the snapshot to silence the check. | Code-review process for any `.storage/*.json` change; security lead must sign off. |
| S3 | OpenZeppelin foundry-upgrades plugin has a false negative. | Belt-and-suspenders: also use `forge inspect` diff. |
| S4 | An ERC-7201 region collides with another (slot-collision attack). | §6.2 audit of every namespace string + slot literal; SC1 auditor verifies. |
| S5 | A new upgradeable contract is added later without a storage gap. | Lint rule (§4.4 OZ plugin) flags it; add to PR checklist. |
| S6 | UUPS implementation contract's own state changes (uninitialized → initialized) — proxy gets initialised vs. impl is left uninitialised. | Cite: `AgentAccount.sol:118-121` (`_disableInitializers` in the constructor). Auditor verifies. |
| S7 | Migration test in §5 doesn't catch a real-world drift because the test fixture differs from prod. | Test against forge fork of mainnet state for the final pre-deploy validation. |

---

## 10. Acceptance criteria

Phase 7 (this spec) is complete when ALL of:

- [ ] `__gap[50]` added to `AgentAccount`.
- [ ] `version()` bumped.
- [ ] Storage-layout snapshot baseline committed.
- [ ] CI guard active and verified by intentionally breaking a PR.
- [ ] OZ foundry-upgrades plugin integrated.
- [ ] Migration test suite passes.
- [ ] Adversarial upgrade tests (§5.2) pass.
- [ ] `docs/runbooks/upgrade-checklist.md` written.
- [ ] All ERC-7201 region literals verified per §6.2.
- [ ] Auditor handoff package includes this doc + snapshot.

---

## 11. Open questions

1. [OWE-REVIEWER] Verify "UUPS? Yes" per-contract per §2.1; update
   the table.
2. Are there any "implicit" upgradeable contracts via proxy patterns
   we haven't catalogued (e.g. SessionAgentAccount via factory)?
3. Are we comfortable with foundry-upgrades being a build-time
   dependency (substrate-independence — yes; this is tooling, not
   runtime).
4. Does the auditor want to see ALL `.storage/*.json` snapshots
   reviewed during SC1? Plan: yes.

---

## 12. Next actions

1. Developer: implement §6.1 Phase 7.A.
2. Developer: write §5 migration test suite.
3. Developer: integrate OZ foundry-upgrades plugin per §6.3.
4. Security lead: write `docs/runbooks/upgrade-checklist.md`.
5. Security lead: validate all ERC-7201 namespaces (§6.2).
6. After implementation lands: bundle into SC1 audit scope.
