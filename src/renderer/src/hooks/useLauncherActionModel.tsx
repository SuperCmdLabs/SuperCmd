import React, { useCallback, useMemo } from 'react';
import {
  ArrowRight,
  ArrowUp,
  ArrowDown,
  CornerDownLeft,
  ExternalLink,
  Plus,
  Pencil,
  Files,
  Trash2,
  Download,
  BellOff,
  Info,
  FolderOpen,
  Copy,
  Pin,
  Link,
  EyeOff,
  Play,
  XCircle,
  Timer,
} from 'lucide-react';
import type { CommandInfo } from '../../types/electron';
import type { LauncherContextMenuState } from '../components/LauncherContextMenuOverlay';
import {
  type LauncherAction,
  matchesLauncherShortcut,
} from '../utils/command-helpers';
import { getFileResultPathFromCommand } from '../utils/launcher-file-results';
import { getQuickLinkIdFromCommandId } from '../utils/launcher-misc';
import {
  BROWSER_SEARCH_SHOW_ALL_RESULTS_ID,
  isBrowserSearchCommand,
} from '../utils/browser-search-commands';

export type UseLauncherActionModelOptions = {
  selectedCommand: CommandInfo | null;
  actionsCommand: CommandInfo | null;
  contextMenu: LauncherContextMenuState | null;

  selectedActionIndex: number;
  selectedContextActionIndex: number;

  setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  setSelectedIndex: React.Dispatch<React.SetStateAction<number>>;
  setShowActions: React.Dispatch<React.SetStateAction<boolean>>;
  setActionsCommand: React.Dispatch<React.SetStateAction<CommandInfo | null>>;
  setContextMenu: React.Dispatch<React.SetStateAction<LauncherContextMenuState | null>>;
  setSelectedActionIndex: React.Dispatch<React.SetStateAction<number>>;
  setSelectedContextActionIndex: React.Dispatch<React.SetStateAction<number>>;

  pinnedCommands: string[];
  pinnedFiles: string[];
  fileIsDirectoryMap: Record<string, boolean>;
  autoQuitAppPaths: Set<string>;
  launcherInputValue: string;

  handleCommandExecute: (command: CommandInfo) => void | Promise<void>;
  submitBrowserSearch: (
    rawQuery: string,
    options?: {
      focusExistingTab?: boolean;
      event?: { altKey?: boolean; numberKey?: string | number | null };
      kind?: CommandInfo['browserResultKind'];
      url?: string;
      sourceProfileId?: string;
      windowId?: string | number;
      tabId?: string | number;
    }
  ) => void | Promise<void | boolean>;

  openFileResultByPath: (targetPath: string) => void | Promise<void>;
  showFileResultDetailsByPath: (targetPath: string) => void | Promise<void>;
  revealFileResultByPath: (targetPath: string) => void | Promise<void>;
  copyFileResultPath: (targetPath: string) => void | Promise<void>;
  pinToggleForFile: (targetPath: string) => void | Promise<void>;

  copyCommandDeeplink: (command: CommandInfo) => void | Promise<void>;
  pinToggleForCommand: (command: CommandInfo) => void | Promise<void>;
  disableCommand: (command: CommandInfo) => void | Promise<void>;
  uninstallExtensionCommand: (command: CommandInfo) => void | Promise<void>;
  movePinnedCommand: (command: CommandInfo, direction: 'up' | 'down') => void | Promise<void>;

  fetchCommands: (options?: { showLoading?: boolean }) => void | Promise<void>;
  openQuickLinkManager: (mode: 'search' | 'create') => void;
  setQuickLinkEditId: React.Dispatch<React.SetStateAction<string | null>>;
  openAppUninstall: (appPath: string) => void;
  toggleAutoQuitForApp: (appPath: string, appName: string) => void | Promise<void>;

  restoreLauncherFocus: () => void;
  t: (key: string, params?: Record<string, string | number>) => string;
};

