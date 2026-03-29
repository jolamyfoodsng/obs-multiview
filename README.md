# OBS Church Studio

**Complete Church Production Control for OBS**

A smart desktop layer built on top of OBS Studio that gives church media teams everything they need for professional-grade live broadcast — multi-view layouts, Bible verse overlays, scene management, and one-click production workflows.

---

## Features

### Multi-View Layout Editor
- Drag-and-drop visual layout editor with slot-based region system
- Assign OBS scenes, camera inputs, Bible output, or media to any slot
- Templates for common church setups (camera + Bible split, PiP, lower thirds)
- Safe frame guides and snap-to-grid alignment
- Locked template structures with padding and safe margins

### Bible Production System
- 1,000+ Bible translations via online catalog with offline caching
- Real-time verse search, chapter navigation, and favorites
- Theme editor with live preview — customizable fonts, colors, layouts
- Push Bible verses to OBS as browser sources
- Translation quick-switch buttons
- Smart search (⌘K) — type book abbreviations, chapter:verse references, or keywords
- Import custom Bible translations via XML upload

### Scene Sync
- Map layouts to OBS scenes and push with one click
- Managed scene tracking — scenes tagged "Managed by OBS Church Studio"
- Scene UUID + Source UUID tracking for reliable re-linking after renames
- Conflict detection and resolution UI
- Rename and delete managed scenes directly from the app

### Go Live
- One-click "Go Live" — pick a template, push to OBS, switch to program
- "Build My First Layout" guided flow for new users
- Keyboard shortcuts for fast operation (N, B, G, T, /, 1-6)

### Dashboard
- Live status bar — current OBS scene, active layout, Bible verse, connection
- Quick actions — New Layout, Open Bible, Go Live, Scenes, Templates
- Recent layouts with one-click resume
- Camera detection from OBS inputs

### Auto-Update System
- On launch, checks GitHub Releases for newer versions via Tauri's native updater
- Mandatory update modal with **download progress bar** — shows percentage and bytes
- Downloads and installs the update automatically — no manual browser download needed
- After install, the app **relaunches itself** with the new version
- Signed update verification (public key embedded in the app)
- Splash screen shown during startup while resources load

