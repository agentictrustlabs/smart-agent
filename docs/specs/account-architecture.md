# Account Architecture: EOA, ERC-4337, and Delegation

## Overview

Every agent in the Smart Agent system is an **ERC-4337 smart account** (AgentAccount) controlled by one or more **EOA wallets** (Externally Owned Accounts). The smart account is the agent's on-chain identity — its address never changes, even when the implementation is upgraded or owners are added/removed.

This document explains how these pieces fit together: who can sign, who can execute, how the EntryPoint/bundler/paymaster flow works, and how the DelegationManager fits into the execution model.

## The Two Layers

```
┌─────────────────────────────────────────────────────────────────┐
│                        EOA Layer                                 │
│  "Who are you?"                                                  │
│                                                                  │
│  EOA wallets hold private keys. They sign messages.              │
│  They are the humans (or servers) behind the agent.              │
│                                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐                   │
│  │ Alice's  │  │  Bob's   │  │   Server     │                   │
│  │ MetaMask │  │ MetaMask │  │  (Deployer)  │                   │
│  │ 0xAlic.. │  │ 0xBob0.. │  │  0xf39F..    │                   │
│  └────┬─────┘  └────┬─────┘  └──────┬───────┘                   │
│       │              │               │                           │
│       │    owners (multi-sig set)     │                           │
│       └──────────────┼───────────────┘                           │
│                      ▼                                           │
├─────────────────────────────────────────────────────────────────┤
│                   Smart Account Layer                             │
│  "What can you do?"                                              │
│                                                                  │
│  The ERC-4337 smart account IS the agent.                        │
│  It has its own address, holds assets, and executes calls.       │
│                                                                  │
│  ┌──────────────────────────────────────────────────────┐        │
│  │              AgentAccount (Proxy)                 │        │
│  │              0x9242Fef0...                            │        │
│  │                                                      │        │
│  │  _owners: {Alice, Bob, Server}                       │        │
│  │  _delegationManager: 0xDM01...                       │        │
│  │  _entryPoint: 0xEP07...                              │        │
│  │                                                      │        │
│  │  execute(target, value, data)                         │        │
│  │    allowed callers:                                   │        │
│  │      ✓ EntryPoint (ERC-4337 UserOp)                  │        │
│  │      ✓ address(this) (self-call)                     │        │
│  │      ✓ DelegationManager (ERC-7710)                  │        │
│  └──────────────────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────────────────┘
```

## Multi-Sig Owner Model

### How owners are set

When the factory deploys a new agent, `initialize(owner, serverSigner, dm)` is called:

```
AgentAccountFactory.createAccount(userEOA, salt)
    │
    ├─ Deploys ERC1967Proxy with initData:
    │    initialize(
    │      userEOA,        ← primary owner (the user's MetaMask wallet)
    │      serverSigner,   ← co-owner (the deployer/server EOA)
    │      dm              ← authorized DelegationManager
    │    )
    │
    └─ Result: Agent account with 2 owners
         _owners = { userEOA: true, serverSigner: true }
         _ownerCount = 2
```

### What owners can do

| Action | Who can do it | How |
|--------|--------------|-----|
| Sign a UserOperation | Any owner's EOA | Signs `userOpHash` with private key |
| Sign a delegation | Any owner's EOA | Signs delegation hash, validated via ERC-1271 |
| Set DelegationManager | Any owner OR self | Direct call to `setDelegationManager()` |
| Add/remove owners | Account itself only | Via UserOp → EntryPoint → `execute(addOwner(...))` |
| Upgrade implementation | Account itself only | Via UserOp → `upgradeToAndCall(newImpl)` |

### Why the server is a co-owner

In the current server-relay architecture, the server (deployer EOA) submits all transactions. For delegation signing, the server needs to be in the `_owners` set because:

1. Server signs a delegation hash with its private key
2. DelegationManager calls `agent.isValidSignature(hash, signature)` (ERC-1271)
3. The agent recovers the signer from the signature
4. The agent checks `_owners[recovered]` — server must be in this set

