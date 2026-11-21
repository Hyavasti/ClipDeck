import { useState, useMemo } from "react";
import {
  FolderOpen,
  ExternalLink,
  Download,
  Copy,
  Check,
  Trash2,
  Search,
  Flame,
  Clock,
  ChevronDown,
  ChevronRight,
  Film,
  CalendarPlus,
} from "lucide-react";

function getYoutubeThumbnail(url) {
  if (!url) return null;
  const match = url.match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([a-zA-Z0-9_-]{11})/
  );
  return match ? `https://img.youtube.com/vi/${match[1]}/mqdefault.jpg` : null;
}

function normalizeYoutubeKey(url) {
  if (!url) return "unknown";
  const match = url.match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([a-zA-Z0-9_-]{11})/
  );
  return match ? match[1] : url.trim();
}

export default function StoragePage({
  apiBase,
  allClips,
  scheduledPosts,
  onRefresh,
  onGoToCalendar,
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState({});
  const [copiedId, setCopiedId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const scheduledClipIds = useMemo(
    () => new Set(scheduledPosts.map((p) => p.clip_id)),
    [scheduledPosts]
  );

  // Group all clips by their source YouTube URL
  const groupedSources = useMemo(() => {
    const groupsMap = new Map();

    for (const clip of allClips) {
      const key = normalizeYoutubeKey(clip.youtube_url);
      if (!groupsMap.has(key)) {
        groupsMap.set(key, {
          key,
          youtube_url: clip.youtube_url,
          video_title: clip.video_title || clip.youtube_url,
          creator_credit: clip.creator_credit || "",
          thumbnail: getYoutubeThumbnail(clip.youtube_url),
          clips: [],
          latestCreated: clip.created_at,
        });
      }
      const group = groupsMap.get(key);
      group.clips.push(clip);
      if (!group.creator_credit && clip.creator_credit) {
        group.creator_credit = clip.creator_credit;
      }
    }

    const q = searchQuery.toLowerCase().trim();
    const list = Array.from(groupsMap.values())
      .map((group) => ({
        ...group,
        clips: [...group.clips].sort((a, b) => b.viral_score - a.viral_score),
      }))
      .filter((group) => {
        if (!q) return true;
        const matchesSource =
          group.video_title.toLowerCase().includes(q) ||
          group.youtube_url.toLowerCase().includes(q) ||
          group.creator_credit.toLowerCase().includes(q);
        const matchesClip = group.clips.some((c) =>
          c.title.toLowerCase().includes(q)
        );
        return matchesSource || matchesClip;
      });

    return list;
  }, [allClips, searchQuery]);

  const toggleGroup = (key) => {
    setCollapsedGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleCopy = (clip) => {
    const text = `${clip.title}\n\n${clip.hook_reason || ""}${
      clip.creator_credit ? `\n\nCredit: ${clip.creator_credit}` : ""
    }`;
    navigator.clipboard.writeText(text);
    setCopiedId(clip.id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  const handleDeleteClip = async (clipId) => {
    if (deletingId) return;
    setDeletingId(clipId);
    try {
      const res = await fetch(`${apiBase}/api/clips/${clipId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        await onRefresh();
      }
    } catch (err) {
      console.error("Failed to delete clip:", err);
    } finally {
      setDeletingId(null);
    }
  };

  const formatTime = (sec) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Top Storage Header */}
      <div className="bg-[#141417] border border-zinc-800 rounded-xl p-3.5 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-3.5 sm:gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
            <h2 className="text-sm sm:text-base font-semibold text-zinc-100">
              Media Storage Vault
            </h2>
            <span className="text-[10px] sm:text-[11px] font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700">
              {allClips.length} Clips • {groupedSources.length} Sources
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            All exported 9:16 shorts automatically grouped by their source
            YouTube link.
          </p>
        </div>

        {/* Search Input */}
        <div className="relative w-full md:w-80">
          <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search by URL, video title, or clip..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#0C0C0E] border border-zinc-800 rounded-lg pl-9 pr-3 py-2 text-xs placeholder:text-zinc-600 focus:outline-none focus:border-amber-500"
          />
        </div>
      </div>

      {/* Empty State */}
      {groupedSources.length === 0 ? (
        <div className="bg-[#141417]/60 border border-dashed border-zinc-800 rounded-2xl p-8 sm:p-12 text-center">
          <FolderOpen className="w-8 h-8 text-zinc-500 mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-zinc-200">
            No Stored Videos Found
          </h3>
          <p className="text-xs text-zinc-400 mt-1">
            {allClips.length === 0
              ? "Render your first batch of shorts in Clipper Studio to populate your vault."
              : "No source URLs or clips matched your search."}
          </p>
        </div>
      ) : (
        /* Source URL Folder Groups */
        <div className="space-y-4 sm:space-y-5">
          {groupedSources.map((group) => {
            const isCollapsed = !!collapsedGroups[group.key];
            return (
              <div
                key={group.key}
                className="bg-[#141417] border border-zinc-800 rounded-xl overflow-hidden"
              >
                {/* Source URL Folder Header */}
                <div className="p-3.5 sm:p-4 bg-[#18181C] border-b border-zinc-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3">
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.key)}
                    className="flex items-start sm:items-center gap-2.5 sm:gap-3.5 text-left min-w-0 flex-1 cursor-pointer"
                  >
                    {isCollapsed ? (
                      <ChevronRight className="w-4 h-4 text-zinc-400 shrink-0 mt-0.5 sm:mt-0" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-zinc-400 shrink-0 mt-0.5 sm:mt-0" />
                    )}

                    <div className="hidden sm:block w-20 h-11 rounded-lg bg-zinc-900 border border-zinc-800 overflow-hidden shrink-0">
                      {group.thumbnail ? (
                        <img
                          src={group.thumbnail}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Film className="w-4 h-4 text-zinc-600" />
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                        <h3 className="text-xs sm:text-sm font-semibold text-zinc-100 line-clamp-2 sm:truncate">
                          {group.video_title}
                        </h3>
                        {group.creator_credit && (
                          <span className="text-[10px] sm:text-[11px] font-mono px-2 py-0.5 rounded bg-zinc-900 text-zinc-400 border border-zinc-800 shrink-0">
                            {group.creator_credit}
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] sm:text-[11px] font-mono text-zinc-500 truncate mt-0.5">
                        {group.youtube_url}
                      </p>
                    </div>
                  </button>

                  <div className="flex items-center justify-between sm:justify-end gap-2.5 shrink-0 pl-6 sm:pl-0">
                    <span className="text-[11px] sm:text-xs font-mono px-2.5 py-1 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-300">
                      {group.clips.length}{" "}
                      {group.clips.length === 1 ? "Clip" : "Clips"}
                    </span>

                    <a
                      href={group.youtube_url}
                      target="_blank"
                      rel="noreferrer"
                      title="Open Original YouTube Video"
                      className="p-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white border border-zinc-800 transition"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>

                {/* Clips Grid Inside Source URL Folder */}
                {!isCollapsed && (
                  <div className="p-3.5 sm:p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5 sm:gap-4">
                    {group.clips.map((clip, idx) => {
                      const durationSec = Math.max(
                        1,
                        Math.round(clip.end_time - clip.start_time)
                      );
                      const isScheduled = scheduledClipIds.has(clip.id);

                      return (
                        <div
                          key={clip.id}
                          className="bg-[#0C0C0E] border border-zinc-800 hover:border-zinc-700 rounded-xl overflow-hidden flex flex-col"
                        >
                          <div className="relative bg-black aspect-[9/16] max-h-[340px] w-full flex items-center justify-center overflow-hidden">
                            <video
                              src={`${apiBase}${clip.local_file_path}`}
                              controls
                              playsInline
                              preload="metadata"
                              className="h-full w-full object-contain"
                            />

                            <div className="pointer-events-none absolute top-2 left-2 right-2 flex items-center justify-between">
                              <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-black/80 text-white border border-white/10">
                                #{idx + 1} • {durationSec}s
                              </span>
                              {isScheduled && (
                                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950/90 text-emerald-300 border border-emerald-500/30">
                                  Scheduled
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="p-3.5 flex-1 flex flex-col justify-between space-y-3">
                            <div className="space-y-1.5">
                              <div className="flex items-center justify-between gap-2">
                                <span className="inline-flex items-center gap-1 text-[11px] font-mono font-semibold px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/25">
                                  <Flame className="w-3 h-3" />
                                  {clip.viral_score}
                                </span>
                                <span className="inline-flex items-center gap-1 text-[10px] font-mono text-zinc-500">
                                  <Clock className="w-3 h-3" />
                                  {formatTime(clip.start_time)}–
                                  {formatTime(clip.end_time)}
                                </span>
                              </div>

                              <h4 className="text-xs font-semibold text-zinc-100 line-clamp-2 leading-snug">
                                {clip.title}
                              </h4>
                            </div>

                            <div className="flex items-center gap-1.5 pt-1">
                              <a
                                href={`${apiBase}${clip.local_file_path}`}
                                download={`${clip.title.replace(
                                  /[^a-z0-9]/gi,
                                  "_"
                                )}.mp4`}
                                className="flex-1 bg-zinc-100 hover:bg-white text-zinc-950 text-[11px] font-semibold py-2 sm:py-1.5 px-2.5 rounded-lg flex items-center justify-center gap-1 transition"
                              >
                                <Download className="w-3.5 h-3.5 sm:w-3 sm:h-3" />
                                MP4
                              </a>

                              <button
                                type="button"
                                onClick={onGoToCalendar}
                                title="Open in Content Calendar"
                                className="p-2 sm:p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 cursor-pointer"
                              >
                                <CalendarPlus className="w-3.5 h-3.5" />
                              </button>

                              <button
                                type="button"
                                onClick={() => handleCopy(clip)}
                                title="Copy Caption & Credit"
                                className="p-2 sm:p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 cursor-pointer"
                              >
                                {copiedId === clip.id ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                              </button>

                              <button
                                type="button"
                                onClick={() => handleDeleteClip(clip.id)}
                                disabled={deletingId === clip.id}
                                title="Delete Clip"
                                className="p-2 sm:p-1.5 rounded-lg bg-zinc-900 hover:bg-rose-950/60 text-zinc-500 hover:text-rose-400 border border-zinc-800 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}