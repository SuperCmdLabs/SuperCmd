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
}

export const FormContext = createContext<FormContextType>({
  values: {},
  setValue: () => {},
  errors: {},
  setError: () => {},
});

let currentFormValues: Record<string, any> = {};
let currentFormErrors: Record<string, string> = {};

export function setCurrentFormValues(values: Record<string, any>) {
  currentFormValues = values;
}

export function setCurrentFormErrors(errors: Record<string, string>) {
  currentFormErrors = errors;
}

export function getFormValues(): Record<string, any> {
  return { ...currentFormValues };
}

export function getFormErrors(): Record<string, string> {
  return { ...currentFormErrors };
}
