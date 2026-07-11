import { describe, expect, it, vi } from "vitest";

import { createLifecycleAdapter } from "./lifecycle";
import type {
  BeforeCloseRequest,
  PlatformLifecycleBridge,
} from "./platformBridge";

describe("platform lifecycle adapter", () => {
  it("subscribes, unsubscribes, and acknowledges through the fixed bridge", () => {
    const subscription: {
      listener?: (request: BeforeCloseRequest) => void;
    } = {};
    const unsubscribe = vi.fn(() => {
      subscription.listener = undefined;
    });
    const acknowledgeBeforeClose = vi.fn();
    const bridge: PlatformLifecycleBridge = {
      acknowledgeBeforeClose,
      onBeforeClose(listener) {
        subscription.listener = listener;
        return unsubscribe;
      },
    };
    const adapter = createLifecycleAdapter(bridge);
    const listener = vi.fn();
    const stopListening = adapter.onBeforeClose(listener);

    const request = { requestId: 7 };
    subscription.listener?.(request);
    expect(listener).toHaveBeenCalledWith(request);
    expect(adapter.acknowledgeBeforeClose(7)).toBe(true);
    expect(acknowledgeBeforeClose).toHaveBeenCalledWith(7);

    stopListening();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(subscription.listener).toBeUndefined();
  });

  it("is a safe no-op when the lifecycle bridge is unavailable", () => {
    const adapter = createLifecycleAdapter(null);
    const stopListening = adapter.onBeforeClose(vi.fn());

    expect(adapter.acknowledgeBeforeClose(1)).toBe(false);
    expect(adapter.acknowledgeBeforeClose(0)).toBe(false);
    expect(stopListening()).toBeUndefined();
  });
});
