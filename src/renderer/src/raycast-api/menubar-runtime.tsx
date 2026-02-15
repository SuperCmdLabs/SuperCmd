/**
 * raycast-api/menubar-runtime.tsx
 * Purpose: Public MenuBarExtra runtime surface.
 */

import { configureMenuBarRuntime } from './menubar-runtime-config';
import { MenuBarExtraComponent } from './menubar-runtime-parent';
import {
  MenuBarExtraItemComponent,
  MenuBarExtraSectionComponent,
  MenuBarExtraSeparatorComponent,
  MenuBarExtraSubmenuComponent,
} from './menubar-runtime-items';
import type {
  MenuBarActionEvent,
  MenuBarItemProps,
  MenuBarSectionProps,
  MenuBarSubmenuProps,
  MenuBarProps,
} from './menubar-runtime-shared';

export const MenuBarExtra = Object.assign(MenuBarExtraComponent, {
  Item: MenuBarExtraItemComponent,
  Section: MenuBarExtraSectionComponent,
  Separator: MenuBarExtraSeparatorComponent,
  Submenu: MenuBarExtraSubmenuComponent,
});

export namespace MenuBarExtra {
  export type ActionEvent = MenuBarActionEvent;
  export type ItemProps = MenuBarItemProps;
  export type SubmenuProps = MenuBarSubmenuProps;
  export type SectionProps = MenuBarSectionProps;
  export type Props = MenuBarProps;
}

export { configureMenuBarRuntime };
