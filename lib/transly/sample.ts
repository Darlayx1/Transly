import { evaluationSchema, type Challenge, type Evaluation, type PracticeConfig } from './schema';

/** An illustrative walkthrough. These facts and annotations describe only the bundled answer. */
export const sampleConfig: PracticeConfig = {
  level: 'B2', length: 'short', duration: 5, topic: 'Environment', style: 'Neutral',
  generator: 'gemini-3.8-flash', evaluator: 'gemini-3.8-flash',
};

export const sampleChallenge: Challenge = {
  title: 'A greener way to get around', topic: 'Environment', style: 'Neutral',
  sourceText: 'Every morning, Maya used to drive to work, even though her office was only a few kilometres away. Last month, she decided to give cycling a try. At first, the journey felt tiring, but she soon began to enjoy the quiet streets and fresh air. Her neighbours were not convinced that cycling would make a difference. However, Maya believes that small changes can add up over time. She now arrives at work feeling more energetic, and she rarely gets stuck in traffic.',
};

export const sampleAnswer = 'Setiap pagi, Maya biasa berkendara ke kantor, meskipun kantornya hanya beberapa kilometer. Bulan lalu, dia memberikan bersepeda sebuah percobaan. Tetangganya yakin bahwa bersepeda akan membuat perbedaan. Namun, Maya percaya perubahan kecil bertambah naik seiring waktu. Dia tiba di kantor lebih energik dan jarang terjebak macet';

function note(quote: string, severity: 'suggestion' | 'minor' | 'major' | 'fatal', explanation: string, context: string, suggestion: string, improvedText: string) {
  const start = sampleAnswer.indexOf(quote);
  if (start < 0) throw new Error('Sample annotation quote missing.');
  return { start, end: start + quote.length, originalText: quote, severity, explanation, context, suggestion, improvedText };
}

export const sampleEvaluation: Evaluation = evaluationSchema.parse({
  overallScore: 67,
  summaryFeedback: 'Contoh evaluasi ini menunjukkan bahwa alur perjalanan Maya sudah tersampaikan, tetapi negasi pada sikap tetangga berubah dan ungkapan “give cycling a try” diterjemahkan terlalu harfiah. Fokus utama: pertahankan maksud kalimat, lalu pilih ungkapan Indonesia yang alami. Skor ini hanya berlaku untuk jawaban contoh yang disediakan.',
  strengths: ['Alur utama cerita tetap runtut.', 'Bagian tentang kemacetan diterjemahkan dengan natural.'],
  weaknesses: ['Negasi “not convinced” hilang sehingga sikap tetangga menjadi kebalikannya.', 'Ungkapan “give cycling a try” lebih tepat diterjemahkan sebagai “mencoba bersepeda”.', 'Perjalanan yang awalnya melelahkan, jalanan tenang, dan udara segar belum tercakup.'],
  sourceText: sampleChallenge.sourceText,
  userTranslation: sampleAnswer,
  idealTranslation: 'Setiap pagi, Maya biasa mengemudi ke kantor meskipun jaraknya hanya beberapa kilometer. Bulan lalu, ia memutuskan untuk mencoba bersepeda. Awalnya perjalanan itu melelahkan, tetapi ia segera menikmati jalanan yang tenang dan udara segar. Tetangganya tidak yakin bersepeda akan membawa perubahan. Namun, Maya percaya perubahan kecil dapat memberikan dampak besar seiring waktu. Kini ia tiba di kantor dengan lebih bersemangat dan jarang terjebak macet.',
  categoryScores: { accuracy: 60, grammar: 80, wordChoice: 62, naturalness: 70, completeness: 65, style: 82 },
  annotations: [
    note('biasa berkendara', 'minor', 'Makna umumnya tersampaikan, tetapi “berkendara” tidak menegaskan bahwa Maya mengemudi mobil.', 'Used to drive to work menjelaskan kebiasaan mengemudi sebelum ia mulai bersepeda.', 'Pilih kata yang mempertahankan perbedaan antara mobil dan sepeda.', 'biasa mengemudi'),
    note('memberikan bersepeda sebuah percobaan', 'major', 'Ini menerjemahkan idiom secara harfiah sehingga kalimat Indonesia terasa janggal.', 'Give cycling a try berarti mencoba bersepeda.', 'Gunakan ungkapan Indonesia yang menyampaikan maksud mencoba aktivitas.', 'memutuskan untuk mencoba bersepeda'),
    note('Tetangganya yakin bahwa bersepeda akan membuat perbedaan', 'fatal', 'Negasi hilang. Teks sumber menyatakan tetangga tidak yakin, bukan yakin.', 'Were not convinced berarti tidak yakin.', 'Pertahankan negasi agar sikap tokoh tidak berubah.', 'Tetangganya tidak yakin bersepeda akan membawa perubahan'),
    note('lebih energik', 'suggestion', 'Pilihan ini dapat dipahami dan tidak salah, tetapi ada ungkapan yang lebih luwes.', 'Feeling more energetic merujuk pada keadaan Maya saat tiba di kantor.', '“Lebih bersemangat” dapat terdengar lebih natural di konteks ini.', 'lebih bersemangat'),
  ],
});
