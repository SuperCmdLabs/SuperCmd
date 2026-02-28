import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { onThemeChange } from './utils/theme';
import type { AppSettings } from '../types/electron';
import { formatShortcutLabel } from './utils/command-helpers';

type BoundsRect = {
  position: { x: number; y: number };
  size: { width: number; height: number };
};

type ManagedWindow = {
  id: string;
  title?: string;
  bounds?: BoundsRect;
  application?: { name?: string; path?: string };
  positionable?: boolean;
  resizable?: boolean;
};

type PresetId =
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'top-left-sixth'
  | 'top-center-sixth'
  | 'top-right-sixth'
  | 'bottom-left-sixth'
  | 'bottom-center-sixth'
  | 'bottom-right-sixth'
  | 'left'
  | 'right'
  | 'first-third'
  | 'center-third'
  | 'last-third'
  | 'first-two-thirds'
  | 'center-two-thirds'
  | 'last-two-thirds'
  | 'first-fourth'
  | 'second-fourth'
  | 'third-fourth'
  | 'last-fourth'
  | 'first-three-fourths'
  | 'center-three-fourths'
  | 'last-three-fourths'
  | 'top'
  | 'bottom'
  | 'center'
  | 'center-80'
  | 'fill'
  | 'auto-organize'
  | 'increase-size-10'
  | 'decrease-size-10'
  | 'increase-left-10'
  | 'increase-right-10'
  | 'increase-bottom-10'
  | 'increase-top-10'
  | 'decrease-left-10'
  | 'decrease-right-10'
  | 'decrease-bottom-10'
  | 'decrease-top-10'
  | 'move-up-10'
  | 'move-down-10'
  | 'move-left-10'
  | 'move-right-10';

type Rect = { x: number; y: number; width: number; height: number };
type ScreenArea = { left: number; top: number; width: number; height: number };

type LayoutMove = { id: string; bounds: BoundsRect };

interface WindowManagerPanelProps {
  show: boolean;
  portalTarget?: HTMLElement | null;
  onClose: () => void;
}

export type WindowManagementPresetCommand = {
  commandId: string;
  presetId: PresetId;
};

export const WINDOW_MANAGEMENT_PRESET_COMMANDS: WindowManagementPresetCommand[] = [
  { commandId: 'system-window-management-left', presetId: 'left' },
  { commandId: 'system-window-management-right', presetId: 'right' },
  { commandId: 'system-window-management-top', presetId: 'top' },
  { commandId: 'system-window-management-bottom', presetId: 'bottom' },
  { commandId: 'system-window-management-center', presetId: 'center' },
  { commandId: 'system-window-management-center-80', presetId: 'center-80' },
  { commandId: 'system-window-management-fill', presetId: 'fill' },
  { commandId: 'system-window-management-top-left', presetId: 'top-left' },
  { commandId: 'system-window-management-top-right', presetId: 'top-right' },
  { commandId: 'system-window-management-bottom-left', presetId: 'bottom-left' },
  { commandId: 'system-window-management-bottom-right', presetId: 'bottom-right' },
  { commandId: 'system-window-management-first-third', presetId: 'first-third' },
  { commandId: 'system-window-management-center-third', presetId: 'center-third' },
  { commandId: 'system-window-management-last-third', presetId: 'last-third' },
  { commandId: 'system-window-management-first-two-thirds', presetId: 'first-two-thirds' },
  { commandId: 'system-window-management-center-two-thirds', presetId: 'center-two-thirds' },
  { commandId: 'system-window-management-last-two-thirds', presetId: 'last-two-thirds' },
  { commandId: 'system-window-management-first-fourth', presetId: 'first-fourth' },
  { commandId: 'system-window-management-second-fourth', presetId: 'second-fourth' },
  { commandId: 'system-window-management-third-fourth', presetId: 'third-fourth' },
  { commandId: 'system-window-management-last-fourth', presetId: 'last-fourth' },
  { commandId: 'system-window-management-first-three-fourths', presetId: 'first-three-fourths' },
  { commandId: 'system-window-management-center-three-fourths', presetId: 'center-three-fourths' },
  { commandId: 'system-window-management-last-three-fourths', presetId: 'last-three-fourths' },
  { commandId: 'system-window-management-top-left-sixth', presetId: 'top-left-sixth' },
  { commandId: 'system-window-management-top-center-sixth', presetId: 'top-center-sixth' },
  { commandId: 'system-window-management-top-right-sixth', presetId: 'top-right-sixth' },
  { commandId: 'system-window-management-bottom-left-sixth', presetId: 'bottom-left-sixth' },
  { commandId: 'system-window-management-bottom-center-sixth', presetId: 'bottom-center-sixth' },
  { commandId: 'system-window-management-bottom-right-sixth', presetId: 'bottom-right-sixth' },
  { commandId: 'system-window-management-increase-size-10', presetId: 'increase-size-10' },
  { commandId: 'system-window-management-decrease-size-10', presetId: 'decrease-size-10' },
  { commandId: 'system-window-management-increase-left-10', presetId: 'increase-left-10' },
  { commandId: 'system-window-management-increase-right-10', presetId: 'increase-right-10' },
  { commandId: 'system-window-management-increase-bottom-10', presetId: 'increase-bottom-10' },
  { commandId: 'system-window-management-increase-top-10', presetId: 'increase-top-10' },
  { commandId: 'system-window-management-decrease-left-10', presetId: 'decrease-left-10' },
  { commandId: 'system-window-management-decrease-right-10', presetId: 'decrease-right-10' },
  { commandId: 'system-window-management-decrease-bottom-10', presetId: 'decrease-bottom-10' },
  { commandId: 'system-window-management-decrease-top-10', presetId: 'decrease-top-10' },
  { commandId: 'system-window-management-move-up-10', presetId: 'move-up-10' },
  { commandId: 'system-window-management-move-down-10', presetId: 'move-down-10' },
  { commandId: 'system-window-management-move-left-10', presetId: 'move-left-10' },
  { commandId: 'system-window-management-move-right-10', presetId: 'move-right-10' },
];

const WINDOW_MANAGEMENT_PRESET_BY_COMMAND_ID = new Map<string, PresetId>(
  WINDOW_MANAGEMENT_PRESET_COMMANDS.map((item) => [item.commandId, item.presetId])
);
const WINDOW_MANAGEMENT_COMMAND_ID_BY_PRESET = new Map<PresetId, string>(
  WINDOW_MANAGEMENT_PRESET_COMMANDS.map((item) => [item.presetId, item.commandId])
);

const PRESETS: Array<{ id: PresetId; label: string; subtitle: string }> = [
  { id: 'left', label: 'Left', subtitle: 'Current window' },
  { id: 'right', label: 'Right', subtitle: 'Current window' },
  { id: 'top', label: 'Top', subtitle: 'Current window' },
  { id: 'bottom', label: 'Bottom', subtitle: 'Current window' },
  { id: 'center', label: 'Center', subtitle: 'Current window' },
  { id: 'center-80', label: 'Almost Maximize', subtitle: 'Current window' },
  { id: 'fill', label: 'Maximize', subtitle: 'Current window' },
  { id: 'top-left', label: 'Top Left', subtitle: 'Current window' },
  { id: 'top-right', label: 'Top Right', subtitle: 'Current window' },
  { id: 'bottom-right', label: 'Bottom Right', subtitle: 'Current window' },
  { id: 'bottom-left', label: 'Bottom Left', subtitle: 'Current window' },
  { id: 'first-third', label: 'First Third', subtitle: 'Current window' },
  { id: 'center-third', label: 'Center Third', subtitle: 'Current window' },
  { id: 'last-third', label: 'Last Third', subtitle: 'Current window' },
  { id: 'first-two-thirds', label: 'First Two Thirds', subtitle: 'Current window' },
  { id: 'center-two-thirds', label: 'Center Two Thirds', subtitle: 'Current window' },
  { id: 'last-two-thirds', label: 'Last Two Thirds', subtitle: 'Current window' },
  { id: 'first-fourth', label: 'First Fourth', subtitle: 'Current window' },
  { id: 'second-fourth', label: 'Second Fourth', subtitle: 'Current window' },
  { id: 'third-fourth', label: 'Third Fourth', subtitle: 'Current window' },
  { id: 'last-fourth', label: 'Last Fourth', subtitle: 'Current window' },
  { id: 'first-three-fourths', label: 'First Three Fourths', subtitle: 'Current window' },
  { id: 'center-three-fourths', label: 'Center Three Fourths', subtitle: 'Current window' },
  { id: 'last-three-fourths', label: 'Last Three Fourths', subtitle: 'Current window' },
  { id: 'top-left-sixth', label: 'Top Left Sixth', subtitle: 'Current window' },
  { id: 'top-center-sixth', label: 'Top Center Sixth', subtitle: 'Current window' },
  { id: 'top-right-sixth', label: 'Top Right Sixth', subtitle: 'Current window' },
  { id: 'bottom-left-sixth', label: 'Bottom Left Sixth', subtitle: 'Current window' },
  { id: 'bottom-center-sixth', label: 'Bottom Center Sixth', subtitle: 'Current window' },
  { id: 'bottom-right-sixth', label: 'Bottom Right Sixth', subtitle: 'Current window' },
  { id: 'increase-size-10', label: 'Increase size by 10%', subtitle: 'Current window' },
  { id: 'decrease-size-10', label: 'Decrease size by 10%', subtitle: 'Current window' },
  { id: 'increase-left-10', label: 'Increase on left by 10%', subtitle: 'Current window' },
  { id: 'increase-right-10', label: 'Increase on right by 10%', subtitle: 'Current window' },
  { id: 'increase-bottom-10', label: 'Increase on bottom by 10%', subtitle: 'Current window' },
  { id: 'increase-top-10', label: 'Increase on top by 10%', subtitle: 'Current window' },
  { id: 'decrease-left-10', label: 'Decrease on left by 10%', subtitle: 'Current window' },
  { id: 'decrease-right-10', label: 'Decrease on right by 10%', subtitle: 'Current window' },
  { id: 'decrease-bottom-10', label: 'Decrease on bottom by 10%', subtitle: 'Current window' },
  { id: 'decrease-top-10', label: 'Decrease on top by 10%', subtitle: 'Current window' },
  { id: 'move-up-10', label: 'Move up by 10%', subtitle: 'Current window' },
  { id: 'move-down-10', label: 'Move down by 10%', subtitle: 'Current window' },
  { id: 'move-left-10', label: 'Move left by 10%', subtitle: 'Current window' },
  { id: 'move-right-10', label: 'Move right by 10%', subtitle: 'Current window' },
];

