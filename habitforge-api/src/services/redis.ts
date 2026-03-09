import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export default redis;

/**
 * Increment the streak counter for a user's habit
 * @returns The new streak value
 */
export async function incrementStreak(
  userId: string,
  habitId: string
): Promise<number> {
  const key = `streak:${userId}:${habitId}`;
  const newStreak = await redis.incr(key);
  return newStreak;
}

/**
 * Reset the streak counter to 0
 */
export async function resetStreak(
  userId: string,
  habitId: string
): Promise<void> {
  const key = `streak:${userId}:${habitId}`;
  await redis.set(key, 0);
}

/**
 * Get the current streak value
 * @returns The streak value, or 0 if key does not exist
 */
export async function getStreak(
  userId: string,
  habitId: string
): Promise<number> {
  const key = `streak:${userId}:${habitId}`;
  const streak = await redis.get<number>(key);
  return streak ?? 0;
}

/**
 * Initialize a streak counter to 0 only if it doesn't already exist
 */
export async function initStreak(
  userId: string,
  habitId: string
): Promise<void> {
  const key = `streak:${userId}:${habitId}`;
  await redis.set(key, 0, { nx: true });
}

/**
 * Decrement the streak counter, ensuring it never goes below 0
 * @returns The new streak value
 */
export async function decrementStreak(
  userId: string,
  habitId: string
): Promise<number> {
  const key = `streak:${userId}:${habitId}`;
  const newStreak = await redis.decr(key);
  
  if (newStreak < 0) {
    await redis.set(key, 0);
    return 0;
  }
  
  return newStreak;
}

/**
 * Acquire a distributed lock for cron jobs
 * @param lockKey The unique lock identifier
 * @param ttlSeconds Time-to-live in seconds
 * @returns true if lock was acquired, false if already held
 */
export async function acquireCronLock(
  lockKey: string,
  ttlSeconds: number
): Promise<boolean> {
  const result = await redis.set(lockKey, '1', {
    nx: true,
    ex: ttlSeconds,
  });
  return result === 'OK';
}

/**
 * Check if an IP address has exceeded the rate limit
 * @param ip The IP address to check
 * @param limitPerMinute Maximum requests allowed per minute
 * @returns true if under limit, false if exceeded
 */
export async function checkRateLimit(
  ip: string,
  limitPerMinute: number
): Promise<boolean> {
  const currentMinute = Math.floor(Date.now() / 60000);
  const key = `ratelimit:${ip}:${currentMinute}`;
  
  const count = await redis.incr(key);
  
  if (count === 1) {
    await redis.expire(key, 60);
  }
  
  return count <= limitPerMinute;
}
