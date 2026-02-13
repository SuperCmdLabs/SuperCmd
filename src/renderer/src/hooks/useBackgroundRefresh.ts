import { useRef, useEffect } from 'react';
import type { CommandInfo } from '../../types/electron';
import { parseIntervalToMs } from '../utils/command-helpers';
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
}

export function useBackgroundRefresh({ commands, fetchCommands }: UseBackgroundRefreshOptions): void {
  const intervalTimerIdsRef = useRef<number[]>([]);

  useEffect(() => {
    for (const timerId of intervalTimerIdsRef.current) {
      window.clearInterval(timerId);
    }
    intervalTimerIdsRef.current = [];

    const extensionCommands = commands.filter(
      (cmd) => cmd.category === 'extension' && typeof cmd.interval === 'string' && cmd.path
    );

    for (const cmd of extensionCommands) {
      const ms = parseIntervalToMs(cmd.interval);
      if (!ms) continue;

      const [extName, cmdName] = (cmd.path || '').split('/');
      if (!extName || !cmdName) continue;

      const timerId = window.setInterval(async () => {
        try {
          const result = await window.electron.runExtension(extName, cmdName);
          if (!result || !result.code) return;

          const hydrated = hydrateExtensionBundlePreferences(result);
          if (hydrated.mode !== 'no-view' && hydrated.mode !== 'menu-bar') return;

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
      }, ms);

      intervalTimerIdsRef.current.push(timerId);
    }

    const inlineScriptCommands = commands.filter(
      (cmd) =>
        cmd.category === 'script' &&
        cmd.mode === 'inline' &&
        typeof cmd.interval === 'string'
    );
    for (const cmd of inlineScriptCommands) {
      const ms = parseIntervalToMs(cmd.interval);
      if (!ms) continue;

      const timerId = window.setInterval(async () => {
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
            await fetchCommands();
          }
        } catch (error) {
          console.error('[BackgroundRefresh] Failed to run script command:', cmd.id, error);
        }
      }, ms);

      intervalTimerIdsRef.current.push(timerId);
    }

    return () => {
      for (const timerId of intervalTimerIdsRef.current) {
        window.clearInterval(timerId);
      }
      intervalTimerIdsRef.current = [];
    };
  }, [commands, fetchCommands]);
}
