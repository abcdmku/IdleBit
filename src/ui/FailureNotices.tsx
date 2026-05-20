import { Check, TriangleAlert, X } from "lucide-react";

export function PsuFailureModal({ onDismiss }: { onDismiss: () => void }) {
  const titleId = "psu-failure-title";
  const bodyId = "psu-failure-body";

  return (
    <div className="psu-failure-overlay">
      <section
        className="psu-failure-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
      >
        <div className="psu-failure-header">
          <span id={titleId}>
            <TriangleAlert size={20} />
            PSU failure
          </span>
          <button
            type="button"
            className="psu-failure-close"
            onClick={onDismiss}
            aria-label="Close PSU failure notice"
          >
            <X size={17} />
          </button>
        </div>

        <p id={bodyId}>
          Draw stayed above the PSU rating until overload protection tripped.
          The system shut off and cleared active and queued work. Increase PSU
          capacity or reduce load before rebooting.
        </p>

        <button type="button" className="psu-failure-primary" onClick={onDismiss}>
          Understood
          <Check size={15} />
        </button>
      </section>
    </div>
  );
}

export function CreditFailurePopup({
  firstTime,
  onDismiss,
}: {
  firstTime: boolean;
  onDismiss: () => void;
}) {
  const titleId = "credit-failure-title";
  const bodyId = "credit-failure-body";

  if (!firstTime) {
    return (
      <aside
        className="credit-failure-toast"
        role="dialog"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
      >
        <span id={titleId}>
          <TriangleAlert size={16} />
          Out of credits
        </span>
        <p id={bodyId}>
          The power bill drained your balance. Reboot for a brief grace period
          before billing resumes.
        </p>
        <button type="button" onClick={onDismiss}>
          Got it
        </button>
      </aside>
    );
  }

  return (
    <div className="credit-failure-overlay">
      <section
        className="credit-failure-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
      >
        <div className="credit-failure-header">
          <span id={titleId}>
            <TriangleAlert size={20} />
            Out of credits
          </span>
          <button
            type="button"
            className="credit-failure-close"
            onClick={onDismiss}
            aria-label="Close credit failure notice"
          >
            <X size={17} />
          </button>
        </div>

        <p id={bodyId}>
          The power bill drained your credits, so the PSU shut down before the
          balance could go negative - even idle hardware draws cr/s. Reboot
          for a brief grace period before billing resumes. Use it to earn
          credits, lower your draw, or power off when idle to avoid another
          cutoff.
        </p>

        <button
          type="button"
          className="credit-failure-primary"
          onClick={onDismiss}
        >
          Understood
          <Check size={15} />
        </button>
      </section>
    </div>
  );
}
