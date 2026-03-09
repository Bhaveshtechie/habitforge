'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AIChatWindow, type ChatMessage } from '@/components/chat/AIChatWindow'
import { PlanPreviewCard, type HabitPlan } from '@/components/habits/PlanPreviewCard'
import { apiRequest } from '@/lib/api'

interface AiPlanResponse {
  data: {
    habitId: string
    plan: HabitPlan
  }
}

interface ParseInputResponse {
  data: {
    goal: string
    why: string
    timeAvailable: string
    triedBefore: string
    isComplete: boolean
    followUp: string | null
  }
}

type PagePhase = 'chatting' | 'reviewing'

const OPENING_MESSAGE =
  `Hi! I'm your AI habit coach. To build you the best plan, tell me about the habit you want to create.\n\nFeel free to share as much as you'd like — the more context you give, the more personalised your plan will be. Here's what's helpful:\n\n1. What habit do you want to build?\n2. Why does this matter to you?\n3. How much time can you dedicate each day?\n4. Have you tried this before?`

function extractErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'object' && err !== null && 'error' in err) {
    return String((err as { error: string }).error)
  }
  return fallback
}

export default function NewHabitPage() {
  const router = useRouter()

  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: OPENING_MESSAGE },
  ])
  const [pagePhase, setPagePhase] = useState<PagePhase>('chatting')
  const [plan, setPlan] = useState<HabitPlan | null>(null)
  const [habitId, setHabitId] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isAccepting, setIsAccepting] = useState(false)
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [parsedContext, setParsedContext] = useState<ParseInputResponse['data'] | null>(null)

  async function generatePlan(
    context: ParseInputResponse['data'],
    allMessages: ChatMessage[],
  ) {
    setIsLoading(true)
    setError(null)

    try {
      const result = await apiRequest<AiPlanResponse>('/habits/ai-plan', {
        method: 'POST',
        body: JSON.stringify({
          goal: context.goal,
          context: {
            why: context.why,
            timeAvailable: context.timeAvailable,
            triedBefore: context.triedBefore,
          },
        }),
      })

      setPlan(result.data.plan)
      setHabitId(result.data.habitId)
      setPagePhase('reviewing')
    } catch (err: unknown) {
      setError(extractErrorMessage(err, 'Failed to generate plan. Please try again.'))
    } finally {
      setIsLoading(false)
    }
  }

  async function handleSubmit() {
    const trimmed = input.trim()
    if (!trimmed || isLoading) return

    const newUserMsg: ChatMessage = { role: 'user', content: trimmed }
    const updatedMessages: ChatMessage[] = [...messages, newUserMsg]
    setMessages(updatedMessages)
    setInput('')
    setIsLoading(true)
    setError(null)

    try {
      const parseResult = await apiRequest<ParseInputResponse>('/habits/parse-input', {
        method: 'POST',
        body: JSON.stringify({
          messages: updatedMessages.map((m) => ({ role: m.role, content: m.content })),
        }),
      })

      const parsed = parseResult.data
      setParsedContext(parsed)

      if (parsed.isComplete) {
        await generatePlan(parsed, updatedMessages)
      } else {
        const followUp = parsed.followUp ?? 'Could you share a bit more about the missing details above?'
        setMessages((prev) => [...prev, { role: 'assistant', content: followUp }])
        setIsLoading(false)
      }
    } catch (err: unknown) {
      setError(extractErrorMessage(err, 'Something went wrong. Please try again.'))
      setIsLoading(false)
    }
  }

  async function handleAccept() {
    if (!habitId) return
    setIsAccepting(true)
    setError(null)

    try {
      await apiRequest<unknown>(`/habits/${habitId}/activate`, { method: 'POST' })
      router.push('/dashboard')
    } catch (err: unknown) {
      setError(extractErrorMessage(err, 'Failed to activate habit. Please try again.'))
      setIsAccepting(false)
    }
  }

  async function handleRegenerate() {
    if (habitId) {
      try {
        await apiRequest<unknown>(`/habits/${habitId}`, { method: 'DELETE' })
      } catch {
        // Best-effort cleanup; proceed regardless
      }
    }
    setPlan(null)
    setHabitId('')
    setError(null)
    setPagePhase('chatting')
    if (parsedContext) {
      await generatePlan(parsedContext, messages)
    }
  }

  function handleEdit() {
    setPlan(null)
    setHabitId('')
    setError(null)
    setPagePhase('chatting')
  }

  const userMessageCount = messages.filter((m) => m.role === 'user').length
  const isInfoGathered = parsedContext?.isComplete ?? false

  return (
    <div className="flex flex-col">
      {/* Page header */}
      <div className="mb-5 flex items-center gap-3">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1 text-sm text-zinc-500 transition-colors hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
          Back
        </button>
        <span className="text-zinc-300 dark:text-zinc-600">·</span>
        <h1 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          {pagePhase === 'chatting' ? 'Create habit with AI' : 'Review your plan'}
        </h1>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-400">
          <svg
            className="mt-0.5 h-4 w-4 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
            />
          </svg>
          {error}
        </div>
      )}

      {/* Progress indicator (chat phase only) */}
      {pagePhase === 'chatting' && userMessageCount > 0 && (
        <div className="mb-4">
          <div className="flex items-center justify-between text-xs text-zinc-400 dark:text-zinc-500">
            <span>{isInfoGathered ? 'Building your plan…' : 'Gathering information'}</span>
            <span>
              {isInfoGathered
                ? 'Ready to generate'
                : userMessageCount === 1
                  ? 'Reply received'
                  : `${userMessageCount} replies`}
            </span>
          </div>
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
            <div
              className="h-full rounded-full bg-indigo-500 transition-all duration-700"
              style={{ width: isInfoGathered ? '100%' : `${Math.min(userMessageCount * 40, 80)}%` }}
            />
          </div>
        </div>
      )}

      {/* Main content */}
      {pagePhase === 'chatting' ? (
        <div
          className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
          style={{ height: 'calc(100vh - 18rem)', minHeight: '400px' }}
        >
          <AIChatWindow
            messages={messages}
            isLoading={isLoading}
            input={input}
            onInputChange={setInput}
            onSubmit={handleSubmit}
          />
        </div>
      ) : (
        plan && (
          <PlanPreviewCard
            plan={plan}
            onAccept={handleAccept}
            onRegenerate={handleRegenerate}
            onEdit={handleEdit}
            isAccepting={isAccepting}
          />
        )
      )}
    </div>
  )
}
