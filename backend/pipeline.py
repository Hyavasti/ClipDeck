import os
import shutil
import subprocess
import time
import wave
from pathlib import Path
import imageio_ffmpeg
import numpy as np
import yt_dlp
from faster_whisper import WhisperModel
from google import genai
from google.genai import types
from pydantic import BaseModel, Field
from dotenv import load_dotenv
from database import update_job, insert_clip

load_dotenv()

try:
    import ctranslate2
    import nvidia.cublas
    import nvidia.cuda_runtime

    ct2_dir = Path(ctranslate2.__file__).parent
    for pkg in (nvidia.cublas, nvidia.cuda_runtime):
        bin_dir = Path(list(pkg.__path__)[0]) / "bin"
        if bin_dir.exists():
            for dll in bin_dir.glob("*.dll"):
                target = ct2_dir / dll.name
                if not target.exists():
                    shutil.copy2(dll, target)
except Exception:
    pass

OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", "./outputs"))
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

FFMPEG_EXE = imageio_ffmpeg.get_ffmpeg_exe()
gemini_client = genai.Client(
    api_key=os.getenv("GEMINI_API_KEY"),
    http_options=types.HttpOptions(timeout=45000),
)


def log(msg: str):
    print(msg, flush=True)


class ViralClipCandidate(BaseModel):
    title: str = Field(description="Catchy, high-CTR short-form title")
    viral_score: int = Field(description="Score from 1 to 100 based on retention potential")
    hook_reason: str = Field(description="Why this segment hooks viewers in the first 3 seconds")
    start_time: float = Field(description="Start timestamp in seconds")
    end_time: float = Field(description="End timestamp in seconds (clip duration 20-60s)")


class ViralClipsResponse(BaseModel):
    clips: list[ViralClipCandidate]


