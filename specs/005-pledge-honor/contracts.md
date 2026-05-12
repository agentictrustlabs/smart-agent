# Spec 005 — Contract Surface

> **Owner**: Developer.
> **Bound to**: `plan.md`, `docs/ontology/SPEC005_PLEDGE_HONOR_AUDIT.md`.
> **Principle**: P1 — we build, we don't depend. `CallDataHashEnforcer` already exists; re-used.

## File map

| File | Status | Purpose |
|---|---|---|
| `packages/contracts/src/mocks/MockUSDC.sol` | NEW | Local-only ERC-20 stand-in for settlement. 6 decimals. |
| `packages/contracts/src/AgentAccount.sol` | EXTEND | Add `executeBatch` so a single delegated tx can atomically transfer + record honor. |
| `packages/contracts/src/PledgeRegistry.sol` | EXTEND | Add `recordHonor`, `markPaid`, `getSettlement(...)` view; new events; new predicate constants. |
| `packages/contracts/src/enforcers/CallDataHashEnforcer.sol` | REUSE | Already exists. Pinned per sub-delegation per honor / markPaid call. |
| `packages/contracts/script/Deploy.s.sol` | EXTEND | Deploy MockUSDC after registries; echo `MOCK_USDC_ADDRESS` env. |
| `packages/sdk/src/abi.ts` | EXTEND | Export `mockUsdcAbi`, regenerated `agentAccountAbi`, regenerated `pledgeRegistryAbi`. |
| `packages/sdk/src/onchain/marketplace/admin-delegation.ts` | EXTEND | Add `SPEC005_SELECTORS = { executeBatch, pledgeRecordHonor, pledgeMarkPaid, usdcTransfer }`. |
| `packages/sdk/src/treasury/build-honor-batch.ts` | NEW | Helper to build the exact `executeBatch` calldata for `[USDC.transfer, PledgeRegistry.recordHonor]`. |

## 1. `MockUSDC.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// Dev-only ERC-20. NOT for production deployment.
/// Mint surface is open; the off-chain seed scripts gate on chainId.
contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
```

**Why open mint**: dev chain only. The web seed helpers check `chainId === 31337` before calling `mint`. If deployed to a public chain by accident, the open mint is annoying but doesn't leak real funds (it's not real USDC).

## 2. `AgentAccount.executeBatch`

Add to `AgentAccount.sol`:

```solidity
struct Call {
    address target;
    uint256 value;
    bytes data;
}

function executeBatch(Call[] calldata calls) external {
    _requireForExecute();

    ModulesStorage storage $ = _modulesStorage();
    address[] memory hooks = $.installedList[MODULE_TYPE_HOOK];
    bytes[] memory hookData = new bytes[](hooks.length);

    // Pre-hooks: one preCheck per hook, on the whole batch.
    bytes memory hookMsgData = abi.encode(calls);
    for (uint256 i; i < hooks.length; i++) {
        hookData[i] = IERC7579HookLike(hooks[i]).preCheck(
            msg.sender, 0, hookMsgData
        );
    }

    // Atomic: revert the entire batch on any inner revert.
    for (uint256 i; i < calls.length; i++) {
        (bool ok, bytes memory ret) = calls[i].target.call{ value: calls[i].value }(calls[i].data);
        if (!ok) {
            assembly {
                let len := mload(ret)
                revert(add(ret, 0x20), len)
            }
        }
    }

    for (uint256 i; i < hooks.length; i++) {
        IERC7579HookLike(hooks[i]).postCheck(hookData[i]);
    }
}
```

**Auth**: same `_requireForExecute()` gate as `execute()` — EntryPoint, self, or DelegationManager. Delegated batch flows redeem via DelegationManager.

**Self-call pattern (DelegationManager path)**:

```
DelegationManager.redeemDelegation(chain, target=treasury, value=0, data=executeBatch([Call(USDC, 0, transferData), Call(PledgeRegistry, 0, recordHonorData)]))
  → treasury.execute(target=treasury, value=0, data=executeBatch(...))  // outer call from DM
    → executeBatch(calls)
      → USDC.transfer(pool, amount)                  // msg.sender == treasury
      → PledgeRegistry.recordHonor(...)              // msg.sender == treasury