const MULTI_WINDOW_PRESETS = new Set<PresetId>(['auto-organize']);
const SHIFT_ENTER_ONLY_PRESETS = new Set<PresetId>([
  'increase-size-10',
  'decrease-size-10',
  'increase-left-10',
  'increase-right-10',
  'increase-bottom-10',
  'increase-top-10',
  'decrease-left-10',
  'decrease-right-10',
  'decrease-bottom-10',
  'decrease-top-10',
  'move-up-10',
  'move-down-10',
  'move-left-10',
  'move-right-10',
]);
const WINDOW_ADJUST_RATIO = 0.1;
const MIN_WINDOW_WIDTH = 120;
const MIN_WINDOW_HEIGHT = 60;
const WINDOW_PRESET_EXECUTION_MIN_INTERVAL_MS = 14;
let windowPresetExecutionQueue: Promise<void> = Promise.resolve();
let lastWindowPresetExecutionAt = 0;

function resolveIsDarkTheme(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return true;
  const preference = String(window.localStorage.getItem('sc-theme-preference') || '').trim().toLowerCase();
  if (preference === 'dark') return true;
  if (preference === 'light') return false;
  if (document.documentElement.classList.contains('dark') || document.body.classList.contains('dark')) return true;
  return typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)').matches : true;
}

function renderPresetIcon(id: PresetId): JSX.Element {
  const cells: Array<{ x: number; y: number; w: number; h: number }> = [];
  switch (id) {
    case 'top-left':
      cells.push({ x: 1, y: 1, w: 9, h: 6 });
      break;
    case 'top-right':
      cells.push({ x: 10, y: 1, w: 9, h: 6 });
      break;
    case 'bottom-left':
      cells.push({ x: 1, y: 7, w: 9, h: 6 });
      break;
    case 'bottom-right':
      cells.push({ x: 10, y: 7, w: 9, h: 6 });
      break;
    case 'top-left-sixth':
      cells.push({ x: 1, y: 1, w: 6, h: 6 });
      break;
    case 'top-center-sixth':
      cells.push({ x: 7, y: 1, w: 6, h: 6 });
      break;
    case 'top-right-sixth':
      cells.push({ x: 13, y: 1, w: 6, h: 6 });
      break;
    case 'bottom-left-sixth':
      cells.push({ x: 1, y: 7, w: 6, h: 6 });
      break;
    case 'bottom-center-sixth':
      cells.push({ x: 7, y: 7, w: 6, h: 6 });
      break;
    case 'bottom-right-sixth':
      cells.push({ x: 13, y: 7, w: 6, h: 6 });
      break;
    case 'left':
      cells.push({ x: 1, y: 1, w: 9, h: 12 });
      break;
    case 'right':
      cells.push({ x: 10, y: 1, w: 9, h: 12 });
      break;
    case 'first-third':
      cells.push({ x: 1, y: 1, w: 6, h: 12 });
      break;
    case 'center-third':
      cells.push({ x: 7, y: 1, w: 6, h: 12 });
      break;
    case 'last-third':
      cells.push({ x: 13, y: 1, w: 6, h: 12 });
      break;
    case 'first-two-thirds':
      cells.push({ x: 1, y: 1, w: 12, h: 12 });
      break;
    case 'center-two-thirds':
      cells.push({ x: 4, y: 1, w: 12, h: 12 });
      break;
    case 'last-two-thirds':
      cells.push({ x: 7, y: 1, w: 12, h: 12 });
      break;
    case 'first-fourth':
      cells.push({ x: 1, y: 1, w: 5, h: 12 });
      break;
    case 'second-fourth':
      cells.push({ x: 6, y: 1, w: 4, h: 12 });
      break;
    case 'third-fourth':
      cells.push({ x: 10, y: 1, w: 4, h: 12 });
      break;
    case 'last-fourth':
      cells.push({ x: 14, y: 1, w: 5, h: 12 });
      break;
    case 'first-three-fourths':
      cells.push({ x: 1, y: 1, w: 14, h: 12 });
      break;
    case 'center-three-fourths':
      cells.push({ x: 3, y: 1, w: 14, h: 12 });
      break;
    case 'last-three-fourths':
      cells.push({ x: 6, y: 1, w: 13, h: 12 });
      break;
    case 'top':
      cells.push({ x: 1, y: 1, w: 18, h: 6 });
      break;
    case 'bottom':
      cells.push({ x: 1, y: 7, w: 18, h: 6 });
      break;
    case 'fill':
      cells.push({ x: 1, y: 1, w: 18, h: 12 });
      break;
    case 'center':
      cells.push({ x: 4, y: 3, w: 12, h: 8 });
      break;
    case 'center-80':
      cells.push({ x: 3, y: 2, w: 14, h: 10 });
      break;
    case 'auto-organize':
      cells.push(
        { x: 1, y: 1, w: 8, h: 5 },
        { x: 11, y: 1, w: 8, h: 5 },
        { x: 1, y: 8, w: 8, h: 5 },
        { x: 11, y: 8, w: 8, h: 5 }
      );
      break;
    default:
      cells.push({ x: 1, y: 1, w: 18, h: 12 });
      break;
  }

  return (
    <svg width={20} height={14} viewBox="0 0 20 14" fill="none" aria-hidden="true">
      <rect
        x={0.75}
        y={0.75}
        width={18.5}
        height={12.5}
        rx={2}
        stroke="currentColor"
        strokeWidth={1}
        strokeOpacity={0.5}
      />
      {cells.map((cell, index) => (
        <rect
          key={`${id}-${index}`}
          x={cell.x}
          y={cell.y}
          width={cell.w}
          height={cell.h}
          rx={1}
          fill="currentColor"
          fillOpacity={0.6}
        />
      ))}
    </svg>
  );
}

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function isShiftEnterOnlyPreset(presetId: PresetId): boolean {
  return SHIFT_ENTER_ONLY_PRESETS.has(presetId);
}

export function isWindowManagementPresetCommandId(commandId: string): boolean {
  return WINDOW_MANAGEMENT_PRESET_BY_COMMAND_ID.has(String(commandId || '').trim());
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (max <= min) return min;
  return Math.max(min, Math.min(max, value));
}

function getWindowRect(win: ManagedWindow | null | undefined): Rect | null {
  const x = Number(win?.bounds?.position?.x);
  const y = Number(win?.bounds?.position?.y);
  const width = Number(win?.bounds?.size?.width);
  const height = Number(win?.bounds?.size?.height);
  if (![x, y, width, height].every((value) => Number.isFinite(value))) return null;
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  };
}

function applyFineTunePreset(presetId: PresetId, target: ManagedWindow, area: ScreenArea): Rect | null {
  if (!isShiftEnterOnlyPreset(presetId)) return null;
  const base = getWindowRect(target);
  if (!base) return null;

  const areaRight = area.left + area.width;
  const areaBottom = area.top + area.height;
  const stepX = Math.max(1, Math.round(base.width * WINDOW_ADJUST_RATIO));
  const stepY = Math.max(1, Math.round(base.height * WINDOW_ADJUST_RATIO));
  let next: Rect = { ...base };

  switch (presetId) {
    case 'increase-size-10':
      next = {
        x: base.x - Math.round(stepX / 2),
        y: base.y - Math.round(stepY / 2),
        width: base.width + stepX,
        height: base.height + stepY,
      };
      break;
    case 'decrease-size-10':
      next = {
        x: base.x + Math.round(stepX / 2),
        y: base.y + Math.round(stepY / 2),
        width: Math.max(MIN_WINDOW_WIDTH, base.width - stepX),
        height: Math.max(MIN_WINDOW_HEIGHT, base.height - stepY),
      };
      break;
    case 'increase-left-10': {
      const rightEdge = base.x + base.width;
      const leftEdge = base.x - stepX;
      next = {
        x: leftEdge,
        y: base.y,
        width: rightEdge - leftEdge,
        height: base.height,
      };
      break;
    }
    case 'increase-right-10':
      next = {
        x: base.x,
        y: base.y,
        width: base.width + stepX,
        height: base.height,
      };
      break;
    case 'increase-top-10': {
      const bottomEdge = base.y + base.height;
      const topEdge = base.y - stepY;
      next = {
        x: base.x,
        y: topEdge,
        width: base.width,
        height: bottomEdge - topEdge,
      };
      break;
    }
    case 'increase-bottom-10':
      next = {
        x: base.x,
        y: base.y,
        width: base.width,
        height: base.height + stepY,
      };
      break;
    case 'decrease-left-10': {
      const rightEdge = base.x + base.width;
      const width = Math.max(MIN_WINDOW_WIDTH, base.width - stepX);
      next = {
        x: rightEdge - width,
        y: base.y,
        width,
        height: base.height,
      };
      break;
    }
    case 'decrease-right-10':
      next = {
        x: base.x,
        y: base.y,
        width: Math.max(MIN_WINDOW_WIDTH, base.width - stepX),
        height: base.height,
      };
      break;
    case 'decrease-top-10': {
      const bottomEdge = base.y + base.height;
      const height = Math.max(MIN_WINDOW_HEIGHT, base.height - stepY);
      next = {
        x: base.x,
        y: bottomEdge - height,
        width: base.width,
        height,
      };
      break;
    }
    case 'decrease-bottom-10':
      next = {
        x: base.x,
        y: base.y,
        width: base.width,
        height: Math.max(MIN_WINDOW_HEIGHT, base.height - stepY),
      };
      break;
    case 'move-up-10':
      next = { ...base, y: base.y - stepY };
      break;
    case 'move-down-10':
      next = { ...base, y: base.y + stepY };
      break;
    case 'move-left-10':
      next = { ...base, x: base.x - stepX };
      break;
    case 'move-right-10':
      next = { ...base, x: base.x + stepX };
      break;
    default:
      return null;
  }

  next.width = clamp(Math.round(next.width), MIN_WINDOW_WIDTH, area.width);
  next.height = clamp(Math.round(next.height), MIN_WINDOW_HEIGHT, area.height);
  next.x = clamp(Math.round(next.x), area.left, areaRight - next.width);
  next.y = clamp(Math.round(next.y), area.top, areaBottom - next.height);
  return next;
}

