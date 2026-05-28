#!/usr/bin/env python3
"""
Viora video backend — yt-dlp + Piped fallback chain.
- Non-YouTube URLs: handled by yt-dlp (TikTok, Twitter, VK, Instagram, etc.)
- YouTube URLs: yt-dlp with bgutil pot-provider, fallback to Piped instance.
- If cookies file present, yt-dlp uses it (most reliable for YouTube).
"""
import os
import re
import sys
import json
import time
import shutil
import tempfile
import subprocess
import urllib.parse
import urllib.request
from typing import Optional, Tuple
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse

COOKIES_FILE = os.environ.get(
    "VIORA_COOKIES",
    "/home/workspace/.viora-yt-cookies.txt",
)
POT_PROVIDER_HOME = "/root/bgutil-ytdlp-pot-provider/server"
PIPED_INSTANCE = os.environ.get("VIORA_PIPED_API", "https://api.piped.private.coffee")

app = FastAPI(title="Viora Video Backend")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

YOUTUBE_RE = re.compile(r"(?:youtube\.com|youtu\.be)")

def is_youtube(url: str) -> bool:
    return bool(YOUTUBE_RE.search(url or ""))

def yt_video_id(url: str) -> Optional[str]:
    m = re.search(r"(?:v=|/shorts/|youtu\.be/|/embed/)([\w-]{11})", url or "")
    return m.group(1) if m else None

def safe_filename(s: str) -> str:
    s = re.sub(r"[\\/:*?\"<>|]+", "_", s)
    return s[:90].strip() or "video"

def has_cookies() -> bool:
    return os.path.exists(COOKIES_FILE) and os.path.getsize(COOKIES_FILE) > 100

def ytdlp_args_for(url: str) -> list:
    args = ["--no-warnings", "--no-check-certificate"]
    if is_youtube(url):
        args += [
            "--extractor-args",
            "youtube:player_client=tv,android_vr,web_safari;getpot_bgutil_script=deno",
        ]
    if has_cookies():
        args += ["--cookies", COOKIES_FILE]
    return args

# ---- yt-dlp: info ----
def ytdlp_info(url: str) -> Optional[dict]:
    cmd = ["yt-dlp", *ytdlp_args_for(url), "-J", url]
    try:
        out = subprocess.run(cmd, capture_output=True, timeout=60, text=True)
        if out.returncode != 0:
            return None
        data = json.loads(out.stdout)
        if "entries" in data and data["entries"]:
            data = data["entries"][0]
        return data
    except Exception:
        return None

# ---- Piped: info ----
def piped_info(url: str) -> Optional[dict]:
    vid = yt_video_id(url)
    if not vid:
        return None
    try:
        req = urllib.request.Request(
            f"{PIPED_INSTANCE}/streams/{vid}",
            headers={"User-Agent": "Mozilla/5.0"},
        )
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read())
        if data.get("error") or not data.get("videoStreams"):
            return None
        return data
    except Exception:
        return None

@app.get("/")
def health():
    return {
        "service": "viora-video-backend",
        "yt_dlp": yt_dlp_version(),
        "cookies_loaded": has_cookies(),
        "piped": PIPED_INSTANCE,
    }

def yt_dlp_version() -> str:
    try:
        r = subprocess.run(["yt-dlp", "--version"], capture_output=True, text=True, timeout=5)
        return r.stdout.strip()
    except Exception:
        return "unknown"

@app.get("/info")
def info(url: str = Query(...)):
    if not url.startswith(("http://", "https://")):
        raise HTTPException(400, {"code": "bad_url", "message": "Неверный формат ссылки."})

    # 1. Try yt-dlp
    data = ytdlp_info(url)
    if data:
        return {
            "title": data.get("title", "video"),
            "duration": data.get("duration", 0) or 0,
            "thumbnail": data.get("thumbnail"),
            "uploader": data.get("uploader") or data.get("channel"),
            "ext": data.get("ext", "mp4"),
            "source": "ytdlp",
        }

    # 2. Fallback to Piped for YouTube
    if is_youtube(url):
        pdata = piped_info(url)
        if pdata:
            return {
                "title": pdata.get("title", "video"),
                "duration": pdata.get("duration", 0) or 0,
                "thumbnail": pdata.get("thumbnailUrl"),
                "uploader": pdata.get("uploader"),
                "ext": "mp4",
                "source": "piped",
            }
        raise HTTPException(400, {
            "code": "youtube_blocked",
            "message": "YouTube блокирует серверы скачивания для этого видео. Попробуйте другую ссылку — TikTok, VK, Twitter и десятки других платформ работают без проблем.",
        })

    raise HTTPException(400, {
        "code": "extract_fail",
        "message": "Не удалось получить информацию о видео. Возможно, ссылка приватная или платформа не поддерживается.",
    })

