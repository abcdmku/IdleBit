export interface BeforeCloseRequest {
  requestId: number;
}

export interface StringPersistenceBridge {
  clear(keyPrefix?: string): Promise<void>;
  getItem(key: string): Promise<string | null>;
  removeItem(key: string): Promise<void>;
  setItem(key: string, value: string): Promise<void>;
}

export interface PlatformLifecycleBridge {
  acknowledgeBeforeClose(requestId: number): void;
  onBeforeClose(listener: (request: BeforeCloseRequest) => void): () => void;
}

export interface IdleBitPlatformBridge {
  lifecycle?: PlatformLifecycleBridge;
  persistence?: StringPersistenceBridge;
  runtime?: {
    kind?: string;
  };
}

declare global {
  interface Window {
    idleBitPlatform?: IdleBitPlatformBridge;
  }
}

export function getIdleBitPlatformBridge(): IdleBitPlatformBridge | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.idleBitPlatform ?? null;
}
