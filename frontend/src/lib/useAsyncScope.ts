"use client";
import { useCallback, useLayoutEffect, useRef } from "react";

// A changed account, target, access state, or unmount invalidates completions
// even if the transport cannot be cancelled. Each capture belongs to one epoch.
export function useAsyncScope(key: string) {
  const scope = useRef({ epoch: 0, key });
  useLayoutEffect(() => {
    const current = scope.current;
    current.epoch++;
    current.key = key;
    return () => { current.epoch++; };
  }, [key]);
  return useCallback(() => {
    const current = scope.current;
    const start = current.epoch;
    return () => current.epoch === start && current.key === key;
  }, [key]);
}
