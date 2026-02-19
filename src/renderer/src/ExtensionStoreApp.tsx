import React, { useEffect } from 'react';
import StoreTab from './settings/StoreTab';
import { applyAppFontSize, getDefaultAppFontSize } from './utils/font-size';

const ExtensionStoreApp: React.FC = () => {
  useEffect(() => {
    let disposed = false;
    window.electron.getSettings()
      .then((settings) => {
        if (!disposed) applyAppFontSize(settings.fontSize);
      })
      .catch(() => {
        if (!disposed) applyAppFontSize(getDefaultAppFontSize());
      });
    return () => {
      disposed = true;
    };
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
