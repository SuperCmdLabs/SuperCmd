import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronRight, ExternalLink, ShieldAlert } from 'lucide-react';
import ExtensionActionFooter from './components/ExtensionActionFooter';
import type { CalendarAccessStatus, CalendarAgendaEvent, CalendarEventsResult } from '../types/electron';

interface ScheduleExtensionProps {
  onClose: () => void;
}

interface ActionItem {
  title: string;
  icon?: React.ReactNode;
  shortcut?: string[];
  disabled?: boolean;
  execute: () => void | Promise<void>;
}

const PAGE_DAYS = 14;
const HORIZON_DAYS = 365;
const CALENDAR_PRIVACY_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars';

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDaysAtMidnight(date: Date, days: number): Date {
  const next = startOfDay(date);
  next.setDate(next.getDate() + days);
  return next;
}

function parseEventDate(value: string): Date {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function toIsoString(date: Date): string {
  return date.toISOString();
}

function eventKey(event: CalendarAgendaEvent): string {
  return `${event.id}:${event.start}:${event.end}`;
}

function mergeEvents(existing: CalendarAgendaEvent[], next: CalendarAgendaEvent[]): CalendarAgendaEvent[] {
  const merged = new Map<string, CalendarAgendaEvent>();
  for (const event of existing) merged.set(eventKey(event), event);
  for (const event of next) merged.set(eventKey(event), event);
  return Array.from(merged.values()).sort(
    (left, right) => parseEventDate(left.start).getTime() - parseEventDate(right.start).getTime()
  );
}

function sameDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate();
}

