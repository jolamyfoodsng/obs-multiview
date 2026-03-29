/**
 * GridTiles.tsx — Reusable Holyrics-style adaptive grid component.
 *
 * Renders a responsive CSS Grid of tiles using auto-fit / minmax.
 * Supports two item types:
 *   • "value" — a selectable tile (book, chapter, or verse)
 *   • "nav"   — a pagination nav tile ( > or << )
 */

import type { MouseEvent, KeyboardEvent } from "react";

/* ── Item types ── */

export interface ValueItem {
  type: "value";
  label: string;
  value: string | number;
  active?: boolean;
  /** data-cat attribute for category coloring (books only) */
  dataCat?: string;
}

export interface NavItem {
  type: "nav";
  label: string;
  action: "next" | "first";
}

export type GridTileItem = ValueItem | NavItem;

/* ── Props ── */

interface GridTilesProps {
  items: GridTileItem[];
  onClickValue: (value: string | number) => void;
  onClickNav: (action: "next" | "first") => void;
  onDoubleClickValue?: (value: string | number) => void;
  /** Allow Enter key to act as double-click (for verse → OBS) */
  enterSendsValue?: boolean;
}

/* ── Component ── */

export default function GridTiles({
  items,
  onClickValue,
  onClickNav,
  onDoubleClickValue,
  enterSendsValue,
}: GridTilesProps) {
  const handleKeyDown = (e: KeyboardEvent, item: GridTileItem) => {
    if (e.key === "Enter" && item.type === "value" && enterSendsValue && onDoubleClickValue) {
      e.preventDefault();
      onDoubleClickValue(item.value);
    }
  };

  return (
    <div className="gridTiles">
      {items.map((item, idx) => {
        if (item.type === "nav") {
          return (
            <button
              key={`nav-${item.action}-${idx}`}
              className="tileBtn nav"
              onClick={() => onClickNav(item.action)}
              title={item.action === "next" ? "Next page" : "First page"}
            >
              {item.label}
            </button>
          );
        }

        return (
          <button
            key={item.value}
            className={`tileBtn${item.active ? " active" : ""}`}
            data-cat={item.dataCat ?? undefined}
            tabIndex={0}
            onClick={(e: MouseEvent) => {
              e.stopPropagation();
              onClickValue(item.value);
            }}
            onDoubleClick={
              onDoubleClickValue
                ? (e: MouseEvent) => {
                    e.stopPropagation();
                    onDoubleClickValue(item.value);
                  }
                : undefined
            }
            onKeyDown={(e) => handleKeyDown(e, item)}
            title={String(item.label)}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
