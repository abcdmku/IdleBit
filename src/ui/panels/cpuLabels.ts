import type { VisibleCpuSocket } from "../../game";

const getSocketCoreNumber = (socket: VisibleCpuSocket, coreId: number) => {
  const index = socket.cores.findIndex((core) => core.id === coreId);
  return index >= 0 ? index + 1 : coreId;
};

export const getSocketCoreLabel = (socket: VisibleCpuSocket, coreId: number) =>
  `C${getSocketCoreNumber(socket, coreId)}`;

export const getSocketForCore = (sockets: VisibleCpuSocket[], coreId: number) =>
  sockets.find((socket) => socket.cores.some((core) => core.id === coreId)) ?? null;
