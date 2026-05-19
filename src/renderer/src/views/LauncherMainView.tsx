import React from 'react';
import type { BrowserProfileSetting, CommandInfo, QuickLinkDynamicField } from '../../types/electron';
import type { CalcResult } from '../smart-calculator';
import type { LauncherAction, MemoryFeedback } from '../utils/command-helpers';
import type { QuickLinkDynamicPromptState } from '../components/QuickLinkDynamicPromptOverlay';
import type { LauncherContextMenuState } from '../components/LauncherContextMenuOverlay';
import type { LauncherCommandSection } from '../components/LauncherCommandList';
import LauncherViewShell from '../components/LauncherViewShell';
import LauncherSearchHeader from '../components/LauncherSearchHeader';
import LauncherCompactShowMoreRow from '../components/LauncherCompactShowMoreRow';
import LauncherCommandList from '../components/LauncherCommandList';
import LauncherFooter from '../components/LauncherFooter';
import QuickLinkDynamicPromptOverlay from '../components/QuickLinkDynamicPromptOverlay';
import LauncherActionsOverlay from '../components/LauncherActionsOverlay';
import LauncherContextMenuOverlay from '../components/LauncherContextMenuOverlay';

type LauncherMainViewProps = {
  alwaysMountedRunners: React.ReactNode;

  backgroundImageUrl: string;
  backgroundBlurPercent: number;
  backgroundOpacityPercent: number;

  inlineArgumentLaneRef: React.RefObject<HTMLDivElement>;
  inlineArgumentClusterRef: React.RefObject<HTMLDivElement>;
  inlineArgumentInputRefs: React.MutableRefObject<(HTMLInputElement | HTMLSelectElement | null)[]>;
  inlineQuickLinkInputRefs: React.MutableRefObject<(HTMLInputElement | null)[]>;

  inputRef: React.RefObject<HTMLInputElement>;
  searchPlaceholder: string;
  launcherInputValue: string;
  autocompleteSuffix?: string;
  onInputChange: (value: string) => void;
  onSearchBlur: () => void;
  onSearchKeyDown: (event: React.KeyboardEvent) => void;

  inlineArgumentStartPx: number | null;
  selectedInlineArgumentLeadingIcon: React.ReactNode;

  selectedInlineExtensionArgumentDefinitions: CommandInfo['commandArgumentDefinitions'];
  selectedInlineExtensionArgumentValues: Record<string, string>;
  hasSelectedExtensionOverflowArguments: boolean;
  selectedExtensionOverflowCount: number;
  onInlineExtensionArgumentChange: (argumentName: string, value: string) => void;

  selectedQuickLinkId: string | null;
  selectedInlineQuickLinkDynamicFields: QuickLinkDynamicField[];
  selectedInlineQuickLinkDynamicValues: Record<string, string>;
  hasSelectedQuickLinkOverflowDynamicFields: boolean;
  selectedQuickLinkOverflowCount: number;
  onInlineQuickLinkDynamicValueChange: (fieldKey: string, value: string) => void;

  searchQuery: string;
  aiAvailable: boolean;
  shouldHideAskAi: boolean;
  onAskAi: () => void;
  onClearSearch: () => void;

  launcherViewMode: 'expanded' | 'compact';
  isCompactCollapsed: boolean;
  logoSrc: string;
  onShowCompactLauncher: () => void;

  listRef: React.RefObject<HTMLDivElement>;
  itemRefs: React.MutableRefObject<(HTMLDivElement | null)[]>;
  isLoading: boolean;
  displayCommands: CommandInfo[];
  sections: LauncherCommandSection[];
  calcResult: CalcResult | null;
  calcOffset: number;
  selectedIndex: number;
  commandAliases: Record<string, string>;
  commandHotkeys: Record<string, string>;
  onCalculatorCopy: () => void;
  onCommandClick: (command: CommandInfo, selectedIndex: number, event?: React.MouseEvent<HTMLDivElement>) => void | Promise<void>;
  onCommandContextMenu: (
    event: React.MouseEvent<HTMLDivElement>,
    command: CommandInfo,
    selectedIndex: number
  ) => void;

  launcherFooterStatus: MemoryFeedback;
  selectedCommand: CommandInfo | null;
  selectedAction: LauncherAction | undefined;
  browserProfiles: BrowserProfileSetting[];
  onOpenActions: () => void;

  quickLinkDynamicPrompt: QuickLinkDynamicPromptState | null;
  quickLinkDynamicInputRef: React.RefObject<HTMLInputElement>;
  quickLinkDynamicPromptTitle: string;
  setQuickLinkDynamicPrompt: React.Dispatch<React.SetStateAction<QuickLinkDynamicPromptState | null>>;
  cancelQuickLinkDynamicPrompt: () => void;
  submitQuickLinkDynamicPrompt: () => void | Promise<void>;

  showActions: boolean;
  actionsOverlayActions: LauncherAction[];
  selectedActionIndex: number;
  setSelectedActionIndex: React.Dispatch<React.SetStateAction<number>>;
  actionsOverlayRef: React.RefObject<HTMLDivElement>;
  handleActionsOverlayKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  closeActionsOverlay: () => void;
  onActionOverlayClick: (action: LauncherAction) => void | Promise<void>;

  contextMenu: LauncherContextMenuState | null;
  contextActions: LauncherAction[];
  selectedContextActionIndex: number;
  setSelectedContextActionIndex: React.Dispatch<React.SetStateAction<number>>;
  contextMenuRef: React.RefObject<HTMLDivElement>;
  handleContextMenuKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  closeContextMenu: () => void;
  onContextMenuActionClick: (action: LauncherAction) => void | Promise<void>;

  isNativeLiquidGlass: boolean;
  isGlassyTheme: boolean;

  t: (key: string, params?: Record<string, string | number>) => string;
};

