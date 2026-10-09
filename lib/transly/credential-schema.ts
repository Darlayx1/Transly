import { z } from 'zod';

const secret = z.string().trim().min(20).max(256).regex(/^[\x21-\x7E]+$/);
export const clientCredentialSchema = z.object({
  gemini: secret.optional(),
  generator: secret.optional(),
  evaluator: secret.optional(),
}).refine(data => Boolean(data.gemini || data.generator || data.evaluator));
