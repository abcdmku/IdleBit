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
    return { columns: 2, size: 14, gap: 3, density: "tower" };
  }

  if (count <= 4) {
    return { columns: 2, size: 12, gap: 3, density: "tower" };
  }

  if (count <= 8) {
    return { columns: 2, size: 10, gap: 2, density: "tower" };
  }

  if (count <= 16) {
    return { columns: 4, size: 8, gap: 2, density: "compact" };
  }

  if (count <= 32) {
    return { columns: 6, size: 6, gap: 2, density: "compact" };
  }

  if (count <= 64) {
    return { columns: 8, size: 5, gap: 1, density: "micro" };
  }

  return { columns: 10, size: 4, gap: 1, density: "nano" };
};

export const getRackRamGridMetrics = (slotCount: number) => {
  const count = Math.max(1, slotCount);

  if (count <= 4) {
    return {
      columns: count,
      rows: 1,
      stickWidth: 14,
      stickHeight: 48,
      gap: 6,
      density: "normal",
    };
  }

  if (count <= 16) {
    return {
      columns: count,
      rows: 1,
      stickWidth: 8,
      stickHeight: 48,
      gap: 3,
      density: "compact",
    };
  }

  if (count <= 32) {
    return {
      columns: 16,
      rows: 2,
      stickWidth: 7,
      stickHeight: 22,
      gap: 2,
      density: "dense",
    };
  }

  return {
    columns: 16,
    rows: Math.ceil(count / 16),
    stickWidth: 6,
    stickHeight: 14,
    gap: 1,
    density: "micro",
  };
};
