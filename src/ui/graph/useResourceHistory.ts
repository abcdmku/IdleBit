import { useEffect, useRef } from "react";

export interface ResourceSample {
  t: number;
  credits: number;
  data: number;
}

const SAMPLE_INTERVAL_MS = 1000;
const MAX_WINDOW_SEC = 24 * 60 * 60;
const MAX_SAMPLES = MAX_WINDOW_SEC + 60;

export interface ResourceHistoryRef {
  samples: ResourceSample[];
}

export function useResourceHistory(
  credits: number,
  data: number,
): ResourceHistoryRef {
  const historyRef = useRef<ResourceHistoryRef>({ samples: [] });
  const latestRef = useRef({ credits, data });
  latestRef.current = { credits, data };

  useEffect(() => {
    const push = () => {
      const buffer = historyRef.current.samples;
      const sample: ResourceSample = {
        t: Date.now(),
        credits: latestRef.current.credits,
        data: latestRef.current.data,
      };
      buffer.push(sample);
      if (buffer.length > MAX_SAMPLES) {
        buffer.splice(0, buffer.length - MAX_SAMPLES);
      }
    };

    push();
    const id = window.setInterval(push, SAMPLE_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, []);

  return historyRef.current;
}
