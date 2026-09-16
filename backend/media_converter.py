import os
import time
import json
import shutil
import hashlib
import uuid
import threading
import subprocess
import collections
import ctypes
from ctypes import wintypes
from config import Config

try:
    import psutil
except ImportError:
    psutil = None

CREATE_NO_WINDOW = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
BELOW_NORMAL_PRIORITY_CLASS = getattr(subprocess, 'BELOW_NORMAL_PRIORITY_CLASS', 0)
FFMPEG_CREATION_FLAGS = CREATE_NO_WINDOW | BELOW_NORMAL_PRIORITY_CLASS

PLANS = ("remux", "audio", "full")
ACTIVE_STATUSES = ("queued", "running")
ENCODER_CANDIDATES = ("h264_qsv", "h264_nvenc", "h264_amf", "h264_mf", "libx264")
SOFTWARE_ENCODER = "libx264"
AAC_SAMPLE_RATES = (8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000, 64000, 88200, 96000)
EFFICIENT_SOURCE_CODECS = ("hevc", "h265", "vp9", "av1")

PARTIAL_SUFFIX = ".partial.mp4"
ENTRY_SUFFIX = ".mp4"
DEFAULT_CACHE_LIMIT = 50 * 1024 * 1024 * 1024
DISK_RESERVE_BYTES = 1024 * 1024 * 1024
DURATION_TOLERANCE = 0.1
PROGRESS_INTERVAL = 1.0
STALL_TIMEOUT = 180.0
PROGRESS_KEYS = ("out_time_us", "out_time_ms", "frame", "total_size")
DETECT_DELAY = 2.0
DETECT_TIMEOUT = 25.0
PROBE_TIMEOUT = 30
IDLE_INTERVAL = 2.0
TOUCH_INTERVAL = 600.0
MIN_VIDEO_BITRATE = 4000000
MAX_VIDEO_BITRATE = 40000000
DEFAULT_VIDEO_BITRATE = 8000000
KEYFRAME_SECONDS = 2
MAX_GOP = 600

JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000
JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS = 9


class _BasicLimitInformation(ctypes.Structure):
    _fields_ = [
        ("PerProcessUserTimeLimit", ctypes.c_int64),
        ("PerJobUserTimeLimit", ctypes.c_int64),
        ("LimitFlags", wintypes.DWORD),
        ("MinimumWorkingSetSize", ctypes.c_size_t),
        ("MaximumWorkingSetSize", ctypes.c_size_t),
        ("ActiveProcessLimit", wintypes.DWORD),
        ("Affinity", ctypes.c_size_t),
        ("PriorityClass", wintypes.DWORD),
        ("SchedulingClass", wintypes.DWORD)
    ]


class _IoCounters(ctypes.Structure):
    _fields_ = [
        ("ReadOperationCount", ctypes.c_uint64),
        ("WriteOperationCount", ctypes.c_uint64),
        ("OtherOperationCount", ctypes.c_uint64),
        ("ReadTransferCount", ctypes.c_uint64),
        ("WriteTransferCount", ctypes.c_uint64),
        ("OtherTransferCount", ctypes.c_uint64)
    ]


class _ExtendedLimitInformation(ctypes.Structure):
    _fields_ = [
        ("BasicLimitInformation", _BasicLimitInformation),
        ("IoInfo", _IoCounters),
        ("ProcessMemoryLimit", ctypes.c_size_t),
        ("JobMemoryLimit", ctypes.c_size_t),
        ("PeakProcessMemoryUsed", ctypes.c_size_t),
        ("PeakJobMemoryUsed", ctypes.c_size_t)
    ]


class _KillOnCloseJob:
    def __init__(self):
        self.handle = None
        self.kernel32 = None
        if os.name != "nt":
            return
        try:
            kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
            kernel32.CreateJobObjectW.restype = wintypes.HANDLE
            kernel32.CreateJobObjectW.argtypes = [wintypes.LPVOID, wintypes.LPCWSTR]
            kernel32.SetInformationJobObject.restype = wintypes.BOOL
            kernel32.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, wintypes.LPVOID, wintypes.DWORD]
            kernel32.AssignProcessToJobObject.restype = wintypes.BOOL
            kernel32.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
            kernel32.CloseHandle.restype = wintypes.BOOL
            kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
            handle = kernel32.CreateJobObjectW(None, None)
            if not handle:
                return
            info = _ExtendedLimitInformation()
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            if not kernel32.SetInformationJobObject(
                handle,
                JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS,
                ctypes.byref(info),
                ctypes.sizeof(info)
            ):
                kernel32.CloseHandle(handle)
                return
            self.kernel32 = kernel32
            self.handle = handle
        except Exception:
            self.handle = None

    def assign(self, process):
        if not self.handle:
            return
        try:
            self.kernel32.AssignProcessToJobObject(self.handle, wintypes.HANDLE(int(process._handle)))
        except Exception:
            pass


