'use client';
import { models, providers, type Provider } from '@/lib/transly/config';
export function ModelSelect({ role, value, onChange, disabled = false, provider }: { role: 'generator' | 'evaluator'; value: string; onChange: (v: string) => void; disabled?: boolean; provider?: Provider }) {
  return <label className="field"><span>{role === 'generator' ? 'Pembuat soal' : 'Penilai terjemahan'}</span><select value={value} disabled={disabled} onChange={e => onChange(e.target.value)}>{(Object.keys(providers) as Provider[]).filter(id => !provider || provider === id).map(id => <optgroup key={id} label={providers[id].name}>{models.filter(model => model.provider === id).map(model => <option value={model.id} key={model.id}>{providers[id].shortName} · {model.name}</option>)}</optgroup>)}</select></label>;
}
