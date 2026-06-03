from datetime import datetime, timedelta

class AbsoluteTimingSystem:
    def __init__(self):
        self.playlist_base_time = None
        self.absolute_schedule = {}

    def calculate_absolute_times(self, playlist, current_playing_index=-1, current_video_actual_start=None):
        if len(playlist) == 0:
            self.absolute_schedule = {}
            return {}

        now = datetime.now()

        if self.playlist_base_time is None or current_playing_index <= 0:
            self.playlist_base_time = current_video_actual_start if current_video_actual_start else now

        schedule = {}
        cumulative_time = self.playlist_base_time

        for idx, item in enumerate(playlist):
            item_id = item["id"]

            if idx == current_playing_index and current_video_actual_start:
                schedule[item_id] = current_video_actual_start

                if item["type"] == "video" and item.get("duration"):
                    cumulative_time = current_video_actual_start + timedelta(seconds=item["duration"])
                else:
                    cumulative_time = current_video_actual_start

            else:
                schedule[item_id] = cumulative_time

                if item["type"] == "video" and item.get("duration"):
                    cumulative_time += timedelta(seconds=item["duration"])

        self.absolute_schedule = schedule
        return schedule

    def get_scheduled_time(self, item_id):
        return self.absolute_schedule.get(item_id)

    def get_next_scheduled_time(self, playlist, current_index):
        if current_index < 0 or current_index >= len(playlist) - 1:
            return None

        next_idx = current_index + 1
        if next_idx < len(playlist):
            next_item = playlist[next_idx]
            if next_item["type"] == "stop":
                return None

            return self.absolute_schedule.get(next_item["id"])

        return None

    def reset(self):
        self.playlist_base_time = None
        self.absolute_schedule = {}
