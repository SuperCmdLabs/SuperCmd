/**
 * List runtime renderers and static child components.
 *
 * Contains list row renderers, registration components, and list-level
 * subcomponents like EmptyView and Dropdown.
 */

import React, { useContext, useEffect, useRef, useState } from 'react';
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

  function ListItemComponent(props: ListItemProps) {
    const registry = useContext(ListRegistryContext);
    const sectionTitle = useContext(ListSectionTitleContext);
    const stableId = useRef(props.id || `__li_${++itemOrderCounter}`).current;
    const order = ++itemOrderCounter;

    registry.set(stableId, { props, sectionTitle, order });
    useEffect(() => () => registry.delete(stableId), [registry, stableId]);
    return null;
  }

  (ListItemComponent as any).Accessory = {} as ListItemAccessory;
  (ListItemComponent as any).Props = {} as ListItemProps;

  function ListItemRenderer({ title, subtitle, icon, accessories, isSelected, dataIdx, onSelect, onActivate, onContextAction, assetsPath }: ListItemProps & any) {
    const titleStr = typeof title === 'string' ? title : (title as any)?.value || '';
    const subtitleStr = typeof subtitle === 'string' ? subtitle : (subtitle as any)?.value || '';

    return (
      <div
        data-idx={dataIdx}
        className={`mx-2 px-3 py-1.5 rounded-xl min-h-[38px] flex items-center cursor-pointer transition-all ${isSelected ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]'}`}
        onClick={onActivate}
        onMouseMove={onSelect}
        onContextMenu={onContextAction}
      >
        <div className="flex items-center gap-2.5 w-full">
          {icon && <div className="w-5 h-5 flex items-center justify-center flex-shrink-0 text-white/55 text-xs">{renderIcon(icon, 'w-5 h-5', assetsPath)}</div>}
          <div className="flex-1 min-w-0"><span className="text-[13px] leading-[18px] truncate block" style={{ color: 'rgba(255,255,255,0.9)' }}>{titleStr}</span></div>
          {subtitleStr && <span className="text-[11px] leading-[16px] flex-shrink-0 truncate max-w-[220px]" style={{ color: 'rgba(255,255,255,0.42)' }}>{subtitleStr}</span>}
          {accessories?.map((accessory, index) => {
            const accessoryText = typeof accessory?.text === 'string' ? accessory.text : typeof accessory?.text === 'object' ? accessory.text?.value || '' : '';
            const accessoryTextColorRaw = typeof accessory?.text === 'object' ? accessory.text?.color : undefined;
            const tagText = typeof accessory?.tag === 'string' ? accessory.tag : typeof accessory?.tag === 'object' ? accessory.tag?.value || '' : '';
            const tagColorRaw = typeof accessory?.tag === 'object' ? accessory.tag?.color : undefined;
            const accessoryTextColor = resolveTintColor(accessoryTextColorRaw);
            const tagColor = resolveTintColor(tagColorRaw);
            const dateString = accessory?.date ? new Date(accessory.date).toLocaleDateString() : '';
            const tagBackground = tagColor ? addHexAlpha(tagColor, '22') || 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.1)';

            return (
              <span key={index} className="text-[12px] leading-5 flex-shrink-0 flex items-center gap-1.5" style={{ color: accessoryTextColor || tagColor || 'rgba(255,255,255,0.35)' }}>
                {accessory?.icon && <span className="text-[10px]">{renderIcon(accessory.icon, 'w-3 h-3', assetsPath)}</span>}
                {tagText ? <span className="px-2 py-0.5 rounded text-[11px]" style={{ background: tagBackground, color: tagColor || 'rgba(255,255,255,0.55)' }}>{tagText}</span> : accessoryText || dateString || ''}
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
        className={`relative rounded-2xl cursor-pointer transition-all overflow-hidden flex items-center justify-center ${isSelected ? 'ring-2 ring-white/70 bg-white/[0.10]' : 'bg-white/[0.05] hover:bg-white/[0.08]'}`}
        style={{ minHeight: '96px' }}
        onClick={onActivate}
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
      <div className="flex flex-col items-center justify-center h-full text-white/40 py-12">
        {icon && <div className="text-2xl mb-2 opacity-40">{typeof icon === 'string' ? icon : '○'}</div>}
        {title && <p className="text-sm font-medium">{title}</p>}
        {description && <p className="text-xs text-white/25 mt-1 max-w-xs text-center">{description}</p>}
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
      <select
        value={value ?? internalValue}
        onChange={(event) => {
          const nextValue = event.target.value;
          setInternalValue(nextValue);
          onChange?.(nextValue);
        }}
        title={tooltip}
        className="bg-white/[0.06] border border-white/[0.08] rounded-md px-2.5 py-1 text-[13px] text-white/70 outline-none cursor-pointer appearance-none pr-6"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='rgba(255,255,255,0.3)' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 6px center',
        }}
      >
        {items.map((item) => <option key={item.value} value={item.value}>{item.title}</option>)}
      </select>
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
