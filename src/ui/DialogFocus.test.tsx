import { useState } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CreditFailurePopup, PsuFailureModal } from "./FailureNotices";
import { useDialogFocus } from "./hooks/useDialogFocus";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

function DialogHarness() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className="dialog-trigger" onClick={() => setOpen(true)}>
        Open notice
      </button>
      {open && <PsuFailureModal onDismiss={() => setOpen(false)} />}
    </>
  );
}

function StackDialog({
  name,
  onClose,
  onOpenNested,
}: {
  name: "outer" | "inner";
  onClose: () => void;
  onOpenNested?: () => void;
}) {
  const dialogRef = useDialogFocus<HTMLDivElement>(onClose);

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${name} dialog`}
      tabIndex={-1}
      className={`${name}-dialog`}
    >
      <button type="button" className={`${name}-first`}>
        First
      </button>
      {onOpenNested && (
        <button
          type="button"
          className={`${name}-open-nested`}
          onClick={onOpenNested}
        >
          Open nested
        </button>
      )}
      <button type="button" className={`${name}-last`} onClick={onClose}>
        Last
      </button>
    </div>
  );
}

function StackedDialogHarness() {
  const [outerOpen, setOuterOpen] = useState(false);
  const [innerOpen, setInnerOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="stack-trigger"
        onClick={() => setOuterOpen(true)}
      >
        Open outer
      </button>
      {outerOpen && (
        <>
          <StackDialog
            name="outer"
            onClose={() => setOuterOpen(false)}
            onOpenNested={() => setInnerOpen(true)}
          />
          {innerOpen && (
            <StackDialog name="inner" onClose={() => setInnerOpen(false)} />
          )}
        </>
      )}
    </>
  );
}

function RepeatCreditHarness() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="credit-trigger"
        onClick={() => setOpen(true)}
      >
        Open credit notice
      </button>
      <button type="button" className="background-control">
        Background control
      </button>
      {open && (
        <CreditFailurePopup firstTime={false} onDismiss={() => setOpen(false)} />
      )}
    </>
  );
}

const dispatchKey = (key: string, shiftKey = false) =>
  document.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      shiftKey,
      bubbles: true,
      cancelable: true,
    }),
  );

describe("dialog focus management", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = undefined;
  });

  it("focuses the first control, traps Tab, closes on Escape, and restores focus", () => {
    act(() => {
      root.render(<DialogHarness />);
    });

    const trigger = container.querySelector<HTMLButtonElement>(".dialog-trigger")!;
    act(() => {
      trigger.focus();
      trigger.click();
    });

    const close = container.querySelector<HTMLButtonElement>(".psu-failure-close")!;
    const primary = container.querySelector<HTMLButtonElement>(".psu-failure-primary")!;
    expect(document.activeElement).toBe(close);

    act(() => {
      primary.focus();
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(document.activeElement).toBe(close);

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(document.activeElement).toBe(primary);

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(container.querySelector(".psu-failure-modal")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("lets only the topmost stacked dialog trap keys and restore focus", () => {
    act(() => {
      root.render(<StackedDialogHarness />);
    });

    const trigger = container.querySelector<HTMLButtonElement>(".stack-trigger")!;
    act(() => {
      trigger.focus();
      trigger.click();
    });

    const outerFirst = container.querySelector<HTMLButtonElement>(".outer-first")!;
    const openNested = container.querySelector<HTMLButtonElement>(
      ".outer-open-nested",
    )!;
    expect(document.activeElement).toBe(outerFirst);

    act(() => {
      openNested.focus();
      openNested.click();
    });

    const innerFirst = container.querySelector<HTMLButtonElement>(".inner-first")!;
    const innerLast = container.querySelector<HTMLButtonElement>(".inner-last")!;
    expect(document.activeElement).toBe(innerFirst);

    let outerFocusCount = 0;
    outerFirst.addEventListener("focus", () => {
      outerFocusCount += 1;
    });

    act(() => {
      innerLast.focus();
      dispatchKey("Tab");
    });
    expect(document.activeElement).toBe(innerFirst);
    expect(outerFocusCount).toBe(0);

    act(() => {
      dispatchKey("Tab", true);
    });
    expect(document.activeElement).toBe(innerLast);
    expect(outerFocusCount).toBe(0);

    act(() => {
      dispatchKey("Escape");
    });
    expect(container.querySelector(".inner-dialog")).toBeNull();
    expect(container.querySelector(".outer-dialog")).not.toBeNull();
    expect(document.activeElement).toBe(openNested);

    act(() => {
      dispatchKey("Escape");
    });
    expect(container.querySelector(".outer-dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("treats repeat credit failures as blocking modals for pointer and keyboard", () => {
    act(() => {
      root.render(<RepeatCreditHarness />);
    });

    const trigger = container.querySelector<HTMLButtonElement>(".credit-trigger")!;
    act(() => {
      trigger.focus();
      trigger.click();
    });

    let overlay = container.querySelector<HTMLElement>(
      ".credit-failure-repeat-overlay",
    )!;
    let dialog = overlay.querySelector<HTMLElement>(
      ".credit-failure-repeat-modal",
    )!;
    let dismiss = dialog.querySelector<HTMLButtonElement>("button")!;

    expect(overlay.contains(dialog)).toBe(true);
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(dismiss);

    act(() => {
      overlay.click();
    });
    expect(container.querySelector(".credit-failure-repeat-modal")).not.toBeNull();

    act(() => {
      dismiss.click();
    });
    expect(container.querySelector(".credit-failure-repeat-modal")).toBeNull();
    expect(document.activeElement).toBe(trigger);

    act(() => {
      trigger.click();
    });
    overlay = container.querySelector<HTMLElement>(
      ".credit-failure-repeat-overlay",
    )!;
    dialog = overlay.querySelector<HTMLElement>(".credit-failure-repeat-modal")!;
    dismiss = dialog.querySelector<HTMLButtonElement>("button")!;
    expect(document.activeElement).toBe(dismiss);

    act(() => {
      dispatchKey("Escape");
    });
    expect(container.querySelector(".credit-failure-repeat-modal")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
