export interface HabitPhase {
  phaseNumber: number
  title: string
  startDay: number
  endDay: number
  dailyTarget: string
  milestone: string
}

interface PhaseTimelineProps {
  phases: HabitPhase[]
}

const PHASE_COLORS = [
  'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
  'bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300',
  'bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300',
  'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300',
]

export function PhaseTimeline({ phases }: PhaseTimelineProps) {
  return (
    <div className="space-y-0">
      {phases.map((phase, i) => {
        const colorClass = PHASE_COLORS[i % PHASE_COLORS.length]
        const isLast = i === phases.length - 1

        return (
          <div key={phase.phaseNumber} className="relative flex gap-4">
            {/* Timeline spine */}
            <div className="flex flex-col items-center">
              <div
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${colorClass}`}
              >
                {phase.phaseNumber}
              </div>
              {!isLast && (
                <div className="mt-1 w-px flex-1 bg-zinc-200 dark:bg-zinc-700" style={{ minHeight: '1.5rem' }} />
              )}
            </div>

            {/* Content */}
            <div className={`${isLast ? 'pb-0' : 'pb-5'} min-w-0 flex-1`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  {phase.title}
                </span>
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                  Day {phase.startDay}–{phase.endDay}
                </span>
              </div>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{phase.dailyTarget}</p>
              <p className="mt-1 flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400">
                <svg
                  className="h-3.5 w-3.5 shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M7.73 9.728a6.726 6.726 0 002.748 1.35m8.272-6.842V4.5c0 2.108-.966 3.99-2.48 5.228m2.48-5.492a46.32 46.32 0 012.916.52 6.003 6.003 0 01-5.395 4.972m0 0a6.726 6.726 0 01-2.749 1.35m0 0a6.772 6.772 0 01-3.044 0" />
                </svg>
                {phase.milestone}
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