def _safe_float(value):
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if parsed != parsed or parsed in (float('inf'), float('-inf')):
        return None
    return parsed


def _last_line(lines):
    for line in reversed(list(lines)):
        text = line.strip()
        if text:
            return text[:200]
    return ""


def _read_bytes(process):
    if psutil is None:
        return None
    try:
        return psutil.Process(process.pid).io_counters().read_bytes
    except (psutil.Error, AttributeError, OSError):
        return None


def _kill_process_tree(process):
    if process is None:
        return
    if psutil is not None:
        try:
            parent = psutil.Process(process.pid)
            for child in parent.children(recursive=True):
                try:
                    child.kill()
                except psutil.Error:
                    pass
        except psutil.Error:
            pass
    try:
        process.kill()
    except OSError:
        pass
    try:
        process.wait(timeout=10)
    except Exception:
        pass


class ConversionJob:
    def __init__(self, key, source, plan, info, output, partial, manual):
        self.key = key
        self.source = source
        self.plan = plan
        self.info = dict(info or {})
        self.output = output
        self.partial = partial
        self.manual = manual
        self.item_ids = set()
        self.status = "queued"
        self.progress = 0
        self.encoder = ""
        self.error = ""
        self.process = None
        self.cancel_event = threading.Event()
        self.last_notify = 0.0

    def state(self):
        return {
            "plan": self.plan,
            "status": self.status,
            "progress": int(self.progress),
            "encoder": self.encoder,
            "error": self.error
        }


