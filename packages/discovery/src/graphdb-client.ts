/**
 * GraphDB Client
 *
 * Low-level HTTP client for SPARQL query and update operations
 * against a GraphDB repository. All discovery SDK queries route
 * through this class.
 */

import type { GraphDBConfig, SparqlResults } from './types'

export class GraphDBClient {
  private config: GraphDBConfig

  constructor(config: GraphDBConfig) {
    this.config = config
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
    })

    if (!response.ok) {
      const body = await response.text()
      throw new GraphDBError(`SPARQL update failed (${response.status}): ${body}`, response.status)
    }
  }

  /**
   * Upload Turtle data to a named graph via Graph Store HTTP protocol.
   * Uses PUT to replace all data in the graph.
   */
  async uploadTurtle(turtle: string, namedGraph: string): Promise<void> {
    const url = `${this.repoUrl()}/rdf-graphs/service?graph=${encodeURIComponent(namedGraph)}`

    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'text/turtle',
        'Authorization': this.authHeader(),
      },
      body: turtle,
    })

    if (!response.ok) {
      const body = await response.text()
      throw new GraphDBError(`Turtle upload failed (${response.status}): ${body}`, response.status)
    }
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