```

The `target=treasury` outer call IS the standard `execute` route; `execute` then dispatches to `executeBatch` because the inner calldata's selector matches. Actually simpler: DelegationManager's `_executeFromDelegator` always calls `delegator.execute(target, value, data)`. The `target` of that outer call is the **batch target = treasury**; the `data` is `executeBatch([...])`. So `treasury.execute(treasury, 0, executeBatch-calldata)` → recursively calls `treasury.executeBatch(...)`, whose inner calls run with `msg.sender == treasury`.

This works because `_requireForExecute` allows `msg.sender == address(this)` (self-call).

## 3. `PledgeRegistry` extensions

### 3.1 New predicate constants

```solidity
bytes32 public constant SA_PLEDGE_HONORED_AMOUNT         = keccak256("sa:pledgeHonoredAmount");
bytes32 public constant SA_PLEDGE_EXTERNALLY_PAID_AMOUNT = keccak256("sa:pledgeExternallyPaidAmount");
bytes32 public constant SA_PLEDGE_HONOR_TOKEN_LIST       = keccak256("sa:pledgeHonorTokenList");
bytes32 public constant SA_PLEDGE_LAST_HONORED_AT        = keccak256("sa:pledgeLastHonoredAt");
bytes32 public constant SA_PLEDGE_LAST_MARKED_AT         = keccak256("sa:pledgeLastMarkedAt");
bytes32 public constant SA_PLEDGE_PAYMENT_RAIL           = keccak256("sa:pledgePaymentRail");
bytes32 public constant SA_PLEDGE_EVIDENCE_HASH          = keccak256("sa:pledgeEvidenceHash");
bytes32 public constant SA_PLEDGE_MARKED_BY_AGENT        = keccak256("sa:pledgeMarkedByAgent");
```

### 3.2 New errors + events

```solidity
error PledgeAmountExceedsCommitted();
error EvidenceHashRequired();
error InvalidToken();

event PledgeHonored(
    bytes32 indexed pledgeSubject,
    address indexed treasury,
    address indexed token,
    uint256 amount,
    uint256 totalHonored
);

event PledgePaymentMarked(
    bytes32 indexed pledgeSubject,
    address indexed markedBy,
    address indexed token,
    uint256 amount,
    bytes32 rail,
    bytes32 evidenceHash,
    uint256 totalExternallyPaid
);

event PledgeFullyHonored(
    bytes32 indexed pledgeSubject,
    address indexed token,
    uint256 totalSettled
);
```

### 3.3 Helpers

```solidity
/// Composite subject for (pledge, token) settlement attributes.
function _settlementSubject(
    bytes32 pledgeSubj,
    bytes32 kind,                       // "honored" or "externalPaid"
    address token
) internal pure returns (bytes32) {
    return keccak256(abi.encode(pledgeSubj, kind, token));
}

