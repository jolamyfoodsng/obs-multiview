/**
 * QueuePanel.tsx — Compact passage queue with drag reordering
 *
 * - Numbered items with slide dot indicators
 * - Drag/drop reorder
 * - Clear All button in header
 */

import { useBible } from "../bibleStore";
import Icon from "../../components/Icon";

export default function QueuePanel() {
  const { state, removeFromQueue, goToSlide, dispatch } = useBible();
  const { queue, activeQueueIndex } = state;

  const handleDragStart = (e: React.DragEvent, fromIndex: number) => {
    e.dataTransfer.setData("text/plain", String(fromIndex));
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    const fromIndex = parseInt(e.dataTransfer.getData("text/plain"), 10);
    if (fromIndex !== toIndex) {
      dispatch({ type: "REORDER_QUEUE", fromIndex, toIndex });
    }
  };

  return (
    <div className="queue-panel">
      <div className="queue-panel-header">
        <h3>Queue</h3>
        <span className="queue-panel-count">{queue.length}</span>
        {queue.length > 0 && (
          <button
            className="queue-panel-clear"
            onClick={() => dispatch({ type: "CLEAR_QUEUE" })}
            title="Clear queue"
          >
            Clear
          </button>
        )}
      </div>

      {queue.length === 0 ? (
        <div className="queue-panel-empty">
          <div className="queue-panel-empty-icon">
            <Icon name="queue" size={20} />
          </div>
          <span>No passages queued</span>
          <span className="queue-panel-empty-hint">
            Search → select → add to queue
          </span>
        </div>
      ) : (
        <div className="queue-panel-list">
          {queue.map((item, qIdx) => {
            const isActive = qIdx === activeQueueIndex;
            return (
              <div
                key={item.id}
                className={`queue-item ${isActive ? "active" : ""}`}
                draggable
                onDragStart={(e) => handleDragStart(e, qIdx)}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, qIdx)}
              >
                <div className="queue-item-header">
                  <span className="queue-item-number">{qIdx + 1}</span>
                  <span className="queue-item-ref">
                    {item.passage.reference}
                  </span>
                  <span className="queue-item-slides">
                    {item.slides.length}s
                  </span>
                  <button
                    className="queue-item-remove"
                    onClick={() => removeFromQueue(item.id)}
                    title="Remove"
                  >
                    ×
                  </button>
                </div>

                {/* Slide dots for active item */}
                {isActive && (
                  <div className="queue-item-slides-row">
                    {item.slides.map((_, sIdx) => (
                      <button
                        key={sIdx}
                        className={`queue-slide-dot ${sIdx === item.currentSlide ? "active" : ""}`}
                        onClick={() => goToSlide(qIdx, sIdx)}
                        title={`Slide ${sIdx + 1}`}
                      >
                        {sIdx + 1}
                      </button>
                    ))}
                  </div>
                )}

                {/* Activate button for non-active items */}
                {!isActive && (
                  <button
                    className="queue-item-activate"
                    onClick={() =>
                      dispatch({ type: "SET_ACTIVE_QUEUE_INDEX", index: qIdx })
                    }
                  >
                    Activate
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
