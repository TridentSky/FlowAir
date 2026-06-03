import os

class Config:
    HOST = "0.0.0.0"
    PORT = 8000

    OUTPUT_RESOLUTION = "1920x1080"
    VIDEO_CODEC = "libx264"
    VIDEO_BITRATE = "5000k"
    AUDIO_CODEC = "aac"
    AUDIO_BITRATE = "192k"

    BACKUP_FILENAME = "backup.json"
    BACKUP_INTERVAL = 120

    MAX_LOG_ENTRIES = 50

    ALLOWED_VIDEO_EXTENSIONS = ['.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.webm', '.mpeg', '.mpg']
    ALLOWED_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.bmp', '.webp', '.tiff', '.gif']

    _BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    @staticmethod
    def _resolve_binary(name):
        env_dir = os.environ.get("FLOWAIR_FFMPEG_DIR")
        if env_dir:
            candidate = os.path.join(env_dir, name + ".exe")
            if os.path.exists(candidate):
                return candidate
        bundled = os.path.join(Config._BASE_DIR, "ffmpeg", "bin", name + ".exe")
        if os.path.exists(bundled):
            return bundled
        return name

    @staticmethod
    def get_ffmpeg_path():
        return Config._resolve_binary("ffmpeg")

    @staticmethod
    def get_ffprobe_path():
        return Config._resolve_binary("ffprobe")
