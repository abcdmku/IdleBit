import { useCallback, useRef } from "react";

/**
 * Returns an identity-stable function that always invokes the latest callback.
 *
 * Hot board components (per-core cells) are wrapped in React.memo; parents
 * naturally pass fresh inline closures every snapshot, which would defeat the
 * memo. Routing the closure through a ref keeps the child prop reference
 * stable while still calling the newest handler.
 */
export function useStableCallback<Args extends unknown[], Result>(
  callback: (...args: Args) => Result,
): (...args: Args) => Result {
  const latest = useRef(callback);
  latest.current = callback;
  return useCallback((...args: Args) => latest.current(...args), []);
}
