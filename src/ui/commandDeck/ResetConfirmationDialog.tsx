import { RefreshCw, TriangleAlert } from "lucide-react";
import { useDialogFocus } from "../hooks/useDialogFocus";

export function ResetConfirmationDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const titleId = "reset-save-title";
  const descriptionId = "reset-save-description";
  const dialogRef = useDialogFocus<HTMLElement>(onCancel);

  return (
    <div className="command-dialog-overlay reset-dialog-overlay">
      <section
        ref={dialogRef}
        className="command-dialog reset-confirmation-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
      >
        <header>
          <span id={titleId}>
            <TriangleAlert size={19} aria-hidden="true" />
            Reset save?
          </span>
        </header>
        <p id={descriptionId}>
          This permanently replaces your current progress with a new game.
        </p>
        <div className="command-dialog-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="danger" onClick={onConfirm}>
            <RefreshCw size={14} aria-hidden="true" />
            Reset progress
          </button>
        </div>
      </section>
    </div>
  );
}

