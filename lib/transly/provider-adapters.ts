import { models, type Provider } from './config';

type Model = (typeof models)[number];
type ProviderAdapter = {
  request(key: string, model: Model, prompt: string, schema: unknown): { url: string; headers: Record<string, string>; body: string };
  access(key: string, model: Model): { url: string; headers: Record<string, string> };
  available(payload: unknown, model: Model): boolean;
};

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
};
export function normalizeProviderResponse(_provider: Provider, payload: unknown) {
  return payload as GeminiResponse;
}
type GeminiResponse = { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[]; promptFeedback?: { blockReason?: string } };
