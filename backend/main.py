from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, HTMLResponse
from pydantic import BaseModel
from typing import List, Optional
from contextlib import asynccontextmanager
import uvicorn
import asyncio
from datetime import datetime
import os
from pathlib import Path
import logging
import warnings
import sys
import psutil
import socket

from playlist_manager import PlaylistManager
from config import Config
from obs_controller import OBSController

logging.getLogger("uvicorn.error").setLevel(logging.CRITICAL)
logging.getLogger("uvicorn.access").setLevel(logging.CRITICAL)
logging.getLogger("h11").setLevel(logging.CRITICAL)
warnings.filterwarnings("ignore", category=DeprecationWarning)
warnings.filterwarnings("ignore", module="h11")

def suppress_connection_errors(loop, context):
    exception = context.get("exception")
    message = context.get("message", "")

    if exception and isinstance(exception, (ConnectionResetError, BrokenPipeError, ConnectionAbortedError)):
        return

    if "LocalProtocolError" in str(exception) or "LocalProtocolError" in message:
        return

    if "timeout_keep_alive_handler" in message:
        return

    loop.default_exception_handler(context)

@asynccontextmanager
async def lifespan(app: FastAPI):
    global main_event_loop

    try:
        process = psutil.Process()
        process.nice(psutil.HIGH_PRIORITY_CLASS)
    except:
        pass

    loop = asyncio.get_event_loop()
    main_event_loop = loop
    loop.set_exception_handler(suppress_connection_errors)
    asyncio.create_task(update_playlist_times())
    yield
    try:
        obs_controller.disconnect()
        playlist_manager.running = False
        if hasattr(playlist_manager, 'cleanup_thread') and playlist_manager.cleanup_thread.is_alive():
            playlist_manager.cleanup_thread.join(timeout=2)
        if hasattr(playlist_manager, 'force_timing_thread') and playlist_manager.force_timing_thread.is_alive():
            playlist_manager.force_timing_thread.join(timeout=2)
    except Exception as e:
        pass