```
Server signs delegation hash
    │
    ▼
DelegationManager.hashDelegation(d) → hash
DelegationManager._validateSignature(agent, hash, sig)
    │
    ▼
agent.isValidSignature(hash, sig)  ← ERC-1271
    │
    ├─ ethSignedHash = toEthSignedMessageHash(hash)
    ├─ recovered = ECDSA.recover(ethSignedHash, sig)
    └─ return _owners[recovered] ? 0x1626ba7e : 0xffffffff
```

When users submit transactions directly (Sepolia with bundler), the server co-owner becomes unnecessary. The user's EOA signs everything.

## ERC-4337 Flow

### Components

```
┌──────────┐     ┌──────────┐     ┌────────────┐     ┌───────────────┐
│  User's  │     │ Bundler  │     │ EntryPoint │     │ AgentRoot-    │
│  EOA     │     │ Service  │     │ (v0.7)     │     │ Account       │
│          │     │          │     │            │     │               │
│ Signs    │     │ Aggregates│    │ Validates  │     │ Executes      │
│ UserOps  │────>│ & submits │───>│ & calls    │────>│ the call      │
└──────────┘     └──────────┘     └────────────┘     └───────────────┘
                                        │
                                        ▼
                                  ┌────────────┐
                                  │ Paymaster  │
                                  │            │
                                  │ Pays gas   │
                                  │ for the    │
                                  │ UserOp     │
                                  └────────────┘
```

### Step by step

**Step 1: User constructs a UserOperation**

```
PackedUserOperation {
  sender:           0x9242...  (agent smart account address)
  nonce:            0          (from agent.getNonce())
  initCode:         0x         (empty — account already deployed)
  callData:         agent.execute(target, value, data)  (what to do)
  accountGasLimits: packed(verificationGas, callGas)
  preVerificationGas: ...
  gasFees:          packed(maxFeePerGas, maxPriorityFeePerGas)
  paymasterAndData: paymaster address + paymaster-specific data
  signature:        EOA signs userOpHash
}
```

**Step 2: User's EOA signs the UserOp**

The user's wallet (MetaMask) signs `keccak256(userOpHash)` with `eth_sign` or `personal_sign`. The signature goes in the `signature` field of the UserOp.

**Step 3: UserOp is sent to a Bundler**

The bundler (Pimlico, Alchemy, Stackup, etc.) receives the UserOp via JSON-RPC (`eth_sendUserOperation`). The bundler:
- Validates the UserOp format
- Simulates it to check gas estimates
- Bundles multiple UserOps into a single transaction
- Submits to the EntryPoint contract

**Step 4: EntryPoint validates**

```solidity
EntryPoint.handleOps(ops, payable(beneficiary))
    │
    ├─ For each UserOp:
    │   ├─ Call agent._validateSignature(userOp, userOpHash)
    │   │    └─ Recovers signer, checks _owners[signer]
    │   │    └─ Returns 0 (valid) or 1 (invalid)
    │   │
    │   ├─ If paymasterAndData set:
    │   │    └─ Call paymaster.validatePaymasterUserOp(userOp, userOpHash, maxCost)
    │   │    └─ Paymaster decides whether to sponsor gas
    │   │
    │   └─ If validation passes:
    │        └─ Call agent.execute(target, value, data)
    │             └─ _requireForExecute() checks msg.sender == entryPoint ✓
    │             └─ Forwards call to target contract
    │
    └─ EntryPoint handles gas accounting and refunds
```

**Step 5: Agent executes**

The agent's `execute()` function runs the actual call. `msg.sender` in the target contract is the agent's smart account address — not the user's EOA, not the bundler, not the EntryPoint.

### Current vs Future

| | Current (Dev/Anvil) | Future (Sepolia/Mainnet) |
|---|---|---|
| Who signs | Server EOA (deployer) | User's EOA (MetaMask) |
| Who submits tx | Server via `writeContract` | Bundler via `eth_sendUserOperation` |
| Who pays gas | Server EOA (has Anvil ETH) | Paymaster contract (sponsors gas) |
| `msg.sender` to agent | Server EOA (direct call) | EntryPoint (via UserOp) |
| `msg.sender` in target | Server EOA or DelegationManager | Agent smart account (via execute) |

