# SmartAgentPaymaster — Integration Plan

## 1. Architecture

The master EOA (a2a-agent's self-bundler, `A2A_MASTER_PRIVATE_KEY`) is the outer transaction sender that calls `EntryPoint.handleOps([userOp], beneficiary=masterEoa.address)`. It still pays the outer-tx gas to the chain — but EntryPoint then credits the beneficiary from the paymaster's deposit, so the master EOA is reimbursed within the same transaction and its balance trends flat instead of bleeding down. The `SmartAgentPaymaster` contract holds a 1 ETH stake + 5 ETH deposit on the EntryPoint (dev defaults) and validates each userOp via `_validatePaymasterUserOp`. Per-op flow: a2a-agent constructs a `PackedUserOperation` with `paymasterAndData = <paymaster addr || verificationGasLimit || postOpGasLimit>`, signs it with the smart account's owner key, and submits via `handleOps`. EntryPoint pre-charges the paymaster's deposit, runs validation + the inner call, then issues a refund based on actual gas used. In production the master EOA is replaced by any external bundler (Stackup/Pimlico/Alchemy) without touching the paymaster contract — the paymaster is the only stable piece of gas infrastructure.

## 2. What this PR ships vs. what comes next

This PR delivers: (a) `packages/contracts/src/SmartAgentPaymaster.sol` — a BasePaymaster subclass with a DEV-SAFE accept-all policy plus the `_acceptList` admin surface for the production cutover; (b) Deploy.s.sol wiring that deploys the paymaster, calls `addStake{1 ether}(1 day)` and `deposit{5 ether}()`, and emits `PAYMASTER_ADDRESS` to the env output; (c) `scripts/deploy-local.sh` propagation of `PAYMASTER_ADDRESS` + `ENTRYPOINT_ADDRESS` into `apps/web/.env`, `apps/a2a-agent/.env`, and every MCP env file; (d) `scripts/fresh-start.sh` verification that reads the on-EntryPoint deposit balance via `cast call EntryPoint.balanceOf(paymaster)` after deploy and prints it; (e) 10 Foundry tests including a full `handleOps` integration test that proves the paymaster's deposit is debited and the bundler is reimbursed. What does NOT ship in this PR: wiring `paymasterAndData` into the userOp constructor inside `apps/a2a-agent/src/routes/onchain-redeem.ts`'s `/redeem-via-account` handler. That change is owned by a sibling sub-agent (Option A delegation refactor) and lands as a small follow-up after both PRs settle.

## 3. Exact code change for `/redeem-via-account`

Inside the `PackedUserOperation` construction in `apps/a2a-agent/src/routes/onchain-redeem.ts` (after Option A lands), replace `paymasterAndData: '0x'` with the v0.7 packed layout:

```ts
import { encodePacked } from 'viem'

// v0.7 EntryPoint paymasterAndData = address(20) || verificationGasLimit(uint128) || postOpGasLimit(uint128) || extra
const paymasterAndData = encodePacked(
  ['address', 'uint128', 'uint128'],
  [
    config.PAYMASTER_ADDRESS as `0x${string}`,
    100_000n,  // paymasterVerificationGasLimit — covers _validatePaymasterUserOp
    50_000n,   // paymasterPostOpGasLimit — accept-all returns empty context so this is unused
  ],
)

const userOp = {
  // ... existing fields ...
  paymasterAndData,
}
```

`config.PAYMASTER_ADDRESS` is the env var written by `scripts/deploy-local.sh` (see `apps/a2a-agent/.env`). The two gas limits are conservative dev values; profile them in `forge test`'s `test_handleOps_sponsors_userOp_through_paymaster` trace if tuning. No other userOp fields change.

## 4. Production hardening checklist

Before exposing the paymaster to public traffic: (1) call `paymaster.setDevMode(false)` from the owner key — this flips `_validatePaymasterUserOp` from accept-all to allow-list-only; (2) populate `_acceptList` via `paymaster.setAcceptedBatch(senders, true)` with the canonical set of legitimate smart-account senders (typically derived from `AgentAccountFactory` events); (3) decide whether to upgrade to a verifying-paymaster pattern (off-chain-signed `paymasterData` validated on-chain via ECDSA) before the allow-list grows beyond the gas budget — the current `_acceptList` is fine for hundreds of senders but not thousands; (4) wire monitoring on `entryPoint.balanceOf(paymaster)` with an alert below a runway threshold (e.g. 1 ETH ≈ 200k user-ops at 5 gwei + 100k gas/op) and an automated top-up runbook from a custody-segregated funding wallet; (5) custody plan for the paymaster owner key — this is a sensitive admin key (controls accept-list + can `withdrawTo` the entire deposit); production should hold it in AWS KMS (asymmetric ECC_SECG_P256K1, mirroring the K4 pattern in `docs/operations/kms-signer-setup.md`), never in a runtime `.env`.
