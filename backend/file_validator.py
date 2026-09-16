import os
import subprocess
import json
from pathlib import Path
from config import Config

CREATE_NO_WINDOW = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
BELOW_NORMAL_PRIORITY_CLASS = getattr(subprocess, 'BELOW_NORMAL_PRIORITY_CLASS', 0)
PROBE_CREATION_FLAGS = CREATE_NO_WINDOW | BELOW_NORMAL_PRIORITY_CLASS

VIDEO_PROBE_TIMEOUT = 30
IMAGE_PROBE_TIMEOUT = 10

MAX_OUTPUT_WIDTH = 1920
MAX_OUTPUT_HEIGHT = 1080
HIGH_BITRATE_LIMITS = [
    (1280 * 720, 40000000),
    (1920 * 1080, 80000000),
    (2560 * 1440, 120000000),
    (4096 * 2160, 200000000)
]
HIGH_BITRATE_LIMIT_MAX = 300000000
HIGH_FRAME_RATE = 31
MAX_IMAGE_SIDE = 4096

NATIVE_CONTAINERS = ['.mp4', '.m4v', '.mov', '.webm']
LIMITED_CONTAINERS = ['.mkv']
BLOCKED_CONTAINERS = {
    '.avi': 'AVI',
    '.wmv': 'WMV (ASF)',
    '.flv': 'FLV',
    '.mpg': 'MPEG program stream',
    '.mpeg': 'MPEG program stream',
    '.ts': 'MPEG transport stream',
    '.m2ts': 'MPEG transport stream (M2TS)',
    '.mts': 'AVCHD (MTS)',
    '.mxf': 'MXF',
    '.asf': 'ASF',
    '.vob': 'DVD video (VOB)',
    '.divx': 'DivX',
    '.dv': 'DV',
    '.3gp': '3GP',
    '.3g2': '3G2',
    '.f4v': 'F4V',
    '.ogv': 'Ogg video'
}
PCM_BLOCKED_CONTAINERS = ['.mp4', '.m4v', '.mov']

PLAYABLE_VIDEO_CODECS = ['h264', 'vp8', 'vp9', 'av1', 'theora']
MP4_COPYABLE_VIDEO_CODECS = ['h264', 'vp9', 'av1']
MP4_COPYABLE_AUDIO_CODECS = ['aac', 'mp3', 'opus', 'flac']
INTERLACED_FIELD_ORDERS = ['tt', 'bb', 'tb', 'bt']
INDEX_TIMED_CONTAINERS = ['.avi', '.divx']
BLOCKED_VIDEO_CODECS = {
    'hevc': 'HEVC (H.265)',
    'h265': 'HEVC (H.265)',
    'mpeg2video': 'MPEG-2',
    'mpeg1video': 'MPEG-1',
    'vc1': 'VC-1',
    'wmv1': 'Windows Media Video',
    'wmv2': 'Windows Media Video',
    'wmv3': 'Windows Media Video 9',
    'msmpeg4v1': 'Microsoft MPEG-4',
    'msmpeg4v2': 'Microsoft MPEG-4',
    'msmpeg4v3': 'Microsoft MPEG-4',
    'mpeg4': 'MPEG-4 Part 2 (DivX/Xvid)',
    'prores': 'Apple ProRes',
    'dnxhd': 'DNxHD',
    'dvvideo': 'DV',
    'flv1': 'Sorenson Spark',
    'vp6': 'VP6',
    'vp6f': 'VP6',
    'vp5': 'VP5',
    'h263': 'H.263',
    'cinepak': 'Cinepak',
    'indeo3': 'Indeo',
    'indeo4': 'Indeo',
    'indeo5': 'Indeo',
    'mjpeg': 'Motion JPEG',
    'rawvideo': 'uncompressed video',
    'ffv1': 'FFV1',
    'huffyuv': 'HuffYUV',
    'utvideo': 'Ut Video'
}
HEVC_CODEC_TAGS = ['hvc1', 'hev1', 'hvc2', 'dvh1', 'dvhe']
MPEG4_CODEC_TAGS = ['divx', 'dx50', 'xvid', 'mp4v', '3ivd', 'dvx1']