def download_video(youtube_url: str, job_dir: Path) -> tuple[Path, str, str]:
    log(f"[1/4] Downloading video: {youtube_url}")
    ydl_opts = {
        "format": "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
        "outtmpl": str(job_dir / "source.%(ext)s"),
        "merge_output_format": "mp4",
        "ffmpeg_location": FFMPEG_EXE,
        "quiet": True,
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(youtube_url, download=True)
        title = info.get("title", "Untitled Video")
        uploader = info.get("uploader") or info.get("channel") or ""
        credit = f"@{uploader.replace(' ', '')}" if uploader else ""
        log(f"      Downloaded: {title} ({credit or 'No channel handle'})")
        return job_dir / "source.mp4", title, credit


def load_audio_array(video_path: Path, wav_path: Path) -> np.ndarray:
    cmd = [
        FFMPEG_EXE,
        "-y",
        "-i",
        str(video_path),
        "-vn",
        "-acodec",
        "pcm_s16le",
        "-ar",
        "16000",
        "-ac",
        "1",
        str(wav_path),
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    with wave.open(str(wav_path), "rb") as wf:
        frames = wf.readframes(wf.getnframes())
        audio = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
    return audio


def transcribe_video(job_id: str, video_path: Path, job_dir: Path) -> tuple[str, list[dict]]:
    log("[2/4] Extracting 16kHz audio and loading Whisper model (with word timestamps)...")
    wav_path = job_dir / "audio.wav"
    audio_array = load_audio_array(video_path, wav_path)
    total_duration = max(1.0, len(audio_array) / 16000.0)

    def run_whisper(device: str, compute_type: str) -> tuple[str, list[dict]]:
        log(f"      Running Whisper on {device.upper()} ({compute_type})...")
        model = WhisperModel("base", device=device, compute_type=compute_type)
        segments, _ = model.transcribe(audio_array, vad_filter=True, word_timestamps=True)

        lines = []
        words = []
        last_pct = 45
        for idx, seg in enumerate(segments, start=1):
            lines.append(f"[{seg.start:.2f} - {seg.end:.2f}] {seg.text.strip()}")
            if seg.words:
                for w in seg.words:
                    words.append({
                        "start": float(w.start),
                        "end": float(w.end),
                        "word": w.word.strip(),
                    })
            if idx % 15 == 0:
                ratio = min(1.0, seg.end / total_duration)
                pct = 45 + int(ratio * 24)
                if pct > last_pct:
                    last_pct = pct
                    update_job(job_id, progress=pct)
                    log(f"      Transcribed {seg.end:.0f}s / {total_duration:.0f}s ({pct}%)")
        return "\n".join(lines), words

    try:
        transcript, words = run_whisper("cuda", "float16")
    except Exception as cuda_err:
        log(f"      CUDA fallback triggered ({cuda_err}), switching to CPU...")
        transcript, words = run_whisper("cpu", "int8")

    (job_dir / "transcript.txt").write_text(transcript, encoding="utf-8")
    return transcript, words


def detect_viral_moments(transcript: str) -> list[ViralClipCandidate]:
    # Split long transcripts into ~14,000-char chunks (~8-10 mins each) so the entire video is analyzed
    chunk_size = 14000
    overlap = 1000
    chunks = []
    start_idx = 0
    while start_idx < len(transcript):
        chunks.append(transcript[start_idx : start_idx + chunk_size])
        if start_idx + chunk_size >= len(transcript):
            break
        start_idx += chunk_size - overlap

    models_to_try = [
        "gemini-3.8-flash",
        "gemini-3.5-flash-lite",
        "gemini-3.5-flash",
        "gemini-3.0-flash",
    ]

    all_candidates: list[ViralClipCandidate] = []

    for chunk_num, chunk_text in enumerate(chunks, start=1):
        prompt = f"""
        You are an expert viral short-form video editor (TikTok, YouTube Shorts, Reels).
        Analyze this section (Part {chunk_num}/{len(chunks)}) of a timestamped video transcript and extract ALL genuinely viral, high-retention segments.
        
        Rules:
        - Do NOT limit yourself to 3 clips—extract EVERY strong, standalone viral moment you find in this section (only include moments with a viral_score of 75 or higher).
        - Each clip MUST be between 20 and 60 seconds long.
        - Start right at a strong hook, surprising statement, or high-energy moment.
        - End cleanly at the conclusion of a thought or punchline.
        - Use exact timestamps from the transcript.

        Transcript (Part {chunk_num}/{len(chunks)}):
        {chunk_text}
        """

        chunk_clips = None
        last_err = None
        for attempt in range(1, 4):
            for model_name in models_to_try:
                try:
                    log(f"[3/4] Analyzing part {chunk_num}/{len(chunks)} with {model_name} (round {attempt}/3)...")
                    response = gemini_client.models.generate_content(
                        model=model_name,
                        contents=prompt,
                        config=types.GenerateContentConfig(
                            response_mime_type="application/json",
                            response_schema=ViralClipsResponse,
                            temperature=0.3,
                        ),
                    )
                    parsed = ViralClipsResponse.model_validate_json(response.text)
                    chunk_clips = parsed.clips
                    log(f"      Found {len(chunk_clips)} viral clips in part {chunk_num}/{len(chunks)}!")
                    break
                except Exception as e:
                    err_str = str(e)
                    log(f"      {model_name} failed: {err_str[:120]}...")
                    last_err = e
                    if "503" in err_str or "UNAVAILABLE" in err_str or "429" in err_str:
                        time.sleep(3)
            if chunk_clips is not None:
                break

        if chunk_clips is None:
            raise RuntimeError(f"All Gemini models failed on part {chunk_num}: {last_err}")

        all_candidates.extend(chunk_clips)

    # Deduplicate overlapping clips from chunk boundaries (keep highest viral_score)
    all_candidates.sort(key=lambda c: c.viral_score, reverse=True)
    unique_clips: list[ViralClipCandidate] = []
    for cand in all_candidates:
        is_duplicate = any(
            abs(cand.start_time - kept.start_time) < 12.0
            or (cand.start_time < kept.end_time and cand.end_time > kept.start_time)
            for kept in unique_clips
        )
        if not is_duplicate:
            unique_clips.append(cand)

    # Sort chronologically by video timeline for clean rendering
    unique_clips.sort(key=lambda c: c.start_time)
    log(f"      Total unique viral clips across full video: {len(unique_clips)}")
    return unique_clips

def format_ass_time(seconds: float) -> str:
    seconds = max(0.0, seconds)
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    return f"{h}:{m:02d}:{s:05.2f}"


def generate_ass_subtitles(
    words: list[dict],
    clip_start: float,
    clip_end: float,
    ass_path: Path,
    style: str = "hormozi",
    creator_credit: str = "",
) -> bool:
    clip_words = [
        w for w in words
        if w["end"] > clip_start and w["start"] < clip_end and w["word"]
    ]
    if not clip_words and not creator_credit:
        return False

    if style == "minimal":
        font_size = 54
        primary_color = "&H00FFFFFF"
        highlight_color = "&H0038BDF8"
        outline_width = 4
        shadow_depth = 1
        margin_v = 260
        uppercase = False
    else:
        font_size = 74
        primary_color = "&H00FFFFFF"
        highlight_color = "&H0000E5FF"
        outline_width = 6
        shadow_depth = 3
        margin_v = 340
        uppercase = True

    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial Black,{font_size},{primary_color},&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,{outline_width},{shadow_depth},2,95,95,{margin_v},1
Style: Credit,Arial,30,&H66FFFFFF,&H000000FF,&H88000000,&H00000000,-1,0,0,0,100,100,1,0,1,2,0,7,48,48,70,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    events = []
    clip_dur = max(1.0, clip_end - clip_start)
    if creator_credit:
        safe_credit = creator_credit.replace("{", "").replace("}", "")
        events.append(
            f"Dialogue: 1,{format_ass_time(0)},{format_ass_time(clip_dur)},Credit,,0,0,0,,Credit: {safe_credit}"
        )

    chunk_size = 3
    for i in range(0, len(clip_words), chunk_size):
        chunk = clip_words[i:i + chunk_size]
        for active_idx, active_word in enumerate(chunk):
            w_start = max(0.0, active_word["start"] - clip_start)
            if active_idx + 1 < len(chunk):
                w_end = max(w_start + 0.08, chunk[active_idx + 1]["start"] - clip_start)
            else:
                w_end = max(w_start + 0.12, active_word["end"] - clip_start)

            rendered_tokens = []
            for j, token in enumerate(chunk):
                txt = token["word"].upper() if uppercase else token["word"]
                txt = txt.replace("{", "").replace("}", "")
                if j == active_idx:
                    rendered_tokens.append(f"{{\\c{highlight_color}\\fscx108\\fscy108}}{txt}{{\\r}}")
                else:
                    rendered_tokens.append(txt)

            line_text = " ".join(rendered_tokens)
            events.append(
                f"Dialogue: 0,{format_ass_time(w_start)},{format_ass_time(w_end)},Default,,0,0,0,,{line_text}"
            )

    ass_path.write_text(header + "\n".join(events), encoding="utf-8")
    return True


def prepend_intro_clip(intro_path: Path, main_clip_path: Path, final_output_path: Path):
    filter_complex = (
        "[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,"
        "pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p,setsar=1[v0];"
        "[1:v]scale=1080:1920,fps=30,format=yuv420p,setsar=1[v1];"
        "[0:a]aresample=44100,aformat=channel_layouts=stereo[a0];"
        "[1:a]aresample=44100,aformat=channel_layouts=stereo[a1];"
        "[v0][a0][v1][a1]concat=n=2:v=1:a=1[outv][outa]"
    )
    cmd = [
        FFMPEG_EXE,
        "-y",
        "-i",
        str(intro_path),
        "-i",
        str(main_clip_path),
        "-filter_complex",
        filter_complex,
        "-map",
        "[outv]",
        "-map",
        "[outa]",
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "23",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        str(final_output_path),
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def render_vertical_clip(
    source_path: Path,
    output_path: Path,
    start: float,
    end: float,
    ass_path: Path | None = None,
    effect_preset: str = "zoom_pop",
    intro_clip_path: Path | None = None,
):
    duration = max(5.0, end - start)
    temp_body_path = (
        output_path.with_name(f"body_{output_path.name}")
        if (intro_clip_path and intro_clip_path.exists())
        else output_path
    )

    # Use forward-slashed relative path so Windows drive colons (S:) never break FFmpeg's filter parser
    sub_filter = ""
    if ass_path and ass_path.exists():
        rel_ass = os.path.relpath(ass_path, Path.cwd()).replace("\\", "/")
        sub_filter = f",subtitles='{rel_ass}'"

    if effect_preset == "blur_bg":
        filter_complex = (
            f"[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=28[bg];"
            f"[0:v]scale=1080:-2,eq=contrast=1.05:saturation=1.12[fg];"
            f"[bg][fg]overlay=(W-w)/2:(H-h)/2{sub_filter}[outv]"
        )
        cmd = [
            FFMPEG_EXE,
            "-y",
            "-ss",
            str(start),
            "-i",
            str(source_path),
            "-t",
            str(duration),
            "-filter_complex",
            filter_complex,
            "-map",
            "[outv]",
            "-map",
            "0:a?",
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "23",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            str(temp_body_path),
        ]
    elif effect_preset == "zoom_pop":
        vf_filter = (
            f"crop=ih*(9/16):ih:(iw-ih*(9/16))/2:0,"
            f"scale=w='trunc(1080*(1+0.07*min(t/{duration:.2f},1))/2)*2':h=-2:eval=frame,"
            f"crop=1080:1920:(iw-1080)/2:(ih-1920)/2,"
            f"eq=contrast=1.06:saturation=1.16,unsharp=5:5:0.7:5:5:0.0"
            f"{sub_filter}"
        )
        cmd = [
            FFMPEG_EXE,
            "-y",
            "-ss",
            str(start),
            "-i",
            str(source_path),
            "-t",
            str(duration),
            "-vf",
            vf_filter,
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "23",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            str(temp_body_path),
        ]
    else:
        vf_filter = f"crop=ih*(9/16):ih:(iw-ih*(9/16))/2:0,scale=1080:1920{sub_filter}"
        cmd = [
            FFMPEG_EXE,
            "-y",
            "-ss",
            str(start),
            "-i",
            str(source_path),
            "-t",
            str(duration),
            "-vf",
            vf_filter,
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "23",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            str(temp_body_path),
        ]

    res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"FFmpeg error: {res.stderr[-400:]}")

    if intro_clip_path and intro_clip_path.exists() and temp_body_path != output_path:
        try:
            prepend_intro_clip(intro_clip_path, temp_body_path, output_path)
            temp_body_path.unlink(missing_ok=True)
        except Exception as concat_err:
            log(f"      Intro stitch skipped ({concat_err}), keeping main clip...")
            shutil.move(str(temp_body_path), str(output_path))


def run_clipping_pipeline(
    job_id: str,
    youtube_url: str,
    enable_subtitles: bool = True,
    subtitle_style: str = "hormozi",
    effect_preset: str = "zoom_pop",
    creator_credit: str = "",
    intro_filename: str = "",
):
    job_dir = OUTPUT_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    intro_path = (OUTPUT_DIR / "intros" / intro_filename) if intro_filename else None

    try:
        update_job(job_id, status="downloading", progress=15)
        source_path, video_title, detected_credit = download_video(youtube_url, job_dir)
        final_credit = creator_credit.strip() or detected_credit
        update_job(job_id, video_title=video_title, progress=30)

        update_job(job_id, status="transcribing", progress=45)
        transcript, words = transcribe_video(job_id, source_path, job_dir)

        update_job(job_id, status="analyzing", progress=70)
        candidates = detect_viral_moments(transcript)

        update_job(job_id, status="rendering", progress=85)
        for idx, clip in enumerate(candidates, start=1):
            log(f"[4/4] Rendering clip {idx}/{len(candidates)} [{effect_preset}]: {clip.title}")
            clip_filename = f"clip_{idx}.mp4"
            clip_path = job_dir / clip_filename

            ass_path = None
            if enable_subtitles or final_credit:
                candidate_ass = job_dir / f"clip_{idx}.ass"
                sub_words = words if enable_subtitles else []
                if generate_ass_subtitles(
                    sub_words,
                    clip.start_time,
                    clip.end_time,
                    candidate_ass,
                    subtitle_style,
                    creator_credit=final_credit,
                ):
                    ass_path = candidate_ass

            render_vertical_clip(
                source_path,
                clip_path,
                clip.start_time,
                clip.end_time,
                ass_path=ass_path,
                effect_preset=effect_preset,
                intro_clip_path=intro_path,
            )

            public_url = f"/outputs/{job_id}/{clip_filename}"
            insert_clip(
                job_id=job_id,
                title=clip.title,
                viral_score=clip.viral_score,
                hook_reason=clip.hook_reason,
                start_time=clip.start_time,
                end_time=clip.end_time,
                local_file_path=public_url,
                creator_credit=final_credit,
            )

        log("[DONE] All viral clips generated!")
        update_job(job_id, status="completed", progress=100)

    except Exception as e:
        log(f"[ERROR] Pipeline failed: {e}")
        update_job(job_id, status="failed", error_message=str(e))