function isSuperCmdWindow(win: ManagedWindow | null | undefined): boolean {
  const appName = normalizeText(win?.application?.name).toLowerCase();
  const appPath = normalizeText((win as any)?.application?.path).toLowerCase();
  const title = normalizeText(win?.title).toLowerCase();
  return appName.includes('supercmd') || appPath.includes('supercmd') || title.includes('supercmd');
}

function isManageableWindow(win: ManagedWindow | null | undefined): win is ManagedWindow {
  if (!win) return false;
  if (!normalizeText(win.id)) return false;
  if (isSuperCmdWindow(win)) return false;
  const width = Number(win.bounds?.size?.width || 0);
  const height = Number(win.bounds?.size?.height || 0);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return false;
  if (width < 120 || height < 60) return false;
  return win.positionable !== false && win.resizable !== false;
}

function getHostMetrics(hostWindow: Window | null | undefined): ScreenArea {
  const target = hostWindow || window;
  const screenObj = target.screen as any;
  return {
    left: Number(screenObj?.availLeft ?? 0) || 0,
    top: Number(screenObj?.availTop ?? 0) || 0,
    width: Number(screenObj?.availWidth ?? target.innerWidth ?? 1440) || 1440,
    height: Number(screenObj?.availHeight ?? target.innerHeight ?? 900) || 900,
  };
}

function normalizeScreenArea(raw: any, fallback: ScreenArea): ScreenArea {
  const x = Number(raw?.x);
  const y = Number(raw?.y);
  const width = Number(raw?.width);
  const height = Number(raw?.height);
  if (![x, y, width, height].every((value) => Number.isFinite(value))) {
    return fallback;
  }
  return {
    left: Math.round(x),
    top: Math.round(y),
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  };
}


function getWindowCenter(win: ManagedWindow): { x: number; y: number } {
  const x = Number(win.bounds?.position?.x || 0);
  const y = Number(win.bounds?.position?.y || 0);
  const width = Number(win.bounds?.size?.width || 0);
  const height = Number(win.bounds?.size?.height || 0);
  return { x: x + width / 2, y: y + height / 2 };
}

function isWindowOnScreenArea(win: ManagedWindow, area: { left: number; top: number; width: number; height: number }): boolean {
  const x = Number(win.bounds?.position?.x);
  const y = Number(win.bounds?.position?.y);
  const width = Number(win.bounds?.size?.width);
  const height = Number(win.bounds?.size?.height);
  if (![x, y, width, height].every((value) => Number.isFinite(value))) return false;
  if (width <= 0 || height <= 0) return false;

  const winLeft = x;
  const winTop = y;
  const winRight = x + width;
  const winBottom = y + height;
  const areaLeft = area.left;
  const areaTop = area.top;
  const areaRight = area.left + area.width;
  const areaBottom = area.top + area.height;

  const overlapWidth = Math.max(0, Math.min(winRight, areaRight) - Math.max(winLeft, areaLeft));
  const overlapHeight = Math.max(0, Math.min(winBottom, areaBottom) - Math.max(winTop, areaTop));
  if (overlapWidth <= 0 || overlapHeight <= 0) return false;

  const overlapArea = overlapWidth * overlapHeight;
  const windowArea = Math.max(1, width * height);
  return overlapArea >= Math.max(64, windowArea * 0.2);
}

function rectToBounds(rect: Rect): BoundsRect {
  return {
    position: { x: Math.round(rect.x), y: Math.round(rect.y) },
    size: { width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) },
  };
}

function shrinkRect(rect: Rect, padding: number): Rect {
  const p = Math.max(0, padding);
  return {
    x: rect.x + p,
    y: rect.y + p,
    width: Math.max(1, rect.width - p * 2),
    height: Math.max(1, rect.height - p * 2),
  };
}

function computeGridDimensions(count: number, region: Rect): { cols: number; rows: number } {
  const total = Math.max(1, Math.floor(count));
  const width = Math.max(1, Math.floor(region.width));
  const height = Math.max(1, Math.floor(region.height));
  const targetAspect = width / height;
  let bestCols = 1;
  let bestRows = total;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let cols = 1; cols <= total; cols += 1) {
    const rows = Math.ceil(total / cols);
    const gridAspect = cols / rows;
    const empty = rows * cols - total;
    const score = Math.abs(gridAspect - targetAspect) + empty * 0.08;
    if (score < bestScore) {
      bestScore = score;
      bestCols = cols;
      bestRows = rows;
    }
  }

  return { cols: Math.max(1, bestCols), rows: Math.max(1, bestRows) };
}

function computeGridRects(
  count: number,
  region: Rect,
  options?: { gap?: number; padding?: number; cols?: number }
): Rect[] {
  if (count <= 0) return [];
  const gap = Math.max(0, options?.gap ?? 8);
  const padded = shrinkRect(region, options?.padding ?? 8);
  const requestedCols = options?.cols ? Math.max(1, Math.floor(options.cols)) : null;
  const resolvedCols = requestedCols ? Math.min(requestedCols, Math.max(1, count)) : null;
  const { cols, rows } = resolvedCols
    ? { cols: resolvedCols, rows: Math.max(1, Math.ceil(count / resolvedCols)) }
    : computeGridDimensions(count, padded);
  const totalGapW = gap * (cols - 1);
  const totalGapH = gap * (rows - 1);
  const baseCellW = Math.max(1, Math.floor((padded.width - totalGapW) / cols));
  const baseCellH = Math.max(1, Math.floor((padded.height - totalGapH) / rows));

  const rects: Rect[] = [];
  for (let index = 0; index < count; index += 1) {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x = padded.x + col * (baseCellW + gap);
    const y = padded.y + row * (baseCellH + gap);
    const isLastCol = col === cols - 1;
    const isLastRow = row === rows - 1;
    const width = isLastCol ? Math.max(1, padded.x + padded.width - x) : baseCellW;
    const height = isLastRow ? Math.max(1, padded.y + padded.height - y) : baseCellH;
    rects.push({ x, y, width, height });
  }
  return rects;
}

function splitQuadrants(area: { left: number; top: number; width: number; height: number }, options?: { padding?: number; gap?: number }) {
  const inner = shrinkRect({ x: area.left, y: area.top, width: area.width, height: area.height }, options?.padding ?? 8);
  const gap = Math.max(0, options?.gap ?? 8);
  const leftW = Math.max(1, Math.floor((inner.width - gap) / 2));
  const rightW = Math.max(1, inner.width - gap - leftW);
  const topH = Math.max(1, Math.floor((inner.height - gap) / 2));
  const bottomH = Math.max(1, inner.height - gap - topH);
  const x1 = inner.x;
  const x2 = inner.x + leftW + gap;
  const y1 = inner.y;
  const y2 = inner.y + topH + gap;

  return {
    'top-left': { x: x1, y: y1, width: leftW, height: topH } as Rect,
    'top-right': { x: x2, y: y1, width: rightW, height: topH } as Rect,
    'bottom-left': { x: x1, y: y2, width: leftW, height: bottomH } as Rect,
    'bottom-right': { x: x2, y: y2, width: rightW, height: bottomH } as Rect,
  };
}

function splitVertical(area: ScreenArea): { left: Rect; right: Rect } {
  const leftW = Math.max(1, Math.floor(area.width / 2));
  const rightW = Math.max(1, area.width - leftW);
  return {
    left: { x: area.left, y: area.top, width: leftW, height: area.height },
    right: { x: area.left + leftW, y: area.top, width: rightW, height: area.height },
  };
}

function splitHorizontal(area: ScreenArea): { top: Rect; bottom: Rect } {
  const topH = Math.max(1, Math.floor(area.height / 2));
  const bottomH = Math.max(1, area.height - topH);
  return {
    top: { x: area.left, y: area.top, width: area.width, height: topH },
    bottom: { x: area.left, y: area.top + topH, width: area.width, height: bottomH },
  };
}

function getWindowWidthHint(window?: ManagedWindow): number {
  return Math.max(1, Math.round(window?.bounds?.size?.width || 0));
}

function getWindowHeightHint(window?: ManagedWindow): number {
  return Math.max(1, Math.round(window?.bounds?.size?.height || 0));
}

function getGroupWidthHint(windows: ManagedWindow[]): number {
  if (windows.length === 0) return 1;
  return Math.max(...windows.map((win) => getWindowWidthHint(win)));
}

function getGroupHeightHint(windows: ManagedWindow[]): number {
  if (windows.length === 0) return 1;
  return Math.max(...windows.map((win) => getWindowHeightHint(win)));
}

