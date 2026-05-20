import type { VisibleCpuSocket } from "../../game";
import { getSocketCoreLabel, getSocketForCore } from "../panels/cpuLabels";

export const getCoreTargetLabel = (
  sockets: VisibleCpuSocket[],
  coreId: number,
  includeSocket = sockets.length > 1,
) => {
  const socket = getSocketForCore(sockets, coreId);
  if (!socket) return `C${coreId}`;

  return includeSocket
    ? `${socket.label} ${getSocketCoreLabel(socket, coreId)}`
    : getSocketCoreLabel(socket, coreId);
};
