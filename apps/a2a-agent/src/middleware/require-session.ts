import { createMiddleware } from 'hono/factory'
import { eq, and } from 'drizzle-orm'
import { db } from '../db'
import { sessions } from '../db/schema'

type SessionRow = typeof sessions.$inferSelect

// Extend Hono context variables
declare module 'hono' {
  interface ContextVariableMap {
    session: SessionRow
  }
}

export const requireSession = createMiddleware(async (c, next) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid Authorization header' }, 401)
  }

  const token = authHeader.slice(7)

  const [sessionRow] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, token), eq(sessions.status, 'active')))
    .limit(1)

  if (!sessionRow) {
    return c.json({ error: 'Invalid or expired session token' }, 401)
  }

  // Check expiry
  if (new Date(sessionRow.expiresAt) < new Date()) {
    return c.json({ error: 'Session expired' }, 401)
  }

  c.set('session', sessionRow)
  await next()
})
