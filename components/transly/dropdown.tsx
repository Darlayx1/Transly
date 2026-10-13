'use client';
import { useCallback, useState } from 'react';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { Select } from 'radix-ui';

type Option = { value: string; label: string; description?: string };
type Props = { label: string; value: string; options: Option[]; onChange: (value: string) => void; disabled?: boolean; compact?: boolean };
const emptyValue = '__transly_automatic__';

export function Dropdown({ label, value, options, onChange, disabled, compact }: Props) {
  const [container, setContainer] = useState<HTMLElement | undefined>();
  const triggerRef = useCallback((node: HTMLButtonElement | null) => {
    if (node) setContainer(node.closest('dialog') || undefined);
  }, []);
  return <Select.Root value={value || emptyValue} onValueChange={next => onChange(next === emptyValue ? '' : next)} disabled={disabled}>
    <Select.Trigger ref={triggerRef} className={`transly-dropdown${compact ? ' dropdown-compact' : ''}`} aria-label={label}>
      <Select.Value/><Select.Icon><ChevronDown size={16}/></Select.Icon>
    </Select.Trigger>
    <Select.Portal container={container}>
      <Select.Content className="transly-dropdown-menu" position="popper" sideOffset={7} align="start" collisionPadding={12} onClick={event => event.stopPropagation()}>
        <Select.ScrollUpButton className="dropdown-scroll"><ChevronUp size={15}/></Select.ScrollUpButton>
        <Select.Viewport className="dropdown-options">
          {options.map(option => <Select.Item key={option.value} value={option.value || emptyValue} className="dropdown-option" textValue={option.label}>
            <div><Select.ItemText>{option.label}</Select.ItemText>{option.description && <small>{option.description}</small>}</div>
            <Select.ItemIndicator className="dropdown-check"><Check size={16}/></Select.ItemIndicator>
          </Select.Item>)}
        </Select.Viewport>
        <Select.ScrollDownButton className="dropdown-scroll"><ChevronDown size={15}/></Select.ScrollDownButton>
      </Select.Content>
    </Select.Portal>
  </Select.Root>;
}
