'use client';
import { Dropdown } from './dropdown';
import { models, providers, type Provider } from '@/lib/transly/config';
export function ModelSelect({ role, value, onChange, disabled = false, provider }: { role: 'generator' | 'evaluator'; value: string; onChange: (v: string) => void; disabled?: boolean; provider?: Provider }) {
  return <label className="field"><span>{role === 'generator' ? 'Pembuat soal' : 'Penilai terjemahan'}</span><Dropdown label={role === 'generator' ? 'Pembuat soal' : 'Penilai terjemahan'} value={value} disabled={disabled} onChange={onChange} options={models.filter(model => !provider || model.provider === provider).map(model => ({ value: model.id, label: model.name, description: providers[model.provider].shortName }))}/></label>;
}
