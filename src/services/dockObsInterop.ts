import { dockObsClient } from "../dock/dockObsClient";
import { getSettings } from "../multiview/mvStore";
import { initOverlayUrl } from "./overlayUrl";
import { loadData } from "./store";

let connectPromise: Promise<void> | null = null;

export async function ensureDockObsClientConnected(): Promise<void> {
  await initOverlayUrl();
  if (dockObsClient.isConnected) return;
  if (connectPromise) return connectPromise;

  connectPromise = (async () => {
    let url = "ws://localhost:4455";
    let password: string | undefined;

    try {
      const appData = await loadData();
      if (appData.obsWebSocket?.url) {
        url = appData.obsWebSocket.url;
      }
      if (appData.obsWebSocket?.password) {
        password = appData.obsWebSocket.password;
      }
    } catch {
      // Fall back to MV settings below.
    }

    if (!password) {
      try {
        const settings = getSettings();
        if (settings.obsUrl) {
          url = settings.obsUrl;
        }
        if (settings.obsPassword) {
          password = settings.obsPassword;
        }
      } catch {
        // Fall back to localhost with no password.
      }
    }

    await dockObsClient.connect(url, password);
    if (!dockObsClient.isConnected) {
      throw new Error(dockObsClient.error || "Failed to connect dock OBS client.");
    }
  })().finally(() => {
    connectPromise = null;
  });

  return connectPromise;
}