export function useLauncherActionModel(options: UseLauncherActionModelOptions): {
  selectedActions: LauncherAction[];
  actionsOverlayActions: LauncherAction[];
  contextActions: LauncherAction[];
  handleActionsOverlayKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => Promise<void>;
  handleContextMenuKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => Promise<void>;
  openLauncherCommandContextMenu: (
    event: React.MouseEvent<HTMLDivElement>,
    command: CommandInfo,
    nextSelectedIndex: number
  ) => void;
  openSelectedCommandActions: () => void;
} {
  const {
    selectedCommand,
    actionsCommand,
    contextMenu,
    selectedActionIndex,
    selectedContextActionIndex,
    setSearchQuery,
    setSelectedIndex,
    setShowActions,
    setActionsCommand,
    setContextMenu,
    setSelectedActionIndex,
    setSelectedContextActionIndex,
    pinnedCommands,
    pinnedFiles,
    fileIsDirectoryMap,
    autoQuitAppPaths,
    launcherInputValue,
    handleCommandExecute,
    submitBrowserSearch,
    openFileResultByPath,
    showFileResultDetailsByPath,
    revealFileResultByPath,
    copyFileResultPath,
    pinToggleForFile,
    copyCommandDeeplink,
    pinToggleForCommand,
    disableCommand,
    uninstallExtensionCommand,
    movePinnedCommand,
    fetchCommands,
    openQuickLinkManager,
    setQuickLinkEditId,
    openAppUninstall,
    toggleAutoQuitForApp,
    restoreLauncherFocus,
    t,
  } = options;

  const getActionsForCommand = useCallback(
    (command: CommandInfo | null): LauncherAction[] => {
      if (!command) return [];

      if (command.id === 'system-update-and-reopen') {
        return [
          {
            id: 'update-and-reopen',
            title: 'Update and Restart',
            shortcut: 'Enter',
            icon: <Download className="w-4 h-4" />,
            execute: () => handleCommandExecute(command),
          },
          {
            id: 'dismiss-update-banner',
            title: 'Dismiss for 3 Days',
            icon: <BellOff className="w-4 h-4" />,
            execute: async () => {
              await window.electron.dismissUpdateBanner();
              await fetchCommands({ showLoading: false });
            },
          },
        ] as LauncherAction[];
      }

      if (isBrowserSearchCommand(command)) {
        if (command.id === BROWSER_SEARCH_SHOW_ALL_RESULTS_ID) {
          return [
            {
              id: 'show-all-browser-results',
              title: t('launcher.browserSearch.showAll'),
              shortcut: 'Enter',
              icon: <ArrowRight className="w-4 h-4" />,
              execute: () => handleCommandExecute(command),
            },
          ] as LauncherAction[];
        }
        const hasOpenTabMatch = command.browserFocusAvailable === true;
        return [
          {
            id: 'open-browser-result',
            title: t('launcher.actions.open'),
            shortcut: 'Enter',
            icon: <ExternalLink className="w-4 h-4" />,
            execute: () => handleCommandExecute(command),
          },
          ...(hasOpenTabMatch ? [{
            id: 'focus-existing-tab',
            title: t('launcher.actions.focusExistingTab'),
            shortcut: 'Command+Enter',
            icon: <CornerDownLeft className="w-4 h-4" />,
            execute: () => submitBrowserSearch(String(command.browserActionInput || launcherInputValue).trim(), {
              focusExistingTab: true,
              kind: command.browserResultKind,
              url: command.browserUrl,
              sourceProfileId: command.browserSourceProfileId,
              windowId: command.browserWindowId,
              tabId: command.browserTabId,
            }),
          }] : []),
        ] as LauncherAction[];
      }

      const filePath = getFileResultPathFromCommand(command);
      if (filePath) {
        const isPinnedFile = pinnedFiles.includes(filePath);
        const isDirectory = Boolean(fileIsDirectoryMap[filePath]);
        const pinActionTitle = isDirectory
          ? (isPinnedFile ? 'Unpin Folder' : 'Pin Folder')
          : (isPinnedFile ? 'Unpin File' : 'Pin File');
        return [
          {
            id: 'open-file',
            title: t('launcher.actions.openFile'),
            shortcut: 'Enter',
            icon: <CornerDownLeft className="w-4 h-4" />,
            execute: () => openFileResultByPath(filePath),
          },
          {
            id: 'show-file-details',
            title: t('launcher.actions.showDetails'),
            shortcut: 'Cmd+D',
            icon: <Info className="w-4 h-4" />,
            execute: () => showFileResultDetailsByPath(filePath),
          },
          {
            id: 'reveal-file',
            title: t('launcher.actions.revealInFinder'),
            shortcut: 'Cmd+Enter',
            icon: <FolderOpen className="w-4 h-4" />,
            execute: () => revealFileResultByPath(filePath),
          },
          {
            id: 'copy-file-path',
            title: t('launcher.actions.copyPath'),
            shortcut: 'Cmd+Shift+C',
            icon: <Copy className="w-4 h-4" />,
            execute: () => copyFileResultPath(filePath),
          },
          {
            id: 'pin-file',
            title: pinActionTitle,
            shortcut: 'Cmd+Shift+P',
            icon: <Pin className="w-4 h-4" />,
            execute: () => pinToggleForFile(filePath),
          },
          ...(filePath.endsWith('.app') ? [{
            id: 'toggle-auto-quit',
            title: autoQuitAppPaths.has(filePath) ? t('launcher.actions.disableAutoQuit') : t('launcher.actions.enableAutoQuit'),
            icon: <Timer className="w-4 h-4" />,
            execute: () => toggleAutoQuitForApp(filePath, command.title),
          }, {
            id: 'quit-app',
            title: t('launcher.actions.quit'),
            shortcut: 'Ctrl+Shift+Q',
            separatorBefore: true,
            icon: <XCircle className="w-4 h-4" />,
            execute: async () => {
              const appName = filePath.split('/').pop()?.replace('.app', '') || '';
              const ok = await window.electron.quitApp(filePath);
              setShowActions(false);
              window.electron.hideWindow();
              window.electron.reportNoViewStatus(ok ? 'success' : 'error', ok ? t('launcher.actions.quitApp', { appName }) : t('launcher.actions.failedQuitting', { appName }));
            },
          }, {
            id: 'force-quit-app',
            title: t('launcher.actions.forceQuit'),
            shortcut: 'Ctrl+Alt+Shift+Q',
            icon: <XCircle className="w-4 h-4" />,
            execute: async () => {
              const appName = filePath.split('/').pop()?.replace('.app', '') || '';
              const confirmed = window.confirm(t('launcher.actions.forceQuitConfirm', { appName }));
              if (!confirmed) return;
              const ok = await window.electron.quitApp(filePath, true);
              setShowActions(false);
              window.electron.hideWindow();
              window.electron.reportNoViewStatus(ok ? 'success' : 'error', ok ? t('launcher.actions.forceQuitApp', { appName }) : t('launcher.actions.failedQuitting', { appName }));
            },
          }, {
            id: 'uninstall-app',
            title: t('launcher.actions.uninstallApplication'),
            shortcut: 'Ctrl+X',
            icon: <Trash2 className="w-4 h-4" />,
            style: 'destructive' as const,
            execute: () => openAppUninstall(filePath),
          }] : []),
        ];
      }

      const quickLinkId = getQuickLinkIdFromCommandId(command.id);
      if (quickLinkId) {
        return [
          {
            id: 'open-quick-link',
            title: 'Open Quick Link',
            shortcut: 'Enter',
            icon: <ExternalLink className="w-4 h-4" />,
            execute: () => handleCommandExecute(command),
          },
          {
            id: 'create-quick-link',
            title: 'Create Quick Link',
            shortcut: 'Cmd+N',
            icon: <Plus className="w-4 h-4" />,
            execute: () => openQuickLinkManager('create'),
          },
          {
            id: 'edit-quick-link',
            title: 'Edit Quick Link',
            shortcut: 'Cmd+E',
            icon: <Pencil className="w-4 h-4" />,
            execute: () => {
              setQuickLinkEditId(quickLinkId);
              openQuickLinkManager('search');
            },
          },
          {
            id: 'duplicate-quick-link',
            title: 'Duplicate Quick Link',
            shortcut: 'Cmd+D',
            icon: <Files className="w-4 h-4" />,
            execute: async () => {
              await window.electron.quickLinkDuplicate(quickLinkId);
              await fetchCommands({ showLoading: false });
            },
          },
          {
            id: 'delete-quick-link',
            title: 'Delete Quick Link',
            shortcut: 'Ctrl+X',
            icon: <Trash2 className="w-4 h-4" />,
            style: 'destructive' as const,
            execute: async () => {
              await window.electron.quickLinkDelete(quickLinkId);
              setSearchQuery('');
              setSelectedIndex(0);
              await fetchCommands({ showLoading: false });
            },
          },
        ];
      }

      const isPinned = pinnedCommands.includes(command.id);
      const pinnedIndex = pinnedCommands.indexOf(command.id);
      const hasDeeplink = Boolean(String(command.deeplink || '').trim());
      const isApp = command.category === 'app' && Boolean(command.path?.endsWith('.app'));
      return ([
        {
          id: 'open',
          title: t('launcher.actions.openCommand'),
          shortcut: 'Enter',
          icon: <Play className="w-4 h-4" />,
          execute: () => handleCommandExecute(command),
        },
        {
          id: 'copy-deeplink',
          title: t('launcher.actions.copyDeeplink'),
          shortcut: 'Cmd+Shift+L',
          enabled: hasDeeplink,
          icon: <Link className="w-4 h-4" />,
          execute: () => copyCommandDeeplink(command),
        },
        {
          id: 'pin',
          title: isPinned
            ? t(command.category === 'extension' ? 'launcher.actions.unpinExtension' : 'launcher.actions.unpinCommand')
            : command.category === 'extension'
              ? t('launcher.actions.pinExtension')
              : t('launcher.actions.pinCommand'),
          shortcut: 'Cmd+Shift+P',
          icon: <Pin className="w-4 h-4" />,
          execute: () => pinToggleForCommand(command),
        },
        ...(isApp ? [{
          id: 'quit-app',
          title: t('launcher.actions.quit'),
          shortcut: 'Ctrl+Shift+Q',
          separatorBefore: true,
          icon: <XCircle className="w-4 h-4" />,
          execute: async () => {
            const ok = await window.electron.quitApp(command.path!);
            setShowActions(false);
            window.electron.hideWindow();
            window.electron.reportNoViewStatus(ok ? 'success' : 'error', ok ? t('launcher.actions.quitApp', { appName: command.title }) : t('launcher.actions.failedQuitting', { appName: command.title }));
          },
        }] : []),
        ...(isApp ? [{
          id: 'force-quit-app',
          title: t('launcher.actions.forceQuit'),
          shortcut: 'Ctrl+Alt+Shift+Q',
          icon: <XCircle className="w-4 h-4" />,
          execute: async () => {
            const confirmed = window.confirm(t('launcher.actions.forceQuitConfirm', { appName: command.title }));
            if (!confirmed) return;
            const ok = await window.electron.quitApp(command.path!, true);
            setShowActions(false);
            window.electron.hideWindow();
            window.electron.reportNoViewStatus(ok ? 'success' : 'error', ok ? t('launcher.actions.forceQuitApp', { appName: command.title }) : t('launcher.actions.failedQuitting', { appName: command.title }));
          },
        }] : []),
        {
          id: 'toggle-auto-quit',
          title: (command.path && autoQuitAppPaths.has(command.path)) ? t('launcher.actions.disableAutoQuit') : t('launcher.actions.enableAutoQuit'),
          enabled: command.category === 'app' && Boolean(command.path?.endsWith('.app')),
          icon: <Timer className="w-4 h-4" />,
          execute: () => {
            if (!command.path) return;
            void toggleAutoQuitForApp(command.path, command.title);
          },
        },
        {
          id: 'disable',
          title: command.category === 'app' ? t('launcher.actions.disableApplication') : t('launcher.actions.disableCommand'),
          shortcut: 'Cmd+Shift+D',
          separatorBefore: true,
          style: 'destructive' as const,
          icon: <EyeOff className="w-4 h-4" />,
          execute: () => disableCommand(command),
        },
        {
          id: 'uninstall',
          title: 'Uninstall',
          shortcut: 'Cmd+Delete',
          style: 'destructive' as const,
          enabled: command.category === 'extension',
          icon: <Trash2 className="w-4 h-4" />,
          execute: () => uninstallExtensionCommand(command),
        },
        {
          id: 'uninstall-app',
          title: t('launcher.actions.uninstallApplication'),
          shortcut: 'Ctrl+X',
          style: 'destructive' as const,
          enabled: command.category === 'app' && Boolean(command.path?.endsWith('.app')),
          icon: <Trash2 className="w-4 h-4" />,
          execute: () => { try { if (command.path) openAppUninstall(command.path); } catch(e) { console.error('openAppUninstall error:', e); } },
        },
        {
          title: t('launcher.actions.moveUp'),
          shortcut: 'Cmd+Alt+Up',
          enabled: isPinned && pinnedIndex > 0,
          icon: <ArrowUp className="w-4 h-4" />,
          execute: () => movePinnedCommand(command, 'up'),
        },
        {
          id: 'move-down',
          title: t('launcher.actions.moveDown'),
          shortcut: 'Cmd+Alt+Down',
          enabled: isPinned && pinnedIndex >= 0 && pinnedIndex < pinnedCommands.length - 1,
          icon: <ArrowDown className="w-4 h-4" />,
          execute: () => movePinnedCommand(command, 'down'),
        },
      ] as LauncherAction[]).filter((action) => action.enabled !== false);
    },
    [
      pinnedCommands,
      pinnedFiles,
      fileIsDirectoryMap,
      pinToggleForFile,
      handleCommandExecute,
      pinToggleForCommand,
      disableCommand,
      uninstallExtensionCommand,
      movePinnedCommand,
      openFileResultByPath,
      showFileResultDetailsByPath,
      revealFileResultByPath,
      copyFileResultPath,
      copyCommandDeeplink,
      fetchCommands,
      openQuickLinkManager,
      setQuickLinkEditId,
      openAppUninstall,
      autoQuitAppPaths,
      toggleAutoQuitForApp,
      submitBrowserSearch,
      launcherInputValue,
      setSearchQuery,
      setSelectedIndex,
      setShowActions,
      t,
    ]
  );

  const selectedActions = useMemo(
    () => getActionsForCommand(selectedCommand),
    [getActionsForCommand, selectedCommand]
  );
  const actionsOverlayActions = useMemo(
    () => getActionsForCommand(actionsCommand),
    [actionsCommand, getActionsForCommand]
  );

  const contextCommand = useMemo(
    () => (contextMenu ? contextMenu.command : null),
    [contextMenu]
  );

  const contextActions = useMemo(
    () => getActionsForCommand(contextCommand),
    [getActionsForCommand, contextCommand]
  );

  const handleActionsOverlayKeyDown = useCallback(
    async (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (actionsOverlayActions.length === 0) return;

      // Match modifier shortcuts (Cmd+N, Ctrl+X, etc.) to actions
      if (!e.repeat && (e.metaKey || e.ctrlKey || e.altKey)) {
        for (const action of actionsOverlayActions) {
          if (!action.shortcut || action.shortcut === 'Enter') continue;
          if (matchesLauncherShortcut(e, action.shortcut)) {
            e.preventDefault();
            await Promise.resolve(action.execute());
            setShowActions(false);
            restoreLauncherFocus();
            return;
          }
        }
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedActionIndex((prev) =>
            Math.min(prev + 1, actionsOverlayActions.length - 1)
          );
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedActionIndex((prev) => Math.max(prev - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          await Promise.resolve(actionsOverlayActions[selectedActionIndex]?.execute());
          setShowActions(false);
          restoreLauncherFocus();
          break;
        case 'Escape':
          e.preventDefault();
          setShowActions(false);
          restoreLauncherFocus();
          break;
      }
    },
    [actionsOverlayActions, selectedActionIndex, restoreLauncherFocus, setSelectedActionIndex, setShowActions]
  );

  const handleContextMenuKeyDown = useCallback(
    async (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (contextActions.length === 0) return;

      // Match modifier shortcuts to actions
      if (!e.repeat && (e.metaKey || e.ctrlKey || e.altKey)) {
        for (const action of contextActions) {
          if (!action.shortcut || action.shortcut === 'Enter') continue;
          if (matchesLauncherShortcut(e, action.shortcut)) {
            e.preventDefault();
            await Promise.resolve(action.execute());
            setContextMenu(null);
            restoreLauncherFocus();
            return;
          }
        }
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedContextActionIndex((prev) =>
            Math.min(prev + 1, contextActions.length - 1)
          );
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedContextActionIndex((prev) => Math.max(prev - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          await Promise.resolve(contextActions[selectedContextActionIndex]?.execute());
          setContextMenu(null);
          restoreLauncherFocus();
          break;
        case 'Escape':
          e.preventDefault();
          setContextMenu(null);
          restoreLauncherFocus();
          break;
      }
    },
    [contextActions, selectedContextActionIndex, restoreLauncherFocus, setContextMenu, setSelectedContextActionIndex]
  );

  const openLauncherCommandContextMenu = useCallback((
    event: React.MouseEvent<HTMLDivElement>,
    command: CommandInfo,
    nextSelectedIndex: number
  ) => {
    event.preventDefault();
    setSelectedIndex(nextSelectedIndex);
    setShowActions(false);
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      command,
    });
  }, [setContextMenu, setSelectedIndex, setShowActions]);

  const openSelectedCommandActions = useCallback(() => {
    if (!selectedCommand) return;
    setContextMenu(null);
    setActionsCommand(selectedCommand);
    setSelectedActionIndex(0);
    setShowActions(true);
  }, [selectedCommand, setActionsCommand, setContextMenu, setSelectedActionIndex, setShowActions]);

  return {
    selectedActions,
    actionsOverlayActions,
    contextActions,
    handleActionsOverlayKeyDown,
    handleContextMenuKeyDown,
    openLauncherCommandContextMenu,
    openSelectedCommandActions,
  };
}
