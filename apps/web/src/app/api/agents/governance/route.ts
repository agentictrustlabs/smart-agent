import { NextResponse } from 'next/server'
import { getPublicClient, getWalletClient } from '@/lib/contracts'
import { agentControlAbi } from '@smart-agent/sdk'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { action, agentAddress } = body

    const walletClient = getWalletClient()
    const publicClient = getPublicClient()
    const controlAddr = process.env.AGENT_CONTROL_ADDRESS as `0x${string}`

    if (!controlAddr) {
      return NextResponse.json({ success: false, error: 'AgentControl not deployed' })
    }

    if (action === 'initialize') {
      const { minOwners, quorum } = body
      const hash = await walletClient.writeContract({
        address: controlAddr,
        abi: agentControlAbi,
        functionName: 'initializeAgent',
        args: [agentAddress, BigInt(minOwners), BigInt(quorum)],
      })
      await publicClient.waitForTransactionReceipt({ hash })
      return NextResponse.json({ success: true })
    }

    if (action === 'addOwner') {
      const { newOwner } = body
      const hash = await walletClient.writeContract({
        address: controlAddr,
        abi: agentControlAbi,
        functionName: 'addOwner',
        args: [agentAddress, newOwner],
      })
      await publicClient.waitForTransactionReceipt({ hash })
      return NextResponse.json({ success: true })
    }

    if (action === 'setQuorum') {
      const { newQuorum } = body
      const hash = await walletClient.writeContract({
        address: controlAddr,
        abi: agentControlAbi,
        functionName: 'setQuorum',
        args: [agentAddress, BigInt(newQuorum)],
      })
      await publicClient.waitForTransactionReceipt({ hash })
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ success: false, error: 'Unknown action' })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed',
    })
  }
}
