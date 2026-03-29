/**
 * useServiceGate.ts — Hook to gate actions behind service start
 *
 * Previously blocked OBS actions when no service was active and
 * prompted users to start a service first.  The "Start Service"
 * concept has been removed — this hook now always returns true
 * so callers don't need to be changed.
 */

import { useCallback } from "react";

export function useServiceGate() {
  /**
   * Always returns true — no service gate is needed any more.
   */
  const checkServiceActive = useCallback((_actionDescription?: string): boolean => {
    return true;
  }, []);

  const closeGate = useCallback(() => {}, []);

  return {
    /** Always false — gate is disabled */
    gateOpen: false as const,
    /** Always undefined */
    gateAction: undefined as string | undefined,
    /** No-op */
    closeGate,
    /** Always returns true */
    checkServiceActive,
  };
}
