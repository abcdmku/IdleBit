import { describe, expect, it } from "vitest";
import { amountCompare, amountMultiply, sumAmounts } from "./amount";
import { contractTemplateDefinitions } from "./contracts";
import { researchDefinitions } from "./content/research";
import { createInitialGameState } from "./progression";

describe("contract offer pool", () => {
  // C-DES-4: by the time System Catalog (18 Data) gates progression, the
  // randomized initial offer pool is Ledger Audit + Queue Recovery + Compile
  // Batch. Even at the minimum 0.85 value roll their combined novel Data must
  // cover the gate, or an unlucky pool soft-blocks the chapter.
  it("guarantees the minimum initial pool funds System Catalog", () => {
    const initialPool = contractTemplateDefinitions.filter((template) =>
      ["bootstrapNode", "coherentMachine"].includes(template.requiredChapter),
    );

    expect(initialPool.map((template) => template.id)).toEqual([
      "ledgerAudit",
      "queueRecovery",
      "compileBatch",
    ]);

    const systemCatalog = researchDefinitions.find(
      (definition) => definition.id === "systemCatalog",
    );
    const gate = systemCatalog
      ?.cost(createInitialGameState())
      .find((cost) => cost.resource === "data");
    expect(gate?.amount).toBe("18");

    const baseTotal = sumAmounts(
      initialPool.map((template) => template.baseDataReward),
    );
    // Offers roll value in [85, 125]; novel Data scales by valueRoll / 100.
    const worstCaseTotal = amountMultiply(baseTotal, "0.85");
    expect(amountCompare(worstCaseTotal, gate?.amount ?? "0")).toBeGreaterThanOrEqual(0);
  });
});