# ---- yt-dlp: download to temp file ----
def ytdlp_download(url: str, quality: str, audio_only: bool, tmp: str) -> Optional[str]:
    if audio_only:
        fmt = "bestaudio[ext=m4a]/bestaudio/best"
        post = ["-x", "--audio-format", "mp3", "--audio-quality", "0"]
    else:
        h = "9999" if quality == "max" else quality
        fmt = (
            f"bestvideo[height<={h}][ext=mp4]+bestaudio[ext=m4a]/"
            f"best[height<={h}][ext=mp4]/best[height<={h}]/best"
        )
        post = ["--merge-output-format", "mp4"]
    cmd = [
        "yt-dlp",
        *ytdlp_args_for(url),
        "-f", fmt,
        *post,
        "-o", os.path.join(tmp, "%(title).80B.%(ext)s"),
        "--no-playlist",
        url,
    ]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=240)
        if r.returncode != 0:
            return None
    except subprocess.TimeoutExpired:
        return None
    files = [f for f in os.listdir(tmp) if not f.endswith(".part")]
    return os.path.join(tmp, files[0]) if files else None

# ---- Piped: pick stream URL + proxy-download ----
def piped_pick_stream(pdata: dict, quality: str, audio_only: bool) -> Optional[Tuple[str, str, str]]:
    """Returns (stream_url, filename, mime) or None."""
    target_h = 9999 if quality == "max" else int(quality)
    if audio_only:
        audios = pdata.get("audioStreams") or []
        audios = sorted(audios, key=lambda s: -(s.get("bitrate") or 0))
        if not audios:
            return None
        a = audios[0]
        ext = a.get("format", "m4a").lower()
        if "mp4" in ext or "m4a" in ext: ext = "m4a"
        elif "webm" in ext or "opus" in ext: ext = "webm"
        else: ext = "m4a"
        return (a["url"], f"{safe_filename(pdata.get('title','audio'))}.{ext}", a.get("mimeType", "audio/mp4"))

    vids = pdata.get("videoStreams") or []
    # Prefer combined (videoOnly=False) and mp4
    combined = [s for s in vids if not s.get("videoOnly") and "mp4" in (s.get("format") or "").lower()]
    if not combined:
        combined = [s for s in vids if not s.get("videoOnly")]
    if not combined:
        # As last resort, pick any video stream
        combined = vids
    # Pick highest quality <= target_h
    def height_of(s):
        q = s.get("quality", "")
        m = re.search(r"(\d+)", q)
        return int(m.group(1)) if m else 0
    suitable = [s for s in combined if height_of(s) <= target_h]
    if not suitable:
        suitable = combined
    chosen = max(suitable, key=lambda s: height_of(s)) if suitable else None
    if not chosen:
        return None
    ext = (chosen.get("format") or "mp4").lower()
    if "mp4" in ext: ext = "mp4"
    elif "webm" in ext: ext = "webm"
    else: ext = "mp4"
    return (chosen["url"], f"{safe_filename(pdata.get('title','video'))}.{ext}", chosen.get("mimeType", "video/mp4"))

def stream_url_with_progress(stream_url: str, filename: str, mime: str):
    """Stream a remote URL as our HTTP response."""
    def gen():
        req = urllib.request.Request(stream_url, headers={
            "User-Agent": "Mozilla/5.0",
            "Accept": "*/*",
        })
        with urllib.request.urlopen(req, timeout=30) as r:
            while True:
                chunk = r.read(64 * 1024)
                if not chunk:
                    break
                yield chunk
    return StreamingResponse(
        gen(),
        media_type=mime,
        headers={
            "Content-Disposition": f'attachment; filename*=UTF-8\'\'{urllib.parse.quote(filename)}',
            "Cache-Control": "no-store",
        },
    )

@app.get("/dl")
def download(
    url: str = Query(...),
    quality: str = Query("720"),
    audio: bool = Query(False),
):
    if not url.startswith(("http://", "https://")):
        raise HTTPException(400, {"code": "bad_url", "message": "Неверный формат ссылки."})

    # 1. Try yt-dlp
    tmp = tempfile.mkdtemp(prefix="viora-")
    path = ytdlp_download(url, quality, audio, tmp)
    if path and os.path.exists(path):
        name = os.path.basename(path)
        size = os.path.getsize(path)
        def gen():
            try:
                with open(path, "rb") as f:
                    while True:
                        chunk = f.read(64 * 1024)
                        if not chunk:
                            break
                        yield chunk
            finally:
                shutil.rmtree(tmp, ignore_errors=True)
        return StreamingResponse(
            gen(),
            media_type="application/octet-stream",
            headers={
                "Content-Length": str(size),
                "Content-Disposition": f'attachment; filename*=UTF-8\'\'{urllib.parse.quote(name)}',
                "Cache-Control": "no-store",
                "X-Source": "ytdlp",
            },
        )

    shutil.rmtree(tmp, ignore_errors=True)

    # 2. YouTube fallback via Piped
    if is_youtube(url):
        pdata = piped_info(url)
        if pdata:
            picked = piped_pick_stream(pdata, quality, audio)
            if picked:
                stream_url, filename, mime = picked
                resp = stream_url_with_progress(stream_url, filename, mime)
                resp.headers["X-Source"] = "piped"
                return resp
        raise HTTPException(400, {
            "code": "youtube_blocked",
            "message": "YouTube блокирует серверы скачивания для этого видео. Попробуйте другую ссылку — TikTok, VK, Twitter и десятки других платформ работают без проблем.",
        })

    raise HTTPException(400, {
        "code": "extract_fail",
        "message": "Не удалось скачать. Возможно, ссылка приватная или платформа не поддерживается.",
    })

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", "8910"))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")