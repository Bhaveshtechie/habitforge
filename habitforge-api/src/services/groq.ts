import Groq from 'groq-sdk';
import { z } from 'zod';

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY!,
});

/**
 * Strip newlines and non-printable ASCII so user-supplied text cannot
 * inject system-prompt overrides or role-switch sequences into LLM calls.
 */
function sanitizeForPrompt(input: string, maxLength = 500): string {
  return input
    .replace(/[\r\n]+/g, ' ')
    .replace(/[^\x20-\x7E]/g, '')
    .trim()
    .slice(0, maxLength);
}

const habitPlanOutputSchema = z.object({
  title: z.string().min(1),
  description: z.string(),
  scheduledTime: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  frequency: z.enum(['daily', 'weekdays', 'weekends', 'custom']),
  customDays: z.array(z.number().int().min(0).max(6)).nullable(),
  durationMinutes: z.number().int().positive(),
  phases: z.array(
    z.object({
      phaseNumber: z.number().int().positive(),
      title: z.string().min(1),
      startDay: z.number().int().positive(),
      endDay: z.number().int().positive(),
      dailyTarget: z.string().min(1),
      milestone: z.string().min(1),
    })
  ).min(1),
});

export interface HabitPhase {
  phaseNumber: number;
  title: string;
  startDay: number;
  endDay: number;
  dailyTarget: string;
  milestone: string;
}

export interface HabitPlan {
  title: string;
  description: string;
  scheduledTime: string | null;
  frequency: 'daily' | 'weekdays' | 'weekends' | 'custom';
  customDays: number[] | null;
  durationMinutes: number;
  phases: HabitPhase[];
}

export interface HabitContext {
  why: string;
  timeAvailable: string;
  triedBefore: string;
}

