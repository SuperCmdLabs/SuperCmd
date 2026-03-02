import React from 'react';

export interface InlineArgumentOption {
  label: string;
  value: string;
}

interface InlineArgumentFieldProps {
  value: string;
  placeholder: string;
  type?: 'text' | 'password' | 'select';
  options?: InlineArgumentOption[];
  onChange: (value: string) => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => void;
  inputRef?: (el: HTMLInputElement | HTMLSelectElement | null) => void;
}

const BASE_FIELD_CLASS =
  'h-[24px] max-w-[196px] min-w-[128px] text-md rounded-md border border-transparent bg-[color:rgba(var(--on-surface-rgb),0.16)] px-2.5 text-[0.875rem] leading-none text-[var(--text-primary)] placeholder:text-[color:var(--text-subtle)] outline-none focus:border-[var(--snippet-divider-strong)] focus:bg-[color:rgba(var(--on-surface-rgb),0.22)]';

const InlineArgumentField: React.FC<InlineArgumentFieldProps> = ({
  value,
  placeholder,
  type = 'text',
  options = [],
  onChange,
  onKeyDown,
  inputRef,
}) => {
  if (type === 'select') {
    return (
      <select
        ref={inputRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        className={`${BASE_FIELD_CLASS} pr-6`}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={`${option.value}-${option.label}`} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  return (
    <input
      ref={inputRef as ((el: HTMLInputElement | null) => void) | undefined}
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={onKeyDown as ((event: React.KeyboardEvent<HTMLInputElement>) => void) | undefined}
      className={BASE_FIELD_CLASS}
    />
  );
};

export const InlineArgumentOverflowBadge: React.FC<{ count: number }> = ({ count }) => (
  <div className="inline-flex h-9 items-center rounded-md border border-[var(--launcher-chip-border)] bg-[var(--launcher-chip-bg)] px-2 text-[0.75rem] font-medium text-[var(--text-subtle)]">
    +{count}
  </div>
);

export const InlineArgumentLeadingIcon: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="inline-flex flex-shrink-0 items-center justify-center">
    {children}
  </div>
);

export default InlineArgumentField;
