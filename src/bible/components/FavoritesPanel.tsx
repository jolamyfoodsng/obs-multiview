/**
 * FavoritesPanel.tsx — Favorites & History for Bible passages
 */

import { useState } from "react";
import { useBible } from "../bibleStore";
import type { BiblePassage } from "../types";
import Icon from "../../components/Icon";

export default function FavoritesPanel() {
  const { state, toggleFavorite, addToQueue } = useBible();
  const [tab, setTab] = useState<"favorites" | "history">("favorites");

  const handleAddToQueue = (passage: BiblePassage) => {
    addToQueue(passage);
  };

  return (
    <div className="favorites-panel">
      <div className="favorites-tabs">
        <button
          className={`favorites-tab ${tab === "favorites" ? "active" : ""}`}
          onClick={() => setTab("favorites")}
        >
          <Icon name="star" size={16} style={{ verticalAlign: "middle", marginRight: 4 }} />
          Favorites ({state.favorites.length})
        </button>
        <button
          className={`favorites-tab ${tab === "history" ? "active" : ""}`}
          onClick={() => setTab("history")}
        >
          <Icon name="history" size={16} style={{ verticalAlign: "middle", marginRight: 4 }} />
          History ({state.history.length})
        </button>
      </div>

      <div className="favorites-list">
        {tab === "favorites" &&
          (state.favorites.length > 0 ? (
            state.favorites.map((passage) => (
              <div key={passage.reference} className="favorites-item">
                <span className="favorites-item-ref">
                  {passage.reference}
                </span>
                <span className="favorites-item-text">
                  {passage.verses[0]?.text.slice(0, 60)}
                  {(passage.verses[0]?.text.length ?? 0) > 60 ? "…" : ""}
                </span>
                <div className="favorites-item-actions">
                  <button
                    className="favorites-item-btn"
                    onClick={() => handleAddToQueue(passage)}
                    title="Add to queue"
                  >
                    <Icon name="add" size={16} />
                  </button>
                  <button
                    className="favorites-item-btn"
                    onClick={() => toggleFavorite(passage)}
                    title="Remove from favorites"
                  >
                    <Icon name="star" size={16} />
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="favorites-empty">
              <p>No favorites yet</p>
              <p className="favorites-empty-hint">
                Click the star icon on a passage to save it here
              </p>
            </div>
          ))}

        {tab === "history" &&
          (state.history.length > 0 ? (
            state.history.map((passage, i) => (
              <div key={`${passage.reference}-${i}`} className="favorites-item">
                <span className="favorites-item-ref">
                  {passage.reference}
                </span>
                <span className="favorites-item-text">
                  {passage.verses[0]?.text.slice(0, 60)}
                  {(passage.verses[0]?.text.length ?? 0) > 60 ? "…" : ""}
                </span>
                <div className="favorites-item-actions">
                  <button
                    className="favorites-item-btn"
                    onClick={() => handleAddToQueue(passage)}
                    title="Add to queue"
                  >
                    <Icon name="add" size={16} />
                  </button>
                  <button
                    className="favorites-item-btn"
                    onClick={() => toggleFavorite(passage)}
                    title="Add to favorites"
                  >
                    <Icon name="star_border" size={16} />
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="favorites-empty">
              <p>No history yet</p>
              <p className="favorites-empty-hint">
                Passages you display will appear here
              </p>
            </div>
          ))}
      </div>
    </div>
  );
}
