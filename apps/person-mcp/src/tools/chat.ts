import { randomUUID } from 'node:crypto'
import { eq, and } from 'drizzle-orm'
import { db } from '../db/index.js'
import { chatThreads, chatMessages } from '../db/schema.js'
import { requirePrincipal } from '../auth/principal-context.js'

export const chatTools = {
  create_thread: {
    name: 'create_thread',
    description: 'Create a new chat thread for the authenticated principal.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string', description: 'Delegation token' },
        title: { type: 'string', description: 'Thread title (optional)' },
      },
      required: ['token'],
    },
    handler: async (args: { token: string; title?: string }) => {
      const principal = await requirePrincipal(args.token, 'create_thread')
      const now = new Date().toISOString()

      const newThread = {
        id: randomUUID(),
        principal,
        title: args.title ?? null,
        metadata: null,
        createdAt: now,
        updatedAt: now,
      }

      db.insert(chatThreads).values(newThread).run()

      return { content: [{ type: 'text' as const, text: JSON.stringify({ thread: newThread }) }] }
    },
  },

  add_message: {
    name: 'add_message',
    description: 'Add a message to a chat thread (verifies thread belongs to the authenticated principal).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string', description: 'Delegation token' },
        threadId: { type: 'string', description: 'Thread ID' },
        role: {
          type: 'string',
          description: 'Message role',
          enum: ['user', 'assistant', 'system', 'tool'],
        },
        content: { type: 'string', description: 'Message content' },
      },
      required: ['token', 'threadId', 'role', 'content'],
    },
    handler: async (args: {
      token: string
      threadId: string
      role: string
      content: string
    }) => {
      const principal = await requirePrincipal(args.token, 'add_message')

      // Verify thread ownership
      const thread = db
        .select()
        .from(chatThreads)
        .where(
          and(
            eq(chatThreads.id, args.threadId),
            eq(chatThreads.principal, principal),
          ),
        )
        .all()

      if (thread.length === 0) {
        throw new Error('Thread not found or not owned by principal')
      }

      const now = new Date().toISOString()

      const newMessage = {
        id: randomUUID(),
        threadId: args.threadId,
        principal,
        role: args.role,
        content: args.content,
        metadata: null,
        createdAt: now,
      }

      db.insert(chatMessages).values(newMessage).run()

      // Update thread's updatedAt
      db.update(chatThreads)
        .set({ updatedAt: now })
        .where(
          and(
            eq(chatThreads.id, args.threadId),
            eq(chatThreads.principal, principal),
          ),
        )
        .run()

      return { content: [{ type: 'text' as const, text: JSON.stringify({ message: newMessage }) }] }
    },
  },

  list_threads: {
    name: 'list_threads',
    description: 'List all chat threads for the authenticated principal.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string', description: 'Delegation token' },
      },
      required: ['token'],
    },
    handler: async (args: { token: string }) => {
      const principal = await requirePrincipal(args.token, 'list_threads')

      const rows = db
        .select()
        .from(chatThreads)
        .where(eq(chatThreads.principal, principal))
        .all()

      return { content: [{ type: 'text' as const, text: JSON.stringify({ threads: rows }) }] }
    },
  },

  get_thread: {
    name: 'get_thread',
    description: 'Get a chat thread with all its messages (verifies ownership).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string', description: 'Delegation token' },
        threadId: { type: 'string', description: 'Thread ID' },
      },
      required: ['token', 'threadId'],
    },
    handler: async (args: { token: string; threadId: string }) => {
      const principal = await requirePrincipal(args.token, 'get_thread')

      // Verify thread ownership
      const thread = db
        .select()
        .from(chatThreads)
        .where(
          and(
            eq(chatThreads.id, args.threadId),
            eq(chatThreads.principal, principal),
          ),
        )
        .all()

      if (thread.length === 0) {
        throw new Error('Thread not found or not owned by principal')
      }

      // Get messages — scoped to principal as well
      const messages = db
        .select()
        .from(chatMessages)
        .where(
          and(
            eq(chatMessages.threadId, args.threadId),
            eq(chatMessages.principal, principal),
          ),
        )
        .all()

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ thread: thread[0], messages }),
          },
        ],
      }
    },
  },
}
