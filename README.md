# ⚡ HabitForge

> **Tell it what habit you want to build. It handles the rest.**

HabitForge is an AI-powered habit lifecycle manager. You describe a goal in plain English — the AI researches habit-formation science, generates a personalised phased plan, populates your calendar, tracks your streaks, and roasts you (in your chosen tone) when you slip up.

Built as a portfolio-grade full-stack project demonstrating end-to-end AI integration, real-time state management, and production-quality system design.

---

## ✨ What It Does

| Feature | Description |
|---|---|
| 🤖 **AI Habit Planner** | Conversational onboarding — describe your goal, answer 3 questions, get a science-backed 66-day phased plan |
| 📅 **Auto-populated Calendar** | Accept the plan → calendar fills itself. No manual entry. |
| 🔥 **Streak Tracking** | Per-habit streaks with heatmap view (GitHub-style). Atomic Redis counters. |
| 🎭 **Roast Engine** | Missed a habit? The AI sends a personalised accountability message in your chosen tone — Drill Sergeant, Anime Sensei, Disappointed Parent, Stoic Philosopher, or Best Friend |
| ✅ **Task Manager** | One-time and recurring tasks (RRULE), linked to habits, with Kanban view |
| 🔔 **Smart Notifications** | In-app inbox + email delivery. Deduplication guaranteed at both Redis lock and DB constraint level |

---

## 🏗️ Architecture

```
[ Browser / PWA ]
      │  HTTPS
      ▼
[ Next.js 16 — Vercel ]          ← Server Components, Route Handlers, httpOnly JWT cookie
      │  REST
      ▼
[ Express API — Render ]
  ├── verifyJWT middleware        ← Supabase JWKS RS256 validation
  ├── rateLimit middleware        ← Redis sliding window (100 req/min)
  ├── /habits    ──────────────► PostgreSQL
  ├── /logs      ──────────────► PostgreSQL + Redis (atomic INCR streak)
  ├── /tasks     ──────────────► PostgreSQL
  ├── /calendar  ──────────────► PostgreSQL (habits + tasks combined)
  ├── /ai        ──────────────► Groq API  (streamed, server-side consumed)
  ├── /notifs    ──────────────► PostgreSQL + Resend
  └── CronWorker ──────────────► Redis lock → PG → Groq → Resend
```

**Three things that make this non-trivial:**

1. **Two-step habit creation** — `POST /habits/ai-plan` stores a `pending` plan. `POST /habits/:id/activate` locks it in. User reviews before committing; no orphaned data from incomplete AI flows.
2. **Redis NX cron lock** — `SET cron:roast:{date} NX EX 86400` ensures only one instance fires roasts per night, even across Render restarts. Classic distributed lock pattern.
3. **Client-sent log dates** — Check-in requests include the user's local `YYYY-MM-DD`, not server UTC. Without this, IST users checking in at 11pm get logs dated to the next day.

---

## 🛠️ Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Frontend | Next.js 16 (App Router) + Tailwind CSS | RSC, streaming, PWA support |
| Backend | Node.js + Express | Clean async I/O for LLM calls |
| Database | PostgreSQL via Supabase | Relational data + Supabase Auth built-in |
| Cache | Upstash Redis (serverless) | Streak counters, cron locks, rate limiting |
| AI | Groq API — Llama 3.3 70B | Fast inference (~500ms), free tier for dev |
| Auth | Supabase Auth | Google OAuth + email/password, JWT managed |
| Email | Resend | Transactional emails, free dev tier |
| Deploy | Vercel (frontend) + Render (backend) | Both free tiers, zero-config |

---

## 🚀 Getting Started

### Prerequisites

