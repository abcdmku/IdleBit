import {
  advanceGame,
  type AdvanceResult,
  type GameState,
} from "../game";
import {
  OFFLINE_ADVANCE_WORKER_CHANNEL,
  serializeOfflineAdvanceError,
  type OfflineAdvanceWorkerRequest,
  type OfflineAdvanceWorkerResponse,
} from "./offlineAdvance";

export interface GameOfflineAdvanceRequest {
  state: GameState;
  elapsedMs: number;
  mode: "offline";
}

export type GameOfflineAdvanceFunction = (
  state: GameState,
  elapsedMs: number,
  mode: "offline",
) => AdvanceResult;

export type GameOfflineAdvanceWorkerMessage = OfflineAdvanceWorkerRequest<
  GameOfflineAdvanceRequest
>;

export type GameOfflineAdvanceWorkerResponse =
  OfflineAdvanceWorkerResponse<AdvanceResult>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isGameOfflineAdvanceRequest(
  value: unknown,
): value is GameOfflineAdvanceRequest {
  return Boolean(
    isRecord(value) &&
      isRecord(value.state) &&
      typeof value.elapsedMs === "number" &&
      value.mode === "offline",
  );
}

function getWorkerRequestEnvelope(
  message: unknown,
): Pick<GameOfflineAdvanceWorkerMessage, "requestId"> & { request: unknown } | null {
  if (
    !isRecord(message) ||
    message.channel !== OFFLINE_ADVANCE_WORKER_CHANNEL ||
    message.kind !== "request" ||
    typeof message.requestId !== "number"
  ) {
    return null;
  }

  return {
    request: message.request,
    requestId: message.requestId,
  };
}

export function runGameOfflineAdvance(
  request: GameOfflineAdvanceRequest,
  advance: GameOfflineAdvanceFunction = advanceGame,
): AdvanceResult {
  if (!isGameOfflineAdvanceRequest(request)) {
    throw new TypeError("Invalid game offline advance request.");
  }

  return advance(request.state, request.elapsedMs, "offline");
}

export function handleGameOfflineAdvanceWorkerMessage(
  message: unknown,
  postMessage: (response: GameOfflineAdvanceWorkerResponse) => void,
  advance: GameOfflineAdvanceFunction = advanceGame,
): boolean {
  const envelope = getWorkerRequestEnvelope(message);
  if (!envelope) {
    return false;
  }

  try {
    const result = runGameOfflineAdvance(
      envelope.request as GameOfflineAdvanceRequest,
      advance,
    );
    postMessage({
      channel: OFFLINE_ADVANCE_WORKER_CHANNEL,
      kind: "success",
      requestId: envelope.requestId,
      result,
    });
  } catch (error) {
    postMessage({
      channel: OFFLINE_ADVANCE_WORKER_CHANNEL,
      error: serializeOfflineAdvanceError(error),
      kind: "failure",
      requestId: envelope.requestId,
    });
  }

  return true;
}
