import React from 'react';
import StoreTab from './settings/StoreTab';

const ExtensionStoreApp: React.FC = () => {
  return (
    <div className="h-screen flex glass-effect text-white select-none">
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="h-11 drag-region flex-shrink-0" />
        <div className="flex-1 overflow-hidden p-4 pt-1">
          <StoreTab />
        </div>
      </div>
    </div>
  );
};

export default ExtensionStoreApp;
