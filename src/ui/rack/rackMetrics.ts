export const getSystemStatusTone = (status: string) => {
  if (status === "off") return "off";
  if (status === "booting" || status === "shuttingDown") return "transitioning";
  return "online";
};

export const getRackPipIndexes = (count: number) =>
  Array.from({ length: Math.max(0, count) }, (_, index) => index);

export const getRackCoreGridMetrics = (coreCount: number) => {
  const count = Math.max(1, coreCount);
  const withPackageSize = (
    columns: number,
    size: number,
    gap: number,
    density: string,
  ) => {
    const rows = Math.max(1, Math.ceil(count / columns));
    const gridWidth = columns * size + Math.max(0, columns - 1) * gap;
    const gridHeight = rows * size + Math.max(0, rows - 1) * gap;

    return {
      columns,
      size,
      gap,
      density,
      packageSize: Math.max(gridWidth, gridHeight),
    };
  };

  if (count <= 4) {
    return withPackageSize(2, 16, 4, "normal");
  }

  if (count <= 16) {
    return withPackageSize(4, 10, 2, "compact");
  }

  if (count <= 32) {
    return withPackageSize(6, 7, 1, "dense");
  }

  if (count <= 64) {
    return withPackageSize(8, 3.5, 1, "micro");
  }

  return withPackageSize(12, 3.5, 1, "nano");
};

export const getRackQueueGridMetrics = (slotCount: number) => {
  const count = Math.max(1, slotCount);

  if (count <= 2) {
    return { columns: 2, size: 24, gap: 5, density: "normal" };
  }

  if (count <= 4) {
    return { columns: 2, size: 22, gap: 4, density: "normal" };
  }

  if (count <= 16) {
    return { columns: 4, size: 13, gap: 2, density: "compact" };
  }

  if (count <= 32) {
    return { columns: 4, size: 11, gap: 2, density: "micro" };
  }

  if (count <= 64) {
    return { columns: 4, size: 7, gap: 1, density: "micro" };
  }

  return { columns: 8, size: 5, gap: 1, density: "nano" };
};
