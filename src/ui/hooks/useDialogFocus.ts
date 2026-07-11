import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const getFocusableElements = (dialog: HTMLElement) =>
  Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) =>
      !element.hidden &&
      element.getAttribute("aria-hidden") !== "true" &&
      element.getAttribute("aria-disabled") !== "true",
  );

interface DialogStackEntry {
  id: symbol;
  dialog: HTMLElement;
}

const dialogStack: DialogStackEntry[] = [];
const handledKeyboardEvents = new WeakSet<KeyboardEvent>();

const getTopDialog = () => dialogStack[dialogStack.length - 1] ?? null;

const focusFirstControl = (dialog: HTMLElement) => {
  const focusable = getFocusableElements(dialog);
  (focusable[0] ?? dialog).focus();
};

export function useDialogFocus<T extends HTMLElement>(onClose: () => void) {
  const dialogRef = useRef<T>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const stackEntry: DialogStackEntry = {
      id: Symbol("dialog"),
      dialog,
    };
    dialogStack.push(stackEntry);
    focusFirstControl(dialog);

    const handleKeyDown = (event: KeyboardEvent) => {
      const currentDialog = dialogRef.current;
      if (
        !currentDialog ||
        handledKeyboardEvents.has(event) ||
        getTopDialog()?.id !== stackEntry.id
      ) {
        return;
      }

      if (event.key === "Escape") {
        handledKeyboardEvents.add(event);
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab") return;

      const currentFocusable = getFocusableElements(currentDialog);
      if (currentFocusable.length === 0) {
        handledKeyboardEvents.add(event);
        event.preventDefault();
        currentDialog.focus();
        return;
      }

      const first = currentFocusable[0]!;
      const last = currentFocusable[currentFocusable.length - 1]!;
      const activeElement = document.activeElement;
      const focusIsInside =
        activeElement instanceof Node && currentDialog.contains(activeElement);

      if (event.shiftKey && (!focusIsInside || activeElement === first)) {
        handledKeyboardEvents.add(event);
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (!focusIsInside || activeElement === last)) {
        handledKeyboardEvents.add(event);
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      const stackIndex = dialogStack.findIndex(
        (entry) => entry.id === stackEntry.id,
      );
      const wasTopDialog =
        stackIndex >= 0 && stackIndex === dialogStack.length - 1;
      if (stackIndex >= 0) dialogStack.splice(stackIndex, 1);

      if (!wasTopDialog) return;

      const nextTopDialog = getTopDialog()?.dialog ?? null;
      if (
        nextTopDialog &&
        previouslyFocused?.isConnected &&
        nextTopDialog.contains(previouslyFocused)
      ) {
        previouslyFocused.focus();
      } else if (nextTopDialog?.isConnected) {
        focusFirstControl(nextTopDialog);
      } else if (previouslyFocused?.isConnected) {
        previouslyFocused.focus();
      }
    };
  }, []);

  return dialogRef;
}
