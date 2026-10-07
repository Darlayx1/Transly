const str = { type: 'string' };
const score = { type: 'number', minimum: 0, maximum: 100 };
const object = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties) });
export const challengeJsonSchema = object({ title: str, sourceText: str, topic: str, style: str });
export const evaluationJsonSchema = object({
  overallScore: score, summaryFeedback: str, strengths: { type: 'array', items: str }, weaknesses: { type: 'array', items: str },
  sourceText: str, userTranslation: str, idealTranslation: str,
  categoryScores: object({ accuracy: score, grammar: score, wordChoice: score, naturalness: score, completeness: score, style: score }),
  annotations: { type: 'array', items: object({ start: { type: 'integer' }, end: { type: 'integer' }, originalText: str, severity: { type: 'string', enum: ['suggestion', 'minor', 'major', 'fatal'] }, explanation: str, context: str, suggestion: str, improvedText: str }) },
});
