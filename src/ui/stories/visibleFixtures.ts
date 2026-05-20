import type { VisibleState } from "../../game";
import type { UiRackData, UiRackSystem } from "../rack";
import type { UiActiveTask, UiTask } from "../tasks/taskTypes";

const cpuTasks: UiTask[] = [
  {
    id: "fetchBit",
    name: "Fetch Bit",
    category: "cpu",
    operationCount: 2,
    cacheNeedBits: 1,
    rewardData: 2,
    canStart: true,
    canQueue: true,
  },
  {
    id: "decodeBit",
    name: "Decode Bit",
    category: "cpu",
    operationCount: 6,
    cacheNeedBits: 2,
    rewardData: 6,
    canStart: true,
    canQueue: true,
  },
  {
    id: "packetCheck",
    name: "Packet Check",
    category: "cpu",
    operationCount: 50,
    cacheNeedBits: 2,
    ramNeedBits: 1,
    rewardData: 50,
    rewardCredits: 1,
    canStart: true,
    canQueue: true,
  },
];

const systemTasks: UiTask[] = [
  {
    id: "tinyChecksum",
    name: "Tiny Checksum",
    category: "system",
    operationCount: 80,
    cacheNeedBits: 8,
    ramNeedBits: 64,
    rewardData: 80,
    rewardCredits: 4,
    canStart: true,
    canQueue: true,
  },
  {
    id: "memoryScrub",
    name: "Memory Scrub",
    category: "system",
    operationCount: 160,
    cacheNeedBits: 16,
    ramNeedBits: 128,
    rewardData: 140,
    rewardCredits: 8,
    canStart: true,
    canQueue: true,
  },
];

const packetCheckActiveTask: UiActiveTask = {
  instanceId: "packetCheck-1",
  taskId: "packetCheck",
  name: "Packet Check",
  coreId: 1,
  assignedCoreIds: [1],
  schedulerQueued: true,
  progress: 0.42,
  status: "running",
  memoryState: "ready",
  activeOperationName: "compare packet",
};

const makeCore = (id: number, socketId: number, activeTask?: UiActiveTask | null) => ({
  id,
  socketId,
  label: `Core ${id}`,
  clockHz: 4,
  activeTask: activeTask ?? null,
  deadlocked: false,
  scheduler: {
    localQueue: id === 2 ? ["tinyChecksum"] : [],
  },
});

const makeSocket = (id: number, activeTask?: UiActiveTask | null) => ({
  id,
  label: `CPU ${id}`,
  deadlocked: false,
  schedulerSlots: 2,
  queuedCount: id === 1 ? 1 : 0,
  cacheBits: 128,
  cacheUsedBits: id === 1 ? 24 : 0,
  schedulerConfig: {
    policy: "fifo",
    autoKill: false,
    killPolicy: "deadlockedTask",
  },
  cores: [
    makeCore(id === 1 ? 1 : 3, id, activeTask),
    makeCore(id === 1 ? 2 : 4, id),
  ],
});

export const firstScreenTaskVisible = {
  stageLabel: "Primitive CPU",
  resources: { data: 20_000, credits: 19_995 },
  flags: {
    basicQueue: false,
    scheduler: false,
    systemStats: false,
    secondCpu: false,
  },
  hardware: {
    cores: 1,
    cacheBits: 2,
    cacheBytes: 1,
    ramBits: 0,
    ramBytes: 0,
    secondCpu: false,
    systemSchedulerSlots: 0,
    systemSchedulerConfig: {
      policy: "fifo",
      autoKill: false,
      killPolicy: "deadlockedTask",
    },
    psuWatts: 65,
  },
  metrics: {
    powerState: "on",
    powerUsedWatts: 0.00042,
    powerCostPerSecond: 0,
    powerHeadroomWatts: 64.99958,
    deadlocks: [],
    deadlockPressure: null,
    cpuSockets: [
      {
        ...makeSocket(1),
        schedulerSlots: 0,
        queuedCount: 0,
        cores: [makeCore(1, 1)],
      },
    ],
    ramSlots: [],
    ramUsedBits: 0,
    ramUsedBytes: 0,
  },
  tasks: cpuTasks.slice(0, 2),
  research: [],
  activeTasks: [],
  queue: [],
  upgrades: [],
  cron: {},
} as unknown as VisibleState;

