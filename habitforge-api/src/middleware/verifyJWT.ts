import { createClient } from '@supabase/supabase-js'
import { Request, Response, NextFunction } from 'express'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function verifyJWT(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.['sb-access-token']
  if (!token) return res.status(401).json({ error: 'Unauthorized', code: 'MISSING_TOKEN' })

  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return res.status(401).json({ error: 'Invalid token', code: 'INVALID_TOKEN' })

  ;(req as Request & { user: { id: string; email: string } }).user = {
    id: data.user.id,
    email: data.user.email!,
  }
  next()
}