import type { UiGameAction } from "../uiActions";

export const getSystemScopedAction = (
  action: UiGameAction,
  systemId: string | null,
) => {
  if (!systemId || "systemId" in action) return action;
  const numericId = Number(systemId);
  const actionSystemId =
    Number.isInteger(numericId) && String(numericId) === systemId
      ? numericId
      : systemId;
  return { ...action, systemId: actionSystemId } as UiGameAction;
};
