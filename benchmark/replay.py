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
WHITE, RED = (255, 255, 255), (255, 90, 90)
FONT = ImageFont.load_default(size=20)


def time_left(seconds):
    """The caption's clock: white while time remains, red once it has run out."""
    seconds = max(0, round(seconds))
    return f"{seconds // 60}:{seconds % 60:02d} left", RED if seconds == 0 else WHITE


def label(img, parts):
    """Draws the caption box in the top-left corner; parts are (text, color) pairs, drawn left to right."""
    draw = ImageDraw.Draw(img)
    box = draw.textbbox((16, 12), "".join(text for text, _ in parts), font=FONT)
    draw.rounded_rectangle((box[0] - 10, box[1] - 7, box[2] + 10, box[3] + 7), radius=8, fill=(20, 20, 20))
    x = 16
    for text, color in parts:
        draw.text((x, 12), text, font=FONT, fill=color)
        x += draw.textlength(text, font=FONT)


def encode(folder, fps, path):
    subprocess.run([
        imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error",
        "-framerate", f"{fps:.3f}", "-i", str(pathlib.Path(folder) / "%05d.jpg"),
        # Standard (limited-range) yuv420p: full-range video from JPEG frames shows black in some browsers, like Safari
        "-vf", "scale=out_range=tv,format=yuv420p", "-color_range", "tv",
        "-c:v", "libx264", "-crf", "28", "-movflags", "+faststart", str(path),
    ], check=True)


class Recorder:
    def __init__(self):
        self.frames = []  # (jpeg bytes, caption, seconds left)

    def add(self, page, caption, seconds_left):
        self.frames.append((page.screenshot(type="jpeg", quality=80), caption, seconds_left))

    def save(self, path):
        if not self.frames:
            return
        fps = min(8, max(2, len(self.frames) / LENGTH))  # fast enough to fit ~25s, slow enough to follow
        frames = self.frames + [self.frames[-1]] * round(fps * HOLD)
        with tempfile.TemporaryDirectory() as tmp:
            for i, (jpeg, caption, seconds_left) in enumerate(frames):
                img = Image.open(io.BytesIO(jpeg)).convert("RGB").resize(SIZE)
                label(img, [(caption + "  ·  ", WHITE), time_left(seconds_left)])
                img.save(pathlib.Path(tmp) / f"{i:05d}.jpg", quality=90)
            encode(tmp, fps, path)
