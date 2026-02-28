/**
 * List runtime renderers and static child components.
 *
 * Contains list row renderers, registration components, and list-level
 * subcomponents like EmptyView and Dropdown.
 */

import React, { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  EmptyViewRegistryContext,
  ListRegistryContext,
  ListSectionTitleContext,
  type ListItemAccessory,
  type ListItemProps,
} from './list-runtime-types';

interface ListRendererDeps {
  renderIcon: (icon: any, className?: string, assetsPath?: string) => React.ReactNode;
  resolveTintColor: (tintColor?: string) => string | undefined;
  addHexAlpha: (hex: string, alphaHex?: string) => string | null;
}

export function createListRenderers(deps: ListRendererDeps) {
  const { renderIcon, resolveTintColor, addHexAlpha } = deps;
  let itemOrderCounter = 0;

  function normalizeIconToken(value: unknown): string {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  }

  function isDotIcon(icon: unknown): boolean {
    if (!icon) return false;
    if (typeof icon === 'string') {
      const token = normalizeIconToken(icon.replace(/^Icon\./, ''));
      return token === 'dot' || token === 'dot16';
    }
    if (typeof icon === 'object') {
      const source = (icon as { source?: unknown }).source;
      if (typeof source === 'string') {
        const token = normalizeIconToken(source.replace(/^Icon\./, ''));
        return token === 'dot' || token === 'dot16';
      }
    }
    return false;
  }

  function ListItemComponent(props: ListItemProps) {
    const registry = useContext(ListRegistryContext);
    const sectionTitle = useContext(ListSectionTitleContext);
    const stableId = useRef(props.id || `__li_${++itemOrderCounter}`).current;
    const orderRef = useRef<number | null>(null);
    if (orderRef.current === null) orderRef.current = ++itemOrderCounter;

    useLayoutEffect(() => {
      registry.set(stableId, { props, sectionTitle, order: orderRef.current! });
      return () => registry.delete(stableId);
    }, [props, registry, sectionTitle, stableId]);

    return null;
  }

  (ListItemComponent as any).Accessory = {} as ListItemAccessory;
  (ListItemComponent as any).Props = {} as ListItemProps;

  function ListItemRenderer({ title, subtitle, icon, accessories, isSelected, dataIdx, onSelect, onActivate, onContextAction, assetsPath }: ListItemProps & any) {
    const titleStr = typeof title === 'string' ? title : (title as any)?.value || '';
    const subtitleStr = typeof subtitle === 'string' ? subtitle : (subtitle as any)?.value || '';
    const primaryText = titleStr || subtitleStr;
    const secondaryText = titleStr ? subtitleStr : '';
    const iconClassName = isDotIcon(icon) ? 'w-3 h-3' : 'w-5 h-5';

    return (
      <div
        data-idx={dataIdx}
        className={`mx-1.5 px-2.5 py-1 rounded-xl min-h-[34px] border flex items-center cursor-pointer transition-colors ${
          isSelected
            ? 'border-transparent bg-[var(--launcher-card-selected-bg)]'
            : 'border-transparent hover:border-[var(--launcher-card-border)] hover:bg-[var(--launcher-card-hover-bg)]'
        }`}
        onClick={onActivate}
        onMouseMove={onSelect}
        onContextMenu={onContextAction}
      >
        <div className="flex items-center gap-2 w-full">
          {icon && <div className="w-5 h-5 flex items-center justify-center flex-shrink-0 text-[var(--text-muted)] text-xs">{renderIcon(icon, iconClassName, assetsPath)}</div>}
          <div className="flex-1 min-w-0"><span className="text-[13px] leading-[18px] truncate block" style={{ color: 'rgba(var(--on-surface-rgb), 0.9)' }}>{primaryText}</span></div>
          {secondaryText && <span className="text-[11px] leading-[16px] flex-shrink-0 truncate max-w-[220px]" style={{ color: 'var(--text-muted)' }}>{secondaryText}</span>}
          {accessories?.map((accessory, index) => {
            const accessoryText = typeof accessory?.text === 'string' ? accessory.text : typeof accessory?.text === 'object' ? accessory.text?.value || '' : '';
            const accessoryTextColorRaw = typeof accessory?.text === 'object' ? accessory.text?.color : undefined;
            const tagText = typeof accessory?.tag === 'string' ? accessory.tag : typeof accessory?.tag === 'object' ? accessory.tag?.value || '' : '';
            const tagColorRaw = typeof accessory?.tag === 'object' ? accessory.tag?.color : undefined;
            const accessoryTextColor = resolveTintColor(accessoryTextColorRaw);
            const tagColor = resolveTintColor(tagColorRaw);
            const dateString = accessory?.date ? new Date(accessory.date).toLocaleDateString() : '';
            const tagBackground = tagColor ? addHexAlpha(tagColor, '2E') || 'rgba(var(--on-surface-rgb), 0.12)' : 'rgba(var(--on-surface-rgb), 0.12)';

            return (
              <span key={index} className="text-[12px] leading-5 flex-shrink-0 flex items-center gap-1.5" style={{ color: accessoryTextColor || tagColor || 'var(--text-muted)' }}>
                {accessory?.icon && <span className="text-[10px]">{renderIcon(accessory.icon, 'w-3 h-3', assetsPath)}</span>}
                {tagText ? <span className="px-2 py-0.5 rounded text-[11px]" style={{ background: tagBackground, color: tagColor || 'var(--text-secondary)' }}>{tagText}</span> : accessoryText || dateString || ''}
              </span>
            );
          })}
        </div>
      </div>
    );
  }

  function ListEmojiGridItemRenderer({ icon, title, isSelected, dataIdx, onSelect, onActivate, onContextAction }: any) {
    const emoji = typeof icon === 'string' ? icon : '';
    return (
      <div
        data-idx={dataIdx}
        className={`relative rounded-2xl border cursor-pointer transition-colors overflow-hidden flex items-center justify-center ${
          isSelected
            ? 'border-[var(--text-secondary)] bg-[var(--launcher-card-selected-bg)] ring-2 ring-[var(--launcher-card-border)]'
            : 'border-[var(--launcher-card-border)] bg-[var(--launcher-card-bg)] hover:bg-[var(--launcher-card-hover-bg)]'
        }`}
        style={{
          minHeight: '96px',
          boxShadow: isSelected
            ? '0 0 0 2px rgba(var(--on-surface-rgb), 0.24), inset 0 0 0 1px rgba(var(--on-surface-rgb), 0.16)'
            : undefined,
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          onActivate?.();
        }}
        onMouseMove={onSelect}
        onContextMenu={onContextAction}
        title={title || ''}
      >
        <span className="text-[46px] leading-none select-none">{emoji || '🙂'}</span>
      </div>
    );
  }

  function ListSectionComponent({ children, title }: { children?: React.ReactNode; title?: string }) {
    return <ListSectionTitleContext.Provider value={title}>{children}</ListSectionTitleContext.Provider>;
  }

  function ListEmptyView({ title, description, icon, actions }: { title?: string; description?: string; icon?: any; actions?: React.ReactElement }) {
    const registerEmptyView = useContext(EmptyViewRegistryContext);
    useEffect(() => {
      if (!registerEmptyView) return;
      registerEmptyView({ title, description, icon, actions });
      return () => registerEmptyView(null);
    }, [actions, description, icon, registerEmptyView, title]);

    if (registerEmptyView) return null;

    return (
      <div className="flex flex-col items-center justify-center h-full text-[var(--text-muted)] py-12">
        {icon && <div className="text-2xl mb-2 opacity-40">{typeof icon === 'string' ? icon : '○'}</div>}
        {title && <p className="text-sm font-medium">{title}</p>}
        {description && <p className="text-xs text-[var(--text-subtle)] mt-1 max-w-xs text-center">{description}</p>}
      </div>
    );
  }

  function ListDropdown({ children, tooltip, onChange, value, defaultValue }: any) {
    const [internalValue, setInternalValue] = useState(value ?? defaultValue ?? '');
    const didEmitInitialChange = useRef(false);

    const items: { title: string; value: string }[] = [];
    const walk = (nodes: React.ReactNode) => {
      React.Children.forEach(nodes, (child) => {
        if (!React.isValidElement(child)) return;
        const props = child.props as any;
        if (props.value !== undefined && props.title !== undefined) items.push({ title: props.title, value: props.value });
        if (props.children) walk(props.children);
      });
    };
    walk(children);

    useEffect(() => {
      if (didEmitInitialChange.current || !onChange) return;
      const initial = value ?? defaultValue ?? items[0]?.value;
      if (initial === undefined) return;
      didEmitInitialChange.current = true;
      onChange(initial);
    }, [defaultValue, items, onChange, value]);

    return (
      <div className="relative">
        <select
          value={value ?? internalValue}
          onChange={(event) => {
            const nextValue = event.target.value;
            setInternalValue(nextValue);
            onChange?.(nextValue);
          }}
          title={tooltip}
          className="bg-[var(--ui-segment-bg)] border border-[var(--ui-segment-border)] rounded-md px-2.5 py-1 text-[13px] text-[var(--text-primary)] outline-none cursor-pointer appearance-none pr-7"
        >
          {items.map((item) => <option key={item.value} value={item.value}>{item.title}</option>)}
        </select>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-subtle)]"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>
    );
  }

  ListDropdown.Item = (_props: { title: string; value: string; icon?: any }) => null;
  ListDropdown.Section = ({ children }: { children?: React.ReactNode; title?: string }) => <>{children}</>;

  return {
    ListItemComponent,
    ListItemRenderer,
    ListEmojiGridItemRenderer,
    ListSectionComponent,
    ListEmptyView,
    ListDropdown,
  };
}
