import {
  amountCompare,
  type ExactResourceBag,
} from "../../game";
import { ExactResourceAmount } from "../ResourceTokens";

export function WorkResourceSummary({
  resources,
  label = "Rewards",
}: {
  resources: ExactResourceBag;
  label?: string;
}) {
  const hasCredits = amountCompare(resources.credits, 0) > 0;
  const hasData = amountCompare(resources.data, 0) > 0;

  if (!hasCredits && !hasData) return null;

  return (
    <span className="work-resource-summary" aria-label={label}>
      {hasCredits && (
        <ExactResourceAmount
          resource="credits"
          amount={resources.credits}
          compact
        />
      )}
      {hasData && (
        <ExactResourceAmount resource="data" amount={resources.data} compact />
      )}
    </span>
  );
}
