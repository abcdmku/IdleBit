import { useEffect, useRef, useState } from "react";

interface ScreenWakeLockSentinel extends EventTarget {
  readonly released: boolean;
  release: () => Promise<void>;
}

interface ScreenWakeLockApi {
  request: (type: "screen") => Promise<ScreenWakeLockSentinel>;
}

type WakeLockNavigator = Navigator & {
  wakeLock?: ScreenWakeLockApi;
};

const getScreenWakeLockApi = () =>
  typeof navigator === "undefined"
    ? undefined
    : (navigator as WakeLockNavigator).wakeLock;

export function useScreenWakeLock(enabled: boolean) {
  const sentinelRef = useRef<ScreenWakeLockSentinel | null>(null);
  const [supported] = useState(() => Boolean(getScreenWakeLockApi()));
  const [active, setActive] = useState(false);

  useEffect(() => {
    const releaseCurrent = () => {
      const sentinel = sentinelRef.current;
      sentinelRef.current = null;
      setActive(false);
      if (sentinel && !sentinel.released) void sentinel.release();
    };

    const wakeLock = getScreenWakeLockApi();
    if (!enabled || !wakeLock || typeof document === "undefined") {
      releaseCurrent();
      return undefined;
    }

    let cancelled = false;
    let currentReleaseHandler: (() => void) | null = null;

    const requestWakeLock = async () => {
      if (document.visibilityState !== "visible") return;

      try {
        const sentinel = await wakeLock.request("screen");
        if (cancelled) {
          void sentinel.release();
          return;
        }

        const previous = sentinelRef.current;
        if (previous && previous !== sentinel && !previous.released) {
          void previous.release();
        }

        sentinelRef.current = sentinel;
        setActive(true);
        currentReleaseHandler = () => {
          if (sentinelRef.current === sentinel) {
            sentinelRef.current = null;
            setActive(false);
          }
        };
        sentinel.addEventListener("release", currentReleaseHandler, {
          once: true,
        });
      } catch {
        if (!cancelled) setActive(false);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && !sentinelRef.current) {
        void requestWakeLock();
      }
    };

    void requestWakeLock();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      const sentinel = sentinelRef.current;
      if (sentinel && currentReleaseHandler) {
        sentinel.removeEventListener("release", currentReleaseHandler);
      }
      sentinelRef.current = null;
      if (sentinel && !sentinel.released) void sentinel.release();
    };
  }, [enabled]);

  return { active, supported };
}