## Paymaster

A Paymaster is a contract that **pays gas on behalf of users** so they don't need ETH in their wallet.

```
User (no ETH) → signs UserOp → Bundler → EntryPoint
                                              │
                                  ┌───────────┴───────────┐
                                  │      Paymaster        │
                                  │                       │
                                  │  validatePaymasterOp  │
                                  │    "Should I pay for   │
                                  │     this UserOp?"      │
                                  │                       │
                                  │  Options:              │
                                  │  • Sponsored: free     │
                                  │  • ERC-20: pay in USDC │
                                  │  • Verifying: check    │
                                  │    off-chain approval  │
                                  └───────────────────────┘
```

**We don't use a paymaster yet.** On local Anvil, the server pays gas directly. On Sepolia, we'd deploy a Verifying Paymaster that sponsors UserOps for registered agents.

No contract changes are needed — the agent's `_requireForExecute` already allows the EntryPoint, and the paymaster only interacts with the EntryPoint, not the agent directly.

## Bundler

A Bundler is an **off-chain service** that:
1. Receives UserOperations from users via JSON-RPC
2. Validates them (simulation, gas checks)
3. Bundles multiple UserOps into a single `handleOps` transaction
4. Submits to the EntryPoint
5. Earns the gas refund as profit

```
User A ──UserOp──┐
                  │
User B ──UserOp──┼──→ Bundler ──→ EntryPoint.handleOps([opA, opB, opC])
                  │
User C ──UserOp──┘
```

**We don't use a bundler yet.** On local Anvil, the server calls contracts directly. On Sepolia, we'd point to a bundler service (Pimlico, Alchemy) and construct UserOps in the web app instead of direct `writeContract` calls.

## DelegationManager Execution Path

The DelegationManager provides a **third way** to execute calls through the agent, alongside the EntryPoint and self-calls. This is the ERC-7710 pattern.

### Why three execution paths?

```
                        AgentAccount
                    _requireForExecute()
                              │
              ┌───────────────┼───────────────┐
              │               │               │
        EntryPoint       address(this)    DelegationManager
         (4337)           (self-call)        (7710)
              │               │               │
     "User submitted     "Account         "A delegate is
      a UserOp signed     calling          acting on behalf
      by an owner"        itself"          of this account"
```

| Path | When used | Who initiates | Signature check |
|------|----------|---------------|-----------------|
| **EntryPoint** | User submits UserOp | User's EOA signs UserOp | `_validateSignature(userOp, hash)` — recovers signer, checks `_owners` |
| **Self-call** | Account calls itself (e.g., batch execute) | Account's own execute() | Already inside the account — no sig needed |
| **DelegationManager** | Delegate redeems a delegation | Anyone with a signed delegation | DM calls `isValidSignature(hash, sig)` on the agent — ERC-1271 checks `_owners` |

### DelegationManager flow in detail

```
Caller (deployer)
    │
    │ redeemDelegation(delegations[], target, value, data)
    ▼
DelegationManager
    │
    ├─ 1. VALIDATE DELEGATION
    │   ├─ Check not revoked
    │   ├─ Check delegate == msg.sender (deployer)
    │   ├─ Check authority chain (ROOT or parent hash)
    │   └─ Validate signature:
    │       │
    │       │ delegator = agent smart account (has code)
    │       │ → ERC-1271 path:
    │       │
    │       ▼
    │   agent.isValidSignature(delegationHash, signature)
    │       │
    │       ├─ ethSignedHash = toEthSignedMessageHash(delegationHash)
    │       ├─ recovered = ECDSA.recover(ethSignedHash, signature)
    │       ├─ Check: _owners[recovered] == true
    │       └─ Return: 0x1626ba7e (valid) or 0xffffffff (invalid)
    │
    ├─ 2. ENFORCE CAVEATS (beforeHook on each enforcer)
    │   ├─ TimestampEnforcer: block.timestamp in [validAfter, validUntil]?
    │   ├─ AllowedMethodsEnforcer: calldata[:4] in allowed selectors?
    │   └─ AllowedTargetsEnforcer: target in allowed addresses?
    │
    ├─ 3. EXECUTE THROUGH AGENT
    │   │
    │   │ agent.execute(target, value, data)
    │   │
    │   │ _requireForExecute():
    │   │   msg.sender == _delegationManager ✓
    │   │
    │   └─► target receives call with msg.sender = agent address
    │
    └─ 4. AFTER-HOOKS (reverse order)
        └─ Each enforcer's afterHook() — post-execution validation
```