app = FastAPI(title="FlowAir Broadcast API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

playlist_manager = PlaylistManager()
active_connections: List[WebSocket] = []
main_event_loop = None

def handle_playback_change(data):
    if main_event_loop:
        asyncio.run_coroutine_threadsafe(broadcast_update(data), main_event_loop)

playlist_manager.on_playback_change = handle_playback_change

obs_controller = OBSController()

def handle_obs_event(item):
    obs_controller.execute_obs_event(item)

playlist_manager.on_obs_event = handle_obs_event

missing_file_timers = {}
last_broadcast_state = {"current_index": -1, "is_playing": False, "elapsed": 0}
output_settings = {
    "resolution": "1920x1080",
    "aspectRatio": "16:9",
    "quality": "max",
    "scalingMode": "stretch",
    "networkStreamingEnabled": False
}

obs_settings = {
    "enabled": False,
    "host": "localhost",
    "port": 4455,
    "password": ""
}

async def update_playlist_times():
    global last_broadcast_state
    check_counter = 0

    while True:
        await asyncio.sleep(1)

        if not (playlist_manager.is_playing or playlist_manager.is_paused):
            await asyncio.sleep(0.5)
            continue

        playlist_manager.recalculate_start_times()

        elapsed = 0
        if playlist_manager.is_playing and playlist_manager.current_video_start_time:
            elapsed = (datetime.now() - playlist_manager.current_video_start_time).total_seconds() - playlist_manager.total_pause_time
        elif playlist_manager.is_paused and playlist_manager.current_video_start_time and playlist_manager.pause_time:
            elapsed = (playlist_manager.pause_time - playlist_manager.current_video_start_time).total_seconds() - playlist_manager.total_pause_time

        current_state = {
            "current_index": playlist_manager.current_index,
            "is_playing": playlist_manager.is_playing,
            "elapsed": int(elapsed)
        }

        if (current_state["current_index"] != last_broadcast_state["current_index"] or
            current_state["is_playing"] != last_broadcast_state["is_playing"] or
            abs(current_state["elapsed"] - last_broadcast_state["elapsed"]) >= 1 or
            playlist_manager.validation_completed):

            await broadcast_update({
                "type": "playlist_updated",
                "playlist": playlist_manager.get_playlist(),
                "elapsed": max(0, elapsed),
                "current_item": playlist_manager.get_current_item(),
                "is_playing": playlist_manager.is_playing
            })

            last_broadcast_state = current_state
            playlist_manager.validation_completed = False

        check_counter += 1
        if check_counter >= 5:
            check_counter = 0
            missing_ids = playlist_manager.check_missing_files()
            current_time = datetime.now()

            for item_id in missing_ids:
                if item_id not in missing_file_timers:
                    missing_file_timers[item_id] = current_time
                    playlist_manager.mark_as_corrupted(item_id)
                    await broadcast_update({
                        "type": "file_missing",
                        "item_id": item_id,
                        "message": "File does not exist or was deleted",
                        "playlist": playlist_manager.get_playlist()
                    })

            existing_ids = [item["id"] for item in playlist_manager.get_playlist()]
            for timer_id in list(missing_file_timers.keys()):
                if timer_id not in missing_ids or timer_id not in existing_ids:
                    if timer_id in missing_file_timers:
                        del missing_file_timers[timer_id]

class AddItemRequest(BaseModel):
    filepath: str
    insertIndex: Optional[int] = None

class RemoveItemRequest(BaseModel):
    item_id: int

class ReorderRequest(BaseModel):
    from_index: int
    to_index: int

class CueRequest(BaseModel):
    item_id: int

class SavePlaylistRequest(BaseModel):
    filepath: str

class LoadPlaylistRequest(BaseModel):
    filepath: str

class InsertStopEventRequest(BaseModel):
    insert_index: int

class InsertNoteRequest(BaseModel):
    insert_index: int
    note: str

class InsertOBSEventRequest(BaseModel):
    insert_index: int
    obs_scene: str
    obs_source: str = ""
    obs_action: str
    obs_transition: str = ""
    obs_transition_duration: int = 0
    item_id: Optional[int] = None

class OBSSettingsRequest(BaseModel):
    enabled: bool
    host: str
    port: int
    password: str

class OBSSourceActionRequest(BaseModel):
    scene_name: str
    source_name: str
    visible: bool

class OBSSetSceneRequest(BaseModel):
    scene_name: str

class OBSSetTransitionRequest(BaseModel):
    transition_name: str = ""
    duration_ms: int = 0

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    active_connections.append(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        active_connections.remove(websocket)
    except Exception:
        if websocket in active_connections:
            active_connections.remove(websocket)

async def broadcast_update(message: dict):
    dead_connections = []
    for connection in active_connections:
        try:
            await connection.send_json(message)
        except:
            dead_connections.append(connection)

    for dead in dead_connections:
        if dead in active_connections:
            active_connections.remove(dead)

@app.get("/")
async def root():
    return {"message": "FlowAir Broadcast API", "version": "1.0.0"}

@app.get("/playlist")
async def get_playlist():
    return {
        "playlist": playlist_manager.get_playlist(),
        "current_item": playlist_manager.get_current_item(),
        "is_playing": playlist_manager.is_playing,
        "is_paused": playlist_manager.is_paused
    }

@app.post("/playlist/add")
async def add_item(request: AddItemRequest):
    item = playlist_manager.add_item(request.filepath, request.insertIndex)
    await broadcast_update({
        "type": "playlist_updated",
        "playlist": playlist_manager.get_playlist()
    })
    return {"success": True, "item": item}

@app.post("/playlist/remove")
async def remove_item(request: RemoveItemRequest):
    playlist_manager.remove_item(request.item_id)
    await broadcast_update({
        "type": "playlist_updated",
        "playlist": playlist_manager.get_playlist()
    })
    return {"success": True}

@app.post("/playlist/check-file")
async def check_file_exists(data: dict):
    filepath = data.get("filepath")
    if not filepath:
        return {"exists": False}
    return {"exists": os.path.exists(filepath)}

@app.post("/playlist/reorder")
async def reorder_items(request: ReorderRequest):
    playlist_manager.reorder_items(request.from_index, request.to_index)
    await broadcast_update({
        "type": "playlist_updated",
        "playlist": playlist_manager.get_playlist()
    })
    return {"success": True}

@app.post("/player/play")
async def play():
    playlist_manager.play()
    await broadcast_update({
        "type": "playback_state_changed",
        "is_playing": True,
        "current_item": playlist_manager.get_current_item()
    })
    return {"success": True}

@app.post("/player/stop")
async def stop():
    playlist_manager.stop()
    await broadcast_update({
        "type": "playback_state_changed",
        "is_playing": False,
        "current_item": playlist_manager.get_current_item()
    })
    return {"success": True}

@app.post("/player/pause")
async def pause():
    playlist_manager.pause()
    await broadcast_update({
        "type": "playback_state_changed",
        "is_playing": False,
        "is_paused": True,
        "current_item": playlist_manager.get_current_item()
    })
    return {"success": True}

@app.post("/player/next")
async def next_item():
    playlist_manager.next()
    await broadcast_update({
        "type": "playback_state_changed",
        "current_item": playlist_manager.get_current_item(),
        "is_playing": playlist_manager.is_playing
    })
    return {"success": True}

@app.post("/player/cue")
async def cue_item(request: CueRequest):
    playlist_manager.cue(request.item_id)
    playlist_manager.recalculate_start_times()
    await broadcast_update({
        "type": "item_cued",
        "current_item": playlist_manager.get_current_item(),
        "playlist": playlist_manager.get_playlist(),
        "is_playing": False
    })
    return {"success": True}

@app.post("/playlist/toggle_loop/{item_id}")
async def toggle_loop(item_id: int):
    for item in playlist_manager.playlist:
        if item["id"] == item_id:
            item["loop"] = not item.get("loop", False)
            await broadcast_update({
                "type": "playlist_updated",
                "playlist": playlist_manager.get_playlist()
            })
            return {"success": True, "loop": item["loop"]}
    return {"success": False, "error": "Item not found"}

def is_localhost(client_ip: str) -> bool:
    localhost_ips = ['127.0.0.1', '::1', 'localhost']
    return client_ip in localhost_ips

def check_network_access(request: Request):
    if not output_settings.get('networkStreamingEnabled', False):
        client_ip = request.client.host
        if not is_localhost(client_ip):
            raise HTTPException(
                status_code=403,
                detail="Network streaming is disabled. Access only allowed from localhost."
            )

@app.get("/output_settings")
async def get_output_settings():
    return output_settings

@app.post("/output_settings")
async def update_output_settings(settings: dict):
    global output_settings
    output_settings.update(settings)
    return {"success": True, "settings": output_settings}

@app.get("/network_info")
async def get_network_info():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.1)
        s.connect(("8.8.8.8", 80))
        local_ip = s.getsockname()[0]
        s.close()
    except:
        local_ip = "127.0.0.1"

    port = Config.PORT
    return {
        "local_ip": local_ip,
        "port": port,
        "player_url": f"http://{local_ip}:{port}/player"
    }

@app.post("/playlist/save")
async def save_playlist(request: SavePlaylistRequest):
    playlist_manager.save_playlist(request.filepath)
    return {"success": True}

@app.post("/playlist/load")
async def load_playlist(request: LoadPlaylistRequest):
    success = playlist_manager.load_playlist(request.filepath)
    if success:
        await broadcast_update({
            "type": "playlist_loaded",
            "playlist": playlist_manager.get_playlist()
        })
    return {"success": success}

@app.post("/playlist/insert_stop")
async def insert_stop_event(request: InsertStopEventRequest):
    item = playlist_manager.insert_stop_event(request.insert_index)
    await broadcast_update({
        "type": "playlist_updated",
        "playlist": playlist_manager.get_playlist()
    })
    return {"success": True, "item": item}

@app.post("/playlist/insert_note")
async def insert_note(request: InsertNoteRequest):
    item = playlist_manager.insert_note(request.insert_index, request.note)
    await broadcast_update({
        "type": "playlist_updated",
        "playlist": playlist_manager.get_playlist()
    })
    return {"success": True, "item": item, "item_id": item["id"]}

class UpdateNoteRequest(BaseModel):
    item_id: int
    note: str

@app.post("/playlist/update_note")
async def update_note(request: UpdateNoteRequest):
    success = playlist_manager.update_note(request.item_id, request.note)
    if success:
        await broadcast_update({
            "type": "playlist_updated",
            "playlist": playlist_manager.get_playlist()
        })
    return {"success": success}

@app.post("/playlist/insert_obs_event")
async def insert_obs_event(request: InsertOBSEventRequest):
    if request.item_id is not None:
        item = playlist_manager.update_obs_event(
            request.item_id, request.obs_scene, request.obs_source, request.obs_action,
            request.obs_transition, request.obs_transition_duration
        )
        if not item:
            return {"success": False, "error": "OBS event not found"}
    else:
        item = playlist_manager.insert_obs_event(
            request.insert_index, request.obs_scene, request.obs_source, request.obs_action,
            request.obs_transition, request.obs_transition_duration
        )
    await broadcast_update({
        "type": "playlist_updated",
        "playlist": playlist_manager.get_playlist()
    })
    return {"success": True, "item": item, "item_id": item["id"]}

@app.get("/obs/settings")
async def get_obs_settings():
    return obs_settings

@app.post("/obs/settings")
async def update_obs_settings(request: OBSSettingsRequest):
    global obs_settings
    obs_settings = request.dict()
    obs_controller.settings = obs_settings
    return {"success": True}

@app.post("/obs/connect")
async def obs_connect():
    obs_controller.settings = obs_settings
    result = obs_controller.connect()
    return result

@app.post("/obs/disconnect")
async def obs_disconnect():
    result = obs_controller.disconnect()
    return result

@app.get("/obs/status")
async def obs_status():
    if obs_controller.connected:
        alive = obs_controller.is_alive()
        return {"connected": alive}
    return {"connected": False}

@app.get("/obs/scenes")
async def obs_scenes():
    scenes = obs_controller.get_scenes()
    return {"scenes": scenes}

@app.get("/obs/scenes/{scene_name}/sources")
async def obs_scene_sources(scene_name: str):
    sources = obs_controller.get_scene_sources(scene_name)
    return {"sources": sources}

@app.post("/obs/source/visibility")
async def obs_set_visibility(request: OBSSourceActionRequest):
    result = obs_controller.set_source_visibility(
        request.scene_name, request.source_name, request.visible
    )
    return result

@app.get("/obs/current_scene")
async def obs_current_scene():
    return {"scene": obs_controller.get_current_scene()}

@app.post("/obs/set_scene")
async def obs_set_scene(request: OBSSetSceneRequest):
    return obs_controller.set_current_scene(request.scene_name)

@app.get("/obs/transitions")
async def obs_transitions():
    return obs_controller.get_transitions()

@app.post("/obs/set_transition")
async def obs_set_transition(request: OBSSetTransitionRequest):
    return obs_controller.set_transition(request.transition_name, request.duration_ms)

@app.get("/player/state")
async def get_player_state(request: Request):
    check_network_access(request)
    from datetime import datetime
    current_item = playlist_manager.get_current_item()
    elapsed = 0

    if playlist_manager.is_playing and playlist_manager.current_video_start_time:
        elapsed = (datetime.now() - playlist_manager.current_video_start_time).total_seconds() - playlist_manager.total_pause_time
    elif playlist_manager.is_paused and playlist_manager.current_video_start_time and playlist_manager.pause_time:
        elapsed = (playlist_manager.pause_time - playlist_manager.current_video_start_time).total_seconds() - playlist_manager.total_pause_time

    return {
        "current_item": current_item,
        "is_playing": playlist_manager.is_playing,
        "elapsed": max(0, elapsed)
    }

@app.get("/player")
async def player_page(request: Request):
    check_network_access(request)
    scaling_mode_map = {
        "stretch": "fill",
        "fit": "contain",
        "fill": "cover"
    }
    object_fit = scaling_mode_map.get(output_settings["scalingMode"], "fill")

    # Aspect ratio CSS logic
    aspect_ratio = output_settings.get("aspectRatio", "16:9")
    container_css = ""

    if aspect_ratio == "9:16":
        # Vertical video mode
        container_css = """
            #container {
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                width: 56.25vh;
                height: 100vh;
                background: #000;
            }
        """
    elif aspect_ratio == "4:3":
        # Standard 4:3 mode
        container_css = """
            #container {
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                width: 133.33vh;
                height: 100vh;
                background: #000;
            }
        """
    elif aspect_ratio == "1:1":
        # Square mode
        container_css = """
            #container {
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                width: 100vh;
                height: 100vh;
                background: #000;
            }
        """
    else:
        # Default 16:9 widescreen
        container_css = """
            #container {
                width: 100vw;
                height: 100vh;
            }
        """

    html_content = """
    <!DOCTYPE html>
    <html>
    <head>
        <title>FlowAir Player</title>
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
                background: #000;
                overflow: hidden;
                width: 100vw;
                height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            CONTAINER_CSS_PLACEHOLDER
            #container video, #container img {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                object-fit: OBJECT_FIT_PLACEHOLDER;
                image-rendering: -webkit-optimize-contrast;
                image-rendering: crisp-edges;
            }
            #container video {
                will-change: transform;
                transform: translateZ(0);
                backface-visibility: hidden;
            }
        </style>
    </head>
    <body>
        <div id="container">
            <video id="player" style="display:none;"></video>
            <img id="image" style="display:none;">
        </div>
        <script>
            const urlParams = new URLSearchParams(window.location.search);
            const isMuted = urlParams.get('muted') === '1';
            const baseURL = window.location.origin;

            const video = document.getElementById('player');
            const image = document.getElementById('image');
            let currentItemId = null;
            let isLoadingNewItem = false;
            let ws = null;
            let reconnectAttempts = 0;
            const maxReconnectDelay = 10000;

            let audioCtx = null;
            let analyserNode = null;
            let meterData = null;
            let meterSmooth = 0;
            let meterStarted = false;
            let lastMeterPost = 0;

            function meterTick(ts) {
                requestAnimationFrame(meterTick);
                if (!analyserNode) return;
                if (ts - lastMeterPost < 50) return;
                lastMeterPost = ts;
                analyserNode.getFloatTimeDomainData(meterData);
                let sum = 0;
                for (let i = 0; i < meterData.length; i++) {
                    sum += meterData[i] * meterData[i];
                }
                const rms = Math.sqrt(sum / meterData.length);
                let level = 0;
                if (rms > 0.0000001) {
                    const db = 20 * Math.log10(rms);
                    level = Math.max(0, Math.min(100, (db + 60) * (100 / 60)));
                }
                meterSmooth = (0.5 * level) + (0.5 * meterSmooth);
                const out = meterSmooth < 2 ? 0 : meterSmooth;
                try {
                    window.parent.postMessage({ type: 'flowair-audio-level', level: out }, '*');
                } catch (e) {}
            }

            function setupAudioMeter() {
                if (meterStarted) return;
                meterStarted = true;
                try {
                    const AudioCtx = window.AudioContext || window.webkitAudioContext;
                    audioCtx = new AudioCtx();
                    const sourceNode = audioCtx.createMediaElementSource(video);
                    analyserNode = audioCtx.createAnalyser();
                    analyserNode.fftSize = 1024;
                    meterData = new Float32Array(analyserNode.fftSize);
                    const gainNode = audioCtx.createGain();
                    gainNode.gain.value = 0;
                    sourceNode.connect(analyserNode);
                    analyserNode.connect(gainNode);
                    gainNode.connect(audioCtx.destination);
                    requestAnimationFrame(meterTick);
                } catch (e) {
                    meterStarted = false;
                    analyserNode = null;
                    video.muted = true;
                }
            }

            function resumeAudioCtx() {
                if (audioCtx && audioCtx.state === 'suspended') {
                    audioCtx.resume().catch(() => {});
                }
            }

            if (isMuted) {
                setupAudioMeter();
                video.addEventListener('playing', resumeAudioCtx);
            } else {
                video.muted = false;
            }

            function connectWebSocket() {
                const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
                ws = new WebSocket(protocol + '//' + window.location.host + '/ws');

                ws.onopen = () => {
                    reconnectAttempts = 0;
                    fetch(baseURL + '/player/state')
                        .then(res => res.json())
                        .then(data => {
                            handlePlaybackState(data);
                        })
                        .catch(() => {});
                };

                ws.onmessage = (event) => {
                    const data = JSON.parse(event.data);

                    if (data.type === 'playback_state_changed') {
                        handlePlaybackState(data);
                    } else if (data.type === 'item_cued') {
                        const item = data.current_item;
                        if (item) {
                            isLoadingNewItem = true;
                            currentItemId = item.id;
                            if (item.type === 'video') {
                                video.src = baseURL + '/stream/' + item.id;
                                video.load();
                                video.addEventListener('loadeddata', () => {
                                    video.currentTime = 0;
                                    isLoadingNewItem = false;
                                }, { once: true });
                                video.style.display = 'block';
                                image.style.display = 'none';
                            } else if (item.type === 'image') {
                                image.src = baseURL + '/image/' + item.id;
                                image.style.display = 'block';
                                video.style.display = 'none';
                                isLoadingNewItem = false;
                            }
                        }
                    }
                };

                ws.onerror = () => {};

                ws.onclose = () => {
                    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), maxReconnectDelay);
                    reconnectAttempts++;
                    setTimeout(connectWebSocket, delay);
                };
            }

            connectWebSocket();

            function handlePlaybackState(data) {
                const item = data.current_item;

                if (!item) {
                    video.style.display = 'none';
                    image.style.display = 'none';
                    video.pause();
                    video.removeAttribute('src');
                    video.load();
                    currentItemId = null;
                    isLoadingNewItem = false;
                    return;
                }

                const isNewItem = currentItemId !== item.id;

                if (item.type === 'video') {
                    if (isNewItem) {
                        isLoadingNewItem = true;
                        video.pause();
                        video.style.display = 'none';
                        image.style.display = 'none';
                        video.removeAttribute('src');
                        video.load();

                        video.src = baseURL + '/stream/' + item.id;
                        video.load();
                        currentItemId = item.id;

                        const targetTime = data.elapsed || 0;
                        const shouldPlay = data.is_playing;

                        video.onloadedmetadata = () => {
                            video.currentTime = targetTime;
                        };

                        video.oncanplay = () => {
                            video.oncanplay = null;
                            video.onloadedmetadata = null;
                            video.style.display = 'block';
                            isLoadingNewItem = false;

                            if (shouldPlay) {
                                const playPromise = video.play();
                                if (playPromise !== undefined) {
                                    playPromise.catch(() => {});
                                }
                            }
                        };
                    } else {
                        video.style.display = 'block';
                        image.style.display = 'none';

                        if (data.is_playing && video.paused) {
                            const playPromise = video.play();
                            if (playPromise !== undefined) {
                                playPromise.catch(() => {});
                            }
                        } else if (!data.is_playing && !video.paused) {
                            video.pause();
                        }
                    }
                } else if (item.type === 'image') {
                    video.pause();
                    video.style.display = 'none';

                    if (isNewItem) {
                        image.src = baseURL + '/image/' + item.id;
                        currentItemId = item.id;
                    }
                    image.style.display = 'block';
                    isLoadingNewItem = false;
                }
            }

            function syncElapsed() {
                if (isLoadingNewItem || video.seeking) {
                    return;
                }

                fetch(baseURL + '/player/state')
                    .then(res => res.json())
                    .then(data => {
                        if (!data.current_item || data.current_item.type !== 'video') {
                            return;
                        }

                        if (currentItemId === data.current_item.id) {
                            if (data.is_playing && video.paused && video.readyState >= 2) {
                                const playPromise = video.play();
                                if (playPromise !== undefined) {
                                    playPromise.catch(() => {});
                                }
                            }

                            if (data.is_playing && !video.paused && video.readyState >= 2) {
                                const drift = Math.abs(video.currentTime - data.elapsed);
                                if (drift > 0.5 && !video.seeking) {
                                    video.currentTime = data.elapsed;
                                }
                            }
                        }
                    })
                    .catch(() => {});
            }

            const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
            const pollingInterval = isLocalhost ? 200 : 500;
            setInterval(syncElapsed, pollingInterval);
        </script>
    </body>
    </html>
    """
    html_content = html_content.replace("OBJECT_FIT_PLACEHOLDER", object_fit)
    html_content = html_content.replace("CONTAINER_CSS_PLACEHOLDER", container_css)
    return HTMLResponse(
        content=html_content,
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0"
        }
    )