class MediaConverter:
    def __init__(self, cache_dir=None, cache_limit=DEFAULT_CACHE_LIMIT):
        self.cache_dir = cache_dir or Config.get_cache_dir()
        self.cache_limit = cache_limit
        self.settings = {"auto_remux": True, "auto_audio": True, "auto_full": False, "gpu_degraded": False}
        self.encoder = ""
        self.detecting = True
        self.jobs = {}
        self.queue = collections.deque()
        self.finished = {}
        self.touched = {}
        self.lock = threading.RLock()
        self.condition = threading.Condition(self.lock)
        self.running = True
        self.current_process = None
        self.on_update = None
        self.referenced_keys = None
        self.engine_busy = None
        self.idle_hook = None
        self.cache_bytes = 0
        self.job_object = _KillOnCloseJob()
        self._prepare_cache_dir()
        self.worker = threading.Thread(target=self._run, daemon=True, name="flowair-convert")
        self.worker.start()

    @staticmethod
    def key_for(source, signature, plan):
        normalized = os.path.normcase(os.path.abspath(source))
        return hashlib.sha1(f"{normalized}|{signature}|{plan}".encode("utf-8", "ignore")).hexdigest()

    def entry_path(self, key):
        return os.path.join(self.cache_dir, key + ENTRY_SUFFIX)

    def partial_path(self, key):
        return os.path.join(self.cache_dir, f"{key}.{uuid.uuid4().hex[:12]}{PARTIAL_SUFFIX}")

    def policy_allows(self, plan):
        if plan == "remux":
            return bool(self.settings.get("auto_remux"))
        if plan == "audio":
            return bool(self.settings.get("auto_audio"))
        if plan == "full":
            return bool(self.settings.get("auto_full"))
        return False

    def update_settings(self, auto_remux=None, auto_audio=None, auto_full=None, gpu_degraded=None):
        with self.condition:
            for name, value in (("auto_remux", auto_remux), ("auto_audio", auto_audio),
                                ("auto_full", auto_full), ("gpu_degraded", gpu_degraded)):
                if value is not None:
                    self.settings[name] = bool(value)
            self.condition.notify_all()
            return dict(self.settings)

    def lookup(self, key, plan):
        with self.lock:
            job = self.jobs.get(key)
            if job is not None:
                return job.state()
        if os.path.isfile(self.entry_path(key)):
            self._touch(key, force=True)
            return self._done_state(key, plan)
        return None

    def _done_state(self, key, plan):
        return {
            "plan": plan,
            "status": "done",
            "progress": 100,
            "encoder": self.finished.get(key, ""),
            "error": ""
        }

    def request(self, key, source, plan, info, item_id, manual=False, restart=False):
        if plan not in PLANS:
            return None
        with self.condition:
            job = self.jobs.get(key)
            if job is not None and job.status in ACTIVE_STATUSES and not job.cancel_event.is_set():
                job.item_ids.add(item_id)
                if manual:
                    job.manual = True
                return job.state()
            if job is not None:
                item_ids = set(job.item_ids)
                job.item_ids.clear()
                del self.jobs[key]
            else:
                item_ids = set()

        output = self.entry_path(key)
        if os.path.isfile(output):
            if not restart:
                self._touch(key, force=True)
                return self._done_state(key, plan)
            try:
                os.remove(output)
            except OSError:
                return None
            self.finished.pop(key, None)
            self._refresh_cache_bytes()

        with self.condition:
            existing = self.jobs.get(key)
            if existing is not None and existing.status in ACTIVE_STATUSES and not existing.cancel_event.is_set():
                existing.item_ids.add(item_id)
                return existing.state()
            job = ConversionJob(key, source, plan, info, output, self.partial_path(key), manual)
            job.item_ids = item_ids
            job.item_ids.add(item_id)
            if plan == "full":
                job.encoder = self.encoder
            self.jobs[key] = job
            self.queue.append(key)
            self.condition.notify_all()
            return job.state()

    def attach(self, key, item_id):
        with self.lock:
            job = self.jobs.get(key)
            if job is not None and job.status in ACTIVE_STATUSES:
                job.item_ids.add(item_id)
                return True
        return False

    def release(self, key, item_id):
        cancel = False
        with self.lock:
            job = self.jobs.get(key)
            if job is None:
                return
            job.item_ids.discard(item_id)
            if not job.item_ids:
                if job.status in ACTIVE_STATUSES:
                    cancel = True
                else:
                    del self.jobs[key]
        if cancel:
            self.cancel(key, notify=False)

    def cancel(self, key, notify=True):
        notify_job = None
        with self.condition:
            job = self.jobs.get(key)
            if job is None or job.status not in ACTIVE_STATUSES:
                return False
            job.cancel_event.set()
            if job.status == "queued":
                try:
                    self.queue.remove(key)
                except ValueError:
                    pass
                job.status = "cancelled"
                job.progress = 0
                if job.item_ids:
                    notify_job = job
                else:
                    del self.jobs[key]
            process = job.process
            self.condition.notify_all()
        if process is not None:
            threading.Thread(target=_kill_process_tree, args=(process,), daemon=True).start()
        if notify and notify_job is not None:
            self._notify(notify_job, True)
        return True

    def cancel_all(self):
        with self.lock:
            keys = list(self.jobs.keys())
        for key in keys:
            self.cancel(key, notify=False)
        with self.lock:
            for key in list(self.jobs.keys()):
                if self.jobs[key].status not in ACTIVE_STATUSES:
                    del self.jobs[key]
                else:
                    self.jobs[key].item_ids.clear()

    def resolve(self, key):
        path = self.entry_path(key)
        if os.path.isfile(path):
            self._touch(key)
            return path
        return None

    def status(self):
        with self.lock:
            entries = []
            ordered = [key for key, job in self.jobs.items() if job.status == "running"]
            ordered.extend(key for key in self.queue if key in self.jobs and key not in ordered)
            for key in ordered:
                job = self.jobs[key]
                for item_id in sorted(job.item_ids):
                    entries.append({
                        "item_id": item_id,
                        "plan": job.plan,
                        "status": job.status,
                        "progress": int(job.progress)
                    })
            return {
                "encoder": self.encoder,
                "detecting": self.detecting,
                "queue": entries,
                "cache_bytes": self.cache_bytes,
                "cache_limit": self.cache_limit,
                "settings": dict(self.settings)
            }

    def clear_cache(self):
        referenced = self._referenced()
        with self.lock:
            busy = set(self.jobs.keys())
        freed = 0
        for name, path, size, _ in self._entries():
            key = name[:-len(ENTRY_SUFFIX)]
            if key in referenced or key in busy:
                continue
            try:
                os.remove(path)
                freed += size
                self.finished.pop(key, None)
                self.touched.pop(key, None)
            except OSError:
                pass
        self._refresh_cache_bytes()
        return {"freed_bytes": freed, "cache_bytes": self.cache_bytes}

    def shutdown(self):
        with self.condition:
            self.running = False
            processes = [self.current_process]
            for job in self.jobs.values():
                job.cancel_event.set()
                processes.append(job.process)
            self.condition.notify_all()
        for process in processes:
            if process is not None and process.poll() is None:
                _kill_process_tree(process)
        if self.worker.is_alive() and threading.current_thread() is not self.worker:
            self.worker.join(timeout=5)

    def _referenced(self):
        provider = self.referenced_keys
        if provider is None:
            return set()
        try:
            return set(provider())
        except Exception:
            return set()

    def _prepare_cache_dir(self):
        try:
            os.makedirs(self.cache_dir, exist_ok=True)
        except OSError:
            return
        try:
            names = os.listdir(self.cache_dir)
        except OSError:
            names = []
        for name in names:
            if name.endswith(PARTIAL_SUFFIX):
                try:
                    os.remove(os.path.join(self.cache_dir, name))
                except OSError:
                    pass
        self._refresh_cache_bytes()

    def _entries(self):
        entries = []
        try:
            with os.scandir(self.cache_dir) as iterator:
                for entry in iterator:
                    name = entry.name
                    if not name.endswith(ENTRY_SUFFIX) or name.endswith(PARTIAL_SUFFIX):
                        continue
                    try:
                        stats = entry.stat()
                    except OSError:
                        continue
                    entries.append((name, entry.path, stats.st_size, stats.st_mtime))
        except OSError:
            pass
        return entries

    def _refresh_cache_bytes(self):
        self.cache_bytes = sum(entry[2] for entry in self._entries())
        return self.cache_bytes

    def _touch(self, key, force=False):
        now = time.monotonic()
        if not force and now - self.touched.get(key, 0.0) < TOUCH_INTERVAL:
            return
        self.touched[key] = now
        try:
            os.utime(self.entry_path(key), None)
        except OSError:
            pass

    def _ensure_space(self, job):
        try:
            needed = os.path.getsize(job.source)
        except OSError:
            needed = 0
        if job.plan == "full":
            duration = _safe_float(job.info.get("duration")) or 0
            needed = max(needed, int(duration * MAX_VIDEO_BITRATE / 8))
        referenced = self._referenced()
        with self.lock:
            busy = set(self.jobs.keys())
        entries = sorted(self._entries(), key=lambda entry: entry[3])
        total = sum(entry[2] for entry in entries)
        for name, path, size, _ in entries:
            if total + needed <= self.cache_limit:
                break
            key = name[:-len(ENTRY_SUFFIX)]
            if key in referenced or key in busy:
                continue
            try:
                os.remove(path)
                total -= size
                self.finished.pop(key, None)
                self.touched.pop(key, None)
            except OSError:
                pass
        self.cache_bytes = total
        try:
            free = shutil.disk_usage(self.cache_dir).free
        except OSError:
            return True
        return free > needed + DISK_RESERVE_BYTES

    def _notify(self, job, final):
        callback = self.on_update
        if callback is None:
            return
        job.last_notify = time.monotonic()
        try:
            callback(job.key, job.state(), frozenset(job.item_ids), final)
        except Exception:
            pass

    def _run(self):
        self._wait(DETECT_DELAY)
        if self.running:
            self._detect_encoder()
        while self.running:
            job = None
            with self.condition:
                if not self.running:
                    break
                job = self._next_job()
                if job is None:
                    self.condition.wait(timeout=IDLE_INTERVAL)
                else:
                    job.status = "running"
                    job.progress = 0
                    if job.plan == "full":
                        job.encoder = self.encoder or SOFTWARE_ENCODER
            if job is None:
                self._idle()
                continue
            self._notify(job, False)
            try:
                self._execute(job)
            except Exception:
                job.status = "failed"
                job.error = "The conversion stopped unexpectedly"
                self._remove(job.partial)
            with self.condition:
                if not job.item_ids and self.jobs.get(job.key) is job:
                    del self.jobs[job.key]
            if self.running:
                self._notify(job, True)

    def _idle(self):
        hook = self.idle_hook
        if hook is None or not self.running:
            return
        try:
            hook()
        except Exception:
            pass

    def _wait(self, seconds):
        with self.condition:
            deadline = time.monotonic() + seconds
            while self.running:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                self.condition.wait(timeout=remaining)

    def _next_job(self):
        hold_full = False
        if self.settings.get("gpu_degraded") and self.engine_busy is not None:
            try:
                hold_full = bool(self.engine_busy())
            except Exception:
                hold_full = False
        for key in list(self.queue):
            job = self.jobs.get(key)
            if job is None or job.status != "queued":
                self.queue.remove(key)
                continue
            if job.plan == "full" and hold_full and not job.manual:
                continue
            self.queue.remove(key)
            return job
        return None

    def _detect_encoder(self):
        ffmpeg = Config.get_ffmpeg_path()
        for encoder in ENCODER_CANDIDATES:
            if not self.running:
                break
            if self._test_encoder(ffmpeg, encoder):
                with self.lock:
                    self.encoder = encoder
                    for job in self.jobs.values():
                        if job.plan == "full" and job.status == "queued":
                            job.encoder = encoder
                break
        self.detecting = False

    def _test_encoder(self, ffmpeg, encoder):
        pixel_format = "yuv420p" if encoder == SOFTWARE_ENCODER else "nv12"
        cmd = [
            ffmpeg, '-hide_banner', '-nostdin', '-loglevel', 'error',
            '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30',
            '-t', '1', '-vf', f'format={pixel_format}',
            '-c:v', encoder, '-b:v', '4M',
            '-f', 'null', '-'
        ]
        try:
            process = subprocess.Popen(
                cmd,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=FFMPEG_CREATION_FLAGS
            )
        except (OSError, ValueError):
            return False
        self.job_object.assign(process)
        with self.lock:
            self.current_process = process
        try:
            return process.wait(timeout=DETECT_TIMEOUT) == 0 and self.running
        except subprocess.TimeoutExpired:
            _kill_process_tree(process)
            return False
        finally:
            with self.lock:
                self.current_process = None

    def _execute(self, job):
        if not os.path.isfile(job.source):
            job.status = "failed"
            job.error = "The source file is missing"
            return
        try:
            os.makedirs(self.cache_dir, exist_ok=True)
        except OSError:
            job.status = "failed"
            job.error = "The media cache folder cannot be created"
            return
        if not self._ensure_space(job):
            job.status = "failed"
            job.error = "Not enough disk space for the converted copy"
            return

        encoders = [""]
        if job.plan == "full":
            first = job.encoder or SOFTWARE_ENCODER
            encoders = [first] if first == SOFTWARE_ENCODER else [first, SOFTWARE_ENCODER]

        error = ""
        for encoder in encoders:
            if job.cancel_event.is_set() or not self.running:
                break
            if encoder:
                job.encoder = encoder
                job.progress = 0
            self._remove(job.partial)
            job.partial = self.partial_path(job.key)
            ok, error = self._run_ffmpeg(job, self.build_command(job, encoder))
            if job.cancel_event.is_set() or not self.running:
                break
            if ok:
                ok, error = self._verify_output(job)
            if ok:
                try:
                    os.replace(job.partial, job.output)
                except OSError:
                    ok = False
                    error = "The converted copy could not be saved"
            if ok:
                job.status = "done"
                job.progress = 100
                job.error = ""
                self.finished[job.key] = job.encoder
                self._touch(job.key, force=True)
                self._refresh_cache_bytes()
                return
            self._remove(job.partial)

        self._remove(job.partial)
        if job.cancel_event.is_set() or not self.running:
            job.status = "cancelled"
            job.progress = 0
            job.error = ""
            return
        job.status = "failed"
        job.progress = 0
        job.error = error or "The conversion failed"

    def _remove(self, path):
        for _ in range(5):
            try:
                if os.path.exists(path):
                    os.remove(path)
                return
            except OSError:
                time.sleep(0.2)

    def build_command(self, job, encoder=""):
        info = job.info
        cmd = [
            Config.get_ffmpeg_path(), '-hide_banner', '-nostdin', '-loglevel', 'error', '-y',
            '-i', job.source
        ]

        video_index = info.get("video_index")
        audio_index = info.get("audio_index")
        cmd += ['-map', f'0:{video_index}' if video_index is not None else '0:v:0']
        if audio_index is not None:
            cmd += ['-map', f'0:{audio_index}']
        cmd += ['-map_chapters', '-1', '-sn', '-dn']

        if job.plan == "full":
            cmd += self._video_encode_args(info, encoder or SOFTWARE_ENCODER)
        else:
            cmd += ['-c:v', 'copy']

        if audio_index is not None:
            copy_audio = job.plan == "remux" or (job.plan == "full" and info.get("audio_codec") == "aac")
            if copy_audio:
                cmd += ['-c:a', 'copy']
            else:
                cmd += self._audio_encode_args(info)

        cmd += [
            '-movflags', '+faststart',
            '-max_muxing_queue_size', '4096',
            '-nostats', '-stats_period', '1', '-progress', 'pipe:1',
            '-f', 'mp4', job.partial
        ]
        return cmd

    def _video_encode_args(self, info, encoder):
        filters = []
        if info.get("reset_video_start"):
            filters.append('setpts=PTS-STARTPTS')
        if info.get("interlaced"):
            filters.append('bwdif=mode=send_frame:parity=auto:deint=interlaced')
        width = int(info.get("width") or 0)
        height = int(info.get("height") or 0)
        if width % 2 or height % 2:
            filters.append('crop=trunc(iw/2)*2:trunc(ih/2)*2:0:0')
        filters.append('format=yuv420p' if encoder == SOFTWARE_ENCODER else 'format=nv12')

        args = ['-vf', ','.join(filters), '-c:v', encoder]
        if encoder == SOFTWARE_ENCODER:
            args += ['-preset', 'veryfast', '-crf', '20', '-profile:v', 'high',
                     '-maxrate', str(MAX_VIDEO_BITRATE), '-bufsize', str(MAX_VIDEO_BITRATE * 2)]
        else:
            target = self._target_bitrate(info)
            rate = ['-b:v', str(target), '-maxrate', str(int(target * 1.5)), '-bufsize', str(target * 2)]
            if encoder == "h264_qsv":
                args += ['-preset', 'medium', '-profile:v', 'high', '-bf', '0'] + rate
            elif encoder == "h264_nvenc":
                args += ['-preset', 'p4', '-rc', 'vbr', '-profile:v', 'high', '-bf', '0'] + rate
            elif encoder == "h264_amf":
                args += ['-quality', 'balanced', '-rc', 'vbr_peak', '-profile:v', 'high', '-bf', '0'] + rate
            else:
                args += ['-b:v', str(target)]

        args += ['-pix_fmt', 'yuv420p' if encoder == SOFTWARE_ENCODER else 'nv12',
                 '-fps_mode', 'passthrough', '-enc_time_base:v', 'demux',
                 '-force_key_frames', f'expr:gte(t,n_forced*{KEYFRAME_SECONDS})']
        fps = _safe_float(info.get("fps"))
        if fps and fps > 0:
            args += ['-g', str(max(1, min(MAX_GOP, int(round(fps * KEYFRAME_SECONDS)))))]
        return args

    def _target_bitrate(self, info):
        source = _safe_float(info.get("bitrate_bps"))
        if not source or source <= 0:
            return DEFAULT_VIDEO_BITRATE
        if (info.get("video_codec") or "") in EFFICIENT_SOURCE_CODECS:
            source *= 1.5
        return int(max(MIN_VIDEO_BITRATE, min(MAX_VIDEO_BITRATE, source)))

    def _audio_encode_args(self, info):
        channels = int(info.get("audio_channels") or 0)
        args = ['-c:a', 'aac']
        if channels > 6:
            args += ['-ac', '6']
            channels = 6
        elif 2 < channels < 6:
            args += ['-ac', '2']
            channels = 2
        args += ['-b:a', '384k' if channels >= 6 else '192k']
        sample_rate = int(info.get("audio_sample_rate") or 0)
        if sample_rate and sample_rate not in AAC_SAMPLE_RATES:
            args += ['-ar', '48000']
        args += ['-af', 'aresample=async=1:first_pts=0']
        return args

    def _run_ffmpeg(self, job, cmd):
        try:
            process = subprocess.Popen(
                cmd,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                creationflags=FFMPEG_CREATION_FLAGS
            )
        except FileNotFoundError:
            return False, "ffmpeg was not found"
        except (OSError, ValueError):
            return False, "ffmpeg could not be started"

        self.job_object.assign(process)
        with self.lock:
            job.process = process
            self.current_process = process
            cancelled = job.cancel_event.is_set() or not self.running
        if cancelled:
            _kill_process_tree(process)

        errors = collections.deque(maxlen=20)
        activity = [time.monotonic()]
        counters = {}
        stall = [False]
        finished = threading.Event()

        def advance(name, value):
            if value is not None and value > counters.get(name, -1):
                counters[name] = value
                activity[0] = time.monotonic()

        def drain_errors():
            try:
                for raw in iter(process.stderr.readline, b''):
                    errors.append(raw.decode('utf-8', 'ignore'))
            except (OSError, ValueError):
                pass

        def watchdog():
            while not finished.wait(1.0):
                advance('read_bytes', _read_bytes(process))
                if job.cancel_event.is_set() or not self.running:
                    _kill_process_tree(process)
                    return
                if time.monotonic() - activity[0] > STALL_TIMEOUT:
                    stall[0] = True
                    _kill_process_tree(process)
                    return

        error_thread = threading.Thread(target=drain_errors, daemon=True)
        watchdog_thread = threading.Thread(target=watchdog, daemon=True)
        error_thread.start()
        watchdog_thread.start()

        duration = _safe_float(job.info.get("duration")) or 0
        stalled = False
        try:
            for raw in iter(process.stdout.readline, b''):
                line = raw.decode('utf-8', 'ignore').strip()
                name, _, value = line.partition('=')
                if name in PROGRESS_KEYS:
                    advance(name, _safe_float(value))
                if name in ('out_time_us', 'out_time_ms'):
                    micros = _safe_float(value)
                    if micros is not None and duration > 0:
                        percent = max(0, min(99, int(micros / 1000000.0 / duration * 100)))
                        if percent > job.progress:
                            job.progress = percent
                            if time.monotonic() - job.last_notify >= PROGRESS_INTERVAL:
                                self._notify(job, False)
                elif line == 'progress=end':
                    break
        except (OSError, ValueError):
            pass

        try:
            return_code = process.wait(timeout=STALL_TIMEOUT)
        except subprocess.TimeoutExpired:
            stalled = True
            _kill_process_tree(process)
            return_code = process.returncode
        finished.set()
        watchdog_thread.join(timeout=5)
        error_thread.join(timeout=5)
        for stream in (process.stdout, process.stderr):
            try:
                stream.close()
            except (OSError, ValueError):
                pass
        with self.lock:
            job.process = None
            if self.current_process is process:
                self.current_process = None

        if return_code == 0 and not stalled:
            return True, ""
        if stall[0] or stalled:
            return False, "ffmpeg stopped responding"
        return False, _last_line(errors) or "ffmpeg could not convert this file"

    def _probe_duration(self, path):
        cmd = [
            Config.get_ffprobe_path(), '-v', 'error',
            '-show_entries', 'format=duration',
            '-print_format', 'json', path
        ]
        try:
            completed = subprocess.run(
                cmd,
                capture_output=True,
                encoding='utf-8',
                errors='ignore',
                stdin=subprocess.DEVNULL,
                creationflags=FFMPEG_CREATION_FLAGS,
                timeout=PROBE_TIMEOUT
            )
            data = json.loads(completed.stdout or '{}')
        except (OSError, ValueError, subprocess.TimeoutExpired):
            return None
        return _safe_float((data.get('format') or {}).get('duration'))

    def _verify_output(self, job):
        if not os.path.isfile(job.partial) or os.path.getsize(job.partial) <= 0:
            return False, "ffmpeg produced no output"
        duration = self._probe_duration(job.partial)
        if duration is None:
            return False, "The converted copy cannot be read"
        expected = [value for value in (_safe_float(job.info.get("duration")),
                                        _safe_float(job.info.get("stream_duration"))) if value]
        if not expected:
            return True, ""
        if any(abs(duration - value) <= DURATION_TOLERANCE for value in expected):
            return True, ""
        return False, f"The converted copy lasts {duration:.2f}s instead of {expected[0]:.2f}s"
