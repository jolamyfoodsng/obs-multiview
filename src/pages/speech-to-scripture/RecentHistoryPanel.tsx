import Icon from "../../components/Icon";
import type { RecentHistoryPanelProps } from "./types";

function formatAge(timestamp: number): string {
  const diffMs = Math.max(Date.now() - timestamp, 0);
  const minutes = Math.round(diffMs / 60000);
  if (minutes <= 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

export function RecentHistoryPanel({ items, onReplay }: RecentHistoryPanelProps) {
  return (
    <section className="app-surface speech-panel">
      <div className="app-surface__header">
        <div>
          <p className="speech-panel__eyebrow">Recent history</p>
          <h2 className="app-surface__title">Last accepted verses</h2>
        </div>
        <Icon name="history" size={16} />
      </div>
      <div className="app-surface__body">
        <div className="speech-history-list">
          {items.length === 0 ? (
            <p className="speech-history-empty">Accepted verses will appear here after preview, present, or queue actions.</p>
          ) : (
            items.map((item) => (
              <div key={item.id} className="speech-history-item">
                <div className="speech-history-item__copy">
                  <strong>{item.reference}</strong>
                  <span>{item.translation} · {formatAge(item.timestamp)}</span>
                </div>
                <button type="button" className="speech-icon-btn" aria-label={`Replay ${item.reference}`} onClick={() => onReplay(item)}>
                  <Icon name="replay" size={14} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
