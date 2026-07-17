import { amount, exactCost } from "./amount";
import { capacityCosts } from "./exactCosts";
import type {
  CapacityProfile,
  NetworkSkuDefinition,
  NetworkSkuId,
  ServerSkuDefinition,
  ServerSkuId,
  StorageSkuDefinition,
  StorageSkuId,
} from "./infrastructureTypes";

type AmountValue = Parameters<typeof amount>[0];

const profile = (input: {
  compute?: AmountValue;
  storageRead?: AmountValue;
  storageWrite?: AmountValue;
  networkIngress?: AmountValue;
  networkEgress?: AmountValue;
  memoryBits?: AmountValue;
  storageBits?: AmountValue;
  idleWatts?: AmountValue;
  peakWatts?: AmountValue;
}): CapacityProfile => ({
  rates: {
    compute: amount(input.compute ?? 0),
    storageRead: amount(input.storageRead ?? 0),
    storageWrite: amount(input.storageWrite ?? 0),
    networkIngress: amount(input.networkIngress ?? 0),
    networkEgress: amount(input.networkEgress ?? 0),
  },
  memoryBits: amount(input.memoryBits ?? 0),
  storageBits: amount(input.storageBits ?? 0),
  idleWatts: amount(input.idleWatts ?? 0),
  peakWatts: amount(input.peakWatts ?? input.idleWatts ?? 0),
});

export const serverSkuDefinitions: readonly ServerSkuDefinition[] = [
  {
    id: "starterServer",
    name: "Starter Server",
    description: "A one-cycle reference server matching the opening inspected node.",
    profile: profile({ compute: 1, idleWatts: "0.0000001", peakWatts: "0.0000002" }),
    costs: [exactCost("credits", 50), exactCost("data", 5)],
    defaultStorageSkuId: "storageNone",
    defaultNetworkSkuId: "networkNone",
  },
  {
    id: "workshopServer",
    name: "Workshop Server",
    description: "General-purpose Fleet capacity for maintained local batches.",
    profile: profile({
      compute: "1000000",
      memoryBits: "68719476736",
      idleWatts: 45,
      peakWatts: 120,
    }),
    costs: capacityCosts("250000"),
    defaultStorageSkuId: "localSsd",
    defaultNetworkSkuId: "gigabitNic",
  },
  {
    id: "denseServer",
    name: "Dense Server",
    description: "High-density aggregate compute for cluster-scale work.",
    profile: profile({
      compute: "1000000000000",
      memoryBits: "8796093022208",
      idleWatts: 380,
      peakWatts: 900,
    }),
    costs: capacityCosts("700000"),
    defaultStorageSkuId: "nvmeArray",
    defaultNetworkSkuId: "fabricNic",
  },
] as const;

export const storageSkuDefinitions: readonly StorageSkuDefinition[] = [
  {
    id: "storageNone",
    name: "No Managed Storage",
    description: "Compute-only capacity without managed persistent storage.",
    profile: profile({}),
    costs: [],
  },
  {
    id: "localSsd",
    name: "Local SSD",
    description: "Local persistent storage for workshop workloads.",
    profile: profile({
      storageRead: "4000000000",
      storageWrite: "2000000000",
      storageBits: "8000000000000",
      idleWatts: 2,
      peakWatts: 8,
    }),
    costs: capacityCosts("30000"),
  },
  {
    id: "nvmeArray",
    name: "NVMe Array",
    description: "Striped storage capacity for dense server batches.",
    profile: profile({
      storageRead: "80000000000",
      storageWrite: "40000000000",
      storageBits: "128000000000000",
      idleWatts: 18,
      peakWatts: 70,
    }),
    costs: capacityCosts("200000"),
  },
] as const;

export const networkSkuDefinitions: readonly NetworkSkuDefinition[] = [
  {
    id: "networkNone",
    name: "No Managed Network",
    description: "Node-local capacity only.",
    profile: profile({}),
    costs: [],
  },
  {
    id: "gigabitNic",
    name: "Gigabit NIC",
    description: "Basic ingress and egress for Fleet coordination.",
    profile: profile({
      networkIngress: "1000000000",
      networkEgress: "1000000000",
      idleWatts: 1,
      peakWatts: 4,
    }),
    costs: [exactCost("credits", "12000")],
  },
  {
    id: "fabricNic",
    name: "Fabric NIC",
    description: "High-throughput links for clustered work.",
    profile: profile({
      networkIngress: "100000000000",
      networkEgress: "100000000000",
      idleWatts: 12,
      peakWatts: 45,
    }),
    costs: [exactCost("credits", "100000"), exactCost("data", "100")],
  },
] as const;

const serverById = new Map(serverSkuDefinitions.map((definition) => [definition.id, definition]));
const storageById = new Map(storageSkuDefinitions.map((definition) => [definition.id, definition]));
const networkById = new Map(networkSkuDefinitions.map((definition) => [definition.id, definition]));

export const isServerSkuId = (value: unknown): value is ServerSkuId =>
  typeof value === "string" && serverById.has(value as ServerSkuId);

export const isStorageSkuId = (value: unknown): value is StorageSkuId =>
  typeof value === "string" && storageById.has(value as StorageSkuId);

export const isNetworkSkuId = (value: unknown): value is NetworkSkuId =>
  typeof value === "string" && networkById.has(value as NetworkSkuId);

export const getServerSkuDefinition = (id: ServerSkuId) => serverById.get(id)!;
export const getStorageSkuDefinition = (id: StorageSkuId) => storageById.get(id)!;
export const getNetworkSkuDefinition = (id: NetworkSkuId) => networkById.get(id)!;
