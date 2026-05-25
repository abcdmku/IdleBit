import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { Database, RefreshCw, Zap } from "lucide-react";
import type { VisibleState } from "../game";
import { formatResourceAmount } from "./format";
import {
  ResourceAmount,
  type ResourceKind,
} from "./ResourceTokens";

type ResourceGainKind = ResourceKind;

interface ResourceGainBurst {
  id: number;
  kind: ResourceGainKind;
  amount: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

const RESOURCE_GAIN_ANIMATION_MS = 1080;
const MAX_RESOURCE_GAIN_BURSTS = 10;
const RESOURCE_GAIN_EPSILON = 0.0001;

const createResourceGainBurst = (
  id: number,
  kind: ResourceGainKind,
  amount: number,
  targetElement: HTMLElement | null,
): ResourceGainBurst => {
  const targetRect = targetElement?.getBoundingClientRect();
  const fallbackX = window.innerWidth - (kind === "data" ? 104 : 190);
  const target = {
    x: targetRect ? targetRect.left + targetRect.width * 0.5 : fallbackX,
    y: targetRect ? targetRect.bottom + 14 : 42,
  };
  const startY = target.y + 36;

  return {
    id,
    kind,
    amount,
    startX: target.x,
    startY,
    endX: target.x,
    endY: target.y,
  };
};

export function ResourceHud({
  visible,
  onReset,
  animateResourceGains,
  onSelectResource,
  onGrantDevResource,
  graphOpen = false,
}: {
  visible: VisibleState;
  onReset: () => void;
  animateResourceGains: boolean;
  onSelectResource?: (resource: ResourceKind) => void;
  onGrantDevResource?: (resource: ResourceKind) => void;
  graphOpen?: boolean;
}) {
  const dataReadoutRef = useRef<HTMLDivElement>(null);
  const creditsReadoutRef = useRef<HTMLDivElement>(null);
  const previousResourcesRef = useRef(visible.resources);
  const resourceEffectsArmedRef = useRef(false);
  const nextBurstIdRef = useRef(0);
  const gainTimeoutsRef = useRef<number[]>([]);
  const [gainBursts, setGainBursts] = useState<ResourceGainBurst[]>([]);
  const resourceInteractive = Boolean(onSelectResource);

  const handleResourceClick =
    (resource: ResourceKind) => (event: MouseEvent<HTMLDivElement>) => {
      if (event.shiftKey && onGrantDevResource) {
        event.preventDefault();
        onGrantDevResource(resource);
        return;
      }

      onSelectResource?.(resource);
    };

  const handleResourceKeyDown =
    (resource: ResourceKind) => (event: KeyboardEvent<HTMLDivElement>) => {
      if (!onSelectResource) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onSelectResource(resource);
      }
    };

  const resourceTitle = onSelectResource ? "Toggle credits/data graph" : undefined;

  useEffect(
    () => () => {
      gainTimeoutsRef.current.forEach((timeoutId) =>
        window.clearTimeout(timeoutId),
      );
      gainTimeoutsRef.current = [];
    },
    [],
  );

  useEffect(() => {
    const previousResources = previousResourcesRef.current;
    const currentResources = visible.resources;
    previousResourcesRef.current = currentResources;

    if (!animateResourceGains) {
      resourceEffectsArmedRef.current = false;
      return;
    }

    if (!resourceEffectsArmedRef.current) {
      resourceEffectsArmedRef.current = true;
      return;
    }

    const resourceGains = [
      {
        kind: "data" as const,
        amount: currentResources.data - previousResources.data,
        target: dataReadoutRef.current,
      },
      {
        kind: "credits" as const,
        amount: currentResources.credits - previousResources.credits,
        target: creditsReadoutRef.current,
      },
    ].filter((gain) => gain.amount > RESOURCE_GAIN_EPSILON);

    if (resourceGains.length === 0) return;

    const newBursts = resourceGains.map((gain) =>
      createResourceGainBurst(
        nextBurstIdRef.current++,
        gain.kind,
        gain.amount,
        gain.target,
      ),
    );

    setGainBursts((current) =>
      [...current, ...newBursts].slice(-MAX_RESOURCE_GAIN_BURSTS),
    );

    newBursts.forEach((burst) => {
      const timeoutId = window.setTimeout(() => {
        setGainBursts((current) =>
          current.filter((candidate) => candidate.id !== burst.id),
        );
        gainTimeoutsRef.current = gainTimeoutsRef.current.filter(
          (candidate) => candidate !== timeoutId,
        );
      }, RESOURCE_GAIN_ANIMATION_MS);

      gainTimeoutsRef.current.push(timeoutId);
    });
  }, [animateResourceGains, visible.resources.credits, visible.resources.data]);

  return (
    <div className="resource-hud" aria-label="Resources">
      {gainBursts.length > 0 && (
        <div className="resource-gain-layer" aria-hidden="true">
          {gainBursts.map((burst) => (
            <span
              className={`resource-gain-flyout ${burst.kind}`}
              key={burst.id}
              style={
                {
                  "--start-x": `${burst.startX}px`,
                  "--start-y": `${burst.startY}px`,
                  "--end-x": `${burst.endX}px`,
                  "--end-y": `${burst.endY}px`,
                } as CSSProperties
              }
            >
              <ResourceAmount
                resource={burst.kind}
                amount={burst.amount}
                plus
                showLabel={false}
              />
            </span>
          ))}
        </div>
      )}
      <div
        className={`resource-readout credits ${
          resourceInteractive ? "clickable" : ""
        } ${graphOpen ? "active" : ""}`}
        ref={creditsReadoutRef}
        role={resourceInteractive ? "button" : undefined}
        tabIndex={resourceInteractive ? 0 : undefined}
        onClick={resourceInteractive ? handleResourceClick("credits") : undefined}
        onKeyDown={resourceInteractive ? handleResourceKeyDown("credits") : undefined}
        title={resourceTitle}
      >
        <Zap size={13} />
        <strong>
          {formatResourceAmount(Math.floor(visible.resources.credits))}
        </strong>
        <span>cr</span>
      </div>
      <div
        className={`resource-readout data ${
          resourceInteractive ? "clickable" : ""
        } ${graphOpen ? "active" : ""}`}
        ref={dataReadoutRef}
        role={resourceInteractive ? "button" : undefined}
        tabIndex={resourceInteractive ? 0 : undefined}
        onClick={resourceInteractive ? handleResourceClick("data") : undefined}
        onKeyDown={resourceInteractive ? handleResourceKeyDown("data") : undefined}
        title={resourceTitle}
      >
        <Database size={13} />
        <strong>{formatResourceAmount(Math.floor(visible.resources.data))}</strong>
        <span>data</span>
      </div>
      <button
        type="button"
        className="dev-reset-button"
        onClick={onReset}
        title="Reset dev save"
        aria-label="Reset dev save"
      >
        <RefreshCw size={13} />
      </button>
    </div>
  );
}
