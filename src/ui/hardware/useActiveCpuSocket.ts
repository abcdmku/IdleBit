import { useEffect, useState } from "react";
import type { VisibleCpuSocket } from "../../game";

export const useActiveCpuSocket = (
  sockets: VisibleCpuSocket[],
  selectedSchedulerId: number | null,
  selectedCoreId: number | null,
) => {
  const [activeSocketId, setActiveSocketId] = useState<number>(
    sockets[0]?.id ?? 1,
  );

  const socketIdsKey = sockets.map((socket) => socket.id).join(",");
  const coreToSocketKey = sockets
    .map((socket) => `${socket.id}:${socket.cores.map((core) => core.id).join("-")}`)
    .join("|");

  useEffect(() => {
    const idList = socketIdsKey ? socketIdsKey.split(",").map(Number) : [];
    if (idList.length === 0) return;
    if (!idList.includes(activeSocketId)) {
      setActiveSocketId(idList[0] ?? 1);
    }
  }, [socketIdsKey, activeSocketId]);

  useEffect(() => {
    if (selectedSchedulerId !== null) {
      setActiveSocketId(selectedSchedulerId);
      return;
    }
    if (selectedCoreId === null) return;
    const owner = coreToSocketKey
      .split("|")
      .map((chunk) => {
        const [socketIdStr, coresStr] = chunk.split(":");
        return {
          id: Number(socketIdStr),
          coreIds: coresStr ? coresStr.split("-").map(Number) : [],
        };
      })
      .find((entry) => entry.coreIds.includes(selectedCoreId));
    if (owner) setActiveSocketId(owner.id);
  }, [selectedSchedulerId, selectedCoreId, coreToSocketKey]);

  return { activeSocketId, setActiveSocketId };
};