function splitVerticalSmart(
  area: ScreenArea,
  leftWindows: ManagedWindow[],
  rightWindows: ManagedWindow[]
): { left: Rect; right: Rect } {
  const desiredLeft = getGroupWidthHint(leftWindows);
  const desiredRight = getGroupWidthHint(rightWindows);
  const maxLeft = Math.max(1, area.width - desiredRight);
  let leftW = Math.max(1, Math.min(Math.max(Math.floor(area.width / 2), desiredLeft), maxLeft));
  let rightW = Math.max(1, area.width - leftW);
  if (rightW < desiredRight) {
    rightW = desiredRight;
    leftW = Math.max(1, area.width - rightW);
  }

  return {
    left: { x: area.left, y: area.top, width: leftW, height: area.height },
    right: { x: area.left + leftW, y: area.top, width: Math.max(1, area.width - leftW), height: area.height },
  };
}

function splitHorizontalSmart(
  area: ScreenArea,
  topWindows: ManagedWindow[],
  bottomWindows: ManagedWindow[]
): { top: Rect; bottom: Rect } {
  const desiredTop = getGroupHeightHint(topWindows);
  const desiredBottom = getGroupHeightHint(bottomWindows);
  const maxTop = Math.max(1, area.height - desiredBottom);
  let topH = Math.max(1, Math.min(Math.max(Math.floor(area.height / 2), desiredTop), maxTop));
  let bottomH = Math.max(1, area.height - topH);
  if (bottomH < desiredBottom) {
    bottomH = desiredBottom;
    topH = Math.max(1, area.height - bottomH);
  }

  return {
    top: { x: area.left, y: area.top, width: area.width, height: topH },
    bottom: { x: area.left, y: area.top + topH, width: area.width, height: Math.max(1, area.height - topH) },
  };
}

function pushLeftIfOverflow(rect: Rect, area: ScreenArea, window?: ManagedWindow): Rect {
  const currentWidth = Math.max(0, Math.round(window?.bounds?.size?.width || 0));
  const effectiveWidth = Math.max(Math.round(rect.width), currentWidth);
  const maxX = area.left + area.width - effectiveWidth;
  let x = Math.round(rect.x);
  if (x > maxX) {
    x = maxX;
  }
  if (x < area.left) {
    x = area.left;
  }
  return { ...rect, x };
}

function fitRectWithinArea(rect: Rect, area: ScreenArea, window?: ManagedWindow): Rect {
  return pushLeftIfOverflow(pushUpIfOverflow(rect, area, window), area, window);
}

function pushUpIfOverflow(rect: Rect, area: ScreenArea, window?: ManagedWindow): Rect {
  const currentHeight = Math.max(0, Math.round(window?.bounds?.size?.height || 0));
  const effectiveHeight = Math.max(Math.round(rect.height), currentHeight);
  const maxY = area.top + area.height - effectiveHeight;
  let y = Math.round(rect.y);
  if (y > maxY) {
    y = maxY;
  }
  if (y < area.top) {
    y = area.top;
  }
  return { ...rect, y };
}

function getPresetRegion(presetId: PresetId, area: ScreenArea): Rect | null {
  const areaRight = area.left + area.width;
  const areaBottom = area.top + area.height;
  const oneThirdX = area.left + Math.floor(area.width / 3);
  const twoThirdX = area.left + Math.floor((area.width * 2) / 3);
  const oneFourthX = area.left + Math.floor(area.width / 4);
  const halfX = area.left + Math.floor(area.width / 2);
  const threeFourthX = area.left + Math.floor((area.width * 3) / 4);
  const oneEighthX = area.left + Math.floor(area.width / 8);
  const sevenEighthX = area.left + Math.floor((area.width * 7) / 8);
  const oneSixthX = area.left + Math.floor(area.width / 6);
  const fiveSixthX = area.left + Math.floor((area.width * 5) / 6);
  const halfY = area.top + Math.floor(area.height / 2);

  if (presetId === 'top-left' || presetId === 'top-right' || presetId === 'bottom-left' || presetId === 'bottom-right') {
    const quadrants = splitQuadrants(area, { padding: 0, gap: 0 });
    return quadrants[presetId];
  }
  if (presetId === 'top-left-sixth') {
    return {
      x: area.left,
      y: area.top,
      width: Math.max(1, oneThirdX - area.left),
      height: Math.max(1, halfY - area.top),
    };
  }
  if (presetId === 'top-center-sixth') {
    return {
      x: oneThirdX,
      y: area.top,
      width: Math.max(1, twoThirdX - oneThirdX),
      height: Math.max(1, halfY - area.top),
    };
  }
  if (presetId === 'top-right-sixth') {
    return {
      x: twoThirdX,
      y: area.top,
      width: Math.max(1, areaRight - twoThirdX),
      height: Math.max(1, halfY - area.top),
    };
  }
  if (presetId === 'bottom-left-sixth') {
    return {
      x: area.left,
      y: halfY,
      width: Math.max(1, oneThirdX - area.left),
      height: Math.max(1, areaBottom - halfY),
    };
  }
  if (presetId === 'bottom-center-sixth') {
    return {
      x: oneThirdX,
      y: halfY,
      width: Math.max(1, twoThirdX - oneThirdX),
      height: Math.max(1, areaBottom - halfY),
    };
  }
  if (presetId === 'bottom-right-sixth') {
    return {
      x: twoThirdX,
      y: halfY,
      width: Math.max(1, areaRight - twoThirdX),
      height: Math.max(1, areaBottom - halfY),
    };
  }
  if (presetId === 'left' || presetId === 'right') {
    const split = splitVertical(area);
    return presetId === 'left' ? split.left : split.right;
  }
  if (presetId === 'first-third') {
    return {
      x: area.left,
      y: area.top,
      width: Math.max(1, oneThirdX - area.left),
      height: area.height,
    };
  }
  if (presetId === 'center-third') {
    return {
      x: oneThirdX,
      y: area.top,
      width: Math.max(1, twoThirdX - oneThirdX),
      height: area.height,
    };
  }
  if (presetId === 'last-third') {
    return {
      x: twoThirdX,
      y: area.top,
      width: Math.max(1, areaRight - twoThirdX),
      height: area.height,
    };
  }
  if (presetId === 'first-two-thirds') {
    return {
      x: area.left,
      y: area.top,
      width: Math.max(1, twoThirdX - area.left),
      height: area.height,
    };
  }
  if (presetId === 'center-two-thirds') {
    return {
      x: oneSixthX,
      y: area.top,
      width: Math.max(1, fiveSixthX - oneSixthX),
      height: area.height,
    };
  }
  if (presetId === 'last-two-thirds') {
    return {
      x: oneThirdX,
      y: area.top,
      width: Math.max(1, areaRight - oneThirdX),
      height: area.height,
    };
  }
  if (presetId === 'first-fourth') {
    return {
      x: area.left,
      y: area.top,
      width: Math.max(1, oneFourthX - area.left),
      height: area.height,
    };
  }
  if (presetId === 'second-fourth') {
    return {
      x: oneFourthX,
      y: area.top,
      width: Math.max(1, halfX - oneFourthX),
      height: area.height,
    };
  }
  if (presetId === 'third-fourth') {
    return {
      x: halfX,
      y: area.top,
      width: Math.max(1, threeFourthX - halfX),
      height: area.height,
    };
  }
  if (presetId === 'last-fourth') {
    return {
      x: threeFourthX,
      y: area.top,
      width: Math.max(1, areaRight - threeFourthX),
      height: area.height,
    };
  }
  if (presetId === 'first-three-fourths') {
    return {
      x: area.left,
      y: area.top,
      width: Math.max(1, threeFourthX - area.left),
      height: area.height,
    };
  }
  if (presetId === 'center-three-fourths') {
    return {
      x: oneEighthX,
      y: area.top,
      width: Math.max(1, sevenEighthX - oneEighthX),
      height: area.height,
    };
  }
  if (presetId === 'last-three-fourths') {
    return {
      x: oneFourthX,
      y: area.top,
      width: Math.max(1, areaRight - oneFourthX),
      height: area.height,
    };
  }
  if (presetId === 'top' || presetId === 'bottom') {
    const split = splitHorizontal(area);
    return presetId === 'top' ? split.top : split.bottom;
  }
  if (presetId === 'fill') {
    return { x: area.left, y: area.top, width: area.width, height: area.height };
  }
  if (presetId === 'center') {
    const width = Math.max(1, Math.round(area.width * 0.6));
    const height = Math.max(1, Math.round(area.height * 0.6));
    const x = area.left + Math.round((area.width - width) / 2);
    const y = area.top + Math.round((area.height - height) / 2);
    return { x, y, width, height };
  }
  if (presetId === 'center-80') {
    const width = Math.max(1, Math.round(area.width * 0.8));
    const height = Math.max(1, Math.round(area.height * 0.8));
    const x = area.left + Math.round((area.width - width) / 2);
    const y = area.top + Math.round((area.height - height) / 2);
    return { x, y, width, height };
  }
  return null;
}

function sortWindowsForLayout(windows: ManagedWindow[]): ManagedWindow[] {
  return [...windows].sort((a, b) => {
    const ay = Number(a.bounds?.position?.y || 0);
    const by = Number(b.bounds?.position?.y || 0);
    if (ay !== by) return ay - by;
    const ax = Number(a.bounds?.position?.x || 0);
    const bx = Number(b.bounds?.position?.x || 0);
    if (ax !== bx) return ax - bx;
    return normalizeText(a.application?.name).localeCompare(normalizeText(b.application?.name));
  });
}

