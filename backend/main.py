import os
import sys

if sys.stdout is None:
    sys.stdout = open(os.devnull, "w")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w")

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import StreamingResponse, HTMLResponse, JSONResponse, Response
from pydantic import BaseModel
from typing import List, Optional
from contextlib import asynccontextmanager
from concurrent.futures import ThreadPoolExecutor
import uvicorn
import asyncio
from datetime import datetime
from pathlib import Path
import json
import logging
import warnings
import threading
import time
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
        process.nice(psutil.ABOVE_NORMAL_PRIORITY_CLASS)
    except:
        pass

    loop = asyncio.get_event_loop()
    main_event_loop = loop
    loop.set_exception_handler(suppress_connection_errors)
    asyncio.create_task(update_playlist_times())
    yield
    try:
        obs_controller.disconnect()
        playlist_manager.shutdown()
        if hasattr(playlist_manager, 'cleanup_thread') and playlist_manager.cleanup_thread.is_alive():
            playlist_manager.cleanup_thread.join(timeout=2)
        if hasattr(playlist_manager, 'force_timing_thread') and playlist_manager.force_timing_thread.is_alive():
            playlist_manager.force_timing_thread.join(timeout=2)
    except Exception as e:
        pass

app = FastAPI(title="FlowAir Broadcast API", lifespan=lifespan)

LOCAL_HOSTS = {"127.0.0.1", "::1", "localhost", "::ffff:127.0.0.1"}
TRUSTED_ORIGINS = {"http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:8000", "http://127.0.0.1:8000"}
SAFE_METHODS = {"GET", "HEAD"}
CLIENT_HEADER = b"x-flowair-client"

def is_remote_player_path(path):
    return path in ("/player", "/player/state") or path.startswith("/stream/") or path.startswith("/image/")

class AccessControlMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return

        client = scope.get("client")
        client_host = client[0] if client else ""
        path = scope.get("path", "")

        if client_host not in LOCAL_HOSTS:
            streaming = output_settings.get("networkStreamingEnabled", False)
            if scope["type"] == "websocket":
                allowed = streaming and path == "/ws"
            else:
                allowed = streaming and scope.get("method") in SAFE_METHODS and is_remote_player_path(path)
            if not allowed:
                await self._reject(scope, receive, send)
                return

        if scope["type"] == "http" and scope.get("method") not in SAFE_METHODS:
            headers = dict(scope.get("headers") or [])
            origin = headers.get(b"origin", b"").decode("latin-1")
            if origin and origin not in TRUSTED_ORIGINS and CLIENT_HEADER not in headers:
                await self._reject(scope, receive, send)
                return

        await self.app(scope, receive, send)

    async def _reject(self, scope, receive, send):
        if scope["type"] == "websocket":
            await receive()
            await send({"type": "websocket.close", "code": 1008})
            return
        response = JSONResponse({"detail": "Access denied"}, status_code=403)
        await response(scope, receive, send)

app.add_middleware(AccessControlMiddleware)

playlist_manager = PlaylistManager()
active_connections: List[WebSocket] = []
player_connections = set()
main_event_loop = None

def handle_playback_change(data):
    if main_event_loop:
        asyncio.run_coroutine_threadsafe(broadcast_update(data), main_event_loop)

playlist_manager.on_playback_change = handle_playback_change

obs_controller = OBSController()
obs_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="obs-events")

def handle_obs_event(item):
    try:
        obs_executor.submit(obs_controller.execute_obs_event, dict(item))
    except RuntimeError:
        pass

playlist_manager.on_obs_event = handle_obs_event

missing_file_timers = {}
last_broadcast_state = {"current_index": -1, "is_playing": False, "elapsed": 0}
output_settings = {
    "resolution": "1920x1080",
    "aspectRatio": "16:9",
    "quality": "max",
    "scalingMode": "stretch",
    "networkStreamingEnabled": False,
    "audioDeviceLabel": ""
}

validating_since = {}

def item_issue_message(item_id):
    for item in playlist_manager.get_playlist():
        if item["id"] == item_id:
            return playlist_message(
                "item_issue",
                item_id=item_id,
                status=item.get("status"),
                playability=item.get("playability", "ok"),
                issues=item.get("issues") or []
            )
    return playlist_message("item_issue", item_id=item_id, status=None, playability="ok", issues=[])

def playlist_message(message_type="playlist_updated", **extra):
    message = {
        "type": message_type,
        "playlist": playlist_manager.get_playlist(),
        "current_item": playlist_manager.get_current_item(),
        "is_playing": playlist_manager.is_playing,
        "revision": playlist_manager.revision
    }
    message.update(extra)
    return message

