import os
import time
from datetime import datetime, timedelta
from file_validator import FileValidator
from media_converter import MediaConverter, ACTIVE_STATUSES, PLANS
import threading
from concurrent.futures import ThreadPoolExecutor

SKIPPED_PLAYABILITY = ("unsupported", "preparing")


def is_skipped_on_air(item):
    return item.get("status") == "corrupted" or item.get("playability") in SKIPPED_PLAYABILITY


def empty_conversion(plan="none"):
    return {"plan": plan, "status": "none", "progress": 0, "encoder": "", "error": ""}



class PlaylistManager:
    def __init__(self):
        self.playlist = []
        self.current_index = -1
        self.is_playing = False
        self.is_paused = False
        self.pause_time = None
        self.total_pause_time = 0
        self.current_video_start_time = None
        self.current_video_elapsed = 0
        self.validator = FileValidator()
        self.next_id = 1
        self.last_cleanup_time = datetime.now()
        self.cleanup_thread = None
        self.running = True
        self.next_video_scheduled_time = None
        self.scheduled_item_id = None
        self.force_timing_thread = None
        self.next_lock = threading.Lock()
        self.last_next_time = None
        self.absolute_schedule = {}
        self.playlist_start_time = None
        self.validation_cache = {}
        self.validation_cache_max = 2000
        self.active_validations = set()
        self.validation_condition = threading.Condition()
        self.validation_completed = False
        self.validation_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="flowair-validate")
        self.last_validation_at = time.monotonic()
        self.revision = 0
        self.on_playback_change = None
        self.on_obs_event = None
        self.output_volume = 100
        self.on_conversion_change = None
        self.conversion_keys = {}
        self.conversion_sources = {}
        self.base_states = {}
        self.converter = MediaConverter()
        self.converter.on_update = self._on_conversion_update
        self.converter.referenced_keys = self._referenced_conversion_keys
        self.converter.engine_busy = lambda: self.is_playing
        self.converter.idle_hook = self.queue_pending_conversions
        self.clear_playlist_on_startup()
        self._start_cleanup_thread()
        self._start_force_timing_thread()

    def _bump_revision(self):
        self.revision += 1

    @staticmethod
    def file_signature(filepath):
        try:
            stat = os.stat(filepath)
            return f"{stat.st_mtime_ns}:{stat.st_size}"
        except OSError:
            return ""

    def add_item(self, filepath, insert_index=None, loop=False):
        was_empty = len(self.playlist) == 0

        item = {
            "id": self.next_id,
            "name": os.path.basename(filepath),
            "location": filepath,
            "type": "video",
            "duration": None,
            "duration_formatted": "Validating...",
            "status": "validating",
            "resolution": None,
            "start_time": None,
            "loop": bool(loop),
            "file_size": None,
            "format": None,
            "bitrate": None,
            "playability": "ok",
            "issues": [],
            "file_signature": "",
            "video_codec": None,
            "audio_codec": None,
            "conversion": empty_conversion()
        }

        self.next_id += 1
        self._insert_item(item, insert_index)
        self._bump_revision()

        self.validation_executor.submit(self._validate_item_async, item)

        if was_empty and self.current_index == -1:
            self.current_index = 0
            self.current_video_start_time = datetime.now()
            self.is_paused = True
            self.pause_time = datetime.now()

        if self.is_playing:
            self.absolute_schedule = {}
            self._calculate_absolute_schedule()
        self.recalculate_start_times()
        return item

    def duplicate_item(self, item_id, insert_index=None):
        source = None
        for item in self.playlist:
            if item["id"] == item_id:
                source = item
                break

        if source is None or source["type"] not in ["video", "image"]:
            return None

        item = dict(source)
        item["id"] = self.next_id
        item["start_time"] = None
        item["issues"] = list(source.get("issues") or [])
        item["conversion"] = dict(source.get("conversion") or empty_conversion())
        item.setdefault("video_codec", None)
        item.setdefault("audio_codec", None)
        item.pop("cue_timestamp", None)

        self.next_id += 1
        self._share_conversion(source["id"], item["id"])
        self._insert_item(item, insert_index)
        self._bump_revision()

        if item.get("status") == "validating":
            self.validation_executor.submit(self._validate_item_async, item)

        if self.is_playing:
            self.absolute_schedule = {}
            self._calculate_absolute_schedule()
        self.recalculate_start_times()
        return item

    def _build_restored_item(self, data):
        item_type = data.get("type")
        if item_type not in ["video", "image", "stop", "note", "obs"]:
            return None

        item = {
            "id": self.next_id,
            "name": data.get("name") or "",
            "location": data.get("location"),
            "type": item_type,
            "duration": data.get("duration"),
            "duration_formatted": data.get("duration_formatted"),
            "status": "normal",
            "resolution": data.get("resolution"),
            "start_time": None,
            "playability": data.get("playability", "ok"),
            "issues": list(data.get("issues") or []),
            "file_signature": "",
            "conversion": empty_conversion()
        }

        if item["playability"] not in ["ok", "warn", "unsupported"]:
            item["playability"] = "ok"

        if item_type in ["video", "image"]:
            if not item["location"]:
                return None
            item["loop"] = bool(data.get("loop", False))
            item["file_size"] = data.get("file_size")
            item["format"] = data.get("format")
            item["bitrate"] = data.get("bitrate")
            item["video_codec"] = data.get("video_codec")
            item["audio_codec"] = data.get("audio_codec")
            item["status"] = "validating"
            item["duration_formatted"] = data.get("duration_formatted") or "Validating..."
        elif item_type == "note":
            item["name"] = "NOTE"
            item["note"] = data.get("note", "")
        elif item_type == "obs":
            item["name"] = "OBS EVENT"
            item["obs_scene"] = data.get("obs_scene", "")
            item["obs_source"] = data.get("obs_source", "")
            item["obs_action"] = data.get("obs_action", "show")
            item["obs_transition"] = data.get("obs_transition", "")
            item["obs_transition_duration"] = data.get("obs_transition_duration", 0)
        else:
            item["name"] = "STOP EVENT"

        self.next_id += 1
        return item

    def restore_items(self, items, position=None):
        created = []
        index = position

        for data in items:
            item = self._build_restored_item(data)
            if item is None:
                continue

            self._insert_item(item, index)
            created.append(item)

            if index is not None:
                index = min(index + 1, len(self.playlist))
            if item["type"] in ["video", "image"]:
                self.validation_executor.submit(self._validate_item_async, item)

        if not created:
            return []

        self._bump_revision()

        if self.current_index == -1 and self.playlist:
            self.current_index = 0
            self.current_video_start_time = datetime.now()
            self.is_paused = True
            self.pause_time = datetime.now()

        if self.is_playing:
            self.absolute_schedule = {}
            self._calculate_absolute_schedule()
        self.recalculate_start_times()
        return created

    def _insert_item(self, item, insert_index):
        if insert_index is None or insert_index < 0 or insert_index > len(self.playlist):
            insert_index = len(self.playlist)

        if 0 <= self.current_index and insert_index <= self.current_index:
            if self.is_playing:
                insert_index = self.current_index + 1
            else:
                self.playlist.insert(insert_index, item)
                self.current_index += 1
                return

        self.playlist.insert(insert_index, item)

    def _validate_item_async(self, item):
        filepath = item["location"]
        deadline = time.monotonic() + 30.0

        with self.validation_condition:
            while filepath in self.active_validations and time.monotonic() < deadline:
                self.validation_condition.wait(timeout=1.0)
            self.active_validations.add(filepath)

        try:
            self._apply_validation(item, filepath)
        finally:
            with self.validation_condition:
                self.active_validations.discard(filepath)
                self.validation_condition.notify_all()

    def _cache_key(self, filepath, signature):
        return f"{filepath}|{signature}"

    def _evict_cache_entries(self, filepath):
        prefix = f"{filepath}|"
        for key in [k for k in self.validation_cache if k.startswith(prefix)]:
            del self.validation_cache[key]

    def _probe_file(self, filepath):
        probe = getattr(self.validator, "probe", None)
        if probe is not None:
            return probe(filepath)

        validation = self.validator.validate_file(filepath)
        return {
            "type": validation["type"],
            "valid": validation["valid"],
            "duration": validation["duration"],
            "resolution": validation["resolution"],
            "file_size": self.validator.get_file_size(filepath),
            "format": self.validator.get_codec_info(filepath),
            "bitrate": self.validator.get_bitrate(filepath) if validation["type"] == "video" else None,
            "playability": "ok",
            "issues": []
        }

    def _apply_result(self, item, result):
        item["type"] = result.get("type", "video")
        item["duration"] = result.get("duration")
        item["duration_formatted"] = result.get("duration_formatted") or (
            self.validator.get_video_duration_formatted(result.get("duration")) if item["type"] == "video" else "STATIC"
        )
        item["status"] = "normal" if result.get("valid") else "corrupted"
        item["resolution"] = result.get("resolution")
        item["file_size"] = result.get("file_size")
        item["format"] = result.get("format")
        item["bitrate"] = result.get("bitrate")
        item["playability"] = result.get("playability", "ok")
        item["issues"] = list(result.get("issues") or [])
        item["video_codec"] = result.get("video_codec")
        item["audio_codec"] = result.get("audio_codec")

    def _apply_validation(self, item, filepath):
        try:
            signature = self.file_signature(filepath)
            key = self._cache_key(filepath, signature)

            if signature and key in self.validation_cache:
                result = self.validation_cache[key]
                self._apply_result(item, result)
            else:
                result = self._probe_file(filepath)
                result["duration_formatted"] = (
                    self.validator.get_video_duration_formatted(result.get("duration"))
                    if result.get("type") == "video" else "STATIC"
                )
                if "file_size" not in result:
                    result["file_size"] = self.validator.get_file_size(filepath)
                self._apply_result(item, result)
                if signature:
                    self._evict_cache_entries(filepath)
                    self.validation_cache[key] = result

            item["file_signature"] = signature
            self._plan_conversion(item, result, signature)
        except Exception:
            item["status"] = "corrupted"
            item["duration_formatted"] = "ERROR"
            item["playability"] = "unsupported"
            item["issues"] = [{"level": "error", "code": "probe_failed", "message": "The file could not be analysed"}]
            self._evict_cache_entries(filepath)
            self._forget_conversion(item["id"])
            item["conversion"] = empty_conversion()

        try:
            if self.is_playing:
                self.absolute_schedule = {}
                self._calculate_absolute_schedule()
            self.recalculate_start_times()
        except Exception:
            pass

        self._bump_revision()
        self.last_validation_at = time.monotonic()
        self.validation_completed = True

    def _find_item(self, item_id):
        for item in list(self.playlist):
            if item["id"] == item_id:
                return item
        return None

    def _is_on_air(self, item_id):
        current = self.get_current_item()
        return bool(self.is_playing and current is not None and current["id"] == item_id)

    def _referenced_conversion_keys(self):
        return set(list(self.conversion_keys.values()))

    def _plan_conversion(self, item, result, signature):
        item_id = item["id"]
        plan = result.get("conversion_plan") or "none"
        convertible = plan in PLANS and item.get("type") == "video" and result.get("valid") and signature
        key = self.converter.key_for(item["location"], signature, plan) if convertible else None

        if self.conversion_keys.get(item_id) != key:
            self._forget_conversion(item_id)
        self.base_states[item_id] = (item.get("playability", "ok"), list(item.get("issues") or []))

        if key is None:
            item["conversion"] = empty_conversion()
            return

        self.conversion_keys[item_id] = key
        self.conversion_sources[key] = (item["location"], plan, dict(result.get("conversion_info") or {}))

        state = self.converter.lookup(key, plan)
        if state is not None and state["status"] in ACTIVE_STATUSES:
            self.converter.attach(key, item_id)
        elif state is None and self.converter.policy_allows(plan) and not self._is_on_air(item_id):
            state = self.converter.request(key, item["location"], plan, self.conversion_sources[key][2], item_id)

        if state is None:
            item["conversion"] = empty_conversion(plan)
            return
        self._apply_conversion_state(item, state)

    def _apply_conversion_state(self, item, state):
        if state["status"] in ACTIVE_STATUSES:
            item["conversion"] = dict(state)
            item["playability"] = "preparing"
            return
        if state["status"] == "done" and self._apply_converted(item):
            item["conversion"] = dict(state)
            return
        base_playability, base_issues = self.base_states.get(item["id"], ("ok", []))
        if state["status"] == "done":
            state = dict(state, status="failed", progress=0, error="The converted copy cannot be read")
        item["conversion"] = dict(state)
        item["playability"] = base_playability
        item["issues"] = list(base_issues)

    def _apply_converted(self, item):
        key = self.conversion_keys.get(item["id"])
        path = self.converter.resolve(key) if key else None
        if not path:
            return False
        signature = self.file_signature(path)
        cache_key = self._cache_key(path, signature)
        result = self.validation_cache.get(cache_key) if signature else None
        if result is None:
            result = self._probe_file(path)
            if signature:
                self._evict_cache_entries(path)
                self.validation_cache[cache_key] = result
        if not result.get("valid") or result.get("playability") == "unsupported":
            return False
        item["playability"] = result.get("playability", "ok")
        item["issues"] = list(result.get("issues") or [])
        return True

    def _share_conversion(self, source_id, item_id):
        key = self.conversion_keys.get(source_id)
        if key is None:
            return
        self.conversion_keys[item_id] = key
        if source_id in self.base_states:
            playability, issues = self.base_states[source_id]
            self.base_states[item_id] = (playability, list(issues))
        self.converter.attach(key, item_id)

    def _forget_conversion(self, item_id):
        self.base_states.pop(item_id, None)
        key = self.conversion_keys.pop(item_id, None)
        if key is None:
            return
        self.converter.release(key, item_id)
        if key not in self.conversion_keys.values():
            self.conversion_sources.pop(key, None)

    def _on_conversion_update(self, key, state, item_ids, final):
        changed = []
        for item in list(self.playlist):
            if item["id"] in item_ids and self.conversion_keys.get(item["id"]) == key:
                self._apply_conversion_state(item, state)
                changed.append(item["id"])
        if not changed:
            return
        self._bump_revision()
        if self.on_conversion_change:
            self.on_conversion_change(changed, final)

    def queue_pending_conversions(self):
        started = []
        for item in list(self.playlist):
            conversion = item.get("conversion") or {}
            plan = conversion.get("plan")
            if conversion.get("status") != "none" or plan not in PLANS:
                continue
            if item.get("status") != "normal" or not self.converter.policy_allows(plan):
                continue
            key = self.conversion_keys.get(item["id"])
            source = self.conversion_sources.get(key)
            if source is None or self._is_on_air(item["id"]):
                continue
            state = self.converter.request(key, source[0], plan, source[2], item["id"])
            if state is None:
                continue
            self._apply_conversion_state(item, state)
            started.append(item["id"])
        if started:
            self._bump_revision()
            if self.on_conversion_change:
                self.on_conversion_change(started, False)
        return started

    def start_conversion(self, item_id):
        item = self._find_item(item_id)
        if item is None or item.get("type") != "video":
            return False, "Item not found"
        key = self.conversion_keys.get(item_id)
        source = self.conversion_sources.get(key)
        if source is None:
            return False, "This file does not need a conversion"
        sharing = [other_id for other_id, other_key in list(self.conversion_keys.items()) if other_key == key]
        if any(self._is_on_air(other_id) for other_id in sharing):
            return False, "The item is on air"
        state = self.converter.request(key, source[0], source[1], source[2], item_id, manual=True, restart=True)
        if state is None:
            return False, "The converted copy is in use"
        for other_id in sharing:
            if other_id != item_id:
                self.converter.attach(key, other_id)
        for other in list(self.playlist):
            if other["id"] in sharing:
                self._apply_conversion_state(other, state)
        self._bump_revision()
        return True, None

    def cancel_conversion(self, item_id):
        key = self.conversion_keys.get(item_id)
        if key is None:
            return False
        return self.converter.cancel(key)

    def update_conversion_settings(self, **settings):
        result = self.converter.update_settings(**settings)
        self.queue_pending_conversions()
        return result

    def resolve_stream_path(self, item):
        conversion = item.get("conversion") or {}
        if conversion.get("status") == "done":
            key = self.conversion_keys.get(item["id"])
            path = self.converter.resolve(key) if key else None
            if path:
                return path, True
        return item.get("location"), False

    def insert_stop_event(self, insert_index):
        item = {
            "id": self.next_id,
            "name": "STOP EVENT",
            "location": None,
            "type": "stop",
            "duration": None,
            "duration_formatted": None,
            "status": "normal",
            "resolution": None,
            "start_time": None,
            "playability": "ok",
            "issues": [],
            "file_signature": "",
            "conversion": empty_conversion()
        }

        self.next_id += 1
        self._insert_item(item, insert_index)
        self._bump_revision()

        if self.is_playing:
            self.absolute_schedule = {}
            self._calculate_absolute_schedule()
        self.recalculate_start_times()
        return item

    def insert_note(self, insert_index, note):
        item = {
            "id": self.next_id,
            "name": "NOTE",
            "location": None,
            "type": "note",
            "duration": None,
            "duration_formatted": None,
            "status": "normal",
            "resolution": None,
            "start_time": None,
            "playability": "ok",
            "issues": [],
            "file_signature": "",
            "conversion": empty_conversion(),
            "note": note
        }

        self.next_id += 1
        self._insert_item(item, insert_index)
        self._bump_revision()

        if self.is_playing:
            self.absolute_schedule = {}
            self._calculate_absolute_schedule()
        self.recalculate_start_times()
        return item

    def insert_obs_event(self, insert_index, obs_scene, obs_source, obs_action,
                         obs_transition="", obs_transition_duration=0):
        item = {
            "id": self.next_id,
            "name": "OBS EVENT",
            "location": None,
            "type": "obs",
            "duration": None,
            "duration_formatted": None,
            "status": "normal",
            "resolution": None,
            "start_time": None,
            "playability": "ok",
            "issues": [],
            "file_signature": "",
            "conversion": empty_conversion(),
            "obs_scene": obs_scene,
            "obs_source": obs_source,
            "obs_action": obs_action,
            "obs_transition": obs_transition,
            "obs_transition_duration": obs_transition_duration
        }

        self.next_id += 1
        self._insert_item(item, insert_index)
        self._bump_revision()

        if self.is_playing:
            self.absolute_schedule = {}
            self._calculate_absolute_schedule()
        self.recalculate_start_times()
        return item

    def update_obs_event(self, item_id, obs_scene, obs_source, obs_action,
                        obs_transition="", obs_transition_duration=0):
        for item in self.playlist:
            if item["id"] == item_id and item["type"] == "obs":
                item["obs_scene"] = obs_scene
                item["obs_source"] = obs_source
                item["obs_action"] = obs_action
                item["obs_transition"] = obs_transition
                item["obs_transition_duration"] = obs_transition_duration
                self._bump_revision()
                return item
        return None

    def update_note(self, item_id, note):
        for item in self.playlist:
            if item["id"] == item_id and item["type"] == "note":
                item["note"] = note
                self._bump_revision()
                return True
        return False

    def remove_item(self, item_id):
        item_to_remove = None
        removed_index = -1
        was_current_item = False

        for idx, item in enumerate(self.playlist):
            if item["id"] == item_id:
                item_to_remove = item
                removed_index = idx
                if idx == self.current_index:
                    was_current_item = True
                break

        self.playlist = [item for item in self.playlist if item["id"] != item_id]

        if was_current_item:
            self.stop()
            self.current_index = -1
        elif removed_index >= 0 and removed_index < self.current_index:
            self.current_index -= 1

        if item_to_remove and item_to_remove.get("location"):
            filepath = item_to_remove["location"]
            still_in_playlist = any(item.get("location") == filepath for item in self.playlist)

            if not still_in_playlist:
                self._evict_cache_entries(filepath)

        if item_to_remove is not None:
            self._forget_conversion(item_id)
            self._bump_revision()

        if self.is_playing:
            self.absolute_schedule = {}
            self._calculate_absolute_schedule()
        self.recalculate_start_times()
        return item_to_remove is not None

    def clear_playlist(self):
        if self.is_playing:
            return False

        self.playlist = []
        self.current_index = -1
        self.is_playing = False
        self.is_paused = False
        self.pause_time = None
        self.total_pause_time = 0
        self.current_video_start_time = None
        self.current_video_elapsed = 0
        self.next_video_scheduled_time = None
        self.scheduled_item_id = None
        self.absolute_schedule = {}
        self.playlist_start_time = None
        self.validation_cache = {}
        self.conversion_keys = {}
        self.conversion_sources = {}
        self.base_states = {}
        self.converter.cancel_all()
        self._bump_revision()
        return True

    def reorder_items(self, from_index, to_index):
        if self.current_index >= 0 and (from_index <= self.current_index or to_index <= self.current_index):
            return False
        if not (0 <= from_index < len(self.playlist) and 0 <= to_index < len(self.playlist)):
            return False

        item = self.playlist.pop(from_index)
        self.playlist.insert(to_index, item)
        self._bump_revision()

        if self.is_playing:
            self.absolute_schedule = {}
            self._calculate_absolute_schedule()
        self.recalculate_start_times()
        return True

    def set_order(self, item_ids):
        if self.current_index >= 0:
            head = self.playlist[:self.current_index + 1]
            tail = self.playlist[self.current_index + 1:]
        else:
            head = []
            tail = list(self.playlist)

        by_id = {item["id"]: item for item in tail}
        ordered = [by_id.pop(item_id) for item_id in item_ids if item_id in by_id]
        if not ordered:
            return False

        ordered.extend(item for item in tail if item["id"] in by_id)
        self.playlist = head + ordered
        self._bump_revision()

        if self.is_playing:
            self.absolute_schedule = {}
            self._calculate_absolute_schedule()
        self.recalculate_start_times()
        return True

    def move_items(self, item_ids, position):
        ids = set(item_ids)
        indices = [idx for idx, item in enumerate(self.playlist) if item["id"] in ids]
        if not indices or indices[0] <= self.current_index:
            return False

        moving = [self.playlist[idx] for idx in indices]
        remaining = [item for item in self.playlist if item["id"] not in ids]
        position = max(self.current_index + 1, min(int(position), len(remaining)))
        self.playlist = remaining[:position] + moving + remaining[position:]
        self._bump_revision()

        if self.is_playing:
            self.absolute_schedule = {}
            self._calculate_absolute_schedule()
        self.recalculate_start_times()
        return True

    def get_playlist(self):
        return self.playlist

    def get_current_item(self):
        if 0 <= self.current_index < len(self.playlist):
            return self.playlist[self.current_index]
        return None

    def play(self):
        if self.current_index == -1 and len(self.playlist) > 0:
            self.current_index = 0

        current_item = self.get_current_item()
        if current_item and (current_item.get("status") == "corrupted" or current_item.get("playability") in SKIPPED_PLAYABILITY):
            self.next()
            return

        if self.is_paused and self.pause_time:
            now = datetime.now()
            current_item = self.get_current_item()

            if current_item and current_item["type"] == "video" and current_item.get("duration"):
                elapsed = (self.pause_time - self.current_video_start_time).total_seconds() - self.total_pause_time

                if elapsed > current_item["duration"] or elapsed < 0:
                    self.current_video_start_time = now
                    self.current_video_elapsed = 0
                    self.total_pause_time = 0
                else:
                    remaining = max(0, current_item["duration"] - elapsed)
                    self.current_video_start_time = now - timedelta(seconds=elapsed)
                    self.total_pause_time = 0

            self.is_paused = False
            self.is_playing = True
            self.pause_time = None
        else:
            self.is_playing = True
            self.current_video_start_time = datetime.now()
            self.current_video_elapsed = 0
            self.total_pause_time = 0

        self._calculate_absolute_schedule()
        self.recalculate_start_times()

    def stop(self):
        if self.is_playing:
            self.is_playing = False
            self.is_paused = True
            self.pause_time = datetime.now()
            self.next_video_scheduled_time = None
            self.scheduled_item_id = None

    def pause(self):
        if self.is_playing:
            self.is_playing = False
            self.is_paused = True
            self.pause_time = datetime.now()
            self.next_video_scheduled_time = None
            self.scheduled_item_id = None

    def get_next_playable_item(self):
        if self.current_index < 0:
            return None

        current = self.get_current_item()
        if current and current.get("type") == "video" and current.get("loop"):
            return None

        for index in range(self.current_index + 1, len(self.playlist)):
            item = self.playlist[index]
            if item["type"] == "stop":
                return None
            if item["type"] in ["note", "obs"]:
                continue
            if item.get("status") == "corrupted" or item.get("playability") in SKIPPED_PLAYABILITY:
                continue
            if item["type"] in ["video", "image"]:
                return item
        return None

    def _notify_playback_state(self):
        if self.on_playback_change:
            self.on_playback_change({
                "type": "playback_state_changed",
                "current_item": self.get_current_item(),
                "next_item": self.get_next_playable_item(),
                "is_playing": self.is_playing
            })

    def next(self, from_force_timing=False):
        if not self.next_lock.acquire(blocking=False):
            return

        try:
            self.next_video_scheduled_time = None
            self.scheduled_item_id = None

            now = datetime.now()
            if self.last_next_time and (now - self.last_next_time).total_seconds() < 0.2:
                return

            self.last_next_time = now
            was_playing = self.is_playing

            if self.current_index >= 0 and self.current_index < len(self.playlist):
                current_item = self.playlist[self.current_index]

                if not from_force_timing and current_item.get("loop", False) and current_item["type"] == "video":
                    self.current_video_start_time = datetime.now()
                    self.current_video_elapsed = 0
                    self.total_pause_time = 0
                    self.absolute_schedule = {}
                    self._calculate_absolute_schedule()
                    self.recalculate_start_times()
                    return

            while True:
                if self.current_index >= len(self.playlist) - 1:
                    self.stop()
                    self.recalculate_start_times()
                    self._notify_playback_state()
                    return

                self.current_index += 1
                next_item = self.playlist[self.current_index]

                if next_item["type"] == "stop":
                    self.current_index -= 1
                    self.stop()
                    self.recalculate_start_times()
                    self._notify_playback_state()
                    return

                if next_item["type"] == "note":
                    continue

                if next_item["type"] == "obs":
                    if self.on_obs_event:
                        self.on_obs_event(next_item)
                    continue

                if next_item.get("status") == "corrupted" or next_item.get("playability") in SKIPPED_PLAYABILITY:
                    continue

                if next_item["type"] in ["video", "image"]:
                    break

            saved_next_start = None
            if from_force_timing and was_playing:
                next_item_id = next_item["id"]
                if next_item_id in self.absolute_schedule:
                    saved_next_start = self.absolute_schedule[next_item_id]["start"]

            if saved_next_start:
                self.current_video_start_time = saved_next_start
            else:
                self.current_video_start_time = datetime.now()

            self.current_video_elapsed = 0
            self.total_pause_time = 0

            if was_playing:
                self.is_playing = True
                self.absolute_schedule = {}
                self._calculate_absolute_schedule()

            self.recalculate_start_times()

            self._notify_playback_state()
        finally:
            self.next_lock.release()

    def cue(self, item_id):
        self.next_video_scheduled_time = None
        self.scheduled_item_id = None
        for idx, item in enumerate(self.playlist):
            if item["id"] == item_id:
                if item.get("status") == "corrupted":
                    return

                self.current_index = idx
                self.current_video_elapsed = 0
                self.total_pause_time = 0
                cue_time = datetime.now()
                self.current_video_start_time = cue_time
                self.is_playing = False
                self.is_paused = True
                self.pause_time = cue_time
                item["cue_timestamp"] = cue_time.timestamp()

                self.recalculate_start_times()
                break

    def set_output_volume(self, volume):
        try:
            self.output_volume = max(0, min(100, int(volume)))
        except (TypeError, ValueError):
            pass
        return self.output_volume

    def seek(self, position_seconds, item_id=None):
        current_item = self.get_current_item()
        if not current_item or current_item.get("type") != "video":
            return False
        if item_id is not None and current_item["id"] != item_id:
            return False
        if self.current_video_start_time is None:
            return False

        position = max(0.0, float(position_seconds))
        duration = current_item.get("duration")
        if duration:
            position = min(position, float(duration))

        now = datetime.now()
        self.current_video_start_time = now - timedelta(seconds=position)
        self.current_video_elapsed = position
        self.total_pause_time = 0
        if self.is_paused:
            self.pause_time = now

        self.absolute_schedule = {}
        self._calculate_absolute_schedule()
        self.recalculate_start_times()
        return True

    def mark_as_corrupted(self, item_id):
        for item in self.playlist:
            if item["id"] == item_id:
                item["status"] = "corrupted"
                if item.get("location"):
                    self._evict_cache_entries(item["location"])
                self._bump_revision()
                break

    def mark_for_revalidation(self, item_id):
        for item in self.playlist:
            if item["id"] == item_id and item.get("location"):
                self._evict_cache_entries(item["location"])
                conversion = item.get("conversion") or {}
                item["status"] = "validating"
                item["duration_formatted"] = "Validating..."
                item["issues"] = []
                if conversion.get("status") in ACTIVE_STATUSES:
                    item["playability"] = "preparing"
                else:
                    item["playability"] = "ok"
                    item["conversion"] = empty_conversion()
                self._bump_revision()
                self.validation_executor.submit(self._validate_item_async, item)
                return True
        return False

    def record_playback_error(self, item_id, code, message, fatal=True):
        for item in self.playlist:
            if item["id"] == item_id:
                level = "error" if fatal else "warn"
                issues = list(item.get("issues") or [])
                issues = [issue for issue in issues if issue.get("code") != code]
                issues.append({
                    "level": level,
                    "code": code or "playback_failed",
                    "message": message or "The player could not decode this file"
                })
                item["issues"] = issues

                if fatal:
                    item["status"] = "corrupted"
                    item["playability"] = "unsupported"
                    if item.get("location"):
                        self._evict_cache_entries(item["location"])
                elif item.get("playability") == "ok":
                    item["playability"] = "warn"

                self._bump_revision()
                return item
        return None

    def shutdown(self):
        self.running = False
        self.converter.shutdown()
        try:
            self.validation_executor.shutdown(wait=False, cancel_futures=True)
        except TypeError:
            self.validation_executor.shutdown(wait=False)

    def _start_cleanup_thread(self):
        self.cleanup_thread = threading.Thread(target=self._cleanup_loop, daemon=True)
        self.cleanup_thread.start()

    def _start_force_timing_thread(self):
        self.force_timing_thread = threading.Thread(target=self._force_timing_loop, daemon=True)
        self.force_timing_thread.start()

    def _force_timing_loop(self):
        while self.running:
            try:
                if not self.is_playing or self.current_index < 0:
                    time.sleep(0.1)
                    continue

                current_item = self.get_current_item()
                if not current_item or current_item["type"] != "video":
                    time.sleep(0.1)
                    continue

                current_item_id = current_item["id"]
                if current_item_id not in self.absolute_schedule:
                    time.sleep(0.1)
                    continue

                schedule_info = self.absolute_schedule[current_item_id]
                scheduled_start = schedule_info["start"]
                scheduled_end = schedule_info["end"]
                original_duration = schedule_info["duration"]

                actual_start = self.current_video_start_time
                drift = (actual_start - scheduled_start).total_seconds()

                adjusted_end = scheduled_end - timedelta(seconds=drift)

                now = datetime.now()
                time_until_end = (adjusted_end - now).total_seconds()

                if time_until_end <= 0.5:
                    if current_item.get("loop", False):
                        self.current_video_start_time = datetime.now()
                        self.current_video_elapsed = 0
                        self.total_pause_time = 0
                        self.absolute_schedule = {}
                        self._calculate_absolute_schedule()
                        self.recalculate_start_times()
                    else:
                        elapsed = (now - actual_start).total_seconds() - self.total_pause_time
                        if elapsed >= (original_duration - 0.3):
                            self.next(from_force_timing=True)

                time.sleep(0.05)
            except:
                time.sleep(0.1)

    def _cleanup_loop(self):
        while self.running:
            try:
                time.sleep(60)

                files_in_playlist = set()
                for item in self.playlist:
                    if item.get("location"):
                        files_in_playlist.add(item.get("location"))

                for key in list(self.validation_cache.keys()):
                    filepath = key.rsplit("|", 1)[0]
                    if filepath not in files_in_playlist:
                        del self.validation_cache[key]

                if len(self.validation_cache) > self.validation_cache_max:
                    overflow = len(self.validation_cache) - self.validation_cache_max
                    for filepath in list(self.validation_cache.keys())[:overflow]:
                        del self.validation_cache[filepath]

                self.last_cleanup_time = datetime.now()

            except:
                pass

    def clear_playlist_on_startup(self):
        self.playlist = []
        self.current_index = -1
        self.is_playing = False
        self.is_paused = False
        self.current_video_elapsed = 0
        self.absolute_schedule = {}
        self.playlist_start_time = None

    def _calculate_absolute_schedule(self):
        if not self.playlist or self.current_index < 0:
            self.absolute_schedule = {}
            self.playlist_start_time = None
            return

        self.absolute_schedule = {}
        current_time = self.current_video_start_time


        for idx in range(self.current_index, len(self.playlist)):
            item = self.playlist[idx]
            skipped = idx > self.current_index and item["type"] == "video" and is_skipped_on_air(item)

            if item["type"] == "video" and item.get("duration") and not skipped:
                self.absolute_schedule[item["id"]] = {
                    "start": current_time,
                    "end": current_time + timedelta(seconds=item["duration"]),
                    "duration": item["duration"],
                    "next_start": current_time + timedelta(seconds=item["duration"])
                }
                current_time += timedelta(seconds=item["duration"])
            elif item["type"] in ["stop", "note", "obs"] or skipped:
                self.absolute_schedule[item["id"]] = {
                    "start": current_time,
                    "end": current_time,
                    "duration": 0,
                    "next_start": current_time
                }
            elif item["type"] == "stop":
                break

    def recalculate_start_times(self):
        if len(self.playlist) == 0:
            self.next_video_scheduled_time = None
            self.scheduled_item_id = None
            return

        if self.current_index >= len(self.playlist):
            self.current_index = len(self.playlist) - 1

        if self.current_index < 0 and len(self.playlist) > 0:
            self.current_index = 0

        now = datetime.now()
        current_time = now

        for idx in range(len(self.playlist)):
            item = self.playlist[idx]

            if idx < self.current_index:
                pass
            elif idx == self.current_index:
                if self.is_playing and self.current_video_start_time:
                    formatted_time = self.current_video_start_time.strftime("%I:%M:%S %p").lstrip("0")
                    item["start_time"] = formatted_time

                    if item["type"] == "video" and item["duration"]:
                        if item["id"] in self.absolute_schedule:
                            current_time = self.absolute_schedule[item["id"]]["next_start"]
                        else:
                            elapsed = (now - self.current_video_start_time).total_seconds() - self.total_pause_time
                            remaining = max(0, item["duration"] - elapsed)
                            current_time = now + timedelta(seconds=remaining)

                        self.next_video_scheduled_time = current_time
                        self.scheduled_item_id = item["id"]
                    else:
                        current_time = now

                    next_idx = self.current_index + 1
                    if next_idx < len(self.playlist):
                        next_item = self.playlist[next_idx]
                        if next_item["type"] == "stop":
                            self.next_video_scheduled_time = None
                            self.scheduled_item_id = None

                elif self.is_paused and self.current_video_start_time and self.pause_time:
                    elapsed = (self.pause_time - self.current_video_start_time).total_seconds() - self.total_pause_time

                    formatted_time = self.current_video_start_time.strftime("%I:%M:%S %p").lstrip("0")
                    item["start_time"] = formatted_time

                    if item["type"] == "video" and item["duration"]:
                        remaining = max(0, item["duration"] - elapsed)
                        current_time = self.pause_time + timedelta(seconds=remaining)
                    else:
                        current_time = self.pause_time

                    self.next_video_scheduled_time = None
                    self.scheduled_item_id = None
                else:
                    formatted_time = now.strftime("%I:%M:%S %p").lstrip("0")
                    item["start_time"] = formatted_time

                    if item["type"] == "video" and item["duration"]:
                        current_time = now + timedelta(seconds=item["duration"])
                    else:
                        current_time = now

                    self.next_video_scheduled_time = None
                    self.scheduled_item_id = None
            else:
                if item["id"] in self.absolute_schedule:
                    scheduled_start = self.absolute_schedule[item["id"]]["start"]
                    formatted_time = scheduled_start.strftime("%I:%M:%S %p").lstrip("0")
                    item["start_time"] = formatted_time
                    if item["type"] == "video" and item.get("duration"):
                        current_time = self.absolute_schedule[item["id"]]["next_start"]
                elif item["type"] in ["stop", "note", "obs"]:
                    formatted_time = current_time.strftime("%I:%M:%S %p").lstrip("0")
                    item["start_time"] = formatted_time
                elif item.get("status") == "validating" or item.get("duration") is None:
                    item["start_time"] = "Validating..."
                else:
                    formatted_time = current_time.strftime("%I:%M:%S %p").lstrip("0")
                    item["start_time"] = formatted_time

                    if item["type"] == "video" and item.get("duration") and not is_skipped_on_air(item):
                        current_time += timedelta(seconds=item["duration"])
                    elif item["type"] in ["note", "obs"]:
                        pass

    def check_missing_files(self):
        missing_items = []
        changed_items = []
        for item in list(self.playlist):
            if item["type"] not in ["video", "image"] or not item.get("location"):
                continue

            signature = self.file_signature(item["location"])
            if not signature:
                missing_items.append(item["id"])
            elif item.get("file_signature") and signature != item["file_signature"] and item.get("status") != "validating":
                changed_items.append(item["id"])
        return {"missing": missing_items, "changed": changed_items}