function buildAutoLayout(windows: ManagedWindow[], area: { left: number; top: number; width: number; height: number }): LayoutMove[] {
  if (windows.length === 2) {
    const split = splitVertical(area);
    return [
      { id: windows[0].id, bounds: rectToBounds(split.left) },
      { id: windows[1].id, bounds: rectToBounds(split.right) },
    ];
  }
  if (windows.length === 3) {
    return buildAutoFill3Layout(windows, area);
  }
  const rects = computeGridRects(
    windows.length,
    { x: area.left, y: area.top, width: area.width, height: area.height },
    { padding: 0, gap: 0 }
  );
  return windows.map((win, index) => ({
    id: win.id,
    bounds: rectToBounds(pushUpIfOverflow(rects[index], area, win)),
  }));
}

function buildAutoOrganizeLayout(windows: ManagedWindow[], area: ScreenArea): LayoutMove[] {
  const targets = windows.slice(0, 4);
  if (targets.length === 0) return [];
  if (targets.length === 1) {
    return [{ id: targets[0].id, bounds: rectToBounds({ x: area.left, y: area.top, width: area.width, height: area.height }) }];
  }
  if (targets.length === 2) {
    const split = splitVertical(area);
    return [
      { id: targets[0].id, bounds: rectToBounds(split.left) },
      { id: targets[1].id, bounds: rectToBounds(split.right) },
    ];
  }
  if (targets.length === 3) {
    const split = splitVertical(area);
    const rightArea: ScreenArea = {
      left: split.right.x,
      top: split.right.y,
      width: split.right.width,
      height: split.right.height,
    };
    const rightSplit = splitHorizontal(rightArea);
    return [
      { id: targets[0].id, bounds: rectToBounds(split.left) },
      { id: targets[1].id, bounds: rectToBounds(rightSplit.top) },
      { id: targets[2].id, bounds: rectToBounds(rightSplit.bottom) },
    ];
  }

  const quadrants = splitQuadrants(area, { padding: 0, gap: 0 });
  return [
    { id: targets[0].id, bounds: rectToBounds(quadrants['top-left']) },
    { id: targets[1].id, bounds: rectToBounds(quadrants['bottom-left']) },
    { id: targets[2].id, bounds: rectToBounds(quadrants['top-right']) },
    { id: targets[3].id, bounds: rectToBounds(quadrants['bottom-right']) },
  ];
}

function buildAutoFill3Layout(windows: ManagedWindow[], area: ScreenArea): LayoutMove[] {
  const targets = windows.slice(0, 3);
  if (targets.length === 0) return [];
  if (targets.length === 1) {
    return [{ id: targets[0].id, bounds: rectToBounds({ x: area.left, y: area.top, width: area.width, height: area.height }) }];
  }
  if (targets.length === 2) {
    const split = splitVertical(area);
    return [
      { id: targets[0].id, bounds: rectToBounds(split.left) },
      { id: targets[1].id, bounds: rectToBounds(split.right) },
    ];
  }

  const leftW = Math.max(1, Math.floor(area.width / 2));
  const rightW = Math.max(1, area.width - leftW);

  const minTop = Math.max(1, Math.round(targets[1]?.bounds?.size?.height || 0));
  const minBottom = Math.max(1, Math.round(targets[2]?.bounds?.size?.height || 0));
  const maxTop = Math.max(1, area.height - minBottom);
  const topH = Math.max(1, Math.min(Math.max(Math.floor(area.height / 2), minTop), maxTop));
  let bottomH = Math.max(1, area.height - topH);
  if (bottomH < minBottom) {
    bottomH = minBottom;
  }
  const adjustedTopH = Math.max(1, area.height - bottomH);

  return [
    {
      id: targets[0].id,
      bounds: rectToBounds({ x: area.left, y: area.top, width: leftW, height: area.height }),
    },
    {
      id: targets[1].id,
      bounds: rectToBounds({ x: area.left + leftW, y: area.top, width: rightW, height: adjustedTopH }),
    },
    {
      id: targets[2].id,
      bounds: rectToBounds(
        pushUpIfOverflow(
          { x: area.left + leftW, y: area.top + adjustedTopH, width: rightW, height: bottomH },
          area,
          targets[2]
        )
      ),
    },
  ];
}

function buildAutoFill4Layout(windows: ManagedWindow[], area: ScreenArea): LayoutMove[] {
  const targets = windows.slice(0, 4);
  if (targets.length === 0) return [];
  if (targets.length <= 2) {
    return buildAutoFill3Layout(targets, area);
  }
  if (targets.length === 3) {
    return buildAutoFill3Layout(targets, area);
  }

  const minLeftW = Math.max(
    1,
    Math.round(Math.max(targets[0]?.bounds?.size?.width || 0, targets[2]?.bounds?.size?.width || 0))
  );
  const minRightW = Math.max(
    1,
    Math.round(Math.max(targets[1]?.bounds?.size?.width || 0, targets[3]?.bounds?.size?.width || 0))
  );
  const maxLeft = Math.max(1, area.width - minRightW);
  const leftW = Math.max(1, Math.min(Math.max(Math.floor(area.width / 2), minLeftW), maxLeft));
  const rightW = Math.max(1, area.width - leftW);

  const minTopH = Math.max(
    1,
    Math.round(Math.max(targets[0]?.bounds?.size?.height || 0, targets[1]?.bounds?.size?.height || 0))
  );
  const minBottomH = Math.max(
    1,
    Math.round(Math.max(targets[2]?.bounds?.size?.height || 0, targets[3]?.bounds?.size?.height || 0))
  );
  const maxTop = Math.max(1, area.height - minBottomH);
  let topH = Math.max(1, Math.min(Math.max(Math.floor(area.height / 2), minTopH), maxTop));
  let bottomH = Math.max(1, area.height - topH);
  if (bottomH < minBottomH) {
    bottomH = minBottomH;
    topH = Math.max(1, area.height - bottomH);
  }

  return [
    {
      id: targets[0].id,
      bounds: rectToBounds({ x: area.left, y: area.top, width: leftW, height: topH }),
    },
    {
      id: targets[1].id,
      bounds: rectToBounds({ x: area.left + leftW, y: area.top, width: rightW, height: topH }),
    },
    {
      id: targets[2].id,
      bounds: rectToBounds(
        pushUpIfOverflow(
          { x: area.left, y: area.top + topH, width: leftW, height: bottomH },
          area,
          targets[2]
        )
      ),
    },
    {
      id: targets[3].id,
      bounds: rectToBounds(
        pushUpIfOverflow(
          { x: area.left + leftW, y: area.top + topH, width: rightW, height: bottomH },
          area,
          targets[3]
        )
      ),
    },
  ];
}

function findBestTargetWindowForArea(windows: ManagedWindow[], area: ScreenArea): ManagedWindow | null {
  const candidates = windows
    .filter(isManageableWindow)
    .filter((win) => isWindowOnScreenArea(win, area));
  if (candidates.length === 0) return null;
  const areaCenter = {
    x: area.left + area.width / 2,
    y: area.top + area.height / 2,
  };
  return [...candidates].sort((a, b) => {
    const ac = getWindowCenter(a);
    const bc = getWindowCenter(b);
    const ad = Math.hypot(ac.x - areaCenter.x, ac.y - areaCenter.y);
    const bd = Math.hypot(bc.x - areaCenter.x, bc.y - areaCenter.y);
    return ad - bd;
  })[0] || null;
}

async function resolveWindowManagementExecutionContext(): Promise<{ target: ManagedWindow | null; area: ScreenArea }> {
  const hostArea = getHostMetrics(window);
  let target: ManagedWindow | null = null;
  let workAreaRaw: any = null;
  try {
    const ctx = await window.electron.getWindowManagementContext?.();
    if (ctx) {
      target = ctx.target as ManagedWindow | null;
      workAreaRaw = ctx.workArea;
    }
  } catch {}
  if (!target) {
    try {
      target = (await window.electron.getWindowManagementTargetWindow?.()) as ManagedWindow | null;
    } catch {}
  }
  if (!target) {
    try {
      target = (await window.electron.getActiveWindow?.()) as ManagedWindow | null;
    } catch {}
  }
  const area = normalizeScreenArea(workAreaRaw, hostArea);

  if (target && !isManageableWindow(target)) {
    target = null;
  }

  if (!target) {
    try {
      const windows = ((await window.electron.getWindowsOnActiveDesktop?.()) || []) as ManagedWindow[];
      target = findBestTargetWindowForArea(windows, area);
    } catch {}
  }

  return { target, area };
}

async function loadManageableWindowsOnArea(area: ScreenArea): Promise<ManagedWindow[]> {
  let all: ManagedWindow[] = [];
  try {
    all = ((await window.electron.getWindowsOnActiveDesktop()) || []) as ManagedWindow[];
  } catch {
    all = [];
  }
  return all
    .filter(isManageableWindow)
    .filter((win) => isWindowOnScreenArea(win, area));
}

