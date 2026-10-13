'use client';
import { Dropdown } from './dropdown';

export function PresetInput({ label, value, onChange, options, placeholder, maxLength }: {
  label: string; value: string; onChange: (value: string) => void; options: string[]; placeholder: string; maxLength: number;
}) {
  return <div className="field">
    <span>{label}<em>Opsional</em></span>
    <div className="preset-input">
      <input aria-label={label} value={value} maxLength={maxLength} placeholder={placeholder} onChange={event => onChange(event.target.value)}/>
      <Dropdown compact label={`Pilihan cepat ${label.toLowerCase()}`} value={options.includes(value) ? value : ''} onChange={onChange} options={[{ value: '', label: 'Otomatis', description: 'Kosongkan input' }, ...options.map(option => ({ value: option, label: option }))]}/>
    </div>
    <small className="muted">Ketik sendiri atau pilih melalui menu.</small>
  </div>;
}