const LauncherMainView: React.FC<LauncherMainViewProps> = ({
  alwaysMountedRunners,
  backgroundImageUrl,
  backgroundBlurPercent,
  backgroundOpacityPercent,
  inlineArgumentLaneRef,
  inlineArgumentClusterRef,
  inlineArgumentInputRefs,
  inlineQuickLinkInputRefs,
  inputRef,
  searchPlaceholder,
  launcherInputValue,
  autocompleteSuffix,
  onInputChange,
  onSearchBlur,
  onSearchKeyDown,
  inlineArgumentStartPx,
  selectedInlineArgumentLeadingIcon,
  selectedInlineExtensionArgumentDefinitions,
  selectedInlineExtensionArgumentValues,
  hasSelectedExtensionOverflowArguments,
  selectedExtensionOverflowCount,
  onInlineExtensionArgumentChange,
  selectedQuickLinkId,
  selectedInlineQuickLinkDynamicFields,
  selectedInlineQuickLinkDynamicValues,
  hasSelectedQuickLinkOverflowDynamicFields,
  selectedQuickLinkOverflowCount,
  onInlineQuickLinkDynamicValueChange,
  searchQuery,
  aiAvailable,
  shouldHideAskAi,
  onAskAi,
  onClearSearch,
  launcherViewMode,
  isCompactCollapsed,
  logoSrc,
  onShowCompactLauncher,
  listRef,
  itemRefs,
  isLoading,
  displayCommands,
  sections,
  calcResult,
  calcOffset,
  selectedIndex,
  commandAliases,
  commandHotkeys,
  onCalculatorCopy,
  onCommandClick,
  onCommandContextMenu,
  launcherFooterStatus,
  selectedCommand,
  selectedAction,
  browserProfiles,
  onOpenActions,
  quickLinkDynamicPrompt,
  quickLinkDynamicInputRef,
  quickLinkDynamicPromptTitle,
  setQuickLinkDynamicPrompt,
  cancelQuickLinkDynamicPrompt,
  submitQuickLinkDynamicPrompt,
  showActions,
  actionsOverlayActions,
  selectedActionIndex,
  setSelectedActionIndex,
  actionsOverlayRef,
  handleActionsOverlayKeyDown,
  closeActionsOverlay,
  onActionOverlayClick,
  contextMenu,
  contextActions,
  selectedContextActionIndex,
  setSelectedContextActionIndex,
  contextMenuRef,
  handleContextMenuKeyDown,
  closeContextMenu,
  onContextMenuActionClick,
  isNativeLiquidGlass,
  isGlassyTheme,
  t,
}) => (
  <>
    <LauncherViewShell
      alwaysMountedRunners={alwaysMountedRunners}
      backgroundImageUrl={backgroundImageUrl}
      showBackground={Boolean(backgroundImageUrl)}
      backgroundBlurPercent={backgroundBlurPercent}
      backgroundOpacityPercent={backgroundOpacityPercent}
      className="launcher-main-surface"
    >
      <LauncherSearchHeader
        inlineArgumentLaneRef={inlineArgumentLaneRef}
        inlineArgumentClusterRef={inlineArgumentClusterRef}
        inlineArgumentInputRefs={inlineArgumentInputRefs}
        inlineQuickLinkInputRefs={inlineQuickLinkInputRefs}
        inputRef={inputRef}
        placeholder={searchPlaceholder}
        value={launcherInputValue}
        autocompleteSuffix={autocompleteSuffix}
        onInputChange={onInputChange}
        onBlur={onSearchBlur}
        onKeyDown={onSearchKeyDown}
        inlineArgumentStartPx={inlineArgumentStartPx}
        selectedInlineArgumentLeadingIcon={selectedInlineArgumentLeadingIcon}
        selectedInlineExtensionArgumentDefinitions={selectedInlineExtensionArgumentDefinitions}
        selectedInlineExtensionArgumentValues={selectedInlineExtensionArgumentValues}
        hasSelectedExtensionOverflowArguments={hasSelectedExtensionOverflowArguments}
        selectedExtensionOverflowCount={selectedExtensionOverflowCount}
        onInlineExtensionArgumentChange={onInlineExtensionArgumentChange}
        selectedQuickLinkId={selectedQuickLinkId}
        selectedInlineQuickLinkDynamicFields={selectedInlineQuickLinkDynamicFields}
        selectedInlineQuickLinkDynamicValues={selectedInlineQuickLinkDynamicValues}
        hasSelectedQuickLinkOverflowDynamicFields={hasSelectedQuickLinkOverflowDynamicFields}
        selectedQuickLinkOverflowCount={selectedQuickLinkOverflowCount}
        onInlineQuickLinkDynamicValueChange={onInlineQuickLinkDynamicValueChange}
        searchQuery={searchQuery}
        aiAvailable={aiAvailable}
        shouldHideAskAi={shouldHideAskAi}
        onAskAi={onAskAi}
        onClearSearch={onClearSearch}
        t={t}
      />

      {launcherViewMode === 'compact' && isCompactCollapsed && (
        <LauncherCompactShowMoreRow
          logoSrc={logoSrc}
          onShowMore={onShowCompactLauncher}
          t={t}
        />
      )}

      <LauncherCommandList
        listRef={listRef}
        itemRefs={itemRefs}
        isLoading={isLoading}
        isHidden={launcherViewMode === 'compact' && isCompactCollapsed}
        displayCommands={displayCommands}
        sections={sections}
        calcResult={calcResult}
        calcOffset={calcOffset}
        selectedIndex={selectedIndex}
        commandAliases={commandAliases}
        commandHotkeys={commandHotkeys}
        onCalculatorCopy={onCalculatorCopy}
        onCommandClick={onCommandClick}
        onCommandContextMenu={onCommandContextMenu}
        t={t}
      />

      {!isLoading && !(launcherViewMode === 'compact' && isCompactCollapsed) && (
        <LauncherFooter
          status={launcherFooterStatus}
          selectedCommand={selectedCommand}
          selectedAction={selectedAction}
          browserProfiles={browserProfiles}
          resultCount={displayCommands.length}
          onOpenActions={onOpenActions}
          t={t}
        />
      )}
    </LauncherViewShell>
    <QuickLinkDynamicPromptOverlay
      prompt={quickLinkDynamicPrompt}
      inputRef={quickLinkDynamicInputRef}
      commandTitle={quickLinkDynamicPromptTitle}
      setPrompt={setQuickLinkDynamicPrompt}
      onCancel={cancelQuickLinkDynamicPrompt}
      onSubmit={submitQuickLinkDynamicPrompt}
      isNativeLiquidGlass={isNativeLiquidGlass}
      isGlassyTheme={isGlassyTheme}
    />
    {showActions && (
      <LauncherActionsOverlay
        actions={actionsOverlayActions}
        selectedIndex={selectedActionIndex}
        setSelectedIndex={setSelectedActionIndex}
        overlayRef={actionsOverlayRef}
        onKeyDown={handleActionsOverlayKeyDown}
        onClose={closeActionsOverlay}
        onActionClick={onActionOverlayClick}
        isNativeLiquidGlass={isNativeLiquidGlass}
        isGlassyTheme={isGlassyTheme}
      />
    )}
    <LauncherContextMenuOverlay
      contextMenu={contextMenu}
      actions={contextActions}
      selectedIndex={selectedContextActionIndex}
      setSelectedIndex={setSelectedContextActionIndex}
      menuRef={contextMenuRef}
      onKeyDown={handleContextMenuKeyDown}
      onClose={closeContextMenu}
      onActionClick={onContextMenuActionClick}
      isNativeLiquidGlass={isNativeLiquidGlass}
      isGlassyTheme={isGlassyTheme}
    />
  </>
);

export default LauncherMainView;
