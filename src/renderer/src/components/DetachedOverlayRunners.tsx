import React, { memo } from 'react';
import { createPortal } from 'react-dom';
import SuperCmdWhisper from '../SuperCmdWhisper';
import SuperCmdRead from '../SuperCmdRead';
import WindowManagerPanel from '../WindowManagerPanel';
import MenuItemSearch from '../MenuItemSearchExtension';
import type { SpeakStatus } from '../hooks/useSpeakManager';
import type { UseCursorPromptReturn } from '../hooks/useCursorPrompt';
import type { ReadVoiceOption } from '../utils/command-helpers';
import CursorPromptView from '../views/CursorPromptView';

type DetachedOverlayRunnersProps = {
  showWhisper: boolean;
  whisperPortalTarget: HTMLElement | null;
  whisperStartToken: number;
  showWhisperOnboarding: boolean;
  appendWhisperOnboardingPracticeText: (text: string) => void;
  whisperCoachmarkText?: string;
  whisperAutoClose: boolean;
  onWhisperClose: () => void;

  showSpeak: boolean;
  speakPortalTarget: HTMLElement | null;
  speakStatus: SpeakStatus;
  speakOptions: { voice: string; rate: string };
  readVoiceOptions: ReadVoiceOption[];
  handleSpeakVoiceChange: (voice: string) => void;
  handleSpeakRateChange: (rate: string) => void;
  handleSpeakTogglePause: () => void;
  handleSpeakPreviousParagraph: () => void;
  handleSpeakNextParagraph: () => void;
  onSpeakClose: () => void;

  showWindowManager: boolean;
  windowManagerPortalTarget: HTMLElement | null;
  onWindowManagerClose: () => void;

  showMenuItemSearch: boolean;
  menuItemSearchPortalTarget: HTMLElement | null;
  onMenuItemSearchClose: () => void;

  showCursorPrompt: boolean;
  cursorPromptPortalTarget: HTMLElement | null;
  cursorPromptText: string;
  setCursorPromptText: (text: string) => void;
  cursorPromptStatus: UseCursorPromptReturn['cursorPromptStatus'];
  cursorPromptResult: string;
  cursorPromptError: string;
  cursorPromptInputRef: React.RefObject<HTMLTextAreaElement>;
  aiAvailable: boolean;
  submitCursorPrompt: () => void;
  closeCursorPrompt: () => void;
  acceptCursorPrompt: () => void;
};

const DetachedOverlayRunners: React.FC<DetachedOverlayRunnersProps> = ({
  showWhisper,
  whisperPortalTarget,
  whisperStartToken,
  showWhisperOnboarding,
  appendWhisperOnboardingPracticeText,
  whisperCoachmarkText,
  whisperAutoClose,
  onWhisperClose,
  showSpeak,
  speakPortalTarget,
  speakStatus,
  speakOptions,
  readVoiceOptions,
  handleSpeakVoiceChange,
  handleSpeakRateChange,
  handleSpeakTogglePause,
  handleSpeakPreviousParagraph,
  handleSpeakNextParagraph,
  onSpeakClose,
  showWindowManager,
  windowManagerPortalTarget,
  onWindowManagerClose,
  showMenuItemSearch,
  menuItemSearchPortalTarget,
  onMenuItemSearchClose,
  showCursorPrompt,
  cursorPromptPortalTarget,
  cursorPromptText,
  setCursorPromptText,
  cursorPromptStatus,
  cursorPromptResult,
  cursorPromptError,
  cursorPromptInputRef,
  aiAvailable,
  submitCursorPrompt,
  closeCursorPrompt,
  acceptCursorPrompt,
}) => {
  return (
    <>
      {showWhisper && whisperPortalTarget ? (
        <SuperCmdWhisper
          portalTarget={whisperPortalTarget}
          startToken={whisperStartToken}
          onboardingCaptureMode={showWhisperOnboarding}
          onOnboardingTranscriptAppend={appendWhisperOnboardingPracticeText}
          coachmarkText={whisperCoachmarkText}
          autoClose={whisperAutoClose}
          onClose={onWhisperClose}
        />
      ) : null}
      {showSpeak && speakPortalTarget ? (
        <SuperCmdRead
          status={speakStatus}
          voice={speakOptions.voice}
          voiceOptions={readVoiceOptions}
          rate={speakOptions.rate}
          portalTarget={speakPortalTarget}
          onVoiceChange={handleSpeakVoiceChange}
          onRateChange={handleSpeakRateChange}
          onPauseToggle={handleSpeakTogglePause}
          onPreviousParagraph={handleSpeakPreviousParagraph}
          onNextParagraph={handleSpeakNextParagraph}
          onClose={onSpeakClose}
        />
      ) : null}
      {showWindowManager && windowManagerPortalTarget ? (
        <WindowManagerPanel
          show={showWindowManager}
          portalTarget={windowManagerPortalTarget}
          onClose={onWindowManagerClose}
        />
      ) : null}
      {showMenuItemSearch && menuItemSearchPortalTarget ? (
        <MenuItemSearch
          show={showMenuItemSearch}
          portalTarget={menuItemSearchPortalTarget}
          onClose={onMenuItemSearchClose}
        />
      ) : null}
      {showCursorPrompt && cursorPromptPortalTarget
        ? createPortal(
            <CursorPromptView
              variant="portal"
              cursorPromptText={cursorPromptText}
              setCursorPromptText={setCursorPromptText}
              cursorPromptStatus={cursorPromptStatus}
              cursorPromptResult={cursorPromptResult}
              cursorPromptError={cursorPromptError}
              cursorPromptInputRef={cursorPromptInputRef}
              aiAvailable={aiAvailable}
              submitCursorPrompt={submitCursorPrompt}
              closeCursorPrompt={closeCursorPrompt}
              acceptCursorPrompt={acceptCursorPrompt}
            />,
            cursorPromptPortalTarget
          )
        : null}
    </>
  );
};

export default memo(DetachedOverlayRunners);
