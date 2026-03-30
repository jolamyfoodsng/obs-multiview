import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import { LayoutStoreProvider } from "./hooks/useLayoutStore";
import { initOverlayUrl } from "./services/overlayUrl";

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
void initOverlayUrl();

// OBS Browser Dock uses a real pathname (/dock), not a hash route.
// Intercept before HashRouter mounts so the dock page works standalone.
if (window.location.pathname === "/dock" || window.location.pathname === "/dock/") {
  // Initialize BroadcastChannel before React renders
  import("./services/dockBridge").then(({ dockClient }) => dockClient.init());
  import("./dock/DockPage").then(({ default: DockPage }) => {
    // Import dock CSS
    import("./dock/dock.css");
    root.render(
      <React.StrictMode>
        <DockPage />
      </React.StrictMode>
    );
  });
} else {
  root.render(
    <React.StrictMode>
      <HashRouter>
        <LayoutStoreProvider>
          <App />
        </LayoutStoreProvider>
      </HashRouter>
    </React.StrictMode>
  );
}
