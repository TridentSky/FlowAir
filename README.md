# FlowAir - Professional 24/7 Broadcast Playout System

**Version**: 1.1.0
**Platform**: Windows 11/10
**Architecture**: Electron + React + Python FastAPI + FFmpeg
**Developer**: Trident Sky © 2025

> The app version is shown under the brand in the header. Single source of truth:
> `frontend/package.json` `version` (also used by electron-builder). Bump it to release;
> tag releases as `vX.Y.Z`.

---

## 🆕 Changelog

### 1.1.0
- **24/7 stability**: VU meter rewritten to client-side Web Audio API (removed the FFmpeg
  subprocess that ran every ~30ms); `validation_cache` capped; dead resource code removed.
- **UI**: full Windows 11 Fluent redesign (shared theme tokens + Segoe UI), more compact and
  consistent; smoother playlist drag; fixed the post-reorder selection bug; modals no longer
  dim the background.
- **OBS**: program scene switching + transitions in playlist events, inline editing of OBS
  events (double-click), and a clearer insert flow.
- **Versioning**: version displayed in-app, sourced from `package.json`.

### 1.0.0
- Initial release.

---

## ⚠️ Development Guidelines

**CRITICAL - Code Quality Standards:**

1. **NO console.log() or print() statements** - Production code must be clean
2. **NO comments in code** - Code must be self-explanatory and modular
5. **Clean architecture** - No zombie processes, proper cleanup, no memory leaks

These rules are **MANDATORY** and must be followed in all development work.

---

## 📋 Table of Contents

