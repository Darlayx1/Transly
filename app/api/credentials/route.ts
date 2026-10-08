import { z } from 'zod';
import { readBody, readCredentials, credentialCookie, clearCookie, hasServerKey, errorResponse, json, isPagesRequest } from '@/lib/transly/server';
export async function GET(request: Request) {
  const c = await readCredentials(request);
  return json({ generator: Boolean(c?.generator) || hasServerKey(), evaluator: Boolean(c?.evaluator) || hasServerKey(), custom: Boolean(c), server: hasServerKey() });
}
export async function POST(request: Request) {
  try {
    const data = z.object({ generator: z.string().trim().min(20).max(256), evaluator: z.string().trim().min(20).max(256) }).parse(await readBody(request));
    const cookie = await credentialCookie(request, data.generator, data.evaluator);
    if (isPagesRequest(request)) return json({ saved: true, sessionToken: cookie.split(';')[0].slice('transly_credentials='.length) });
    return json({ saved: true }, 200, { 'Set-Cookie': cookie });
  } catch (e) { return errorResponse(e); }
}
export async function DELETE(request: Request) {
  try { await readBody(request); return json({ removed: true }, 200, { 'Set-Cookie': clearCookie(request) }); }
  catch (e) { return errorResponse(e); }
}