---

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop Shell | [Tauri v2](https://tauri.app/) (Rust backend) |
| Frontend | React 19 + TypeScript 5.8 + Vite 7 |
| OBS Control | [obs-websocket-js](https://github.com/obs-websocket-community-projects/obs-websocket-js) v5 |
| Bible API | Custom backend + IndexedDB caching |
| Styling | Vanilla CSS (flat broadcast dark theme) |
| Storage | IndexedDB (layouts, Bible, settings) + Tauri file system |

---

## Brand System

| Token | Value |
|---|---|
| Primary (OBS Green) | `#00E676` |
| Accent Blue | `#2962FF` |
| Background | `#121212` |
| Surface | `#1E1E1E` |
| Border | `#2C2C2C` |
| Text Primary | `#E0E0E0` |

- **Font:** Inter (H1: 700, H2: 600, Body: 400, Buttons: 500)
- **Borders:** 2px solid
- **Spacing:** 8px grid
- **Transitions:** 150ms ease
- **Style:** Flat, professional broadcast aesthetic — no gradients, no neon

---

## Project Structure

```
src/
├── App.tsx                   # Root component — splash → update check → app
├── AppShell.tsx              # Unified sidebar navigation shell
├── App.css                   # Global design system (brand colors, typography)
├── main.tsx                  # React entry + router setup
│
├── bible/                    # Bible production module
│   ├── bibleApi.ts           # API service (catalog, download, XML parsing)
│   ├── bibleData.ts          # Data layer (IndexedDB cache, bundled KJV)
│   ├── bibleDb.ts            # IndexedDB schema
│   ├── bibleObsService.ts    # OBS browser source management for Bible
│   ├── bibleStore.tsx        # React context + reducer
│   ├── slideEngine.ts        # Verse → HTML slide rendering
│   ├── bible.css             # Bible module styles
│   ├── components/           # BookChapterPanel, VerseListPanel, SmartSearchModal, etc.
│   ├── pages/                # BibleHome, BibleSettings
│   └── themes/               # Built-in Bible display themes
│
├── multiview/                # Multi-view layout editor
│   ├── mvStore.ts            # IndexedDB layout storage
│   ├── mvObsService.ts       # Layout → OBS scene push logic
│   ├── editorStore.tsx       # Editor state management
│   ├── templates.ts          # Built-in layout templates
│   ├── mv.css                # Editor styles
│   ├── components/           # Canvas, RegionInspector, Toolbar, etc.
│   └── pages/                # MVDashboard, MVEditor, MVSceneSync, MVSettings
│
├── components/               # Shared app components
│   ├── OBSConnectGate.tsx    # Connection gate (blocks until OBS connected)
│   ├── SplashScreen.tsx      # Loading splash with introductory image
│   ├── UpdateModal.tsx       # Mandatory update prompt
│   └── ...                   # Layout tiles, service mode, etc.
│
├── services/                 # Core services
│   ├── obsService.ts         # OBS WebSocket singleton
│   ├── obsRegistry.ts        # UUID tracking for managed OBS objects
│   ├── updateService.ts      # Tauri native auto-updater (check, download, install, relaunch)
│   ├── store.ts              # Tauri file-based settings storage
│   └── ...                   # Broadcast, camera, transition services
│
src-tauri/
├── src/
│   ├── lib.rs                # Rust backend (file I/O, HTTP plugin)
│   └── main.rs               # Tauri entry point
├── tauri.conf.json           # App metadata, window config, permissions
├── capabilities/             # Security capabilities (HTTP, file access)
└── icons/                    # App icons (.icns, .ico, PNGs)
```

---

## Getting Started

### Prerequisites
- [OBS Studio](https://obsproject.com/) with WebSocket Server enabled
  - Tools → WebSocket Server Settings → Enable WebSocket server
- [Node.js](https://nodejs.org/) 18+
- [Rust](https://rustup.rs/) (for Tauri)

### Development

```bash
# Install dependencies
npm install

# Run in development mode (opens Tauri window)
npm run tauri dev

# Build for production
npm run tauri build
```

### First Launch
1. Open OBS Studio and enable WebSocket Server
2. Launch OBS Church Studio
3. Enter the WebSocket URL (default: `ws://localhost:4455`) and password
4. Click **Build My First Layout** to get started

---

## Releasing a New Update

This guide walks through the full process of pushing a new version to GitHub and publishing a release so users receive the mandatory update prompt.

### Step 1: Bump the Version Number

Update the version in **two** places (they must match):

| File | Field |
|---|---|
| `package.json` | `"version": "X.Y.Z"` |
| `src-tauri/tauri.conf.json` | `"version": "X.Y.Z"` |

Use [semantic versioning](https://semver.org/):
- **Patch** (0.1.0 → 0.1.1): Bug fixes, small tweaks
- **Minor** (0.1.0 → 0.2.0): New features, backward compatible
- **Major** (0.1.0 → 1.0.0): Breaking changes, major milestones

### Step 2: Commit & Push to GitHub

```bash
# Stage all changes
git add .

# Commit with a descriptive message
git commit -m "release: v0.2.0 — Bible import, auto-update, splash screen"

# Push to your branch
git push origin feature/bible-obs-integration

# (Optional) Merge into main/develop
git checkout main
git merge feature/bible-obs-integration
git push origin main
```

### Step 3: Tag & Push — CI Builds Everything Automatically

```bash
# Create a git tag matching the version
git tag v0.2.0

# Push the tag — this triggers the CI build
git push origin v0.2.0
```

That's it. GitHub Actions will automatically:

1. **Build** the app on macOS (ARM + Intel), Windows, and Linux — in parallel
2. **Sign** update bundles with the `TAURI_SIGNING_PRIVATE_KEY` secret
3. **Create a GitHub Release** with the tag name
4. **Upload all installers** (`.dmg`, `.exe`, `.msi`, `.AppImage`, `.deb`) to the release
5. **Upload `latest.json`** — the auto-updater manifest that existing installations use to detect and download updates

The CI workflow is defined in `.github/workflows/release.yml`.

#### Build outputs

| Platform | Installer | Architecture |
|---|---|---|
| **macOS** | `.dmg` | Apple Silicon (arm64) |
| **macOS** | `.dmg` | Intel (x64) |
| **Windows** | `.exe` (NSIS) | x64 |
| **Windows** | `.msi` | x64 |
| **Linux** | `.AppImage` | x64 |
| **Linux** | `.deb` | x64 |

#### Manual trigger (no tag needed)

You can also trigger the build manually:
1. Go to **GitHub → Actions → Release — Build & Publish**
2. Click **"Run workflow"**
3. Optionally enter a version (e.g. `v0.2.0`)
4. Click **"Run"**

### Step 4: Verify

1. Go to **https://github.com/jolamyfoodsng/obs-multiview/releases** — the new release should be there with all binaries + `latest.json`
2. Open the app on any machine with the **old** version installed
3. The splash screen should appear → update check runs → **Update Required** modal pops up
4. Clicking "Update Now" downloads the update **inside the app** with a progress bar
5. After download → the app installs the update and **relaunches automatically**
6. Clicking "Close App" exits the application

### Quick Checklist

```
□ Version bumped in package.json and tauri.conf.json
□ Code committed and pushed to GitHub
□ Git tag created: git tag vX.Y.Z
□ Tag pushed: git push origin vX.Y.Z
□ CI build completed (check GitHub Actions tab)
□ Release auto-created with all platform binaries + latest.json
□ Tested: old version auto-downloads and installs the update
```

### (Alternative) Local Build

If you prefer to build locally instead of CI:

```bash
# Set the signing key environment variables
export TAURI_SIGNING_PRIVATE_KEY=$(cat ~/.tauri/obs-church-studio.key)
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="your-password"

# Build the production binary (signed for auto-update)
npm run tauri build
```

Then manually create a GitHub Release and attach the binaries + `.sig` files from `src-tauri/target/release/bundle/`.

---

## Updating App Icons

Tauri requires specific icon sizes for each platform. To update the app icon:

### Step 1: Prepare a Source Icon

You need a **single PNG image** at **1024×1024 pixels** (square, with transparency if desired).

### Step 2: Generate All Required Sizes

Use the Tauri CLI to auto-generate all sizes from your source image:

```bash
# Navigate to the project root
cd /path/to/obs-multiview

# Generate icons from a 1024x1024 source PNG
npx tauri icon /path/to/your-icon-1024x1024.png
```

This automatically creates all required files in `src-tauri/icons/`:
- `32x32.png`
- `128x128.png`
- `128x128@2x.png` (256×256)
- `icon.ico` (Windows)
- `icon.icns` (macOS)
- `icon.png` (512×512, Linux)
- Various `Square*.png` (Windows Store)
- `StoreLogo.png`

### Step 3: Rebuild

```bash
npm run tauri build
```

The new icons will be embedded in the `.dmg`, `.exe`, and `.AppImage` bundles.

> **Note**: The icons in `src/app_icons/` (Android/iOS sizes) are for mobile — they are NOT used by Tauri desktop builds. Only icons in `src-tauri/icons/` matter for the desktop app.

---

## App Structure

### Standard Layout
- **Left Sidebar** — Navigation (Dashboard, Bible, Scenes, Templates, Settings)
- **Center** — Working area (editor canvas, verse list, scene slots)
- **Right** — Preview / Properties / Controls

### Separation of Concerns
- **Bible Page** — Verse search, theme editor, slide preview, push to OBS
- **Layout Page** — Multi-view editor, slot-based canvas, drag scenes into slots

Bible generates content. Layout places content.

### Slot System
Each layout template defines numbered slots. Each slot accepts:
- OBS Scene
- Bible Output
- Camera Scene
- Media / Image
- Worship Output (future)

Slots auto-resize content to fill frame. No dragging outside boundaries.

---

## Updater Security

Do **not** embed GitHub Personal Access Tokens (PATs) in frontend/client code.

Recommended production setup:
1. Keep release artifacts and `latest.json` publicly readable.
2. Use Tauri updater signature verification (`pubkey`) to validate integrity.
3. If releases must stay private, use a backend/proxy that injects auth server-side.  
   Never ship long-lived repository tokens inside the app binary.

---

## Update Signing Key

The auto-updater uses a keypair to verify update authenticity:

- **Private key**: `~/.tauri/obs-church-studio.key` (NEVER share this)
- **Public key**: Embedded in `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`

### CI Setup (Required Once)

Add these as **repository secrets** in GitHub → Settings → Secrets and variables → Actions:

| Secret Name | Value |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | Contents of `~/.tauri/obs-church-studio.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password you used when generating the key |

### If You Lose the Key

You'll need to generate a new keypair and push an update that all users must manually download:

```bash
npx tauri signer generate -w ~/.tauri/obs-church-studio.key
```

Then update the `pubkey` in `tauri.conf.json` with the new public key and update the GitHub secrets.

---

## License

MIT
