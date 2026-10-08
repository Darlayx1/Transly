import { z } from 'zod';
import { readBody, readCredentials, credentialCookie, clearCookie, errorResponse, json, isPagesRequest } from '@/lib/transly/server';
import { vaultStatus, requireOwner, addKey, updateKey, removeKey, saveSettings, testKey, rotateVault, rateLimit } from '@/lib/transly/vault';
export async function GET(request: Request) {
  try { return json(await vaultStatus(request)); } catch (e) { return errorResponse(e); }
}
export async function POST(request: Request) {
  try {
    const body = await readBody(request);
    if (body && typeof body === 'object' && 'action' in body) {
      const owner = requireOwner(request);
      await rateLimit(owner, 'management', 30);
      const action = z.enum(['add', 'update', 'remove', 'settings', 'test', 'rotate', 'migrate']).parse(body.action);
      if (action === 'add') await addKey(owner, body);
      if (action === 'update') await updateKey(owner, body);
      if (action === 'remove') await removeKey(owner, z.string().uuid().parse(body.id));
      if (action === 'settings') await saveSettings(owner, body);
      if (action === 'test') await testKey(owner, z.string().uuid().parse(body.id), z.string().parse(body.model));
      if (action === 'rotate') await rotateVault(owner);
      if (action === 'migrate') {
        const legacy = await readCredentials(request);
        if (legacy) {
          const entries = legacy.generator === legacy.evaluator ? [{ name: 'Key sesi sebelumnya', role: 'both', secret: legacy.generator }] : [{ name: 'Pembuat soal sebelumnya', role: 'generator', secret: legacy.generator }, { name: 'Evaluator sebelumnya', role: 'evaluator', secret: legacy.evaluator }];
          for (const entry of entries) {
            try { await addKey(owner, { ...entry, project: '', priority: 1, enabled: true }); }
            catch (e) { if (!(e instanceof Error && 'code' in e && e.code === 'DUPLICATE_KEY')) throw e; }
          }
        }
        return json({ saved: true, ...await vaultStatus(request) }, 200, { 'Set-Cookie': clearCookie(request) });
      }
      return json({ saved: true, ...await vaultStatus(request) });
    }
    const data = z.object({ generator: z.string().trim().min(20).max(256), evaluator: z.string().trim().min(20).max(256) }).parse(body);
    const cookie = await credentialCookie(request, data.generator, data.evaluator);
    if (isPagesRequest(request)) return json({ saved: true, sessionToken: cookie.split(';')[0].slice('transly_credentials='.length) });
    return json({ saved: true }, 200, { 'Set-Cookie': cookie });
  } catch (e) { return errorResponse(e); }
}
export async function DELETE(request: Request) {
  try { await readBody(request); return json({ removed: true }, 200, { 'Set-Cookie': clearCookie(request) }); }
  catch (e) { return errorResponse(e); }
}