### Signature validation: who signed what

The key insight is that **multiple EOAs can sign on behalf of the same smart account**. The smart account doesn't care which owner signed — it just checks that the recovered signer is in its `_owners` set.

```
Delegation signed by Server EOA (0xf39F...)
                         │
                         ▼
              ┌──────────────────────┐
              │  AgentAccount    │
              │  _owners:            │
              │    Alice EOA  ✓      │
              │    Server EOA ✓  ◄── signer is here → valid
              │                      │
              │  isValidSignature()  │
              │    recover(hash,sig) │
              │    → 0xf39F...       │
              │    _owners[0xf39F]   │
              │    → true            │
              │    → return magic ✓  │
              └──────────────────────┘
```

This is why the server can sign delegations on behalf of any agent it co-owns. It's also why adding a co-owner via invite is significant — it gives that person's EOA signing authority over the agent.

## AgentControl: Governance Layer

For agents that need **quorum-based multi-sig** (e.g., an organization agent with a board), the AgentControl contract adds a proposal/approval layer on top of the raw owner set.

```
                AgentControl (Governance)
                ┌───────────────────────────────┐
                │  GovernanceConfig:              │
                │    minOwners: 3                 │
                │    quorum: 2                    │
                │                                │
                │  Owners: [Alice, Bob, Carol]    │
                │                                │
                │  Proposal #1:                   │
                │    action: OWNER_CHANGE          │
                │    data: addOwner(Dave)          │
                │    approvals: 1 / 2 needed       │
                │    status: PENDING               │
                └───────────────────────────────┘
                         │
                         │ When quorum reached:
                         │ execute the action
                         ▼
                AgentAccount.addOwner(Dave)
```

| Concept | AgentAccount (raw) | AgentControl (governance) |
|---------|----------------------|--------------------------|
| Who can act | Any single owner | Quorum of owners |
| Adding owners | Direct call (onlySelf) | Proposal → approvals → execute |
| Threshold | 1-of-N | M-of-N (configurable) |
| Bootstrap | Immediate | `isBootstrap` until minOwners met |

## Proxy Architecture (UUPS)

The agent address is permanent. The implementation behind it can be upgraded.

```
      User calls 0x9242...
              │
              ▼
    ┌─────────────────────┐
    │   ERC1967Proxy      │     ← permanent address (the agent's identity)
    │   0x9242Fef0...     │
    │                     │
    │   Storage:          │     ← state lives here (owners, DM, etc.)
    │     _owners         │
    │     _ownerCount     │
    │     _delegationMgr  │
    │                     │
    │   delegatecall ─────┼──→  ┌─────────────────────┐
    │                     │     │  AgentAccount    │  ← implementation
    │                     │     │  v2.0.0              │     (upgradeable)
    └─────────────────────┘     │                     │
                                │  execute()          │
                                │  isValidSignature() │
                                │  addOwner()         │
                                │  upgradeToAndCall()  │
                                └─────────────────────┘

    To upgrade: agent.execute(
      agent,  // target = self
      0,
      abi.encodeCall(upgradeToAndCall, (newImpl, ""))
    )
    
    Only callable via: EntryPoint (UserOp) or self-call
    The _authorizeUpgrade check: onlySelf
```

## Factory Deployment

