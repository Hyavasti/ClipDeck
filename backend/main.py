import os
import shutil
import uuid
from pathlib import Path
from fastapi import FastAPI, BackgroundTasks, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from dotenv import load_dotenv
from database import (
create_job,
    get_all_jobs,
    get_job_with_clips,
    delete_job,
    get_all_clips,
    delete_clip,
    get_scheduled_posts,
    create_scheduled_post,
    update_scheduled_post_status,
    delete_scheduled_post,
    auto_schedule_unscheduled_clips,
)
from pipeline import run_clipping_pipeline

load_dotenv()

app = FastAPI(title="ClipDeck Studio API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", "./outputs"))
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
INTROS_DIR = OUTPUT_DIR / "intros"
INTROS_DIR.mkdir(parents=True, exist_ok=True)

app.mount("/outputs", StaticFiles(directory=str(OUTPUT_DIR)), name="outputs")


class JobCreateRequest(BaseModel):
    youtube_url: str
    enable_subtitles: bool = True
    subtitle_style: str = "hormozi"
    effect_preset: str = "zoom_pop"
    creator_credit: str = ""
    intro_filename: str = ""


class ScheduleCreateRequest(BaseModel):
    clip_id: str
    platform: str
    scheduled_date: str
    slot_label: str
    post_time: str
    caption: str


class ScheduleStatusRequest(BaseModel):
    status: str


class AutoScheduleRequest(BaseModel):
    start_date: str | None = None


@app.post("/api/jobs")
def start_job(req: JobCreateRequest, background_tasks: BackgroundTasks):
    if not req.youtube_url.strip():
        raise HTTPException(status_code=400, detail="YouTube URL is required")
    job_id = create_job(req.youtube_url.strip())
    background_tasks.add_task(
        run_clipping_pipeline,
        job_id,
        req.youtube_url.strip(),
        req.enable_subtitles,
        req.subtitle_style,
        req.effect_preset,
        req.creator_credit,
        req.intro_filename,
    )
    return {"job_id": job_id, "status": "pending"}


@app.get("/api/jobs")
def list_jobs():
    return get_all_jobs()


@app.get("/api/jobs/{job_id}")
def job_details(job_id: str):
    job = get_job_with_clips(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@app.get("/api/clips")
def list_all_clips():
    return get_all_clips()


@app.post("/api/intros")
async def upload_intro_clip(file: UploadFile = File(...)):
    ext = Path(file.filename or "intro.mp4").suffix.lower()
    if ext not in {".mp4", ".mov", ".webm", ".mkv"}:
        raise HTTPException(status_code=400, detail="Upload an MP4, MOV, or WebM video")
    safe_name = f"intro_{uuid.uuid4().hex[:8]}{ext}"
    dest = INTROS_DIR / safe_name
    with dest.open("wb") as buf:
        shutil.copyfileobj(file.file, buf)
    return {"filename": safe_name, "original_name": file.filename}


@app.get("/api/schedule")
def list_schedule():
    return get_scheduled_posts()


@app.post("/api/schedule")
def add_schedule_item(req: ScheduleCreateRequest):
    post_id = create_scheduled_post(
        clip_id=req.clip_id,
        platform=req.platform,
        scheduled_date=req.scheduled_date,
        slot_label=req.slot_label,
        post_time=req.post_time,
        caption=req.caption,
    )
    return {"id": post_id, "status": "scheduled"}


@app.post("/api/schedule/auto")
def run_auto_schedule(req: AutoScheduleRequest):
    count = auto_schedule_unscheduled_clips(req.start_date)
    return {"scheduled_count": count}


@app.patch("/api/schedule/{post_id}")
def patch_schedule_status(post_id: str, req: ScheduleStatusRequest):
    update_scheduled_post_status(post_id, req.status)
    return {"id": post_id, "status": req.status}


@app.delete("/api/schedule/{post_id}")
def remove_schedule_item(post_id: str):
    delete_scheduled_post(post_id)
    return {"deleted": True}

@app.delete("/api/clips/{clip_id}")
def remove_clip(clip_id: str):
    rel_path = delete_clip(clip_id)
    if not rel_path:
        raise HTTPException(status_code=404, detail="Clip not found")
    # Also remove the local MP4 file from outputs/ if it exists
    file_path = OUTPUT_DIR / rel_path.removeprefix("/outputs/")
    file_path.unlink(missing_ok=True)
    return {"deleted": True}

@app.delete("/api/jobs/{job_id}")
def remove_job(job_id: str):
    if not delete_job(job_id):
        raise HTTPException(status_code=404, detail="Job not found")
    job_dir = OUTPUT_DIR / job_id
    if job_dir.exists() and job_dir.is_dir():
        shutil.rmtree(job_dir, ignore_errors=True)
    return {"deleted": True}