obs_settings = {
    "enabled": False,
    "host": "localhost",
    "port": 4455,
    "password": ""
}

async def update_playlist_times():
    check_counter = 0

    while True:
        await asyncio.sleep(1)
        try:
            check_counter = await refresh_playlist_state(check_counter)
        except Exception:
            await asyncio.sleep(0.5)

async def refresh_playlist_state(check_counter):
    global last_broadcast_state

    if not (playlist_manager.is_playing or playlist_manager.is_paused):
        await asyncio.sleep(0.5)
        return check_counter

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

        await broadcast_update(playlist_message(elapsed=max(0, elapsed)))

        last_broadcast_state = current_state
        playlist_manager.validation_completed = False

    check_counter += 1
    if check_counter >= 5:
        check_counter = 0
        file_state = await asyncio.to_thread(playlist_manager.check_missing_files)
        missing_ids = file_state["missing"]
        current_time = datetime.now()

        for item_id in missing_ids:
            if item_id not in missing_file_timers:
                missing_file_timers[item_id] = current_time
                playlist_manager.mark_as_corrupted(item_id)
                await broadcast_update(playlist_message("file_missing", item_id=item_id, message="File does not exist or was deleted"))

        existing_ids = [item["id"] for item in playlist_manager.get_playlist()]
        restored = [timer_id for timer_id in missing_file_timers if timer_id not in missing_ids and timer_id in existing_ids]

        for timer_id in list(missing_file_timers.keys()):
            if timer_id not in missing_ids or timer_id not in existing_ids:
                del missing_file_timers[timer_id]

        for item_id in restored + file_state["changed"]:
            if playlist_manager.mark_for_revalidation(item_id):
                await broadcast_update(item_issue_message(item_id))

        await check_stuck_validations(existing_ids, current_time)

    return check_counter

async def check_stuck_validations(existing_ids, current_time):
    for item in playlist_manager.get_playlist():
        if item.get("status") != "validating":
            validating_since.pop(item["id"], None)
            continue

        started = validating_since.get(item["id"])
        if started is None:
            validating_since[item["id"]] = current_time
        elif (current_time - started).total_seconds() > 60 and (time.monotonic() - playlist_manager.last_validation_at) > 60:
            validating_since.pop(item["id"], None)
            playlist_manager.record_playback_error(item["id"], "validation_timeout", "The file could not be analysed in time")
            await broadcast_update(item_issue_message(item["id"]))

    for item_id in list(validating_since.keys()):
        if item_id not in existing_ids:
            del validating_since[item_id]

class AddItemRequest(BaseModel):
    filepath: str
    insertIndex: Optional[int] = None
    loop: bool = False

class RemoveItemRequest(BaseModel):
    item_id: int

class ReorderRequest(BaseModel):
    from_index: int
    to_index: int

class MoveItemsRequest(BaseModel):
    item_ids: List[int]
    position: int

class DuplicateItemRequest(BaseModel):
    item_id: int
    insertIndex: Optional[int] = None

class SetOrderRequest(BaseModel):
    item_ids: List[int]

class RestoreItemsRequest(BaseModel):
    items: List[dict]
    position: Optional[int] = None

class PlaybackErrorRequest(BaseModel):
    item_id: int
    code: str = ""
    message: str = ""

class CueRequest(BaseModel):
    item_id: int

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

class SeekRequest(BaseModel):
    position: float
    item_id: Optional[int] = None

class VolumeRequest(BaseModel):
    volume: int

