import {
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type PointerEvent,
  type ReactNode,
} from "react";

const DEFAULT_HOLD_REPEAT_MS = 110;
const DEFAULT_HOLD_REPEAT_MAX_MS = 30_000;

type PressRepeatButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  | "children"
  | "onBlur"
  | "onClick"
  | "onLostPointerCapture"
  | "onMouseLeave"
  | "onMouseUp"
  | "onPointerCancel"
  | "onPointerDown"
  | "onPointerUp"
> & {
  children: ReactNode;
  onPress: () => void;
  repeatMs?: number;
  maxHoldMs?: number;
};

export function PressRepeatButton({
  children,
  disabled = false,
  repeatMs = DEFAULT_HOLD_REPEAT_MS,
  maxHoldMs = DEFAULT_HOLD_REPEAT_MAX_MS,
  onPress,
  type = "button",
  ...props
}: PressRepeatButtonProps) {
  const disabledRef = useRef(Boolean(disabled));
  const intervalRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const releaseCleanupRef = useRef<(() => void) | null>(null);
  const onPressRef = useRef(onPress);
  const suppressClickRef = useRef(false);

  const clearRepeatTimers = () => {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };
  const removeReleaseListeners = () => {
    releaseCleanupRef.current?.();
    releaseCleanupRef.current = null;
  };
  const stopRepeat = () => {
    clearRepeatTimers();
    removeReleaseListeners();
  };
  const clearSuppressedClickSoon = () => {
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  };
  const finishPointerHold = () => {
    stopRepeat();
    clearSuppressedClickSoon();
  };

  const press = () => {
    if (disabledRef.current) {
      stopRepeat();
      return;
    }

    onPressRef.current();
  };

  useEffect(() => {
    onPressRef.current = onPress;
  }, [onPress]);

  useEffect(() => {
    disabledRef.current = Boolean(disabled);
    if (disabled) {
      stopRepeat();
      clearSuppressedClickSoon();
    }
  }, [disabled]);

  useEffect(() => () => stopRepeat(), []);

  const bindReleaseListeners = (element: HTMLButtonElement) => {
    removeReleaseListeners();

    const ownerWindow = element.ownerDocument.defaultView ?? window;
    const release = () => finishPointerHold();
    const releaseEvents = [
      "pointerup",
      "pointercancel",
      "mouseup",
      "touchend",
      "touchcancel",
    ] as const;

    releaseEvents.forEach((eventName) =>
      ownerWindow.addEventListener(eventName, release, { passive: true }),
    );

    releaseCleanupRef.current = () => {
      releaseEvents.forEach((eventName) =>
        ownerWindow.removeEventListener(eventName, release),
      );
    };
  };

  const releasePointer = (event: PointerEvent<HTMLButtonElement>) => {
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture is not available in every test/browser path.
    }
  };

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (disabledRef.current || event.button !== 0) return;

    suppressClickRef.current = true;

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is only an enhancement; repeat still works without it.
    }

    press();
    stopRepeat();
    bindReleaseListeners(event.currentTarget);
    intervalRef.current = window.setInterval(
      press,
      Math.max(1, repeatMs),
    );
    timeoutRef.current = window.setTimeout(
      clearRepeatTimers,
      Math.max(1, maxHoldMs),
    );
  };

  const handlePointerEnd = (event: PointerEvent<HTMLButtonElement>) => {
    finishPointerHold();
    releasePointer(event);
  };

  const handlePointerCancel = (event: PointerEvent<HTMLButtonElement>) => {
    stopRepeat();
    suppressClickRef.current = false;
    releasePointer(event);
  };

  const handleClick = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }

    press();
  };

  const handleMouseEnd = () => {
    finishPointerHold();
  };

  const handleBlur = () => {
    stopRepeat();
    suppressClickRef.current = false;
  };

  return (
    <button
      {...props}
      type={type}
      disabled={disabled}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={stopRepeat}
      onMouseUp={handleMouseEnd}
      onMouseLeave={handleMouseEnd}
      onBlur={handleBlur}
      onClick={handleClick}
    >
      {children}
    </button>
  );
}