H264_PIXEL_FORMATS = ['yuv420p', 'yuvj420p', 'nv12', 'nv21']
H264_BLOCKED_PROFILES = [
    'high 10',
    'high 10 intra',
    'high 4:2:2',
    'high 4:2:2 intra',
    'high 4:4:4',
    'high 4:4:4 intra',
    'high 4:4:4 predictive',
    'cavlc 4:4:4',
    'cavlc 4:4:4 intra'
]

PLAYABLE_AUDIO_CODECS = [
    'aac',
    'mp3',
    'mp3float',
    'opus',
    'vorbis',
    'flac',
    'pcm_s16le',
    'pcm_s16be',
    'pcm_u8',
    'pcm_f32le'
]
AUDIO_CODEC_LABELS = {
    'ac3': 'AC-3',
    'eac3': 'E-AC-3',
    'dts': 'DTS',
    'truehd': 'Dolby TrueHD',
    'mlp': 'Dolby TrueHD',
    'wmav1': 'Windows Media Audio',
    'wmav2': 'Windows Media Audio',
    'wmapro': 'Windows Media Audio Pro',
    'mp2': 'MPEG audio layer 2',
    'alac': 'Apple Lossless'
}

PLAYABLE_IMAGE_CODECS = ['mjpeg', 'png', 'apng', 'gif', 'bmp', 'webp']

FILESYSTEM_ISSUE_CODES = ['file_missing', 'file_unreadable', 'file_empty', 'unsupported_extension']
IMAGE_CODEC_LABELS = {
    'tiff': 'TIFF',
    'jpeg2000': 'JPEG 2000',
    'j2k': 'JPEG 2000',
    'dpx': 'DPX',
    'exr': 'OpenEXR',
    'targa': 'Targa',
    'psd': 'Photoshop',
    'svg': 'SVG'
}


def _safe_float(value):
    if value is None:
        return None
    text = str(value).strip()
    if not text or text.lower() in ('n/a', 'na', 'nan', 'none', 'unknown'):
        return None
    try:
        parsed = float(text)
    except (TypeError, ValueError):
        return None
    if parsed != parsed or parsed in (float('inf'), float('-inf')):
        return None
    return parsed


def _safe_int(value):
    parsed = _safe_float(value)
    if parsed is None:
        return None
    return int(parsed)


def _parse_timecode(value):
    if value is None:
        return None
    text = str(value).strip()
    if not text or text.lower() in ('n/a', 'na', 'none'):
        return None
    parts = text.split(':')
    if len(parts) == 3:
        hours = _safe_float(parts[0])
        minutes = _safe_float(parts[1])
        seconds = _safe_float(parts[2])
        if hours is None or minutes is None or seconds is None:
            return None
        return hours * 3600 + minutes * 60 + seconds
    if len(parts) == 2:
        minutes = _safe_float(parts[0])
        seconds = _safe_float(parts[1])
        if minutes is None or seconds is None:
            return None
        return minutes * 60 + seconds
    return _safe_float(text)


def _parse_rate(value):
    if value is None:
        return None
    text = str(value).strip()
    if '/' in text:
        parts = text.split('/')
        numerator = _safe_float(parts[0])
        denominator = _safe_float(parts[1]) if len(parts) > 1 else None
        if not numerator or not denominator:
            return None
        return numerator / denominator
    return _safe_float(text)


def _tag(tags, name):
    if not isinstance(tags, dict):
        return None
    target = name.lower()
    for key, value in tags.items():
        if str(key).lower() == target:
            return value
    return None


def _stream_rotation(stream):
    for side_data in stream.get('side_data_list') or []:
        if not isinstance(side_data, dict):
            continue
        rotation = _safe_float(side_data.get('rotation'))
        if rotation is not None:
            return int(round(rotation)) % 360
    rotation = _safe_float(_tag(stream.get('tags'), 'rotate'))
    if rotation is not None:
        return int(round(rotation)) % 360
    return 0


