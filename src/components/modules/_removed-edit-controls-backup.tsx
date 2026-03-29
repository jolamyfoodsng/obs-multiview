/**
 * _removed-edit-controls-backup.tsx
 *
 * This file stores the JSX / logic that was removed from LowerThirdsModule
 * and SpeakerModule for the edit controls:
 *   - Customize Appearance (bg color, text color, accent color)
 *   - Font Size picker
 *   - Size picker
 *   - Height Override
 *   - Background Image (with opacity slider)
 *   - Animation In picker
 *   - Position picker
 *   - Template title / theme header above preview
 *
 * This file is NOT imported anywhere. It's a reference backup so the
 * code can be restored / reused later.
 *
 * Created: Feb 2026
 */

// ═══════════════════════════════════════════════════════════════════════════
// A. LOWER THIRDS MODULE — Removed sections
// ═══════════════════════════════════════════════════════════════════════════

// ── A1. Template title / theme header (was above the preview) ──
/*
              <div className="lt-page-theme-header">
                <div
                  className="lt-page-theme-icon"
                  style={{ background: theme.accentColor, fontSize: 22, color: "#fff" }}
                >
                  <Icon name={theme.icon} size={20} />
                </div>
                <div>
                  <h2 className="lt-page-theme-name">{theme.name}</h2>
                </div>
              </div>
*/

// ── A2. Size + Font Size picker bar (was between preview and two-column grid) ──
/*
              <div className="lt-page-control-bar">
                <div className="lt-page-control-group">
                  <label className="lt-page-control-label">
                    <Icon name="aspect_ratio" size={13} />
                    Size
                  </label>
                  <div className="lt-size-picker">
                    {LT_SIZES.map((s) => (
                      <button
                        key={s}
                        className={"lt-size-btn" + (state.size === s ? " lt-size-btn--active" : "")}
                        onClick={() => setSize(s)}
                      >
                        {LT_SIZE_LABELS[s]}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="lt-page-control-group">
                  <label className="lt-page-control-label">
                    <Icon name="text_fields" size={13} />
                    Font Size
                  </label>
                  <div className="lt-size-picker">
                    {LT_FONT_SIZES.map((fs) => (
                      <button
                        key={fs}
                        className={"lt-size-btn" + (state.fontSize === fs ? " lt-size-btn--active" : "")}
                        onClick={() => setFontSize(fs)}
                      >
                        {LT_FONT_SIZE_LABELS[fs]}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
*/

