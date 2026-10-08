import { z } from 'zod';
import { readBody, json, errorResponse } from '@/lib/transly/server';
import { requireOwner, rateLimit } from '@/lib/transly/vault';
import { exportBackup, importBackup } from '@/lib/transly/vault-backup';
export async function POST(request: Request) {
  try {
    const owner = requireOwner(request);
    await rateLimit(owner, 'backup', 4);
    const body = z.object({ action: z.enum(['export', 'import']), wrappingKey: z.string().regex(/^[A-Za-z0-9+/]{43}=$/), salt: z.string().max(64), backup: z.unknown().optional() }).parse(await readBody(request, 130000));
    if (body.action === 'export') return json({ backup: await exportBackup(owner, body.wrappingKey, body.salt) });
    return json(await importBackup(owner, body.wrappingKey, body.backup));
  } catch (error) { return errorResponse(error); }
}
