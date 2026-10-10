import { env } from 'cloudflare:workers';
import { formatAccountOwner, type StorageOwner } from './owner';

const runtime = env as unknown as {
  SUPABASE_JWT_SECRET?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
};

type VerifiedAccount = {
  userId: string;
  email: string;
  owner: `account:${string}`;
};

type CachedAuth = {
  account: VerifiedAccount;
  expiresAt: number;
};

const authCache = new Map<string, CachedAuth>();

function getEnv(name: string): string | undefined {
  if (typeof runtime !== 'undefined' && runtime && (name in runtime)) {
    return (runtime as Record<string, string | undefined>)[name];
  }
  if (typeof process !== 'undefined' && process.env) {
    return process.env[name];
  }
  return undefined;
}

const b64UrlToBytes = (b64: string): Uint8Array<ArrayBuffer> => {
  const binary = atob(b64.replaceAll('-', '+').replaceAll('_', '/'));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

export function extractLoginToken(request: Request): string | null {
  const authHeader = request.headers.get('x-transly-auth') || request.headers.get('authorization');
  if (!authHeader) return null;
  const match = authHeader.match(/^(?:Bearer\s+)?([A-Za-z0-9_.-]+)$/);
  if (!match) return null;
  const token = match[1];
  // A Supabase JWT has 3 parts separated by dots.
  if (token.split('.').length !== 3) return null;
  return token;
}

export function decodeJwtPayload(token: string): { sub?: string; email?: string; exp?: number; role?: string } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const jsonStr = new TextDecoder().decode(b64UrlToBytes(parts[1]));
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

export async function verifySupabaseToken(token: string): Promise<VerifiedAccount | null> {
  const payload = decodeJwtPayload(token);
  if (!payload || !payload.sub || typeof payload.sub !== 'string') return null;

  // Check token expiration
  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp <= nowSec) {
    return null;
  }

  // Check verification cache (by token signature)
  const parts = token.split('.');
  const cacheKey = parts[2];
  const cached = authCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.account;
  }

  // Check test environment hook
  const globalEnv = globalThis as unknown as { __accountAuthMock?: (token: string) => VerifiedAccount | null; __vaultTestEnv?: unknown };
  if (globalEnv.__accountAuthMock) {
    const mock = globalEnv.__accountAuthMock(token);
    if (mock) return mock;
  }
  if (process.env.NODE_ENV === 'test' || globalEnv.__vaultTestEnv) {
    if (payload.sub) {
      const account: VerifiedAccount = {
        userId: payload.sub,
        email: payload.email || `${payload.sub}@test.invalid`,
        owner: formatAccountOwner(payload.sub),
      };
      return account;
    }
  }

  // 1. Verify with SUPABASE_JWT_SECRET if available
  const jwtSecret = getEnv('SUPABASE_JWT_SECRET');
  if (jwtSecret && jwtSecret.length >= 16) {
    try {
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(jwtSecret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['verify']
      );
      const dataToVerify = encoder.encode(`${parts[0]}.${parts[1]}`);
      const signatureBytes = b64UrlToBytes(parts[2]);
      const valid = await crypto.subtle.verify('HMAC', key, signatureBytes, dataToVerify);
      if (valid) {
        const account: VerifiedAccount = {
          userId: payload.sub,
          email: payload.email || '',
          owner: formatAccountOwner(payload.sub),
        };
        const ttlMs = Math.min(60000, (payload.exp ? payload.exp * 1000 - Date.now() : 60000));
        authCache.set(cacheKey, { account, expiresAt: Date.now() + Math.max(1000, ttlMs) });
        return account;
      }
    } catch {
      // Fall through to API check
    }
  }

  // 2. Authoritative check via Supabase Auth API
  const supabaseUrl = getEnv('NEXT_PUBLIC_SUPABASE_URL') || getEnv('SUPABASE_URL');
  const supabaseKey = getEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY') || getEnv('SUPABASE_ANON_KEY');

  if (supabaseUrl && supabaseKey) {
    try {
      const endpoint = `${supabaseUrl.replace(/\/+$/, '')}/auth/v1/user`;
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: supabaseKey,
        },
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        const user = (await response.json()) as { id: string; email?: string };
        if (user && user.id === payload.sub) {
          const account: VerifiedAccount = {
            userId: user.id,
            email: user.email || payload.email || '',
            owner: formatAccountOwner(user.id),
          };
          const ttlMs = Math.min(60000, (payload.exp ? payload.exp * 1000 - Date.now() : 60000));
          authCache.set(cacheKey, { account, expiresAt: Date.now() + Math.max(1000, ttlMs) });
          return account;
        }
      }
    } catch {
      // Supabase verification error
    }
  }

  return null;
}

export async function getVerifiedAccount(request: Request): Promise<VerifiedAccount | null> {
  const token = extractLoginToken(request);
  if (!token) return null;
  return verifySupabaseToken(token);
}