// ── A3. Customize Appearance section (entire left column of the two-column grid) ──
/*
                <div className="lt-customize-section">
                  <div className="lt-customize-header">
                    <h4>
                      <Icon name="palette" size={16} style={{ color: "#C8102E" }} />
                      Customize Appearance
                    </h4>
                    <button className="lt-customize-reset" onClick={resetCustomStyles}>
                      <Icon name="restart_alt" size={12} />
                      Reset
                    </button>
                  </div>

                  <div className="lt-customize-grid">
                    <div className="lt-customize-field">
                      <label className="lt-customize-label">Background</label>
                      <div className="lt-customize-color-row">
                        <input type="color" className="lt-customize-swatch"
                          value={state.customStyles.bgColor || "#1a1a2e"}
                          onChange={(e) => setCustomStyle({ bgColor: e.target.value })} />
                        <input type="text" className="lt-page-form-input lt-customize-hex"
                          value={state.customStyles.bgColor}
                          onChange={(e) => setCustomStyle({ bgColor: e.target.value })}
                          placeholder="#hex" />
                        {state.customStyles.bgColor && (
                          <button className="lt-customize-clear" onClick={() => setCustomStyle({ bgColor: "" })}>
                            <Icon name="close" size={12} />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="lt-customize-field">
                      <label className="lt-customize-label">Text</label>
                      <div className="lt-customize-color-row">
                        <input type="color" className="lt-customize-swatch"
                          value={state.customStyles.textColor || "#ffffff"}
                          onChange={(e) => setCustomStyle({ textColor: e.target.value })} />
                        <input type="text" className="lt-page-form-input lt-customize-hex"
                          value={state.customStyles.textColor}
                          onChange={(e) => setCustomStyle({ textColor: e.target.value })}
                          placeholder="#hex" />
                        {state.customStyles.textColor && (
                          <button className="lt-customize-clear" onClick={() => setCustomStyle({ textColor: "" })}>
                            <Icon name="close" size={12} />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="lt-customize-field">
                      <label className="lt-customize-label">Accent</label>
                      <div className="lt-customize-color-row">
                        <input type="color" className="lt-customize-swatch"
                          value={state.customStyles.accentColor || "#C8102E"}
                          onChange={(e) => setCustomStyle({ accentColor: e.target.value })} />
                        <input type="text" className="lt-page-form-input lt-customize-hex"
                          value={state.customStyles.accentColor}
                          onChange={(e) => setCustomStyle({ accentColor: e.target.value })}
                          placeholder="#hex" />
                        {state.customStyles.accentColor && (
                          <button className="lt-customize-clear" onClick={() => setCustomStyle({ accentColor: "" })}>
                            <Icon name="close" size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  <div style={{ marginTop: 12 }}>
                    <label className="lt-customize-label">Background Image</label>
                    <div className="lt-customize-bgimg-controls">
                      <input type="text" className="lt-page-form-input"
                        placeholder="Image URL or upload..."
                        value={state.customStyles.bgImage}
                        onChange={(e) => setCustomStyle({ bgImage: e.target.value })}
                        style={{ flex: 1, fontSize: 11 }} />
                      {state.customStyles.bgImage && (
                        <button className="lt-customize-clear" onClick={() => setCustomStyle({ bgImage: "" })}>
                          <Icon name="close" size={12} />
                        </button>
                      )}
                    </div>
                    {state.customStyles.bgImage && (
                      <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", whiteSpace: "nowrap" }}>
                          Opacity: {Math.round(state.customStyles.bgImageOpacity * 100)}%
                        </span>
                        <input type="range" className="lt-customize-slider"
                          min="0" max="1" step="0.05"
                          value={state.customStyles.bgImageOpacity}
                          onChange={(e) => setCustomStyle({ bgImageOpacity: parseFloat(e.target.value) })} />
                      </div>
                    )}
                  </div>

                  <div style={{ marginTop: 12 }}>
                    <label className="lt-customize-label">
                      Height Override
                      <span style={{ fontWeight: 400, opacity: 0.6, marginLeft: 4 }}>
                        {state.customStyles.heightPx > 0 ? state.customStyles.heightPx + "px" : "Auto"}
                      </span>
                    </label>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <input type="range" className="lt-customize-slider"
                        min="0" max="400" step="5"
                        value={state.customStyles.heightPx}
                        onChange={(e) => setCustomStyle({ heightPx: parseInt(e.target.value, 10) })} />
                      {state.customStyles.heightPx > 0 && (
                        <button className="lt-customize-clear" onClick={() => setCustomStyle({ heightPx: 0 })}>
                          <Icon name="close" size={12} />
                        </button>
                      )}
                    </div>
                  </div>

                  <div style={{ marginTop: 12 }}>
                    <label className="lt-customize-label">Position</label>
                    <div className="lt-position-grid">
                      {LT_POSITIONS.map((pos) => (
                        <button key={pos}
                          className={"lt-position-btn" + (state.position === pos ? " lt-position-btn--active" : "")}
                          onClick={() => setPosition(pos)}
                          title={LT_POSITION_LABELS[pos]}>
                          <Icon name={LT_POSITION_ICONS[pos]} size={14} />
                        </button>
                      ))}
                    </div>
                  </div>

                  <div style={{ marginTop: 12 }}>
                    <label className="lt-customize-label">Animation In</label>
                    <div className="lt-animation-grid">
                      {LT_ANIMATIONS_IN.map((anim) => (
                        <button key={anim}
                          className={"lt-animation-btn" + (state.animationIn === anim ? " lt-animation-btn--active" : "")}
                          onClick={() => setAnimationIn(anim)}
                          title={LT_ANIMATION_LABELS[anim]}>
                          <Icon name={LT_ANIMATION_ICONS[anim]} size={13} />
                          <span className="lt-animation-btn-label">
                            {LT_ANIMATION_LABELS[anim]}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
*/


