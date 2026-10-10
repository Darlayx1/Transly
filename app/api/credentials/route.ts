import { z } from 'zod';
import { clientCredentialSchema } from '@/lib/transly/credential-schema';
import { readBody, readCredentials, credentialCookie, clearCookie, errorResponse, json, isPagesRequest, AppError } from '@/lib/transly/server';
import { vaultStatus, requireOwner, addKey, updateKey, removeKey, saveSettings, testKey, rotateVault, rateLimit, getKeys } from '@/lib/transly/vault';
import { unseal } from '@/lib/transly/vault-crypto';
export async function GET(request: Request) {
  try { return json(await vaultStatus(request)); } catch (e) { return errorResponse(e); }
}
export async function POST(request: Request) {
  try {
    const body = await readBody(request);
    if (body && typeof body === 'object' && 'action' in body) {
      const owner = await requireOwner(request);
      await rateLimit(owner, 'management', 30);
      const action = z.enum(['add', 'update', 'remove', 'settings', 'test', 'rotate', 'migrate', 'import_keys']).parse(body.action);
      let addedId: string | undefined;
      if (action === 'add') addedId = await addKey(owner, body);
      if (action === 'update') await updateKey(owner, body);
      if (action === 'remove') await removeKey(owner, z.string().uuid().parse(body.id));
      if (action === 'settings') await saveSettings(owner, body);
      if (action === 'test') await testKey(owner, z.string().uuid().parse(body.id), z.string().parse(body.model));
      if (action === 'rotate') await rotateVault(owner);
      if (action === 'import_keys') {
        const keysInput = z.array(z.object({
          name: z.string().min(1).max(60),
          secret: z.string().min(20).max(256),
          role: z.enum(['generator', 'evaluator', 'both']).default('both'),
          priority: z.number().int().min(1).max(100).default(1),
        })).parse(body.keys);
        for (const item of keysInput) {
          try { await addKey(owner, item); }
          catch (e) { if (!(e instanceof Error && 'code' in e && e.code === 'DUPLICATE_KEY')) throw e; }
        }
        return json({ saved: true, ...await vaultStatus(request) });
      }
      if (action === 'migrate') {
        if (body.source === 'chatgpt') {
          const chatgptId = request.headers.get('oai-authenticated-user-id');
          if (!chatgptId) {
            throw new AppError('FORBIDDEN', 'Data brankas dengan identitas ChatGPT memerlukan pengaitan akun yang terverifikasi sebelum migrasi.', 403);
          }
          // Copy keys from verified ChatGPT vault to this account vault
          const chatgptKeys = await getKeys(chatgptId);
          for (const key of chatgptKeys) {
            try {
              // Add key preserving metadata
              await addKey(owner, { name: key.name, secret: await unseal(key.ciphertext, `transly:key:${chatgptId}:${key.id}`), role: key.role, priority: key.priority, project: key.project, provider: key.provider });
            } catch (e) {
              if (!(e instanceof Error && 'code' in e && e.code === 'DUPLICATE_KEY')) throw e;
            }
          }
          return json({ saved: true, ...await vaultStatus(request) });
        }
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
      return json({ saved: true, ...(addedId ? { addedId } : {}), ...await vaultStatus(request) });
    }
    const data = clientCredentialSchema.parse(body);
    const cookie = await credentialCookie(request, data);
    const sessionToken = cookie.split(';')[0].slice('transly_credentials='.length);
    return json({ saved: true, sessionToken, ...(await vaultStatus(request)) }, 200, { 'Set-Cookie': cookie });
  } catch (e) { return errorResponse(e); }
}
export async function DELETE(request: Request) {
  try {
    await readBody(request);
    return json({ removed: true, sessionToken: '' }, 200, { 'Set-Cookie': clearCookie(request) });
  } catch (e) { return errorResponse(e); }
}
