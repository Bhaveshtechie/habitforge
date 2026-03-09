import { Request, Response, NextFunction } from 'express'

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const message = err.message ?? 'Internal server error'
  console.error('[errorHandler]', err)
  res.status(500).json({ error: message, code: 'INTERNAL_ERROR' })
}
