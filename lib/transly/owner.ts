export type StorageOwner = 'guest' | `account:${string}`;

export function formatAccountOwner(userId: string): `account:${string}` {
  const cleanId = userId.trim();
  if (!cleanId) throw new Error('Identitas akun tidak valid.');
  return `account:${cleanId}`;
}

export function getStorageOwner(userId?: string | null): StorageOwner {
  if (!userId || !userId.trim()) return 'guest';
  return formatAccountOwner(userId);
}

export function isAccountOwner(owner: string): owner is `account:${string}` {
  return typeof owner === 'string' && owner.startsWith('account:') && owner.length > 'account:'.length;
}

export function extractUserId(owner: string): string | null {
  if (isAccountOwner(owner)) {
    return owner.slice('account:'.length);
  }
  return null;
}

export function assertOwner(owner: unknown): StorageOwner {
  if (owner === 'guest') return 'guest';
  if (typeof owner === 'string' && isAccountOwner(owner)) return owner;
  throw new Error('Identitas pemilik tidak valid.');
}
