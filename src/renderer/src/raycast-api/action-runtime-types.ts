/**
 * Action runtime shared types.
 *
 * Contains data contracts used by the action registry, action overlay,
 * and ActionPanel extraction helpers.
 */

export interface ActionShortcut {
  modifiers?: string[];
  key?: string;
}

export interface ActionRegistration {
  id: string;
  title: string;
  icon?: any;
  shortcut?: ActionShortcut;
  style?: string;
  sectionTitle?: string;
  execute: () => void;
  order: number;
}

export interface ActionRegistryAPI {
  register: (id: string, data: Omit<ActionRegistration, 'id'>) => void;
  unregister: (id: string) => void;
}

export interface ExtractedAction {
  title: string;
  icon?: any;
  shortcut?: ActionShortcut;
  style?: string;
  sectionTitle?: string;
  execute: () => void;
}
