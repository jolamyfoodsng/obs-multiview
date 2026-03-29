/**
 * BibleShell.tsx — Shell wrapper for the Bible module
 *
 * No tab navigation — the BibleHome page is the unified control room.
 * Routes: /bible (home), /bible/templates (theme editor), /bible/live (fullscreen controller)
 */

import { Outlet, useLocation } from "react-router-dom";
import { BibleProvider } from "../bibleStore";

export default function BibleShell() {
  const location = useLocation();
  const isLiveRoute = location.pathname === "/bible/live";

  return (
    <BibleProvider>
      <div className={`bible-shell ${isLiveRoute ? "fullscreen" : ""}`}>
        <div className="bible-shell-content">
          <Outlet />
        </div>
      </div>
    </BibleProvider>
  );
}
