import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { verifyJWT } from '../middleware/verifyJWT'
import { pool } from '../db/pool'

/** After verifyJWT, req.user is set; use this type for guarded access. */
function getUserId(req: Request): string | null {
  const user = (req as Request & { user?: { id: string; email: string } }).user
  return user?.id ?? null
}

const router: Router = Router()

const ROAST_TONES = ['drill_sergeant', 'disappointed_parent', 'anime_sensei', 'best_friend', 'stoic_philosopher'] as const
const THEMES = ['light', 'dark', 'system'] as const

const patchPreferencesSchema = z.object({
  roastTone: z.enum(ROAST_TONES).optional(),
  roastEnabled: z.boolean().optional(),
  reminderEnabled: z.boolean().optional(),
  reminderMinutesBefore: z.number().min(1).max(120).optional(),
  cronCutoffTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  gracePeriodMinutes: z.number().min(0).max(240).optional(),
  emailNotifications: z.boolean().optional(),
  weeklySummaryEnabled: z.boolean().optional(),
  theme: z.enum(THEMES).optional(),
})

const DEFAULT_PREFERENCES = {
  roast_tone: 'best_friend',
  roast_enabled: true,
  reminder_enabled: true,
  reminder_minutes_before: 30,
  cron_cutoff_time: '22:00',
  grace_period_minutes: 60,
  email_notifications: true,
  weekly_summary_enabled: true,
  theme: 'system',
} as const

function rowToCamel(row: Record<string, unknown>): {
  roastTone: string
  roastEnabled: boolean
  reminderEnabled: boolean
  reminderMinutesBefore: number
  cronCutoffTime: string
  gracePeriodMinutes: number
  emailNotifications: boolean
  weeklySummaryEnabled: boolean
  theme: string
} {
  return {
    roastTone: (row.roast_tone as string) ?? DEFAULT_PREFERENCES.roast_tone,
    roastEnabled: (row.roast_enabled as boolean) ?? DEFAULT_PREFERENCES.roast_enabled,
    reminderEnabled: (row.reminder_enabled as boolean) ?? DEFAULT_PREFERENCES.reminder_enabled,
    reminderMinutesBefore: (row.reminder_minutes_before as number) ?? DEFAULT_PREFERENCES.reminder_minutes_before,
    cronCutoffTime: (row.cron_cutoff_time as string) ?? DEFAULT_PREFERENCES.cron_cutoff_time,
    gracePeriodMinutes: (row.grace_period_minutes as number) ?? DEFAULT_PREFERENCES.grace_period_minutes,
    emailNotifications: (row.email_notifications as boolean) ?? DEFAULT_PREFERENCES.email_notifications,
    weeklySummaryEnabled: (row.weekly_summary_enabled as boolean) ?? DEFAULT_PREFERENCES.weekly_summary_enabled,
    theme: (row.theme as string) ?? DEFAULT_PREFERENCES.theme,
  }
}

const CAMEL_TO_SNAKE: Record<string, string> = {
  roastTone: 'roast_tone',
  roastEnabled: 'roast_enabled',
  reminderEnabled: 'reminder_enabled',
  reminderMinutesBefore: 'reminder_minutes_before',
  cronCutoffTime: 'cron_cutoff_time',
  gracePeriodMinutes: 'grace_period_minutes',
  emailNotifications: 'email_notifications',
  weeklySummaryEnabled: 'weekly_summary_enabled',
  theme: 'theme',
}