export async function executeWindowManagementPreset(presetId: PresetId): Promise<{ success: boolean; error?: string }> {
  const run = async (): Promise<{ success: boolean; error?: string }> => {
    const elapsed = Date.now() - lastWindowPresetExecutionAt;
    if (elapsed < WINDOW_PRESET_EXECUTION_MIN_INTERVAL_MS) {
      await new Promise((resolve) => setTimeout(resolve, WINDOW_PRESET_EXECUTION_MIN_INTERVAL_MS - elapsed));
    }
    try {
      const isMultiWindow = MULTI_WINDOW_PRESETS.has(presetId);
      const requiresShiftEnter = isShiftEnterOnlyPreset(presetId);
      const context = await resolveWindowManagementExecutionContext();
      const layoutArea = context.area;
      const windows = isMultiWindow ? await loadManageableWindowsOnArea(layoutArea) : [];
      const target = context.target ?? null;
      const layoutWindows = isMultiWindow ? windows : (target ? [target] : []);

      if (requiresShiftEnter && !target) {
        return { success: false, error: 'No target window found.' };
      }
      if (!requiresShiftEnter && layoutWindows.length === 0) {
        return {
          success: false,
          error: isMultiWindow ? 'No movable windows found on this screen.' : 'No target window found.',
        };
      }

      const orderedAll = sortWindowsForLayout(layoutWindows);
      const layoutTargets = presetId === 'auto-organize' ? orderedAll.slice(0, 4) : orderedAll;
      let moves: LayoutMove[] = [];

      if (requiresShiftEnter && target) {
        const adjusted = applyFineTunePreset(presetId, target, layoutArea);
        if (adjusted) {
          moves = [{ id: target.id, bounds: rectToBounds(adjusted) }];
        }
      } else if (isMultiWindow) {
        if (presetId === 'auto-organize') {
          moves = buildAutoOrganizeLayout(layoutTargets, layoutArea);
        } else {
          moves = buildAutoLayout(layoutTargets, layoutArea);
        }
      } else {
        const region = getPresetRegion(presetId, layoutArea);
        if (region && target) {
          const adjusted = (presetId === 'bottom-left' || presetId === 'bottom-right')
            ? pushUpIfOverflow(region, layoutArea, target)
            : region;
          moves = [{ id: target.id, bounds: rectToBounds(adjusted) }];
        }
      }

      if (moves.length === 0) {
        return { success: false, error: 'No windows to move.' };
      }

      const applied = await window.electron.setWindowLayout(moves);
      if (applied === false) {
        return { success: false, error: 'Window action failed. Try again.' };
      }
      return { success: true };
    } catch (error) {
      console.error('Failed to execute window management preset:', error);
      return { success: false, error: 'Failed to move windows. Check Accessibility permission.' };
    } finally {
      lastWindowPresetExecutionAt = Date.now();
    }
  };

  const queued = windowPresetExecutionQueue.then(run, run);
  windowPresetExecutionQueue = queued.then(() => undefined, () => undefined);
  return queued;
}

export async function executeWindowManagementPresetCommandById(commandId: string): Promise<{ success: boolean; error?: string }> {
  const presetId = WINDOW_MANAGEMENT_PRESET_BY_COMMAND_ID.get(String(commandId || '').trim());
  if (!presetId) {
    return { success: false, error: 'Unknown window management command.' };
  }
  return executeWindowManagementPreset(presetId);
}