def forget_connection(websocket):
    if websocket in active_connections:
        active_connections.remove(websocket)
    player_connections.discard(websocket)

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    active_connections.append(websocket)
    if websocket.query_params.get("role") == "player":
        player_connections.add(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        forget_connection(websocket)
    except Exception:
        forget_connection(websocket)

async def broadcast_update(message: dict):
    if not active_connections:
        return

    try:
        ui_payload = json.dumps(message)
    except (TypeError, ValueError):
        return

    player_payload = ui_payload
    if "playlist" in message and player_connections:
        player_payload = json.dumps({key: value for key, value in message.items() if key != "playlist"})

    dead_connections = []
    for connection in list(active_connections):
        payload = player_payload if connection in player_connections else ui_payload
        try:
            await connection.send_text(payload)
        except Exception:
            dead_connections.append(connection)

    for dead in dead_connections:
        forget_connection(dead)
        try:
            await dead.close(code=1011)
        except Exception:
            pass

@app.get("/")
async def root():
    return {
        "message": "FlowAir Broadcast API",
        "version": os.environ.get("FLOWAIR_VERSION", "dev"),
        "instance": os.environ.get("FLOWAIR_INSTANCE", ""),
        "pid": os.getpid()
    }

@app.get("/playlist")
async def get_playlist():
    return {
        "playlist": playlist_manager.get_playlist(),
        "current_item": playlist_manager.get_current_item(),
        "is_playing": playlist_manager.is_playing,
        "is_paused": playlist_manager.is_paused,
        "revision": playlist_manager.revision
    }

@app.post("/playlist/add")
async def add_item(request: AddItemRequest):
    item = playlist_manager.add_item(request.filepath, request.insertIndex, request.loop)
    await broadcast_update(playlist_message())
    return {"success": True, "item": item}

@app.post("/playlist/duplicate")
async def duplicate_item(request: DuplicateItemRequest):
    item = playlist_manager.duplicate_item(request.item_id, request.insertIndex)
    if item is None:
        return JSONResponse({"success": False, "error": "Item cannot be duplicated"}, status_code=404)

    await broadcast_update(playlist_message())
    return {"success": True, "item": item}

@app.post("/playlist/restore")
async def restore_items(request: RestoreItemsRequest):
    created = playlist_manager.restore_items(request.items, request.position)
    if created:
        await broadcast_update(playlist_message())
    return {"success": bool(created), "items": created}

@app.post("/playlist/order")
async def set_playlist_order(request: SetOrderRequest):
    success = playlist_manager.set_order(request.item_ids)
    if success:
        await broadcast_update(playlist_message())
    return {"success": success}

@app.post("/playlist/clear")
async def clear_playlist():
    success = playlist_manager.clear_playlist()
    if success:
        await broadcast_update(playlist_message())
    return {"success": success}

@app.post("/playlist/remove")
async def remove_item(request: RemoveItemRequest):
    playlist_manager.remove_item(request.item_id)
    await broadcast_update(playlist_message())
    return {"success": True}

@app.post("/playlist/check-file")
async def check_file_exists(data: dict):
    filepath = data.get("filepath")
    if not filepath:
        return {"exists": False}
    exists = await asyncio.to_thread(os.path.exists, filepath)
    return {"exists": exists}

@app.post("/playlist/reorder")
async def reorder_items(request: ReorderRequest):
    success = playlist_manager.reorder_items(request.from_index, request.to_index)
    if success:
        await broadcast_update(playlist_message())
    return {"success": success}

@app.post("/playlist/move")
async def move_items(request: MoveItemsRequest):
    success = playlist_manager.move_items(request.item_ids, request.position)
    await broadcast_update(playlist_message())
    return {"success": success}

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

@app.post("/player/seek")
async def player_seek(request: SeekRequest):
    success = playlist_manager.seek(request.position, request.item_id)
    if success:
        await broadcast_update(playlist_message("player_seek", position=request.position))
    return {"success": success}

@app.post("/player/volume")
async def player_volume(request: VolumeRequest):
    volume = playlist_manager.set_output_volume(request.volume)
    await broadcast_update({
        "type": "volume_changed",
        "volume": volume
    })
    return {"success": True, "volume": volume}

@app.post("/player/cue")
async def cue_item(request: CueRequest):
    playlist_manager.cue(request.item_id)
    playlist_manager.recalculate_start_times()
    await broadcast_update(playlist_message("item_cued"))
    return {"success": True}

@app.post("/player/playback_error")
async def playback_error(request: PlaybackErrorRequest):
    was_current = playlist_manager.get_current_item() is not None and playlist_manager.get_current_item()["id"] == request.item_id
    was_playing = playlist_manager.is_playing

    item = playlist_manager.record_playback_error(request.item_id, request.code, request.message)
    if item is None:
        return {"success": False}

    if was_current and was_playing:
        playlist_manager.next()

    await broadcast_update(item_issue_message(request.item_id))
    return {"success": True}

@app.post("/playlist/toggle_loop/{item_id}")
async def toggle_loop(item_id: int):
    for item in playlist_manager.playlist:
        if item["id"] == item_id:
            item["loop"] = not item.get("loop", False)
            playlist_manager._bump_revision()
            await broadcast_update(playlist_message())
            return {"success": True, "loop": item["loop"]}
    return {"success": False, "error": "Item not found"}

@app.get("/output_settings")
async def get_output_settings():
    return output_settings

@app.post("/output_settings")
async def update_output_settings(settings: dict):
    global output_settings
    output_settings.update(settings)
    await broadcast_update({
        "type": "output_settings_changed",
        "aspectRatio": output_settings.get("aspectRatio", "16:9"),
        "scalingMode": output_settings.get("scalingMode", "stretch"),
        "audioDeviceLabel": output_settings.get("audioDeviceLabel", "")
    })
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

@app.post("/playlist/insert_stop")
async def insert_stop_event(request: InsertStopEventRequest):
    item = playlist_manager.insert_stop_event(request.insert_index)
    await broadcast_update(playlist_message())
    return {"success": True, "item": item}

@app.post("/playlist/insert_note")
async def insert_note(request: InsertNoteRequest):
    item = playlist_manager.insert_note(request.insert_index, request.note)
    await broadcast_update(playlist_message())
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
    await broadcast_update(playlist_message())
    return {"success": True, "item": item, "item_id": item["id"]}

@app.get("/obs/settings")
async def get_obs_settings():
    return obs_settings

@app.post("/obs/settings")
async def update_obs_settings(request: OBSSettingsRequest):
    global obs_settings
    obs_settings = request.model_dump()
    obs_controller.settings = obs_settings
    return {"success": True}

@app.post("/obs/connect")
def obs_connect():
    obs_controller.settings = obs_settings
    return obs_controller.connect()

@app.post("/obs/disconnect")
def obs_disconnect():
    return obs_controller.disconnect()

@app.get("/obs/status")
def obs_status():
    if obs_controller.connected:
        return {"connected": obs_controller.is_alive()}
    return {"connected": False}

@app.get("/obs/scenes")
def obs_scenes():
    return {"scenes": obs_controller.get_scenes()}

@app.get("/obs/scenes/{scene_name}/sources")
def obs_scene_sources(scene_name: str):
    return {"sources": obs_controller.get_scene_sources(scene_name)}

@app.post("/obs/source/visibility")
def obs_set_visibility(request: OBSSourceActionRequest):
    return obs_controller.set_source_visibility(
        request.scene_name, request.source_name, request.visible
    )

@app.get("/obs/current_scene")
def obs_current_scene():
    return {"scene": obs_controller.get_current_scene()}

@app.post("/obs/set_scene")
def obs_set_scene(request: OBSSetSceneRequest):
    return obs_controller.set_current_scene(request.scene_name)

@app.get("/obs/transitions")
def obs_transitions():
    return obs_controller.get_transitions()

@app.post("/obs/set_transition")
def obs_set_transition(request: OBSSetTransitionRequest):
    return obs_controller.set_transition(request.transition_name, request.duration_ms)

@app.get("/player/state")
async def get_player_state():
    current_item = playlist_manager.get_current_item()
    elapsed = 0

    if playlist_manager.is_playing and playlist_manager.current_video_start_time:
        elapsed = (datetime.now() - playlist_manager.current_video_start_time).total_seconds() - playlist_manager.total_pause_time
    elif playlist_manager.is_paused and playlist_manager.current_video_start_time and playlist_manager.pause_time:
        elapsed = (playlist_manager.pause_time - playlist_manager.current_video_start_time).total_seconds() - playlist_manager.total_pause_time

    return {
        "current_item": current_item,
        "is_playing": playlist_manager.is_playing,
        "elapsed": max(0, elapsed),
        "volume": playlist_manager.output_volume,
        "aspectRatio": output_settings.get("aspectRatio", "16:9"),
        "scalingMode": output_settings.get("scalingMode", "stretch"),
        "audioDeviceLabel": output_settings.get("audioDeviceLabel", ""),
        "revision": playlist_manager.revision
    }

@app.get("/player")
async def player_page():
    scaling_mode_map = {
        "stretch": "fill",
        "fit": "contain",
        "fill": "cover"
    }
    object_fit = scaling_mode_map.get(output_settings.get("scalingMode"), "fill")

    aspect_ratio = output_settings.get("aspectRatio", "16:9")
    container_css = ""

    if aspect_ratio == "9:16":
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
                transition: opacity 120ms linear;
                z-index: 1;
            }
            #container img {
                z-index: 2;
            }
        </style>
    </head>
    <body>
        <div id="container">
            <video id="player" style="opacity:0;"></video>
            <img id="image" style="display:none;">
        </div>
        <script>
            const urlParams = new URLSearchParams(window.location.search);
            const isMuted = urlParams.get('muted') === '1';
            const isOutput = urlParams.get('output') === '1';
            const baseURL = window.location.origin;
            const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

            const video = document.getElementById('player');
            const image = document.getElementById('image');

            video.preload = 'auto';
            video.playsInline = true;
            video.autoplay = false;
            if (isMuted) {
                video.muted = true;
            } else {
                video.muted = false;
            }

            let currentItemId = null;
            let currentItemType = null;
            let loadPending = false;
            let loadStartedAt = 0;
            let loadAttempts = 0;
            let wantsPlay = false;
            let pendingStartAt = 0;
            let playAttempts = 0;
            let playRetryTimer = null;
            let reportedItemId = null;
            let revealed = false;
            let lastHardSeekAt = 0;
            let desiredSinkLabel = '';
            let sinkTimer = null;
            let ws = null;
            let reconnectAttempts = 0;
            const maxReconnectDelay = 10000;

            let audioCtx = null;
            let analyserNode = null;
            let meterData = null;
            let meterSmooth = 0;
            let meterStarted = false;
            let meterRunning = false;
            let lastMeterPost = 0;
            let lastMeterValue = -1;

            function clock() {
                return Date.now();
            }

            function meterTick(ts) {
                if (!meterRunning || !analyserNode) {
                    meterRunning = false;
                    return;
                }
                requestAnimationFrame(meterTick);
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
                if (out === 0 && lastMeterValue === 0) return;
                lastMeterValue = out;
                try {
                    window.parent.postMessage({ type: 'flowair-audio-level', level: out }, '*');
                } catch (e) {}
            }

            function setupAudioMeter() {
                if (meterStarted || !isMuted) return;
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
                    video.muted = false;
                } catch (e) {
                    analyserNode = null;
                    video.muted = true;
                }
            }

            function startMeter() {
                if (!isMuted) return;
                setupAudioMeter();
                resumeAudioCtx();
                if (analyserNode && !meterRunning) {
                    meterRunning = true;
                    requestAnimationFrame(meterTick);
                }
            }

            function stopMeter() {
                meterRunning = false;
                if (lastMeterValue !== 0) {
                    lastMeterValue = 0;
                    try {
                        window.parent.postMessage({ type: 'flowair-audio-level', level: 0 }, '*');
                    } catch (e) {}
                }
            }

            function resumeAudioCtx() {
                if (audioCtx && audioCtx.state === 'suspended') {
                    audioCtx.resume().catch(function () {});
                }
            }

            function applyVolume(v) {
                if (isMuted) return;
                if (typeof v === 'number') {
                    video.volume = Math.max(0, Math.min(1, v / 100));
                }
            }

            function applySink() {
                if (!isOutput || isMuted) return;
                if (!navigator.mediaDevices || typeof video.setSinkId !== 'function') return;

                if (!desiredSinkLabel) {
                    video.setSinkId('').catch(function () {});
                    return;
                }

                navigator.mediaDevices.enumerateDevices().then(function (devices) {
                    let target = '';
                    for (let i = 0; i < devices.length; i++) {
                        if (devices[i].kind === 'audiooutput' && devices[i].label === desiredSinkLabel) {
                            target = devices[i].deviceId;
                            break;
                        }
                    }
                    return video.setSinkId(target);
                }).catch(function () {});
            }

            function scheduleSinkRefresh() {
                if (sinkTimer) clearTimeout(sinkTimer);
                sinkTimer = setTimeout(applySink, 500);
            }

            if (isOutput && navigator.mediaDevices && typeof navigator.mediaDevices.addEventListener === 'function') {
                navigator.mediaDevices.addEventListener('devicechange', scheduleSinkRefresh);
            }

            function applyOutputSettings(aspect, scaling) {
                const fitMap = { stretch: 'fill', fit: 'contain', fill: 'cover' };
                const objectFit = fitMap[scaling] || 'fill';
                const c = document.getElementById('container');
                if (c) {
                    c.style.position = '';
                    c.style.top = '';
                    c.style.left = '';
                    c.style.transform = '';
                    c.style.width = '';
                    c.style.height = '';
                    if (aspect === '9:16') {
                        c.style.position = 'absolute';
                        c.style.top = '50%';
                        c.style.left = '50%';
                        c.style.transform = 'translate(-50%, -50%)';
                        c.style.width = '56.25vh';
                        c.style.height = '100vh';
                    } else if (aspect === '4:3') {
                        c.style.position = 'absolute';
                        c.style.top = '50%';
                        c.style.left = '50%';
                        c.style.transform = 'translate(-50%, -50%)';
                        c.style.width = '133.33vh';
                        c.style.height = '100vh';
                    } else if (aspect === '1:1') {
                        c.style.position = 'absolute';
                        c.style.top = '50%';
                        c.style.left = '50%';
                        c.style.transform = 'translate(-50%, -50%)';
                        c.style.width = '100vh';
                        c.style.height = '100vh';
                    } else if (aspect === '21:9') {
                        c.style.position = 'absolute';
                        c.style.top = '50%';
                        c.style.left = '50%';
                        c.style.transform = 'translate(-50%, -50%)';
                        c.style.width = '100vw';
                        c.style.height = '42.857vw';
                    } else {
                        c.style.width = '100vw';
                        c.style.height = '100vh';
                    }
                }
                video.style.objectFit = objectFit;
                image.style.objectFit = objectFit;
            }

            function revealVideo() {
                if (revealed) return;
                if (!video.videoWidth) return;
                revealed = true;
                video.style.opacity = '1';
                image.style.display = 'none';
            }

            function reportPlaybackError(code, message) {
                if (!isLocalhost || currentItemId === null) return;
                if (reportedItemId === currentItemId) return;
                reportedItemId = currentItemId;
                fetch(baseURL + '/player/playback_error', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-FlowAir-Client': '1' },
                    body: JSON.stringify({ item_id: currentItemId, code: code, message: message })
                }).catch(function () {});
            }

            function clearPlayRetry() {
                if (playRetryTimer) {
                    clearTimeout(playRetryTimer);
                    playRetryTimer = null;
                }
            }

            function attemptPlay() {
                clearPlayRetry();
                if (!wantsPlay || currentItemType !== 'video') return;
                if (video.readyState < 2) return;
                if (!video.paused) return;

                const promise = video.play();
                if (promise === undefined) return;

                promise.then(function () {
                    playAttempts = 0;
                }).catch(function (error) {
                    playAttempts++;
                    const name = error && error.name ? error.name : '';
                    if (name === 'NotSupportedError') {
                        reportPlaybackError('decode_failed', 'The player could not decode this file');
                        return;
                    }
                    if (playAttempts <= 8) {
                        playRetryTimer = setTimeout(attemptPlay, Math.min(1000, 120 * playAttempts));
                    } else {
                        reportPlaybackError('play_failed', 'Playback could not be started');
                    }
                });
            }

            function startLoad(item, startAt, shouldPlay) {
                clearPlayRetry();
                currentItemId = item.id;
                currentItemType = item.type;
                wantsPlay = !!shouldPlay;
                pendingStartAt = startAt || 0;
                playAttempts = 0;
                loadAttempts = 0;
                reportedItemId = null;
                revealed = false;
                lastHardSeekAt = 0;
                video.playbackRate = 1;

                if (item.type === 'image') {
                    loadPending = false;
                    stopMeter();
                    video.pause();
                    video.style.opacity = '0';
                    image.src = baseURL + '/image/' + item.id;
                    image.style.display = 'block';
                    return;
                }

                loadPending = true;
                loadStartedAt = clock();
                image.style.display = 'none';
                video.src = baseURL + '/stream/' + item.id;
                video.load();
            }

            function reloadCurrent() {
                if (currentItemId === null || currentItemType !== 'video') return;
                loadAttempts++;
                if (loadAttempts > 3) {
                    loadPending = false;
                    reportPlaybackError('load_failed', 'The file could not be opened for playback');
                    return;
                }
                loadPending = true;
                loadStartedAt = clock();
                revealed = false;
                video.src = baseURL + '/stream/' + currentItemId + '?retry=' + loadAttempts;
                video.load();
            }

            function clearMedia() {
                clearPlayRetry();
                stopMeter();
                wantsPlay = false;
                loadPending = false;
                currentItemId = null;
                currentItemType = null;
                revealed = false;
                video.pause();
                video.style.opacity = '0';
                image.style.display = 'none';
                video.removeAttribute('src');
                video.load();
            }

            video.addEventListener('loadedmetadata', function () {
                if (pendingStartAt > 0.25) {
                    try {
                        video.currentTime = pendingStartAt;
                    } catch (e) {}
                }
                pendingStartAt = 0;
            });

            video.addEventListener('loadeddata', function () {
                loadPending = false;
                loadAttempts = 0;
                revealVideo();
                attemptPlay();
            });

            video.addEventListener('canplay', function () {
                loadPending = false;
                revealVideo();
                attemptPlay();
            });

            video.addEventListener('playing', function () {
                loadPending = false;
                playAttempts = 0;
                revealVideo();
                startMeter();
            });

            video.addEventListener('pause', function () {
                if (!wantsPlay) stopMeter();
            });

            video.addEventListener('error', function () {
                if (currentItemType !== 'video') return;
                loadPending = false;
                reloadCurrent();
            });

            image.addEventListener('error', function () {
                reportPlaybackError('image_failed', 'The image could not be displayed');
            });

            function handlePlaybackState(data) {
                if (typeof data.volume === 'number') {
                    applyVolume(data.volume);
                }
                if (data.aspectRatio) {
                    applyOutputSettings(data.aspectRatio, data.scalingMode);
                }
                if (typeof data.audioDeviceLabel === 'string' && data.audioDeviceLabel !== desiredSinkLabel) {
                    desiredSinkLabel = data.audioDeviceLabel;
                    applySink();
                }

                const item = data.current_item;
                if (!item) {
                    if (currentItemId !== null) clearMedia();
                    return;
                }

                if (item.id !== currentItemId) {
                    startLoad(item, data.elapsed || 0, data.is_playing);
                    return;
                }

                if (item.type === 'image') {
                    image.style.display = 'block';
                    video.style.opacity = '0';
                    return;
                }

                wantsPlay = !!data.is_playing;
                if (wantsPlay) {
                    attemptPlay();
                } else if (!video.paused) {
                    video.pause();
                }
            }

            function connectWebSocket() {
                const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
                ws = new WebSocket(protocol + '//' + window.location.host + '/ws?role=player');

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
                    let data = null;
                    try {
                        data = JSON.parse(event.data);
                    } catch (e) {
                        return;
                    }

                    if (data.type === 'playback_state_changed') {
                        handlePlaybackState(data);
                    } else if (data.type === 'output_settings_changed') {
                        applyOutputSettings(data.aspectRatio, data.scalingMode);
                        if (typeof data.audioDeviceLabel === 'string' && data.audioDeviceLabel !== desiredSinkLabel) {
                            desiredSinkLabel = data.audioDeviceLabel;
                            applySink();
                        }
                    } else if (data.type === 'volume_changed') {
                        applyVolume(data.volume);
                    } else if (data.type === 'player_seek') {
                        const item = data.current_item;
                        if (item && item.id === currentItemId && item.type === 'video' && !loadPending) {
                            try {
                                video.currentTime = Math.max(0, data.position || 0);
                            } catch (e) {}
                            wantsPlay = !!data.is_playing;
                            if (wantsPlay) attemptPlay();
                        } else {
                            handlePlaybackState(data);
                        }
                    } else if (data.type === 'item_cued') {
                        const item = data.current_item;
                        if (item) {
                            startLoad(item, 0, false);
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

            function watchdog() {
                if (loadPending && clock() - loadStartedAt > 12000) {
                    reloadCurrent();
                    return;
                }
                if (wantsPlay && currentItemType === 'video' && video.paused && video.readyState >= 2) {
                    attemptPlay();
                }
                if (wantsPlay && currentItemType === 'video' && video.readyState < 2 && clock() - loadStartedAt > 20000) {
                    reloadCurrent();
                }
                if (!revealed && currentItemType === 'video' && video.videoWidth) {
                    revealVideo();
                }
                if (meterRunning && audioCtx && audioCtx.state === 'suspended') {
                    resumeAudioCtx();
                }
            }

            function syncElapsed() {
                watchdog();

                if (loadPending || video.seeking) {
                    return;
                }

                fetch(baseURL + '/player/state')
                    .then(res => res.json())
                    .then(data => {
                        if (!data.current_item || data.current_item.type !== 'video') {
                            return;
                        }
                        if (currentItemId !== data.current_item.id) {
                            handlePlaybackState(data);
                            return;
                        }
                        if (!data.is_playing) {
                            return;
                        }
                        if (video.paused) {
                            wantsPlay = true;
                            attemptPlay();
                            return;
                        }
                        if (video.readyState < 3) {
                            return;
                        }

                        const drift = video.currentTime - data.elapsed;
                        const distance = Math.abs(drift);

                        if (distance > 2 && clock() - lastHardSeekAt > 5000) {
                            lastHardSeekAt = clock();
                            video.playbackRate = 1;
                            try {
                                video.currentTime = data.elapsed;
                            } catch (e) {}
                        } else if (distance > 0.35) {
                            video.playbackRate = drift > 0 ? 0.97 : 1.03;
                        } else if (video.playbackRate !== 1) {
                            video.playbackRate = 1;
                        }
                    })
                    .catch(() => {});
            }

            const pollingInterval = isMuted ? 1000 : 500;
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

STREAM_CHUNK_SIZE = 1048576
RANGE_CHUNK_SIZE = 4194304

VIDEO_MIME_TYPES = {
    '.mp4': 'video/mp4',
    '.m4v': 'video/mp4',
    '.mov': 'video/mp4',
    '.webm': 'video/webm',
    '.mkv': 'video/x-matroska',
    '.avi': 'video/x-msvideo',
    '.wmv': 'video/x-ms-wmv',
    '.flv': 'video/x-flv',
    '.mpg': 'video/mpeg',
    '.mpeg': 'video/mpeg'
}

def find_playlist_item(item_id):
    for playlist_item in playlist_manager.playlist:
        if playlist_item['id'] == item_id:
            return playlist_item
    return None

def get_file_size(filepath):
    try:
        return os.path.getsize(filepath) if os.path.isfile(filepath) else None
    except OSError:
        return None

def parse_byte_range(range_header, file_size):
    try:
        unit, _, ranges = range_header.partition("=")
        if unit.strip().lower() != "bytes" or file_size <= 0:
            return None
        first_range = ranges.split(",")[0].strip()
        start_text, _, end_text = first_range.partition("-")
        if start_text.strip() == "":
            suffix_length = int(end_text)
            if suffix_length <= 0:
                return None
            start = max(0, file_size - suffix_length)
            end = file_size - 1
        else:
            start = int(start_text)
            end = int(end_text) if end_text.strip() else file_size - 1
        end = min(end, file_size - 1)
        if start < 0 or start > end:
            return None
        return start, end
    except ValueError:
        return None

def read_file_chunks(filepath, start=0, length=None, chunk_size=STREAM_CHUNK_SIZE):
    try:
        with open(filepath, mode="rb") as file_like:
            file_like.seek(start)
            remaining = length
            while remaining is None or remaining > 0:
                size = chunk_size if remaining is None else min(chunk_size, remaining)
                chunk = file_like.read(size)
                if not chunk:
                    break
                if remaining is not None:
                    remaining -= len(chunk)
                yield chunk
    except OSError:
        pass

@app.get("/stream/{item_id}")
async def stream_video(item_id: int, request: Request):
    item = find_playlist_item(item_id)
    if not item or not item.get('location'):
        return JSONResponse({"error": "Item not found"}, status_code=404)

    filepath = item['location']
    file_size = await asyncio.to_thread(get_file_size, filepath)
    if file_size is None:
        return JSONResponse({"error": "File not found"}, status_code=404)

    ext = Path(filepath).suffix.lower()
    media_type = VIDEO_MIME_TYPES.get(ext, 'video/mp4')

    range_header = request.headers.get('range')
    if range_header:
        byte_range = parse_byte_range(range_header, file_size)
        if byte_range is None:
            return Response(status_code=416, headers={'Content-Range': f'bytes */{file_size}'})

        start, end = byte_range
        chunk_size = end - start + 1
        headers = {
            'Content-Range': f'bytes {start}-{end}/{file_size}',
            'Accept-Ranges': 'bytes',
            'Content-Length': str(chunk_size),
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0',
        }
        return StreamingResponse(read_file_chunks(filepath, start, chunk_size, RANGE_CHUNK_SIZE), status_code=206, headers=headers, media_type=media_type)

    headers = {
        'Accept-Ranges': 'bytes',
        'Content-Length': str(file_size)
    }
    return StreamingResponse(read_file_chunks(filepath, 0, file_size), headers=headers, media_type=media_type)

@app.get("/image/{item_id}")
async def serve_image(item_id: int):
    item = find_playlist_item(item_id)
    if not item or item['type'] != 'image' or not item.get('location'):
        return JSONResponse({"error": "Image not found"}, status_code=404)

    filepath = item['location']
    file_size = await asyncio.to_thread(get_file_size, filepath)
    if file_size is None:
        return JSONResponse({"error": "File not found"}, status_code=404)

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

    return StreamingResponse(read_file_chunks(filepath, 0, file_size), media_type=media_type)

def watch_parent_process():
    parent_pid = os.environ.get("FLOWAIR_PARENT_PID")
    if not parent_pid:
        return
    try:
        parent = psutil.Process(int(parent_pid))
    except (psutil.Error, ValueError):
        os._exit(0)

    def monitor():
        while True:
            time.sleep(2)
            try:
                if not parent.is_running():
                    os._exit(0)
            except psutil.Error:
                os._exit(0)

    threading.Thread(target=monitor, daemon=True).start()


if __name__ == "__main__":
    watch_parent_process()
    config = Config()
    uvicorn.run(
        app,
        host=config.HOST,
        port=config.PORT,
        log_level="critical",
        log_config=None,
        access_log=False
    )
