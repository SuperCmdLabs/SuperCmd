/**
 * raycast-api/menubar-runtime-items.tsx
 * Purpose: MenuBarExtra item/section/separator/submenu components.
 */

import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  MBRegistryContext,
  MBSectionIdContext,
  MBSectionTitleContext,
  MBSubmenuContext,
  nextMenuBarOrder,
  nextMenuBarSectionOrder,
  type MBItemRegistration,
  type MBRegistryAPI,
  type MenuBarItemProps,
  type MenuBarSectionProps,
  type MenuBarSubmenuProps,
} from './menubar-runtime-shared';

export function MenuBarExtraItemComponent({ title, subtitle, icon, onAction, shortcut, tooltip, alternate }: MenuBarItemProps) {
  const registry = useContext(MBRegistryContext);
  const sectionId = useContext(MBSectionIdContext);
  const sectionTitle = useContext(MBSectionTitleContext);
  const stableId = useRef(`__mbi_${nextMenuBarOrder()}`).current;
  const order = useRef(nextMenuBarOrder()).current;

  useEffect(() => {
    if (!registry) return;

    let alternateReg: MBItemRegistration | undefined;
    if (alternate) {
      alternateReg = {
        id: `${stableId}_alt`,
        type: 'item',
        title: alternate.props.title,
        subtitle: alternate.props.subtitle,
        icon: alternate.props.icon,
        tooltip: alternate.props.tooltip,
        onAction: alternate.props.onAction,
        order: order + 0.5,
      };
    }

    registry.register({
      id: stableId,
      type: 'item',
      title,
      subtitle,
      icon,
      tooltip,
      onAction,
      alternate: alternateReg,
      sectionId,
      sectionTitle,
      order,
    });

    return () => registry.unregister(stableId);
  }, [alternate, icon, onAction, order, registry, sectionId, sectionTitle, stableId, subtitle, title, tooltip]);

  if (!registry) {
    return (
      <button
        onClick={() => onAction?.({ type: 'left-click' })}
        className="w-full text-left px-3 py-1.5 text-sm text-white/80 hover:bg-white/[0.06] rounded transition-colors"
      >
        <div>{title}</div>
        {subtitle && <div className="text-xs text-white/50">{subtitle}</div>}
      </button>
    );
  }

  return null;
}

export function MenuBarExtraSectionComponent({ children, title }: MenuBarSectionProps) {
  const stableId = useRef(`__mbs_${nextMenuBarSectionOrder()}`).current;

  return (
    <MBSectionIdContext.Provider value={stableId}>
      <MBSectionTitleContext.Provider value={title}>
        {children}
      </MBSectionTitleContext.Provider>
    </MBSectionIdContext.Provider>
  );
}

export function MenuBarExtraSeparatorComponent() {
  const registry = useContext(MBRegistryContext);
  const sectionId = useContext(MBSectionIdContext);
  const stableId = useRef(`__mbsep_${nextMenuBarOrder()}`).current;
  const order = useRef(nextMenuBarOrder()).current;

  useEffect(() => {
    if (!registry) return;
    registry.register({ id: stableId, type: 'separator', sectionId, order });
    return () => registry.unregister(stableId);
  }, [order, registry, sectionId, stableId]);

  if (!registry) return <hr className="border-white/[0.06] my-1" />;
  return null;
}

export function MenuBarExtraSubmenuComponent({ children, title, icon }: MenuBarSubmenuProps) {
  const registry = useContext(MBRegistryContext);
  const sectionId = useContext(MBSectionIdContext);
  const sectionTitle = useContext(MBSectionTitleContext);
  const stableId = useRef(`__mbsm_${nextMenuBarOrder()}`).current;
  const order = useRef(nextMenuBarOrder()).current;

  const submenuRegistryRef = useRef(new Map<string, MBItemRegistration>());
  const [submenuVersion, setSubmenuVersion] = useState(0);

  const submenuAPI = useMemo<MBRegistryAPI>(() => ({
    register: (item: MBItemRegistration) => {
      submenuRegistryRef.current.set(item.id, item);
      setSubmenuVersion((v) => v + 1);
    },
    unregister: (id: string) => {
      submenuRegistryRef.current.delete(id);
      setSubmenuVersion((v) => v + 1);
    },
  }), []);

  useEffect(() => {
    if (!registry) return;

    const childItems = Array.from(submenuRegistryRef.current.values()).sort((a, b) => a.order - b.order);
    registry.register({
      id: stableId,
      type: 'submenu',
      title,
      icon,
      sectionId,
      sectionTitle,
      order,
      children: childItems,
    });

    return () => registry.unregister(stableId);
  }, [icon, order, registry, sectionId, sectionTitle, stableId, submenuVersion, title]);

  if (!registry) {
    const [expanded, setExpanded] = useState(false);
    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full text-left px-3 py-1.5 text-sm text-white/80 hover:bg-white/[0.06] rounded transition-colors flex items-center"
        >
          <span className="mr-2">{expanded ? '▼' : '▶'}</span>
          {title}
        </button>
        {expanded && (
          <div className="ml-4">
            <MBRegistryContext.Provider value={submenuAPI}>
              {children}
            </MBRegistryContext.Provider>
          </div>
        )}
      </div>
    );
  }

  return (
    <MBSubmenuContext.Provider value={stableId}>
      <MBRegistryContext.Provider value={submenuAPI}>
        <div style={{ display: 'none' }}>{children}</div>
      </MBRegistryContext.Provider>
    </MBSubmenuContext.Provider>
  );
}
