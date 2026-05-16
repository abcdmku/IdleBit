/// <reference types="vite/client" />

interface IdleBitElectronApi {
  loadSave: () => Promise<string | null>;
  writeSave: (value: string) => Promise<void>;
}

interface Window {
  idleBit?: IdleBitElectronApi;
}

