'use client'

import { useState } from 'react'
import { sendA2ATask, checkA2AHealth, fetchAgentCard } from '@/lib/actions/agent-communicate.action'

interface Props {
  agentName: string
  a2aEndpoint: string
  mcpServer: string
}

type Message = { role: 'user' | 'agent' | 'system'; content: string; timestamp: Date }

export function CommunicateClient({ agentName, a2aEndpoint, mcpServer }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [taskType, setTaskType] = useState('evaluate-trust')
  const [payload, setPayload] = useState('{}')
  const [sending, setSending] = useState(false)

  function addMessage(role: Message['role'], content: string) {
    setMessages(prev => [...prev, { role, content, timestamp: new Date() }])
  }

  async function handleHealthCheck() {
    addMessage('system', `Checking health at ${a2aEndpoint}/health...`)
    const result = await checkA2AHealth(a2aEndpoint)
    if (result.success) {
      addMessage('agent', JSON.stringify(result.data, null, 2))
    } else {
      addMessage('system', `Health check failed: ${result.error}`)
    }
  }

  async function handleAgentCard() {
    addMessage('system', `Fetching agent card from ${a2aEndpoint}/.well-known/agent.json...`)
    const result = await fetchAgentCard(a2aEndpoint)
    if (result.success) {
      addMessage('agent', JSON.stringify(result.data, null, 2))
    } else {
      addMessage('system', `Failed: ${result.error}`)
    }
  }

  async function handleSendTask(e: React.FormEvent) {
    e.preventDefault()
    if (!a2aEndpoint) return
    setSending(true)

    let parsedPayload: Record<string, unknown> = {}
    try { parsedPayload = JSON.parse(payload) } catch { parsedPayload = {} }

    addMessage('user', `Task: ${taskType}\n${JSON.stringify(parsedPayload, null, 2)}`)

    const result = await sendA2ATask({
      endpoint: a2aEndpoint,
      taskType,
      payload: parsedPayload,
    })

    if (result.success) {
      addMessage('agent', JSON.stringify(result.data, null, 2))
    } else {
      addMessage('system', `Error (${result.statusCode ?? 'unknown'}): ${result.error}`)
    }

    setSending(false)
  }

  return (
    <div>
      {/* Endpoints */}
      <div data-component="protocol-info" style={{ marginBottom: '1rem' }}>
        <dl>
          {a2aEndpoint && <><dt>A2A Endpoint</dt><dd style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{a2aEndpoint}</dd></>}
          {mcpServer && <><dt>MCP Server</dt><dd style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{mcpServer}</dd></>}
        </dl>
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
          <button onClick={handleHealthCheck} style={{ background: '#e0e0e0', color: '#1a1a2e', padding: '0.4rem 0.8rem', fontSize: '0.8rem' }} disabled={!a2aEndpoint}>
            Health Check
          </button>
          <button onClick={handleAgentCard} style={{ background: '#e0e0e0', color: '#1a1a2e', padding: '0.4rem 0.8rem', fontSize: '0.8rem' }} disabled={!a2aEndpoint}>
            Agent Card
          </button>
        </div>
      </div>

      {/* Message Log */}
      <div style={{
        background: '#fafafa', border: '1px solid #f0f1f3', borderRadius: 8,
        padding: '1rem', minHeight: 300, maxHeight: 500, overflow: 'auto', marginBottom: '1rem',
      }}>
        {messages.length === 0 ? (
          <p style={{ color: '#555', fontSize: '0.85rem', textAlign: 'center', paddingTop: '2rem' }}>
            Send a task or run a health check to start communicating with {agentName}
          </p>
        ) : (
          messages.map((msg, i) => (
            <div key={i} style={{
              marginBottom: '0.75rem', padding: '0.5rem 0.75rem',
              borderLeft: `3px solid ${msg.role === 'user' ? '#1565c0' : msg.role === 'agent' ? '#2e7d32' : '#616161'}`,
              background: msg.role === 'user' ? '#eff6ff' : msg.role === 'agent' ? '#f0fdf4' : '#ffffff',
              borderRadius: '0 4px 4px 0',
            }}>
              <div style={{ fontSize: '0.7rem', color: '#666', marginBottom: '0.25rem' }}>
                {msg.role === 'user' ? 'You' : msg.role === 'agent' ? agentName : 'System'} — {msg.timestamp.toLocaleTimeString()}
              </div>
              <pre style={{ fontSize: '0.8rem', color: '#4b5563', whiteSpace: 'pre-wrap', fontFamily: 'monospace', margin: 0 }}>
                {msg.content}
              </pre>
            </div>
          ))
        )}
      </div>

      {/* Send Task */}
      <form onSubmit={handleSendTask} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
        <div style={{ flex: '0 0 auto' }}>
          <label style={{ fontSize: '0.7rem', color: '#666', display: 'block', marginBottom: '0.25rem' }}>Task Type</label>
          <select value={taskType} onChange={e => setTaskType(e.target.value)}
            style={{ background: '#ffffff', border: '1px solid #e2e4e8', color: '#1a1a2e', padding: '0.5rem', borderRadius: 6, fontSize: '0.85rem' }}>
            <option value="evaluate-trust">evaluate-trust</option>
            <option value="discover-agents">discover-agents</option>
            <option value="submit-review">submit-review</option>
            <option value="custom">custom</option>
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: '0.7rem', color: '#666', display: 'block', marginBottom: '0.25rem' }}>Payload (JSON)</label>
          <input value={payload} onChange={e => setPayload(e.target.value)}
            placeholder='{"agentAddress": "0x..."}'
            style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.8rem' }} />
        </div>
        <button type="submit" disabled={sending || !a2aEndpoint} style={{ whiteSpace: 'nowrap' }}>
          {sending ? 'Sending...' : 'Send Task'}
        </button>
      </form>
    </div>
  )
}