// ═══════════════════════════════════════════════════════════════════════════
// B. SPEAKER MODULE — Removed sections
// ═══════════════════════════════════════════════════════════════════════════

// ── B1. Size & Font Size under Edit Content ──
/*
            <div className="speaker-control-row">
              <label className="speaker-control-label">Lower Third Size</label>
              <div className="speaker-size-picker">
                {LT_SIZES.map((s) => (
                  <button key={s} type="button"
                    className={`speaker-size-btn${ltSize === s ? " is-active" : ""}`}
                    onClick={() => setLtSize(s)}>
                    {LT_SIZE_LABELS[s]}
                  </button>
                ))}
              </div>
            </div>

            <div className="speaker-control-row">
              <label className="speaker-control-label">Font Size</label>
              <div className="speaker-size-picker">
                {LT_FONT_SIZES.map((fs) => (
                  <button key={fs} type="button"
                    className={`speaker-size-btn${ltFontSize === fs ? " is-active" : ""}`}
                    onClick={() => setLtFontSize(fs)}>
                    {LT_FONT_SIZE_LABELS[fs]}
                  </button>
                ))}
              </div>
            </div>
*/

// ── B2. Customize Appearance block (bg/text/accent color, bg image, height) ──
/*
          <div className="speaker-module-block">
            <div className="speaker-module-block-head">
              <span className="speaker-module-block-title">
                <Icon name="palette" size={15} />
                Customize Appearance
              </span>
              <button type="button" className="speaker-module-mini-btn" onClick={resetCustomStyles}>
                <Icon name="restart_alt" size={13} />
                Reset
              </button>
            </div>

            <div className="speaker-customize-grid">
              ... Background Color, Text Color, Accent Color fields ...
            </div>

            ... Background Image input + preview + opacity slider ...
            ... Height Override slider ...
          </div>
*/

// ── B3. Position on Screen ──
/*
          <div className="speaker-module-block">
            <span className="speaker-module-block-title">
              <Icon name="place" size={15} />
              Position on Screen
            </span>
            <div className="speaker-position-full-grid">
              {LT_POSITIONS.map((pos) => (
                <button key={pos} type="button"
                  className={`speaker-position-btn${ltPosition === pos ? " is-active" : ""}`}
                  onClick={() => setLtPosition(pos)}
                  title={LT_POSITION_LABELS[pos]}>
                  <Icon name={LT_POSITION_ICONS[pos]} size={16} />
                  <span>{LT_POSITION_LABELS[pos]}</span>
                </button>
              ))}
            </div>
          </div>
*/

// ── B4. Animation In ──
/*
          <div className="speaker-module-block">
            <span className="speaker-module-block-title">
              <Icon name="animation" size={15} />
              Animation In
            </span>
            <div className="speaker-animation-grid">
              {LT_ANIMATIONS_IN.map((anim) => (
                <button key={anim} type="button"
                  className={`speaker-animation-btn${ltAnimationIn === anim ? " is-active" : ""}`}
                  onClick={() => setLtAnimationIn(anim)}
                  title={LT_ANIMATION_LABELS[anim]}>
                  <Icon name={LT_ANIMATION_ICONS[anim]} size={14} />
                  <span>{LT_ANIMATION_LABELS[anim]}</span>
                </button>
              ))}
            </div>
          </div>
*/

export {};
