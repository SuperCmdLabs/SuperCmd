/**
 * AI Chat App
 *
 * Standalone app for the AI chat detached window.
 * Loaded via hash-based routing: #/ai-chat
 */

import React, { useEffect, useState } from 'react';
import AiChatManager from './views/AiChatManager';
import { applyAppFontSize, getDefaultAppFontSize } from './utils/font-size';
import { applyBaseColor } from './utils/base-color';
import { applyUiStyle } from './utils/ui-style';

function getInitialConversationId(): string | null {
  try {
    const hash = window.location.hash || '';
    const idx = hash.indexOf('?');
    if (idx === -1) return null;
    const params = new URLSearchParams(hash.slice(idx + 1));
    return params.get('conversationId') || null;
  } catch {}
  return null;
}

const AiChatApp: React.FC = () => {
  const [initialConversationId] = useState(getInitialConversationId);

  useEffect(() => {
    let disposed = false;
    window.electron.getSettings()
      .then((settings) => {
        if (!disposed) {
          applyAppFontSize(settings.fontSize);
          applyUiStyle(settings.uiStyle || 'default');
          applyBaseColor(settings.baseColor || '#101113');
        }
      })
      .catch(() => {
        if (!disposed) {
          applyAppFontSize(getDefaultAppFontSize());
          applyUiStyle('default');
        }
      });
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    const cleanup = window.electron.onSettingsUpdated?.((settings) => {
      applyAppFontSize(settings.fontSize);
      applyUiStyle(settings.uiStyle || 'default');
      applyBaseColor(settings.baseColor || '#101113');
    });
    return cleanup;
  }, []);

  return (
    <div className="h-screen glass-effect flex flex-col overflow-hidden">
      <AiChatManager initialConversationId={initialConversationId} />
    </div>
  );
};

export default AiChatApp;
