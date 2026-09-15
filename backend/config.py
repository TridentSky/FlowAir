import os

class Config:
    HOST = "0.0.0.0"
    PORT = 8000

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
    def get_ffprobe_path():
        return Config._resolve_binary("ffprobe")
