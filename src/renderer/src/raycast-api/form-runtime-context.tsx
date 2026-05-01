/**
 * Form runtime context and global value snapshots.
 *
 * Keeps React form state context and a global snapshot used by
 * Action.SubmitForm execution.
 */

import { createContext } from 'react';

export interface FormContextType {
  values: Record<string, any>;
  setValue: (id: string, value: any) => void;
  errors: Record<string, string>;
  setError: (id: string, error: string) => void;
  placeholders: Record<string, string>;
  setPlaceholder: (id: string, placeholder: string) => void;
}

export const FormContext = createContext<FormContextType>({
  values: {},
  setValue: () => {},
  errors: {},
  setError: () => {},
  placeholders: {},
  setPlaceholder: () => {},
});

let currentFormValues: Record<string, any> = {};
let currentFormErrors: Record<string, string> = {};
let currentFormPlaceholders: Record<string, string> = {};

export function setCurrentFormValues(values: Record<string, any>) {
  currentFormValues = values;
}

export function setCurrentFormErrors(errors: Record<string, string>) {
  currentFormErrors = errors;
}

export function setCurrentFormPlaceholders(placeholders: Record<string, string>) {
  currentFormPlaceholders = placeholders;
}

export function getFormValues(): Record<string, any> {
  // Fall back to placeholder for fields the user didn't fill. Lets extensions
  // declare a sensible default like `placeholder="0"` and have it submitted
  // as 0 without the visual hint becoming a real value in the input.
  const result: Record<string, any> = {};
  const keys = new Set([
    ...Object.keys(currentFormValues),
    ...Object.keys(currentFormPlaceholders),
  ]);
  for (const k of keys) {
    const v = currentFormValues[k];
    if (v !== undefined && v !== '') {
      result[k] = v;
    } else if (currentFormPlaceholders[k] !== undefined) {
      result[k] = currentFormPlaceholders[k];
    } else {
      result[k] = v;
    }
  }
  return result;
}

export function getFormErrors(): Record<string, string> {
  return { ...currentFormErrors };
}