/// Add token to honor list iff not already present.
function _addTokenToList(bytes32 pledgeSubj, address token) internal {
    bytes32[] memory current = this.getBytes32Arr(pledgeSubj, SA_PLEDGE_HONOR_TOKEN_LIST);
    bytes32 tokenAsBytes = bytes32(uint256(uint160(token)));
    for (uint256 i; i < current.length; i++) {
        if (current[i] == tokenAsBytes) return;
    }
    bytes32[] memory next = new bytes32[](current.length + 1);
    for (uint256 i; i < current.length; i++) next[i] = current[i];
    next[current.length] = tokenAsBytes;
    _setBytes32Arr(pledgeSubj, SA_PLEDGE_HONOR_TOKEN_LIST, next);
}
```

### 3.4 `recordHonor` — donor treasury rail

```solidity
function recordHonor(
    bytes32 pledgeSubj,
    address treasury,
    address token,
    uint256 amount
) external {
    if (!this.isSet(pledgeSubj, SA_PLEDGE_POOL)) revert PledgeNotFound();
    if (token == address(0)) revert InvalidToken();
    if (msg.sender != treasury) revert NotPoolOperator();  // donor's treasury self-call
    // Note: treasury → person agent → pledge ownership is checked off-chain by
    // the caller (org-mcp) before building the executeBatch calldata. The
    // registry only enforces that msg.sender == treasury (a sane caller).
    // The same-tx USDC.transfer in the executeBatch is the cryptographic proof.

    bytes32 settlementSubj = _settlementSubject(pledgeSubj, "honored", token);
    uint256 prev = this.getUint(settlementSubj, SA_PLEDGE_HONORED_AMOUNT);
    uint256 next = prev + amount;
    _setUint(settlementSubj, SA_PLEDGE_HONORED_AMOUNT, next);

    _addTokenToList(pledgeSubj, token);
    _setUint(pledgeSubj, SA_PLEDGE_LAST_HONORED_AT, block.timestamp);

    // SHACL bound: per-token settled <= committed for the pledge's
    // settlement token (i.e. token matches sa:pledgeUnit). Off-chain
    // gates compute pledge-unit token; on-chain we enforce iff the
    // pledge's amount predicate exists.
    uint256 committed = this.getUint(pledgeSubj, SA_PLEDGE_AMOUNT);
    uint256 externalPaid = this.getUint(
        _settlementSubject(pledgeSubj, "externalPaid", token),
        SA_PLEDGE_EXTERNALLY_PAID_AMOUNT
    );
    if (next + externalPaid > committed) revert PledgeAmountExceedsCommitted();
    if (next + externalPaid >= committed) {
        _setBytes32(pledgeSubj, SA_PLEDGE_STATUS, keccak256("sa:PledgeFullyHonored"));
        emit PledgeFullyHonored(pledgeSubj, token, next + externalPaid);
    }

    emit PledgeHonored(pledgeSubj, treasury, token, amount, next);
}
```

### 3.5 `markPaid` — attested external rail

```solidity
function markPaid(
    bytes32 pledgeSubj,
    address token,
    uint256 amount,
    bytes32 rail,
    bytes32 evidenceHash
) external {
    address poolAgent = this.getAddress(pledgeSubj, SA_PLEDGE_POOL);
    if (poolAgent == address(0)) revert PledgeNotFound();
    if (evidenceHash == bytes32(0)) revert EvidenceHashRequired();
    if (!_isAccountOwner(poolAgent, msg.sender)) revert NotPoolOperator();

    bytes32 settlementSubj = _settlementSubject(pledgeSubj, "externalPaid", token);
    uint256 prev = this.getUint(settlementSubj, SA_PLEDGE_EXTERNALLY_PAID_AMOUNT);
    uint256 next = prev + amount;
    _setUint(settlementSubj, SA_PLEDGE_EXTERNALLY_PAID_AMOUNT, next);

    _addTokenToList(pledgeSubj, token);
    _setUint(pledgeSubj, SA_PLEDGE_LAST_MARKED_AT, block.timestamp);
    _setBytes32(pledgeSubj, SA_PLEDGE_PAYMENT_RAIL, rail);
    _setBytes32(pledgeSubj, SA_PLEDGE_EVIDENCE_HASH, evidenceHash);
    _setAddress(pledgeSubj, SA_PLEDGE_MARKED_BY_AGENT, msg.sender);

    uint256 committed = this.getUint(pledgeSubj, SA_PLEDGE_AMOUNT);
    uint256 honored = this.getUint(
        _settlementSubject(pledgeSubj, "honored", token),
        SA_PLEDGE_HONORED_AMOUNT
    );
    if (next + honored > committed) revert PledgeAmountExceedsCommitted();
    if (next + honored >= committed) {
        _setBytes32(pledgeSubj, SA_PLEDGE_STATUS, keccak256("sa:PledgeFullyHonored"));
        emit PledgeFullyHonored(pledgeSubj, token, next + honored);
    }

    emit PledgePaymentMarked(pledgeSubj, msg.sender, token, amount, rail, evidenceHash, next);
}
```

### 3.6 `getSettlement` — view helper

```solidity
function getSettlement(bytes32 pledgeSubj, address token)
    external
    view
    returns (uint256 honored, uint256 externallyPaid)
{
    honored = this.getUint(
        _settlementSubject(pledgeSubj, "honored", token),
        SA_PLEDGE_HONORED_AMOUNT
    );
    externallyPaid = this.getUint(
        _settlementSubject(pledgeSubj, "externalPaid", token),
        SA_PLEDGE_EXTERNALLY_PAID_AMOUNT
    );
}
```

## 4. SDK selector table

```typescript
// packages/sdk/src/onchain/marketplace/admin-delegation.ts
export const SPEC005_SELECTORS = {
  // AgentAccount
  executeBatch:     selectorFromAbi(agentAccountAbi, 'executeBatch'),
  // PledgeRegistry
  pledgeRecordHonor: selectorFromAbi(pledgeRegistryAbi, 'recordHonor'),
  pledgeMarkPaid:    selectorFromAbi(pledgeRegistryAbi, 'markPaid'),
  // ERC-20
  usdcTransfer:      toFunctionSelector('transfer(address,uint256)'),
} as const
```

## 5. Build-honor-batch helper

```typescript
// packages/sdk/src/treasury/build-honor-batch.ts
import { encodeFunctionData } from 'viem'
import { agentAccountAbi, pledgeRegistryAbi } from '@smart-agent/sdk'

