"""Turns a run's screenshots (one after every drag) into a short MP4 replay for the leaderboard."""
import io
import subprocess
import tempfile
import pathlib

from PIL import Image, ImageDraw, ImageFont
import imageio_ffmpeg

SIZE = (960, 600)   # the 1280x800 page, scaled down
LENGTH = 25         # target seconds for the whole replay
HOLD = 2            # seconds the final frame stays up


class Recorder:
    def __init__(self):
        self.frames = []  # (jpeg bytes, caption)

    def add(self, page, caption):
        self.frames.append((page.screenshot(type="jpeg", quality=80), caption))

    def save(self, path):
        if not self.frames:
            return
        fps = min(8, max(2, len(self.frames) / LENGTH))  # fast enough to fit ~25s, slow enough to follow
        font = ImageFont.load_default(size=20)
        frames = self.frames + [self.frames[-1]] * round(fps * HOLD)
        with tempfile.TemporaryDirectory() as tmp:
            for i, (jpeg, caption) in enumerate(frames):
                img = Image.open(io.BytesIO(jpeg)).convert("RGB").resize(SIZE)
                draw = ImageDraw.Draw(img)
                box = draw.textbbox((16, 12), caption, font=font)
                draw.rounded_rectangle((box[0] - 10, box[1] - 7, box[2] + 10, box[3] + 7), radius=8, fill=(20, 20, 20))
                draw.text((16, 12), caption, font=font, fill=(255, 255, 255))
                img.save(pathlib.Path(tmp) / f"{i:05d}.jpg", quality=90)
            subprocess.run([
                imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error",
                "-framerate", f"{fps:.3f}", "-i", str(pathlib.Path(tmp) / "%05d.jpg"),
                "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "28", "-movflags", "+faststart", str(path),
            ], check=True)
