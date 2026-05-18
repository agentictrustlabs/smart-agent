/**
 * Person-MCP classification parser (Sprint 5 W3 — finding P1-2).
 *
 * Parses `@sa-*` JSDoc tags off person-mcp's two callable surfaces:
 *
 *   1. **HTTP routes** mounted on Hono (`apps/person-mcp/src/{index,
 *      ssi/api/*, auth/*}.ts`). Detected by `<router>.<method>('path', …)`
 *      calls. Each handler MUST carry a `@sa-route` JSDoc block.
 *
 *   2. **MCP tools** exported as object literals under
 *      `apps/person-mcp/src/tools/*.ts`. Detected by the `name: 'tool_name'`
 *      property on tool descriptors. Each tool MUST carry a `@sa-tool`
 *      JSDoc block.
 *
 * The shared concept — `@sa-*` tag parsing — reuses `parseTagBlock` from
 * `./route-classification-parser.ts` so the lexer is the single source of
 * truth.
 *
 * Tag set:
 *
 *   @sa-route        public | service-only | delegation-verified |
 *                    bootstrap | dev-only                          REQUIRED on HTTP routes
 *   @sa-tool         delegation-verified | service-only |
 *                    bootstrap | dev-only                          REQUIRED on MCP tools
 *   @sa-auth         none-system-scoped | service-hmac |
 *                    delegation-token | wallet-action-signature |
 *                    session-bearer                                REQUIRED
 *   @sa-rate-limit   none | <N>/<window>   (e.g. "60/min")         optional
 *   @sa-prod-gate    always | dev-only | feature-flag:<NAME>       optional (REQUIRED when route/tool = dev-only)
 *   @sa-validation   shape-check | json-schema | none-no-body |
 *                    none-path-params | wallet-action-canonical    REQUIRED on state-changing HTTP routes & write tools
 *   @sa-owner        <team-or-person>                              optional
 *   @sa-risk-tier    low | medium | high | sensitive               optional
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Extract every `@sa-foo bar` style tag from a single JSDoc block body.
 *
 * Kept in sync with `route-classification-parser.parseTagBlock` — the
 * lexer is identical (a regex over the JSDoc body with the gutter
 * stripped). The duplicate lives here because that function is not
 * exported from the existing parser; we don't modify the existing
 * parser as part of this lint addition.
 */
function parseTagBlock(blockBody: string): Map<string, string> {
  const out = new Map<string, string>()
  const cleaned = blockBody
    .split('\n')
    .map((l) => l.replace(/^\s*\*\s?/, ''))
    .join('\n')
  const re = /@sa-([a-z-]+)\s+([^\n@]+?)(?=\s*(?:@sa-|$))/gms
  let m: RegExpExecArray | null
  while ((m = re.exec(cleaned)) !== null) {
    const key = m[1].trim()
    const value = m[2].trim()
    if (key && value) out.set(key, value)
  }
  return out
}

// ─── Tag value enums ────────────────────────────────────────────────────

export const HTTP_ROUTE_KINDS = [
  'public',
  'service-only',
  'delegation-verified',
  'bootstrap',
  'dev-only',
] as const
export type HttpRouteKind = (typeof HTTP_ROUTE_KINDS)[number]

export const MCP_TOOL_KINDS = [
  'delegation-verified',
  'service-only',
  'bootstrap',
  'dev-only',
] as const
export type McpToolKind = (typeof MCP_TOOL_KINDS)[number]

export const PERSON_MCP_AUTH_KINDS = [
  'none-system-scoped',
  'service-hmac',
  'delegation-token',
  'wallet-action-signature',
  'session-bearer',
] as const
export type PersonMcpAuthKind = (typeof PERSON_MCP_AUTH_KINDS)[number]

export const PERSON_MCP_VALIDATION_KINDS = [
  'shape-check',
  'json-schema',
  'none-no-body',
  'none-path-params',
  'wallet-action-canonical',
] as const
export type PersonMcpValidationKind = (typeof PERSON_MCP_VALIDATION_KINDS)[number]

export const RISK_TIERS = ['low', 'medium', 'high', 'sensitive'] as const
export type RiskTier = (typeof RISK_TIERS)[number]

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'] as const
export type HttpMethod = (typeof HTTP_METHODS)[number]

/** Methods that MUST declare `@sa-validation`. */
const STATE_CHANGING_METHODS = new Set<HttpMethod>(['POST', 'PUT', 'PATCH', 'DELETE'])

