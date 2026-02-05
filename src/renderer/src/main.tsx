import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import SettingsApp from './SettingsApp';
import '../styles/index.css';

// Hash-based routing: launcher uses #/ , settings uses #/settings
const hash = window.location.hash;
const isSettings = hash.includes('/settings');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isSettings ? <SettingsApp /> : <App />}
  </React.StrictMode>
);
