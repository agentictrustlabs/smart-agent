/**
 * GraphDB Client
 *
 * Low-level HTTP client for SPARQL query and update operations
 * against a GraphDB repository. All discovery SDK queries route
 * through this class.
 *
 * Timeouts: each request uses an AbortController so a slow GraphDB
 * (Cloudflare 524, slow upload, network hang) fails fast instead of
 * the dev server piling up sync attempts. Defaults can be overridden
 * via constructor config.
 */

import type { GraphDBConfig, SparqlResults } from './types'

const DEFAULT_QUERY_TIMEOUT_MS = 15_000
const DEFAULT_UPLOAD_TIMEOUT_MS = 15_000

export class GraphDBClient {
  private config: GraphDBConfig
  private queryTimeoutMs: number
  private uploadTimeoutMs: number

  constructor(config: GraphDBConfig & { queryTimeoutMs?: number; uploadTimeoutMs?: number }) {
    this.config = config
    this.queryTimeoutMs = config.queryTimeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS
    this.uploadTimeoutMs = config.uploadTimeoutMs ?? DEFAULT_UPLOAD_TIMEOUT_MS
  }

  /** Build an AbortSignal that fires after `ms`. */
  private timeoutSignal(ms: number): AbortSignal {
    const controller = new AbortController()
    setTimeout(() => controller.abort(new Error(`GraphDB request timed out after ${ms}ms`)), ms).unref?.()
    return controller.signal
  }

  /** Build Basic auth header value */
  private authHeader(): string {
    const creds = `${this.config.username}:${this.config.password}`
    // Buffer available in Node; btoa in browser — handle both
    const encoded = typeof Buffer !== 'undefined'
      ? Buffer.from(creds).toString('base64')
      : btoa(creds)
    return `Basic ${encoded}`
  }

  /** Repository endpoint URL */
  private repoUrl(): string {
    return `${this.config.baseUrl}/repositories/${this.config.repository}`
  }

  /**
   * Execute a SPARQL SELECT/ASK/CONSTRUCT query.
   * Returns parsed JSON results.
   */
  async query(sparql: string): Promise<SparqlResults> {
    const response = await fetch(this.repoUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/sparql-query',
        'Accept': 'application/sparql-results+json',
        'Authorization': this.authHeader(),
      },
      body: sparql,
      signal: this.timeoutSignal(this.queryTimeoutMs),
    })

    if (!response.ok) {
      const body = await response.text()
      throw new GraphDBError(`SPARQL query failed (${response.status}): ${body}`, response.status)
    }

    return response.json() as Promise<SparqlResults>
  }

  /**
   * Execute a SPARQL UPDATE (INSERT/DELETE).
   */
  async update(sparql: string): Promise<void> {
    const response = await fetch(`${this.repoUrl()}/statements`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/sparql-update',
        'Authorization': this.authHeader(),
      },
      body: sparql,
      signal: this.timeoutSignal(this.queryTimeoutMs),
    })

    if (!response.ok) {
      const body = await response.text()
      throw new GraphDBError(`SPARQL update failed (${response.status}): ${body}`, response.status)
    }
  }

  /**
   * Upload Turtle data to a named graph via Graph Store HTTP protocol.
   * Uses PUT to replace all data in the graph.
   *
   * Resilience:
   *   - Aborts each attempt at `uploadTimeoutMs` (default 15s).
   *   - Retries up to 2 times on 5xx (incl. Cloudflare 524) and on AbortErrors,
   *     with exponential backoff (3s, 9s). 4xx errors (auth / payload) fail fast.
   */
  async uploadTurtle(turtle: string, namedGraph: string): Promise<void> {
    const url = `${this.repoUrl()}/rdf-graphs/service?graph=${encodeURIComponent(namedGraph)}`
    const maxAttempts = 3
    let lastErr: unknown

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await fetch(url, {
          method: 'PUT',
          headers: {
            'Content-Type': 'text/turtle',
            'Authorization': this.authHeader(),
          },
          body: turtle,
          signal: this.timeoutSignal(this.uploadTimeoutMs),
        })
        if (response.ok) return
        const body = await response.text()
        // 4xx → fail fast; 5xx → retry.
        if (response.status >= 400 && response.status < 500) {
          throw new GraphDBError(`Turtle upload failed (${response.status}): ${body}`, response.status)
        }
        lastErr = new GraphDBError(`Turtle upload failed (${response.status})`, response.status)
      } catch (err) {
        // GraphDBError propagates already; AbortError/network-error → retry.
        if (err instanceof GraphDBError && err.status >= 400 && err.status < 500) throw err
        lastErr = err
      }
      if (attempt < maxAttempts) {
        const backoff = 3000 * Math.pow(3, attempt - 1) // 3s, 9s
        await new Promise(r => setTimeout(r, backoff))
      }
    }
    throw lastErr ?? new GraphDBError('Turtle upload failed after retries', 0)
  }

  /**
   * Check connectivity to the repository.
   */
  async ping(): Promise<boolean> {
    try {
      const result = await this.query('SELECT (1 AS ?ok) WHERE { }')
      return result.results.bindings.length > 0
    } catch {
      return false
    }
  }
}

export class GraphDBError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'GraphDBError'
    this.status = status
  }
}