// ─── Records ────────────────────────────────────────────────────────────

export interface HttpRouteTags {
  kind: 'http-route'
  route: HttpRouteKind
  auth: PersonMcpAuthKind
  rateLimit?: string
  prodGate?: string
  validation?: PersonMcpValidationKind
  owner?: string
  riskTier?: RiskTier
}

export interface McpToolTags {
  kind: 'mcp-tool'
  tool: McpToolKind
  auth: PersonMcpAuthKind
  rateLimit?: string
  prodGate?: string
  validation?: PersonMcpValidationKind
  owner?: string
  riskTier?: RiskTier
  /** True when the tool clearly mutates state (write tool) — heuristic
   *  derived from the symbol/name. Used to require @sa-validation. */
  isWrite: boolean
}

export interface HttpRouteRecord {
  filePath: string
  method: HttpMethod
  /** Hono path pattern as written in the source. */
  path: string
  /** Symbol the route is mounted on, e.g. `walletRoutes`. */
  router: string
  tags: HttpRouteTags
}

export interface McpToolRecord {
  filePath: string
  /** Tool name as exported, e.g. `get_profile`, `relationship:emit_edge`. */
  toolName: string
  /** Local symbol that holds the tool object, when detectable. */
  symbol: string | null
  tags: McpToolTags
}

export type PersonMcpRecord =
  | { kind: 'http-route'; record: HttpRouteRecord }
  | { kind: 'mcp-tool'; record: McpToolRecord }

export type PersonMcpParseResult =
  | { ok: true; record: PersonMcpRecord }
  | {
      ok: false
      filePath: string
      /** "<METHOD> <path>" for http, "<toolName>" for mcp. */
      symbol: string
      kind: 'http-route' | 'mcp-tool'
      errors: string[]
    }

// ─── Tag validation ─────────────────────────────────────────────────────

function validateCommonTags(
  tagMap: Map<string, string>,
  errors: string[],
): {
  auth?: PersonMcpAuthKind
  rateLimit?: string
  prodGate?: string
  validation?: PersonMcpValidationKind
  owner?: string
  riskTier?: RiskTier
} {
  const authRaw = tagMap.get('auth')
  let auth: PersonMcpAuthKind | undefined
  if (!authRaw) {
    errors.push('missing required tag: @sa-auth')
  } else if (!PERSON_MCP_AUTH_KINDS.includes(authRaw as PersonMcpAuthKind)) {
    errors.push(
      `invalid @sa-auth value "${authRaw}" — must be one of: ${PERSON_MCP_AUTH_KINDS.join(', ')}`,
    )
  } else {
    auth = authRaw as PersonMcpAuthKind
  }

  const rateLimit = tagMap.get('rate-limit')
  if (rateLimit && rateLimit !== 'none' && !/^\d+\/(s|sec|min|hour|day)$/.test(rateLimit)) {
    errors.push(
      `invalid @sa-rate-limit value "${rateLimit}" — expected "none" or "<N>/<window>" (e.g. "10/min")`,
    )
  }

  const prodGate = tagMap.get('prod-gate')
  if (
    prodGate &&
    prodGate !== 'always' &&
    prodGate !== 'dev-only' &&
    !/^feature-flag:[A-Z][A-Z0-9_]*$/.test(prodGate)
  ) {
    errors.push(
      `invalid @sa-prod-gate value "${prodGate}" — must be "always", "dev-only", or "feature-flag:<NAME>"`,
    )
  }

  const validation = tagMap.get('validation')
  if (validation && !PERSON_MCP_VALIDATION_KINDS.includes(validation as PersonMcpValidationKind)) {
    errors.push(
      `invalid @sa-validation value "${validation}" — must be one of: ${PERSON_MCP_VALIDATION_KINDS.join(', ')}`,
    )
  }

  const riskTier = tagMap.get('risk-tier')
  if (riskTier && !RISK_TIERS.includes(riskTier as RiskTier)) {
    errors.push(
      `invalid @sa-risk-tier value "${riskTier}" — must be one of: ${RISK_TIERS.join(', ')}`,
    )
  }

  return {
    auth,
    rateLimit,
    prodGate,
    validation: validation as PersonMcpValidationKind | undefined,
    owner: tagMap.get('owner'),
    riskTier: riskTier as RiskTier | undefined,
  }
}

