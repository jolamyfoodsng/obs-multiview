/**
 * LiveControls.tsx — Footer Transport Bar: Bold Bible Pro
 *
 * GO LIVE (green, box-shadow) + CLEAR (red) + BLANK + PREV/NEXT in pill
 * OBS setup integrated. Keyboard: Enter=Live, Space/Arrow=Next, B=Blank, Esc=Clear
 */

import { useEffect, useCallback } from "react";
import { useBible } from "../bibleStore";
import { bibleObsService } from "../bibleObsService";
import Icon from "../../components/Icon";

export default function LiveControls() {
  const {
    state, currentSlide, currentQueueItem, activeTheme,
    nextSlide, prevSlide, goLive, goBlank, goClear,
  } = useBible();

  // Push slide updates to overlay + OBS
  useEffect(() => {
    if (state.isLive) {
      bibleObsService.pushSlide(currentSlide, activeTheme?.settings ?? null, true, state.isBlanked);
    } else {
      bibleObsService.pushSlide(null, null, false, false);
    }
  }, [currentSlide, activeTheme, state.isLive, state.isBlanked]);

  // Keyboard shortcuts
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
    switch (e.key) {
      case "ArrowRight": e.preventDefault(); nextSlide(); break;
      case "ArrowLeft": e.preventDefault(); prevSlide(); break;
      case " ": e.preventDefault(); nextSlide(); break;
      case "Enter": e.preventDefault(); goLive(); break;
      case "Escape": e.preventDefault(); goClear(); break;
      case "b": case "B":
        if (!e.ctrlKey && !e.metaKey) { e.preventDefault(); goBlank(); }
        break;
    }
  }, [nextSlide, prevSlide, goLive, goBlank, goClear]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const handleSetupObs = async () => {
    try {
      const result = await bibleObsService.ensureBrowserSource(undefined, activeTheme?.templateType);
      alert(`Bible overlay created!\nScene: ${result.sceneName}\nItem ID: ${result.sceneItemId}\n\nThe overlay will update automatically.`);
    } catch (err) {
      alert(`Failed to setup OBS: ${err instanceof Error ? err.message : err}`);
    }
  };

  const hasSlides = currentQueueItem && currentQueueItem.slides.length > 0;
  const queueLen = state.queue.length;
  const slideInfo = currentSlide ? `${currentSlide.index + 1}/${currentSlide.total}` : "0/0";

  return (
    <div className="bible-footer">
      {/* Left: GO LIVE + divider + CLEAR + BLANK + OBS */}
      <div className="footer-left">
        <button
          className={`footer-go-live ${state.isLive ? "active" : ""}`}
          onClick={() => goLive()}
          disabled={!hasSlides}
          title="Go Live (Enter)"
        >
          <Icon name={state.isLive ? "stop" : "broadcast_on_home"} size={20} />
          {state.isLive ? "STOP LIVE" : "GO LIVE"}
        </button>

        <span className="footer-divider" />

        <button className="footer-action-btn clear" onClick={() => goClear()} title="Clear output (Esc)">
          <Icon name="block" size={20} /> CLEAR
        </button>

        <button
          className={`footer-action-btn blank ${state.isBlanked ? "active" : ""}`}
          onClick={() => goBlank()}
          title="Blank screen (B)"
        >
          <Icon name={state.isBlanked ? "visibility" : "visibility_off"} size={20} />
          {state.isBlanked ? "SHOW" : "BLANK"}
        </button>

        <button className="footer-action-btn blank" onClick={handleSetupObs} title="Setup OBS Browser Source">
          <Icon name="settings_input_antenna" size={20} /> OBS
        </button>
      </div>

      {/* Center: PREV / NEXT pill */}
      <div className="footer-center">
        <button className="footer-nav-btn" onClick={() => prevSlide()} disabled={!hasSlides} title="Previous slide">
          <Icon name="arrow_back" size={20} className="prev" /> PREV
        </button>
        <button className="footer-nav-btn" onClick={() => nextSlide()} disabled={!hasSlides} title="Next slide">
          NEXT <Icon name="arrow_forward" size={20} className="next" />
        </button>
      </div>

      {/* Right: Stats + Keyboard hints */}
      <div className="footer-right">
        <div className="footer-stats">
          <span className="footer-stat green">
            <Icon name="slideshow" size={20} /> {slideInfo}
          </span>
          <span className="footer-stat purple">
            <Icon name="queue" size={20} /> {queueLen}
          </span>
        </div>
        <div className="footer-kbd-hints">
          <span><kbd>Enter</kbd> Live</span>
          <span><kbd>Space</kbd> Next</span>
          <span><kbd>B</kbd> Blank</span>
        </div>
      </div>
    </div>
  );
}
