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
    <div className="app-page production-page">
      <div className="app-page__inner">
        <header className="app-page__header">
          <div className="app-page__header-copy">
            <p className="app-page__eyebrow">Production Workflow</p>
            <h1 className="app-page__title">Prepare everything here, then run the live service from OBS.</h1>
            <p className="app-page__subtitle">
              OBS Church Studio is the setup surface for translations, songs, media, branding, and theme defaults.
              Operators stay inside the OBS Browser Dock during the service.
            </p>
          </div>
          <div className="app-page__actions">
            <span className={`app-chip${obsConnected ? " is-ok" : ""}`}>
              <Icon name={obsConnected ? "check_circle" : "error_outline"} size={14} />
              {obsConnected ? "OBS connected" : "OBS disconnected"}
            </span>
            <span className="app-chip">
              <Icon name="dock" size={14} />
              Dock-first control
            </span>
          </div>
        </header>

        <section className="app-grid-2">
          <article className="app-surface production-dock-card">
            <div className="app-surface__header">
              <div>
                <h2 className="app-surface__title">OBS Browser Dock</h2>
                <p className="app-surface__meta">Copy this address into OBS Studio as a Custom Browser Dock.</p>
              </div>
              <Icon name="cast_connected" size={18} />
            </div>
            <div className="app-surface__body">
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
                  Browser Dock Help
                </a>
              </div>
            </div>
          </article>

          <article className="app-surface app-surface--muted">
            <div className="app-surface__header">
              <div>
                <h2 className="app-surface__title">Startup Checklist</h2>
                <p className="app-surface__meta">Keep the path into live operation short and predictable.</p>
              </div>
              <Icon name="fact_check" size={18} />
            </div>
            <div className="app-surface__body">
              <ol className="app-info-list">
                <li>Open OBS Church Studio before service begins.</li>
                <li>Add the dock URL above inside OBS once and leave it pinned.</li>
                <li>Review resources and theme defaults before going live.</li>
              </ol>
            </div>
          </article>
        </section>

        <section className="app-surface">
          <div className="app-surface__header">
            <div>
              <h2 className="app-surface__title">Work Areas</h2>
              <p className="app-surface__meta">These are the setup surfaces the dock depends on during live production.</p>
            </div>
          </div>
          <div className="app-surface__body">
            <div className="app-grid-3">
              <Link className="app-compact-item production-nav-card" to="/settings">
                <div className="app-compact-item__icon">
                  <Icon name="settings" size={18} />
                </div>
                <div className="app-compact-item__copy">
                  <h3>Settings</h3>
                  <p>OBS connection, overlay health, branding, and Bible configuration.</p>
                </div>
              </Link>

              <Link className="app-compact-item production-nav-card" to="/resources">
                <div className="app-compact-item__icon">
                  <Icon name="library_books" size={18} />
                </div>
                <div className="app-compact-item__copy">
                  <h3>Resources</h3>
                  <p>Manage translations, worship songs, and media used by the dock.</p>
                </div>
              </Link>

              <Link className="app-compact-item production-nav-card" to="/live-tools">
                <div className="app-compact-item__icon">
                  <Icon name="bolt" size={18} />
                </div>
                <div className="app-compact-item__copy">
                  <h3>Live Tools</h3>
                  <p>Countdowns, welcome loops, emergency screens, giving info, and service overlays.</p>
                </div>
              </Link>

              <Link className="app-compact-item production-nav-card" to="/production/themes">
                <div className="app-compact-item__icon">
                  <Icon name="palette" size={18} />
                </div>
                <div className="app-compact-item__copy">
                  <h3>Production Themes</h3>
                  <p>Set the fullscreen and lower-third defaults for Bible and Worship.</p>
                </div>
              </Link>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