export function validateHttpRouteTags(
  tagMap: Map<string, string>,
  method: HttpMethod,
): { tags: HttpRouteTags | null; errors: string[] } {
  const errors: string[] = []
  const routeRaw = tagMap.get('route')
  let route: HttpRouteKind | undefined
  if (!routeRaw) {
    errors.push('missing required tag: @sa-route')
  } else if (!HTTP_ROUTE_KINDS.includes(routeRaw as HttpRouteKind)) {
    errors.push(
      `invalid @sa-route value "${routeRaw}" — must be one of: ${HTTP_ROUTE_KINDS.join(', ')}`,
    )
  } else {
    route = routeRaw as HttpRouteKind
  }

  const common = validateCommonTags(tagMap, errors)

  // Cross-tag rules.
  if (route === 'dev-only' && !common.prodGate) {
    errors.push('@sa-route=dev-only requires @sa-prod-gate (e.g. "dev-only")')
  }
  if (STATE_CHANGING_METHODS.has(method) && !common.validation) {
    errors.push(
      `${method}: missing @sa-validation tag — must be one of: ${PERSON_MCP_VALIDATION_KINDS.join(', ')}`,
    )
  }

  if (errors.length > 0 || !route || !common.auth) {
    return { tags: null, errors }
  }

  return {
    tags: {
      kind: 'http-route',
      route,
      auth: common.auth,
      rateLimit: common.rateLimit,
      prodGate: common.prodGate,
      validation: common.validation,
      owner: common.owner,
      riskTier: common.riskTier,
    },
    errors: [],
  }
}

export function validateMcpToolTags(
  tagMap: Map<string, string>,
  isWrite: boolean,
): { tags: McpToolTags | null; errors: string[] } {
  const errors: string[] = []
  const toolRaw = tagMap.get('tool')
  let tool: McpToolKind | undefined
  if (!toolRaw) {
    errors.push('missing required tag: @sa-tool')
  } else if (!MCP_TOOL_KINDS.includes(toolRaw as McpToolKind)) {
    errors.push(
      `invalid @sa-tool value "${toolRaw}" — must be one of: ${MCP_TOOL_KINDS.join(', ')}`,
    )
  } else {
    tool = toolRaw as McpToolKind
  }

  const common = validateCommonTags(tagMap, errors)

  if (tool === 'dev-only' && !common.prodGate) {
    errors.push('@sa-tool=dev-only requires @sa-prod-gate (e.g. "dev-only")')
  }
  if (isWrite && !common.validation) {
    errors.push(
      `write tool: missing @sa-validation tag — must be one of: ${PERSON_MCP_VALIDATION_KINDS.join(', ')}`,
    )
  }

  if (errors.length > 0 || !tool || !common.auth) {
    return { tags: null, errors }
  }

  return {
    tags: {
      kind: 'mcp-tool',
      tool,
      auth: common.auth,
      rateLimit: common.rateLimit,
      prodGate: common.prodGate,
      validation: common.validation,
      owner: common.owner,
      riskTier: common.riskTier,
      isWrite,
    },
    errors: [],
  }
}

// ─── JSDoc lookup ───────────────────────────────────────────────────────

/**
 * Find the JSDoc block immediately preceding `offset` in `src`, allowing
 * only whitespace between the block's closing `*\/` and the target.
 */
function findLeadingJsDoc(src: string, offset: number): string | null {
  let i = offset - 1
  // skip whitespace
  while (i >= 0 && /\s/.test(src[i])) i--
  // expect `/` then `*` (end of block)
  if (i < 1 || src[i] !== '/' || src[i - 1] !== '*') return null
  // walk back to find matching `/**`
  let j = i - 2
  while (j >= 2) {
    if (src[j] === '*' && src[j - 1] === '*' && src[j - 2] === '/') {
      return src.slice(j + 1, i - 1)
    }
    j--
  }
  return null
}

// ─── HTTP route detection ───────────────────────────────────────────────

/**
 * Detect `<router>.<method>('path', …)` Hono route calls. Returns one
 * entry per call site. `router` is the symbol name (e.g. `walletRoutes`,
 * `app`); `method` is upper-cased.
 *
 * Note: this is a regex-based scanner (no AST). It only matches the
 * canonical Hono call shape. Method values are restricted to the HTTP
 * verbs we ship.
 */
interface HttpRouteCallSite {
  router: string
  method: HttpMethod
  path: string
  /** Offset of the leading-edge `<router>` identifier; used for JSDoc lookup. */
  offset: number
}

