export const getStressTone = (ratio: number | null) => {
  if (ratio === null) return "neutral";
  if (ratio >= 1) return "critical";
  if (ratio >= 0.78) return "warn";
  return "good";
};