@app.get("/stream/{item_id}")
async def stream_video(item_id: int, request: Request):
    check_network_access(request)
    item = None
    for playlist_item in playlist_manager.playlist:
        if playlist_item['id'] == item_id:
            item = playlist_item
            break

    if not item:
        return {"error": "Item not found"}

    filepath = item['location']

    if not os.path.exists(filepath):
        return {"error": "File not found"}

    file_size = os.path.getsize(filepath)
    range_header = request.headers.get('range')

    if range_header:
        byte_range = range_header.strip().split('=')[1]
        start, end = byte_range.split('-')
        start = int(start)
        end = int(end) if end else file_size - 1

        chunk_size = end - start + 1

        def iterfile():
            try:
                with open(filepath, mode="rb") as file_like:
                    file_like.seek(start)
                    bytes_read = 0
                    while bytes_read < chunk_size:
                        chunk = file_like.read(min(4194304, chunk_size - bytes_read))
                        if not chunk:
                            break
                        bytes_read += len(chunk)
                        yield chunk
            except (ConnectionResetError, BrokenPipeError, ConnectionAbortedError):
                pass

        headers = {
            'Content-Range': f'bytes {start}-{end}/{file_size}',
            'Accept-Ranges': 'bytes',
            'Content-Length': str(chunk_size),
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0',
        }

        ext = Path(filepath).suffix.lower()
        media_type = 'video/mp4'
        if ext in ['.avi', '.mkv', '.webm']:
            media_type = f'video/{ext[1:]}'

        return StreamingResponse(iterfile(), status_code=206, headers=headers, media_type=media_type)
    else:
        def iterfile():
            try:
                with open(filepath, mode="rb") as file_like:
                    yield from file_like
            except (ConnectionResetError, BrokenPipeError, ConnectionAbortedError):
                pass

        ext = Path(filepath).suffix.lower()
        media_type = 'video/mp4'
        if ext in ['.avi', '.mkv', '.webm']:
            media_type = f'video/{ext[1:]}'

        headers = {
            'Accept-Ranges': 'bytes',
            'Content-Length': str(file_size)
        }

        return StreamingResponse(iterfile(), headers=headers, media_type=media_type)

@app.get("/image/{item_id}")
async def serve_image(item_id: int, request: Request):
    check_network_access(request)
    item = None
    for playlist_item in playlist_manager.playlist:
        if playlist_item['id'] == item_id:
            item = playlist_item
            break

    if not item or item['type'] != 'image':
        return {"error": "Image not found"}

    filepath = item['location']

    if not os.path.exists(filepath):
        return {"error": "File not found"}

    ext = Path(filepath).suffix.lower()
    media_type = 'image/jpeg'
    if ext == '.png':
        media_type = 'image/png'
    elif ext == '.gif':
        media_type = 'image/gif'
    elif ext == '.bmp':
        media_type = 'image/bmp'
    elif ext == '.webp':
        media_type = 'image/webp'

    def iterfile():
        try:
            with open(filepath, mode="rb") as file_like:
                yield from file_like
        except (ConnectionResetError, BrokenPipeError, ConnectionAbortedError):
            pass

    return StreamingResponse(iterfile(), media_type=media_type)


if __name__ == "__main__":
    config = Config()
    uvicorn.run(
        app,
        host=config.HOST,
        port=config.PORT,
        log_level="critical",
        access_log=False
    )