export const rackReadyTaskVisible = {
  ...firstScreenTaskVisible,
  stageLabel: "Rack",
  flags: {
    basicQueue: true,
    scheduler: true,
    systemStats: true,
    secondCpu: true,
  },
  hardware: {
    cores: 4,
    cacheBits: 128,
    cacheBytes: 16,
    ramBits: 1024,
    ramBytes: 128,
    secondCpu: true,
    systemSchedulerSlots: 2,
    systemSchedulerConfig: {
      policy: "fifo",
      autoKill: false,
      killPolicy: "deadlockedTask",
    },
    psuWatts: 65,
  },
  metrics: {
    powerState: "on",
    powerUsedWatts: 42,
    powerCostPerSecond: 0.25,
    powerHeadroomWatts: 23,
    deadlocks: [],
    deadlockPressure: null,
    cpuSockets: [makeSocket(1, packetCheckActiveTask), makeSocket(2)],
    ramSlots: [
      {
        id: 1,
        level: 1,
        sizeBits: 512,
        sizeBytes: 64,
        usedBits: 256,
        usedBytes: 32,
        speedLevel: 1,
        speedMt: 1,
        capacityUpgrade: null,
        speedUpgrade: null,
      },
      {
        id: 2,
        level: 1,
        sizeBits: 512,
        sizeBytes: 64,
        usedBits: 128,
        usedBytes: 16,
        speedLevel: 1,
        speedMt: 1,
        capacityUpgrade: null,
        speedUpgrade: null,
      },
    ],
    ramUsedBits: 384,
    ramUsedBytes: 48,
  },
  tasks: [...cpuTasks, ...systemTasks],
  activeTasks: [packetCheckActiveTask],
  queue: [
    { id: "tinyChecksum", taskId: "tinyChecksum", name: "Tiny Checksum" },
    { id: "memoryScrub", taskId: "memoryScrub", name: "Memory Scrub" },
  ],
} as unknown as VisibleState;

const makeRackSystem = (
  id: string,
  name: string,
  visible: VisibleState,
  activeTaskCount: number,
  queueCount: number,
): UiRackSystem => ({
  id,
  name,
  role: id === "primary" ? "Primary" : "Node",
  tier: id === "primary" ? "Starter" : "Worker",
  status: "on",
  visible,
  cores: visible.hardware.cores,
  clockHz: 4,
  ramBits: visible.hardware.ramBits,
  ramUsedBits: 384,
  drawWatts: visible.metrics.powerUsedWatts,
  psuCapWatts: visible.hardware.psuWatts ?? 65,
  powerCostPerSecond: visible.metrics.powerCostPerSecond ?? 0,
  activeTaskCount,
  queueCount,
  source: null,
});

export const rackStoryData: UiRackData = {
  systems: [
    makeRackSystem("primary", "Primary", rackReadyTaskVisible, 1, 2),
    makeRackSystem(
      "node-a",
      "Compile Node",
      {
        ...rackReadyTaskVisible,
        metrics: {
          ...rackReadyTaskVisible.metrics,
          powerUsedWatts: 30,
          cpuSockets: [makeSocket(1)],
          ramUsedBits: 128,
          ramUsedBytes: 16,
        },
        activeTasks: [],
        queue: [{ id: "tinyChecksum", taskId: "tinyChecksum", name: "Tiny Checksum" }],
      } as unknown as VisibleState,
      0,
      1,
    ),
  ],
  presets: [
    {
      id: "worker-node",
      name: "Worker Node",
      role: "Node",
      tier: "Starter",
      canBuy: true,
      canAfford: true,
      costs: [{ resource: "credits", amount: 500 }],
    },
  ],
  customBuilder: null,
  showRack: true,
  hasSystemModel: true,
  selectedSystemId: "primary",
};
