/**
 * ExecutionReceipt — canonical audit record produced for every action that
 * flows through the delegation fabric.
 *
 * Written by a2a-agent (the natural choke point — every redeem and every
 * MCP call passes through it). Stored in apps/a2a-agent/local.db's
 * `execution_audit` table.
 *
 * The schema is denormalized on purpose: each row should be readable in
 * isolation for forensics. JSON fields are kept small and stable.
 */
import type { Address, Hex } from 'viem'

export type ExecutionPathKind =
  | 'mcp-only'
  | 'stateless-redeem'
  | 'sub-delegated'
  | 'session-account'

export type ExecutionStatus = 'completed' | 'reverted' | 'denied' | 'pending'

export interface ExecutionReceipt {
  // ─── Identity ─────────────────────────────────────────────────
  /** Hash of the user's signed root delegation (D_root). */
  rootGrantHash: Hex
  /** A2A session identifier. */
  sessionId: string
  /** Session principal — EOA for stateless/sub-delegated, or
   *  SessionAgentAccount address for stateful sessions. */
  sessionPrincipal: Address

  // ─── Task ─────────────────────────────────────────────────────
  /** A2A task that initiated this chain. May be empty for legacy paths. */
  a2aTaskId: string

  // ─── Tool ─────────────────────────────────────────────────────
  mcpServer: string         // 'org-mcp', 'person-mcp', etc.
  mcpTool: string           // 'pool:create', 'round:set_awards_root', …
  mcpCallId: string         // unique per inbound MCP request

  // ─── Execution ────────────────────────────────────────────────
  executionPath: ExecutionPathKind
  /** Hash of the per-call sub-delegation (D_sub). Null on stateless paths. */
  toolGrantHash: Hex | null
  /** Leaf delegate — the EOA whose signature submitted the redeem.
   *  Null for mcp-only paths. */
  toolExecutor: Address | null
  /** Resolved on-chain target. Null for mcp-only. */
  target: Address | null
  /** 4-byte function selector. Null for mcp-only. */
  selector: Hex | null
  /** keccak256 of the calldata. Null for mcp-only. */
  callDataHash: Hex | null
  /** Decimal-string ETH value (wei). '0' for typed-attr writes. */
  valueWei: string

  // ─── Outcome ──────────────────────────────────────────────────
  /** Submitted on-chain transaction hash. Null when path doesn't reach chain. */
  txHash: Hex | null
  /** ERC-4337 UserOperation hash. Set when redeem routed via EntryPoint
   *  (Phase 3 stateful sessions). */
  userOpHash: Hex | null
  status: ExecutionStatus
  /** Free-text revert reason / denial code. Empty when status == completed. */
  errorReason: string

  // ─── Time ─────────────────────────────────────────────────────
  receivedAt: string        // ISO 8601 — when a2a-agent first saw the request
  finalizedAt: string | null  // ISO 8601 — null while pending
}

/** Compact projection used in API list responses. */
export interface ExecutionReceiptSummary {
  sessionId: string
  mcpTool: string
  status: ExecutionStatus
  txHash: Hex | null
  finalizedAt: string | null
}
