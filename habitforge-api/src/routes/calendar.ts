import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { verifyJWT } from '../middleware/verifyJWT'
import { pool } from '../db/pool'

function getUserId(req: Request): string | null {
  const user = (req as Request & { user?: { id: string; email: string } }).user
  return user?.id ?? null
}

const router: Router = Router()

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/

const calendarQuerySchema = z.object({
  from: z.string().regex(DATE_REGEX, 'from must be YYYY-MM-DD'),
  to: z.string().regex(DATE_REGEX, 'to must be YYYY-MM-DD'),
})

interface HabitCalendarRow {
  id: string
  title: string
  scheduled_time: string | null
  frequency: string
  custom_days: string[] | null
  completed_dates: string[] | null
}

interface TaskCalendarRow {
  id: string
  title: string
  due_date: string | null
  due_time: string | null
  status: string
  priority: string
  habit_id: string | null
}

// ─── GET /calendar ────────────────────────────────────────────────────────────

router.get('/', verifyJWT, async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req)
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' })
    return
  }

  const parsed = calendarQuerySchema.safeParse(req.query)
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    return
  }

  const { from, to } = parsed.data

  const fromDate = new Date(from)
  const toDate = new Date(to)

  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    res.status(400).json({ error: 'Invalid date values', code: 'INVALID_DATE' })
    return
  }

  if (toDate < fromDate) {
    res.status(400).json({ error: '`to` must be on or after `from`', code: 'INVALID_DATE_RANGE' })
    return
  }

  const diffDays = Math.floor((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24))
  if (diffDays > 90) {
    res.status(400).json({ error: 'Date range must not exceed 90 days', code: 'DATE_RANGE_TOO_LARGE' })
    return
  }

  try {
    const [habitsResult, tasksResult] = await Promise.all([
      pool.query<HabitCalendarRow>(
        `SELECT h.id, h.title, h.scheduled_time, h.frequency, h.custom_days,
                array_agg(hl.log_date) FILTER (WHERE hl.log_date IS NOT NULL AND hl.is_undone = false) AS completed_dates
         FROM habits h
         LEFT JOIN habit_logs hl
           ON hl.habit_id = h.id
           AND hl.log_date BETWEEN $2 AND $3
         WHERE h.user_id = $1 AND h.status = 'active'
         GROUP BY h.id`,
        [userId, from, to]
      ),
      pool.query<TaskCalendarRow>(
        `SELECT id, title, due_date, due_time, status, priority, habit_id
         FROM tasks
         WHERE user_id = $1
           AND due_date BETWEEN $2 AND $3
           AND status != 'cancelled'
         ORDER BY due_date ASC`,
        [userId, from, to]
      ),
    ])

    const habits = habitsResult.rows.map((h) => ({
      ...h,
      completed_dates: h.completed_dates ?? [],
    }))

    res.json({ data: { habits, tasks: tasksResult.rows } })
  } catch (err) {
    console.error('GET /calendar error:', err)
    res.status(500).json({ error: 'Failed to fetch calendar data', code: 'FETCH_ERROR' })
  }
})

export default router
