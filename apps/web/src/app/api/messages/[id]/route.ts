import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db, schema } from '@/db'

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await db.update(schema.messages).set({ read: 1 }).where(eq(schema.messages.id, id))
  return NextResponse.json({ success: true })
}
