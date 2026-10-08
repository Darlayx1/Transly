import { models, type Provider } from './config';

type Model = (typeof models)[number];
type JsonObject = Record<string, unknown>;
type ProviderAdapter = {
  request(key: string, model: Model, prompt: string, schema: unknown): { url: string; headers: Record<string, string>; body: string };
  access(key: string, model: Model): { url: string; headers: Record<string, string> };
  available(payload: unknown, model: Model): boolean;
};
// Keep the provider schema conservative; the application validates all numeric
// bounds and string limits after decoding the response.
function strictSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strictSchema);
  if (!value || typeof value !== 'object') return value;
  const schema = Object.fromEntries(Object.entries(value).filter(([key]) => !['minimum', 'maximum', 'minLength', 'maxLength'].includes(key)).map(([key, item]) => [key, strictSchema(item)]));
  if (schema.type === 'object') {
    schema.additionalProperties = false;
    schema.required = Object.keys((schema.properties || {}) as JsonObject);
  }
  return schema;
}
export const providerAdapters: Record<Provider, ProviderAdapter> = {
  gemini: {
    request(key: string, model: Model, prompt: string, schema: unknown) {
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${model.upstreamId}:generateContent`,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: model.structured ? prompt : `${prompt}\nReturn only valid JSON matching this schema: ${JSON.stringify(schema)}` }] }], generationConfig: { ...(model.structured ? { responseMimeType: 'application/json', responseJsonSchema: schema } : {}), maxOutputTokens: 16000, thinkingConfig: { thinkingLevel: 'high' } } }),
      };
    },
    access(key: string, model: Model) {
      return { url: `https://generativelanguage.googleapis.com/v1beta/models/${model.upstreamId}`, headers: { 'x-goog-api-key': key } };
    },
    available(payload: unknown, model: Model) {
      const data = payload as { name?: string; supportedGenerationMethods?: string[] };
      return data.name === `models/${model.upstreamId}` && Boolean(data.supportedGenerationMethods?.includes('generateContent'));
    },
  },
  groq: {
    request(key: string, model: Model, prompt: string, schema: unknown) {
      return {
        url: 'https://api.groq.com/openai/v1/chat/completions',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: model.upstreamId, messages: [{ role: 'user', content: prompt }], reasoning_effort: 'high', ...(model.upstreamId === 'qwen/qwen3.8-27b' ? { reasoning_format: 'hidden' } : {}), max_completion_tokens: 8192, response_format: { type: 'json_schema', json_schema: { name: 'transly_response', strict: true, schema: strictSchema(schema) } } }),
      };
    },
    access(key: string) {
      return { url: 'https://api.groq.com/openai/v1/models', headers: { Authorization: `Bearer ${key}` } };
    },
    available(payload: unknown, model: Model) {
      const data = payload as { data?: { id?: string }[] };
      return Boolean(data.data?.some(item => item.id === model.upstreamId));
    },
  },
};
export function normalizeProviderResponse(provider: Provider, payload: unknown) {
  if (provider === 'gemini') return payload as GeminiResponse;
  const data = payload as { choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[] };
  return { candidates: data.choices?.map(choice => ({ content: { parts: [{ text: choice.message?.content || '' }] }, finishReason: choice.message?.refusal || choice.finish_reason === 'content_filter' ? 'SAFETY' : choice.finish_reason === 'length' ? 'MAX_TOKENS' : 'STOP' })) } satisfies GeminiResponse;
}
type GeminiResponse = { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[]; promptFeedback?: { blockReason?: string } };
