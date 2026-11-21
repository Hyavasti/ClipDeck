import { useState, useEffect, useMemo } from "react";
import {
  Video,
  Loader2,
  Download,
  Play,
  CheckCircle2,
  AlertCircle,
  Flame,
  Clock,
  Film,
  Copy,
  Check,
  Search,
  ExternalLink,
  SlidersHorizontal,
  Subtitles,
  Palette,
  Calendar as CalendarIcon,
  Scissors,
  AtSign,
  Upload,
  ShieldCheck,
  FolderOpen,
  Trash2,
  Plus,
} from "lucide-react";
import CalendarPage from "./components/CalendarPage";
import StoragePage from "./components/StoragePage";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

const PIPELINE_STEPS = [
  { key: "downloading", label: "1. Ingest", pct: 15 },
  { key: "transcribing", label: "2. Transcript", pct: 45 },
  { key: "analyzing", label: "3. Hook Score", pct: 70 },
  { key: "rendering", label: "4. 9:16 Export", pct: 85 },
];

const STATUS_LABELS = {
  pending: "Queued in render pipeline...",
  downloading: "Downloading 720p source stream...",
  transcribing: "Extracting word-level timestamps...",
  analyzing: "Scoring high-retention segments...",
  rendering: "Burning captions, attribution & 9:16 framing...",
  completed: "Export complete",
  failed: "Render pipeline error",
};

function getYoutubeThumbnail(url) {
  if (!url) return null;
  const match = url.match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([a-zA-Z0-9_-]{11})/
  );
  return match ? `https://img.youtube.com/vi/${match[1]}/mqdefault.jpg` : null;
}

