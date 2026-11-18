import os
import uuid
from datetime import datetime, timedelta
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")


def get_conn():
    return psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)


def init_db():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY,
                    youtube_url TEXT NOT NULL,
                    video_title TEXT,
                    status TEXT NOT NULL DEFAULT 'pending',
                    progress INTEGER NOT NULL DEFAULT 0,
                    error_message TEXT,
                    created_at TIMESTAMP DEFAULT NOW()
                );
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS clips (
                    id TEXT PRIMARY KEY,
                    job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE,
                    title TEXT NOT NULL,
                    viral_score INTEGER NOT NULL,
                    hook_reason TEXT,
                    start_time REAL NOT NULL,
                    end_time REAL NOT NULL,
                    local_file_path TEXT NOT NULL,
                    creator_credit TEXT,
                    created_at TIMESTAMP DEFAULT NOW()
                );
            """)
            cur.execute("""
                ALTER TABLE clips
                ADD COLUMN IF NOT EXISTS creator_credit TEXT;
            """)
            # Match clips.id column type (UUID vs TEXT) so foreign key always succeeds
            cur.execute("""
                SELECT data_type FROM information_schema.columns
                WHERE table_name = 'clips' AND column_name = 'id';
            """)
            col_row = cur.fetchone()
            clip_id_type = "UUID" if (col_row and col_row["data_type"] == "uuid") else "TEXT"

            cur.execute(f"""
                CREATE TABLE IF NOT EXISTS scheduled_posts (
                    id TEXT PRIMARY KEY,
                    clip_id {clip_id_type} REFERENCES clips(id) ON DELETE CASCADE,
                    platform TEXT NOT NULL,
                    scheduled_date TEXT NOT NULL,
                    slot_label TEXT NOT NULL,
                    post_time TEXT NOT NULL,
                    caption TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'scheduled',
                    created_at TIMESTAMP DEFAULT NOW()
                );
            """)
        conn.commit()


def create_job(youtube_url: str) -> str:
    job_id = str(uuid.uuid4())
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO jobs (id, youtube_url, status, progress) VALUES (%s, %s, 'pending', 5)",
                (job_id, youtube_url),
            )
        conn.commit()
    return job_id


def update_job(
    job_id: str,
    status: str | None = None,
    progress: int | None = None,
    video_title: str | None = None,
    error_message: str | None = None,
):
    fields = []
    values = []
    if status is not None:
        fields.append("status = %s")
        values.append(status)
    if progress is not None:
        fields.append("progress = %s")
        values.append(progress)
    if video_title is not None:
        fields.append("video_title = %s")
        values.append(video_title)
    if error_message is not None:
        fields.append("error_message = %s")
        values.append(error_message)

    if not fields:
        return

    values.append(job_id)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(f"UPDATE jobs SET {', '.join(fields)} WHERE id = %s", tuple(values))
        conn.commit()


def insert_clip(
    job_id: str,
    title: str,
    viral_score: int,
    hook_reason: str,
    start_time: float,
    end_time: float,
    local_file_path: str,
    creator_credit: str = "",
) -> str:
    clip_id = str(uuid.uuid4())
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO clips (
                    id, job_id, title, viral_score, hook_reason,
                    start_time, end_time, local_file_path, creator_credit
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    clip_id,
                    job_id,
                    title,
                    viral_score,
                    hook_reason,
                    start_time,
                    end_time,
                    local_file_path,
                    creator_credit,
                ),
            )
        conn.commit()
    return clip_id


def get_all_jobs():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM jobs ORDER BY created_at DESC LIMIT 30")
            return cur.fetchall()


def get_job_with_clips(job_id: str):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM jobs WHERE id = %s", (job_id,))
            job = cur.fetchone()
            if not job:
                return None
            cur.execute(
                "SELECT * FROM clips WHERE job_id = %s ORDER BY viral_score DESC",
                (job_id,),
            )
            job["clips"] = cur.fetchall()
            return job


def get_all_clips():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT c.*, j.video_title, j.youtube_url
                FROM clips c
                JOIN jobs j ON c.job_id = j.id
                ORDER BY c.created_at DESC
            """)
            return cur.fetchall()


