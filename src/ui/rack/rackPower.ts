export type PowerLifecycleState = "on" | "off" | "booting" | "shuttingDown";

export const normalizePowerState = (
  state: string | null | undefined,
): PowerLifecycleState => {
  const normalized = state?.trim().toLowerCase().replace(/[\s_-]/g, "") ?? "";

  if (normalized.includes("boot") || normalized.includes("poweringon")) {
    return "booting";
  }

  if (
    normalized.includes("shut") ||
    normalized.includes("poweringoff") ||
    normalized.includes("stopping")
  ) {
    return "shuttingDown";
  }

  if (normalized === "off" || normalized === "offline" || normalized === "down") {
    return "off";
  }

  return "on";
};