const WindowManagerPanel: React.FC<WindowManagerPanelProps> = ({ show, portalTarget, onClose }) => {
  const [windowsOnScreen, setWindowsOnScreen] = useState<ManagedWindow[]>([]);
  const [statusText, setStatusText] = useState('Select a preset to arrange windows.');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [appliedPreset, setAppliedPreset] = useState<PresetId | null>(null);
  const [isDarkTheme, setIsDarkTheme] = useState<boolean>(() => resolveIsDarkTheme());
  const [commandHotkeyLabels, setCommandHotkeyLabels] = useState<Record<string, string>>({});

  const windowsOnScreenRef = useRef<ManagedWindow[]>([]);
  const previewSeqRef = useRef(0);
  const lastPreviewKeyRef = useRef('');
  const previewLoopRunningRef = useRef(false);
  const pendingPreviewRef = useRef<{ presetId: PresetId; force?: boolean } | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const liquidHighlightRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef<Array<HTMLDivElement | null>>([]);
  const inventoryInFlightRef = useRef<Promise<ManagedWindow[]> | null>(null);
  const lastInventoryAtRef = useRef(0);
  const targetWindowRef = useRef<ManagedWindow | null>(null);
  const layoutAreaRef = useRef<ScreenArea | null>(null);
  const suppressBlurCloseUntilRef = useRef(0);
  const contextInFlightRef = useRef<Promise<{ target: ManagedWindow | null; area: ScreenArea } | null> | null>(null);
  const lastContextAtRef = useRef(0);
  const focusSearchInput = useCallback((): boolean => {
    const input = searchInputRef.current;
    if (!input) return false;
    try {
      input.ownerDocument?.defaultView?.focus();
    } catch {}
    try {
      input.focus();
    } catch {}
    if (input.ownerDocument?.activeElement !== input) return false;
    const end = input.value.length;
    try {
      input.setSelectionRange(end, end);
    } catch {}
    return true;
  }, []);

  const refocusPanelWindow = useCallback(() => {
    if (!show || !portalTarget) return;
    const host = portalTarget.ownerDocument?.defaultView;
    if (!host) return;
    const tryFocus = () => {
      try {
        host.focus();
      } catch {}
      focusSearchInput();
    };
    tryFocus();
    window.setTimeout(tryFocus, 60);
    window.setTimeout(tryFocus, 140);
  }, [focusSearchInput, portalTarget, show]);

  useEffect(() => {
    windowsOnScreenRef.current = windowsOnScreen;
  }, [windowsOnScreen]);

  useEffect(() => {
    setIsDarkTheme(resolveIsDarkTheme());
    const disposeThemeListener = onThemeChange(({ theme }) => {
      setIsDarkTheme(theme === 'dark');
    });
    const onFocus = () => setIsDarkTheme(resolveIsDarkTheme());
    window.addEventListener('focus', onFocus);
    return () => {
      disposeThemeListener();
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  useEffect(() => {
    if (!show) return;
    let cancelled = false;
    void (async () => {
      try {
        const settings = (await window.electron.getSettings?.()) as AppSettings;
        const next: Record<string, string> = {};
        const hotkeys = settings?.commandHotkeys || {};
        for (const [commandId, rawShortcut] of Object.entries(hotkeys)) {
          const id = String(commandId || '').trim();
          const shortcut = String(rawShortcut || '').trim();
          if (!id || !shortcut) continue;
          next[id] = formatShortcutLabel(shortcut);
        }
        if (!cancelled) setCommandHotkeyLabels(next);
      } catch {
        if (!cancelled) setCommandHotkeyLabels({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [show]);

  const hostWindow = portalTarget?.ownerDocument?.defaultView || null;
  const hostArea = useMemo(() => getHostMetrics(hostWindow), [hostWindow]);
  const filteredPresets = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return PRESETS;
    return PRESETS.filter((preset) => {
      const haystack = `${preset.label} ${preset.subtitle} ${preset.id.replace(/-/g, ' ')}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [searchQuery]);

  const loadContext = useCallback(async (force?: boolean) => {
    const now = Date.now();
    if (!force && layoutAreaRef.current && now - lastContextAtRef.current < 800) {
      return {
        target: targetWindowRef.current,
        area: layoutAreaRef.current,
      };
    }
    if (contextInFlightRef.current) return contextInFlightRef.current;

    const promise = (async () => {
      let target: ManagedWindow | null = null;
      let workAreaRaw: any = null;
      try {
        const ctx = await window.electron.getWindowManagementContext?.();
        if (ctx) {
          target = ctx.target as ManagedWindow | null;
          workAreaRaw = ctx.workArea;
        }
      } catch {}
      if (!target) {
        try {
          target = (await window.electron.getWindowManagementTargetWindow?.()) as ManagedWindow | null;
        } catch {}
      }
      if (!target) {
        try {
          target = (await window.electron.getActiveWindow?.()) as ManagedWindow | null;
        } catch {}
      }
      const area = normalizeScreenArea(workAreaRaw, hostArea);

      if (target && !isManageableWindow(target)) {
        target = null;
      }

      if (!target) {
        try {
          const windows = ((await window.electron.getWindowsOnActiveDesktop?.()) || []) as ManagedWindow[];
          const candidates = windows
            .filter(isManageableWindow)
            .filter((win) => isWindowOnScreenArea(win, area));
          if (candidates.length > 0) {
            const areaCenter = {
              x: area.left + area.width / 2,
              y: area.top + area.height / 2,
            };
            target = [...candidates].sort((a, b) => {
              const ac = getWindowCenter(a);
              const bc = getWindowCenter(b);
              const ad = Math.hypot(ac.x - areaCenter.x, ac.y - areaCenter.y);
              const bd = Math.hypot(bc.x - areaCenter.x, bc.y - areaCenter.y);
              return ad - bd;
            })[0] || null;
          }
        } catch {}
      }

      layoutAreaRef.current = area;
      lastContextAtRef.current = Date.now();
      targetWindowRef.current = target;
      setWindowsOnScreen(target ? [target] : []);
      return { target, area };
    })();

    contextInFlightRef.current = promise;
    const result = await promise;
    contextInFlightRef.current = null;
    return result;
  }, [hostArea]);

  const loadWindowsForLayout = useCallback(async (force?: boolean) => {
    const now = Date.now();
    if (!force && windowsOnScreenRef.current.length > 0 && now - lastInventoryAtRef.current < 800) {
      return windowsOnScreenRef.current;
    }
    if (inventoryInFlightRef.current) return inventoryInFlightRef.current;

    const promise = (async () => {
      const context = await loadContext(force);
      const area = context?.area ?? hostArea;
      let all: ManagedWindow[] = [];
      try {
        all = ((await window.electron.getWindowsOnActiveDesktop()) || []) as ManagedWindow[];
      } catch {
        all = [];
      }
      const screenWindows = all
        .filter(isManageableWindow)
        .filter((win) => isWindowOnScreenArea(win, area));
      windowsOnScreenRef.current = screenWindows;
      setWindowsOnScreen(screenWindows);
      lastInventoryAtRef.current = Date.now();
      return screenWindows;
    })();

    inventoryInFlightRef.current = promise;
    const result = await promise;
    inventoryInFlightRef.current = null;
    return result;
  }, [hostArea, loadContext]);

  useEffect(() => {
    if (!show || !portalTarget) return;
    setAppliedPreset(null);
    setSearchQuery('');
    setSelectedIndex(-1);
    lastPreviewKeyRef.current = '';
    pendingPreviewRef.current = null;
    previewSeqRef.current += 1;
    setWindowsOnScreen([]);
    targetWindowRef.current = null;
    layoutAreaRef.current = null;
    lastContextAtRef.current = 0;
    setStatusText('Select a preset to arrange windows.');
    // Detached popup focus can race on open, so retry a few times.
    const rafId = requestAnimationFrame(() => { focusSearchInput(); });
    const timers = [0, 40, 100, 180].map((delay) =>
      window.setTimeout(() => { focusSearchInput(); }, delay)
    );
    return () => {
      window.cancelAnimationFrame(rafId);
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [show, portalTarget, loadWindowsForLayout, focusSearchInput]);

  useEffect(() => {
    optionRefs.current = optionRefs.current.slice(0, filteredPresets.length);
    setSelectedIndex((prev) => {
      if (filteredPresets.length === 0) return -1;
      if (prev < 0) return -1;
      return Math.min(prev, filteredPresets.length - 1);
    });
  }, [filteredPresets.length]);

  const applyPresetNow = useCallback(async (presetId: PresetId, options?: { force?: boolean }) => {
    const isMultiWindow = MULTI_WINDOW_PRESETS.has(presetId);
    const requiresShiftEnter = isShiftEnterOnlyPreset(presetId);

    if (options?.force) {
      const commandId = WINDOW_MANAGEMENT_COMMAND_ID_BY_PRESET.get(presetId);
      if (!commandId) {
        setStatusText('Unknown window management command.');
        return;
      }
      try {
        suppressBlurCloseUntilRef.current = Date.now() + (presetId === 'auto-organize' ? 1400 : 800);
        const applied = await window.electron.executeCommandFromWidget(commandId);
        if (applied === false) {
          setStatusText('Window action failed. Try again.');
          return;
        }
        setAppliedPreset(presetId);
        const label = PRESETS.find((entry) => entry.id === presetId)?.label || 'preset';
        setStatusText(`Applied ${label}.`);
        if (presetId === 'auto-organize') {
          refocusPanelWindow();
        }
        if (isMultiWindow) {
          void loadWindowsForLayout(true);
        } else {
          void loadContext(true);
        }
      } catch (error) {
        console.error('Window preset command failed:', error);
        setStatusText('Failed to move windows. Check Accessibility permission.');
      }
      return;
    }

    const context = await loadContext(options?.force);
    const layoutArea = context?.area ?? hostArea;
    const windows = isMultiWindow ? await loadWindowsForLayout(options?.force) : [];
    const target = context?.target ?? null;
    const layoutWindows = isMultiWindow ? windows : (target ? [target] : []);
    if (requiresShiftEnter && !target) {
      setStatusText('No target window found.');
      return;
    }
    if (!requiresShiftEnter && (!layoutWindows || layoutWindows.length === 0)) {
      setStatusText(isMultiWindow ? 'No movable windows found on this screen.' : 'No target window found.');
      return;
    }

    const orderedAll = sortWindowsForLayout(layoutWindows);
    const layoutTargets = presetId === 'auto-organize' ? orderedAll.slice(0, 4) : orderedAll;
    const previewIds = layoutTargets.map((w) => w.id);
    const previewKey = `${presetId}:${previewIds.join(',')}`;
    if (!options?.force && lastPreviewKeyRef.current === previewKey) return;
    lastPreviewKeyRef.current = previewKey;

    let moves: LayoutMove[] = [];
    let movedCount = layoutTargets.length;
    if (requiresShiftEnter && target) {
      const adjusted = applyFineTunePreset(presetId, target, layoutArea);
      if (adjusted) {
        moves = [{ id: target.id, bounds: rectToBounds(adjusted) }];
        movedCount = 1;
      }
    } else if (isMultiWindow) {
      if (presetId === 'auto-organize') {
        moves = buildAutoOrganizeLayout(layoutTargets, layoutArea);
        movedCount = Math.min(layoutTargets.length, 4);
      } else {
        moves = buildAutoLayout(layoutTargets, layoutArea);
      }
    } else {
      const region = getPresetRegion(presetId, layoutArea);
      if (region && target) {
        const adjusted = (presetId === 'bottom-left' || presetId === 'bottom-right')
          ? pushUpIfOverflow(region, layoutArea, target)
          : region;
        moves = [{ id: target.id, bounds: rectToBounds(adjusted) }];
        movedCount = 1;
      }
    }

    if (moves.length === 0) {
      setStatusText('No windows to move.');
      return;
    }

    const seq = ++previewSeqRef.current;
    try {
      const applied = await window.electron.setWindowLayout(moves);
      if (applied === false) {
        if (seq === previewSeqRef.current) {
          setStatusText('Window action failed. Try again.');
        }
        return;
      }
      if (seq !== previewSeqRef.current) return;
      setAppliedPreset(presetId);
      if (isMultiWindow) {
        if (presetId === 'auto-organize') {
          setStatusText(`Previewing Auto organise for ${movedCount} of ${orderedAll.length} windows.`);
        } else {
          const cols = computeGridDimensions(orderedAll.length, {
            x: layoutArea.left,
            y: layoutArea.top,
            width: layoutArea.width,
            height: layoutArea.height,
          }).cols;
          setStatusText(`Previewing grid (${cols} col${cols > 1 ? 's' : ''}) for ${orderedAll.length} windows.`);
        }
      } else {
        setStatusText(`Previewing ${PRESETS.find((p) => p.id === presetId)?.label} layout for ${layoutTargets.length} windows.`);
      }
    } catch (error) {
      console.error('Window preset failed:', error);
      if (seq === previewSeqRef.current) {
        setStatusText('Failed to move windows. Check Accessibility permission.');
      }
    }
  }, [hostArea, loadContext, loadWindowsForLayout, refocusPanelWindow]);

  const drainPreviewQueue = useCallback(async () => {
    if (previewLoopRunningRef.current) return;
    previewLoopRunningRef.current = true;
    try {
      while (pendingPreviewRef.current) {
        const next = pendingPreviewRef.current;
        pendingPreviewRef.current = null;
        await applyPresetNow(next.presetId, { force: next.force });
      }
    } finally {
      previewLoopRunningRef.current = false;
    }
  }, [applyPresetNow]);

  const queuePreview = useCallback((presetId: PresetId, options?: { force?: boolean }) => {
    pendingPreviewRef.current = { presetId, force: options?.force };
    void drainPreviewQueue();
  }, [drainPreviewQueue]);

  useEffect(() => {
    if (!show) return;
    if (selectedIndex >= 0) {
      optionRefs.current[selectedIndex]?.scrollIntoView({ block: 'nearest' });
    }
  }, [show, selectedIndex]);

  useEffect(() => {
    if (!show || !portalTarget) return;
    const doc = portalTarget.ownerDocument;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (searchQuery.trim()) {
          event.preventDefault();
          setSearchQuery('');
          setSelectedIndex(-1);
          return;
        }
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === 'ArrowDown') {
        if (filteredPresets.length === 0) return;
        event.preventDefault();
        const nextIndex = selectedIndex < 0 ? 0 : (selectedIndex + 1) % filteredPresets.length;
        setSelectedIndex(nextIndex);
        const preset = filteredPresets[nextIndex];
        if (preset && !isShiftEnterOnlyPreset(preset.id)) {
          queuePreview(preset.id, { force: true });
        }
        return;
      }
      if (event.key === 'ArrowUp') {
        if (filteredPresets.length === 0) return;
        event.preventDefault();
        const nextIndex = selectedIndex < 0 ? filteredPresets.length - 1 : (selectedIndex - 1 + filteredPresets.length) % filteredPresets.length;
        setSelectedIndex(nextIndex);
        const preset = filteredPresets[nextIndex];
        if (preset && !isShiftEnterOnlyPreset(preset.id)) {
          queuePreview(preset.id, { force: true });
        }
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        if (selectedIndex < 0) return;
        const preset = filteredPresets[selectedIndex];
        if (!preset) return;
        void (async () => {
          await applyPresetNow(preset.id, { force: true });
        })();
      }
    };
    doc.addEventListener('keydown', onKeyDown, true);
    return () => doc.removeEventListener('keydown', onKeyDown, true);
  }, [show, portalTarget, onClose, selectedIndex, applyPresetNow, queuePreview, filteredPresets, searchQuery]);

  useEffect(() => {
    if (!show || !hostWindow) return;
    const onBlur = () => {
      if (Date.now() < suppressBlurCloseUntilRef.current) return;
      onClose();
    };
    hostWindow.addEventListener('blur', onBlur);
    return () => hostWindow.removeEventListener('blur', onBlur);
  }, [show, hostWindow, onClose]);

  const handleGlassMouseMove = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const highlight = liquidHighlightRef.current;
    if (!highlight) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    highlight.style.opacity = '0.58';
    highlight.style.transform = `translate3d(${Math.round(x - 130)}px, ${Math.round(y - 130)}px, 0)`;
  }, []);

  const handleGlassMouseLeave = useCallback(() => {
    const highlight = liquidHighlightRef.current;
    if (!highlight) return;
    highlight.style.opacity = '0';
  }, []);

  if (!show || !portalTarget) return null;

  const colors = isDarkTheme
    ? {
        rootText: 'rgba(255,255,255,0.96)',
        panelBg: 'rgba(34,34,38,0.34)',
        panelBorder: '1px solid rgba(255,255,255,0.20)',
        panelShell: [
          '0 22px 44px -14px rgba(0,0,0,0.34)',
          'inset 0 3px 20px rgba(255,255,255,0.17)',
          'inset 0 -3px 18px rgba(0,0,0,0.20)',
        ].join(', '),
        innerGlow: 'rgba(255,255,255,0.01)',
        innerGlowLineA: 'inset 0 1px 0 rgba(255,255,255,0.12)',
        innerGlowLineB: 'inset 0 0 0 1px rgba(255,255,255,0.03)',
        title: 'rgba(255,255,255,0.92)',
        secondary: 'rgba(255,255,255,0.66)',
        controlText: 'rgba(255,255,255,0.90)',
        controlBg: 'rgba(255,255,255,0.06)',
        controlBorder: '1px solid rgba(255,255,255,0.16)',
        controlShadow: 'inset 0 1px 0 rgba(255,255,255,0.10)',
        iconSelected: 'rgba(255,255,255,0.96)',
        iconDefault: 'rgba(255,255,255,0.72)',
        rowText: 'rgba(255,255,255,0.95)',
        liveOn: 'rgba(255,255,255,0.86)',
        liveOff: 'rgba(255,255,255,0.56)',
        rowSelectedBg: 'rgba(255,255,255,0.16)',
        rowSelectedEdge: '2px solid rgba(255,255,255,0.82)',
        rowDivider: '1px solid rgba(255,255,255,0.055)',
        headerDivider: '1px solid rgba(255,255,255,0.12)',
        headerBg: 'rgba(255,255,255,0.03)',
        footerText: 'rgba(255,255,255,0.86)',
        footerMuted: 'rgba(255,255,255,0.66)',
        footerBg: 'rgba(255,255,255,0.025)',
      }
    : {
        rootText: 'rgba(8,12,18,0.96)',
        panelBg: 'rgba(245,247,251,0.55)',
        panelBorder: '1px solid rgba(8,12,18,0.18)',
        panelShell: [
          '0 22px 44px -14px rgba(0,0,0,0.20)',
          'inset 0 2px 14px rgba(255,255,255,0.45)',
          'inset 0 -2px 12px rgba(0,0,0,0.08)',
        ].join(', '),
        innerGlow: 'rgba(255,255,255,0.20)',
        innerGlowLineA: 'inset 0 1px 0 rgba(255,255,255,0.55)',
        innerGlowLineB: 'inset 0 0 0 1px rgba(8,12,18,0.06)',
        title: 'rgba(10,14,22,0.95)',
        secondary: 'rgba(16,22,32,0.78)',
        controlText: 'rgba(12,16,24,0.92)',
        controlBg: 'rgba(255,255,255,0.30)',
        controlBorder: '1px solid rgba(10,14,22,0.20)',
        controlShadow: 'inset 0 1px 0 rgba(255,255,255,0.60)',
        iconSelected: 'rgba(9,14,22,0.96)',
        iconDefault: 'rgba(22,30,42,0.72)',
        rowText: 'rgba(10,14,22,0.95)',
        liveOn: 'rgba(16,22,32,0.86)',
        liveOff: 'rgba(28,36,48,0.56)',
        rowSelectedBg: 'rgba(255,255,255,0.48)',
        rowSelectedEdge: '2px solid rgba(22,30,42,0.45)',
        rowDivider: '1px solid rgba(14,20,30,0.08)',
        headerDivider: '1px solid rgba(14,20,30,0.12)',
        headerBg: 'rgba(255,255,255,0.12)',
        footerText: 'rgba(16,22,32,0.86)',
        footerMuted: 'rgba(28,36,48,0.66)',
        footerBg: 'rgba(255,255,255,0.08)',
      };

  return createPortal(
    <div
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            onClose();
          }
        }}
        style={{
          width: '100%',
          height: '100%',
          padding: 0,
          boxSizing: 'border-box',
          fontFamily: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, sans-serif',
          color: colors.rootText,
          background: 'transparent',
        }}
      >
        <div
          onMouseDown={(event) => event.stopPropagation()}
          onMouseMove={handleGlassMouseMove}
          onMouseLeave={handleGlassMouseLeave}
          style={{
            width: '100%',
            height: '100%',
            borderRadius: 20,
            border: colors.panelBorder,
            background: colors.panelBg,
            boxShadow: colors.panelShell,
            backdropFilter: 'blur(34px) saturate(185%)',
            WebkitBackdropFilter: 'blur(34px) saturate(185%)',
            position: 'relative',
            overflow: 'hidden',
            isolation: 'isolate',
          }}
        >
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 1,
              borderRadius: 19,
              background: colors.innerGlow,
              boxShadow: [
                colors.innerGlowLineA,
                colors.innerGlowLineB,
              ].join(', '),
              pointerEvents: 'none',
              zIndex: 1,
            }}
          />
          <div
            ref={liquidHighlightRef}
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: 260,
              height: 260,
              borderRadius: '50%',
              background:
                'radial-gradient(circle, rgba(255,255,255,0.34) 8%, rgba(255,255,255,0.16) 30%, transparent 70%)',
              filter: 'blur(34px)',
              opacity: 0,
              transform: 'translate3d(-400px, -400px, 0)',
              transition: 'opacity 140ms ease-out',
              mixBlendMode: 'screen',
              pointerEvents: 'none',
              zIndex: 1,
            }}
          />

          <div
            style={{
              position: 'relative',
              zIndex: 2,
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'stretch',
                gap: 8,
                padding: '8px 12px',
                borderBottom: colors.headerDivider,
                background: colors.headerBg,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: 0.3,
                      textTransform: 'uppercase',
                      color: colors.title,
                    }}
                  >
                    Window Management
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={onClose}
                    aria-label="Close"
                    title="Close"
                    style={{
                      width: 22,
                      height: 22,
                      display: 'grid',
                      placeItems: 'center',
                      fontSize: 14,
                      lineHeight: 1,
                      borderRadius: 10,
                      color: colors.controlText,
                      background: colors.controlBg,
                      border: colors.controlBorder,
                      boxShadow: colors.controlShadow,
                      cursor: 'pointer',
                      userSelect: 'none',
                    }}
                  >
                    ×
                  </div>
                </div>
              </div>
              <div>
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  placeholder="Search presets..."
                  onChange={(event) => {
                    setSearchQuery(event.target.value);
                    setSelectedIndex(-1);
                  }}
                  style={{
                    width: '100%',
                    height: 22,
                    border: 'none',
                    background: 'transparent',
                    boxShadow: 'none',
                    color: colors.rowText,
                    outline: 'none',
                    fontSize: 12,
                    fontWeight: 500,
                    padding: 0,
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>

            <div
              ref={listRef}
              role="listbox"
              tabIndex={0}
              aria-label="Window management presets"
              style={{
                flex: 1,
                overflowY: 'auto',
                outline: 'none',
                padding: '4px 0',
              }}
            >
              {filteredPresets.length === 0 ? (
                <div
                  style={{
                    padding: '12px',
                    fontSize: 11,
                    color: colors.footerMuted,
                  }}
                >
                  No presets found.
                </div>
              ) : filteredPresets.map((preset, index) => {
                const isSelected = index === selectedIndex;
                const iconColor = isSelected ? colors.iconSelected : colors.iconDefault;
                const commandId = WINDOW_MANAGEMENT_COMMAND_ID_BY_PRESET.get(preset.id) || '';
                const configuredHotkey = commandId ? String(commandHotkeyLabels[commandId] || '') : '';
                const showShiftBadge = false;
                const showHotkeyBadge = Boolean(configuredHotkey);
                const showShortcutBadgeGroup = showShiftBadge || showHotkeyBadge;
                return (
                  <div
                    key={preset.id}
                    ref={(node) => { optionRefs.current[index] = node; }}
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => {
                      setSelectedIndex(index);
                    }}
                    onMouseMove={() => {
                      if (selectedIndex !== index) {
                        setSelectedIndex(index);
                      }
                    }}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setSelectedIndex(index);
                      void (async () => {
                        await applyPresetNow(preset.id, { force: true });
                      })();
                    }}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '28px 1fr auto',
                      alignItems: 'center',
                      gap: 8,
                      padding: '9px 12px',
                      minHeight: 38,
                      borderRadius: 0,
                      background: isSelected ? colors.rowSelectedBg : 'transparent',
                      borderLeft: isSelected ? colors.rowSelectedEdge : '2px solid transparent',
                      borderBottom: colors.rowDivider,
                      cursor: 'default',
                      userSelect: 'none',
                    }}
                    title={preset.label}
                  >
                    <div style={{ width: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', color: iconColor }}>
                      {renderPresetIcon(preset.id)}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: colors.rowText }}>{preset.label}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                      {showShortcutBadgeGroup ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                          {showShiftBadge ? (
                            <span
                              title={showHotkeyBadge ? 'Run with Shift+Enter or assigned shortcut' : 'Run with Shift+Enter'}
                              style={{
                                fontSize: 9.5,
                                color: colors.liveOff,
                                letterSpacing: 0.2,
                                padding: '2px 6px',
                                borderRadius: 999,
                                border: colors.controlBorder,
                                background: colors.controlBg,
                                boxShadow: colors.controlShadow,
                              }}
                            >
                              ⇧ + ↩
                            </span>
                          ) : null}
                          {showShiftBadge && showHotkeyBadge ? (
                            <span
                              style={{
                                fontSize: 8.5,
                                color: colors.footerMuted,
                                letterSpacing: 0.25,
                                textTransform: 'uppercase',
                              }}
                            >
                              OR
                            </span>
                          ) : null}
                          {showHotkeyBadge ? (
                            <span
                              title="Assigned shortcut"
                              style={{
                                fontSize: 9.5,
                                color: colors.liveOff,
                                letterSpacing: 0.2,
                                padding: '2px 6px',
                                borderRadius: 999,
                                border: colors.controlBorder,
                                background: colors.controlBg,
                                boxShadow: colors.controlShadow,
                              }}
                            >
                              {configuredHotkey}
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>

            <div
              style={{
                minHeight: 42,
                padding: '8px 12px 10px',
                borderTop: colors.headerDivider,
                background: colors.footerBg,
                color: colors.footerText,
                fontSize: 10.5,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
              }}
              >
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{windowsOnScreen.length} windows</span>
                <span style={{ color: colors.footerMuted, flexShrink: 0 }}>Scroll · ↑↓ · Enter</span>
              </div>
          </div>
        </div>
      </div>,
    portalTarget
  );
};

export default WindowManagerPanel;
