# ✂️ ClipDeck — AI Short-Form Video Clipping Studio

**ClipDeck** is a full-stack, local-first AI short-form video clipping suite built to transform long-form YouTube content into ready-to-post 9:16 vertical shorts (Reels, TikTok, YouTube Shorts) with automated hook detection, burned-in captions, creator attribution, and content scheduling.

> **Status:** Currently configured for local GPU execution (`localhost`) prior to cloud deployment.

---

## ✨ Key Features

### ⚙️ Automated AI Clipping & Rendering Pipeline
* **YouTube Video Ingestion:** Downloads source streams via `yt-dlp` and extracts video metadata automatically.
* **Word-Level Transcription:** Uses `faster-whisper` for accurate speech-to-text and word-level timing synchronization.
* **AI Viral Hook Scoring (0–100):** Evaluates transcript segments to identify and rank high-retention moments with detailed hook explanations.
* **9:16 Vertical Framing & Visual Grades:** Renders vertical exports via FFmpeg with selectable presets (*Retention Zoom + Contrast Grade*, *Full 16:9 + Blurred Backdrop*, or *Standard 9:16 Center Crop*).
* **Dynamic Burn-In Captions:** Supports toggleable burned-in subtitles in *Bold Highlight* or *Clean Minimal* styles.

### 🖥️ Web Studio & Creator Workflow
* **Clip-Safe Layer:** Auto-detects creator handles for on-screen attribution and supports prepending custom 3-second reaction intro clips.
* **Project History & Live Pipeline Monitor:** Tracks real-time 4-stage render progress (*Ingest $\rightarrow$ Transcript $\rightarrow$ Hook Score $\rightarrow$ 9:16 Export*) with search, status filtering, and permanent session deletion.
* **Storage Vault:** Browse, preview, sort (by retention score or timeline), and download exported `.mp4` shorts with one-click copy for titles, hook reasons, and creator credits.
* **Content Calendar:** Built-in planner to schedule and manage upcoming short-form drops across platforms.

---

## 🛠️ Tech Stack

| Layer | Technologies |
| :--- | :--- |
| **Frontend** | React, Vite, Tailwind CSS, Lucide Icons |
| **Backend** | Python, FastAPI, Uvicorn |
| **AI & Media** | Google Gemini API, Faster-Whisper, yt-dlp, FFmpeg |
| **Database** | Neon Serverless PostgreSQL (`psycopg2`) |

---

## 📂 Project Structure

```text
AIViralClipper/
├── backend/
│   ├── main.py             # FastAPI REST endpoints & static media serving
│   ├── pipeline.py         # yt-dlp, Whisper, Gemini hook scoring & FFmpeg rendering
│   ├── database.py         # Neon PostgreSQL connection & schema management
│   ├── requirements.txt    # Python dependencies
│   └── .env                # Environment variables (excluded from Git)
├── frontend/
│   ├── public/             # Static brand assets & favicon
│   ├── src/
│   │   ├── components/     # CalendarPage & StoragePage views
│   │   └── App.jsx         # Main Clipper Studio interface
│   └── package.json
└── start_clipdeck.bat      # One-click Windows local launcher
