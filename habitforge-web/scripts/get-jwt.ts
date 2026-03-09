/**
 * Fetches a JWT (access_token) for a Supabase user — for local/testing use only.
 * Run from habitforge-web: pnpm run get-jwt
 * Requires .env.local with NEXT_PUBLIC_SUPABASE_URL and anon key.
 */

import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

// Load .env.local (no dotenv dependency)
function loadEnvLocal(): void {
  const paths = [
    resolve(process.cwd(), '.env.local'),
    resolve(process.cwd(), 'habitforge-web/.env.local'),
  ];
  for (const p of paths) {
    if (existsSync(p)) {
      const content = readFileSync(p, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const idx = trimmed.indexOf('=');
          if (idx > 0) {
            const key = trimmed.slice(0, idx).trim();
            const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
            if (!(key in process.env)) process.env[key] = val;
          }
        }
      }
      break;
    }
  }
}
loadEnvLocal();

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY;

const TEST_EMAIL = 'abc@mail.com';
const TEST_PASSWORD = '12345678';

async function signInAndGetJwt(email: string, password: string) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      'Missing SUPABASE_URL or anon key. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY) in .env.local'
    );
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    throw error;
  }

  const jwt = data?.session?.access_token ?? null;
  return { jwt, session: data.session };
}

(async () => {
  try {
    const { jwt, session } = await signInAndGetJwt(TEST_EMAIL, TEST_PASSWORD);
    console.log('JWT (access_token):', jwt ?? '(null)');
    console.log('Full session object:', JSON.stringify(session, null, 2));
  } catch (err) {
    console.error('Sign-in failed:', err);
    process.exit(1);
  }
})();
