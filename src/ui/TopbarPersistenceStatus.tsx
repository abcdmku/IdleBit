import { Save, TriangleAlert } from "lucide-react";

export interface PersistenceReadout {
  phase: "hydrating" | "saving" | "saved" | "error";
  message: string;
  lastSavedAtMs: number | null;
  announcement: "polite" | "assertive" | null;
}

export function TopbarPersistenceStatus({
  status,
}: {
  status?: PersistenceReadout;
}) {
  if (!status) return null;

  const visuallyHidden = status.phase === "saved";
  if (visuallyHidden && status.announcement === null) return null;

  return (
    <span
      className={`topbar-persistence ${status.phase}${
        visuallyHidden ? " sr-only" : ""
      }`}
      role={
        status.announcement === "assertive"
          ? "alert"
          : status.announcement === "polite"
            ? "status"
            : undefined
      }
      aria-live={status.announcement ?? undefined}
      aria-atomic={status.announcement === null ? undefined : "true"}
      aria-label={status.message}
      title={visuallyHidden ? undefined : status.message}
    >
      {!visuallyHidden &&
        (status.phase === "error" ? (
          <TriangleAlert size={12} aria-hidden="true" />
        ) : (
          <Save size={12} aria-hidden="true" />
        ))}
      <span className="topbar-persistence-message">{status.message}</span>
    </span>
  );
}
