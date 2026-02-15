/**
 * List runtime shared types and contexts.
 *
 * Defines list item contracts and registry contexts used by the list runtime.
 */

import React, { createContext } from 'react';

export interface ListItemProps {
  id?: string;
  title: string | { value: string; tooltip?: string };
  subtitle?: string | { value?: string; tooltip?: string };
  icon?: any;
  accessories?: Array<{ text?: string | { value?: string; color?: string }; icon?: any; tag?: any; date?: any; tooltip?: string }>;
  actions?: React.ReactElement;
  keywords?: string[];
  detail?: React.ReactElement;
  quickLook?: { name?: string; path: string };
}

export interface ItemRegistration {
  id: string;
  props: ListItemProps;
  sectionTitle?: string;
  order: number;
}

export interface ListRegistryAPI {
  set: (id: string, data: Omit<ItemRegistration, 'id'>) => void;
  delete: (id: string) => void;
}

export const ListRegistryContext = createContext<ListRegistryAPI>({
  set: () => {},
  delete: () => {},
});

export const ListSectionTitleContext = createContext<string | undefined>(undefined);

export const EmptyViewRegistryContext = createContext<((props: {
  title?: string;
  description?: string;
  icon?: any;
  actions?: React.ReactElement;
} | null) => void) | null>(null);

export type ListItemAccessory = {
  text?: string | { value?: string; color?: string };
  icon?: any;
  tag?: any;
  date?: any;
  tooltip?: string;
};
