/**
 * raycast-api/hooks/use-exec.ts
 * Purpose: useExec hook.
 */

import { usePromise } from './use-promise';

export function useExec<T = string>(
  command: string,
  args?: string[] | Record<string, any>,
  options?: {
    shell?: boolean | string;
    stripFinalNewline?: boolean;
    input?: string;
    encoding?: string;
    timeout?: number;
    parseOutput?: (output: { stdout: string; stderr: string; exitCode: number | null; error?: Error; signal: string | null; timedOut: boolean; command: string }) => T;
    initialData?: T;
    keepPreviousData?: boolean;
    execute?: boolean;
    onData?: (data: T) => void;
    onError?: (error: Error) => void;
    onWillExecute?: (args: string[]) => void;
    failureToastOptions?: any;
    env?: Record<string, string>;
    cwd?: string;
  }
) {
  const actualArgs: string[] = Array.isArray(args) ? args : [];
  const actualOptions = Array.isArray(args) ? options : (args as typeof options);

  return usePromise(
    async () => {
      const electron = (window as any).electron;
      if (!electron?.execCommand) {
        console.warn(`useExec: execCommand not available for "${command}"`);
        const output = { stdout: '', stderr: '', exitCode: 0 as number | null, signal: null as string | null, timedOut: false, command };
        return actualOptions?.parseOutput ? actualOptions.parseOutput(output) : ('' as any as T);
      }

      const result = await electron.execCommand(command, actualArgs, {
        shell: actualOptions?.shell,
        input: actualOptions?.input,
        env: actualOptions?.env,
        cwd: actualOptions?.cwd,
        timeout: actualOptions?.timeout,
      });

      if (result.exitCode !== 0 && result.stderr) {
        throw new Error(result.stderr);
      }

      if (actualOptions?.parseOutput) {
        return actualOptions.parseOutput({
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          signal: null,
          timedOut: false,
          command,
        });
      }

      let stdout = result.stdout as string;
      if (actualOptions?.stripFinalNewline !== false && stdout.endsWith('\n')) {
        stdout = stdout.slice(0, -1);
      }

      return stdout as any as T;
    },
    [],
    {
      initialData: actualOptions?.initialData,
      execute: actualOptions?.execute,
      onData: actualOptions?.onData,
      onError: actualOptions?.onError,
      onWillExecute: actualOptions?.onWillExecute ? () => actualOptions.onWillExecute!(actualArgs) : undefined,
    }
  );
}
