import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { verifyJWT } from '../middleware/verifyJWT';
import { pool } from '../db/pool';
import { generateHabitPlan, parseHabitInput } from '../services/groq';
import { initStreak, resetStreak } from '../services/redis';

function getUserId(req: Request): string | null {
  const user = (req as Request & { user?: { id: string; email: string } }).user;
  return user?.id ?? null;
}

const router: Router = Router();

const aiPlanSchema = z.object({
  goal: z.string().min(1).max(500),
  context: z.object({
    why: z.string(),
    timeAvailable: z.string(),
    triedBefore: z.string(),
  }),
});

const updateHabitSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  scheduledTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  frequency: z.enum(['daily', 'weekdays', 'weekends', 'custom']).optional(),
  customDays: z.array(z.number().min(0).max(6)).optional(),
  status: z.enum(['paused', 'abandoned']).optional(),
});

const parseInputSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(2000),
      })
    )
    .min(1)
    .max(20),
});

router.post('/parse-input', verifyJWT, async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    return;
  }

  const parsed = parseInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    return;
  }

  try {
    const result = await parseHabitInput(parsed.data.messages);
    res.status(200).json({ data: result });
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'LLM_TIMEOUT') {
      res.status(504).json({ error: 'AI service timeout', code: 'LLM_TIMEOUT' });
      return;
    }
    console.error('Error parsing habit input:', error);
    res.status(500).json({ error: 'Failed to analyze input', code: 'PARSE_ERROR' });
  }
});

router.post('/ai-plan', verifyJWT, async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    return;
  }

  const parsed = aiPlanSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    return;
  }

  const { goal, context } = parsed.data;

  try {
    const plan = await generateHabitPlan(goal, context);

    const habitResult = await pool.query(
      `INSERT INTO habits (
        user_id, title, goal, description, scheduled_time, frequency, 
        custom_days, duration_minutes, status, phase_count, ai_model_used
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id`,
      [
        userId,
        plan.title,
        goal,
        plan.description,
        plan.scheduledTime,
        plan.frequency,
        plan.customDays,
        plan.durationMinutes,
        'pending',
        plan.phases.length,
        'llama-3.3-70b-versatile',
      ]
    );

    const habitId = habitResult.rows[0].id as string;

    try {
      const phaseValues = plan.phases.map((phase) => [
        habitId,
        phase.phaseNumber,
        phase.title,
        phase.startDay,
        phase.endDay,
        phase.dailyTarget,
        phase.milestone,
      ]);

      const phaseInsertQuery = `
        INSERT INTO habit_plan_phases (
          habit_id, phase_number, title, start_day, end_day, daily_target, milestone_description
        ) VALUES ${phaseValues.map((_, i) => `($${i * 7 + 1}, $${i * 7 + 2}, $${i * 7 + 3}, $${i * 7 + 4}, $${i * 7 + 5}, $${i * 7 + 6}, $${i * 7 + 7})`).join(', ')}
      `;

      await pool.query(phaseInsertQuery, phaseValues.flat());

      res.status(200).json({
        data: {
          habitId,
          plan,
        },
      });
    } catch (phaseError) {
      await pool.query('DELETE FROM habits WHERE id = $1 AND user_id = $2', [habitId, userId]);
      console.error('Error inserting phases:', phaseError);
      res.status(500).json({ error: 'Failed to create habit plan', code: 'PHASE_INSERT_ERROR' });
    }
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'LLM_TIMEOUT') {
      res.status(504).json({ error: 'AI service timeout', code: 'LLM_TIMEOUT' });
      return;
    }
    console.error('Error generating habit plan:', error);
    res.status(500).json({ error: 'Failed to generate habit plan', code: 'AI_GENERATION_ERROR' });
  }
});

router.post('/:id/activate', verifyJWT, async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    return;
  }

  const activateParamParsed = z.object({ id: z.string().uuid() }).safeParse(req.params);
  if (!activateParamParsed.success) {
    res.status(400).json({ error: 'Invalid habit ID', code: 'VALIDATION_ERROR' });
    return;
  }
  const habitId = activateParamParsed.data.id;

  try {
    const habitCheck = await pool.query(
      'SELECT status FROM habits WHERE id = $1 AND user_id = $2',
      [habitId, userId]
    );

    if (habitCheck.rows.length === 0) {
      res.status(404).json({ error: 'Habit not found', code: 'NOT_FOUND' });
      return;
    }

    const habit = habitCheck.rows[0] as { status: string };

    if (habit.status !== 'pending') {
      res.status(409).json({ error: 'Habit already active', code: 'ALREADY_ACTIVE' });
      return;
    }

    const updateResult = await pool.query(
      `UPDATE habits 
       SET status = 'active', 
           plan_started_at = CURRENT_DATE, 
           plan_ends_at = CURRENT_DATE + INTERVAL '66 days'
       WHERE id = $1 AND user_id = $2
       RETURNING plan_started_at, plan_ends_at`,
      [habitId, userId]
    );

    await initStreak(userId, habitId);

    const updated = updateResult.rows[0] as { plan_started_at: Date; plan_ends_at: Date };

    res.status(200).json({
      data: {
        habitId,
        planStartedAt: updated.plan_started_at,
        planEndsAt: updated.plan_ends_at,
      },
    });
  } catch (error) {
    console.error('Error activating habit:', error);
    res.status(500).json({ error: 'Failed to activate habit', code: 'ACTIVATION_ERROR' });
  }
});

