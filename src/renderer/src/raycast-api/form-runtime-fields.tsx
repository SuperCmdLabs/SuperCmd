/**
 * Form runtime field components.
 *
 * Attaches all `Form.*` field primitives to the root Form component.
 */

import React, { useContext } from 'react';
import { FormContext } from './form-runtime-context';

const FORM_CONTROL_BASE_CLASS =
  'w-full bg-[var(--ui-segment-bg)] border border-[var(--ui-segment-border)] text-[var(--text-primary)] placeholder:text-[color:var(--text-muted)] outline-none transition-colors focus:border-[var(--border-strong)] focus:bg-[var(--ui-segment-bg-hover)]';

function FormFieldRow({
  title,
  children,
  error,
  info,
}: {
  title?: string;
  children: React.ReactNode;
  error?: string;
  info?: string;
}) {
  return (
    <div className="flex items-start gap-4">
      <div className="w-24 flex-shrink-0 pt-2 text-right">
        {title && <label className="text-[13px] font-medium text-[var(--text-secondary)]">{title}</label>}
      </div>
      <div className="flex-1 min-w-0">
        {children}
        {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
        {info && <p className="text-[12px] text-[var(--text-subtle)] mt-1.5">{info}</p>}
      </div>
    </div>
  );
}

export function attachFormFields(FormComponent: any) {
  FormComponent.TextField = ({ id, title, placeholder, value, onChange, defaultValue, error, info, autoFocus }: any) => {
    const form = useContext(FormContext);
    const fieldValue = value ?? form.values[id] ?? defaultValue ?? '';
    const fieldError = error ?? form.errors[id];

    const handleChange = (event: any) => {
      const nextValue = event.target.value;
      if (id) form.setValue(id, nextValue);
      onChange?.(nextValue);
    };

    return (
      <FormFieldRow title={title} error={fieldError} info={info}>
        <input
          type="text"
          placeholder={placeholder}
          value={fieldValue}
          onChange={handleChange}
          autoFocus={autoFocus}
          className={`${FORM_CONTROL_BASE_CLASS} rounded-xl px-3 py-2 text-[15px]`}
        />
      </FormFieldRow>
    );
  };

  FormComponent.TextArea = ({ id, title, placeholder, value, onChange, defaultValue, error }: any) => {
    const form = useContext(FormContext);
    const fieldValue = value ?? form.values[id] ?? defaultValue ?? '';
    const fieldError = error ?? form.errors[id];

    const handleChange = (event: any) => {
      const nextValue = event.target.value;
      if (id) form.setValue(id, nextValue);
      onChange?.(nextValue);
    };

    return (
      <FormFieldRow title={title} error={fieldError}>
        <textarea
          placeholder={placeholder}
          value={fieldValue}
          onChange={handleChange}
          rows={5}
          className={`${FORM_CONTROL_BASE_CLASS} min-h-[140px] rounded-2xl px-4 py-3 text-[15px] resize-y`}
        />
      </FormFieldRow>
    );
  };

  FormComponent.PasswordField = ({ id, title, placeholder, value, onChange, defaultValue, error }: any) => {
    const form = useContext(FormContext);
    const fieldValue = value ?? form.values[id] ?? defaultValue ?? '';
    const fieldError = error ?? form.errors[id];

    const handleChange = (event: any) => {
      const nextValue = event.target.value;
      if (id) form.setValue(id, nextValue);
      onChange?.(nextValue);
    };

    return (
      <FormFieldRow title={title} error={fieldError}>
        <input
          type="password"
          placeholder={placeholder}
          value={fieldValue}
          onChange={handleChange}
          className={`${FORM_CONTROL_BASE_CLASS} rounded-xl px-3 py-2 text-[15px]`}
        />
      </FormFieldRow>
    );
  };

  FormComponent.Checkbox = ({ id, title, label, value, onChange, defaultValue, error }: any) => {
    const form = useContext(FormContext);
    const fieldValue = value ?? form.values[id] ?? defaultValue ?? false;
    const fieldError = error ?? form.errors[id];

    const handleChange = (event: any) => {
      const nextValue = event.target.checked;
      if (id) form.setValue(id, nextValue);
      onChange?.(nextValue);
    };

    return (
      <FormFieldRow title={title || label} error={fieldError}>
        <label className="flex items-center gap-2 py-1 text-[13px] text-[var(--text-secondary)] cursor-pointer">
          <input type="checkbox" checked={fieldValue} onChange={handleChange} className="settings-checkbox" />
          {label && title ? label : null}
        </label>
      </FormFieldRow>
    );
  };

  FormComponent.Dropdown = Object.assign(
    ({ id, title, children, value, onChange, defaultValue, error }: any) => {
      const form = useContext(FormContext);
      const fieldValue = value ?? form.values[id] ?? defaultValue ?? '';
      const fieldError = error ?? form.errors[id];

      const handleChange = (event: any) => {
        const nextValue = event.target.value;
        if (id) form.setValue(id, nextValue);
        onChange?.(nextValue);
      };

      return (
        <FormFieldRow title={title} error={fieldError}>
          <select
            value={fieldValue}
            onChange={handleChange}
            className={`${FORM_CONTROL_BASE_CLASS} rounded-xl px-3 py-2 text-[15px]`}
          >
            {children}
          </select>
        </FormFieldRow>
      );
    },
    {
      Item: ({ value, title }: any) => <option value={value}>{title}</option>,
      Section: ({ children, title }: any) => <optgroup label={title}>{children}</optgroup>,
    },
  );

  FormComponent.DatePicker = Object.assign(
    ({ title, value, onChange, error, type }: any) => (
      <FormFieldRow title={title} error={error}>
        <input
          type={type === 'date' ? 'date' : 'datetime-local'}
          value={value ? (value instanceof Date ? value.toISOString().slice(0, 16) : value) : ''}
          onChange={(event: any) => onChange?.(event.target.value ? new Date(event.target.value) : null)}
          className={`${FORM_CONTROL_BASE_CLASS} rounded-xl px-3 py-2 text-[13px]`}
        />
      </FormFieldRow>
    ),
    { Type: { Date: 'date', DateTime: 'datetime' }, isFullDay: false },
  );

  FormComponent.Description = ({ text, title }: any) => (
    <div className="flex items-start gap-4">
      <div className="w-24 flex-shrink-0" />
      <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed flex-1">
        {title ? <strong className="text-[var(--text-muted)]">{title}: </strong> : null}
        {text}
      </p>
    </div>
  );

  FormComponent.Separator = () => <hr className="border-[var(--ui-divider)] my-2" />;
  FormComponent.TagPicker = Object.assign(
    ({ title, children, error }: any) => (
      <FormFieldRow title={title} error={error}>
        <div className="flex flex-wrap gap-1">{children}</div>
      </FormFieldRow>
    ),
    {
      Item: ({ title }: any) => (
        <span className="text-xs bg-[var(--ui-segment-bg)] border border-[var(--ui-segment-border)] px-1.5 py-0.5 rounded text-[var(--text-secondary)]">
          {title}
        </span>
      ),
    },
  );

  FormComponent.FilePicker = ({
    id,
    title,
    value,
    onChange,
    defaultValue,
    allowMultipleSelection,
    canChooseDirectories,
    canChooseFiles,
    showHiddenFiles,
    error,
  }: any) => {
    const form = useContext(FormContext);
    const fieldValue = value ?? form.values[id] ?? defaultValue ?? [];
    const fieldError = error ?? form.errors[id];
    const files = Array.isArray(fieldValue) ? fieldValue : fieldValue ? [fieldValue] : [];

    const pickFiles = async () => {
      const picked = await (window as any).electron?.pickFiles?.({
        allowMultipleSelection: Boolean(allowMultipleSelection),
        canChooseDirectories: Boolean(canChooseDirectories),
        canChooseFiles: canChooseFiles !== false,
        showHiddenFiles: Boolean(showHiddenFiles),
      });
      if (!picked || !Array.isArray(picked)) return;
      if (id) form.setValue(id, picked);
      onChange?.(picked);
    };

    return (
      <FormFieldRow title={title} error={fieldError}>
        <div className="space-y-2">
          <button
            type="button"
            onClick={pickFiles}
            className="w-full h-10 rounded-xl border border-[var(--ui-segment-border)] bg-[var(--ui-segment-bg)] hover:bg-[var(--ui-segment-bg-hover)] text-[14px] font-semibold text-[var(--text-primary)] transition-colors"
          >
            {allowMultipleSelection ? 'Select Files' : 'Select File'}
          </button>
          {files.length > 0 ? (
            <div className="text-[12px] text-[var(--text-secondary)] break-all">
              {allowMultipleSelection ? `${files.length} selected` : files[0]}
            </div>
          ) : null}
        </div>
      </FormFieldRow>
    );
  };

  FormComponent.LinkAccessory = ({ text, target }: any) => (
    <a href={target} className="text-xs text-blue-400 hover:underline">
      {text}
    </a>
  );
}