router.get('/', verifyJWT, async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req)
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  try {
    const selectResult = await pool.query(
      'SELECT roast_tone, roast_enabled, reminder_enabled, reminder_minutes_before, cron_cutoff_time, grace_period_minutes, email_notifications, weekly_summary_enabled, theme FROM user_preferences WHERE user_id = $1',
      [userId]
    )

    let row: Record<string, unknown>
    if (selectResult.rows.length === 0) {
      await pool.query(
        `INSERT INTO user_preferences (user_id, roast_tone, roast_enabled, reminder_enabled, reminder_minutes_before, cron_cutoff_time, grace_period_minutes, email_notifications, weekly_summary_enabled, theme)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          userId,
          DEFAULT_PREFERENCES.roast_tone,
          DEFAULT_PREFERENCES.roast_enabled,
          DEFAULT_PREFERENCES.reminder_enabled,
          DEFAULT_PREFERENCES.reminder_minutes_before,
          DEFAULT_PREFERENCES.cron_cutoff_time,
          DEFAULT_PREFERENCES.grace_period_minutes,
          DEFAULT_PREFERENCES.email_notifications,
          DEFAULT_PREFERENCES.weekly_summary_enabled,
          DEFAULT_PREFERENCES.theme,
        ]
      )
      row = { ...DEFAULT_PREFERENCES }
    } else {
      row = selectResult.rows[0] as Record<string, unknown>
    }

    res.json({ data: rowToCamel(row) })
  } catch (err) {
    console.error('GET /preferences error:', err)
    res.status(500).json({ error: 'Failed to fetch preferences' })
  }
})

router.patch('/', verifyJWT, async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req)
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const parsed = patchPreferencesSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() })
    return
  }

  const body = parsed.data
  if (!body || Object.keys(body).length === 0) {
    try {
      const selectResult = await pool.query(
        'SELECT roast_tone, roast_enabled, reminder_enabled, reminder_minutes_before, cron_cutoff_time, grace_period_minutes, email_notifications, weekly_summary_enabled, theme FROM user_preferences WHERE user_id = $1',
        [userId]
      )
      if (selectResult.rows.length === 0) {
        await pool.query(
          `INSERT INTO user_preferences (user_id, roast_tone, roast_enabled, reminder_enabled, reminder_minutes_before, cron_cutoff_time, grace_period_minutes, email_notifications, weekly_summary_enabled, theme)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (user_id) DO NOTHING`,
          [
            userId,
            DEFAULT_PREFERENCES.roast_tone,
            DEFAULT_PREFERENCES.roast_enabled,
            DEFAULT_PREFERENCES.reminder_enabled,
            DEFAULT_PREFERENCES.reminder_minutes_before,
            DEFAULT_PREFERENCES.cron_cutoff_time,
            DEFAULT_PREFERENCES.grace_period_minutes,
            DEFAULT_PREFERENCES.email_notifications,
            DEFAULT_PREFERENCES.weekly_summary_enabled,
            DEFAULT_PREFERENCES.theme,
          ]
        )
        res.json({ data: rowToCamel({ ...DEFAULT_PREFERENCES } as Record<string, unknown>) })
        return
      }
      res.json({ data: rowToCamel(selectResult.rows[0] as Record<string, unknown>) })
      return
    } catch (err) {
      console.error('PATCH /preferences (empty body) error:', err)
      res.status(500).json({ error: 'Failed to fetch preferences' })
      return
    }
  }

  const columns: string[] = ['user_id']
  const values: unknown[] = [userId]
  const setClauses: string[] = []

  for (const [camelKey, value] of Object.entries(body)) {
    const snakeKey = CAMEL_TO_SNAKE[camelKey]
    if (!snakeKey) continue
    columns.push(snakeKey)
    values.push(value)
    setClauses.push(`${snakeKey} = $${values.length}`)
  }

  const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ')
  const insertCols = columns.join(', ')
  const updateSet = setClauses.slice(1).join(', ')

  try {
    const query = `INSERT INTO user_preferences (${insertCols}) VALUES (${placeholders})
      ON CONFLICT (user_id) DO UPDATE SET ${updateSet}
      RETURNING roast_tone, roast_enabled, reminder_enabled, reminder_minutes_before, cron_cutoff_time, grace_period_minutes, email_notifications, weekly_summary_enabled, theme`
    const result = await pool.query(query, values)
    const row = result.rows[0] as Record<string, unknown>
    res.json({ data: rowToCamel(row) })
  } catch (err) {
    console.error('PATCH /preferences error:', err)
    res.status(500).json({ error: 'Failed to update preferences' })
  }
})

export default router
