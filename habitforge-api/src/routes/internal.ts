import { Router, Request, Response, NextFunction } from 'express';
import { runRoastCheck, runWeeklySummary } from '../services/cron';

const router: Router = Router();

// Guard: all internal routes require a valid CRON_SECRET header
function requireCronSecret(req: Request, res: Response, next: NextFunction): void {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    res.status(500).json({ error: 'CRON_SECRET is not configured on the server' });
    return;
  }
  if (req.headers['x-cron-secret'] !== secret) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
}

router.use(requireCronSecret);

// POST /api/internal/cron/roast-check
// Body: { date?: string }  — date defaults to today (UTC)
router.post('/cron/roast-check', async (req: Request, res: Response) => {
  const date: string =
    typeof req.body.date === 'string'
      ? req.body.date
      : new Date().toISOString().split('T')[0];

  try {
    await runRoastCheck(date);
    res.json({ ok: true, date });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Internal] /cron/roast-check failed:', error);
    res.status(500).json({ error: message });
  }
});

// POST /api/internal/cron/weekly-summary
// Body: { weekStartDate?: string }  — defaults to the most recent Sunday (UTC)
router.post('/cron/weekly-summary', async (req: Request, res: Response) => {
  let weekStartDate: string;

  if (typeof req.body.weekStartDate === 'string') {
    weekStartDate = req.body.weekStartDate;
  } else {
    const now = new Date();
    const sunday = new Date(now);
    sunday.setUTCDate(now.getUTCDate() - now.getUTCDay());
    weekStartDate = sunday.toISOString().split('T')[0];
  }

  try {
    await runWeeklySummary(weekStartDate);
    res.json({ ok: true, weekStartDate });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Internal] /cron/weekly-summary failed:', error);
    res.status(500).json({ error: message });
  }
});

export default router;
