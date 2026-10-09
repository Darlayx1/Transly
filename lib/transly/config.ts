export const levels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'NAT'] as const;
export const levelInfo: Record<string, { name: string; detail: string }> = {
  A1: { name: 'Beginner', detail: 'Kata sehari-hari dan kalimat sederhana.' },
  A2: { name: 'Elementary', detail: 'Situasi familiar dan struktur kalimat dasar.' },
  B1: { name: 'Intermediate', detail: 'Teks yang terhubung dengan konteks sehari-hari.' },
  B2: { name: 'Upper intermediate', detail: 'Gagasan kompleks, nuansa makna, dan idiom umum.' },
  C1: { name: 'Advanced', detail: 'Argumen mendalam, bahasa implisit, dan pilihan kata kaya.' },
  C2: { name: 'Proficient', detail: 'Nuansa halus, idiom kompleks, dan struktur yang menantang.' },
  NAT: { name: 'Native', detail: 'Bahasa penutur asli, referensi budaya, dan ragam autentik.' },
};
// Provider IDs live here only. Add or replace models without changing the UI or routes.
export const providers = {
  gemini: { name: 'Google Gemini', shortName: 'Google AI Studio', keyUrl: 'https://aistudio.google.com/api-keys', groupLabel: 'Project ID Google Cloud', groupHint: 'Key dari proyek Google yang sama berbagi kuota.' },
} as const;
export type Provider = keyof typeof providers;
const geminiModels = [
  { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', structured: true },
  { id: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash', structured: true },
  { id: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash', structured: true },
  { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', structured: true },
  { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash Lite', structured: true },
  { id: 'gemma-4-31b-it', name: 'Gemma 4 31B', structured: false },
] as const;
export const models = [
  ...geminiModels.map(model => ({ ...model, provider: 'gemini' as const, upstreamId: model.id })),
] as const;
export const modelProvider = (_id?: string): Provider => 'gemini';
export const modelLabel = (id: string) => { const model = models.find(item => item.id === id); return model ? model.name : id; };
export const defaultModelId = models.find(model => model.id === 'gemini-3.5-flash')?.id ?? models[0].id;
export const defaultProviderModel = (_provider?: Provider) => defaultModelId;
export const topics = ['General', 'Technology', 'Science', 'Health', 'Education', 'Business', 'Culture', 'Environment', 'Daily Life', 'History', 'Entertainment'];
export const styles = ['Casual', 'Neutral', 'Formal', 'Academic', 'Professional', 'Conversational', 'Narrative', 'News Style', 'Descriptive'];
export const lengths = { short: { label: 'Pendek', range: '60–100', min: 60, max: 100 }, medium: { label: 'Sedang', range: '150–220', min: 150, max: 220 }, long: { label: 'Panjang', range: '300–450', min: 300, max: 450 } };
export const severityInfo = {
  suggestion: { label: 'Suggestion', name: 'Saran', detail: 'Alternatif yang lebih natural; bukan kesalahan.' },
  minor: { label: 'Minor', name: 'Kecil', detail: 'Perbaikan kecil pada diksi, tata bahasa, atau tanda baca.' },
  major: { label: 'Major', name: 'Besar', detail: 'Memengaruhi makna atau kualitas kalimat.' },
  fatal: { label: 'Fatal', name: 'Kritis', detail: 'Mengubah maksud atau menghilangkan informasi penting.' },
} as const;
export const categoryLabels: Record<string, string> = { accuracy: 'Ketepatan makna', grammar: 'Tata bahasa', wordChoice: 'Pilihan kata', naturalness: 'Kealamian', completeness: 'Kelengkapan', style: 'Gaya bahasa' };
export const countWords = (text: string) => text.trim() ? text.trim().split(/\s+/u).length : 0;
