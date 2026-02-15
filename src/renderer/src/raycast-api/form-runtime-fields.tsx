/**
 * Form runtime field components.
 *
 * Attaches all `Form.*` field primitives to the root Form component.
 */

import React, { useContext } from 'react';
import { FormContext } from './form-runtime-context';

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
        {title && <label className="text-[13px] font-medium text-white/55">{title}</label>}
      </div>
      <div className="flex-1 min-w-0">
        {children}
        {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
        {info && <p className="text-[12px] text-white/35 mt-1.5">{info}</p>}
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
          className="w-full bg-white/[0.06] border border-white/[0.12] rounded-lg px-3 py-2 text-[15px] text-white/95 placeholder:text-white/45 outline-none focus:border-white/30"
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
          className="w-full min-h-[140px] bg-white/[0.06] border border-white/[0.12] rounded-xl px-4 py-3 text-[15px] text-white/95 placeholder:text-white/45 outline-none focus:border-white/30 resize-y"
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
          className="w-full bg-white/[0.06] border border-white/[0.12] rounded-lg px-3 py-2 text-[15px] text-white/95 placeholder:text-white/45 outline-none focus:border-white/30"
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
        <label className="flex items-center gap-2 py-1 text-[13px] text-white/80 cursor-pointer">
          <input type="checkbox" checked={fieldValue} onChange={handleChange} className="accent-blue-500" />
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
            className="w-full bg-white/[0.06] border border-white/[0.12] rounded-lg px-3 py-2 text-[15px] text-white/95 outline-none focus:border-white/30"
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
          className="w-full bg-white/[0.06] border border-white/[0.08] rounded-md px-2.5 py-[5px] text-[13px] text-white outline-none focus:border-white/20"
        />
      </FormFieldRow>
    ),
    { Type: { Date: 'date', DateTime: 'datetime' }, isFullDay: false },
  );

  FormComponent.Description = ({ text, title }: any) => (
    <div className="flex items-start gap-4">
      <div className="w-24 flex-shrink-0" />
      <p className="text-[13px] text-white/55 leading-relaxed flex-1">
        {title ? <strong className="text-white/65">{title}: </strong> : null}
        {text}
      </p>
    </div>
  );

  FormComponent.Separator = () => <hr className="border-white/[0.06] my-2" />;
  FormComponent.TagPicker = Object.assign(
    ({ title, children, error }: any) => (
      <FormFieldRow title={title} error={error}>
        <div className="flex flex-wrap gap-1">{children}</div>
      </FormFieldRow>
    ),
    { Item: ({ title }: any) => <span className="text-xs bg-white/10 px-1.5 py-0.5 rounded text-white/60">{title}</span> },
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
            className="w-full h-10 rounded-lg border border-white/[0.14] bg-white/[0.06] hover:bg-white/[0.10] text-[14px] font-semibold text-white/90 transition-colors"
          >
            {allowMultipleSelection ? 'Select Files' : 'Select File'}
          </button>
          {files.length > 0 ? (
            <div className="text-[12px] text-white/55 break-all">
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
