/**
 * raycast-api/hooks/use-form.ts
 * Purpose: FormValidation enum and useForm hook.
 */

import { useCallback, useMemo, useState } from 'react';

export enum FormValidation {
  Required = 'required',
}

export function useForm<T extends Record<string, any> = Record<string, any>>(options: {
  onSubmit: (values: T) => void | boolean | Promise<void | boolean>;
  initialValues?: Partial<T>;
  validation?: Partial<Record<keyof T, ((value: any) => string | undefined | null) | FormValidation>>;
}): {
  handleSubmit: (values: T) => void;
  itemProps: Record<string, { id: string; value: any; onChange: (value: any) => void; error?: string; onBlur?: () => void }>;
  values: T;
  setValue: (key: keyof T, value: any) => void;
  setValidationError: (key: keyof T, error: string) => void;
  reset: (values?: Partial<T>) => void;
  focus: (key: keyof T) => void;
} {
  const [values, setValues] = useState<T>((options.initialValues || {}) as T);
  const [errors, setErrors] = useState<Partial<Record<keyof T, string>>>({});

  const setValue = useCallback((key: keyof T, value: any) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const setValidationError = useCallback((key: keyof T, error: string) => {
    setErrors((prev) => ({ ...prev, [key]: error }));
  }, []);

  const validate = useCallback((): boolean => {
    if (!options.validation) return true;

    const newErrors: Partial<Record<keyof T, string>> = {};
    let valid = true;

    for (const key of Object.keys(options.validation) as (keyof T)[]) {
      const rule = options.validation[key];
      if (!rule) continue;

      let error: string | undefined | null;
      if (rule === FormValidation.Required) {
        const v = values[key];
        if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) {
          error = 'This field is required';
        }
      } else if (typeof rule === 'function') {
        error = rule(values[key]);
      }

      if (error) {
        newErrors[key] = error;
        valid = false;
      }
    }

    setErrors(newErrors);
    return valid;
  }, [options.validation, values]);

  const handleSubmit = useCallback((submitValues: T) => {
    if (validate()) {
      options.onSubmit(submitValues || values);
    }
  }, [options.onSubmit, validate, values]);

  const reset = useCallback((newValues?: Partial<T>) => {
    setValues((newValues || options.initialValues || {}) as T);
    setErrors({});
  }, [options.initialValues]);

  const focus = useCallback((_key: keyof T) => {
    // Cannot actually focus in this environment.
  }, []);

  const itemProps = useMemo(() => {
    const props: Record<string, any> = {};
    const allKeys = new Set([
      ...Object.keys(options.initialValues || {}),
      ...Object.keys(options.validation || {}),
      ...Object.keys(values),
    ]);

    for (const key of allKeys) {
      props[key as string] = {
        id: key as string,
        value: values[key as keyof T],
        onChange: (v: any) => setValue(key as keyof T, v),
        error: errors[key as keyof T],
        onBlur: () => {
          const rule = options.validation?.[key as keyof T];
          if (!rule) return;

          let err: string | undefined | null;
          if (rule === FormValidation.Required) {
            const v = values[key as keyof T];
            if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) {
              err = 'This field is required';
            }
          } else if (typeof rule === 'function') {
            err = rule(values[key as keyof T]);
          }

          if (err) {
            setErrors((prev) => ({ ...prev, [key]: err }));
          }
        },
      };
    }

    return props;
  }, [errors, options.initialValues, options.validation, setValue, values]);

  return { handleSubmit, itemProps, values, setValue, setValidationError, reset, focus };
}
