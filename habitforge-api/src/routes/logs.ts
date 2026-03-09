import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { verifyJWT } from '../middleware/verifyJWT'
import { pool } from '../db/pool'
import { incrementStreak, decrementStreak } from '../services/redis'

function getUserId(req: Request): string | null {
  const user = (req as Request & { user?: { id: string; email: string } }).user
  return user?.id ?? null
}

const router: Router = Router()

const checkInSchema = z.object({
  habitId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().optional(),
})

const heatmapQuerySchema = z.object({
  habitId: z.string().uuid().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

router.post('/', verifyJWT, async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req)
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' })
    return
  }

  const parsed = checkInSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    return
  }

  const { habitId, date, note } = parsed.data

  const todayUtc = new Date().toISOString().slice(0, 10)
  if (date > todayUtc) {
    res.status(400).json({ error: 'Cannot check in for a future date', code: 'FUTURE_DATE' })
    return
  }

  try {
    const habitResult = await pool.query(
      'SELECT id, current_streak, longest_streak FROM habits WHERE id = $1 AND user_id = $2',
      [habitId, userId]
    )

    if (habitResult.rows.length === 0) {
      res.status(404).json({ error: 'Habit not found', code: 'NOT_FOUND' })
      return
    }

    const habit = habitResult.rows[0] as {
      id: string
      current_streak: number
      longest_streak: number
    }

    const duplicateResult = await pool.query(
      'SELECT id FROM habit_logs WHERE habit_id = $1 AND log_date = $2 AND is_undone = false',
      [habitId, date]
    )

    if (duplicateResult.rows.length > 0) {
      res.status(409).json({ error: 'Already checked in for this date', code: 'DUPLICATE_LOG' })
      return
    }

    const insertResult = await pool.query(
      `INSERT INTO habit_logs (habit_id, user_id, log_date, source, note)
       VALUES ($1, $2, $3, 'manual', $4)
       RETURNING id`,
      [habitId, userId, date, note ?? null]
    )

    const logId = (insertResult.rows[0] as { id: string }).id

    const newStreak = await incrementStreak(userId, habitId)

    const isNewRecord = newStreak > habit.longest_streak

    if (isNewRecord) {
      await pool.query(
        `UPDATE habits
         SET total_completions = total_completions + 1,
             current_streak = $1,
             longest_streak = $1,
             updated_at = NOW()
         WHERE id = $2 AND user_id = $3`,
        [newStreak, habitId, userId]
      )
    } else {
      await pool.query(
        `UPDATE habits
         SET total_completions = total_completions + 1,
             current_streak = $1,
             updated_at = NOW()
         WHERE id = $2 AND user_id = $3`,
        [newStreak, habitId, userId]
      )
    }

    const longestStreak = isNewRecord ? newStreak : habit.longest_streak

    res.status(201).json({
      data: {
        logId,
        habitId,
        logDate: date,
        currentStreak: newStreak,
        longestStreak,
        isNewRecord,
      },
    })
  } catch (err) {
    console.error('POST /logs error:', err)
    res.status(500).json({ error: 'Failed to record check-in', code: 'CHECK_IN_ERROR' })
  }
})

router.delete('/:logId', verifyJWT, async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req)
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' })
    return
  }

  const logId = req.params.logId

  try {
    const logResult = await pool.query(
      'SELECT id, habit_id, log_date, is_undone FROM habit_logs WHERE id = $1 AND user_id = $2',
      [logId, userId]
    )

    if (logResult.rows.length === 0) {
      res.status(404).json({ error: 'Log not found', code: 'NOT_FOUND' })
      return
    }

    const log = logResult.rows[0] as {
      id: string
      habit_id: string
      log_date: Date
      is_undone: boolean
    }

    if (log.is_undone) {
      res.status(409).json({ error: 'Log already undone', code: 'ALREADY_UNDONE' })
      return
    }

    const todayUtc = new Date().toISOString().slice(0, 10)
    const logDateStr =
      log.log_date instanceof Date
        ? log.log_date.toISOString().slice(0, 10)
        : String(log.log_date).slice(0, 10)

    if (logDateStr !== todayUtc) {
      res.status(400).json({ error: "Can only undo today's check-in", code: 'UNDO_TOO_LATE' })
      return
    }

    await pool.query(
      'UPDATE habit_logs SET is_undone = true WHERE id = $1 AND user_id = $2',
      [logId, userId]
    )

    const newStreak = await decrementStreak(userId, log.habit_id)

    await pool.query(
      `UPDATE habits
       SET current_streak = $1,
           total_completions = total_completions - 1,
           updated_at = NOW()
       WHERE id = $2 AND user_id = $3`,
      [newStreak, log.habit_id, userId]
    )

    res.status(200).json({ data: { newStreak } })
  } catch (err) {
    console.error('DELETE /logs/:logId error:', err)
    res.status(500).json({ error: 'Failed to undo check-in', code: 'UNDO_ERROR' })
  }
})

router.get('/heatmap', verifyJWT, async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req)
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' })
    return
  }

  const parsed = heatmapQuerySchema.safeParse(req.query)
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    return
  }

  const { habitId, from, to } = parsed.data

  const fromMs = new Date(from).getTime()
  const toMs = new Date(to).getTime()
  const diffDays = (toMs - fromMs) / (1000 * 60 * 60 * 24)

  if (diffDays < 0) {
    res.status(400).json({ error: "'from' must be before 'to'", code: 'INVALID_DATE_RANGE' })
    return
  }

  if (diffDays > 366) {
    res.status(400).json({ error: 'Date range cannot exceed 366 days', code: 'DATE_RANGE_TOO_LARGE' })
    return
  }

  try {
    let query: string
    let params: unknown[]

    if (habitId) {
      query = `
        SELECT log_date, COUNT(*) AS count, array_agg(habit_id) AS habit_ids
        FROM habit_logs
        WHERE user_id = $1
          AND habit_id = $2
          AND is_undone = false
          AND log_date BETWEEN $3 AND $4
        GROUP BY log_date
        ORDER BY log_date ASC
      `
      params = [userId, habitId, from, to]
    } else {
      query = `
        SELECT log_date, COUNT(*) AS count, array_agg(habit_id) AS habit_ids
        FROM habit_logs
        WHERE user_id = $1
          AND is_undone = false
          AND log_date BETWEEN $2 AND $3
        GROUP BY log_date
        ORDER BY log_date ASC
      `
      params = [userId, from, to]
    }

    const result = await pool.query(query, params)

    const data = result.rows.map((row) => {
      const r = row as { log_date: Date; count: string; habit_ids: string[] }
      return {
        date:
          r.log_date instanceof Date
            ? r.log_date.toISOString().slice(0, 10)
            : String(r.log_date).slice(0, 10),
        count: Number(r.count),
        habitIds: r.habit_ids,
      }
    })

    res.json({ data })
  } catch (err) {
    console.error('GET /logs/heatmap error:', err)
    res.status(500).json({ error: 'Failed to fetch heatmap', code: 'HEATMAP_ERROR' })
  }
})

export default router