function findHttpRouteCallSites(src: string): HttpRouteCallSite[] {
  const out: HttpRouteCallSite[] = []
  const re =
    /\b([A-Za-z_$][A-Za-z0-9_$]*)\.(get|post|put|patch|delete|options|head)\s*\(\s*(['"`])([^'"`]+)\3/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    const router = m[1]
    // Skip obvious non-router targets (c.req, viem clients, etc.). Hono
    // routers in person-mcp are named with a `Routes` or `app` suffix.
    if (router === 'c' || router === 'req' || router === 'res') continue
    const method = m[2].toUpperCase() as HttpMethod
    if (!HTTP_METHODS.includes(method)) continue
    out.push({
      router,
      method,
      path: m[4],
      offset: m.index,
    })
  }
  return out
}

// ─── MCP tool detection ─────────────────────────────────────────────────

/**
 * Detect MCP tool declarations of the form:
 *
 *     const myTool = {
 *       name: 'tool_name',
 *       …
 *     }
 *
 * or inline within an exported tools object:
 *
 *     export const fooTools = {
 *       a_tool: {
 *         name: 'a_tool',
 *         …
 *       },
 *     }
 *
 * For each match we capture the `name:` site so the leading-JSDoc lookup
 * can attach to the *object literal opening brace* — which is where authors
 * put the doc when classifying a tool.
 */
interface McpToolSite {
  toolName: string
  /** Offset of the opening `{` of the tool's object literal. */
  literalOffset: number
  /** Local symbol if the tool is declared as `const X = { … }`. */
  symbol: string | null
}

function findMcpToolSites(src: string): McpToolSite[] {
  const out: McpToolSite[] = []
  // Strategy: locate every `name: '<id>'` whose preceding `{` we can find.
  // Then determine if that `{` is the body of `const X = {` or a property
  // assignment `key: {`. Either way the JSDoc rides immediately before the
  // opening `{`.
  const nameRe = /\bname\s*:\s*(['"])([A-Za-z0-9_:-]+)\1/g
  let m: RegExpExecArray | null
  while ((m = nameRe.exec(src)) !== null) {
    const toolName = m[2]
    // Walk back from m.index to find the nearest `{` that opens the tool
    // literal. The character at the `{` precedes any whitespace + the
    // name property.
    let i = m.index - 1
    let depth = 0
    let braceOffset = -1
    while (i >= 0) {
      const ch = src[i]
      if (ch === '}') depth++
      else if (ch === '{') {
        if (depth === 0) {
          braceOffset = i
          break
        }
        depth--
      }
      i--
    }
    if (braceOffset < 0) continue

    // Determine if this is the very-first property in the literal — we
    // require this to be sure the JSDoc above the `{` belongs to this
    // tool (and not to a sibling property whose value happens to contain
    // `name:`). A property is "very first" iff between `{` and the
    // `name:` site we see only whitespace.
    const between = src.slice(braceOffset + 1, m.index)
    if (!/^\s*$/.test(between)) continue

    // Locate the symbol name (if any) — pattern `const sym = {` or `sym = {`.
    let symbol: string | null = null
    // Look back over whitespace + `=` to find a const declaration.
    let k = braceOffset - 1
    while (k >= 0 && /\s/.test(src[k])) k--
    if (k >= 0 && src[k] === '=') {
      // Walk back over whitespace + identifier.
      let n = k - 1
      while (n >= 0 && /\s/.test(src[n])) n--
      const endId = n + 1
      while (n >= 0 && /[A-Za-z0-9_$]/.test(src[n])) n--
      const startId = n + 1
      if (startId < endId) symbol = src.slice(startId, endId)
    }
    out.push({ toolName, literalOffset: braceOffset, symbol })
  }
  return out
}

// ─── File walkers ───────────────────────────────────────────────────────

function listTsFilesRecursive(dir: string): string[] {
  const out: string[] = []
  function walk(d: string): void {
    let entries: string[]
    try {
      entries = readdirSync(d)
    } catch {
      return
    }
    for (const e of entries) {
      // Skip tests + generated.
      if (e === '__tests__' || e === 'node_modules' || e === 'dist') continue
      const full = join(d, e)
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        walk(full)
      } else if (e.endsWith('.ts') && !e.endsWith('.test.ts') && !e.endsWith('.d.ts')) {
        out.push(full)
      }
    }
  }
  walk(dir)
  return out.sort()
}

// ─── HTTP route parsing ─────────────────────────────────────────────────

/**
 * Parse one source file for HTTP routes. Returns a result per detected
 * `<router>.<method>(path, …)` call.
 */
export function parseHttpRoutesInFile(filePath: string, src: string): PersonMcpParseResult[] {
  const sites = findHttpRouteCallSites(src)
  const out: PersonMcpParseResult[] = []
  for (const s of sites) {
    const block = findLeadingJsDoc(src, s.offset)
    if (!block) {
      out.push({
        ok: false,
        filePath,
        symbol: `${s.method} ${s.path}`,
        kind: 'http-route',
        errors: [`no JSDoc classification block immediately above ${s.router}.${s.method.toLowerCase()}('${s.path}', …)`],
      })
      continue
    }
    const tagMap = parseTagBlock(block)
    if (!tagMap.has('route')) {
      out.push({
        ok: false,
        filePath,
        symbol: `${s.method} ${s.path}`,
        kind: 'http-route',
        errors: ['JSDoc lacks @sa-route tag (required on Hono HTTP route handlers)'],
      })
      continue
    }
    const { tags, errors } = validateHttpRouteTags(tagMap, s.method)
    if (!tags) {
      out.push({
        ok: false,
        filePath,
        symbol: `${s.method} ${s.path}`,
        kind: 'http-route',
        errors,
      })
      continue
    }
    out.push({
      ok: true,
      record: {
        kind: 'http-route',
        record: {
          filePath,
          method: s.method,
          path: s.path,
          router: s.router,
          tags,
        },
      },
    })
  }
  return out
}

// ─── MCP tool parsing ───────────────────────────────────────────────────

/**
 * Heuristic write detection on MCP tools. The tool's `name` is by
 * convention verb-led: `update_*`, `create_*`, `add_*`, `delete_*`,
 * `remove_*`, `revoke_*`, `grant_*`, `set_*`, `rotate_*`, `bump_*`,
 * `withdraw`, `submit`, `emit_*`, `*:emit_*`, `*:set_*`, `*:bump_*`,
 * `*:submit`, `*:draft`, `*:withdraw`, `*:clone`, `*:edit_pre_deadline`,
 * `mark_*`, `pin_*`, `unpin_*`, `toggle_*`, `log_*`, `express_*`,
 * `withdraw_*`, `upsert_*`, `resolve_*`, `register_*`.
 *
 * Read patterns: `get_*`, `list_*`, `*read*`. These are non-write.
 */
const READ_PREFIXES = ['get_', 'list_', 'read_']
const READ_INFIXES = [':read_', ':list_', ':list_outgoing']

export function isWriteToolName(toolName: string): boolean {
  for (const p of READ_PREFIXES) if (toolName.startsWith(p)) return false
  for (const i of READ_INFIXES) if (toolName.includes(i)) return false
  if (toolName.endsWith('read_self')) return false
  if (toolName.endsWith('list_for_member')) return false
  if (toolName.includes('_list_')) return false
  return true
}

/**
 * Resolve a JSDoc block for an MCP tool literal. Supports both shapes:
 *
 *   const fooTool = {                          ← block directly above `{`
 *     name: 'foo',
 *     …
 *   }
 *
 * and
 *
 *   export const tools = {
 *     /** @sa-tool … *\/
 *     foo: {                                   ← block above `foo:`, then
 *       name: 'foo',                             property key + colon
 *       …                                        between block and `{`
 *     },
 *   }
 *
 * In the second shape the parser walks past whitespace + a single identifier
 * + `:` before looking for the JSDoc terminator. This keeps author syntax
 * natural ("annotate the property, not the opening brace").
 */
function findToolJsDoc(src: string, literalOffset: number): string | null {
  // Try direct lookup first (works when the literal isn't a property value).
  const direct = findLeadingJsDoc(src, literalOffset)
  if (direct) return direct
  // Walk back past `:` or `=` then over the key/identifier (and an optional
  // `const`/`let`/`var` keyword) — JSDoc may sit above the declaration.
  let i = literalOffset - 1
  while (i >= 0 && /\s/.test(src[i])) i--
  if (i < 0) return null
  if (src[i] === ':') {
    // property-value form `key: {`
    i--
    while (i >= 0 && /\s/.test(src[i])) i--
    if (i < 0) return null
    if (src[i] === '"' || src[i] === "'") {
      const quote = src[i]
      i--
      while (i >= 0 && src[i] !== quote) i--
      if (i < 0) return null
      i--
    } else if (/[A-Za-z0-9_$:]/.test(src[i])) {
      while (i >= 0 && /[A-Za-z0-9_$:]/.test(src[i])) i--
    } else {
      return null
    }
    return findLeadingJsDoc(src, i + 1)
  }
  if (src[i] === '=') {
    // declaration form `const X = {`
    i--
    while (i >= 0 && /\s/.test(src[i])) i--
    // Walk back over the identifier.
    while (i >= 0 && /[A-Za-z0-9_$]/.test(src[i])) i--
    // `i` now points one char before the identifier (or -1). Walk back over
    // whitespace + optional `const`/`let`/`var` keyword.
    let j = i
    while (j >= 0 && /\s/.test(src[j])) j--
    let declStart: number
    if (j >= 4 && src.slice(j - 4, j + 1) === 'const') declStart = j - 4
    else if (j >= 2 && src.slice(j - 2, j + 1) === 'let') declStart = j - 2
    else if (j >= 2 && src.slice(j - 2, j + 1) === 'var') declStart = j - 2
    else declStart = i + 1
    return findLeadingJsDoc(src, declStart)
  }
  return null
}

export function parseMcpToolsInFile(filePath: string, src: string): PersonMcpParseResult[] {
  const sites = findMcpToolSites(src)
  const out: PersonMcpParseResult[] = []
  for (const s of sites) {
    const block = findToolJsDoc(src, s.literalOffset)
    if (!block) {
      out.push({
        ok: false,
        filePath,
        symbol: s.toolName,
        kind: 'mcp-tool',
        errors: [`no JSDoc classification block immediately above tool '${s.toolName}'`],
      })
      continue
    }
    const tagMap = parseTagBlock(block)
    if (!tagMap.has('tool')) {
      out.push({
        ok: false,
        filePath,
        symbol: s.toolName,
        kind: 'mcp-tool',
        errors: ['JSDoc lacks @sa-tool tag (required on MCP tools)'],
      })
      continue
    }
    const isWrite = isWriteToolName(s.toolName)
    const { tags, errors } = validateMcpToolTags(tagMap, isWrite)
    if (!tags) {
      out.push({
        ok: false,
        filePath,
        symbol: s.toolName,
        kind: 'mcp-tool',
        errors,
      })
      continue
    }
    out.push({
      ok: true,
      record: {
        kind: 'mcp-tool',
        record: {
          filePath,
          toolName: s.toolName,
          symbol: s.symbol,
          tags,
        },
      },
    })
  }
  return out
}

// ─── Public entrypoint ──────────────────────────────────────────────────

/**
 * Files that should be scanned for HTTP routes. We restrict to the
 * person-mcp app to keep the lint focused.
 */
const HTTP_ROUTE_SCAN_DIRS = [
  'apps/person-mcp/src/ssi/api',
  'apps/person-mcp/src/auth',
] as const

/** Files for MCP tool scanning. */
const MCP_TOOL_SCAN_DIRS = ['apps/person-mcp/src/tools'] as const

/** Single-file scan for HTTP routes at the top-level index.ts. */
const HTTP_ROUTE_SCAN_FILES = ['apps/person-mcp/src/index.ts'] as const

export interface ScanAll {
  httpRoutes: PersonMcpParseResult[]
  mcpTools: PersonMcpParseResult[]
}

export function scanPersonMcp(repoRoot: string): ScanAll {
  const httpRoutes: PersonMcpParseResult[] = []
  const mcpTools: PersonMcpParseResult[] = []

  // HTTP routes — directories first.
  for (const d of HTTP_ROUTE_SCAN_DIRS) {
    const abs = join(repoRoot, d)
    for (const f of listTsFilesRecursive(abs)) {
      const src = readFileSync(f, 'utf-8')
      const rel = relative(repoRoot, f)
      httpRoutes.push(...parseHttpRoutesInFile(rel, src))
    }
  }
  // HTTP routes — single files (index.ts).
  for (const f of HTTP_ROUTE_SCAN_FILES) {
    const abs = join(repoRoot, f)
    try {
      const src = readFileSync(abs, 'utf-8')
      httpRoutes.push(...parseHttpRoutesInFile(f, src))
    } catch {
      /* skip if file missing */
    }
  }
  // MCP tools.
  for (const d of MCP_TOOL_SCAN_DIRS) {
    const abs = join(repoRoot, d)
    for (const f of listTsFilesRecursive(abs)) {
      const src = readFileSync(f, 'utf-8')
      const rel = relative(repoRoot, f)
      mcpTools.push(...parseMcpToolsInFile(rel, src))
    }
  }
  return { httpRoutes, mcpTools }
}
