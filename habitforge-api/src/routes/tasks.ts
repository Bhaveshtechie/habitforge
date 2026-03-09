import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { RRule } from 'rrule'
import { verifyJWT } from '../middleware/verifyJWT'
import { pool } from '../db/pool'

function getUserId(req: Request): string | null {
  const user = (req as Request & { user?: { id: string; email: string } }).user
  return user?.id ?? null
}

const router: Router = Router()

// ─── Schemas ───────────────────────────────────────────────────────────────

const createTaskSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dueTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  habitId: z.string().uuid().optional(),
  isRecurring: z.boolean().default(false),
  recurrenceRule: z.string().max(100).optional(),
})

const patchTaskSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().optional(),
  status: z.enum(['todo', 'in_progress', 'done', 'cancelled']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dueTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  habitId: z.string().uuid().optional(),
})

// ─── Helpers ───────────────────────────────────────────────────────────────

interface TaskRow {
  id: string
  user_id: string
  title: string
  description: string | null
  status: string
  priority: string
  due_date: string | null
  due_time: string | null
  habit_id: string | null
  is_recurring: boolean
  recurrence_rule: string | null
  parent_task_id: string | null
  created_at: Date
  updated_at: Date
}

/**
 * Given an RRULE string and the current due date, compute the next occurrence
 * date as a YYYY-MM-DD string. Returns null if it cannot be determined.
 */
function computeNextDueDate(recurrenceRule: string, currentDueDate: string | null): string | null {
  try {
    const rule = RRule.fromString(recurrenceRule)
    const after = currentDueDate ? new Date(`${currentDueDate}T00:00:00Z`) : new Date()
    const next = rule.after(after, false)
    if (!next) return null
    return next.toISOString().slice(0, 10)
  } catch {
    return null
  }
}

// ─── POST /tasks ────────────────────────────────────────────────────────────

router.post('/', verifyJWT, async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req)
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' })
    return
  }

  const parsed = createTaskSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    return
  }

  const { title, description, dueDate, dueTime, priority, habitId, isRecurring, recurrenceRule } = parsed.data

  if (isRecurring && !recurrenceRule) {
    res.status(400).json({ error: 'recurrenceRule is required when isRecurring is true', code: 'MISSING_RECURRENCE_RULE' })
    return
  }

  try {
    const result = await pool.query<TaskRow>(
      `INSERT INTO tasks (
        user_id, title, description, due_date, due_time,
        priority, habit_id, is_recurring, recurrence_rule, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'todo')
      RETURNING *`,
      [userId, title, description ?? null, dueDate ?? null, dueTime ?? null, priority, habitId ?? null, isRecurring, recurrenceRule ?? null]
    )

    res.status(201).json({ data: result.rows[0] })
  } catch (err) {
    console.error('POST /tasks error:', err)
    res.status(500).json({ error: 'Failed to create task', code: 'CREATE_ERROR' })
  }
})

// ─── GET /tasks ─────────────────────────────────────────────────────────────

router.get('/', verifyJWT, async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req)
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' })
    return
  }

  const rawStatus = typeof req.query.status === 'string' ? req.query.status : 'all'
  const rawDate = typeof req.query.date === 'string' ? req.query.date : undefined
  const rawHabitId = typeof req.query.habitId === 'string' ? req.query.habitId : undefined

  const validStatuses = ['todo', 'in_progress', 'done', 'all']
  if (!validStatuses.includes(rawStatus)) {
    res.status(400).json({ error: 'Invalid status parameter', code: 'INVALID_STATUS' })
    return
  }

  if (rawDate && !/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
    res.status(400).json({ error: 'Invalid date format, expected YYYY-MM-DD', code: 'INVALID_DATE' })
    return
  }

  if (rawHabitId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawHabitId)) {
    res.status(400).json({ error: 'Invalid habitId format', code: 'INVALID_HABIT_ID' })
    return
  }

  try {
    const conditions: string[] = ['user_id = $1']
    const params: unknown[] = [userId]
    let idx = 2

    if (rawStatus !== 'all') {
      conditions.push(`status = $${idx}`)
      params.push(rawStatus)
      idx++
    }

    if (rawDate) {
      conditions.push(`due_date = $${idx}`)
      params.push(rawDate)
      idx++
    }

    if (rawHabitId) {
      conditions.push(`habit_id = $${idx}`)
      params.push(rawHabitId)
      idx++
    }

    const query = `
      SELECT * FROM tasks
      WHERE ${conditions.join(' AND ')}
      ORDER BY due_date ASC NULLS LAST, created_at DESC
    `

    const result = await pool.query<TaskRow>(query, params)

    res.json({
      data: result.rows,
      meta: { total: result.rows.length },
    })
  } catch (err) {
    console.error('GET /tasks error:', err)
    res.status(500).json({ error: 'Failed to fetch tasks', code: 'FETCH_ERROR' })
  }
})

