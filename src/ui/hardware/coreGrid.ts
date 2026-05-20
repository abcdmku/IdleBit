import type { CoreGridDensity } from "./visibleState";

export const getCoreGridMetrics = (coreCount: number) => {
  const count = Math.max(1, coreCount);
  let rows = 1;
  let columns = 2;

  if (count <= 2) {
    rows = 1;
    columns = 2;
  } else if (count <= 4) {
    rows = 2;
    columns = 2;
  } else if (count <= 8) {
    rows = 2;
    columns = 4;
  } else if (count <= 12) {
    rows = 2;
    columns = 6;
  } else if (count <= 16) {
    rows = 2;
    columns = 8;
  } else if (count <= 24) {
    rows = 2;
    columns = 12;
  } else if (count <= 32) {
    rows = 2;
    columns = 16;
  } else {
    rows = Math.ceil(count / 16);
    columns = 16;
  }

  const density: CoreGridDensity =
    columns >= 12 ? "dense" : columns >= 4 ? "compact" : "normal";

  return {
    rows,
    columns,
    density,
    label: `${rows}x${columns}`,
    fullWidth: columns >= 12,
  };
};

