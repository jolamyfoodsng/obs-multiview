import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Icon from "../components/Icon";
import { obsService } from "../services/obsService";
import { getOverlayBaseUrlSync } from "../services/overlayUrl";

function getDockUrl(): string {
  const isDev = window.location.protocol === "http:" && window.location.port === "1420";
  const base = isDev ? window.location.origin : getOverlayBaseUrlSync();
  return isDev ? `${base}/dock` : `${base}/dock.html`;
}

export default function ProductionHomePage() {
  const [obsConnected, setObsConnected] = useState(() => obsService.isConnected);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    return obsService.onStatusChange((status) => {
      setObsConnected(status === "connected");
    });
  }, []);

  const dockUrl = useMemo(() => getDockUrl(), []);

  const handleCopyDockUrl = useCallback(() => {
    navigator.clipboard.writeText(dockUrl).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      setCopied(false);
    });
  }, [dockUrl]);

  return (
    <div className="production-page">
      <section className="production-hero">
        <div className="production-hero__copy">
          <span className="production-eyebrow">Pre-release Production Mode</span>
          <h1 className="production-title">Setup in the app. Run Bible and Worship from the OBS Dock.</h1>
          <p className="production-subtitle">
            This pre-release keeps the main app focused on setup, songs, Bible data, and theme defaults.
            Live Bible and Worship control now belongs in OBS.
          </p>

          <div className="production-status-row">
            <span className={`production-status-pill${obsConnected ? " is-ok" : ""}`}>
              <Icon name={obsConnected ? "check_circle" : "error_outline"} size={16} />
              {obsConnected ? "OBS connected" : "OBS disconnected"}
            </span>
            <span className="production-status-pill">
              <Icon name="web_asset" size={16} />
              Dock-first workflow
            </span>
          </div>
        </div>

        <div className="production-dock-card">
          <div className="production-card-head">
            <div>
              <h2>OBS Dock URL</h2>
              <p>Add this as a Custom Browser Dock inside OBS.</p>
            </div>
            <Icon name="cast_connected" size={20} />
          </div>

          <label className="production-field">
            <span>Dock address</span>
            <input className="production-input" type="text" readOnly value={dockUrl} />
          </label>

          <div className="production-actions">
            <button className="production-btn production-btn--primary" onClick={handleCopyDockUrl}>
              <Icon name={copied ? "check" : "content_copy"} size={16} />
              {copied ? "Copied" : "Copy Dock URL"}
            </button>
            <a
              className="production-btn production-btn--ghost"
              href="https://obsproject.com/kb/browser-source"
              target="_blank"
              rel="noreferrer"
            >
              <Icon name="open_in_new" size={16} />
              OBS Browser Dock Help
            </a>
          </div>

          <ol className="production-checklist">
            <li>Keep OBS Church Studio open in the background.</li>
            <li>In OBS, add a Custom Browser Dock using the address above.</li>
            <li>Use the dock for live Bible and Worship preview/program sends.</li>
          </ol>
        </div>
      </section>

      <section className="production-grid">
        <Link className="production-nav-card" to="/settings">
          <div className="production-nav-card__icon">
            <Icon name="settings" size={22} />
          </div>
          <div>
            <h3>Settings</h3>
            <p>OBS connection, overlay server health, branding, and Bible translations.</p>
          </div>
        </Link>

        <Link className="production-nav-card" to="/resources">
          <div className="production-nav-card__icon">
            <Icon name="library_books" size={22} />
          </div>
          <div>
            <h3>Resources</h3>
            <p>Manage Bible translations, worship songs, and media assets that the OBS Dock uses.</p>
          </div>
        </Link>

        <Link className="production-nav-card" to="/production/themes">
          <div className="production-nav-card__icon">
            <Icon name="palette" size={22} />
          </div>
          <div>
            <h3>Production Themes</h3>
            <p>Choose the Bible and Worship fullscreen/lower-third defaults the dock should use.</p>
          </div>
        </Link>
      </section>
    </div>
  );
}
