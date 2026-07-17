import type { SelectedComponent } from "../workbenchData";

export function getSelectedCoreId(selection: SelectedComponent) {
  if (!selection?.startsWith("core:")) return null;

  const coreId = Number(selection.slice("core:".length));
  return Number.isFinite(coreId) ? coreId : null;
}

export function getSelectedSchedulerId(selection: SelectedComponent) {
  if (!selection?.startsWith("scheduler:")) return null;

  const socketId = Number(selection.slice("scheduler:".length));
  return Number.isFinite(socketId) ? socketId : null;
}

export function getSelectedRamStickId(selection: SelectedComponent) {
  if (!selection?.startsWith("ramStick:")) return null;

  const stickId = Number(selection.slice("ramStick:".length));
  return Number.isFinite(stickId) ? stickId : null;
}

export const isRamSelection = (selection: SelectedComponent) =>
  selection === "ram" ||
  selection === "ramSticks" ||
  Boolean(selection?.startsWith("ramStick:"));
