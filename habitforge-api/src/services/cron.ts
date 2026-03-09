import { schedule } from 'node-cron';
import { acquireCronLock } from './redis';
import { pool } from '../db/pool';
import { generateRoastMessage, generateWeeklySummary } from './groq';
import { sendRoastEmail, sendWeeklySummaryEmail } from './email';

type RoastTone =
  | 'drill_sergeant'
  | 'disappointed_parent'
  | 'anime_sensei'
  | 'best_friend'
  | 'stoic_philosopher';

interface MissedHabit {
  id: string;
  title: string;
  user_id: string;
  current_streak: number;
  email: string;
  roast_tone: RoastTone;
  roast_enabled: boolean;
  email_notifications: boolean;
  cron_cutoff_time: string | null;
}

interface UserWithHabits {
  id: string;
  email: string;
  email_notifications: boolean;
}

interface HabitWeekRow {
  id: string;
  title: string;
  current_streak: number;
  frequency: 'daily' | 'weekdays' | 'weekends' | 'custom';
  custom_days: number[] | null;
  completions_this_week: string;
}

/**
 * Count consecutive days before `referenceDate` where no log exists for the habit.
 * Stops at the first day that has a completed log.
 */
async function getDaysMissed(
  habitId: string,
  referenceDate: string
): Promise<number> {
  const { rows } = await pool.query<{ log_date: string }>(
    `SELECT log_date::text AS log_date
     FROM habit_logs
     WHERE habit_id = $1 AND is_undone = false
     ORDER BY log_date DESC
     LIMIT 30`,
    [habitId]
  );

  const logDates = new Set(rows.map((r) => r.log_date));
  let daysMissed = 0;

  for (let i = 1; i <= 30; i++) {
    const d = new Date(referenceDate);
    d.setUTCDate(d.getUTCDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    if (logDates.has(dateStr)) break;
    daysMissed++;
  }

  return daysMissed;
}

/**
 * Calculate how many days in a week a habit should be completed based on its frequency.
 * `weekStart` is the Sunday of that week (UTC).
 */
function calculateTotalScheduled(
  frequency: HabitWeekRow['frequency'],
  customDays: number[] | null,
  weekStart: Date
): number {
  switch (frequency) {
    case 'daily':
      return 7;
    case 'weekdays':
      return 5;
    case 'weekends':
      return 2;
    case 'custom': {
      if (!customDays || customDays.length === 0) return 7;
      let count = 0;
      for (let i = 0; i < 7; i++) {
        const dayOfWeek = (weekStart.getUTCDay() + i) % 7;
        if (customDays.includes(dayOfWeek)) count++;
      }
      return count;
    }
    default:
      return 7;
  }
}

// ─── JOB 1: Nightly roast check ─────────────────────────────────────────────

export async function runRoastCheck(date: string): Promise<void> {
  const locked = await acquireCronLock(`cron:roast:${date}`, 86400);
  if (!locked) {
    console.log(`[RoastCheck] Lock held, skipping ${date}`);
    return;
  }

  console.log(`[RoastCheck] Starting for date=${date}`);

  const { rows: missedHabits } = await pool.query<MissedHabit>(
    `SELECT h.id, h.title, h.user_id, h.current_streak,
            u.email, up.roast_tone, up.roast_enabled, up.email_notifications,
            up.cron_cutoff_time
     FROM habits h
     JOIN users u ON u.id = h.user_id
     JOIN user_preferences up ON up.user_id = h.user_id
     WHERE h.status = 'active'
       AND up.roast_enabled = true
       AND NOT EXISTS (
         SELECT 1 FROM habit_logs hl
         WHERE hl.habit_id = h.id
           AND hl.log_date = $1
           AND hl.is_undone = false
       )`,
    [date]
  );

  console.log(`[RoastCheck] Found ${missedHabits.length} missed habits`);

  let processed = 0;
  let skipped = 0;
  let failed = 0;

  const results = await Promise.allSettled(
    missedHabits.map(async (habit) => {
      const daysMissed = await getDaysMissed(habit.id, date);

      const message = await generateRoastMessage({
        habitTitle: habit.title,
        currentStreak: habit.current_streak,
        daysMissed,
        tone: habit.roast_tone,
      });

      // Insert notification — ON CONFLICT skips duplicates
      const { rowCount: insertedCount } = await pool.query(
        `INSERT INTO notifications (user_id, habit_id, type, title, message, delivery_channel, scheduled_for)
         VALUES ($1, $2, 'roast', $3, $4, 'both', $5)
         ON CONFLICT (user_id, habit_id, type, scheduled_for) DO NOTHING`,
        [
          habit.user_id,
          habit.id,
          `You missed ${habit.title}`,
          message,
          date,
        ]
      );

      if (insertedCount === 0) {
        // Notification already existed — already handled
        skipped++;
        return;
      }

      // Retrieve the notification id for status updates
      const { rows: notifRows } = await pool.query<{ id: string }>(
        `SELECT id FROM notifications
         WHERE user_id = $1 AND habit_id = $2 AND type = 'roast' AND scheduled_for = $3`,
        [habit.user_id, habit.id, date]
      );
      const notifId = notifRows[0]?.id;

      if (habit.email_notifications) {
        try {
          await sendRoastEmail(habit.email, habit.title, message);
          if (notifId) {
            await pool.query(
              `UPDATE notifications SET delivery_status = 'sent' WHERE id = $1`,
              [notifId]
            );
          }
        } catch (emailError: unknown) {
          console.error(
            `[RoastCheck] Email failed for habit ${habit.id}:`,
            emailError
          );
          if (notifId) {
            await pool.query(
              `UPDATE notifications SET delivery_status = 'failed' WHERE id = $1`,
              [notifId]
            );
          }
        }
      } else if (notifId) {
        // In-app only — mark sent immediately
        await pool.query(
          `UPDATE notifications SET delivery_status = 'sent' WHERE id = $1`,
          [notifId]
        );
      }
    })
  );

  for (const result of results) {
    if (result.status === 'fulfilled') {
      processed++;
    } else {
      failed++;
      console.error('[RoastCheck] Failed processing habit:', result.reason);
    }
  }

  // skipped is tracked inside the settled callbacks; subtract from processed
  processed = processed - skipped;
  console.log(
    `[RoastCheck] ${date}: processed=${processed}, skipped=${skipped}, failed=${failed}`
  );
}

// ─── JOB 2: Weekly summary ───────────────────────────────────────────────────

export async function runWeeklySummary(weekStartDate: string): Promise<void> {
  const weekKey = weekStartDate;
  const locked = await acquireCronLock(`cron:weekly:${weekKey}`, 604800);
  if (!locked) {
    console.log(`[WeeklySummary] Lock held, skipping week ${weekKey}`);
    return;
  }

  console.log(`[WeeklySummary] Starting for weekStart=${weekStartDate}`);

  const weekStart = new Date(weekStartDate);
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
  const weekEndStr = weekEnd.toISOString().split('T')[0];

  const { rows: users } = await pool.query<UserWithHabits>(
    `SELECT DISTINCT u.id, u.email, up.email_notifications
     FROM users u
     JOIN user_preferences up ON up.user_id = u.id
     WHERE up.weekly_summary_enabled = true`
  );

  console.log(`[WeeklySummary] Found ${users.length} users`);

  let processed = 0;
  let failed = 0;

  const results = await Promise.allSettled(
    users.map(async (user) => {
      const { rows: habits } = await pool.query<HabitWeekRow>(
        `SELECT h.id, h.title, h.current_streak, h.frequency, h.custom_days,
                COUNT(hl.id) FILTER (
                  WHERE hl.log_date BETWEEN $1 AND $2 AND hl.is_undone = false
                ) AS completions_this_week
         FROM habits h
         LEFT JOIN habit_logs hl ON hl.habit_id = h.id
         WHERE h.user_id = $3 AND h.status = 'active'
         GROUP BY h.id`,
        [weekStartDate, weekEndStr, user.id]
      );

      if (habits.length === 0) return;

      const habitsData = habits.map((h) => ({
        title: h.title,
        completionsThisWeek: parseInt(h.completions_this_week, 10),
        totalScheduled: calculateTotalScheduled(
          h.frequency,
          h.custom_days,
          weekStart
        ),
        currentStreak: h.current_streak,
      }));

      const displayName = user.email.split('@')[0];
      const message = await generateWeeklySummary({ displayName, habitsData });

      await pool.query(
        `INSERT INTO notifications (user_id, type, title, message, delivery_channel, scheduled_for)
         VALUES ($1, 'weekly_summary', 'Your Weekly Habit Summary', $2, 'both', $3)
         ON CONFLICT DO NOTHING`,
        [user.id, message, weekStartDate]
      );

      if (user.email_notifications) {
        await sendWeeklySummaryEmail(user.email, message);
      }
    })
  );

  for (const result of results) {
    if (result.status === 'fulfilled') {
      processed++;
    } else {
      failed++;
      console.error('[WeeklySummary] Failed processing user:', result.reason);
    }
  }

  console.log(
    `[WeeklySummary] week=${weekKey}: processed=${processed}, failed=${failed}`
  );
}

// ─── Register scheduled jobs ─────────────────────────────────────────────────

export function registerCronJobs(): void {
  // Nightly roast check — 11pm UTC every day
  schedule('0 23 * * *', async () => {
    const date = new Date().toISOString().split('T')[0];
    try {
      await runRoastCheck(date);
    } catch (error: unknown) {
      console.error('[Cron] Unhandled error in runRoastCheck:', error);
    }
  });

  // Weekly summary — 8pm UTC every Sunday
  schedule('0 20 * * 0', async () => {
    // Compute the start of the current week (Sunday)
    const now = new Date();
    const sunday = new Date(now);
    sunday.setUTCDate(now.getUTCDate() - now.getUTCDay());
    const weekStartDate = sunday.toISOString().split('T')[0];
    try {
      await runWeeklySummary(weekStartDate);
    } catch (error: unknown) {
      console.error('[Cron] Unhandled error in runWeeklySummary:', error);
    }
  });

  console.log('[Cron] Jobs registered: roast@23:00 UTC, weekly-summary@20:00 UTC Sundays');
}
