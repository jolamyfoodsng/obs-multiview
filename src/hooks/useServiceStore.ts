/**
 * useServiceStore.ts — React hook for the service store
 */

import { useState, useEffect, useCallback } from "react";
import { serviceStore, type ServiceState, type SceneMapping } from "../services/serviceStore";

export function useServiceStore() {
  const [state, setState] = useState<ServiceState>(serviceStore.getState());

  useEffect(() => {
    const unsub = serviceStore.subscribe(setState);
    return unsub;
  }, []);

  const prepareService = useCallback(
    (name: string, mapping: SceneMapping, layout: "lower-third" | "fullscreen") => {
      serviceStore.prepareService(name, mapping, layout);
    },
    []
  );

  const startPreService = useCallback(() => serviceStore.startPreService(), []);
  const goLive = useCallback(() => serviceStore.goLive(), []);
  const endService = useCallback(() => serviceStore.endService(), []);
  const reset = useCallback(() => serviceStore.reset(), []);

  return {
    ...state,
    prepareService,
    startPreService,
    goLive,
    endService,
    reset,
    getFormattedDuration: () => serviceStore.getFormattedDuration(),
  };
}
