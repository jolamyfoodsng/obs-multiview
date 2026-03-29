/**
 * useDragDrop — Pointer-event based drag-and-drop for Tauri webview.
 *
 * HTML5 drag-and-drop (dataTransfer, dragstart/drop) does NOT work
 * reliably inside Tauri's WKWebView. This module implements a custom
 * drag system using mousedown / mousemove / mouseup that works everywhere.
 *
 * Architecture:
 *  - Module-level singleton state (no React context needed)
 *  - Scene items call `startDrag(sceneInfo)` on mousedown
 *  - A floating ghost div follows the cursor
 *  - Canvas regions call `isOverRegion(regionId, rect)` to check hover
 *  - On mouseup inside a region → `onDrop` callback fires
 */

import { useEffect, useState, useRef, useCallback } from "react";

// ---------------------------------------------------------------------------
// Drag payload — what's being dragged
// ---------------------------------------------------------------------------

export interface DragPayload {
  sceneName: string;
  sceneIndex: number;
}

// ---------------------------------------------------------------------------
// Module-level singleton drag state
// ---------------------------------------------------------------------------

let _dragging = false;
let _payload: DragPayload | null = null;
let _cursorX = 0;
let _cursorY = 0;
let _ghostEl: HTMLDivElement | null = null;

/** Listeners notified on every mousemove / state change (for re-renders) */
const _listeners = new Set<() => void>();

/**
 * Drop target registry — maps regionId → { element, onDrop callback }.
 * The global mouseup handler iterates these BEFORE clearing _payload,
 * so the drop callback receives valid data.
 */
const _dropTargets = new Map<string, { el: HTMLDivElement; onDrop: (p: DragPayload) => void }>();

function notifyListeners() {
  _listeners.forEach((fn) => fn());
}

function createGhost(label: string) {
  if (_ghostEl) _ghostEl.remove();
  const el = document.createElement("div");
  el.className = "mv-pointer-drag-ghost";
  el.textContent = label;
  document.body.appendChild(el);
  _ghostEl = el;
  return el;
}

function moveGhost(x: number, y: number) {
  if (_ghostEl) {
    _ghostEl.style.left = `${x + 12}px`;
    _ghostEl.style.top = `${y - 14}px`;
  }
}

function removeGhost() {
  if (_ghostEl) {
    _ghostEl.remove();
    _ghostEl = null;
  }
}

/** Check if cursor is inside an element's bounding rect */
function isCursorOver(el: HTMLDivElement): boolean {
  const rect = el.getBoundingClientRect();
  return (
    _cursorX >= rect.left &&
    _cursorX <= rect.right &&
    _cursorY >= rect.top &&
    _cursorY <= rect.bottom
  );
}

// ---------------------------------------------------------------------------
// Public API — called by scene items to start a drag
// ---------------------------------------------------------------------------

export function startSceneDrag(payload: DragPayload, clientX: number, clientY: number) {
  _dragging = true;
  _payload = payload;
  _cursorX = clientX;
  _cursorY = clientY;
  createGhost(payload.sceneName);
  moveGhost(clientX, clientY);
  document.body.classList.add("mv-dragging-scene");
  notifyListeners();
}

// ---------------------------------------------------------------------------
// Global mouse handlers (attached once)
// ---------------------------------------------------------------------------

let _initialized = false;

function initGlobalHandlers() {
  if (_initialized) return;
  _initialized = true;

  const onMouseMove = (e: MouseEvent) => {
    if (!_dragging) return;
    _cursorX = e.clientX;
    _cursorY = e.clientY;
    moveGhost(e.clientX, e.clientY);
    notifyListeners();
  };

  const onMouseUp = () => {
    if (!_dragging || !_payload) return;

    // ── Fire drop callbacks BEFORE clearing state ──
    // Find which registered drop target (if any) the cursor is over
    const payload = _payload; // capture before clearing
    for (const [, target] of _dropTargets) {
      if (isCursorOver(target.el)) {
        console.log("[DnD] Drop detected:", payload.sceneName);
        target.onDrop(payload);
        break; // only drop on the first (topmost) match
      }
    }

    // Now clear drag state
    _dragging = false;
    _payload = null;
    removeGhost();
    document.body.classList.remove("mv-dragging-scene");
    notifyListeners();
  };

  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);
}

// ---------------------------------------------------------------------------
// React hook: useDragState — subscribe to drag state changes
// ---------------------------------------------------------------------------

export function useDragState() {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    initGlobalHandlers();
    const listener = () => forceUpdate((n) => n + 1);
    _listeners.add(listener);
    return () => { _listeners.delete(listener); };
  }, []);

  return {
    isDragging: _dragging,
    payload: _payload,
    cursorX: _cursorX,
    cursorY: _cursorY,
  };
}

// ---------------------------------------------------------------------------
// React hook: useDropTarget — registers a drop target element
// ---------------------------------------------------------------------------

export function useDropTarget(
  regionId: string,
  onDrop: (payload: DragPayload) => void
) {
  const ref = useRef<HTMLDivElement>(null);
  const [isHovered, setIsHovered] = useState(false);

  // Keep onDrop ref stable for the registry
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  // Stable callback that reads from ref
  const stableDrop = useCallback((p: DragPayload) => {
    onDropRef.current(p);
  }, []);

  // Register / unregister in the drop target registry
  useEffect(() => {
    initGlobalHandlers();
    const el = ref.current;
    if (!el) return;
    _dropTargets.set(regionId, { el, onDrop: stableDrop });
    return () => { _dropTargets.delete(regionId); };
  }, [regionId, stableDrop]);

  // Track hover state for visual feedback
  useEffect(() => {
    initGlobalHandlers();

    const checkHover = () => {
      if (!_dragging || !ref.current) {
        if (isHovered) setIsHovered(false);
        return;
      }
      setIsHovered(isCursorOver(ref.current));
    };

    _listeners.add(checkHover);
    return () => { _listeners.delete(checkHover); };
  }, [regionId, isHovered]);

  return { ref, isHovered };
}