router.get('/', verifyJWT, async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    return;
  }

  const rawStatus = req.query.status;
  const statusParam = typeof rawStatus === 'string' ? rawStatus : 'active';
  const validStatuses = ['pending', 'active', 'paused', 'completed', 'abandoned', 'all'];

  if (!validStatuses.includes(statusParam)) {
    res.status(400).json({ error: 'Invalid status parameter', code: 'INVALID_STATUS' });
    return;
  }

  try {
    let query: string;
    let params: unknown[];

    if (statusParam === 'all') {
      query = `
        SELECT id, title, status, frequency, custom_days, scheduled_time, 
               current_streak, longest_streak, total_completions, phase_count, 
               current_phase, plan_started_at, plan_ends_at
        FROM habits
        WHERE user_id = $1
        ORDER BY created_at DESC
      `;
      params = [userId];
    } else {
      query = `
        SELECT id, title, status, frequency, custom_days, scheduled_time, 
               current_streak, longest_streak, total_completions, phase_count, 
               current_phase, plan_started_at, plan_ends_at
        FROM habits
        WHERE user_id = $1 AND status = $2
        ORDER BY created_at DESC
      `;
      params = [userId, statusParam];
    }

    const result = await pool.query(query, params);

    res.json({
      data: result.rows,
      meta: {
        total: result.rows.length,
      },
    });
  } catch (error) {
    console.error('Error fetching habits:', error);
    res.status(500).json({ error: 'Failed to fetch habits', code: 'FETCH_ERROR' });
  }
});

router.get('/:id', verifyJWT, async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    return;
  }

  const habitId = String(req.params.id);

  try {
    const habitResult = await pool.query(
      'SELECT * FROM habits WHERE id = $1 AND user_id = $2',
      [habitId, userId]
    );

    if (habitResult.rows.length === 0) {
      res.status(404).json({ error: 'Habit not found', code: 'NOT_FOUND' });
      return;
    }

    const habit = habitResult.rows[0];

    const phasesResult = await pool.query(
      `SELECT phase_number, title, start_day, end_day, daily_target, 
              milestone_description, is_completed
       FROM habit_plan_phases
       WHERE habit_id = $1
       ORDER BY phase_number ASC`,
      [habitId]
    );

    const logsResult = await pool.query(
      `SELECT id, log_date, source, created_at
       FROM habit_logs
       WHERE habit_id = $1 AND is_undone = FALSE
       ORDER BY log_date DESC
       LIMIT 7`,
      [habitId]
    );

    res.json({
      data: {
        ...habit,
        phases: phasesResult.rows,
        recentLogs: logsResult.rows,
      },
    });
  } catch (error) {
    console.error('Error fetching habit details:', error);
    res.status(500).json({ error: 'Failed to fetch habit', code: 'FETCH_ERROR' });
  }
});

router.patch('/:id', verifyJWT, async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    return;
  }

  const habitId = String(req.params.id);

  const parsed = updateHabitSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    return;
  }

  const updates = parsed.data;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: 'No fields to update', code: 'NO_UPDATES' });
    return;
  }

  try {
    const habitCheck = await pool.query(
      'SELECT id FROM habits WHERE id = $1 AND user_id = $2',
      [habitId, userId]
    );

    if (habitCheck.rows.length === 0) {
      res.status(404).json({ error: 'Habit not found', code: 'NOT_FOUND' });
      return;
    }

    const setClauses: string[] = ['updated_at = NOW()'];
    const values: unknown[] = [];
    let paramIndex = 1;

    const fieldMap: Record<string, string> = {
      title: 'title',
      scheduledTime: 'scheduled_time',
      frequency: 'frequency',
      customDays: 'custom_days',
      status: 'status',
    };

    for (const [camelKey, value] of Object.entries(updates)) {
      const snakeKey = fieldMap[camelKey];
      if (snakeKey) {
        setClauses.push(`${snakeKey} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    }

    values.push(habitId, userId);

    const query = `
      UPDATE habits
      SET ${setClauses.join(', ')}
      WHERE id = $${paramIndex} AND user_id = $${paramIndex + 1}
      RETURNING *
    `;

    const result = await pool.query(query, values);

    res.json({
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Error updating habit:', error);
    res.status(500).json({ error: 'Failed to update habit', code: 'UPDATE_ERROR' });
  }
});

router.delete('/:id', verifyJWT, async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    return;
  }

  const habitId = String(req.params.id);

  try {
    const habitCheck = await pool.query(
      'SELECT id FROM habits WHERE id = $1 AND user_id = $2',
      [habitId, userId]
    );

    if (habitCheck.rows.length === 0) {
      res.status(404).json({ error: 'Habit not found', code: 'NOT_FOUND' });
      return;
    }

    await pool.query('DELETE FROM habits WHERE id = $1 AND user_id = $2', [habitId, userId]);

    await resetStreak(userId, habitId);

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting habit:', error);
    res.status(500).json({ error: 'Failed to delete habit', code: 'DELETE_ERROR' });
  }
});

export default router;