function ClipDeckLogo({ className = "w-8 h-8" }) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <rect width="64" height="64" rx="14" fill="#141417" />
      <rect
        x="1"
        y="1"
        width="62"
        height="62"
        rx="13"
        stroke="#27272A"
        strokeWidth="2"
      />
      <circle cx="19" cy="22" r="5" stroke="#F59E0B" strokeWidth="3.5" />
      <circle cx="19" cy="42" r="5" stroke="#F59E0B" strokeWidth="3.5" />
      <path
        d="M23.5 24.5L47 39"
        stroke="#F59E0B"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      <path
        d="M23.5 39.5L47 25"
        stroke="#F59E0B"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      <rect
        x="24"
        y="13"
        width="16"
        height="38"
        rx="2"
        stroke="#FFFFFF"
        strokeWidth="3.5"
      />
    </svg>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState("studio"); // "studio" | "calendar" | "storage"
  const [engineOnline, setEngineOnline] = useState(true);

  // Clipper Form States
  const [url, setUrl] = useState("");
  const [creatorCredit, setCreatorCredit] = useState("");
  const [enableSubtitles, setEnableSubtitles] = useState(true);
  const [subtitleStyle, setSubtitleStyle] = useState("hormozi");
  const [effectPreset, setEffectPreset] = useState("zoom_pop");
  const [introFilename, setIntroFilename] = useState("");
  const [introOriginalName, setIntroOriginalName] = useState("");
  const [uploadingIntro, setUploadingIntro] = useState(false);

  // Data States
  const [submitting, setSubmitting] = useState(false);
  const [jobs, setJobs] = useState([]);
  const [allClips, setAllClips] = useState([]);
  const [scheduledPosts, setScheduledPosts] = useState([]);
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [activeJob, setActiveJob] = useState(null);
  const [deletingJobId, setDeletingJobId] = useState(null);

  // Filter / Sort States
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState("score");
  const [copiedId, setCopiedId] = useState(null);

  const fetchAllData = async () => {
    try {
      const [jobsRes, clipsRes, schedRes] = await Promise.all([
        fetch(`${API_BASE}/api/jobs`),
        fetch(`${API_BASE}/api/clips`),
        fetch(`${API_BASE}/api/schedule`),
      ]);
      if (jobsRes.ok) {
        setEngineOnline(true);
        setJobs(await jobsRes.json());
      } else {
        setEngineOnline(false);
      }
      if (clipsRes.ok) setAllClips(await clipsRes.json());
      if (schedRes.ok) setScheduledPosts(await schedRes.json());
    } catch (err) {
      setEngineOnline(false);
      console.error("Failed to sync studio data:", err);
    }
  };

  const fetchJobDetails = async (jobId) => {
    if (!jobId) return;
    try {
      const res = await fetch(`${API_BASE}/api/jobs/${jobId}`);
      if (res.ok) {
        setActiveJob(await res.json());
      } else if (res.status === 404) {
        setActiveJob(null);
        setSelectedJobId(null);
      }
    } catch (err) {
      console.error("Failed to fetch job details:", err);
    }
  };

  useEffect(() => {
    fetchAllData();
    const syncInterval = setInterval(fetchAllData, 5000);
    return () => clearInterval(syncInterval);
  }, []);

  useEffect(() => {
    if (!selectedJobId) return;
    fetchJobDetails(selectedJobId);

    const interval = setInterval(() => {
      fetchAllData();
      fetchJobDetails(selectedJobId);
    }, 3000);

    return () => clearInterval(interval);
  }, [selectedJobId]);

  const handleClearWorkspace = () => {
    setSelectedJobId(null);
    setActiveJob(null);
    setUrl("");
  };

  const handleDeleteJob = async (e, jobId) => {
    e.stopPropagation();
    if (deletingJobId) return;
    setDeletingJobId(jobId);
    try {
      const res = await fetch(`${API_BASE}/api/jobs/${jobId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        if (selectedJobId === jobId) {
          setSelectedJobId(null);
          setActiveJob(null);
        }
        await fetchAllData();
      }
    } catch (err) {
      console.error("Failed to delete project:", err);
    } finally {
      setDeletingJobId(null);
    }
  };

  const handleIntroUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingIntro(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`${API_BASE}/api/intros`, {
        method: "POST",
        body: formData,
      });
      if (res.ok) {
        const data = await res.json();
        setIntroFilename(data.filename);
        setIntroOriginalName(data.original_name);
      }
    } catch (err) {
      console.error("Intro upload failed:", err);
    } finally {
      setUploadingIntro(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!url.trim() || submitting) return;

    const submittedUrl = url.trim();
    setSubmitting(true);
    setActiveJob({
      id: "new",
      youtube_url: submittedUrl,
      video_title: "Initializing new render session...",
      status: "pending",
      progress: 5,
      clips: [],
    });

    try {
      const res = await fetch(`${API_BASE}/api/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          youtube_url: submittedUrl,
          enable_subtitles: enableSubtitles,
          subtitle_style: subtitleStyle,
          effect_preset: effectPreset,
          creator_credit: creatorCredit.trim(),
          intro_filename: introFilename,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setUrl("");
        setSelectedJobId(data.job_id);
        await fetchAllData();
        await fetchJobDetails(data.job_id);
      }
    } catch (err) {
      console.error("Error starting job:", err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopy = (clipId, text) => {
    navigator.clipboard.writeText(text);
    setCopiedId(clipId);
    setTimeout(() => setCopiedId(null), 1800);
  };

  const formatTime = (sec) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const filteredJobs = useMemo(() => {
    return jobs.filter((job) => {
      const matchesQuery = (job.video_title || job.youtube_url)
        .toLowerCase()
        .includes(searchQuery.toLowerCase());
      const matchesStatus =
        statusFilter === "all"
          ? true
          : statusFilter === "processing"
          ? !["completed", "failed"].includes(job.status)
          : job.status === statusFilter;
      return matchesQuery && matchesStatus;
    });
  }, [jobs, searchQuery, statusFilter]);

  const sortedClips = useMemo(() => {
    if (!activeJob?.clips) return [];
    const copy = [...activeJob.clips];
    if (sortBy === "timeline") {
      return copy.sort((a, b) => a.start_time - b.start_time);
    }
    return copy.sort((a, b) => b.viral_score - a.viral_score);
  }, [activeJob, sortBy]);

  return (
    <div className="min-h-screen bg-[#0C0C0E] text-zinc-100 flex flex-col selection:bg-amber-500/25 overflow-x-hidden">
      {/* Responsive Studio Top Bar */}
      <header className="border-b border-zinc-800/90 bg-[#0C0C0E]/95 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-[1480px] mx-auto px-3.5 sm:px-6 py-2.5 md:py-0 md:h-14 flex flex-col md:flex-row md:items-center justify-between gap-2.5 md:gap-4">
          {/* Top Row on Mobile: Brand + Live Engine Status */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5 sm:gap-3">
              <ClipDeckLogo className="w-7 h-7 sm:w-8 sm:h-8 shrink-0" />
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm tracking-tight text-white">
                  ClipDeck
                </span>
                <span className="text-[11px] font-mono text-zinc-500 hidden sm:inline">
                  / 9:16 Short-Form Suite
                </span>
              </div>
            </div>

            {/* Mobile Engine Indicator */}
            <div className="flex md:hidden items-center gap-1.5 text-[10px] font-mono text-zinc-400 bg-[#141417] border border-zinc-800 px-2 py-1 rounded-md">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  engineOnline ? "bg-emerald-400" : "bg-rose-500"
                }`}
              />
              {engineOnline ? "ONLINE" : "OFFLINE"}
            </div>
          </div>

          {/* Workspace Switcher (Full-width equal tabs on mobile) */}
          <nav className="grid grid-cols-3 md:flex items-center bg-[#141417] border border-zinc-800 rounded-lg p-1 w-full md:w-auto">
            <button
              type="button"
              onClick={() => setActiveTab("studio")}
              className={`px-2 sm:px-3.5 py-1.5 rounded-md text-[11px] sm:text-xs font-medium flex items-center justify-center gap-1.5 transition cursor-pointer ${
                activeTab === "studio"
                  ? "bg-zinc-800 text-white shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <Scissors className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Studio</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("calendar")}
              className={`px-2 sm:px-3.5 py-1.5 rounded-md text-[11px] sm:text-xs font-medium flex items-center justify-center gap-1.5 transition cursor-pointer ${
                activeTab === "calendar"
                  ? "bg-zinc-800 text-white shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <CalendarIcon className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Calendar</span>
              {scheduledPosts.length > 0 && (
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-400">
                  {scheduledPosts.length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("storage")}
              className={`px-2 sm:px-3.5 py-1.5 rounded-md text-[11px] sm:text-xs font-medium flex items-center justify-center gap-1.5 transition cursor-pointer ${
                activeTab === "storage"
                  ? "bg-zinc-800 text-white shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <FolderOpen className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Storage</span>
              {allClips.length > 0 && (
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-zinc-700 text-zinc-200">
                  {allClips.length}
                </span>
              )}
            </button>
          </nav>

          {/* Desktop Engine Status Indicator */}
          <div className="hidden md:flex items-center gap-2 text-[11px] font-mono text-zinc-400">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                engineOnline ? "bg-emerald-400" : "bg-rose-500"
              }`}
            />
            {engineOnline ? "LOCAL ENGINE ONLINE" : "LOCAL ENGINE OFFLINE"}
          </div>
        </div>
      </header>

      {/* Page Router */}
      <main className="max-w-[1480px] w-full mx-auto px-3.5 sm:px-6 py-4 sm:py-6 flex-1">
        {activeTab === "calendar" ? (
          <CalendarPage
            apiBase={API_BASE}
            allClips={allClips}
            scheduledPosts={scheduledPosts}
            onRefresh={fetchAllData}
          />
        ) : activeTab === "storage" ? (
          <StoragePage
            apiBase={API_BASE}
            allClips={allClips}
            scheduledPosts={scheduledPosts}
            onRefresh={fetchAllData}
            onGoToCalendar={() => setActiveTab("calendar")}
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6">
            {/* Left Inspector Panel */}
            <aside className="lg:col-span-4 xl:col-span-3 space-y-4 sm:space-y-5">
              <form
                onSubmit={handleSubmit}
                className="bg-[#141417] border border-zinc-800 rounded-xl p-3.5 sm:p-4 space-y-4"
              >
                <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2.5">
                  <span className="text-xs font-semibold text-zinc-200">
                    Source & Export Settings
                  </span>
                  {activeJob && (
                    <button
                      type="button"
                      onClick={handleClearWorkspace}
                      className="text-[11px] font-medium text-amber-400 hover:text-amber-300 flex items-center gap-1 cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                      New Session
                    </button>
                  )}
                </div>

                {/* YouTube URL */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium text-zinc-400">
                    YouTube Source Link
                  </label>
                  <div className="relative">
                    <Video className="w-4 h-4 text-zinc-500 absolute left-3 top-2.5" />
                    <input
                      type="url"
                      required
                      placeholder="https://youtube.com/watch?v=..."
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      className="w-full bg-[#0C0C0E] border border-zinc-800 rounded-lg pl-9 pr-3 py-2 text-xs placeholder:text-zinc-600 focus:outline-none focus:border-amber-500 transition"
                    />
                  </div>
                </div>

                {/* Clip-Safe Attribution & Intro Hook */}
                <div className="bg-[#0C0C0E] border border-zinc-800/90 rounded-lg p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-zinc-300 flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                      Clip-Safe Layer
                    </span>
                    <span className="text-[10px] font-mono text-zinc-500">
                      Attribution + Hook
                    </span>
                  </div>

                  <div className="relative">
                    <AtSign className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-2.5" />
                    <input
                      type="text"
                      placeholder="Creator handle (auto-detected if blank)"
                      value={creatorCredit}
                      onChange={(e) => setCreatorCredit(e.target.value)}
                      className="w-full bg-[#141417] border border-zinc-800 rounded-md pl-8 pr-2.5 py-1.5 text-[11px] placeholder:text-zinc-600 focus:outline-none focus:border-amber-500"
                    />
                  </div>

                  <div>
                    <label className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md bg-[#141417] border border-dashed border-zinc-700 hover:border-zinc-500 text-[11px] text-zinc-400 cursor-pointer transition">
                      <span className="truncate">
                        {uploadingIntro
                          ? "Uploading intro clip..."
                          : introOriginalName
                          ? `Intro: ${introOriginalName}`
                          : "Optional: Prepend 3s reaction intro"}
                      </span>
                      <Upload className="w-3.5 h-3.5 shrink-0 text-zinc-300" />
                      <input
                        type="file"
                        accept="video/*"
                        onChange={handleIntroUpload}
                        className="hidden"
                      />
                    </label>
                    {introFilename && (
                      <button
                        type="button"
                        onClick={() => {
                          setIntroFilename("");
                          setIntroOriginalName("");
                        }}
                        className="text-[10px] text-rose-400 hover:underline mt-1 cursor-pointer"
                      >
                        Remove intro clip
                      </button>
                    )}
                  </div>
                </div>

                {/* Auto-Captions */}
                <div className="bg-[#0C0C0E] border border-zinc-800/90 rounded-lg p-3 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-zinc-200 flex items-center gap-1.5">
                      <Subtitles className="w-3.5 h-3.5 text-amber-400" />
                      Burn-In Captions
                    </span>
                    <button
                      type="button"
                      onClick={() => setEnableSubtitles(!enableSubtitles)}
                      className={`w-8 h-4.5 rounded-full transition p-0.5 cursor-pointer ${
                        enableSubtitles ? "bg-amber-500" : "bg-zinc-700"
                      }`}
                    >
                      <div
                        className={`w-3.5 h-3.5 rounded-full bg-zinc-950 transition-transform ${
                          enableSubtitles ? "translate-x-3.5" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>

                  {enableSubtitles && (
                    <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                      {[
                        { id: "hormozi", label: "Bold Highlight" },
                        { id: "minimal", label: "Clean Minimal" },
                      ].map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => setSubtitleStyle(s.id)}
                          className={`text-[11px] font-medium py-1.5 px-2 rounded border transition cursor-pointer ${
                            subtitleStyle === s.id
                              ? "bg-zinc-800 border-zinc-600 text-white"
                              : "bg-[#141417] border-zinc-800 text-zinc-400 hover:text-zinc-200"
                          }`}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Framing & Visual Grade */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium text-zinc-400 flex items-center gap-1.5">
                    <Palette className="w-3.5 h-3.5 text-zinc-400" />
                    Framing & Color Grade
                  </label>
                  <select
                    value={effectPreset}
                    onChange={(e) => setEffectPreset(e.target.value)}
                    className="w-full bg-[#0C0C0E] border border-zinc-800 rounded-lg px-2.5 py-2 text-xs text-zinc-200 focus:outline-none focus:border-amber-500 cursor-pointer"
                  >
                    <option value="zoom_pop">
                      Retention Zoom + Contrast Grade
                    </option>
                    <option value="blur_bg">
                      Full 16:9 + Blurred Backdrop
                    </option>
                    <option value="clean">Standard 9:16 Center Crop</option>
                  </select>
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full bg-zinc-100 hover:bg-white disabled:opacity-50 text-zinc-950 font-semibold py-2.5 px-4 rounded-lg text-xs flex items-center justify-center gap-2 transition cursor-pointer"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Queuing Render...
                    </>
                  ) : (
                    <>
                      <Scissors className="w-3.5 h-3.5" />
                      Extract & Render Shorts
                    </>
                  )}
                </button>
              </form>

              {/* Project Library */}
              <div className="bg-[#141417] border border-zinc-800 rounded-xl p-3.5 sm:p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
                    <Film className="w-3.5 h-3.5 text-zinc-400" />
                    Project History ({jobs.length})
                  </h2>
                </div>

                <div className="space-y-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-2" />
                    <input
                      type="text"
                      placeholder="Filter projects..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full bg-[#0C0C0E] border border-zinc-800 rounded-lg pl-8 pr-2.5 py-1.5 text-xs placeholder:text-zinc-600 focus:outline-none focus:border-zinc-700"
                    />
                  </div>

                  <div className="flex gap-1 bg-[#0C0C0E] p-1 rounded-lg border border-zinc-800">
                    {[
                      { id: "all", label: "All" },
                      { id: "completed", label: "Ready" },
                      { id: "failed", label: "Failed" },
                    ].map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setStatusFilter(tab.id)}
                        className={`flex-1 text-[11px] font-medium py-1 rounded transition cursor-pointer ${
                          statusFilter === tab.id
                            ? "bg-zinc-800 text-white"
                            : "text-zinc-500 hover:text-zinc-300"
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                </div>

                {filteredJobs.length === 0 ? (
                  <p className="text-xs text-zinc-500 py-6 text-center">
                    No matching projects.
                  </p>
                ) : (
                  <div className="space-y-1.5 max-h-[260px] lg:max-h-[380px] overflow-y-auto pr-1">
                    {filteredJobs.map((job) => {
                      const thumb = getYoutubeThumbnail(job.youtube_url);
                      const isSelected = selectedJobId === job.id;
                      return (
                        <div
                          key={job.id}
                          onClick={() => setSelectedJobId(job.id)}
                          className={`w-full text-left p-2 rounded-lg border transition flex items-center gap-2.5 cursor-pointer group ${
                            isSelected
                              ? "bg-zinc-800/90 border-zinc-600"
                              : "bg-[#0C0C0E]/70 border-zinc-800/80 hover:border-zinc-700"
                          }`}
                        >
                          <div className="w-14 h-9 rounded bg-zinc-900 border border-zinc-800 overflow-hidden shrink-0">
                            {thumb ? (
                              <img
                                src={thumb}
                                alt=""
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <Film className="w-3.5 h-3.5 text-zinc-600" />
                              </div>
                            )}
                          </div>

                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium text-zinc-100 truncate">
                              {job.video_title || job.youtube_url}
                            </p>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              {job.status === "completed" ? (
                                <span className="inline-flex items-center gap-1 text-[10px] font-mono text-emerald-400">
                                  <CheckCircle2 className="w-2.5 h-2.5" /> READY
                                </span>
                              ) : job.status === "failed" ? (
                                <span className="inline-flex items-center gap-1 text-[10px] font-mono text-rose-400">
                                  <AlertCircle className="w-2.5 h-2.5" /> FAILED
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[10px] font-mono text-amber-400">
                                  <Loader2 className="w-2.5 h-2.5 animate-spin" />{" "}
                                  {job.progress}%
                                </span>
                              )}
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={(e) => handleDeleteJob(e, job.id)}
                            disabled={deletingJobId === job.id}
                            title="Delete Session Permanently"
                            className="p-1.5 rounded-md text-zinc-500 hover:text-rose-400 hover:bg-rose-950/60 opacity-90 sm:opacity-75 group-hover:opacity-100 transition shrink-0 cursor-pointer"
                          >
                            {deletingJobId === job.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </aside>

            {/* Right Studio Timeline & Output Grid */}
            <section className="lg:col-span-8 xl:col-span-9 min-w-0">
              {!activeJob ? (
                <div className="h-full min-h-[260px] sm:min-h-[480px] border border-dashed border-zinc-800 rounded-2xl bg-[#141417]/50 flex flex-col items-center justify-center text-center p-6 sm:p-10">
                  <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-3.5 sm:mb-4">
                    <Play className="w-5 h-5 text-zinc-300" />
                  </div>
                  <h3 className="text-sm sm:text-base font-semibold text-zinc-200">
                    Ready for a New Video
                  </h3>
                  <p className="text-xs text-zinc-400 max-w-md mt-1.5 leading-relaxed">
                    Paste a creator video URL above to extract viral hooks, burn
                    captions + creator credit, and export 9:16 shorts—or select
                    any past session from Project History.
                  </p>
                </div>
              ) : (
                <div className="space-y-4 sm:space-y-6">
                  {/* Active Project Monitor */}
                  <div className="bg-[#141417] border border-zinc-800 rounded-xl p-3.5 sm:p-5">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 sm:gap-4">
                      <div className="flex items-start gap-3 sm:gap-3.5 min-w-0">
                        {getYoutubeThumbnail(activeJob.youtube_url) && (
                          <img
                            src={getYoutubeThumbnail(activeJob.youtube_url)}
                            alt=""
                            className="w-20 h-12 sm:w-24 sm:h-14 rounded-lg object-cover border border-zinc-800 shrink-0"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <h2 className="text-sm sm:text-base font-semibold text-white line-clamp-2 sm:truncate">
                            {activeJob.video_title ||
                              "Loading video metadata..."}
                          </h2>
                          <a
                            href={activeJob.youtube_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 mt-1 transition max-w-full"
                          >
                            <span className="truncate font-mono text-[11px]">
                              {activeJob.youtube_url}
                            </span>
                            <ExternalLink className="w-3 h-3 shrink-0" />
                          </a>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={handleClearWorkspace}
                          className="bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-700 text-xs font-medium px-2.5 sm:px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          New Session
                        </button>
                        {activeJob.status === "completed" && (
                          <button
                            type="button"
                            onClick={() => setActiveTab("calendar")}
                            className="bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-xs px-2.5 sm:px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition cursor-pointer"
                          >
                            <CalendarIcon className="w-3.5 h-3.5" />
                            Schedule
                          </button>
                        )}
                        <span
                          className={`text-xs font-mono px-2.5 py-1.5 rounded-lg border ${
                            activeJob.status === "completed"
                              ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
                              : activeJob.status === "failed"
                              ? "bg-rose-500/10 text-rose-300 border-rose-500/30"
                              : "bg-zinc-900 text-zinc-300 border-zinc-700"
                          }`}
                        >
                          {activeJob.status === "completed"
                            ? `${sortedClips.length} CLIPS`
                            : `${activeJob.progress}%`}
                        </span>
                      </div>
                    </div>

                    {/* 4-Stage Pipeline Bar */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
                      {PIPELINE_STEPS.map((step) => {
                        const isDone =
                          activeJob.status === "completed" ||
                          activeJob.progress > step.pct;
                        const isCurrent =
                          activeJob.status !== "completed" &&
                          activeJob.status !== "failed" &&
                          activeJob.status === step.key;

                        return (
                          <div
                            key={step.key}
                            className={`px-2.5 sm:px-3 py-2 rounded-lg border flex items-center justify-between text-[11px] sm:text-xs font-mono ${
                              isDone
                                ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-300"
                                : isCurrent
                                ? "bg-amber-500/10 border-amber-500/40 text-amber-300"
                                : "bg-[#0C0C0E] border-zinc-800 text-zinc-500"
                            }`}
                          >
                            <span className="truncate">{step.label}</span>
                            {isCurrent ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                            ) : isDone ? (
                              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                            ) : null}
                          </div>
                        );
                      })}
                    </div>

                    <div className="w-full h-1 bg-[#0C0C0E] rounded-full overflow-hidden mt-3">
                      <div
                        className={`h-full transition-all duration-500 ${
                          activeJob.status === "failed"
                            ? "bg-rose-500"
                            : activeJob.status === "completed"
                            ? "bg-emerald-500"
                            : "bg-amber-500"
                        }`}
                        style={{ width: `${activeJob.progress}%` }}
                      />
                    </div>

                    <p className="text-[11px] font-mono text-zinc-400 mt-2">
                      {STATUS_LABELS[activeJob.status] || activeJob.status}
                    </p>

                    {activeJob.error_message && (
                      <div className="mt-3 p-3 rounded-lg bg-rose-950/30 border border-rose-500/30 text-xs text-rose-300 break-words">
                        {activeJob.error_message}
                      </div>
                    )}
                  </div>

                  {/* Exported Clips Grid */}
                  {sortedClips.length > 0 && (
                    <div className="space-y-3.5 sm:space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                          Exported Shorts ({sortedClips.length})
                        </h3>

                        <div className="flex items-center gap-2">
                          <SlidersHorizontal className="w-3.5 h-3.5 text-zinc-500" />
                          <select
                            value={sortBy}
                            onChange={(e) => setSortBy(e.target.value)}
                            className="bg-[#141417] border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-amber-500 cursor-pointer"
                          >
                            <option value="score">Sort: Retention Score</option>
                            <option value="timeline">Sort: Timeline</option>
                          </select>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-5">
                        {sortedClips.map((clip, idx) => {
                          const durationSec = Math.max(
                            1,
                            Math.round(clip.end_time - clip.start_time)
                          );
                          return (
                            <div
                              key={clip.id}
                              className="bg-[#141417] border border-zinc-800 hover:border-zinc-700 rounded-xl overflow-hidden flex flex-col transition"
                            >
                              <div className="relative bg-black aspect-[9/16] max-h-[380px] sm:max-h-[430px] w-full flex items-center justify-center overflow-hidden">
                                <video
                                  src={`${API_BASE}${clip.local_file_path}`}
                                  controls
                                  playsInline
                                  preload="metadata"
                                  className="h-full w-full object-contain"
                                />

                                <div className="pointer-events-none absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between">
                                  <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded bg-black/80 text-white border border-white/10">
                                    #{idx + 1}
                                  </span>
                                  <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-black/80 text-zinc-200 border border-white/10">
                                    {durationSec}s
                                  </span>
                                </div>
                              </div>

                              <div className="p-3.5 sm:p-4 flex-1 flex flex-col justify-between space-y-3.5">
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="inline-flex items-center gap-1 text-xs font-mono font-semibold px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/25">
                                      <Flame className="w-3 h-3" />
                                      {clip.viral_score}/100
                                    </span>
                                    <span className="inline-flex items-center gap-1 text-[11px] font-mono text-zinc-400">
                                      <Clock className="w-3 h-3 text-zinc-500" />
                                      {formatTime(clip.start_time)}–
                                      {formatTime(clip.end_time)}
                                    </span>
                                  </div>

                                  <h4 className="font-semibold text-sm text-zinc-100 leading-snug">
                                    {clip.title}
                                  </h4>

                                  <p className="text-xs text-zinc-400 leading-relaxed bg-[#0C0C0E] p-2.5 rounded-lg border border-zinc-800/80">
                                    {clip.hook_reason}
                                  </p>
                                </div>

                                <div className="flex items-center gap-2 pt-1">
                                  <a
                                    href={`${API_BASE}${clip.local_file_path}`}
                                    download={`${clip.title.replace(
                                      /[^a-z0-9]/gi,
                                      "_"
                                    )}.mp4`}
                                    className="flex-1 bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-semibold py-2.5 sm:py-2 px-3 rounded-lg flex items-center justify-center gap-1.5 transition"
                                  >
                                    <Download className="w-3.5 h-3.5" />
                                    Download MP4
                                  </a>

                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleCopy(
                                        clip.id,
                                        `${clip.title}\n\n${clip.hook_reason}${
                                          clip.creator_credit
                                            ? `\n\nCredit: ${clip.creator_credit}`
                                            : ""
                                        }`
                                      )
                                    }
                                    title="Copy Title, Hook & Credit"
                                    className="p-2.5 sm:p-2 rounded-lg bg-[#0C0C0E] hover:bg-zinc-800 text-zinc-300 border border-zinc-800 transition cursor-pointer"
                                  >
                                    {copiedId === clip.id ? (
                                      <Check className="w-4 h-4 text-emerald-400" />
                                    ) : (
                                      <Copy className="w-4 h-4" />
                                    )}
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}