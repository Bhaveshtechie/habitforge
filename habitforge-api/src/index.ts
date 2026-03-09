import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'

import { errorHandler } from './middleware/errorHandler'
import { registerCronJobs } from './services/cron'
import habitsRouter from './routes/habits'
import logsRouter from './routes/logs'
import tasksRouter from './routes/tasks'
import calendarRouter from './routes/calendar'
import notificationsRouter from './routes/notifications'
import preferencesRouter from './routes/preferences'
import internalRouter from './routes/internal'

const app = express()

const frontendUrl = process.env.FRONTEND_URL ?? ''
app.use(
  cors({
    origin: frontendUrl,
    credentials: true,
  })
)
app.use(helmet())
app.use(express.json())
app.use(cookieParser())

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() })
})

app.use('/api/habits', habitsRouter)
app.use('/api/logs', logsRouter)
app.use('/api/tasks', tasksRouter)
app.use('/api/calendar', calendarRouter)
app.use('/api/notifications', notificationsRouter)
app.use('/api/preferences', preferencesRouter)
app.use('/api/internal', internalRouter)

app.use(errorHandler)

const port = Number(process.env.PORT) || 8080
app.listen(port, () => {
  console.log(`HabitForge API listening on port ${port}`)
  registerCronJobs()
})
