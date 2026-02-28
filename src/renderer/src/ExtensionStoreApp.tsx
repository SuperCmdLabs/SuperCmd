import React, { useEffect } from 'react';
import StoreTab from './settings/StoreTab';
import { applyAppFontSize, getDefaultAppFontSize } from './utils/font-size';
import { applyBaseColor } from './utils/base-color';
import { applyUiStyle } from './utils/ui-style';

const ExtensionStoreApp: React.FC = () => {
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
    return () => {
      disposed = true;
    };
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
    <div className="h-screen flex glass-effect text-white select-none">
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="h-11 drag-region flex-shrink-0" />
        <div className="flex-1 overflow-hidden">
          <StoreTab />
        </div>
      </div>
    </div>
  );
};

export default ExtensionStoreApp;
