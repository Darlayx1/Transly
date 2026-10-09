import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Only public project configuration belongs in the browser bundle.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';
let client: SupabaseClient | null = null;

export function isPublicAccountKey(value: string): boolean {
  if (value.startsWith('sb_publishable_')) return true;
  try { return JSON.parse(atob(value.split('.')[1].replaceAll('-', '+').replaceAll('_', '/'))).role === 'anon'; }
  catch { return false; }
}

export function accountClient(): SupabaseClient | null {
  if (typeof window === 'undefined' || !url || !isPublicAccountKey(key)) return null;
  if (!client) {
    try {
      client = createClient(url, key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
        global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal || AbortSignal.timeout(15000) }) },
      });
    } catch { return null; }
  }
  return client;
}

export function accountError(error: { message: string; code?: string }): string {
  if (error.message.includes('Invalid login credentials')) return 'Email atau kata sandi tidak sesuai.';
  if (error.message.includes('Email not confirmed')) return 'Konfirmasikan email terlebih dahulu dengan kode yang dikirimkan.';
  if (error.code === '23505' || error.code === 'P0001') return 'Sesi ini berubah di perangkat lain. Muat ulang riwayat sebelum melanjutkan; draft perangkat tetap disimpan.';
  if (error.message.toLowerCase().includes('rate limit')) return 'Terlalu banyak permintaan. Tunggu beberapa saat sebelum mencoba lagi.';
  return 'Layanan akun belum dapat diakses. Periksa koneksi atau coba kembali nanti.';
}
