/**
 * raycast-api/hooks/use-sql.ts
 * Purpose: useSQL hook.
 */

import React from 'react';
import { usePromise } from './use-promise';

export function useSQL<T = any>(
  databasePath: string,
  query: string,
  options?: {
    permissionPriming?: string;
    execute?: boolean;
    onError?: (error: Error) => void;
    onData?: (data: T[]) => void;
    onWillExecute?: (args: string[]) => void;
    failureToastOptions?: any;
  }
) {
  const result = usePromise(
    async (dbPath: string, sqlQuery: string) => {
      const electron = (window as any).electron;
      if (!electron?.runSqliteQuery) {
        throw new Error('useSQL: runSqliteQuery IPC not available');
      }
      const res = await electron.runSqliteQuery(dbPath, sqlQuery);
      if (res.error) {
        throw new Error(res.error);
      }
      return (Array.isArray(res.data) ? res.data : []) as T[];
    },
    [databasePath, query],
    {
      execute: options?.execute,
      onData: options?.onData,
      onError: options?.onError,
      onWillExecute: options?.onWillExecute ? () => options.onWillExecute!([databasePath, query]) : undefined,
    }
  );

  return { ...result, permissionView: undefined as React.ReactNode | undefined };
}