export async function generateHabitPlan(
  goal: string,
  context: HabitContext
): Promise<HabitPlan> {
  const systemPrompt = `You are an elite habit formation coach combining behavioral science (BJ Fogg, James Clear, the 66-day automaticity model) with progressive overload and cognitive behavioral techniques. Generate a structured 66-day habit plan as valid JSON only. No markdown, no explanation — only the raw JSON object.

Plan quality standards you MUST follow:
- title: Short, specific, action-oriented (e.g. "Morning Run — 5K in 66 Days", NOT "Running Habit"). Reflect the exact goal.
- description: 2–3 sentences written directly to the user. Reference their WHY. Acknowledge past struggles if they shared any. Make it feel personal and motivating, not generic.
- durationMinutes: Realistic daily time commitment based on what they said. Do not default to 30; calibrate to their available time.
- scheduledTime: Infer from context clues (e.g. "morning" → "07:00", "after work" → "18:30"). Use null if truly ambiguous.
- frequency: Choose based on the habit type. Fitness, reading, meditation → "daily". Work-skill habits → "weekdays". Use "custom" only when explicitly requested.
- phases (3–4 total, covering all 66 days):
  - title: Evocative name reflecting the psychological stage (e.g. "Spark the Chain", "Building Momentum", "Locking It In", "Owning It"). NOT generic labels like "Phase 1".
  - dailyTarget: Exact, measurable action with duration/reps/output. Be concrete (e.g. "Run 1.5 km at a conversational pace — walk breaks allowed", NOT "Go for a run"). Calibrate to their time budget.
  - milestone: An observable behavioral or psychological checkpoint they will feel (e.g. "You lace up your shoes without internal negotiation — the habit has a groove", NOT "Complete all sessions"). Make it human and specific.`;

  const safeGoal = sanitizeForPrompt(goal, 500);
  const safeWhy = sanitizeForPrompt(context.why, 300);
  const safeTime = sanitizeForPrompt(context.timeAvailable, 100);
  const safeTried = sanitizeForPrompt(context.triedBefore, 300);

  const userPrompt = `User's habit goal: ${safeGoal}

Their context:
- Why this matters: ${safeWhy}
- Time available per day: ${safeTime}
- Prior attempts: ${safeTried}

Return ONLY a valid JSON object with this exact structure (no markdown, no extra keys):
{
  "title": "string",
  "description": "string",
  "scheduledTime": "HH:MM" or null,
  "frequency": "daily" | "weekdays" | "weekends" | "custom",
  "customDays": [0,1,2,3,4,5,6] or null,
  "durationMinutes": number,
  "phases": [
    {
      "phaseNumber": 1,
      "title": "string",
      "startDay": 1,
      "endDay": 21,
      "dailyTarget": "string",
      "milestone": "string"
    }
  ]
}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const completion = await groq.chat.completions.create(
      {
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 2000,
        temperature: 0.65,
      },
      { signal: controller.signal }
    );

    clearTimeout(timeoutId);

    const responseText = completion.choices[0]?.message?.content;
    if (!responseText) {
      throw new Error('Empty response from AI');
    }

    const parsed = habitPlanOutputSchema.safeParse(JSON.parse(responseText));
    if (!parsed.success) {
      throw new Error(`AI returned an invalid plan structure: ${parsed.error.message}`);
    }
    return parsed.data;
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      const timeoutError = new Error('AI service timeout');
      (timeoutError as Error & { code: string }).code = 'LLM_TIMEOUT';
      throw timeoutError;
    }
    throw error;
  }
}

export interface ParsedHabitInput {
  goal: string;
  why: string;
  timeAvailable: string;
  triedBefore: string;
  isComplete: boolean;
  followUp: string | null;
}

const parsedHabitInputSchema = z.object({
  goal: z.string(),
  why: z.string(),
  timeAvailable: z.string(),
  triedBefore: z.string(),
  isComplete: z.boolean(),
  followUp: z.string().nullable(),
});

export async function parseHabitInput(
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>
): Promise<ParsedHabitInput> {
  const systemPrompt = `You are a habit coach intake assistant. Extract key information from a user's conversation about building a habit.

Extract these 4 fields:
- goal: The specific habit or behavior they want to build
- why: Their motivation, reason, or desired outcome
- timeAvailable: How much time per day they can commit
- triedBefore: Any prior attempts at this habit (set to "First attempt" if nothing is mentioned)

Rules:
- Extract only what the user clearly stated. Leave as empty string "" if genuinely not provided.
- Be generous in interpretation — if someone says "I want to get fit by running", that covers both goal AND partially why.
- timeAvailable: Accept rough estimates ("20 mins", "half hour", "an hour after lunch"). Empty string only if truly not mentioned.
- triedBefore: If the user hasn't mentioned prior attempts at all, set to "First attempt" (not empty).
- isComplete: true only if goal, why, and timeAvailable are all non-empty. triedBefore defaults so never blocks completion.
- followUp: If isComplete is false, write ONE friendly, conversational message that asks ALL missing questions together as a numbered list. Keep the tone warm and concise. If isComplete is true, set to null.

Return ONLY valid JSON. No markdown. No extra text.`;

  const safeHistory = conversationHistory.map((m) => ({
    role: m.role,
    content: sanitizeForPrompt(m.content, 500),
  }));

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
    ...safeHistory,
    {
      role: 'user',
      content:
        'Based on our conversation so far, extract the habit info and return the JSON object.',
    },
  ];

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const completion = await groq.chat.completions.create(
      {
        model: 'llama-3.3-70b-versatile',
        messages,
        max_tokens: 600,
        temperature: 0.3,
      },
      { signal: controller.signal }
    );

    clearTimeout(timeoutId);

    const responseText = completion.choices[0]?.message?.content;
    if (!responseText) throw new Error('Empty response from AI');

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in parse response');

    const parsed = parsedHabitInputSchema.safeParse(JSON.parse(jsonMatch[0]));
    if (!parsed.success) {
      throw new Error(`Invalid parse response structure: ${parsed.error.message}`);
    }
    return parsed.data;
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      const timeoutError = new Error('AI service timeout');
      (timeoutError as Error & { code: string }).code = 'LLM_TIMEOUT';
      throw timeoutError;
    }
    throw error;
  }
}

type RoastTone =
  | 'drill_sergeant'
  | 'disappointed_parent'
  | 'anime_sensei'
  | 'best_friend'
  | 'stoic_philosopher';

const TONE_PERSONAS: Record<RoastTone, string> = {
  drill_sergeant:
    'You are an aggressive military drill sergeant. No sympathy. Short, sharp commands.',
  disappointed_parent:
    'You are a loving parent deeply disappointed but not angry. Guilt-trip energy.',
  anime_sensei:
    'You are a dramatic anime sensei (think Naruto/Rock Lee). Philosophical, intense motivation.',
  best_friend:
    'You are a close friend casually roasting them. Warm but brutally honest.',
  stoic_philosopher:
    'You are Marcus Aurelius. Cold logic. Reference time, discipline, legacy.',
};

export async function generateRoastMessage(params: {
  habitTitle: string;
  currentStreak: number;
  daysMissed: number;
  tone: RoastTone;
}): Promise<string> {
  const { habitTitle, currentStreak, daysMissed, tone } = params;
  const systemPrompt = TONE_PERSONAS[tone];
  const safeTitle = sanitizeForPrompt(habitTitle, 200);
  const userPrompt = `The user missed their habit '${safeTitle}'. Current streak: ${currentStreak} days. Days missed: ${daysMissed}. Write a single accountability message (2-4 sentences max) in character. Reference the specific habit by name. Do not use hashtags or emojis.`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const completion = await groq.chat.completions.create(
      {
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 200,
        temperature: 0.8,
      },
      { signal: controller.signal }
    );

    clearTimeout(timeoutId);

    const text = completion.choices[0]?.message?.content;
    if (!text) throw new Error('Empty roast response from AI');
    return text.trim();
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      const timeoutError = new Error('AI roast timeout');
      (timeoutError as Error & { code: string }).code = 'LLM_TIMEOUT';
      throw timeoutError;
    }
    throw error;
  }
}

export async function generateWeeklySummary(params: {
  displayName: string;
  habitsData: Array<{
    title: string;
    completionsThisWeek: number;
    totalScheduled: number;
    currentStreak: number;
  }>;
}): Promise<string> {
  const { displayName, habitsData } = params;

  const systemPrompt =
    'You are a warm, encouraging habit coach. Write personal, data-driven weekly summaries that feel human — not robotic. Reference specific habit names and actual numbers. Keep it motivating even when results are poor.';

  const safeDisplayName = sanitizeForPrompt(displayName, 100);
  const habitLines = habitsData
    .map(
      (h) =>
        `- "${sanitizeForPrompt(h.title, 200)}": ${h.completionsThisWeek}/${h.totalScheduled} days completed, current streak ${h.currentStreak} days`
    )
    .join('\n');

  const userPrompt = `Write a warm, personal 3-4 sentence weekly summary for ${safeDisplayName}. Reference specific habits by name and actual numbers. Here is their week:\n${habitLines}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const completion = await groq.chat.completions.create(
      {
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 300,
        temperature: 0.7,
      },
      { signal: controller.signal }
    );

    clearTimeout(timeoutId);

    const text = completion.choices[0]?.message?.content;
    if (!text) throw new Error('Empty weekly summary response from AI');
    return text.trim();
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      const timeoutError = new Error('AI weekly summary timeout');
      (timeoutError as Error & { code: string }).code = 'LLM_TIMEOUT';
      throw timeoutError;
    }
    throw error;
  }
}