def _last_message(text):
    if not text:
        return None
    lines = [line.strip() for line in str(text).splitlines() if line.strip()]
    if not lines:
        return None
    return lines[-1][:200]


def _issue(level, code, message):
    return {"level": level, "code": code, "message": message}


class FileValidator:
    def __init__(self):
        self.config = Config()
        self._last_probe = None

    def is_video(self, filepath):
        ext = Path(filepath).suffix.lower()
        return ext in self.config.ALLOWED_VIDEO_EXTENSIONS

    def is_image(self, filepath):
        ext = Path(filepath).suffix.lower()
        return ext in self.config.ALLOWED_IMAGE_EXTENSIONS

    def probe(self, filepath):
        result = self._new_result(filepath)

        if not os.path.exists(filepath):
            self._reject(result, "file_missing", "File does not exist")
        elif not os.access(filepath, os.R_OK):
            self._reject(result, "file_unreadable", "File is not readable or incomplete")
        else:
            size_bytes = None
            try:
                size_bytes = os.path.getsize(filepath)
            except Exception:
                self._reject(result, "file_unreadable", "Cannot access file")

            if size_bytes is not None:
                result["file_size"] = self._format_size(size_bytes)
                if size_bytes == 0:
                    self._reject(result, "file_empty", "File is empty or still downloading")
                elif result["type"] == "video":
                    self._probe_video(filepath, result)
                elif result["type"] == "image":
                    self._probe_image(filepath, result)
                else:
                    self._reject(result, "unsupported_extension", "Unsupported file format")

        result["playability"] = self._derive_playability(result["issues"])
        self._last_probe = (filepath, result["file_signature"], result)
        return result

    def validate_file(self, filepath):
        return self.probe(filepath)

    def _new_result(self, filepath):
        if self.is_video(filepath):
            item_type = "video"
            duration = 0
        elif self.is_image(filepath):
            item_type = "image"
            duration = "STATIC"
        else:
            item_type = None
            duration = None

        return {
            "valid": True,
            "error": None,
            "type": item_type,
            "duration": duration,
            "resolution": "unknown",
            "width": 0,
            "height": 0,
            "format": self._codec_label(filepath, None),
            "bitrate": None,
            "bitrate_bps": None,
            "file_size": "Unknown",
            "file_signature": self._file_signature(filepath),
            "video_codec": None,
            "audio_codec": None,
            "rotation": 0,
            "playability": "ok",
            "issues": [],
            "conversion_plan": "none",
            "conversion_info": {}
        }

    def _reject(self, result, code, message):
        result["valid"] = False
        result["error"] = message
        result["issues"].append(_issue("error", code, message))
        return result

    def _derive_playability(self, issues):
        for issue in issues:
            if issue["level"] == "error" and issue["code"] not in FILESYSTEM_ISSUE_CODES:
                return "unsupported"
        for issue in issues:
            if issue["level"] == "warn":
                return "warn"
        return "ok"

    def _file_signature(self, filepath):
        try:
            stats = os.stat(filepath)
            return f"{stats.st_mtime_ns}:{stats.st_size}"
        except Exception:
            return ""

    def _codec_label(self, filepath, codec_name):
        ext = Path(filepath).suffix.upper().replace('.', '')
        if codec_name:
            if ext:
                return f"{ext} ({codec_name.upper()})"
            return codec_name.upper()
        return ext if ext else "Unknown"

    def _run_ffprobe(self, filepath, timeout):
        cmd = [
            self.config.get_ffprobe_path(),
            '-v', 'error',
            '-show_error',
            '-print_format', 'json',
            '-show_format',
            '-show_streams',
            filepath
        ]

        try:
            completed = subprocess.run(
                cmd,
                capture_output=True,
                encoding='utf-8',
                errors='ignore',
                creationflags=PROBE_CREATION_FLAGS,
                timeout=timeout
            )
        except subprocess.TimeoutExpired:
            return None, "Timed out reading the file"
        except FileNotFoundError:
            return None, "ffprobe was not found"
        except Exception as exc:
            return None, _last_message(str(exc)) or "Cannot read the file"

        message = _last_message(completed.stderr)
        data = None
        stdout = (completed.stdout or '').strip()
        if stdout:
            try:
                parsed = json.loads(stdout)
                if isinstance(parsed, dict):
                    data = parsed
            except ValueError:
                data = None

        if data is not None and isinstance(data.get('error'), dict):
            message = data['error'].get('string') or message
            data = None

        if completed.returncode != 0:
            return None, message or "Cannot read the file"

        if data is None:
            return None, message or "Cannot read the file"

        return data, message

    def _select_video_stream(self, data):
        fallback = None
        for stream in data.get('streams', []):
            if stream.get('codec_type') != 'video':
                continue
            disposition = stream.get('disposition') or {}
            if disposition.get('attached_pic'):
                if fallback is None:
                    fallback = stream
                continue
            return stream, False
        if fallback is not None:
            return fallback, True
        return None, False

    def _extract_duration(self, format_data, video_stream):
        for candidate in (format_data.get('duration'), video_stream.get('duration')):
            duration = _safe_float(candidate)
            if duration and duration > 0:
                return duration

        for tags in (video_stream.get('tags'), format_data.get('tags')):
            duration = _parse_timecode(_tag(tags, 'DURATION'))
            if duration and duration > 0:
                return duration

        frames = _safe_float(video_stream.get('nb_frames'))
        rate = _parse_rate(video_stream.get('avg_frame_rate'))
        if not rate:
            rate = _parse_rate(video_stream.get('r_frame_rate'))
        if frames and rate and frames > 0 and rate > 0:
            return frames / rate

        return None

    def _extract_bitrate(self, format_data, video_stream):
        bitrate = _safe_int(video_stream.get('bit_rate'))
        if bitrate and bitrate > 0:
            return bitrate
        bitrate = _safe_int(format_data.get('bit_rate'))
        if bitrate and bitrate > 0:
            return bitrate
        bitrate = _safe_int(_tag(video_stream.get('tags'), 'BPS'))
        if bitrate and bitrate > 0:
            return bitrate
        return None

    def _probe_video(self, filepath, result):
        data, message = self._run_ffprobe(filepath, VIDEO_PROBE_TIMEOUT)

        if data is None:
            return self._reject(result, "probe_failed", message or "Cannot read video file")

        format_data = data.get('format') or {}
        video_stream, is_cover_art = self._select_video_stream(data)

        if video_stream is None or is_cover_art:
            return self._reject(result, "no_video_stream", "No video stream found")

        width = _safe_int(video_stream.get('width')) or 0
        height = _safe_int(video_stream.get('height')) or 0
        result["width"] = width
        result["height"] = height

        if width <= 0 or height <= 0:
            return self._reject(result, "invalid_resolution", "Invalid video resolution")

        result["resolution"] = f"{width}x{height}"

        codec_name = (video_stream.get('codec_name') or '').lower()
        result["video_codec"] = codec_name or None
        result["format"] = self._codec_label(filepath, codec_name)

        duration = self._extract_duration(format_data, video_stream)
        if not duration or duration <= 0:
            return self._reject(result, "no_duration", "No readable duration in this file")
        result["duration"] = duration

        bitrate_bps = self._extract_bitrate(format_data, video_stream)
        result["bitrate_bps"] = bitrate_bps
        result["bitrate"] = self._format_bitrate(bitrate_bps)

        audio_streams = [s for s in data.get('streams', []) if s.get('codec_type') == 'audio']
        if audio_streams:
            result["audio_codec"] = (audio_streams[0].get('codec_name') or '').lower() or None

        result["rotation"] = _stream_rotation(video_stream)

        self._classify_video(filepath, result, video_stream, audio_streams)
        self._plan_conversion(filepath, result, format_data, video_stream, audio_streams)
        return result

    def _plan_conversion(self, filepath, result, format_data, video_stream, audio_streams):
        ext = Path(filepath).suffix.lower()
        native = ext in NATIVE_CONTAINERS
        codes = {issue["code"] for issue in result["issues"]}
        codec_name = result["video_codec"] or ''
        audio_stream = audio_streams[0] if audio_streams else None
        audio_codec = result["audio_codec"] or ''

        video_blocked = "video_codec_unsupported" in codes or "h264_profile" in codes
        if not video_blocked and ext in BLOCKED_CONTAINERS:
            video_blocked = self._video_blocked(result, video_stream)
        reordered = ext in INDEX_TIMED_CONTAINERS and (_safe_int(video_stream.get('has_b_frames')) or 0) > 0
        if reordered:
            video_blocked = True

        if video_blocked:
            plan = "full"
        elif codec_name in MP4_COPYABLE_VIDEO_CODECS:
            audio_blocked = "audio_codec_unsupported" in codes
            if ext in PCM_BLOCKED_CONTAINERS and audio_codec.startswith('pcm_'):
                audio_blocked = True
            if not native and audio_stream is not None and not audio_blocked:
                audio_blocked = audio_codec not in MP4_COPYABLE_AUDIO_CODECS
            if audio_blocked:
                plan = "audio"
            elif native:
                plan = "none"
            else:
                plan = "remux"
        elif native:
            plan = "none"
        else:
            plan = "full"

        result["conversion_plan"] = plan
        if plan == "none":
            return

        stream_durations = []
        for stream in (video_stream, audio_stream):
            if stream is None:
                continue
            value = _safe_float(stream.get('duration')) or _parse_timecode(_tag(stream.get('tags'), 'DURATION'))
            if value and value > 0:
                stream_durations.append(value)

        fps = _parse_rate(video_stream.get('avg_frame_rate')) or _parse_rate(video_stream.get('r_frame_rate'))
        field_order = (video_stream.get('field_order') or '').lower().strip()
        result["conversion_info"] = {
            "video_index": _safe_int(video_stream.get('index')),
            "audio_index": _safe_int(audio_stream.get('index')) if audio_stream is not None else None,
            "video_codec": codec_name,
            "audio_codec": audio_codec,
            "audio_channels": _safe_int(audio_stream.get('channels')) if audio_stream is not None else None,
            "audio_sample_rate": _safe_int(audio_stream.get('sample_rate')) if audio_stream is not None else None,
            "width": result["width"],
            "height": result["height"],
            "fps": fps,
            "interlaced": field_order in INTERLACED_FIELD_ORDERS,
            "reset_video_start": reordered,
            "bitrate_bps": result["bitrate_bps"],
            "duration": result["duration"],
            "stream_duration": max(stream_durations) if stream_durations else None
        }

    def _video_blocked(self, result, video_stream):
        codec_name = result["video_codec"] or ''
        codec_tag = (video_stream.get('codec_tag_string') or '').lower().strip()
        if codec_name in ('hevc', 'h265') or codec_tag in HEVC_CODEC_TAGS:
            return True
        if codec_name == 'mpeg4' or (not codec_name and codec_tag in MPEG4_CODEC_TAGS):
            return True
        if codec_name in BLOCKED_VIDEO_CODECS:
            return True
        if codec_name == 'h264':
            profile_issues = []
            self._classify_h264(result, video_stream, profile_issues)
            return bool(profile_issues)
        return False

    def _bitrate_limit(self, result, video_stream):
        pixels = result["width"] * result["height"]
        limit = HIGH_BITRATE_LIMIT_MAX
        for max_pixels, value in HIGH_BITRATE_LIMITS:
            if pixels <= max_pixels:
                limit = value
                break
        fps = _parse_rate(video_stream.get('avg_frame_rate')) or _parse_rate(video_stream.get('r_frame_rate'))
        if fps and fps > HIGH_FRAME_RATE:
            limit *= 2
        return limit

    def _classify_video(self, filepath, result, video_stream, audio_streams):
        issues = result["issues"]
        ext = Path(filepath).suffix.lower()

        if ext in BLOCKED_CONTAINERS:
            issues.append(_issue(
                "error",
                "container_unsupported",
                f"{BLOCKED_CONTAINERS[ext]} files cannot be played by the player - convert to MP4 (H.264)"
            ))
            return
        if ext in LIMITED_CONTAINERS:
            issues.append(_issue(
                "warn",
                "container_limited",
                "Matroska playback depends on the codecs inside - test this file before air"
            ))
        elif ext not in NATIVE_CONTAINERS:
            issues.append(_issue(
                "warn",
                "container_unknown",
                f"{ext.upper().replace('.', '')} containers may not be supported by the player - test this file before air"
            ))

        codec_name = result["video_codec"] or ''
        codec_tag = (video_stream.get('codec_tag_string') or '').lower().strip()

        if codec_name in ('hevc', 'h265') or codec_tag in HEVC_CODEC_TAGS:
            issues.append(_issue(
                "error",
                "video_codec_unsupported",
                "HEVC (H.265) cannot be decoded by the player - convert to H.264"
            ))
        elif codec_name == 'mpeg4' or (not codec_name and codec_tag in MPEG4_CODEC_TAGS):
            issues.append(_issue(
                "error",
                "video_codec_unsupported",
                "MPEG-4 Part 2 (DivX/Xvid) cannot be decoded by the player - convert to H.264"
            ))
        elif codec_name in BLOCKED_VIDEO_CODECS:
            issues.append(_issue(
                "error",
                "video_codec_unsupported",
                f"{BLOCKED_VIDEO_CODECS[codec_name]} cannot be decoded by the player - convert to H.264"
            ))
        elif codec_name == 'h264':
            self._classify_h264(result, video_stream, issues)
        elif codec_name not in PLAYABLE_VIDEO_CODECS:
            label = codec_name.upper() if codec_name else "This"
            issues.append(_issue(
                "warn",
                "video_codec_unknown",
                f"{label} video may not be decoded by the player - test this file before air"
            ))

        self._classify_audio(result, audio_streams, issues, ext)

        if result["width"] > MAX_OUTPUT_WIDTH or result["height"] > MAX_OUTPUT_HEIGHT:
            issues.append(_issue(
                "warn",
                "resolution_high",
                f"{result['resolution']} is above 1920x1080 - extra decode cost on this machine"
            ))

        bitrate_bps = result["bitrate_bps"]
        if bitrate_bps and bitrate_bps > self._bitrate_limit(result, video_stream):
            issues.append(_issue(
                "warn",
                "bitrate_high",
                f"Unusually high bitrate for {result['resolution']} ({bitrate_bps / 1000000:.1f} Mbps) - playback needs a powerful machine"
            ))

        if result["rotation"]:
            issues.append(_issue(
                "warn",
                "rotation",
                f"Rotation metadata ({result['rotation']} degrees) - check the framing"
            ))

    def _classify_h264(self, result, video_stream, issues):
        profile = (video_stream.get('profile') or '').lower().strip()
        pix_fmt = (video_stream.get('pix_fmt') or '').lower().strip()
        bit_depth = _safe_int(video_stream.get('bits_per_raw_sample'))

        blocked_profile = profile in H264_BLOCKED_PROFILES
        blocked_pix_fmt = bool(pix_fmt) and pix_fmt not in H264_PIXEL_FORMATS
        blocked_depth = bool(bit_depth) and bit_depth > 8

        if blocked_profile or blocked_pix_fmt or blocked_depth:
            issues.append(_issue(
                "error",
                "h264_profile",
                "10-bit or 4:2:2 H.264 cannot be decoded by the player - re-export as 8-bit 4:2:0"
            ))

    def _classify_audio(self, result, audio_streams, issues, ext):
        if not audio_streams:
            issues.append(_issue("warn", "audio_missing", "No audio track - this clip is silent"))
            return

        codecs = []
        for stream in audio_streams:
            codec_name = (stream.get('codec_name') or '').lower()
            if codec_name:
                codecs.append(codec_name)

        pcm_blocked = ext in PCM_BLOCKED_CONTAINERS
        if not (pcm_blocked and codecs and codecs[0].startswith('pcm_')):
            for codec_name in codecs:
                if pcm_blocked and codec_name.startswith('pcm_'):
                    continue
                if codec_name in PLAYABLE_AUDIO_CODECS or codec_name.startswith('pcm_s16'):
                    return

        label = "This"
        if codecs and codecs[0].startswith('pcm_'):
            label = "PCM"
        elif codecs:
            label = AUDIO_CODEC_LABELS.get(codecs[0], codecs[0].upper())
        issues.append(_issue(
            "warn",
            "audio_codec_unsupported",
            f"{label} audio will not be decoded - the video plays without audible audio"
        ))

    def _probe_image(self, filepath, result):
        data, message = self._run_ffprobe(filepath, IMAGE_PROBE_TIMEOUT)

        if data is None:
            return self._reject(result, "image_unreadable", message or "Cannot read image file")

        stream = None
        for candidate in data.get('streams', []):
            if candidate.get('codec_type') == 'video':
                stream = candidate
                break

        if stream is None:
            return self._reject(result, "image_unreadable", "No image data found in this file")

        codec_name = (stream.get('codec_name') or '').lower()
        result["video_codec"] = codec_name or None
        result["format"] = self._codec_label(filepath, codec_name)

        width = _safe_int(stream.get('width')) or 0
        height = _safe_int(stream.get('height')) or 0
        result["width"] = width
        result["height"] = height

        if width <= 0 or height <= 0:
            return self._reject(result, "image_resolution", "Invalid image resolution")

        result["resolution"] = f"{width}x{height}"

        if codec_name not in PLAYABLE_IMAGE_CODECS:
            label = IMAGE_CODEC_LABELS.get(codec_name, codec_name.upper() if codec_name else "This")
            result["issues"].append(_issue(
                "error",
                "image_codec_unsupported",
                f"{label} images cannot be displayed by the player - convert to PNG or JPEG"
            ))
            return result

        if max(width, height) > MAX_IMAGE_SIDE:
            result["issues"].append(_issue(
                "warn",
                "image_large",
                f"{result['resolution']} is very large - extra memory and scaling cost"
            ))

        return result

    def get_video_duration_formatted(self, duration_seconds):
        if duration_seconds is None or duration_seconds == 0:
            return "00:00:00"

        try:
            total_seconds = float(duration_seconds)
        except (TypeError, ValueError):
            return "00:00:00"

        hours = int(total_seconds // 3600)
        minutes = int((total_seconds % 3600) // 60)
        seconds = int(total_seconds % 60)

        return f"{hours:02d}:{minutes:02d}:{seconds:02d}"

    def _format_size(self, size_bytes):
        if size_bytes < 1024:
            return f"{size_bytes} B"
        elif size_bytes < 1024 * 1024:
            return f"{size_bytes / 1024:.1f} KB"
        elif size_bytes < 1024 * 1024 * 1024:
            return f"{size_bytes / (1024 * 1024):.1f} MB"
        else:
            return f"{size_bytes / (1024 * 1024 * 1024):.2f} GB"

    def _format_bitrate(self, bitrate_bps):
        if not bitrate_bps or bitrate_bps <= 0:
            return None
        bitrate_kbps = bitrate_bps / 1000
        if bitrate_kbps >= 1000:
            return f"{bitrate_kbps / 1000:.1f} Mbps"
        return f"{bitrate_kbps:.0f} kbps"

    def get_file_size(self, filepath):
        try:
            return self._format_size(os.path.getsize(filepath))
        except Exception:
            return "Unknown"

    def _probe_data(self, source):
        if isinstance(source, dict):
            return source
        cached = self._last_probe
        if cached and cached[0] == source and cached[1] == self._file_signature(source):
            return cached[2]
        return self.probe(source)

    def get_codec_info(self, source):
        data = self._probe_data(source)
        if not isinstance(data, dict):
            return "Unknown"
        return data.get("format") or "Unknown"

    def get_bitrate(self, source):
        data = self._probe_data(source)
        if not isinstance(data, dict):
            return None
        return data.get("bitrate")
