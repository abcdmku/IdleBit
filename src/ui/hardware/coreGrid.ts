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
    rows = 3;
    columns = 4;
  } else if (count <= 16) {
    rows = 4;
    columns = 4;
  } else if (count <= 24) {
    rows = Math.ceil(count / 8);
    columns = 8;
  } else if (count <= 32) {
    rows = Math.ceil(count / 8);
    columns = 8;
  } else {
    rows = Math.ceil(count / 8);
    columns = 8;
  }

  const density: CoreGridDensity =
    columns >= 6 ? "dense" : columns >= 4 ? "compact" : "normal";

  return {
    rows,
    columns,
    density,
    label: `${rows}x${columns}`,
    fullWidth: columns >= 6,
  };
};

