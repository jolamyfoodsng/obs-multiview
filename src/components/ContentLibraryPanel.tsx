/**
 * ContentLibraryPanel — Left column
 *
 * Tabbed content library: All / Presets / Bible / Worship / Media / Scenes
 * Search bar at top.
 * Each item shows icon + title + subtitle + action buttons.
 */

import { useBroadcastStore } from "../hooks/useBroadcastStore";
import type { ContentItem, ContentType } from "../services/broadcastStore";
import { LowerThirdPanel } from "../lowerthirds/LowerThirdPanel";
import Icon from "./Icon";

interface Props {
    items: ContentItem[];
}

const TABS: { key: ContentType | "all"; label: string; icon: string }[] = [
    { key: "all", label: "All", icon: "apps" },
    { key: "preset", label: "Presets", icon: "dashboard" },
    { key: "scene", label: "Scenes", icon: "videocam" },
    { key: "bible", label: "Bible", icon: "menu_book" },
    { key: "worship", label: "Worship", icon: "music_note" },
    { key: "media", label: "Media", icon: "perm_media" },
    { key: "lower-third", label: "Lower 3rd", icon: "subtitles" },
];

export function ContentLibraryPanel({ items }: Props) {
    const {
        state,
        loadPreview,
        addToQueue,
        setLibraryTab,
        setLibrarySearch,
    } = useBroadcastStore();

    return (
        <div className="content-library-panel">
            <div className="panel-header">
                <h3 className="panel-title">
                    <Icon name="library_books" size={16} />
                    Content Library
                </h3>
            </div>

            {/* Search */}
            <div className="library-search-wrap">
                <Icon name="search" size={20} className="library-search-icon" />
                <input
                    type="text"
                    className="library-search-input"
                    placeholder="Search content..."
                    value={state.librarySearch}
                    onChange={(e) => setLibrarySearch(e.target.value)}
                    aria-label="Search content library"
                />
                {state.librarySearch && (
                    <button
                        type="button"
                        className="library-search-clear"
                        onClick={() => setLibrarySearch("")}
                        aria-label="Clear content search"
                        title="Clear content search"
                    >
                        <Icon name="close" size={14} />
                    </button>
                )}
            </div>

            {/* Tabs */}
            <div className="library-tabs">
                {TABS.map((tab) => (
                    <button
                        key={tab.key}
                        className={`library-tab ${state.libraryTab === tab.key ? "active" : ""}`}
                        onClick={() => setLibraryTab(tab.key)}
                        title={tab.label}
                    >
                        <Icon name={tab.icon} size={14} />
                        <span className="library-tab-label">{tab.label}</span>
                    </button>
                ))}
            </div>

            {/* Item List / Lower Third Panel */}
            {state.libraryTab === "lower-third" ? (
                <div className="library-list" style={{ padding: 0 }}>
                    <LowerThirdPanel />
                </div>
            ) : (
            <div className="library-list">
                {items.length === 0 ? (
                    <div className="library-empty">
                        <Icon name="search_off" size={28} style={{ opacity: 0.3 }} />
                        <span>No items found</span>
                    </div>
                ) : (
                    items.map((item) => (
                        <LibraryItem
                            key={item.id}
                            item={item}
                            isInPreview={state.preview?.id === item.id}
                            isLive={state.program?.id === item.id}
                            onLoadPreview={() => loadPreview(item)}
                            onAddToQueue={() => addToQueue(item)}
                        />
                    ))
                )}
            </div>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Library Item Row
// ---------------------------------------------------------------------------

interface LibraryItemProps {
    item: ContentItem;
    isInPreview: boolean;
    isLive: boolean;
    onLoadPreview: () => void;
    onAddToQueue: () => void;
}

function LibraryItem({ item, isInPreview, isLive, onLoadPreview, onAddToQueue }: LibraryItemProps) {
    return (
        <div
            className={`library-item ${isLive ? "library-item-live" : ""} ${isInPreview ? "library-item-preview" : ""}`}
        >
            <div className="library-item-icon-wrap">
                <Icon name={item.icon} size={20} className="library-item-icon" />
            </div>

            <div className="library-item-info">
                <span className="library-item-title">{item.title}</span>
                {item.subtitle && (
                    <span className="library-item-subtitle">{item.subtitle}</span>
                )}
            </div>

            <div className="library-item-badges">
                {isLive && <span className="library-badge library-badge-live">LIVE</span>}
                {isInPreview && !isLive && <span className="library-badge library-badge-preview">PVW</span>}
            </div>

            <div className="library-item-actions">
                <button
                    className="library-action-btn library-action-preview"
                    onClick={onLoadPreview}
                    title="Load to Preview"
                >
                    <Icon name="visibility" size={16} />
                </button>
                <button
                    className="library-action-btn library-action-queue"
                    onClick={onAddToQueue}
                    title="Add to Queue"
                >
                    <Icon name="playlist_add" size={16} />
                </button>
            </div>
        </div>
    );
}