```
AgentAccountFactory
    │
    │ constructor(entryPoint, delegationManager, serverSigner)
    │   └─ Creates singleton AgentAccount implementation
    │
    │ createAccount(owner, salt)
    │   │
    │   ├─ Compute CREATE2 address (deterministic)
    │   │   initData = initialize(owner, serverSigner, delegationManager)
    │   │   address = keccak256(0xff | factory | salt | keccak256(proxyBytecode + initData))
    │   │
    │   ├─ If code exists at address → return existing (idempotent)
    │   │
    │   └─ Deploy new ERC1967Proxy
    │       ├─ Points to implementation singleton
    │       ├─ Calls initialize(owner, serverSigner, delegationManager)
    │       │    ├─ _owners[owner] = true          (user's EOA)
    │       │    ├─ _owners[serverSigner] = true   (deployer EOA)
    │       │    └─ _delegationManager = dm
    │       └─ Emit AgentAccountCreated(address, owner, salt)
    │
    │ getAddress(owner, salt) → deterministic address (view, no deployment)
```

## Complete Picture: All Execution Paths

```
                                    ┌─────────────────────────────────┐
                                    │       AgentAccount          │
                                    │       (ERC-4337 Smart Account)  │
                                    │                                 │
                                    │  _owners: {Alice, Server}       │
                                    │  _delegationManager: 0xDM..     │
                                    │  _entryPoint: 0xEP..            │
                                    │                                 │
                                    │  execute(target, value, data)   │
                                    │    _requireForExecute():        │
                                    │      ✓ msg.sender == EntryPoint │
                                    │      ✓ msg.sender == self       │
                                    │      ✓ msg.sender == DM         │
                                    └──────────┬──────────────────────┘
                                               │
                    ┌──────────────────────────┼──────────────────────────┐
                    │                          │                          │
         ┌──────────▼──────────┐    ┌──────────▼──────────┐   ┌──────────▼──────────┐
         │  Path 1: ERC-4337   │    │  Path 2: Direct     │   │  Path 3: ERC-7710   │
         │  (Future: Sepolia)  │    │  (Current: Anvil)   │   │  (Delegation)       │
         │                     │    │                     │   │                     │
         │  User EOA           │    │  Server EOA         │   │  Server EOA         │
         │    │ signs UserOp   │    │    │ writeContract   │   │    │ redeemDeleg.   │
         │    ▼                │    │    ▼                │   │    ▼                │
         │  Bundler            │    │  Target contract    │   │  DelegationManager  │
         │    │ submits        │    │  (direct call)      │   │    │ validate sig   │
         │    ▼                │    │                     │   │    │ check caveats  │
         │  EntryPoint         │    │  msg.sender =       │   │    │ call execute() │
         │    │ validates sig  │    │    server EOA       │   │    ▼                │
         │    │ calls agent    │    │                     │   │  Agent.execute()    │
         │    ▼                │    │                     │   │    │                │
         │  Agent.execute()    │    │                     │   │    ▼                │
         │    │                │    │                     │   │  Target contract    │
         │    ▼                │    │                     │   │  msg.sender = agent │
         │  Target contract    │    │                     │   │                     │
         │  msg.sender = agent │    │                     │   │                     │
         └─────────────────────┘    └─────────────────────┘   └─────────────────────┘

         Paymaster pays gas         Server pays gas           Server pays gas
         User needs no ETH          Server needs ETH          Server needs ETH
         Most decentralized         Simplest (dev mode)       Delegation-authorized
```

## Standards Compliance

| Standard | What it covers | Our implementation |
|----------|---------------|-------------------|
| **ERC-4337** | Account abstraction, UserOp, EntryPoint, Paymaster | AgentAccount extends BaseAccount, validates packed UserOps |
| **ERC-1271** | Smart account signature validation | `isValidSignature()` checks `_owners[recovered]` |
| **ERC-1967** | Proxy storage slots | ERC1967Proxy used by factory |
| **ERC-1822** | UUPS upgradeable proxies | `UUPSUpgradeable` with `_authorizeUpgrade(onlySelf)` |
| **EIP-712** | Typed structured data signing | DelegationManager uses EIP-712 for delegation hashes |
| **ERC-7710** | Smart contract delegation | DelegationManager with caveat enforcers, execute-through-delegator |
