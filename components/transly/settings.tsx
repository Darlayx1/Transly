'use client';
import { SlidersHorizontal } from 'lucide-react';
import { models } from '@/lib/transly/config';
export type { KeyStatus } from '@/lib/transly/vault-types';
export { VaultSettings as Settings } from './vault-settings';
export function ModelSelect({ role, value, onChange }: { role: 'generator' | 'evaluator'; value: string; onChange: (v: string) => void }) {
  return <label className="field"><span>{role === 'generator' ? 'Pembuat soal' : 'Evaluator'}</span><select value={value} onChange={e => onChange(e.target.value)}>{models.map(m => <option value={m.id} key={m.id}>{m.name}</option>)}</select></label>;
}
export const settingsIcon = SlidersHorizontal;
