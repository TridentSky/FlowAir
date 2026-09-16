# FlowAir

Professional 24/7 broadcast playout for Windows. Build a playlist of videos and images, press Play, and FlowAir keeps your channel on air with accurate start times, OBS automation and a clean full-screen output.

![FlowAir](build/screenshot.png)

## Features

- **Zero-drift scheduling** — start times are anchored to an absolute clock, so a playlist that runs for days stays on time
- **Live playlist editing** — add, drag, duplicate, copy/paste, loop and cue items while on air without touching what is playing
- **Event rows** — STOP events to hold the channel, notes for the operator, and OBS events to switch scenes or show/hide sources
- **Full-screen output** on any connected display, with a selectable audio output device, plus a browser player for OBS or other computers on your network
- **Live controls** — output volume and timeline scrubbing behind an edit-mode safety lock
- **File checks** — missing or corrupt files are marked red and skipped, and files the player cannot decode are flagged before they go on air
- **Session recovery** — after a crash or power cut FlowAir offers to restore the last playlist
- **Built for the keyboard** — the playout shortcuts can be reassigned in Settings, and every confirmation is driven with `Enter` and `Esc`
- **In-app updates** — FlowAir tells you when a new version exists and downloads the installer for you

## Install

1. Download **FlowAir-Setup.exe** from [Releases](https://github.com/TridentSky/FlowAir/releases/latest)
2. Run it. Windows may show a blue **"Windows protected your PC"** warning because the app is not code-signed yet — click **More info** and then **Run anyway**
3. Accept the administrator prompt and choose an install folder. The default is `C:\Program Files\FlowAir`
4. Leave **Run FlowAir** ticked on the last page, or open FlowAir later from the desktop or Start Menu shortcut

Everything FlowAir needs is included. There is nothing else to install: no Python, Node.js or FFmpeg.

Besides copying the program, the installer:

- adds one inbound firewall rule, *FlowAir Engine*, so players on other computers can reach the stream — the stream itself stays closed until you turn on Network Streaming
- registers the `.flowair` extension, so a saved playlist opens in FlowAir when you double-click it
- registers FlowAir in *Apps & features* with its version, publisher, icon, size, install date and a link to this project, and in *Default apps*

> **Note:** If Windows blocks the installer completely (Smart App Control), open **Windows Security > App & browser control > Smart App Control** and set it to **Off**.

**Requirements:** Windows 10 or Windows 11 (64-bit). Installing needs local administrator rights; running FlowAir afterwards does not.

### Installing over an existing FlowAir

Run the same **FlowAir-Setup.exe** on top of the installation. It upgrades in place:

- it closes FlowAir and its playout engine first, and asks you to close them by hand if it cannot
- it reuses the folder you originally installed into and replaces the old files
- it never creates a second desktop icon, a second Start Menu entry or a second line in *Apps & features*
- it points the firewall rule and the `.flowair` association at the new files
- it keeps every setting: the output display and audio device, the OBS credentials, your keyboard shortcuts and the recovered session

Do not uninstall before upgrading. Uninstalling is what deletes your settings.

### Uninstall

Uninstall from **Settings > Apps > Installed apps > FlowAir**, or run *Uninstall FlowAir.exe* from the install folder. If FlowAir is still running, the uninstaller closes it first.

A real uninstall removes:

- the program folder and both shortcuts
- the *FlowAir Engine* firewall rule
- the `.flowair` file association and every registry key FlowAir wrote
- your settings and cached data — `%APPDATA%\FlowAir` and `%LOCALAPPDATA%\FlowAir` — which includes the recovered session, the OBS password and your keyboard shortcuts

Your saved `.flowair` playlists and your media files are never touched. An upgrade removes none of this; only a real uninstall does.

## Update

FlowAir checks for new releases and shows a discreet **Update** control in the header. It never interrupts playout and never installs anything on its own.

1. Click **Update** in the header. You see the new version number and what changed
2. Click **Download**. The installer downloads in the background while the channel stays on air
3. When it is ready, click **Install** at a moment you can go off air. FlowAir warns you first if something is playing
4. FlowAir closes and the installer opens. Accept the administrator prompt and install over the existing folder

Installing an update is exactly the *Installing over an existing FlowAir* flow above, so your settings, shortcuts, OBS credentials and the recovered session survive it. If you prefer to update by hand, download **FlowAir-Setup.exe** from the Releases page and run it.

Update checks can be turned off completely in **Settings**, and dismissing a version means FlowAir never mentions it again. On a machine with no internet access the check fails silently.

## Using FlowAir

| Task | How |
| --- | --- |
| Add media | **Add Files**, or drag videos and images onto the playlist |
| Duplicate an item | Hold `Ctrl` and drag the row, or right-click > **Duplicate** |
| Go on air | **PLAY** (`Space`) |
| Jump to an item | Select it and press **NEXT** (`N`), or **CUE** it (`Enter`) and press Play |
| Hold the channel | Right-click the playlist > **Insert STOP Event** |
| Operator notes | Right-click > **Insert Note** (double-click a note to edit it) |
| OBS automation | Connect in **Settings > OBS**, then right-click > **Insert OBS Event** |
| Full-screen output | **Settings > Output**, choose a display and apply |
| Audio output device | **Settings > Output**, choose a sound device for the full-screen output |
| Player for OBS | Add a Browser Source with `http://localhost:8000/player` |
| Player on other computers | **Settings > Network > Enable Network Streaming** |
| Save or load a playlist | **Save** / **Load**, drop a `.flowair` file on the playlist, or double-click it in Explorer |
| Find an item | `Ctrl+F`, then type part of a name, a path, a note or an OBS scene |

The audio output device is remembered by its name. If that device is unplugged the output falls back to the Windows default and returns to your choice when the device comes back.

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Space` | Play / Pause |
| `S` | Stop |
| `N` | Next item |
| `Enter` | Cue the selected item |
| `Up` / `Down` | Move the selection |
| `Delete` | Remove the selected items |
| `Ctrl+C` / `Ctrl+V` | Copy / paste items |
| `Ctrl+Z` | Undo |
| `Ctrl+A` | Select all |
| `Ctrl+F` | Find in the playlist |
| `Ctrl+Q` | Exit FlowAir |
| `Ctrl+Shift+E` | Show / hide the full-screen output (works from any window) |
| `Esc` | Close the open dialog, or the find field |

These are the defaults. **Settings > Shortcuts** lets you reassign every action in the table — for example `Ctrl+Shift+Space` to cue — reset a single one, or reset them all. `Up`, `Down` and `Esc` stay fixed: the arrows always move the selection and `Esc` always closes what is open. Your bindings are saved and survive a restart and an upgrade.

Every confirmation dialog is driven from the keyboard: `Enter` confirms, `Esc` cancels, `Tab` stays inside the dialog, and the safe choice is always the one already selected.

## Media compatibility

FlowAir plays media through the same engine as Chrome, so what it can decode is fixed. These play everywhere, with no extra software:

| | Plays natively |
| --- | --- |
| Containers | `.mp4`, `.mov`, `.m4v`, `.webm` |
| Video | H.264, VP8, VP9, AV1 |
| Audio | AAC, MP3, Opus, Vorbis, FLAC, PCM |
| Images | `.jpg`, `.png`, `.bmp`, `.webp`, `.gif` |

`.mkv` is accepted, but it is *always* flagged amber: Matroska only says how the file is wrapped, not what is inside it, so play the clip once before you schedule it.

Anything else is checked when you add it and the row is marked:

- **Amber warning** — the item will load, but something is missing or cannot be guaranteed. Every `.mkv` is flagged for this reason; H.265/HEVC needs the *HEVC Video Extensions* from the Microsoft Store and a GPU that can decode it; AC-3 or E-AC-3 audio plays as silence. Hover the row to read the reason.
- **Red** — the item cannot be played at all: an AVI, WMV, FLV or MPEG program stream (`.mpg`, `.mpeg`) container, a TIFF image (`.tiff`, `.tif`), or a file that is missing or corrupt. Convert video to MP4 with H.264 and AAC, and stills to PNG or JPEG, before air.

Files whose extension is not on this list never reach the playlist at all — they are refused with *Unsupported file format* the moment you add them. Video: `.mp4` `.m4v` `.mov` `.mkv` `.webm` `.avi` `.wmv` `.flv` `.mpeg` `.mpg`. Images: `.jpg` `.jpeg` `.png` `.bmp` `.webp` `.gif` `.tiff` `.tif`. Transport streams (`.ts`), MXF and anything else must be converted first.

For unattended 24/7 playout, keep every clip in the same profile: MP4, H.264, AAC, 1080p.

## Troubleshooting

- **"Port 8000 is being used by another program"** — the playout engine needs port 8000. Close the program that is using it (or restart the computer) and open FlowAir again.
- **"The FlowAir playout engine could not start"** — an antivirus may have blocked `flowair-backend.exe`, or the engine was simply too slow on a cold first start after installing. Open FlowAir again; if it fails a second time, restore the file or add an exception for the FlowAir folder, then reinstall.
- **"FlowAir is already running."** — another Windows user session on this computer owns the playout engine. Sign that session out, or use the same account.
- **"The FlowAir playout engine stopped several times..."** — close FlowAir, open it again, and reinstall if it keeps happening.
- **Black video** — the file uses a codec Windows cannot decode (usually HEVC). See *Media compatibility* above.
- **The full-screen output closed by itself** — its display was disconnected. Reconnect it and apply the Output settings again.
- **A network player shows "Access denied"** — turn on *Network Streaming* in **Settings > Network** on the FlowAir computer. Only the player is shared; the playlist can only be controlled from the FlowAir computer.
- **A network player never connects** — the *FlowAir Engine* firewall rule is missing or was blocked by policy. Re-run the installer, or add an inbound rule for `resources\backend\flowair-backend.exe`.

## Build from source

You need [Node.js](https://nodejs.org) 18 or newer, [Python](https://www.python.org) 3.11 or newer, and `ffprobe.exe` plus `ffmpeg.exe` from an [FFmpeg build](https://github.com/BtbN/FFmpeg-Builds/releases) placed in `ffmpeg/bin/`. Only `ffprobe.exe` is shipped; `ffmpeg.exe` is used during the build to create the clip the packaged engine is tested with.

Run in development mode (installs dependencies on first run):

```
START.bat
```

Build the Windows installer:

```
cd frontend
npm install
npm run dist
```

Port 8000 must be free while building: the packaged engine is started and checked before the installer is created. The build also refuses to continue if an installer resource is missing from `build/`, or if the packaged application does not contain the app, the engine and `ffprobe.exe`. The installer is written to `Installer/FlowAir-Setup.exe`.

### Project structure

```
FlowAir/
├── backend/      Playout engine: scheduling, playlist, file validation, OBS control (FastAPI)
├── frontend/     Desktop app (Electron + React)
├── build/        Installer resources and build script
├── ffmpeg/bin/   ffprobe.exe and ffmpeg.exe (not included in the repository)
└── START.bat     Development launcher
```

## Built With

- [Electron](https://www.electronjs.org) and [React](https://react.dev) — desktop app
- [FastAPI](https://fastapi.tiangolo.com) and [Uvicorn](https://www.uvicorn.org) — playout engine
- [FFmpeg](https://ffmpeg.org) (ffprobe) — media validation ([LGPL/GPL](https://ffmpeg.org/legal.html))
- [obsws-python](https://github.com/aatikturk/obsws-python) — OBS WebSocket control
- Developed with [Claude Code](https://claude.com/claude-code)

## License

MIT License — see [LICENSE](LICENSE) for details.

FFmpeg is an independent project with its own license.