const ERC20_TRANSFER_ABI = [
  { type: 'function', name: 'transfer', inputs: [
    { name: 'to', type: 'address' },
    { name: 'amount', type: 'uint256' },
  ], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' },
] as const

export function buildHonorBatchCalldata(args: {
  treasury: Address
  pledgeRegistry: Address
  pledgeSubject: Hex
  token: Address              // USDC for v1
  amount: bigint
  poolAgent: Address          // recipient of the transfer
}): Hex {
  const transferData = encodeFunctionData({
    abi: ERC20_TRANSFER_ABI,
    functionName: 'transfer',
    args: [args.poolAgent, args.amount],
  })
  const recordHonorData = encodeFunctionData({
    abi: pledgeRegistryAbi,
    functionName: 'recordHonor',
    args: [args.pledgeSubject, args.treasury, args.token, args.amount],
  })
  return encodeFunctionData({
    abi: agentAccountAbi,
    functionName: 'executeBatch',
    args: [[
      { target: args.token,          value: 0n, data: transferData },
      { target: args.pledgeRegistry, value: 0n, data: recordHonorData },
    ]],
  })
}
```

## 6. Deploy script delta

```bash
# scripts/deploy-local.sh — append after FundRegistry/PledgeRegistry deploy

MOCK_USDC=$(forge create packages/contracts/src/mocks/MockUSDC.sol:MockUSDC \
  --rpc-url "$RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast \
  --json | jq -r '.deployedTo')

echo "MOCK_USDC_ADDRESS=$MOCK_USDC" >> apps/web/.env
echo "USDC_ADDRESS=$MOCK_USDC" >> apps/web/.env  # alias for forward-compat
```

`scripts/fresh-start.sh` extension: add `MOCK_USDC_ADDRESS` to `WIPE_PATHS` env consumers; extend `seed_after_deploy()` to mint USDC to each demo treasury via `fund-local-treasury`.

## 7. Ontology seed delta

See `docs/ontology/SPEC005_PLEDGE_HONOR_AUDIT.md` § 5 for the predicate registrations to add to `scripts/seed-spec004-ontology.ts`. All 8 new pledge predicates + `sa:hasPersonalTreasury` need on-chain registration before the first honor or markPaid call (else `PredicateNotActive` reverts).
