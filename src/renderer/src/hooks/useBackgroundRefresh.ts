/**
 * useBackgroundRefresh.ts
 *
 * Registers interval timers for commands that declare an `interval` field (e.g. "1m", "12h").
 * - Extension commands (category: "extension", mode: "no-view" | "menu-bar"): runs the
 *   extension bundle in the background and dispatches sc-launch-extension-bundle
 * - Inline script commands (category: "script", mode: "inline"): runs the script and
 *   calls fetchCommands() to refresh the subtitle shown in the launcher
 *
 * Timers are keyed by stable command identity, path, mode, and interval so
 * unchanged background commands keep their existing intervals across command
 * list refreshes. Removed commands are cleared, and changed commands restart.
 */

import { useCallback, useRef, useEffect } from 'react';
import type { CommandInfo } from '../../types/electron';
import { parseIntervalToMs } from '../utils/command-helpers';
import {
  clearBackgroundRefreshTimers,
  createInFlightBackgroundRefreshTick,
  getBackgroundRefreshTimerDescriptors,
  reconcileBackgroundRefreshTimers,
  type BackgroundRefreshTimerEntry,
  type BackgroundRefreshTimerDescriptor,
} from './backgroundRefreshTimers';
import {
  readJsonObject,
  getScriptCmdArgsKey,
  hydrateExtensionBundlePreferences,
  getMissingRequiredPreferences,
  getMissingRequiredArguments,
  getMissingRequiredScriptArguments,
} from '../utils/extension-preferences';

export interface UseBackgroundRefreshOptions {
  commands: CommandInfo[];
  fetchCommands: () => Promise<void>;
  /**
   * Returns true when a menu-bar command is currently mounted (visible in the
   * tray). Per Raycast's interval contract, an interval-driven re-run only
   * fires while the menu-bar item is shown — so toggling a menu-bar command
   * off must stop its background re-runs, otherwise the next tick re-mounts it.
   */
  isMenuBarCommandActive?: (extName: string, cmdName: string) => boolean;
}

export function useBackgroundRefresh({ commands, fetchCommands, isMenuBarCommandActive }: UseBackgroundRefreshOptions): void {
  const intervalTimersRef = useRef<Map<string, BackgroundRefreshTimerEntry<number>>>(new Map());
  const fetchCommandsRef = useRef(fetchCommands);
  fetchCommandsRef.current = fetchCommands;

  const isMenuBarCommandActiveRef = useRef(isMenuBarCommandActive);
  isMenuBarCommandActiveRef.current = isMenuBarCommandActive;

  const createTimer = useCallback((descriptor: BackgroundRefreshTimerDescriptor): number => {
    const cmd = descriptor.command;

    if (descriptor.kind === 'extension') {
      const { extName, cmdName } = descriptor.extensionCommand!;

      return window.setInterval(createInFlightBackgroundRefreshTick(async () => {
        try {
          const result = await window.electron.runExtension(extName, cmdName);
          if (!result || !result.code) return;

          const hydrated = hydrateExtensionBundlePreferences(result);
          if (hydrated.mode !== 'no-view' && hydrated.mode !== 'menu-bar') return;

          // Menu-bar interval re-runs only fire while the item is currently
          // shown — otherwise toggling a menu-bar command off would be undone
          // by the next tick re-dispatching `sc-launch-extension-bundle` →
          // upsertMenuBarExtension and the tray icon would respawn.
          if (
            hydrated.mode === 'menu-bar' &&
            isMenuBarCommandActiveRef.current &&
            !isMenuBarCommandActiveRef.current(extName, cmdName)
          ) {
            return;
          }

          const missingPrefs = getMissingRequiredPreferences(hydrated);
          const missingArgs = getMissingRequiredArguments(hydrated);
          if (missingPrefs.length > 0 || missingArgs.length > 0) return;

          window.dispatchEvent(
            new CustomEvent('sc-launch-extension-bundle', {
              detail: {
                bundle: hydrated,
                launchOptions: { type: 'background' },
                source: {
                  commandMode: 'background',
                  extensionName: hydrated.extensionName || hydrated.extName,
                  commandName: hydrated.commandName || hydrated.cmdName,
                },
              },
            })
          );
        } catch (error) {
          console.error('[BackgroundRefresh] Failed to run command:', cmd.id, error);
        }
      }), descriptor.intervalMs);
    }

    return window.setInterval(createInFlightBackgroundRefreshTick(async () => {
      try {
        const storedArgs = readJsonObject(getScriptCmdArgsKey(cmd.id));
        const missingArgs = getMissingRequiredScriptArguments(cmd, storedArgs);
        if (missingArgs.length > 0) return;
        const result = await window.electron.runScriptCommand({
          commandId: cmd.id,
          arguments: storedArgs,
          background: true,
        });
        if (result?.mode === 'inline') {
          await fetchCommandsRef.current();
        }
      } catch (error) {
        console.error('[BackgroundRefresh] Failed to run script command:', cmd.id, error);
      }
    }), descriptor.intervalMs);
  }, []);

  useEffect(() => {
    const descriptors = getBackgroundRefreshTimerDescriptors(commands, parseIntervalToMs);
    reconcileBackgroundRefreshTimers({
      timers: intervalTimersRef.current,
      descriptors,
      createTimer,
      clearTimer: (timerId) => window.clearInterval(timerId),
    });
  }, [commands, createTimer]);

  useEffect(() => {
    return () => {
      clearBackgroundRefreshTimers(intervalTimersRef.current, (timerId) => window.clearInterval(timerId));
    };
  }, []);
}