- Node.js 20+
- pnpm (`npm install -g pnpm`)
- [Supabase](https://supabase.com) account (free)
- [Upstash](https://upstash.com) account — create a Redis database (free)
- [Groq](https://console.groq.com) API key (free)
- [Resend](https://resend.com) API key (free)

### 1. Clone and scaffold

```bash
git clone https://github.com/Bhaveshtechie/habitforge
cd habitforge
```

### 2. Install dependencies

```bash
# Frontend
cd habitforge-web && pnpm install

# Backend
cd ../habitforge-api && pnpm install
```

### 3. Set up Supabase

1. Create a new Supabase project
2. Go to **SQL Editor** → paste and run the full schema from `habitforge-api/src/db/migrations/001_initial_schema.sql`
3. The migration includes a trigger that auto-creates a user profile row on signup — no extra setup needed
4. Go to **Settings → API** → copy your Project URL, anon key, service_role key, and JWT secret

### 4. Environment variables

**`habitforge-api/.env`**
```env
PORT=8080
NODE_ENV=development
FRONTEND_URL=http://localhost:3000

# Supabase
SUPABASE_URL=https://yourproject.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
SUPABASE_JWT_SECRET=your_jwt_secret

# Upstash Redis
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=your_token

# AI + Email
GROQ_API_KEY=gsk_...
RESEND_API_KEY=re_...
FROM_EMAIL=roast@yourdomain.com

# Cron security
CRON_SECRET=generate_a_random_32_char_string
```

**`habitforge-web/.env.local`**
```env
NEXT_PUBLIC_SUPABASE_URL=https://yourproject.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
NEXT_PUBLIC_API_URL=http://localhost:8080/api
```

### 5. Run locally

```bash
# Terminal 1 — API server
cd habitforge-api && pnpm dev

# Terminal 2 — Next.js
cd habitforge-web && pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## 📁 Project Structure

```
habitforge/
├── habitforge-web/                # Next.js 16 frontend
│   ├── app/
│   │   ├── (auth)/                # Login, signup (no sidebar)
│   │   └── (dashboard)/           # Today, habits, calendar, tasks, notifications
│   ├── components/
│   │   ├── habits/                # HabitCard, HeatMap, StreakBadge
│   │   ├── chat/                  # AI conversation interface
│   │   ├── tasks/                 # KanbanBoard, TaskCard
│   │   └── calendar/              # Month/week views
│   └── lib/api.ts                 # Typed fetch wrapper → Express
│
└── habitforge-api/                # Express backend
    └── src/
        ├── routes/                # habits, logs, tasks, calendar, notifications, preferences
        ├── middleware/            # verifyJWT, rateLimit, errorHandler
        ├── services/              # groq.ts, redis.ts, email.ts, cron.ts
        └── db/
            ├── queries/           # Named query functions per table
            └── migrations/        # SQL migration files
```

---

## 🗄️ Database Schema

Six tables. The two critical index decisions:

```sql
-- Prevents duplicate check-ins per day per habit (partial unique index)
CREATE UNIQUE INDEX idx_logs_dedup ON habit_logs(habit_id, log_date)
  WHERE is_undone = FALSE;

-- Prevents duplicate roast notifications (DB-level guarantee against cron re-fire)
CREATE UNIQUE INDEX idx_notif_dedup ON
  notifications(user_id, habit_id, type, scheduled_for);
```

Full schema → `habitforge-api/src/db/migrations/001_initial_schema.sql`

### Redis key schema

| Key | Type | TTL | Purpose |
|---|---|---|---|
| `streak:{userId}:{habitId}` | String (int) | None | Live streak counter |
| `cron:roast:{YYYY-MM-DD}` | String | 24h | Nightly cron idempotency lock |
| `cron:weekly:{YYYY-Www}` | String | 7d | Weekly summary lock |
| `ratelimit:{ip}:{minute}` | String (int) | 60s | Per-IP sliding window |

---

## 📡 API Overview

Base URL: `http://localhost:8080/api`

All protected routes require a valid Supabase JWT in an httpOnly cookie.

```
POST   /habits/ai-plan          Generate AI habit plan (review before activating)
POST   /habits/:id/activate     Lock in the plan — starts the 66-day calendar
GET    /habits                  List habits (filterable by status)
GET    /habits/:id              Single habit with full phase plan
PATCH  /habits/:id              Update settings (time, frequency, status)
DELETE /habits/:id              Delete + cascade

POST   /logs                    Daily check-in (increments Redis streak atomically)
DELETE /logs/:id                Undo check-in (same-day only, soft delete)
GET    /logs/heatmap            Completion data for date range (powers GitHub-style heatmap)

POST   /tasks                   Create one-time or recurring task (RRULE)
GET    /tasks                   List (by status for Kanban, by date for calendar)
PATCH  /tasks/:id               Update (auto-generates next recurrence on completion)
DELETE /tasks/:id               Delete (?deleteAll=true removes entire recurring series)

GET    /calendar                Combined habits + tasks for a date range
GET    /notifications           Inbox with unread count
PATCH  /notifications/:id/read  Mark read
POST   /notifications/read-all  Mark all read
GET    /preferences             User settings (tone, reminder time, theme, etc.)
PATCH  /preferences             Update settings

POST   /internal/cron/roast-check      Nightly missed-habit roast trigger (CRON_SECRET)
POST   /internal/cron/weekly-summary   Sunday AI summary (CRON_SECRET)
```

Full spec with request/response schemas in the [Technical Design Document](./docs/HabitForge_TDD.docx).

---

## 🎭 Roast Tones

| Tone | Character | Sample |
|---|---|---|
| Drill Sergeant | Aggressive, military, zero sympathy | *"You missed leg day AGAIN. Drop and give me 20. Right now."* |
| Disappointed Parent | Loving guilt-trip energy | *"I'm not angry. I'm just... I thought you were serious this time."* |
| Anime Sensei | Dramatic, Naruto-level motivation | *"Even Rock Lee never missed training. What is your excuse, student?"* |
| Best Friend | Casual roast, warm | *"Bro you literally said 'this week I'm being serious' last Sunday."* |
| Stoic Philosopher | Cold logic, Marcus Aurelius energy | *"You had 86,400 seconds today. You couldn't find 20 for your future self."* |

All roast messages are LLM-generated — never templated. The AI receives the habit name, current streak, days missed, and tone persona, and generates a fresh contextual message every time.

---

## 🚢 Deployment

### Frontend → Vercel

```bash
cd habitforge-web
pnpm dlx vercel
```

Or connect the GitHub repo in the Vercel dashboard. Add all `.env.local` variables under Project Settings → Environment Variables.

### Backend → Render

1. Create a **Web Service** in Render → connect GitHub repo → set root to `habitforge-api/`
2. Build command: `pnpm install && pnpm build`
3. Start command: `node dist/index.js`
4. Add all `.env` variables in Render dashboard

> **Note:** Render free tier spins down after 15 min of inactivity (~30s cold start). Use [UptimeRobot](https://uptimerobot.com) (free) to ping `/api/health` every 10 minutes during demos.

After deploying, add your Vercel production URL to Supabase → **Authentication → URL Configuration → Redirect URLs**.

---

## 🔒 Security Notes

- JWTs stored in httpOnly cookies — not accessible by JavaScript (XSS-safe)
- Every database query includes `WHERE user_id = $userId` — no cross-user data leakage possible at the query level
- User input is sanitised before LLM prompt injection — system prompt is a fixed template
- Rate limiting on all public endpoints via Redis sliding window
- Internal cron endpoints protected by `CRON_SECRET` header — not reachable from the browser

---

## 🗺️ Roadmap

- [x] AI habit plan generation
- [x] Daily check-in + streak tracking
- [x] Roast engine (5 tones, LLM-generated)
- [x] Calendar view (habits + tasks combined)
- [x] Task manager (one-time + recurring)
- [ ] **Phase 2:** Adaptive plan revision based on completion patterns
- [ ] **Phase 2:** Habit stacking engine
- [ ] **Phase 2:** Google Calendar sync
- [ ] **Phase 2:** Social accountability groups + shared leaderboard
- [ ] **Phase 2:** Voice check-in with sentiment analysis
- [ ] **Phase 2:** Streak shield (earned every 7 days, protects one missed day)

---

## 📄 License

MIT — do whatever you want with it.

---

*Built by Bhavesh — March 2025*