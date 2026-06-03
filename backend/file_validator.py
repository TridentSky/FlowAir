import os
import subprocess
import json
from pathlib import Path
from config import Config

class FileValidator:
    def __init__(self):
        self.config = Config()

    def is_video(self, filepath):
        ext = Path(filepath).suffix.lower()
        return ext in self.config.ALLOWED_VIDEO_EXTENSIONS

    def is_image(self, filepath):
        ext = Path(filepath).suffix.lower()
        return ext in self.config.ALLOWED_IMAGE_EXTENSIONS

    def validate_file(self, filepath):
        if not os.path.exists(filepath):
            return {
                "valid": False,
                "error": "File does not exist",
                "type": None,
                "duration": None,
                "resolution": None
            }

        if not os.access(filepath, os.R_OK):
            return {
                "valid": False,
                "error": "File is not readable or incomplete",
                "type": None,
                "duration": None,
                "resolution": None
            }

        try:
            file_size = os.path.getsize(filepath)
            if file_size == 0:
                return {
                    "valid": False,
                    "error": "File is empty or still downloading",
                    "type": None,
                    "duration": None,
                    "resolution": None
                }
        except:
            return {
                "valid": False,
                "error": "Cannot access file",
                "type": None,
                "duration": None,
                "resolution": None
            }

        if self.is_video(filepath):
            return self._validate_video(filepath)
        elif self.is_image(filepath):
            return self._validate_image(filepath)
        else:
            return {
                "valid": False,
                "error": "Unsupported file format",
                "type": None,
                "duration": None,
                "resolution": None
            }

    def _validate_video(self, filepath):
        try:
            cmd = [
                self.config.get_ffprobe_path(),
                '-v', 'quiet',
                '-print_format', 'json',
                '-show_format',
                '-show_streams',
                filepath
            ]

            result = subprocess.run(cmd, capture_output=True, encoding='utf-8', errors='ignore', timeout=60)

            if result.returncode != 0 or not result.stdout.strip():
                return {
                    "valid": False,
                    "error": "Cannot read video file",
                    "type": "video",
                    "duration": 0,
                    "resolution": "unknown"
                }

            data = json.loads(result.stdout)

            video_stream = None
            for stream in data.get('streams', []):
                if stream.get('codec_type') == 'video':
                    video_stream = stream
                    break

            if not video_stream:
                return {
                    "valid": False,
                    "error": "No video stream found",
                    "type": "video",
                    "duration": 0,
                    "resolution": "unknown"
                }

            width = video_stream.get('width', 0)
            height = video_stream.get('height', 0)

            if width == 0 or height == 0:
                return {
                    "valid": False,
                    "error": "Invalid video resolution",
                    "type": "video",
                    "duration": 0,
                    "resolution": "unknown"
                }

            duration = 0
            format_data = data.get('format', {})
            if 'duration' in format_data:
                duration = float(format_data['duration'])
            elif 'duration' in video_stream:
                duration = float(video_stream['duration'])
            elif 'tags' in format_data and 'DURATION' in format_data['tags']:
                duration_str = format_data['tags']['DURATION']
                parts = duration_str.split(':')
                if len(parts) == 3:
                    hours = float(parts[0])
                    minutes = float(parts[1])
                    seconds = float(parts[2])
                    duration = hours * 3600 + minutes * 60 + seconds

            if duration == 0:
                return {
                    "valid": False,
                    "error": "Video has 0 duration",
                    "type": "video",
                    "duration": 0,
                    "resolution": f"{width}x{height}"
                }

            return {
                "valid": True,
                "error": None,
                "type": "video",
                "duration": duration,
                "resolution": f"{width}x{height}"
            }

        except Exception as e:
            return {
                "valid": False,
                "error": str(e),
                "type": "video",
                "duration": 0,
                "resolution": "unknown"
            }

    def _validate_image(self, filepath):
        try:
            cmd = [
                self.config.get_ffprobe_path(),
                '-v', 'quiet',
                '-print_format', 'json',
                '-show_streams',
                filepath
            ]

            result = subprocess.run(cmd, capture_output=True, encoding='utf-8', errors='ignore', timeout=10)

            if result.returncode != 0 or not result.stdout.strip():
                return {
                    "valid": True,
                    "error": None,
                    "type": "image",
                    "duration": "STATIC",
                    "resolution": "unknown"
                }

            data = json.loads(result.stdout)

            if not data.get('streams'):
                return {
                    "valid": True,
                    "error": None,
                    "type": "image",
                    "duration": "STATIC",
                    "resolution": "unknown"
                }

            stream = data['streams'][0]
            width = stream.get('width', 0)
            height = stream.get('height', 0)

            return {
                "valid": True,
                "error": None,
                "type": "image",
                "duration": "STATIC",
                "resolution": f"{width}x{height}"
            }

        except Exception as e:
            return {
                "valid": True,
                "error": None,
                "type": "image",
                "duration": "STATIC",
                "resolution": "unknown"
            }

    def get_video_duration_formatted(self, duration_seconds):
        if duration_seconds is None or duration_seconds == 0:
            return "00:00:00"

        hours = int(duration_seconds // 3600)
        minutes = int((duration_seconds % 3600) // 60)
        seconds = int(duration_seconds % 60)

        return f"{hours:02d}:{minutes:02d}:{seconds:02d}"

    def get_file_size(self, filepath):
        try:
            size_bytes = os.path.getsize(filepath)
            if size_bytes < 1024:
                return f"{size_bytes} B"
            elif size_bytes < 1024 * 1024:
                return f"{size_bytes / 1024:.1f} KB"
            elif size_bytes < 1024 * 1024 * 1024:
                return f"{size_bytes / (1024 * 1024):.1f} MB"
            else:
                return f"{size_bytes / (1024 * 1024 * 1024):.2f} GB"
        except:
            return "Unknown"

    def get_codec_info(self, filepath):
        try:
            cmd = [
                self.config.get_ffprobe_path(),
                '-v', 'quiet',
                '-print_format', 'json',
                '-show_streams',
                filepath
            ]
            result = subprocess.run(cmd, capture_output=True, encoding='utf-8', errors='ignore', timeout=10)
            if result.returncode != 0:
                return "Unknown"

            data = json.loads(result.stdout)
            for stream in data.get('streams', []):
                if stream.get('codec_type') == 'video':
                    codec_name = stream.get('codec_name', 'unknown').upper()
                    ext = Path(filepath).suffix.upper().replace('.', '')
                    return f"{ext} ({codec_name})"

            ext = Path(filepath).suffix.upper().replace('.', '')
            return ext
        except:
            ext = Path(filepath).suffix.upper().replace('.', '')
            return ext if ext else "Unknown"

    def get_bitrate(self, filepath):
        try:
            cmd = [
                self.config.get_ffprobe_path(),
                '-v', 'quiet',
                '-print_format', 'json',
                '-show_format',
                '-show_streams',
                filepath
            ]
            result = subprocess.run(cmd, capture_output=True, encoding='utf-8', errors='ignore', timeout=10)
            if result.returncode != 0:
                return None

            data = json.loads(result.stdout)

            bitrate = None
            for stream in data.get('streams', []):
                if stream.get('codec_type') == 'video':
                    if 'bit_rate' in stream:
                        bitrate = int(stream['bit_rate'])
                        break

            if not bitrate and 'format' in data:
                format_data = data['format']
                if 'bit_rate' in format_data:
                    bitrate = int(format_data['bit_rate'])

            if bitrate:
                bitrate_kbps = bitrate / 1000
                if bitrate_kbps >= 1000:
                    return f"{bitrate_kbps / 1000:.1f} Mbps"
                else:
                    return f"{bitrate_kbps:.0f} kbps"

            return None
        except:
            return None
