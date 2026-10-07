import { z } from 'zod';
import { levels, models } from './config';

export const modelSchema = z.string().refine(v => models.some(m => m.id === v), 'Model tidak tersedia.');
export const configSchema = z.object({
  level: z.enum(levels), length: z.enum(['short', 'medium', 'long']), duration: z.number().int().min(1).max(120),
  topic: z.string().max(120), style: z.string().max(60), generator: modelSchema, evaluator: modelSchema,
});
export type PracticeConfig = z.infer<typeof configSchema>;
export const defaultConfig: PracticeConfig = { level: 'B1', length: 'medium', duration: 15, topic: '', style: '', generator: models[0].id, evaluator: models[0].id };
export const challengeSchema = z.object({ title: z.string().min(1).max(200), sourceText: z.string().min(30).max(12000), topic: z.string().min(1).max(120), style: z.string().min(1).max(60) });
export type Challenge = z.infer<typeof challengeSchema>;
export const annotationSchema = z.object({
  start: z.number().int().nonnegative(), end: z.number().int().nonnegative(), originalText: z.string().min(1).max(8000),
  severity: z.enum(['suggestion', 'minor', 'major', 'fatal']), explanation: z.string().min(1).max(4000),
  context: z.string().max(4000).default(''), suggestion: z.string().min(1).max(4000), improvedText: z.string().max(8000),
});
export type Annotation = z.infer<typeof annotationSchema>;
const score = z.number().min(0).max(100);
export const evaluationSchema = z.object({
  overallScore: score, summaryFeedback: z.string().min(1).max(8000), strengths: z.array(z.string().max(2000)).max(12), weaknesses: z.array(z.string().max(2000)).max(12),
  sourceText: z.string().max(12000), userTranslation: z.string().max(16000), idealTranslation: z.string().min(1).max(16000),
  categoryScores: z.object({ accuracy: score, grammar: score, wordChoice: score, naturalness: score, completeness: score, style: score }),
  annotations: z.array(annotationSchema).max(80), annotationWarnings: z.number().optional(),
});
export type Evaluation = z.infer<typeof evaluationSchema>;
export const sessionSchema = z.object({ config: configSchema, challenge: challengeSchema, answer: z.string().max(16000), deadline: z.number(), startedAt: z.number(), result: evaluationSchema.optional(), sample: z.boolean().optional() });
export type PracticeSession = z.infer<typeof sessionSchema>;

// AI offsets often count code points instead of JavaScript UTF-16 units. Exact
// quote matching repairs offsets, but ambiguous/overlapping spans are discarded.
export function normalizeEvaluation(raw: unknown, sourceText: string, userTranslation: string): Evaluation {
  const obj = z.record(z.unknown()).parse(raw);
  const entries = Array.isArray(obj.annotations) ? obj.annotations : [];
  let warnings = 0;
  const valid: Annotation[] = [];
  for (const entry of entries.slice(0, 80)) {
    const parsed = annotationSchema.safeParse(entry);
    if (!parsed.success) { warnings++; continue; }
    const a = parsed.data;
    if (userTranslation.slice(a.start, a.end) !== a.originalText || a.end <= a.start) {
      const first = userTranslation.indexOf(a.originalText);
      if (first < 0 || userTranslation.indexOf(a.originalText, first + 1) !== -1) { warnings++; continue; }
      a.start = first; a.end = first + a.originalText.length;
    }
    valid.push(a);
  }
  valid.sort((a, b) => a.start - b.start || b.end - a.end);
  const annotations: Annotation[] = [];
  for (const a of valid) {
    if (a.start < (annotations.at(-1)?.end ?? 0)) { warnings++; continue; }
    annotations.push(a);
  }
  return evaluationSchema.parse({ ...obj, sourceText, userTranslation, annotations, annotationWarnings: warnings });
}
