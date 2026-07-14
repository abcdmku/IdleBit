import type { VisibleCore } from "../../game";
import { getCoreActiveTask } from "../tasks/taskData";

type CoreOperationProgress = { coreId: number; progress?: number };

/**
 * Every core cell used to `find` its own entry in its task's coreProgress
 * array, which is O(cores^2) per snapshot on wide sockets (C-UI-16). Each
 * coreProgress array is indexed once — keyed by array identity, so a fresh
 * snapshot re-indexes and all cores sharing a task reuse one index — and
 * per-core lookups become O(1). First-match insertion mirrors the previous
 * `find` semantics exactly.
 */
const coreProgressIndexCache = new WeakMap<
  readonly CoreOperationProgress[],
  Map<number, number>
>();

const indexCoreProgress = (operations: readonly CoreOperationProgress[]) => {
  let index = coreProgressIndexCache.get(operations);
  if (!index) {
    index = new Map();
    for (const operation of operations) {
      if (!index.has(operation.coreId)) {
        index.set(operation.coreId, operation.progress ?? 0);
      }
    }
    coreProgressIndexCache.set(operations, index);
  }
  return index;
};

export const getCoreOperationProgress = (core: VisibleCore): number => {
  const operations = getCoreActiveTask(core)?.coreProgress;
  if (!operations || operations.length === 0) return 0;
  return indexCoreProgress(operations).get(core.id) ?? 0;
};
