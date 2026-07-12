export type FormErrorMap = Record<string, string>;

export function clearFormFieldError(previous: FormErrorMap, id: string): FormErrorMap {
  if (!Object.prototype.hasOwnProperty.call(previous, id)) {
    return previous;
  }

  const next = { ...previous };
  delete next[id];
  return next;
}

export function setFormFieldError(previous: FormErrorMap, id: string, error: string): FormErrorMap {
  if (previous[id] === error) {
    return previous;
  }

  return { ...previous, [id]: error };
}
