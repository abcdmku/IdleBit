import {
  getIdleBitPlatformBridge,
  type BeforeCloseRequest,
  type PlatformLifecycleBridge,
} from "./platformBridge";

export interface LifecycleAdapter {
  acknowledgeBeforeClose(requestId: number): boolean;
  onBeforeClose(listener: (request: BeforeCloseRequest) => void): () => void;
}

export function createLifecycleAdapter(
  bridge: PlatformLifecycleBridge | null =
    getIdleBitPlatformBridge()?.lifecycle ?? null,
): LifecycleAdapter {
  return {
    acknowledgeBeforeClose(requestId) {
      if (!bridge || !Number.isSafeInteger(requestId) || requestId <= 0) {
        return false;
      }

      bridge.acknowledgeBeforeClose(requestId);
      return true;
    },

    onBeforeClose(listener) {
      if (!bridge) {
        return () => undefined;
      }

      return bridge.onBeforeClose(listener);
    },
  };
}

export const idleBitLifecycle = createLifecycleAdapter();

export type { BeforeCloseRequest } from "./platformBridge";
