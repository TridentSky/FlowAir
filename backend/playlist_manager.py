import json
import os
import gc
import time
from datetime import datetime, timedelta
from file_validator import FileValidator
import threading



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
        self.validation_threads = []
        self.absolute_schedule = {}
        self.playlist_start_time = None
        self.validation_cache = {}
        self.validation_cache_max = 2000
        self.active_validations = set()
        self.validation_completed = False
        self.validation_semaphore = threading.Semaphore(5)
        self.on_playback_change = None
        self.on_obs_event = None
        self.clear_playlist_on_startup()
        self._start_cleanup_thread()
        self._start_force_timing_thread()

    def add_item(self, filepath, insert_index=None):
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
            "loop": False,
            "file_size": None,
            "format": None,
            "bitrate": None
        }

        self.next_id += 1

        if insert_index is not None and 0 <= insert_index <= len(self.playlist):
            self.playlist.insert(insert_index, item)
        else:
            self.playlist.append(item)

        validation_thread = threading.Thread(target=self._validate_item_async, args=(item,), daemon=True)
        validation_thread.start()
        self.validation_threads.append(validation_thread)

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

    def _validate_item_async(self, item):
        filepath = item["location"]

        with self.validation_semaphore:
            try:
                if filepath in self.active_validations:
                    return

                self.active_validations.add(filepath)

                if filepath in self.validation_cache and os.path.exists(filepath):
                    cached = self.validation_cache[filepath]
                    item["type"] = cached["type"]
                    item["duration"] = cached["duration"]
                    item["duration_formatted"] = cached["duration_formatted"]
                    item["status"] = cached["status"]
                    item["resolution"] = cached["resolution"]
                    item["file_size"] = cached["file_size"]
                    item["format"] = cached["format"]
                    item["bitrate"] = cached["bitrate"]
                else:
                    validation = self.validator.validate_file(filepath)

                    item["type"] = validation["type"]
                    item["duration"] = validation["duration"]
                    item["duration_formatted"] = self.validator.get_video_duration_formatted(validation["duration"]) if validation["type"] == "video" else "STATIC"
                    item["status"] = "normal" if validation["valid"] else "corrupted"
                    item["resolution"] = validation["resolution"]
                    item["file_size"] = self.validator.get_file_size(filepath)
                    item["format"] = self.validator.get_codec_info(filepath)
                    item["bitrate"] = self.validator.get_bitrate(filepath) if validation["type"] == "video" else None

                    self.validation_cache[filepath] = {
                        "type": item["type"],
                        "duration": item["duration"],
                        "duration_formatted": item["duration_formatted"],
                        "status": item["status"],
                        "resolution": item["resolution"],
                        "file_size": item["file_size"],
                        "format": item["format"],
                        "bitrate": item["bitrate"]
                    }

                if self.is_playing:
                    self.absolute_schedule = {}
                    self._calculate_absolute_schedule()
                self.recalculate_start_times()

                self.validation_completed = True
            except:
                item["status"] = "corrupted"
                item["duration_formatted"] = "ERROR"
                if filepath in self.validation_cache:
                    del self.validation_cache[filepath]
                self.validation_completed = True
            finally:
                if filepath in self.active_validations:
                    self.active_validations.remove(filepath)

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
            "start_time": None
        }

        self.next_id += 1
        if insert_index >= len(self.playlist):
            self.playlist.append(item)
        else:
            self.playlist.insert(insert_index, item)

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
            "note": note
        }

        self.next_id += 1
        if insert_index >= len(self.playlist):
            self.playlist.append(item)
        else:
            self.playlist.insert(insert_index, item)

        if self.is_playing:
            self.absolute_schedule = {}
            self._calculate_absolute_schedule()
        self.recalculate_start_times()
        return item

    def insert_obs_event(self, insert_index, obs_scene, obs_source, obs_action):
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
            "obs_scene": obs_scene,
            "obs_source": obs_source,
            "obs_action": obs_action
        }

        self.next_id += 1
        if insert_index >= len(self.playlist):
            self.playlist.append(item)
        else:
            self.playlist.insert(insert_index, item)

        if self.is_playing:
            self.absolute_schedule = {}
            self._calculate_absolute_schedule()
        self.recalculate_start_times()
        return item

    def update_note(self, item_id, note):
        for item in self.playlist:
            if item["id"] == item_id and item["type"] == "note":
                item["note"] = note
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
                if filepath in self.validation_cache:
                    del self.validation_cache[filepath]
                gc.collect()

        if self.is_playing:
            self.absolute_schedule = {}
            self._calculate_absolute_schedule()
        self.recalculate_start_times()

    def reorder_items(self, from_index, to_index):
        if 0 <= from_index < len(self.playlist) and 0 <= to_index < len(self.playlist):
            item = self.playlist.pop(from_index)
            self.playlist.insert(to_index, item)

            if self.is_playing:
                self.absolute_schedule = {}
                self._calculate_absolute_schedule()
            self.recalculate_start_times()

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
        if current_item and current_item.get("status") == "corrupted":
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
                    return

                self.current_index += 1
                next_item = self.playlist[self.current_index]

                if next_item["type"] == "stop":
                    self.current_index -= 1
                    self.stop()
                    return

                if next_item["type"] == "note":
                    continue

                if next_item["type"] == "obs":
                    if self.on_obs_event:
                        self.on_obs_event(next_item)
                    continue

                if next_item.get("status") == "corrupted":
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

            if self.on_playback_change:
                self.on_playback_change({
                    "type": "playback_state_changed",
                    "current_item": self.get_current_item(),
                    "is_playing": self.is_playing
                })
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

    def toggle_loop(self, item_id):
        for item in self.playlist:
            if item["id"] == item_id:
                item["loop"] = not item.get("loop", False)
                return item["loop"]
        return False

    def mark_as_corrupted(self, item_id):
        for item in self.playlist:
            if item["id"] == item_id:
                item["status"] = "corrupted"
                if item["location"] in self.validation_cache:
                    del self.validation_cache[item["location"]]
                break

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

                gc.collect()

                files_in_playlist = set()
                for item in self.playlist:
                    if item.get("location"):
                        files_in_playlist.add(item.get("location"))

                self.validation_threads = [t for t in self.validation_threads if t.is_alive()]

                cache_files = list(self.validation_cache.keys())
                for filepath in cache_files:
                    if not os.path.exists(filepath) or filepath not in files_in_playlist:
                        if filepath in self.validation_cache:
                            del self.validation_cache[filepath]

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

            if item["type"] == "video" and item.get("duration"):
                self.absolute_schedule[item["id"]] = {
                    "start": current_time,
                    "end": current_time + timedelta(seconds=item["duration"]),
                    "duration": item["duration"],
                    "next_start": current_time + timedelta(seconds=item["duration"])
                }
                current_time += timedelta(seconds=item["duration"])
            elif item["type"] in ["stop", "note", "obs"]:
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

                    if item["type"] == "video" and item.get("duration"):
                        current_time += timedelta(seconds=item["duration"])
                    elif item["type"] in ["note", "obs"]:
                        pass

    def check_missing_files(self):
        missing_items = []
        for item in self.playlist:
            if item["type"] in ["video", "image"] and item["location"]:
                if not os.path.exists(item["location"]):
                    missing_items.append(item["id"])
        return missing_items

    def save_playlist(self, filepath):
        data = {
            "playlist": self.playlist,
            "current_index": self.current_index,
            "saved_at": datetime.now().isoformat()
        }
        with open(filepath, 'w') as f:
            json.dump(data, f, indent=2)

    def load_playlist(self, filepath):
        if not os.path.exists(filepath):
            return False

        with open(filepath, 'r') as f:
            data = json.load(f)

        self.playlist = data.get("playlist", [])
        self.current_index = data.get("current_index", -1)
        self.recalculate_start_times()

        for item in self.playlist:
            if item.get("location"):
                validation = self.validator.validate_file(item["location"])
                item["status"] = "normal" if validation["valid"] else "corrupted"
            else:
                item["status"] = "normal"
            if "loop" not in item:
                item["loop"] = False

        return True
