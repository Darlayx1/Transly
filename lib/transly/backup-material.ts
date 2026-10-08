// Browser-only password derivation. The password never leaves the browser.
export async function backupMaterial(passphrase: string, suppliedSalt?: string) {
  if (passphrase.length < 12 || passphrase.length > 256) throw new Error('Gunakan kata sandi cadangan 12–256 karakter.');
  const salt = suppliedSalt ? Uint8Array.from(atob(suppliedSalt), c => c.charCodeAt(0)) : crypto.getRandomValues(new Uint8Array(16));
  if (salt.length !== 16) throw new Error('File cadangan tidak valid.');
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 600000 }, material, 256);
  return { salt: btoa(String.fromCharCode(...salt)), wrappingKey: btoa(String.fromCharCode(...new Uint8Array(bits))) };
}