// ─── PATCH /tasks/:id ───────────────────────────────────────────────────────

router.patch('/:id', verifyJWT, async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req)
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' })
    return
  }

  const taskId = String(req.params.id)

  const parsed = patchTaskSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    return
  }

  const updates = parsed.data
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: 'No fields to update', code: 'NO_UPDATES' })
    return
  }

  try {
    const taskCheck = await pool.query<TaskRow>(
      'SELECT * FROM tasks WHERE id = $1 AND user_id = $2',
      [taskId, userId]
    )

    if (taskCheck.rows.length === 0) {
      res.status(404).json({ error: 'Task not found', code: 'NOT_FOUND' })
      return
    }

    const existingTask = taskCheck.rows[0]

    const fieldMap: Record<string, string> = {
      title: 'title',
      description: 'description',
      status: 'status',
      priority: 'priority',
      dueDate: 'due_date',
      dueTime: 'due_time',
      habitId: 'habit_id',
    }

    const setClauses: string[] = ['updated_at = NOW()']
    const values: unknown[] = []
    let paramIdx = 1

    for (const [camelKey, value] of Object.entries(updates)) {
      const snakeKey = fieldMap[camelKey]
      if (snakeKey) {
        setClauses.push(`${snakeKey} = $${paramIdx}`)
        values.push(value)
        paramIdx++
      }
    }

    values.push(taskId, userId)

    const updateQuery = `
      UPDATE tasks
      SET ${setClauses.join(', ')}
      WHERE id = $${paramIdx} AND user_id = $${paramIdx + 1}
      RETURNING *
    `

    const updateResult = await pool.query<TaskRow>(updateQuery, values)
    const updatedTask = updateResult.rows[0]

    const isBecomingDone = updates.status === 'done'
    const wasRecurring = existingTask.is_recurring

    if (isBecomingDone && wasRecurring && existingTask.recurrence_rule) {
      const nextDueDate = computeNextDueDate(existingTask.recurrence_rule, existingTask.due_date)

      if (nextDueDate) {
        try {
          const nextResult = await pool.query<TaskRow>(
            `INSERT INTO tasks (
              user_id, title, description, due_date, due_time,
              priority, habit_id, is_recurring, recurrence_rule,
              parent_task_id, status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'todo')
            RETURNING *`,
            [
              userId,
              existingTask.title,
              existingTask.description,
              nextDueDate,
              existingTask.due_time,
              existingTask.priority,
              existingTask.habit_id,
              true,
              existingTask.recurrence_rule,
              taskId,
            ]
          )

          res.json({ data: { updated: updatedTask, nextOccurrence: nextResult.rows[0] } })
          return
        } catch (insertErr) {
          console.error('PATCH /tasks/:id – failed to insert next occurrence:', insertErr)
        }
      }

      res.json({ data: { updated: updatedTask, nextOccurrence: null } })
      return
    }

    res.json({ data: { updated: updatedTask, nextOccurrence: null } })
  } catch (err) {
    console.error('PATCH /tasks/:id error:', err)
    res.status(500).json({ error: 'Failed to update task', code: 'UPDATE_ERROR' })
  }
})

// ─── DELETE /tasks/:id ──────────────────────────────────────────────────────

router.delete('/:id', verifyJWT, async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req)
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' })
    return
  }

  const taskId = String(req.params.id)
  const deleteAll = req.query.deleteAll === 'true'

  try {
    const taskCheck = await pool.query<Pick<TaskRow, 'id'>>(
      'SELECT id FROM tasks WHERE id = $1 AND user_id = $2',
      [taskId, userId]
    )

    if (taskCheck.rows.length === 0) {
      res.status(404).json({ error: 'Task not found', code: 'NOT_FOUND' })
      return
    }

    if (deleteAll) {
      await pool.query(
        'DELETE FROM tasks WHERE parent_task_id = $1 AND user_id = $2',
        [taskId, userId]
      )
    }

    await pool.query(
      'DELETE FROM tasks WHERE id = $1 AND user_id = $2',
      [taskId, userId]
    )

    res.status(204).send()
  } catch (err) {
    console.error('DELETE /tasks/:id error:', err)
    res.status(500).json({ error: 'Failed to delete task', code: 'DELETE_ERROR' })
  }
})

export default router
