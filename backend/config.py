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

    @staticmethod
    def get_ffmpeg_path():
        return "ffmpeg"

    @staticmethod
    def get_ffprobe_path():
        return "ffprobe"
