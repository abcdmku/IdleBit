import { describe, expect, it } from "vitest";
import { getTaskDefinition, taskDefinitions } from "./tasks";

describe("task content sheet", () => {
  // C-SIM-1 / F-ECO-2: runtime executes every composition child as a fresh
  // ActiveTask with empty ramBlocks, so a child's standalone work volume IS
  // the work the hardware physically performs. The composed task's paid work
  // must equal that volume exactly (paid units == executed units).
  it("pays composed tasks exactly the work their runtime children execute", () => {
    for (const task of taskDefinitions) {
      if (!task.composition || task.composition.length === 0) continue;

      const executedUnits = task.composition.reduce((total, entry) => {
        const child = getTaskDefinition(entry.taskId);
        const scale =
          entry.mode === "perWorkUnit" ? (task.workUnitCount ?? 1) : 1;
        return total + child.paidWorkUnits * scale;
      }, 0);

      expect(
        { taskId: task.id, paidWorkUnits: task.paidWorkUnits },
      ).toEqual({ taskId: task.id, paidWorkUnits: executedUnits });
    }
  });

  it("derives Tiny Checksum payout from one RAM staging per child", () => {
    const task = getTaskDefinition("tinyChecksum");
    const stage = getTaskDefinition("stageChecksumPage");
    const step = getTaskDefinition("checksumStep");
    const ramLoadNodes = task.dagNodes.filter((node) => node.kind === "ramLoad");

    // The checksum child re-stages the full 256-bit page because residency
    // does not survive the child boundary at runtime (C-SIM-1 / F-ECO-2).
    expect(ramLoadNodes.map((node) => node.operationCount)).toEqual([256, 256]);
    expect(task.paidWorkUnits).toBe(stage.paidWorkUnits + step.paidWorkUnits);
    expect(task.paidWorkUnits).toBe(580);
    expect(task.rewardCredits).toBe(task.paidWorkUnits);
  });

  // C-DES-3: Tiny Checksum is a system task and stays locked until System
  // Scheduler research, so its first-completion Data cannot fund that
  // research. The 8 Data is re-homed onto the pre-Scheduler RAM page jobs.
  it("re-homes Tiny Checksum funding Data onto pre-Scheduler CPU jobs", () => {
    expect(getTaskDefinition("tinyChecksum").rewardData).toBe(0);
    expect(getTaskDefinition("readRamPage").rewardData).toBe(6);
    expect(getTaskDefinition("writeRamPage").rewardData).toBe(6);
    expect(getTaskDefinition("overwriteRamPage").rewardData).toBe(5);

    // Conservation: 6 + 6 + 5 + 0 keeps the original 3 + 3 + 3 + 8 total.
    const total = (["tinyChecksum", "readRamPage", "writeRamPage", "overwriteRamPage"] as const)
      .reduce((sum, taskId) => sum + getTaskDefinition(taskId).rewardData, 0);
    expect(total).toBe(17);

    // The funding jobs must be CPU-category (dispatchable pre-Scheduler).
    for (const taskId of ["readRamPage", "writeRamPage", "overwriteRamPage"] as const) {
      expect(getTaskDefinition(taskId).category).toBe("cpu");
    }
    expect(getTaskDefinition("tinyChecksum").category).toBe("system");
  });
});
