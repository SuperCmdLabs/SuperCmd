import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

export type SearchableDropdownOption = {
  value: string;
  label: string;
  searchText?: string;
  icon?: React.ReactNode;
  disabled?: boolean;
};

type SearchableDropdownProps = {
  value: string;
  options: SearchableDropdownOption[];
  onChange: (value: string) => void;
  renderTriggerContent?: (selected: SearchableDropdownOption | undefined) => React.ReactNode;
  renderOptionContent?: (option: SearchableDropdownOption) => React.ReactNode;
  searchPlaceholder?: string;
  noResultsText?: string;
  triggerClassName?: string;
  menuClassName?: string;
  menuZIndexClassName?: string;
  listMaxHeight?: number;
  minMenuWidth?: number;
  autoFocusSearch?: boolean;
};

const DEFAULT_TRIGGER_CLASS = 'sc-dropdown-trigger';

const DEFAULT_MENU_CLASS = 'fixed overflow-hidden sc-dropdown-surface';

const SearchableDropdown: React.FC<SearchableDropdownProps> = ({
  value,
  options,
  onChange,
  renderTriggerContent,
  renderOptionContent,
  searchPlaceholder = 'Search...',
  noResultsText = 'No results found',
  triggerClassName = DEFAULT_TRIGGER_CLASS,
  menuClassName = DEFAULT_MENU_CLASS,
  menuZIndexClassName = 'z-[120]',
  listMaxHeight = 220,
  minMenuWidth = 300,
  autoFocusSearch = true,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number; maxHeight: number }>({
    top: 0,
    left: 0,
    width: minMenuWidth,
    maxHeight: 200,
  });

  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const selectedOption = useMemo(
    () => options.find((option) => option.value === value),
    [options, value]
  );

  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return options;
    return options.filter((option) => {
      const haystack = `${option.label} ${option.searchText || ''}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [options, query]);

  const refreshMenuPos = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const viewportPadding = 10;
    const desiredWidth = Math.max(minMenuWidth, rect.width);
    const estimatedMenuHeight = 280;
    const spaceBelow = window.innerHeight - rect.bottom - viewportPadding;
    const spaceAbove = rect.top - viewportPadding;
    const openAbove = spaceBelow < 240 && spaceAbove > 160;
    const top = openAbove ? Math.max(viewportPadding, rect.top - estimatedMenuHeight - 8) : rect.bottom + 8;
    const maxHeight = Math.max(140, Math.floor((openAbove ? spaceAbove : spaceBelow) - 12));
    const left = Math.min(
      Math.max(viewportPadding, rect.left),
      Math.max(viewportPadding, window.innerWidth - desiredWidth - viewportPadding)
    );

    setMenuPos({
      top,
      left,
      width: desiredWidth,
      maxHeight,
    });
  }, [minMenuWidth]);

  const closeMenu = useCallback((focusTrigger = true) => {
    setIsOpen(false);
    setQuery('');
    setHighlightedIndex(-1);
    if (focusTrigger) {
      requestAnimationFrame(() => {
        triggerRef.current?.focus();
      });
    }
  }, []);

  const commitSelection = useCallback((index: number) => {
    if (filteredOptions.length === 0) return;
    const boundedIndex = Math.min(Math.max(index, 0), filteredOptions.length - 1);
    const option = filteredOptions[boundedIndex];
    if (!option || option.disabled) return;
    onChange(option.value);
    closeMenu();
  }, [closeMenu, filteredOptions, onChange]);

  const openMenu = useCallback(() => {
    refreshMenuPos();
    setQuery('');
    setIsOpen(true);
    const selectedIndex = options.findIndex((option) => option.value === value && !option.disabled);
    setHighlightedIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [options, refreshMenuPos, value]);

  const handleMenuKeyDown = useCallback((event: React.KeyboardEvent<HTMLElement>) => {
    if (!isOpen) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
      return;
    }

    if (filteredOptions.length === 0) return;
    const maxIndex = Math.max(0, filteredOptions.length - 1);
    const currentIndex = Math.min(Math.max(highlightedIndex >= 0 ? highlightedIndex : 0, 0), maxIndex);

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      setHighlightedIndex((prev) => Math.min((prev >= 0 ? prev : 0) + 1, maxIndex));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      setHighlightedIndex((prev) => Math.max((prev >= 0 ? prev : 0) - 1, 0));
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      commitSelection(currentIndex);
    }
  }, [closeMenu, commitSelection, filteredOptions.length, highlightedIndex, isOpen]);

  useEffect(() => {
    optionRefs.current = optionRefs.current.slice(0, filteredOptions.length);
  }, [filteredOptions.length]);

  useEffect(() => {
    if (!isOpen) return;

    refreshMenuPos();
    const onResize = () => refreshMenuPos();
    const onScroll = () => refreshMenuPos();

    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [isOpen, refreshMenuPos]);

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (menuRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      closeMenu(false);
    };
    document.addEventListener('mousedown', onPointerDown, true);
    return () => document.removeEventListener('mousedown', onPointerDown, true);
  }, [closeMenu, isOpen]);

  useEffect(() => {
    if (!isOpen || !autoFocusSearch) return;
    requestAnimationFrame(() => {
      searchRef.current?.focus();
      searchRef.current?.select();
    });
  }, [autoFocusSearch, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    if (filteredOptions.length === 0) {
      setHighlightedIndex(-1);
      return;
    }
    const boundedIndex = Math.min(Math.max(highlightedIndex >= 0 ? highlightedIndex : 0, 0), filteredOptions.length - 1);
    if (boundedIndex !== highlightedIndex) {
      setHighlightedIndex(boundedIndex);
      return;
    }
    requestAnimationFrame(() => {
      const target = optionRefs.current[boundedIndex];
      if (!target) return;
      target.scrollIntoView({ block: 'nearest' });
    });
  }, [filteredOptions.length, highlightedIndex, isOpen]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={isOpen}
        onClick={() => {
          if (isOpen) {
            closeMenu(false);
            return;
          }
          openMenu();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
            event.preventDefault();
            openMenu();
            return;
          }
          if (event.key === 'Escape' && isOpen) {
            event.preventDefault();
            closeMenu(false);
          }
        }}
        className={triggerClassName}
      >
        <span className="min-w-0 flex-1 truncate">
          {renderTriggerContent ? (
            renderTriggerContent(selectedOption)
          ) : (
            <span className="truncate">{selectedOption?.label || 'Select an option'}</span>
          )}
        </span>
        <ChevronDown className="sc-dropdown-trigger-caret w-3.5 h-3.5" />
      </button>

      {isOpen && createPortal(
        <div
          ref={menuRef}
          className={`${menuClassName} ${menuZIndexClassName}`.trim()}
          style={{
            top: menuPos.top,
            left: menuPos.left,
            width: menuPos.width,
          }}
          onKeyDown={handleMenuKeyDown}
        >
          <div className="sc-dropdown-search border-b sc-dropdown-divider">
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(event) => {
                const nextQuery = event.target.value;
                setQuery(nextQuery);
                const normalizedQuery = nextQuery.trim().toLowerCase();
                const nextFiltered = normalizedQuery
                  ? options.filter((option) => {
                    const haystack = `${option.label} ${option.searchText || ''}`.toLowerCase();
                    return haystack.includes(normalizedQuery);
                  })
                  : options;
                const selectedIndex = nextFiltered.findIndex((option) => option.value === value && !option.disabled);
                setHighlightedIndex(selectedIndex >= 0 ? selectedIndex : 0);
              }}
              onKeyDown={handleMenuKeyDown}
              placeholder={searchPlaceholder}
              className="sc-dropdown-search-input"
            />
          </div>
          <div className="sc-dropdown-list overflow-y-auto" style={{ maxHeight: Math.min(menuPos.maxHeight, listMaxHeight) }}>
            {filteredOptions.map((option, index) => {
              const isHighlighted = highlightedIndex === index;
              const isSelected = option.value === value;
              return (
                <button
                  key={option.value}
                  ref={(el) => {
                    optionRefs.current[index] = el;
                  }}
                  type="button"
                  tabIndex={isHighlighted ? 0 : -1}
                  onFocus={() => setHighlightedIndex(index)}
                  onMouseMove={() => setHighlightedIndex(index)}
                  onKeyDown={handleMenuKeyDown}
                  onClick={() => commitSelection(index)}
                  disabled={option.disabled}
                  aria-selected={isHighlighted}
                  aria-disabled={option.disabled || undefined}
                  className="sc-dropdown-item"
                >
                  {renderOptionContent ? (
                    <span className="min-w-0 flex-1 flex items-center gap-2">{renderOptionContent(option)}</span>
                  ) : (
                    <>
                      {option.icon ? <span className="w-4 h-4 flex-shrink-0 flex items-center justify-center">{option.icon}</span> : null}
                      <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    </>
                  )}
                  {isSelected ? <Check className="w-3.5 h-3.5 text-[var(--accent)] flex-shrink-0" /> : null}
                </button>
              );
            })}
            {filteredOptions.length === 0 ? (
              <div className="sc-dropdown-empty">{noResultsText}</div>
            ) : null}
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

export default SearchableDropdown;