function normalizeSearch(query: string): string[] {
  return String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function matchesSearch(event: CalendarAgendaEvent, query: string): boolean {
  const tokens = normalizeSearch(query);
  if (tokens.length === 0) return true;
  const haystack = [event.title, event.calendarName, event.location, event.notes].join(' ').toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

function formatShortDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function formatSectionTitle(date: Date, today: Date): string {
  if (sameDay(date, today)) return 'Today';
  if (sameDay(date, addDaysAtMidnight(today, 1))) return 'Tomorrow';
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function formatEventTime(event: CalendarAgendaEvent): string {
  if (event.isAllDay) return 'All day';
  const start = parseEventDate(event.start);
  const end = parseEventDate(event.end);
  const formatter = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${formatter.format(start)} - ${formatter.format(end)}`;
}

function formatFullDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function formatRelativeUpcoming(event: CalendarAgendaEvent): string {
  const deltaMinutes = Math.round((parseEventDate(event.start).getTime() - Date.now()) / 60000);
  if (deltaMinutes <= 0) return 'Now';
  if (deltaMinutes < 60) return `In ${deltaMinutes} min`;
  const hours = Math.floor(deltaMinutes / 60);
  const minutes = deltaMinutes % 60;
  if (hours < 24) return minutes > 0 ? `In ${hours}h ${minutes}m` : `In ${hours}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `In ${days}d ${remainingHours}h` : `In ${days}d`;
}

type DayGroup = {
  key: string;
  date: Date;
  title: string;
  items: CalendarAgendaEvent[];
};

const ScheduleExtension: React.FC<ScheduleExtensionProps> = ({ onClose }) => {
  const today = useMemo(() => startOfDay(new Date()), []);
  const initialEnd = useMemo(() => addDaysAtMidnight(today, PAGE_DAYS), [today]);
  const horizonEnd = useMemo(() => addDaysAtMidnight(today, HORIZON_DAYS), [today]);

  const [events, setEvents] = useState<CalendarAgendaEvent[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loadedUntil, setLoadedUntil] = useState(initialEnd);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [accessStatus, setAccessStatus] = useState<CalendarAccessStatus>('unknown');
  const [errorText, setErrorText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [selectedActionIndex, setSelectedActionIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const actionsOverlayRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);

  const isGlassyTheme =
    document.documentElement.classList.contains('sc-glassy') ||
    document.body.classList.contains('sc-glassy');
  const isNativeLiquidGlass =
    document.documentElement.classList.contains('sc-native-liquid-glass') ||
    document.body.classList.contains('sc-native-liquid-glass');

  const fetchRange = useCallback(async (start: Date, end: Date): Promise<CalendarEventsResult> => {
    return await window.electron.getCalendarEvents({
      start: toIsoString(start),
      end: toIsoString(end),
    });
  }, []);

  const loadInitial = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await fetchRange(today, initialEnd);
      setAccessStatus(result.accessStatus);
      setErrorText(result.error || '');
      setEvents(result.granted ? mergeEvents([], result.events) : []);
      setLoadedUntil(initialEnd);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Failed to load calendar events.');
    } finally {
      setIsLoading(false);
    }
  }, [fetchRange, initialEnd, today]);

  const loadMore = useCallback(async () => {
    if (isLoading || isLoadingMore || loadedUntil >= horizonEnd) return;

    setIsLoadingMore(true);
    try {
      const nextEnd = addDaysAtMidnight(loadedUntil, PAGE_DAYS);
      const result = await fetchRange(loadedUntil, nextEnd);
      setAccessStatus(result.accessStatus);
      setErrorText(result.error || '');
      if (result.granted) {
        setEvents((current) => mergeEvents(current, result.events));
        setLoadedUntil(nextEnd);
      }
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Failed to load more events.');
    } finally {
      setIsLoadingMore(false);
    }
  }, [fetchRange, horizonEnd, isLoading, isLoadingMore, loadedUntil]);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    void loadInitial();
    window.requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
  }, [loadInitial]);

  const filteredEvents = useMemo(
    () => events.filter((event) => matchesSearch(event, searchQuery)),
    [events, searchQuery]
  );

  const dayGroups = useMemo<DayGroup[]>(() => {
    const groups: DayGroup[] = [];
    for (const event of filteredEvents) {
      const date = parseEventDate(event.start);
      const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
      const last = groups[groups.length - 1];
      if (!last || last.key !== key) {
        groups.push({
          key,
          date,
          title: formatSectionTitle(date, today),
          items: [event],
        });
      } else {
        last.items.push(event);
      }
    }
    return groups;
  }, [filteredEvents, today]);

  const flatRows = useMemo(
    () => dayGroups.flatMap((group) => group.items.map((event) => ({ group, event }))),
    [dayGroups]
  );

  useEffect(() => {
    itemRefs.current = itemRefs.current.slice(0, flatRows.length);
  }, [flatRows.length]);

  useEffect(() => {
    if (selectedIndex >= flatRows.length) {
      setSelectedIndex(Math.max(0, flatRows.length - 1));
    }
  }, [flatRows.length, selectedIndex]);

  useEffect(() => {
    const selectedElement = itemRefs.current[selectedIndex];
    const scrollContainer = listRef.current;
    if (!selectedElement || !scrollContainer) return;
    const containerRect = scrollContainer.getBoundingClientRect();
    const elementRect = selectedElement.getBoundingClientRect();
    if (elementRect.top < containerRect.top) {
      selectedElement.scrollIntoView({ block: 'start', behavior: 'smooth' });
    } else if (elementRect.bottom > containerRect.bottom) {
      selectedElement.scrollIntoView({ block: 'end', behavior: 'smooth' });
    }
  }, [selectedIndex]);

  useEffect(() => {
    if (!showActions) return;
    setSelectedActionIndex(0);
    setTimeout(() => actionsOverlayRef.current?.focus(), 0);
  }, [showActions]);

  const selectedEntry = flatRows[selectedIndex] || null;
  const selectedDayDate = selectedEntry?.group.date || null;

  const todayEvents = useMemo(
    () => events.filter((event) => sameDay(parseEventDate(event.start), today)),
    [events, today]
  );

  const nextUpcomingEvent = useMemo(
    () => events.find((event) => parseEventDate(event.end).getTime() >= Date.now()) || null,
    [events]
  );

  const permissionError =
    accessStatus === 'denied' ||
    accessStatus === 'restricted' ||
    accessStatus === 'write-only';

  const openCalendarApp = useCallback(async () => {
    await window.electron.runAppleScript('tell application "Calendar" to activate');
  }, []);

  const openPrivacySettings = useCallback(async () => {
    await window.electron.openUrl(CALENDAR_PRIVACY_URL);
  }, []);

  const maybeLoadMore = useCallback((container: HTMLDivElement | null) => {
    if (!container) return;
    const remaining = container.scrollHeight - (container.scrollTop + container.clientHeight);
    if (remaining < 120) {
      void loadMore();
    }
  }, [loadMore]);

  const handleListScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    maybeLoadMore(event.currentTarget);
  }, [maybeLoadMore]);

  useEffect(() => {
    if (isLoading || isLoadingMore || permissionError || dayGroups.length === 0 || loadedUntil >= horizonEnd) return;
    const container = listRef.current;
    if (container && container.scrollHeight <= container.clientHeight + 48) {
      void loadMore();
    }
  }, [dayGroups.length, horizonEnd, isLoading, isLoadingMore, loadMore, loadedUntil, permissionError]);

  const actions: ActionItem[] = permissionError
    ? [
        {
          title: 'Open Calendar Privacy Settings',
          icon: <ShieldAlert className="w-4 h-4" />,
          execute: openPrivacySettings,
        },
      ]
    : [
        {
          title: 'Open in Calendar',
          icon: <ExternalLink className="w-4 h-4" />,
          shortcut: ['↩'],
          execute: openCalendarApp,
        },
      ];

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'k' && event.metaKey && !event.repeat) {
        event.preventDefault();
        setShowActions((current) => !current);
        return;
      }

      if (showActions) {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          setSelectedActionIndex((current) => Math.min(current + 1, actions.length - 1));
          return;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          setSelectedActionIndex((current) => Math.max(current - 1, 0));
          return;
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          const action = actions[selectedActionIndex];
          if (action && !action.disabled) {
            void Promise.resolve(action.execute());
          }
          setShowActions(false);
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          setShowActions(false);
          return;
        }
        return;
      }

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          setSelectedIndex((current) => Math.min(current + 1, Math.max(0, flatRows.length - 1)));
          break;
        case 'ArrowUp':
          event.preventDefault();
          setSelectedIndex((current) => Math.max(current - 1, 0));
          break;
        case 'Enter':
          event.preventDefault();
          if (!permissionError && selectedEntry) {
            void openCalendarApp();
          }
          break;
        case 'Escape':
          event.preventDefault();
          onClose();
          break;
      }
    },
    [actions, flatRows.length, onClose, openCalendarApp, permissionError, selectedActionIndex, selectedEntry, showActions]
  );

  const todaySummary = todayEvents.length > 0
    ? `${todayEvents[0].title}${todayEvents.length > 1 ? ` +${todayEvents.length - 1} more` : ''}`
    : 'There is nothing today.';

  const upcomingSummary = nextUpcomingEvent
    ? `${nextUpcomingEvent.title} · ${formatRelativeUpcoming(nextUpcomingEvent)}`
    : 'Nothing upcoming right now.';

  return (
    <div className="w-full h-full flex flex-col relative" onKeyDown={handleKeyDown} tabIndex={-1}>
      <div className="flex items-center gap-3 px-5 py-3.5 border-b border-[var(--ui-divider)]">
        <button
          onClick={onClose}
          className="text-[var(--text-subtle)] hover:text-[var(--text-muted)] transition-colors flex-shrink-0 focus:outline-none focus-visible:outline-none focus:ring-0 focus-visible:ring-0"
          tabIndex={-1}
          title="Back"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <input
          ref={inputRef}
          type="text"
          placeholder="Filter by title..."
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          className="flex-1 bg-transparent border-none outline-none text-[var(--text-primary)] placeholder:text-[color:var(--text-muted)] text-[15px] font-medium tracking-[0.005em]"
          autoFocus
        />
      </div>

      <div className="grid grid-cols-2 gap-0 border-b border-[var(--ui-divider)]">
        <div className="px-5 py-2.5 border-r border-[var(--ui-divider)] min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] font-semibold">Today</div>
          <div className="mt-1 text-[13px] leading-5 text-[var(--text-secondary)] whitespace-normal break-words">
            {todaySummary}
          </div>
        </div>
        <div className="px-5 py-2.5 min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] font-semibold">Upcoming</div>
          <div className="mt-1 text-[13px] leading-5 text-[var(--text-secondary)] whitespace-normal break-words">
            {upcomingSummary}
          </div>
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        <div
          ref={listRef}
          onScroll={handleListScroll}
          className="w-full overflow-y-auto custom-scrollbar"
        >
          {isLoading ? (
            <div className="flex items-center justify-center h-full text-[var(--text-muted)]">
              <p className="text-sm">Loading schedule...</p>
            </div>
          ) : permissionError ? (
            <div className="flex items-center justify-center h-full text-[var(--text-muted)] px-6">
              <div className="text-center">
                <ShieldAlert className="w-5 h-5 mx-auto mb-3 text-[var(--text-subtle)]" />
                <p className="text-sm">Calendar access is required.</p>
              </div>
            </div>
          ) : flatRows.length === 0 ? (
            <div className="flex items-center justify-center h-full text-[var(--text-muted)]">
              <p className="text-sm px-6 text-center">
                {searchQuery.trim() ? 'No events match that title.' : 'There is nothing up on your calendar right now.'}
              </p>
            </div>
          ) : (
            <div className="p-2 space-y-2">
              {dayGroups.map((group) => (
                <div key={group.key}>
                  <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-white/45 font-semibold">
                    {group.title}
                  </div>
                  <div className="space-y-1">
                    {group.items.map((event) => {
                      const flatIndex = flatRows.findIndex((entry) => eventKey(entry.event) === eventKey(event));
                      const selected = flatIndex === selectedIndex;
                      return (
                        <div
                          key={eventKey(event)}
                          ref={(element) => {
                            itemRefs.current[flatIndex] = element;
                          }}
                          className={`px-2.5 py-2 rounded-md border cursor-pointer transition-colors ${
                            selected
                              ? 'bg-[var(--launcher-card-selected-bg)] border-[var(--launcher-card-border)]'
                              : 'border-transparent hover:border-[var(--launcher-card-border)] hover:bg-[var(--launcher-card-hover-bg)]'
                          }`}
                          onClick={() => setSelectedIndex(flatIndex)}
                          onMouseEnter={() => setSelectedIndex(flatIndex)}
                          onDoubleClick={() => void openCalendarApp()}
                        >
                          <div className="flex items-start gap-2 min-w-0">
                            <div
                              className="w-4 h-4 rounded-full border flex-shrink-0"
                              style={{
                                borderColor: event.calendarColor || 'rgba(255,255,255,0.35)',
                                boxShadow: `inset 0 0 0 1px ${event.calendarColor || 'rgba(255,255,255,0.35)'}`,
                              }}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="text-[var(--text-secondary)] text-[13px] leading-5 whitespace-normal break-words">
                                {event.title}
                              </div>
                              <div className="text-[var(--text-muted)] text-[11px] leading-4 whitespace-normal break-words">
                                {formatEventTime(event)}
                              </div>
                            </div>
                            <ChevronRight className="w-3.5 h-3.5 text-[var(--text-muted)] flex-shrink-0 mt-1" />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
              {isLoadingMore ? (
                <div className="px-2 py-2 text-[11px] text-[var(--text-muted)]">Loading more days...</div>
              ) : null}
            </div>
          )}
        </div>
      </div>

      <ExtensionActionFooter
        leftContent={
          <span className="truncate">
            {permissionError
              ? 'Calendar access required'
              : flatRows.length === 0
                ? 'My Schedule'
                : `${formatShortDate(selectedDayDate || today)}`}
          </span>
        }
        primaryAction={
          permissionError
            ? undefined
            : {
                label: 'Open in Calendar',
                onClick: () => void openCalendarApp(),
                shortcut: ['↩'],
              }
        }
        actionsButton={{
          label: 'Actions',
          onClick: () => setShowActions(true),
          shortcut: ['⌘', 'K'],
        }}
      />

      {showActions && (
        <div
          className="fixed inset-0 z-50"
          onClick={() => setShowActions(false)}
          style={{ background: 'var(--bg-scrim)' }}
        >
          <div
            ref={actionsOverlayRef}
            className="absolute bottom-12 right-3 w-80 max-h-[65vh] rounded-xl overflow-hidden flex flex-col shadow-2xl outline-none focus:outline-none focus-visible:outline-none ring-0 focus:ring-0 focus-visible:ring-0"
            tabIndex={0}
            style={
              isNativeLiquidGlass
                ? {
                    background: 'rgba(var(--surface-base-rgb), 0.72)',
                    backdropFilter: 'blur(44px) saturate(155%)',
                    WebkitBackdropFilter: 'blur(44px) saturate(155%)',
                    border: '1px solid rgba(var(--on-surface-rgb), 0.22)',
                    boxShadow: '0 18px 38px -12px rgba(var(--backdrop-rgb), 0.26)',
                  }
                : isGlassyTheme
                  ? {
                      background: 'linear-gradient(160deg, rgba(var(--on-surface-rgb), 0.08), rgba(var(--on-surface-rgb), 0.01)), rgba(var(--surface-base-rgb), 0.42)',
                      backdropFilter: 'blur(96px) saturate(190%)',
                      WebkitBackdropFilter: 'blur(96px) saturate(190%)',
                      border: '1px solid rgba(var(--on-surface-rgb), 0.05)',
                    }
                  : {
                      background: 'var(--card-bg)',
                      backdropFilter: 'blur(40px)',
                      WebkitBackdropFilter: 'blur(40px)',
                      border: '1px solid var(--border-primary)',
                    }
            }
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex-1 overflow-y-auto py-1">
              {actions.map((action, index) => (
                <div
                  key={`${action.title}-${index}`}
                  className={`mx-1 px-2.5 py-1.5 rounded-lg border border-transparent flex items-center gap-2.5 cursor-pointer transition-colors ${
                    index === selectedActionIndex
                      ? 'bg-[var(--action-menu-selected-bg)] text-[var(--text-primary)]'
                      : 'hover:bg-[var(--overlay-item-hover-bg)] text-[var(--text-secondary)]'
                  } ${action.disabled ? 'opacity-45 cursor-not-allowed' : ''}`}
                  style={
                    index === selectedActionIndex
                      ? {
                          background: 'var(--action-menu-selected-bg)',
                          borderColor: 'var(--action-menu-selected-border)',
                          boxShadow: 'var(--action-menu-selected-shadow)',
                        }
                      : undefined
                  }
                  onMouseMove={() => setSelectedActionIndex(index)}
                  onClick={() => {
                    if (action.disabled) return;
                    void Promise.resolve(action.execute());
                    setShowActions(false);
                  }}
                >
                  {action.icon ? <span className="text-[var(--text-muted)]">{action.icon}</span> : null}
                  <span className="flex-1 text-sm truncate">{action.title}</span>
                  {action.shortcut ? (
                    <span className="flex items-center gap-0.5">
                      {action.shortcut.map((key, keyIndex) => (
                        <kbd
                          key={`${action.title}-${key}-${keyIndex}`}
                          className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[11px] font-medium text-[var(--text-muted)]"
                        >
                          {key}
                        </kbd>
                      ))}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ScheduleExtension;