1. [Project Overview](#project-overview)
2. [System Architecture](#system-architecture)
3. [Key Features](#key-features)
4. [Technical Stack](#technical-stack)
5. [Installation & Setup](#installation--setup)
6. [Project Structure](#project-structure)
7. [User Guide](#user-guide)
8. [Core Logic & Algorithms](#core-logic--algorithms)
9. [API Documentation](#api-documentation)
10. [Performance Optimizations](#performance-optimizations)
11. [Troubleshooting](#troubleshooting)

---

## 🎯 Project Overview

**FlowAir** is a professional broadcast playout system designed for **24/7 continuous operation** in TV stations, streaming platforms, and broadcast environments.

### Core Capabilities

- **Absolute Time Scheduling**: Zero drift guarantee even after 7+ days of continuous operation
- **Intelligent Drift Correction**: Automatically compensates for timing delays
- **Real-Time Playlist Management**: Drag & drop editing while broadcasting
- **Multi-Format Support**: Videos, images, STOP events, notes, OBS automation events
- **External Display Output**: Native HDMI output to dedicated displays (like OBS projector)
- **OBS Player Integration**: Clean `/player` URL for browser source capture
- **OBS WebSocket Control**: Optional module to control OBS scene sources directly from playlist events and a manual control panel
- **Optimized for Scale**: Handles 24-48 hour playlists with thousands of items

### Why FlowAir?

Traditional playout systems accumulate timing drift during extended operations. FlowAir uses an **absolute time scheduling algorithm** that:

1. Calculates all start times as absolute timestamps when playlist begins
2. Detects drift in real-time (e.g., video starts 2 seconds late)
3. Compensates by adjusting subsequent video end times (next video ends 2 seconds early)
4. **Result**: Perfect timing maintained across multi-day broadcasts

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  OPERATOR INTERFACE (Electron + React)                      │
│  ┌─────────────────────┬─────────────────────────────────┐  │
│  │ Playlist Management │ Preview Panel (Muted)          │  │
│  │ - Drag & drop       │ - Shows current playing video  │  │
│  │ - Add/Remove items  │ - Synchronized with /player    │  │
│  │ - STOP/NOTE events  │ - Real-time updates            │  │
│  │ - Copy/Paste/Undo   │                                │  │
│  └─────────────────────┴─────────────────────────────────┘  │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ Controls: Play/Stop/Next/CUE | Timer | ON AIR Indicator││
│  └─────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────┐│
│  │ External Display Output (Optional)                      ││
│  │ - Select HDMI output display                            ││
│  │ - Fullscreen window with always-on-top                  ││
│  │ - No cursor, no UI elements                             ││
│  └─────────────────────────────────────────────────────────┘│
└──────────────────────┬──────────────────────────────────────┘
                       │ REST API + WebSockets
                       ↓
┌─────────────────────────────────────────────────────────────┐
│  BACKEND (Python + FastAPI)                                 │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ Playlist Manager: Absolute Scheduling System            ││
│  │ - Calculate all start times as absolute timestamps      ││
│  │ - Detect drift in real-time (30ms monitoring loop)      ││
│  │ - Adjust video end times to compensate drift            ││
│  │ - Maintain perfect timing across multi-day playlists    ││
│  │ - Pre-emptive next (500ms before scheduled end)         ││
│  └─────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────┐│
│  │ File Validator: FFprobe Validation                      ││
│  │ - Validate all files on import (format, codec, size)    ││
│  │ - Detect corrupted/incomplete/downloading files         ││
│  │ - Cache validation results (no re-validation)           ││
│  │ - Mark corrupted files RED (auto-skip during playback)  ││
│  └─────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────┐│
│  │ Video Streaming: FFmpeg Processing                      ││
│  │ - Stream current video only (not entire playlist)       ││
│  │ - 1MB chunks for Full HD quality (60fps)                ││
│  │ - Hardware acceleration enabled                         ││
│  │ - Auto-cleanup of file handles and memory               ││
│  └─────────────────────────────────────────────────────────┘│
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTP Stream (1920x1080p)
                       ↓
┌─────────────────────────────────────────────────────────────┐
│  /player URL (Browser Fullscreen) - For OBS Capture        │
│  http://localhost:8000/player                               │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ - Clean HTML5 video player (no UI, no controls)        ││
│  │ - WebSocket real-time sync (play/pause/next events)   ││
│  │ - HTTP polling every 200ms (elapsed time fine-tuning)  ││
│  │ - Auto-corrects drift >0.5s for perfect sync          ││
│  │ - Initial state load on connection (no black screen)  ││
│  │ - Close/reopen browser → instant synchronization      ││
│  │ - Full audio enabled for OBS capture                   ││
│  │ - Configurable resolution and aspect ratio             ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

---

## ✨ Key Features

### 1. Absolute Time Scheduling

**Problem**: Traditional systems calculate start times based on duration accumulation, causing drift.

**FlowAir Solution**:
- All start times calculated as **absolute timestamps** at playlist start
- Example: Video 1 at 7:00 PM, Video 2 at 7:20 PM, Video 3 at 7:35 PM
- If Video 1 starts 2 seconds late (7:00:02 PM), system detects drift
- System ends Video 1 at 7:19:58 PM (2 seconds early)
- Video 2 starts **exactly** at 7:20:00 PM (drift corrected)

**Guarantee**: <100ms drift after 24+ hours of continuous operation

### 2. External Display Output (NEW)

Native HDMI output system with professional broadcast features:

**Features**:
- Detect all connected displays automatically
- Open fullscreen window on selected display
- Always-on-top (even when cursor passes over)
- No taskbar presence (skipTaskbar: true)
- Cursor completely hidden (no visual interference)
- Clean shutdown when closing FlowAir
- Configuration persists across sessions

**How to Use**:
1. Open Settings → Output tab
2. Enable "External Output"
3. Select target display from dropdown
4. Click "Apply External Output"
5. Fullscreen window opens on selected display
6. To close: Press `Ctrl+Shift+E` from anywhere (global shortcut)

**Advantages over OBS Browser Source**:
- No OBS dependency
- Lower latency
- Direct hardware rendering
- Simpler setup for operators

### 3. Intelligent Playlist Management

**Drag & Drop**:
- Reorder items with smart 50% split detection (like Windows Explorer)
- Drop items at exact position (above/below based on cursor)
- Multi-select drag: move multiple items together maintaining order
- Duplicate with Ctrl+Drag

**Keyboard Shortcuts**:
- `Space`: Play/Pause
- `N`: Next (or jump to selected video/image — skips STOP/NOTE items)
- `S`: Stop (pause current video)
- `Delete`: Remove selected items
- `Ctrl+C/Ctrl+V`: Copy/Paste items
- `Ctrl+Z`: Undo last action
- `Enter`: CUE (position video at frame 0, ready to play)
- `Home/End`: Jump to first/last item
- `Arrow Up/Down`: Navigate playlist
- `Ctrl+Shift+E`: Close external output window (**global** — works from anywhere, even when output covers screen)

**Time Format Toggle**:
- Button in Controls: "12:00" ↔ "24:00"
- Switches between 12-hour (7:30:00 PM) and 24-hour (19:30:00) formats
- Persists across sessions (localStorage)
- Applies to all items: videos, STOP events, NOTEs

**Smart NEXT**:
- If 1 item selected: Jump to that video (CUE + PLAY)
- If multiple/none selected: Advance to next sequentially
- If current playing video selected: Skip to next (don't repeat)

### 4. Multi-Item Types

**Videos**:
- Supported formats: MP4, AVI, MOV, MKV, WMV, FLV, WebM, MPEG
- Auto-validation with FFprobe
- Corrupted files marked RED (auto-skipped during playback)
- Individual loop toggle per video
- Duration displayed in mm:ss format

**Images**:
- Supported formats: JPG, PNG, BMP, WebP, TIFF, GIF
- Force-stretched to 1920x1080 (no aspect ratio preservation)
- Static behavior: requires manual advance (press N)

**STOP EVENT**:
- Red row inserted into playlist
- When playback reaches STOP: video freezes on last frame
- Manual intervention required to continue (press Play)
- Use case: Commercial breaks, operator cues

**NOTE**:
- Blue row with custom text (e.g., "Commercial Break")
- Videos play through NOTEs (no interruption)
- Visual reference for operators

**OBS EVENT** (requires OBS WebSocket integration enabled):
- Blue-themed row (`#1a2a3a` background, `#88bbff` text)
- Controls OBS scene source visibility (show/hide)
- Displays: `OBS: SHOW/HIDE "source" in "scene"`
- Executes instantly during playback, then advances to next item
- If OBS disconnected: skips silently (like a note)
- Supports copy/paste/drag/save/load like all other item types
- Insert via right-click context menu (only when OBS connected)

### 5. Real-Time Synchronization

**Dual-System Sync Architecture**:
- **WebSocket**: Handles critical events (play, pause, stop, next, cue)
- **HTTP Polling (200ms)**: Fine-tunes elapsed time for drift correction
- **Thread-safe Broadcast**: Force timing loop communicates with async event loop
- **Initial State Load**: Players sync immediately on connection (no black screen)

**Preview Panel** (Operator UI):
- Muted video player (iframe to localhost:8000/player?muted=1)
- Shows current playing video
- 100% synchronized with external output and /player
- Updates in real-time via WebSocket + HTTP polling

**External Output & /player URL** (OBS/Broadcast):
- Full audio enabled
- WebSocket for instant playback control
- HTTP polling every 200ms for elapsed time sync
- Auto-corrects drift >0.5 seconds
- Initial state loads on connection
- Survives browser close/reopen (instant re-sync)

**Broadcast System**:
- Playlist changes broadcast instantly to all connected clients
- Force timing loop triggers broadcasts via thread-safe callback
- Only sends updates when state changes (optimized CPU/network)
- Prevents race conditions with isLoadingNewItem flag

### 6. File Validation System

**On Import**:
- FFprobe validates: format, codec, duration, size
- Files downloading/incomplete: marked CORRUPTED
- Corrupted files: RED background, cannot play
- Valid files: checkmark appears immediately

**Validation Cache**:
- Results cached by filepath
- Re-importing same file: instant validation (no re-check)
- Missing files: marked CORRUPTED (not deleted from playlist)
- Operators see RED files to diagnose issues

**Auto-Skip During Playback**:
- Corrupted files skipped automatically (like NOTEs)
- No interruption to broadcast
- Logged in Activity Log

### 7. Performance Optimization (24/7 Operation)

**Memory Management**:
- Only current video file handle open
- Previous video handles closed after playback
- Cleanup loop every 60 seconds: threads, files, garbage collection
- Audio threads properly terminated (no leaks)

**CPU Optimization**:
- Validation cache prevents redundant FFprobe calls
- WebSocket broadcasts only on state changes (not every second)
- Force timing loop: 30ms interval (minimal overhead)
- Active validations set: prevents concurrent validation of same file

**Benchmarks**:
- Idle: 5-10% CPU
- Playing: 10-20% CPU
- 48+ hours continuous: CPU/memory stable (no degradation)
- Long playlists (1000+ videos): No performance impact

### 8. Settings Panel (Tabbed Layout)

Settings modal uses a **4-tab layout** for cleaner organization:

**Tab 1 - Video**:
- Resolution: 1280x720, 1920x1080 (default), 2560x1440, 3840x2160
- Aspect Ratio: 16:9, 4:3, 21:9, 1:1, 9:16 (vertical)
- Scaling Mode: Stretch, Fit, Fill
- Apply Video Settings button (applies changes in real-time to external output)

**Tab 2 - Output**:
- Enable/Disable External Output toggle
- Display selection dropdown with detailed info (name, resolution, primary indicator)
- Status indicator when active (green pulsing dot)
- Ctrl+Shift+E global shortcut to close external output from anywhere
- Apply External Output button

**Tab 3 - Network**:
- Local Player: Always available at localhost:8000/player
  - Recommended for OBS on same PC (fast, robust, low-latency)
  - Copy button for quick access
- Network Player: Optional, requires Enable Network Streaming toggle
  - Auto-detected Local IP and port
  - Player URL ready to copy (e.g., `http://192.168.0.106:8000/player`)
  - Backend security: External IPs blocked when disabled (403 Forbidden)
  - Use cases: OBS on separate PC, mobile monitoring
- Apply Network Streaming button

**Tab 4 - OBS** (OBS WebSocket Integration):
- Enable/Disable OBS integration toggle
- Host (default: localhost), Port (default: 4455), Password fields
- Connection status indicator (green = connected, red = error with message)
- Connect/Apply button
- When enabled and connected: OBS Control Panel appears below Preview in main UI

**General**:
- Each tab has its own independent Apply button
- Settings saved to localStorage (frontend) and synced with backend
- Persists across restarts
- Reset to Factory button always visible (resets all settings including OBS)
- Close modal with X button (top-right) or Esc key

### 9. OBS WebSocket Integration (Optional Module)

FlowAir integrates with OBS Studio via the obs-websocket protocol (v5.x, port 4455) to control scene source visibility from playlist events and a manual control panel. Disabled by default.

**Setup**:
1. Enable obs-websocket in OBS Studio (Tools → obs-websocket Settings)
2. Open FlowAir Settings → OBS tab
3. Enable OBS integration, enter host/port/password
4. Click Connect/Apply
5. Status turns green when connected

**OBS Control Panel** (below Preview, right panel):
- Scene selector dropdown (all OBS scenes)
- Source list with VISIBLE/HIDDEN toggle buttons per source
- Manual show/hide control for any source in any scene
- Only visible when OBS is enabled AND connected

**OBS Playlist Events**:
- Right-click playlist → "Insert OBS Event" (only when connected)
- Modal: Select Scene → Source → Action (Show/Hide)
- Event inserted into playlist with blue styling
- During playback: executes show/hide via WebSocket, then advances
- If OBS disconnected: skips silently (no error, no interruption)

**Persistence**:
- OBS settings saved to localStorage + backend (auto-restored on restart)
- OBS events saved in .flowair playlist files
- Copy/paste/drag/delete/undo all work with OBS events

**Architecture**:
- Backend: `obs_controller.py` — self-contained controller with `threading.Lock`
- Uses `obsws-python==1.8.0` library (sync client)
- Thread-safe: called from `_force_timing_loop` daemon thread via callback
- All methods fail gracefully (empty lists or `{"success": False}` on error)

**OBS Event Playlist Item Schema**:
```json
{
  "id": 123,
  "name": "OBS EVENT",
  "type": "obs",
  "obs_scene": "Scene Name",
  "obs_source": "Source Name",
  "obs_action": "show"
}
```

**OBS API Endpoints**:

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/obs/settings` | Get OBS config |
| POST | `/obs/settings` | Save OBS config |
| POST | `/obs/connect` | Connect to OBS |
| POST | `/obs/disconnect` | Disconnect from OBS |
| GET | `/obs/status` | Connection status (pings OBS) |
| GET | `/obs/scenes` | List OBS scenes |
| GET | `/obs/scenes/{name}/sources` | List sources in scene |
| POST | `/obs/source/visibility` | Manual show/hide source |
| POST | `/playlist/insert_obs_event` | Insert OBS event in playlist |

---

## 🛠️ Technical Stack

### Frontend
- **Electron**: Desktop application framework
- **React**: UI components
- **Vite**: Build tool and dev server
- **WebSocket**: Real-time updates from backend
- **IPC (Inter-Process Communication)**: Electron main ↔ renderer

### Backend
- **Python 3.11+**: Core language
- **FastAPI**: REST API framework
- **Uvicorn**: ASGI server
- **FFmpeg**: Video processing and streaming
- **FFprobe**: File validation
- **obsws-python**: OBS WebSocket v5 client (optional, for OBS integration)
- **Threading**: Force timing, cleanup, audio levels, OBS control

### Video Processing
- **FFmpeg**: H.264 encoding, hardware acceleration
- **Chunk Streaming**: 1MB chunks for HD quality
- **Hardware Acceleration**: GPU support for encoding

---

## 📦 Installation & Setup

### Prerequisites

1. **Node.js** (v18.x or higher)
   - Download: https://nodejs.org/
   - Verify: `node --version`

2. **Python** (v3.11 or higher)
   - Download: https://www.python.org/
   - **IMPORTANT**: Check "Add Python to PATH" during installation
   - Verify: `python --version`

3. **FFmpeg** (REQUIRED for video processing)

   **Option 1: Project Folder (Recommended)**
   - Download: https://github.com/BtbN/FFmpeg-Builds/releases
   - Look for: `ffmpeg-master-latest-win64-gpl.zip`
   - Extract to: `[FlowAir Project]/ffmpeg/`
   - Expected structure:
     ```
     FlowAir/
     ├── ffmpeg/
     │   ├── bin/
     │   │   ├── ffmpeg.exe
     │   │   ├── ffprobe.exe
     │   │   └── ffplay.exe
     ```

   **Option 2: System-Wide**
   - Install FFmpeg and add to Windows PATH

### First-Time Setup

1. **Extract FlowAir** to desired location (e.g., `C:\FlowAir\`)

2. **Run START.bat** (double-click)
   - Script will automatically:
     - ✅ Check Node.js and Python installation
     - ✅ Check FFmpeg availability
     - ✅ Create Python virtual environment (`backend/venv/`)
     - ✅ Install Python dependencies (FastAPI, Uvicorn, etc.)
     - ✅ Install Node.js dependencies (`frontend/node_modules/`)
     - ✅ Launch backend server (port 8000)
     - ✅ Launch Vite dev server (port 3000)
     - ✅ Open Electron application

3. **System is Ready** when you see:
   ```
   ========================================
        FlowAir is now running!
   ========================================
   ```

### Subsequent Launches

**Option 1: FlowAir.vbs** (Recommended - Silent Launch)
- Double-click `FlowAir.vbs`
- Launches without console windows
- Detects if already running (prevents duplicates)
- Clean, professional startup

**Option 2: START.bat** (With Console Logs)
- Shows detailed logs for debugging
- Useful for troubleshooting

### What START.bat Does

**[STEP 1/8] Checking System Requirements**
- Verifies Node.js installed (displays version)
- Verifies Python installed (displays version)
- Exit if missing with download instructions

**[STEP 2/8] Checking FFmpeg**
- Searches project folder: `ffmpeg/bin/ffmpeg.exe`
- Falls back to system PATH
- Verifies FFmpeg works correctly
- Warns if missing (system continues but validation won't work)

**[STEP 3/8] Setting up Python Virtual Environment**
- Creates `backend/venv/` if not exists
- Activates virtual environment
- Isolated Python dependencies

**[STEP 4/8] Installing Python Dependencies**
- Checks if FastAPI already installed (skip if exists)
- Installs from `requirements.txt`
- Auto-retries with `--no-cache-dir` on failure
- Verifies psutil (required for cleanup)

**[STEP 5/8] Installing Node.js Dependencies**
- Checks if `node_modules/` exists (skip if exists)
- Runs `npm install`
- Auto-retries with cache clean on failure
- Verifies Electron and Vite installed

**[STEP 6/8] Cleaning Previous Processes**
- Kills previous Python/Node/Electron processes
- Cleans ports 3000 and 8000
- Removes stale lock file
- Ensures clean startup

**[STEP 7/8] Configuring Windows Firewall**
- Checks if firewall rule "FlowAir Backend" exists
- Creates rule automatically for port 8000 (TCP inbound)
- Enables network streaming to other devices on local network
- Shows warning if admin permissions needed

**[STEP 8/8] Starting FlowAir**
- Launches Python backend (FastAPI server on port 8000)
- Launches Vite dev server (port 3000)
- Opens Electron application
- All processes synchronized

---

## 📁 Project Structure

```
FlowAir/
│
├── START.bat                      # Main launcher (automatic setup + run)
├── FlowAir.vbs                    # Silent launcher (no console windows)
├── README.md                      # Complete documentation
│
├── assets/                        # Application assets
│   └── flowair.png                # Application icon
│
├── ffmpeg/                        # FFmpeg binaries (user must provide)
│   └── bin/
│       ├── ffmpeg.exe             # Video processing
│       ├── ffprobe.exe            # File validation
│       └── ffplay.exe             # (optional)
│
├── backend/                       # Python FastAPI backend
│   ├── main.py                    # FastAPI server + endpoints + player HTML
│   ├── playlist_manager.py        # Core playlist logic + absolute scheduling (timing core)
│   ├── file_validator.py          # FFprobe file validation
│   ├── obs_controller.py          # OBS WebSocket controller (scenes, transitions, sources)
│   ├── config.py                  # Configuration constants
│   ├── requirements.txt           # Python dependencies
│   └── venv/                      # Auto-created by START.bat (safe to delete)
│
└── frontend/                      # Electron + React frontend
    ├── package.json               # Node.js dependencies + scripts
    ├── vite.config.js             # Vite configuration (port 3000)
    ├── index.html                 # Vite entry point + global CSS
    │
    ├── src/
    │   ├── main.js                # Electron main process
    │   │                          # - Window creation + IPC handlers
    │   │                          # - External output window (alwaysOnTop)
    │   │                          # - Global shortcut (Ctrl+Shift+E)
    │   │
    │   ├── App.jsx                # Main React component (~2100 lines)
    │   │                          # - All state management
    │   │                          # - WebSocket connection
    │   │                          # - Keyboard shortcuts
    │   │                          # - Settings modal (tabbed)
    │   │
    │   ├── api.js                 # Backend API client
    │   │                          # - REST endpoints + WebSocket
    │   │                          # - Exponential backoff reconnection
    │   │
    │   └── components/
    │       ├── Playlist.jsx       # Playlist table (drag & drop, multi-select)
    │       ├── Preview.jsx        # Video preview (muted, synced)
    │       ├── Controls.jsx       # Play/Stop/Next/CUE buttons
    │       ├── Timer.jsx          # Countdown timer + progress bar
    │       ├── LiveIndicator.jsx  # ON AIR / OFF AIR indicator
    │       └── ActivityLog.jsx    # Activity log (last 50 events)
    │
    ├── dist/                      # ⚠️ Production build (auto-created by npm run build)
    │                              # DELETE this folder during development!
    │                              # Electron loads dist/ instead of Vite dev server
    │                              # if it exists, causing code changes to not appear.
    │
    └── node_modules/              # Auto-created by npm install (safe to delete)
```

> **⚠️ IMPORTANT - Development vs Production**: Electron's main process checks if `frontend/dist/index.html` exists. If it does, it loads the static build instead of the Vite dev server at `localhost:3000`. During development, **always delete `frontend/dist/`** to ensure code changes are reflected immediately. Only create `dist/` for production builds with `npm run build`.

---

## 📖 User Guide

### Starting FlowAir

1. **Double-click `FlowAir.vbs`** (recommended - silent launch)
   - OR double-click `START.bat` (shows console logs)

2. **Wait for initialization** (first launch takes 2-3 minutes)
   - Dependencies auto-install
   - Backend starts on port 8000
   - Frontend starts on port 3000
   - Electron window opens

3. **Interface loads**
   - Left panel: Playlist
   - Right panel: Preview + Controls
   - Bottom: Activity Log (collapsed by default)

### Adding Videos

**Method 1: Drag & Drop**
- Drag video files from Windows Explorer
- Drop directly onto playlist area
- Files validate automatically (checkmark appears)

**Method 2: File Dialog**
- Click playlist area to trigger file selector
- Select multiple files (Ctrl+Click)
- Supported formats: MP4, AVI, MOV, MKV, WMV, FLV, WebM

**Method 3: Copy/Paste**
- Select items in playlist (Ctrl+Click)
- Press `Ctrl+C` to copy
- Press `Ctrl+V` to paste below current selection

### Basic Playback

1. **CUE**: Select video, press `Enter` (or click CUE button)
   - Video positioned at frame 0
   - Ready to play (paused state)

2. **PLAY**: Press `Space` (or click PLAY button)
   - Video starts playing
   - ON AIR indicator turns green
   - Preview updates in real-time

3. **PAUSE/STOP**: Press `S` (or click STOP button)
   - Video pauses at current frame
   - Start times freeze (no time progression)

4. **NEXT**: Press `N` (or click NEXT button)
   - Advances to next video in sequence
   - If video selected: jumps to that video
   - If current video selected: skips to next (doesn't repeat)

### Advanced Operations

**Reordering Items**:
- Drag video to new position
- Smart 50% split: cursor above midpoint → insert above, below → insert below
- Blue line shows insert position

**Multi-Select**:
- `Ctrl+Click`: Toggle selection
- `Shift+Click`: Select range (Windows Explorer style)
- Drag multiple items together (maintains order)

**Inserting STOP Events**:
- Right-click playlist → "Insert STOP Event"
- Inserts below selected item (or at end if none selected)
- Red row appears with calculated start time
- Playback freezes when reaching STOP

**Inserting NOTEs**:
- Right-click playlist → "Insert Note"
- Type note text (e.g., "Commercial Break")
- Blue row appears
- Videos play through NOTEs (no interruption)

**Inserting OBS Events** (requires OBS connected):
- Right-click playlist → "Insert OBS Event"
- Select Scene, Source, and Action (Show/Hide) in modal
- Blue-themed row appears showing the OBS command
- During playback: executes the OBS command, then advances
- Press Enter to confirm, Escape to cancel

**Enabling Video Loop**:
- Click 🔁 button on video row
- Button turns purple with glow
- Video repeats infinitely when it ends
- Click again to disable

**Time Format Toggle**:
- Click "12:00" or "24:00" button in Controls
- Switches all times between formats:
  - 12-hour: 7:30:00 PM
  - 24-hour: 19:30:00
- Preference saved automatically

**Undo Last Action**:
- Press `Ctrl+Z`
- Restores last: delete, paste, reorder, insert STOP/NOTE/OBS Event
- Single-level undo (one action back)

### External Display Output

**Setup**:
1. Click ⚙️ icon (top-right) → "Settings"
2. Enable "External Output" checkbox
3. Select display from dropdown (e.g., "Monitor 2 - 1920x1080")
4. Click "Apply Changes" (blue button)

**Result**:
- Fullscreen window opens on selected display
- Always-on-top (even when cursor passes over)
- No cursor visible
- No taskbar presence
- Video plays synchronized with Preview

**Closing**:
- Disable "External Output" in settings → Click "Apply Changes"
- OR close FlowAir (auto-closes external window)

**Advantages**:
- No OBS required
- Lower latency
- Direct hardware rendering
- Simpler setup

### Network Streaming (NEW)

**Accessing from Other Devices**:

FlowAir supports network streaming, allowing access to `/player` from any device on your local network.

**How to Use**:
1. Open FlowAir → Click ⚙️ "Output" button
2. Scroll to **"Network Streaming"** section
3. See your Local IP and Player URL (e.g., `http://192.168.0.106:8000/player`)
4. Click **"Copy URL"** button
5. Paste URL on any device connected to the same network:
   - Another PC (OBS Browser Source)
   - Smartphone/Tablet (Chrome/Safari)
   - Smart TV (browser)
   - Laptop on same WiFi

**Automatic Setup**:
- Windows Firewall configured automatically by START.bat
- IP address auto-detected each time FlowAir starts
- No manual configuration needed

**Use Cases**:
- **OBS on Separate PC**: Reduce CPU load by running OBS on different machine
- **Mobile Monitoring**: View output on phone/tablet while operating FlowAir
- **Quality Control**: Multiple people can monitor stream simultaneously

**Quality**:
- Full HD 1920x1080 @ 60fps
- No quality loss (local network streaming)
- Low latency (<100ms on local network)

### OBS Integration (Alternative)

**Local Browser Source Setup**:
1. OBS → Add Source → Browser
2. URL: `http://localhost:8000/player` (same PC)
3. Width: 1920, Height: 1080
4. Check "Shutdown source when not visible" (optional)
5. Check "Refresh browser when scene becomes active" (optional)

**Network Browser Source Setup** (OBS on different PC):
1. Get URL from FlowAir Settings → Network Streaming
2. OBS → Add Source → Browser
3. URL: `http://YOUR_PC_IP:8000/player` (e.g., `http://192.168.0.106:8000/player`)
4. Width: 1920, Height: 1080

**Result**:
- Clean video feed (no UI)
- Full audio enabled
- Auto-syncs if browser closed/reopened
- Configurable resolution in Settings

### Activity Log

**Purpose**: Shows last 50 events (playback, errors, warnings)

**Usage**:
- Click "Activity Log ▶" to expand
- Shows timestamped events:
  - `[PLAYBACK]` Video started/stopped
  - `[INFO]` Item added/removed
  - `[ERROR]` File not found
- Click "Activity Log ▼" to collapse

**Example**:
```
[12:45:30] [PLAYBACK] Started video: intro.mp4
[12:50:15] [INFO] Item removed from playlist
[12:51:02] [PLAYBACK] Skipped to next item
```

### Start Times Explained

**Automatic Calculation**:
- System calculates all start times when playlist begins
- Based on video durations
- Example:
  ```
  7:00:00 PM - video1.mp4 (20 min)
  7:20:00 PM - video2.mp4 (15 min)
  7:35:00 PM - video3.mp4 (10 min)
  ```

**Pausing Behavior**:
- When paused: all start times FREEZE (no progression)
- When resumed: times recalculate from current moment
- Example: Pause at 7:10 PM for 5 minutes → video2 now starts at 7:25 PM

**Past Items**:
- Videos already played: grayed out (opacity 50%)
- Start times preserved (can reference what time they aired)

**Current Video**:
- Green outline around entire row
- Timer shows remaining time

**Next Video**:
- Yellow background
- Ready to play when current finishes

---

## 🧠 Core Logic & Algorithms

### Absolute Time Scheduling Algorithm

**Traditional System Problem**:
```
Video 1 duration: 1200s
Video 2 start = Video 1 start + 1200s
Video 3 start = Video 2 start + Video 2 duration
...
Accumulated drift: Each calculation adds 10-50ms overhead
Result: 10 seconds drift after 24 hours
```

**FlowAir Solution**:
```python
# Step 1: Calculate all start times as absolute timestamps
playlist_start_time = datetime.now()  # e.g., 2025-01-01 19:00:00
absolute_start_times = {}

current_time = playlist_start_time
for item in playlist:
    absolute_start_times[item.id] = current_time
    current_time += timedelta(seconds=item.duration)

# Result:
# Video 1: 2025-01-01 19:00:00 (absolute timestamp)
# Video 2: 2025-01-01 19:20:00 (absolute timestamp)
# Video 3: 2025-01-01 19:35:00 (absolute timestamp)
```

**Drift Detection & Correction**:
```python
# Force timing loop (runs every 30ms)
while playing:
    now = datetime.now()

    # Get scheduled start and end times
    scheduled_start = absolute_start_times[current_item.id]
    scheduled_end = scheduled_start + timedelta(seconds=current_item.duration)

    # Detect drift
    actual_start = current_video_start_time
    drift = (actual_start - scheduled_start).total_seconds()

    # Compensate: If 2 seconds late, end 2 seconds early
    adjusted_end = scheduled_end - timedelta(seconds=drift)

    # Check if time to advance
    if now >= adjusted_end:
        next()  # Video ends exactly when next should start

    time.sleep(0.03)  # 30ms loop
```

**Example**:
```
Scheduled:
- Video 1: 19:00:00 - 19:20:00 (20 min)
- Video 2: 19:20:00 - 19:35:00 (15 min)

Reality:
- Video 1 starts at 19:00:02 (2 seconds late)
- Drift detected: +2 seconds
- Video 1 adjusted end: 19:19:58 (2 seconds early)
- Video 1 actual: 19:00:02 - 19:19:58 (19min 56sec)
- Video 2 starts at 19:20:00 EXACTLY (drift corrected)
```

**Result**: <100ms drift after 24+ hours

### File Validation System

**On Import**:
```python
# file_validator.py
def validate_file(filepath):
    # Check 1: File exists
    if not os.path.exists(filepath):
        return {"valid": False, "error": "File not found"}

    # Check 2: File size > 0 (not downloading)
    if os.path.getsize(filepath) == 0:
        return {"valid": False, "error": "File is empty or still downloading"}

    # Check 3: FFprobe validation
    result = subprocess.run([
        'ffprobe', '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'json', filepath
    ], capture_output=True)

    data = json.loads(result.stdout)
    duration = float(data['format']['duration'])

    if duration > 0:
        return {"valid": True, "duration": duration}
    else:
        return {"valid": False, "error": "Invalid video format"}
```

**Validation Cache**:
```python
# Prevents re-validation of same file
validation_cache = {}  # filepath → result

if filepath in validation_cache:
    return validation_cache[filepath]  # Instant result
else:
    result = validate_file(filepath)
    validation_cache[filepath] = result
    return result
```

**Auto-Skip / Auto-Execute During Playback**:
```python
def next():
    while True:
        next_item = playlist[current_index + 1]

        if next_item["status"] == "corrupted":
            current_index += 1
            continue  # Skip corrupted files

        if next_item["type"] == "note":
            current_index += 1
            continue  # Skip notes

        if next_item["type"] == "obs":
            execute_obs_event(next_item)  # Fire OBS command
            current_index += 1
            continue  # Advance after executing

        break  # Valid video found

    play(next_item)
```

### Player Synchronization System

**Dual-Sync Architecture** (WebSocket + HTTP Polling):

FlowAir uses a hybrid synchronization system that combines real-time WebSocket events with lightweight HTTP polling for perfect sync.

**WebSocket (Event-Based)**:
```python
# Backend: Broadcast critical events to all connected players
async def broadcast_update(message: dict):
    for connection in active_connections:
        try:
            await connection.send_json(message)
        except:
            pass

# Example: Manual next() call
@app.post("/player/next")
async def next_item():
    playlist_manager.next()
    await broadcast_update({
        "type": "playback_state_changed",
        "current_item": playlist_manager.get_current_item(),
        "is_playing": playlist_manager.is_playing
    })
```

**Thread-Safe Callback (Force Timing Loop)**:
```python
# Problem: _force_timing_loop() runs in threading.Thread, not asyncio
# Solution: Callback that bridges threading → asyncio

# Global event loop reference
main_event_loop = None

# Callback registered in playlist_manager
def handle_playback_change(data):
    if main_event_loop:
        asyncio.run_coroutine_threadsafe(broadcast_update(data), main_event_loop)

# In playlist_manager.py
def next(self, from_force_timing=False):
    # ... update state ...

    if self.on_playback_change:
        self.on_playback_change({
            "type": "playback_state_changed",
            "current_item": self.get_current_item(),
            "is_playing": self.is_playing
        })
```

**HTTP Polling (Drift Correction)**:
```javascript
// Player HTML: Poll every 200ms for elapsed time fine-tuning
function syncElapsed() {
    if (isLoadingNewItem) return;  // Skip during video load

    fetch('/player/state')
        .then(res => res.json())
        .then(data => {
            if (!data.current_item || data.current_item.type !== 'video') return;

            // Only sync if same video is playing
            if (currentItemId === data.current_item.id && data.is_playing && !video.paused) {
                const drift = Math.abs(video.currentTime - data.elapsed);
                if (drift > 0.5) {  // Threshold: 0.5 seconds
                    video.currentTime = data.elapsed;
                }
            }
        });
}

setInterval(syncElapsed, 200);  // 5Hz polling
```

**Initial State Load**:
```javascript
// Player HTML: Load current state immediately on connection
ws.onopen = () => {
    fetch('/player/state')
        .then(res => res.json())
        .then(data => {
            handlePlaybackState(data);  // Load video immediately
        });
};
```

**Race Condition Prevention**:
```javascript
// Flag to prevent conflicts during video load
let isLoadingNewItem = false;

function handlePlaybackState(data) {
    const isNewItem = currentItemId !== item.id;

    if (isNewItem) {
        isLoadingNewItem = true;
        video.pause();
        video.style.display = 'none';  // Hide old frame

        video.src = '/stream/' + item.id;
        video.load();
        currentItemId = item.id;

        video.addEventListener('loadeddata', () => {
            video.currentTime = 0;
            video.style.display = 'block';  // Show when ready
            isLoadingNewItem = false;
            if (data.is_playing) video.play();
        }, { once: true });
    }
}
```

**Result**:
- **Play/Pause/Next**: Instant response via WebSocket (<50ms)
- **Elapsed Time**: Corrected every 200ms via HTTP polling
- **Force Timing**: Broadcasts automatically when video ends
- **No Black Screen**: Initial state loads immediately
- **No Frozen Frames**: Video hides during load, shows when ready
- **Perfect Sync**: Preview, External Output, and /player stay aligned

**Frontend Handling**:
```javascript
// Prevent flicker during batch operations
const pauseWebSocketUpdates = useRef(false)

// Example: Delete multiple items
pauseWebSocketUpdates.current = true
await deleteItems(selectedIds)
const updatedPlaylist = await api.getPlaylist()
setPlaylist(updatedPlaylist)
pauseWebSocketUpdates.current = false

// WebSocket listener
ws.onmessage = (event) => {
    if (pauseWebSocketUpdates.current) return  // Ignore

    const data = JSON.parse(event.data)
    updateState(data)  // Apply update
}
```

---

## 🔌 API Documentation

### Base URL
```
http://localhost:8000
```

### REST Endpoints

#### **GET /playlist**
Get current playlist state.

**Response**:
```json
{
  "playlist": [
    {
      "id": 1,
      "type": "video",
      "name": "intro.mp4",
      "path": "C:\\Videos\\intro.mp4",
      "duration": 120.5,
      "duration_formatted": "2:00",
      "start_time": "7:00:00 PM",
      "status": "valid",
      "loop": false
    },
    {
      "id": 2,
      "type": "stop",
      "start_time": "7:02:00 PM"
    },
    {
      "id": 3,
      "type": "note",
      "text": "Commercial Break",
      "start_time": "7:02:00 PM"
    }
  ],
  "current_index": 0,
  "is_playing": true,
  "is_paused": false
}
```

#### **POST /playlist/add**
Add video/image to playlist.

**Request**:
```json
{
  "filepath": "C:\\Videos\\video.mp4",
  "insertIndex": 2
}
```

**Response**:
```json
{
  "message": "Item added",
  "item": {
    "id": 4,
    "type": "video",
    "name": "video.mp4",
    "duration": 300.0
  }
}
```

#### **POST /playlist/remove**
Remove item from playlist.

**Request**:
```json
{
  "item_id": 4
}
```

#### **POST /playlist/reorder**
Reorder items in playlist.

**Request**:
```json
{
  "item_id": 3,
  "new_index": 0,
  "is_duplicate": false
}
```

#### **POST /playlist/clear**
Clear entire playlist.

**Response**:
```json
{
  "message": "Playlist cleared"
}
```

#### **POST /playlist/insert_stop**
Insert STOP event.

**Request**:
```json
{
  "index": 2
}
```

#### **POST /playlist/insert_note**
Insert NOTE.

**Request**:
```json
{
  "index": 2,
  "text": "Commercial Break"
}
```

#### **POST /playlist/insert_obs_event**
Insert OBS automation event.

**Request**:
```json
{
  "insert_index": 2,
  "obs_scene": "Main Scene",
  "obs_source": "Camera 1",
  "obs_action": "show"
}
```

**Response**:
```json
{
  "success": true,
  "item": { "id": 5, "type": "obs", "obs_scene": "Main Scene", "obs_source": "Camera 1", "obs_action": "show" },
  "item_id": 5
}
```

#### **POST /playlist/toggle_loop**
Toggle loop on video.

**Request**:
```json
{
  "item_id": 1
}
```

**Response**:
```json
{
  "message": "Loop toggled",
  "loop": true
}
```

#### **POST /player/play**
Start playback.

#### **POST /player/stop**
Pause playback (like YouTube pause).

#### **POST /player/next**
Skip to next item.

**Request** (optional):
```json
{
  "from_force_timing": true
}
```

#### **POST /player/cue**
Position video at frame 0, ready to play.

**Request**:
```json
{
  "item_id": 1
}
```

#### **GET /player/state**
Get current playback state (for /player sync).

**Response**:
```json
{
  "current_item": {
    "id": 1,
    "type": "video",
    "name": "intro.mp4"
  },
  "is_playing": true,
  "elapsed": 45.2
}
```

#### **GET /stream/{item_id}**
Stream video file (chunked).

**Response**: Binary video stream (1MB chunks)

#### **GET /image/{item_id}**
Serve image file.

**Response**: Image binary

#### **GET /player**
HTML player page (for OBS browser source).

**Response**: Full HTML page with video player

#### **GET /output_settings**
Get output settings.

**Response**:
```json
{
  "resolution": "1920x1080",
  "aspectRatio": "16:9",
  "scalingMode": "stretch",
  "quality": "max",
  "externalOutputEnabled": false,
  "selectedDisplayId": null
}
```

#### **POST /output_settings**
Update output settings.

**Request**:
```json
{
  "resolution": "1920x1080",
  "externalOutputEnabled": true,
  "selectedDisplayId": 2
}
```

### WebSocket Endpoint

#### **WS /ws**
Real-time playlist updates.

**Client → Server**:
```json
{
  "type": "subscribe"
}
```

**Server → Client** (broadcast):
```json
{
  "type": "playlist_updated",
  "data": {
    "playlist": [...],
    "current_index": 0,
    "is_playing": true
  }
}
```

---

## ⚡ Performance Optimizations

### Memory Management

**Problem**: Long playlists (1000+ videos) could exhaust memory

**Solutions**:
1. **Stream Current Video Only**: Only current video file handle open
2. **Cleanup Loop** (every 60 seconds):
   - Close file handles for non-current videos
   - Terminate finished threads
   - Clear validation cache for removed files
   - Force garbage collection (`gc.collect()`)
3. **Audio Thread Cleanup**: Properly join audio threads with timeout

**Result**: Memory stable at ~200MB even after 48+ hours

### CPU Optimization

**Problem**: Redundant operations causing high CPU usage

**Solutions**:
1. **Validation Cache**: Skip re-validation of already-validated files
2. **Active Validations Set**: Prevent concurrent validation of same file
3. **WebSocket Broadcast Optimization**: Only send updates when state changes (not every 500ms)
4. **Force Timing Loop**: 30ms interval (minimal overhead)

**Result**: CPU stable at 10-20% during playback

### Network Optimization

**Problem**: Large video files cause buffering

**Solutions**:
1. **Chunked Streaming**: 1MB chunks (was 8KB)
2. **No-Cache Headers**: `Cache-Control: no-cache` for live streaming
3. **Hardware Acceleration**: GPU encoding when available

**Result**: Full HD 60fps without buffering

---

## 🔧 Troubleshooting

### FlowAir Won't Start

**Issue**: Double-clicking START.bat shows error

**Possible Causes**:
1. Node.js not installed
   - **Fix**: Download from https://nodejs.org/
2. Python not installed
   - **Fix**: Download from https://www.python.org/
   - IMPORTANT: Check "Add Python to PATH"
3. Port 8000 or 3000 already in use
   - **Fix**: Close other applications using these ports
   - START.bat auto-kills processes on these ports

### Code Changes Not Showing After Edit

**Issue**: Modified source files in `frontend/src/` but changes don't appear in the app

**Cause**: A `frontend/dist/` folder exists with an old production build. Electron loads `dist/index.html` instead of the Vite dev server when this folder is present.

**Fix**:
1. Delete the `frontend/dist/` folder entirely
2. Restart FlowAir with `START.bat`
3. Electron will now load from Vite dev server (`localhost:3000`) with live changes

**Prevention**: Only create `dist/` when building for production (`npm run build`). Delete it before resuming development.

### FFmpeg Not Found

**Issue**: "FFmpeg is not installed" warning

**Fix**:
1. Download: https://github.com/BtbN/FFmpeg-Builds/releases
2. Look for: `ffmpeg-master-latest-win64-gpl.zip`
3. Extract to: `[FlowAir]/ffmpeg/`
4. Ensure structure:
   ```
   FlowAir/
   ├── ffmpeg/
   │   └── bin/
   │       ├── ffmpeg.exe
   │       ├── ffprobe.exe
   ```
5. Restart FlowAir

### Videos Show Black Screen

**Issue**: Videos appear in playlist but show black in Preview/Player

**Possible Causes**:
1. **Corrupted file**: Check if item marked RED
   - **Fix**: Re-download or re-encode video
2. **Unsupported codec**: Old AVI files with DivX/XviD
   - **Fix**: Convert to MP4 with H.264 codec:
     ```
     ffmpeg -i input.avi -c:v libx264 -c:a aac output.mp4
     ```
3. **File still downloading**: Size = 0 bytes
   - **Fix**: Wait for download to complete

### WebSocket Warning on Startup

**Issue**: Console shows "WebSocket connection to 'ws://localhost:8000/ws' failed"

**Status**: Normal behavior during startup

**Explanation**:
- Frontend starts immediately (port 3000)
- Backend takes 1-3 seconds to initialize (port 8000)
- WebSocket attempts connection before backend is ready
- Auto-reconnects with exponential backoff (1s, 2s, 4s, 8s, max 10s)
- No action needed - connection establishes automatically

**When to worry**: If warning persists after 10+ seconds
- **Fix**: Check if backend is running (Task Manager → python.exe)
- **Fix**: Restart FlowAir

### Preview/External Output Shows Black Screen

**Issue**: External output opens but shows black screen, or frozen on last frame

**Status**: Fixed in latest version (2026-01-11)

**Previous Issue**:
- Player HTML had race condition between WebSocket and HTTP polling
- Videos loaded old frame before new video was ready
- Force timing loop didn't broadcast to external output

**Current Behavior**:
- External output loads current video immediately on open
- Videos hide during load, show when ready (no frozen frames)
- Force timing loop broadcasts via thread-safe callback
- Perfect sync between Preview and External Output

**If still occurs**:
2. Close external output window
3. Settings → Reset to Factory → Apply Changes
4. Re-enable external output

### External Output Window Not Opening

**Issue**: Enable external output but no window appears

**Possible Causes**:
1. Display not connected
   - **Fix**: Connect display, restart FlowAir
2. Invalid display ID saved in settings
   - **Fix**: Settings → Reset to Factory → Apply Changes
3. FlowAir already running
   - **Fix**: Close FlowAir completely (check Task Manager for python.exe/node.exe)

### Cursor Visible on External Output

**Issue**: Mouse cursor shows when hovering over external display

**Status**: Should be fixed in latest version
- CSS: `cursor: none !important`
- JavaScript: Forces cursor hidden every 100ms

**If still visible**:
1. Verify FlowAir version
2. Check `frontend/src/main.js` line 119-127 (cursor hiding code)
3. Restart FlowAir

### High CPU Usage

**Issue**: CPU usage 50%+ during playback

**Possible Causes**:
1. Too many validation threads
   - **Fix**: Validation cache should prevent this (check logs)
2. FFmpeg not using hardware acceleration
   - **Fix**: Update GPU drivers
3. Multiple FlowAir instances running
   - **Fix**: Check Task Manager, kill duplicate python.exe/node.exe

**Expected CPU**:
- Idle: 5-10%
- Playing: 10-20%
- Long playlists: 10-20% (no degradation)

### Timing Drift After Hours

**Issue**: Videos start later than scheduled after 6+ hours

**Expected**: <100ms drift after 24 hours (absolute scheduling)

**If drift > 1 second**:
1. Check force timing loop running: Look for logs
2. Verify system clock not adjusting (Windows time sync)
3. Report issue with logs

### Lock File Error on Startup

**Issue**: "FlowAir is already running" when it's not

**Cause**: Stale `.flowair.lock` file from crash

**Fix**:
1. Delete: `[FlowAir]\.flowair.lock`
2. OR: FlowAir.vbs auto-detects and removes stale locks

### Dependencies Not Installing

**Issue**: START.bat fails at "Installing dependencies"

**Possible Causes**:
1. No internet connection
   - **Fix**: Connect to internet, retry
2. Firewall blocking npm/pip
   - **Fix**: Temporarily disable firewall
3. Corrupted npm cache
   - **Fix**: `npm cache clean --force` (START.bat does this automatically)
4. Corrupted pip cache
   - **Fix**: START.bat retries with `--no-cache-dir`

**Manual Fix**:
```bash
# Backend
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt

# Frontend
cd frontend
npm install
```

### Network Streaming Not Working

**Issue**: Cannot access `/player` from other devices on network

**Possible Causes**:

1. **Windows Firewall blocking port 8000**
   - **Fix**: START.bat creates firewall rule automatically
   - **Manual Fix**: Run as Administrator if automatic creation failed
   - **Verify**: Open Windows Firewall → Advanced Settings → Inbound Rules → Look for "FlowAir Backend"

2. **Devices on different networks**
   - **Fix**: Ensure all devices connected to same WiFi router
   - Phone must be on WiFi (not cellular data)
   - Both devices must see same router

3. **Wrong IP address**
   - IP might have changed (DHCP)
   - **Fix**: Check Settings → Network Streaming for current IP
   - Or run `ipconfig` in Command Prompt to verify

4. **Antivirus/Security software**
   - Some antivirus software blocks incoming connections
   - **Fix**: Temporarily disable or add exception for port 8000

5. **Router isolation (Guest WiFi)**
   - Guest networks often block device-to-device communication
   - **Fix**: Connect to main WiFi network (not guest network)

**Testing Steps**:
1. Verify FlowAir is running
2. Check firewall rule exists: `netsh advfirewall firewall show rule name="FlowAir Backend"`
3. Get current IP: Open Settings → Network Streaming
4. Ping test from other device: `ping YOUR_PC_IP`
5. Try accessing from browser on other device

---

## 📝 Notes

### Supported Video Formats

**Recommended**: MP4 (H.264 video, AAC audio)
- Best compatibility
- Hardware acceleration support
- Smallest file size

**Supported**:
- MP4, MOV, MKV, WebM (modern codecs)
- AVI, WMV, FLV, MPEG (if not too old)

**Not Recommended**:
- AVI with DivX/XviD (not browser-compatible)
- Very old WMV files
- **Fix**: Re-encode to MP4

### File Validation Explained

**Valid Files**:
- Checkmark appears immediately
- Green outline when playing
- Normal playback

**Corrupted Files**:
- RED background
- Cannot CUE or Play
- Auto-skipped during playback
- Error message shown

**Downloading Files**:
- Marked corrupted if size = 0
- Re-validate after download completes
- **Tip**: Wait for full download before adding

### STOP EVENT vs NOTE vs OBS EVENT

**STOP EVENT**:
- **Stops playback** when reached
- Red row
- Use case: Operator cues, manual triggers

**NOTE**:
- **Does NOT stop playback**
- Blue row (purple tint)
- Use case: Visual reference, reminders

**OBS EVENT**:
- **Does NOT stop playback** (executes and advances)
- Blue row (dark blue `#1a2a3a`)
- Controls OBS source visibility (show/hide)
- If OBS disconnected: skips silently
- Use case: Automated OBS scene source control during broadcast

### Loop Behavior

**Individual Loop** (per video):
- Click 🔁 button
- Video repeats infinitely when it ends
- Start times recalculate normally
- Does NOT break absolute schedule

**Use Cases**:
- Holding video during live event
- Emergency filler content
- Repeated promos

### Time Format Preference

**12-hour**: 7:30:00 PM, 11:45:30 AM
**24-hour**: 19:30:00, 11:45:30

**Persistence**: Saved to localStorage (survives restart)

**Toggle**: Click "12:00" or "24:00" button in Controls

---

## 🎓 Advanced Tips

### Preparing Playlists for 24/7 Operation

1. **Test Videos First**: Add 2-3 videos, test playback
2. **Validate All Files**: Ensure no RED items before going live
3. **Use STOP Events**: Insert before critical segments
4. **Add NOTEs**: Label blocks (e.g., "Morning Block", "Primetime")
5. **Monitor First Hour**: Check timing accuracy
6. **Let It Run**: System optimized for multi-day playlists

### OBS Best Practices

**Browser Source Settings**:
- Width: 1920, Height: 1080
- FPS: Custom (60)
- Check "Shutdown source when not visible" (saves CPU)
- Check "Refresh browser when scene becomes active"

**Audio Routing**:
- OBS captures audio from /player automatically
- Preview in FlowAir is muted (no conflict)

### External Display vs OBS

**Use External Display When**:
- Dedicated monitor for broadcast output
- Want lowest latency
- Don't need OBS features (overlays, transitions)

**Use OBS Browser Source When**:
- Need overlays, graphics, transitions
- Recording/streaming to multiple platforms
- More control over output

### Keyboard Shortcuts for Efficiency

**Fastest Workflow**:
1. Drag videos into playlist
2. Press `Enter` on first video (CUE)
3. Press `Space` to start (PLAY)
4. Press `N` to advance when needed
5. Right-click → Insert STOP Event before critical segments

**Multi-Select Shortcuts**:
- Select 10 videos: `Click first` → `Shift+Click last`
- Remove selection: `Click empty area`
- Copy selection: `Ctrl+C`
- Paste: `Ctrl+V`
- Delete: `Delete key` → `Enter` to confirm

---

## 📞 Support & Contact

**Developer**: Trident Sky
**Website**: (Coming soon)
**Email**: (Contact for enterprise support)

**Credits**:
- Icons: Material Design Icons
- FFmpeg: FFmpeg Team

---

## 🚀 Future Enhancements (Roadmap)

- **Electron Packaged Executable**: Single .exe file (no START.bat)
- **Multi-Language Support**: Spanish, Portuguese, etc.
- **Advanced Scheduling**: Calendar-based playlists
- **Remote Control**: Web interface for remote operation
- **Multi-Display Output**: Send different content to multiple displays

---

**FlowAir** - Professional broadcast playout for the modern era.
© 2025 Trident Sky. All rights reserved.