def get_scheduled_posts():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT sp.*, c.title AS clip_title, c.viral_score,
                       c.local_file_path, c.start_time, c.end_time,
                       c.creator_credit, j.video_title
                FROM scheduled_posts sp
                JOIN clips c ON sp.clip_id = c.id
                JOIN jobs j ON c.job_id = j.id
                ORDER BY sp.scheduled_date ASC, sp.post_time ASC
            """)
            return cur.fetchall()


def create_scheduled_post(
    clip_id: str,
    platform: str,
    scheduled_date: str,
    slot_label: str,
    post_time: str,
    caption: str,
) -> str:
    post_id = str(uuid.uuid4())
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO scheduled_posts (
                    id, clip_id, platform, scheduled_date, slot_label, post_time, caption, status
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, 'scheduled')
                """,
                (post_id, clip_id, platform, scheduled_date, slot_label, post_time, caption),
            )
        conn.commit()
    return post_id


def update_scheduled_post_status(post_id: str, status: str):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE scheduled_posts SET status = %s WHERE id = %s",
                (status, post_id),
            )
        conn.commit()


def delete_scheduled_post(post_id: str):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM scheduled_posts WHERE id = %s", (post_id,))
        conn.commit()


def auto_schedule_unscheduled_clips(start_date_str: str | None = None) -> int:
    DAILY_SLOTS = [
        {"slot_label": "Slot 1 • Lunch Peak", "post_time": "12:30 PM", "platform": "TikTok"},
        {"slot_label": "Slot 2 • Commute Rush", "post_time": "05:30 PM", "platform": "Facebook Reels"},
        {"slot_label": "Slot 3 • Prime Night", "post_time": "09:00 PM", "platform": "TikTok + FB Reels"},
    ]

    base_date = (
        datetime.strptime(start_date_str, "%Y-%m-%d").date()
        if start_date_str
        else datetime.now().date()
    )

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT c.*, j.video_title, j.youtube_url
                FROM clips c
                JOIN jobs j ON c.job_id = j.id
                WHERE c.id NOT IN (SELECT clip_id FROM scheduled_posts)
                ORDER BY c.viral_score DESC, c.created_at DESC
            """)
            unscheduled = cur.fetchall()

            if not unscheduled:
                return 0

            cur.execute("SELECT scheduled_date, slot_label FROM scheduled_posts")
            taken = {(row["scheduled_date"], row["slot_label"]) for row in cur.fetchall()}

            created_count = 0
            day_offset = 0
            for clip in unscheduled:
                placed = False
                while not placed and day_offset < 60:
                    target_date = (base_date + timedelta(days=day_offset)).strftime("%Y-%m-%d")
                    for slot in DAILY_SLOTS:
                        key = (target_date, slot["slot_label"])
                        if key not in taken:
                            taken.add(key)
                            credit_line = (
                                f"\n\nCredit: {clip['creator_credit']} | Full video on YouTube"
                                if clip.get("creator_credit")
                                else "\n\nFull video on YouTube"
                            )
                            tags = (
                                "#fyp #viral #shorts #clips #trending"
                                if "TikTok" in slot["platform"]
                                else "#reels #fb #viral #clips #trending"
                            )
                            caption = f"{clip['title']}\n\n{clip.get('hook_reason', '')}{credit_line}\n{tags}"

                            cur.execute(
                                """
                                INSERT INTO scheduled_posts (
                                    id, clip_id, platform, scheduled_date, slot_label, post_time, caption, status
                                )
                                VALUES (%s, %s, %s, %s, %s, %s, %s, 'scheduled')
                                """,
                                (
                                    str(uuid.uuid4()),
                                    clip["id"],
                                    slot["platform"],
                                    target_date,
                                    slot["slot_label"],
                                    slot["post_time"],
                                    caption,
                                ),
                            )
                            created_count += 1
                            placed = True
                            break
                    if not placed:
                        day_offset += 1

        conn.commit()
    return created_count

def delete_clip(clip_id: str) -> str | None:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT local_file_path FROM clips WHERE id = %s", (clip_id,))
            row = cur.fetchone()
            if not row:
                return None
            cur.execute("DELETE FROM clips WHERE id = %s", (clip_id,))
        conn.commit()
    return row["local_file_path"]

def delete_job(job_id: str) -> bool:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM jobs WHERE id = %s RETURNING id", (job_id,))
            deleted = cur.fetchone()
        conn.commit()
    return deleted is not None

init_db()