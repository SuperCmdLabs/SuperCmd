import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import SettingsApp from './SettingsApp';
import ExtensionStoreApp from './ExtensionStoreApp';
import PromptApp from './PromptApp';
import NotesApp from './NotesApp';
import AiChatApp from './AiChatApp';
import { I18nProvider } from './i18n';
import '../styles/index.css';
import { initializeTheme } from './utils/theme';

// Hash-based routing: launcher uses #/ , settings uses #/settings
const hash = window.location.hash;
const isSettings = hash.includes('/settings');
const isExtensionStore = hash.includes('/extension-store');
const isPrompt = hash.includes('/prompt');
const isNotes = hash.includes('/notes');
const isAiChat = hash.includes('/ai-chat');

initializeTheme();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider>
    {isAiChat ? <AiChatApp /> : isNotes ? <NotesApp /> : isPrompt ? <PromptApp /> : isExtensionStore ? <ExtensionStoreApp /> : isSettings ? <SettingsApp /> : <App />}
    </I18nProvider>
  </React.StrictMode>
);
