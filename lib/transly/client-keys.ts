import type { Provider } from './config';

export type DeviceKeys = {
  gemini?: string;
  generator?: string;
  evaluator?: string;
};

const STORAGE_KEY = 'transly.device_keys.v1';

export function loadDeviceKeys(): DeviceKeys {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    return {
      gemini: typeof parsed.gemini === 'string' && parsed.gemini.trim().length >= 20 ? parsed.gemini.trim() : undefined,
      generator: typeof parsed.generator === 'string' && parsed.generator.trim().length >= 20 ? parsed.generator.trim() : undefined,
      evaluator: typeof parsed.evaluator === 'string' && parsed.evaluator.trim().length >= 20 ? parsed.evaluator.trim() : undefined,
    };
  } catch {
    return {};
  }
}

export function saveDeviceKeys(keys: DeviceKeys): void {
  if (typeof window === 'undefined') return;
  try {
    const sanitized: DeviceKeys = {};
    if (keys.gemini?.trim()) sanitized.gemini = keys.gemini.trim();
    if (keys.generator?.trim()) sanitized.generator = keys.generator.trim();
    if (keys.evaluator?.trim()) sanitized.evaluator = keys.evaluator.trim();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
  } catch {
    // Graceful fallback for restricted storage environments
  }
}

export function clearDeviceKeys(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}

export function getDeviceKey(_provider: Provider = 'gemini', keys: DeviceKeys = loadDeviceKeys()): string | undefined {
  return keys.gemini || keys.generator || keys.evaluator;
}

export function hasDeviceKey(provider: Provider = 'gemini', keys: DeviceKeys = loadDeviceKeys()): boolean {
  return Boolean(getDeviceKey(provider, keys));
}

export function maskKey(key?: string): string {
  if (!key || key.length < 8) return '';
  return `••••${key.slice(-4)}`;
}
