import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { verifyJWT } from '../middleware/verifyJWT'
import { pool } from '../db/pool'

function getUserId(req: Request): string | null {
  const user = (req as Request & { user?: { id: string; email: string } }).user
  return user?.id ?? null
}

const router: Router = Router()

const listNotificationsSchema = z.object({
  read: z
    .string()
    .toLowerCase()
    .pipe(z.enum(['true', 'false']))
    .transform((v) => v === 'true')
    .optional(),
  page: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().int().min(1))
    .default(1),
  limit: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(100))
    .default(20),
})

interface NotificationRow {
  id: string
  user_id: string
  habit_id: string | null
  type: string
  message: string
  is_read: boolean
  created_at: Date
  habit_title: string | null
}

interface CountRow {
  total: string
  unread_count: string
}

// ─── GET /notifications ───────────────────────────────────────────────────────

router.get('/', verifyJWT, async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req)
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' })
    return
  }

  const parsed = listNotificationsSchema.safeParse(req.query)
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    return
  }

  const { read, page, limit } = parsed.data
  const offset = (page - 1) * limit

  try {
    const conditions: string[] = ['n.user_id = $1']
    const params: unknown[] = [userId]
    let idx = 2

    if (read !== undefined) {
      conditions.push(`n.is_read = $${idx}`)
      params.push(read)
      idx++
    }

    const whereClause = conditions.join(' AND ')

    const [listResult, countResult] = await Promise.all([
      pool.query<NotificationRow>(
        `SELECT n.*, h.title AS habit_title, h.id AS habit_id
         FROM notifications n
         LEFT JOIN habits h ON n.habit_id = h.id
         WHERE ${whereClause}
         ORDER BY n.created_at DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, limit, offset]
      ),
      pool.query<CountRow>(
        `SELECT
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE n.is_read = false) AS unread_count
         FROM notifications n
         WHERE n.user_id = $1`,
        [userId]
      ),
    ])

    const countRow = countResult.rows[0]

    res.json({
      data: listResult.rows,
      meta: {
        total: Number(countRow.total),
        unreadCount: Number(countRow.unread_count),
        page,
        limit,
      },
    })
  } catch (err) {
    console.error('GET /notifications error:', err)
    res.status(500).json({ error: 'Failed to fetch notifications', code: 'FETCH_ERROR' })
  }
})

// ─── PATCH /notifications/:id/read ───────────────────────────────────────────

router.patch('/:id/read', verifyJWT, async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req)
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' })
    return
  }

  const notifParamParsed = z.object({ id: z.string().uuid() }).safeParse(req.params)
  if (!notifParamParsed.success) {
    res.status(400).json({ error: 'Invalid notification ID', code: 'VALIDATION_ERROR' })
    return
  }
  const notificationId = notifParamParsed.data.id

  try {
    const result = await pool.query(
      'UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2',
      [notificationId, userId]
    )

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Notification not found', code: 'NOT_FOUND' })
      return
    }

    res.json({ data: { id: notificationId, isRead: true } })
  } catch (err) {
    console.error('PATCH /notifications/:id/read error:', err)
    res.status(500).json({ error: 'Failed to mark notification as read', code: 'UPDATE_ERROR' })
  }
})

// ─── POST /notifications/read-all ────────────────────────────────────────────

router.post('/read-all', verifyJWT, async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req)
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' })
    return
  }

  try {
    const result = await pool.query(
      'UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false',
      [userId]
    )

    res.json({ data: { updatedCount: result.rowCount ?? 0 } })
  } catch (err) {
    console.error('POST /notifications/read-all error:', err)
    res.status(500).json({ error: 'Failed to mark all notifications as read', code: 'UPDATE_ERROR' })
  }
})

export default router
