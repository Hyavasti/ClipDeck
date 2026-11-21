import { useState, useMemo } from "react";
import {
  Clock,
  CheckCircle2,
  Download,
  Copy,
  Check,
  Trash2,
  Plus,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Zap,
  Flame,
  Info,
} from "lucide-react";

const DAILY_ALGO_SLOTS = [
  {
    slot_label: "Slot 1 • Lunch Peak",
    post_time: "12:30 PM",
    platform: "TikTok",
    windowNote: "12:00 PM – 1:30 PM • Midday sound-on scroll",
  },
  {
    slot_label: "Slot 2 • Commute Rush",
    post_time: "05:30 PM",
    platform: "Facebook Reels",
    windowNote: "5:00 PM – 6:30 PM • High mobile feed activity",
  },
  {
    slot_label: "Slot 3 • Prime Night",
    post_time: "09:00 PM",
    platform: "TikTok + FB Reels",
    windowNote: "8:30 PM – 10:00 PM • Peak watch-time & shares",
  },
];

function getWeekDates(weekOffset = 0) {
  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() + weekOffset * 7);

  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const iso = d.toISOString().split("T")[0];
    return {
      iso,
      dayName: d.toLocaleDateString("en-US", { weekday: "short" }),
      dayNumber: d.getDate(),
      dateLabel: d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
      isToday: iso === new Date().toISOString().split("T")[0],
    };
  });
}

export default function CalendarPage({
  apiBase,
  allClips,
  scheduledPosts,
  onRefresh,
}) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [mobileDayIndex, setMobileDayIndex] = useState(0);
  const [showTimingMobile, setShowTimingMobile] = useState(false);
  const [autoScheduling, setAutoScheduling] = useState(false);
  const [copiedPostId, setCopiedPostId] = useState(null);

  // Manual slot assignment modal state
  const [assignTarget, setAssignTarget] = useState(null); // { date, slot }
  const [selectedClipId, setSelectedClipId] = useState("");
  const [selectedPlatform, setSelectedPlatform] = useState("TikTok");
  const [customCaption, setCustomCaption] = useState("");
  const [savingSlot, setSavingSlot] = useState(false);

  const weekDays = useMemo(() => getWeekDates(weekOffset), [weekOffset]);

  const unscheduledClips = useMemo(() => {
    const scheduledIds = new Set(scheduledPosts.map((p) => p.clip_id));
    return allClips.filter((c) => !scheduledIds.has(c.id));
  }, [allClips, scheduledPosts]);

  const postsByDateAndSlot = useMemo(() => {
    const map = {};
    for (const post of scheduledPosts) {
      map[`${post.scheduled_date}__${post.slot_label}`] = post;
    }
    return map;
  }, [scheduledPosts]);

  const handleAutoSchedule = async () => {
    if (autoScheduling) return;
    setAutoScheduling(true);
    try {
      await fetch(`${apiBase}/api/schedule/auto`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start_date: weekDays[0]?.iso }),
      });
      await onRefresh();
    } catch (err) {
      console.error("Auto-schedule failed:", err);
    } finally {
      setAutoScheduling(false);
    }
  };

  const openAssignModal = (dateIso, slot) => {
    const defaultClip = unscheduledClips[0] || allClips[0];
    setAssignTarget({ date: dateIso, slot });
    setSelectedPlatform(slot.platform);
    if (defaultClip) {
      setSelectedClipId(defaultClip.id);
      const credit = defaultClip.creator_credit
        ? `\n\nCredit: ${defaultClip.creator_credit}`
        : "";
      setCustomCaption(
        `${defaultClip.title}\n\n${defaultClip.hook_reason || ""}${credit}\n#fyp #reels #viral #clips`
      );
    } else {
      setSelectedClipId("");
      setCustomCaption("");
    }
  };

  const handleClipSelectionChange = (clipId) => {
    setSelectedClipId(clipId);
    const clip = allClips.find((c) => c.id === clipId);
    if (clip) {
      const credit = clip.creator_credit
        ? `\n\nCredit: ${clip.creator_credit}`
        : "";
      setCustomCaption(
        `${clip.title}\n\n${clip.hook_reason || ""}${credit}\n#fyp #reels #viral #clips`
      );
    }
  };

  const handleSaveAssignment = async (e) => {
    e.preventDefault();
    if (!assignTarget || !selectedClipId || savingSlot) return;
    setSavingSlot(true);
    try {
      await fetch(`${apiBase}/api/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clip_id: selectedClipId,
          platform: selectedPlatform,
          scheduled_date: assignTarget.date,
          slot_label: assignTarget.slot.slot_label,
          post_time: assignTarget.slot.post_time,
          caption: customCaption,
        }),
      });
      setAssignTarget(null);
      await onRefresh();
    } catch (err) {
      console.error("Failed to save slot:", err);
    } finally {
      setSavingSlot(false);
    }
  };

  const togglePostedStatus = async (post) => {
    const nextStatus = post.status === "posted" ? "scheduled" : "posted";
    try {
      await fetch(`${apiBase}/api/schedule/${post.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      await onRefresh();
    } catch (err) {
      console.error("Failed to update post status:", err);
    }
  };

  const handleDeletePost = async (postId) => {
    try {
      await fetch(`${apiBase}/api/schedule/${postId}`, {
        method: "DELETE",
      });
      await onRefresh();
    } catch (err) {
      console.error("Failed to remove scheduled post:", err);
    }
  };

  const handleCopyCaption = (post) => {
    navigator.clipboard.writeText(post.caption);
    setCopiedPostId(post.id);
    setTimeout(() => setCopiedPostId(null), 1800);
  };

  const renderDayCard = (day) => (
    <div
      key={day.iso}
      className={`bg-[#141417] border rounded-xl p-3.5 sm:p-3 flex flex-col space-y-2.5 ${
        day.isToday ? "border-amber-500/50" : "border-zinc-800"
      }`}
    >
      {/* Day Header */}
      <div className="flex items-center justify-between pb-2 border-b border-zinc-800/80">
        <div>
          <p className="text-xs font-semibold text-zinc-100">{day.dayName}</p>
          <p className="text-[11px] font-mono text-zinc-500">{day.dateLabel}</p>
        </div>
        {day.isToday && (
          <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30">
            Today
          </span>
        )}
      </div>

      {/* 3 Daily Posting Slots */}
      <div className="space-y-2.5 sm:space-y-2 flex-1">
        {DAILY_ALGO_SLOTS.map((slot) => {
          const post = postsByDateAndSlot[`${day.iso}__${slot.slot_label}`];

          if (!post) {
            return (
              <button
                key={slot.slot_label}
                type="button"
                onClick={() => openAssignModal(day.iso, slot)}
                className="w-full text-left p-3 sm:p-2.5 rounded-lg border border-dashed border-zinc-800 hover:border-zinc-600 bg-[#0C0C0E]/60 hover:bg-zinc-900/80 transition group cursor-pointer"
              >
                <div className="flex items-center justify-between text-[11px] text-zinc-500 group-hover:text-zinc-300">
                  <span className="font-mono">{slot.post_time}</span>
                  <Plus className="w-3.5 h-3.5" />
                </div>
                <p className="text-[10px] text-zinc-600 mt-1 truncate">
                  {slot.platform}
                </p>
              </button>
            );
          }

          const isPosted = post.status === "posted";

          return (
            <div
              key={slot.slot_label}
              className={`p-3 sm:p-2.5 rounded-lg border space-y-2 transition ${
                isPosted
                  ? "bg-emerald-950/20 border-emerald-500/30"
                  : "bg-[#0C0C0E] border-zinc-800"
              }`}
            >
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] font-mono text-zinc-400 flex items-center gap-1">
                  <Clock className="w-2.5 h-2.5" />
                  {post.post_time}
                </span>
                <span className="text-[10px] font-medium px-1.5 py-0.2 rounded bg-zinc-900 text-zinc-300 border border-zinc-800 truncate">
                  {post.platform}
                </span>
              </div>

              <p className="text-xs font-medium text-zinc-100 line-clamp-2 leading-snug">
                {post.clip_title}
              </p>

              <div className="flex items-center justify-between text-[10px] text-zinc-400">
                <span className="inline-flex items-center gap-0.5 text-amber-400 font-mono">
                  <Flame className="w-2.5 h-2.5" />
                  {post.viral_score}
                </span>
                {post.creator_credit && (
                  <span className="truncate max-w-[120px] sm:max-w-[90px] text-zinc-500">
                    {post.creator_credit}
                  </span>
                )}
              </div>

              {/* Quick Actions */}
              <div className="flex items-center gap-1.5 sm:gap-1 pt-1.5 sm:pt-1 border-t border-zinc-800/80">
                <button
                  type="button"
                  onClick={() => togglePostedStatus(post)}
                  title={isPosted ? "Posted" : "Mark as Posted"}
                  className={`flex-1 text-[11px] sm:text-[10px] font-medium py-1.5 sm:py-1 px-2 sm:px-1.5 rounded flex items-center justify-center gap-1 transition cursor-pointer ${
                    isPosted
                      ? "bg-emerald-500/20 text-emerald-300"
                      : "bg-zinc-900 hover:bg-zinc-800 text-zinc-300"
                  }`}
                >
                  <CheckCircle2 className="w-3 h-3" />
                  {isPosted ? "Posted" : "Mark Done"}
                </button>

                <button
                  type="button"
                  onClick={() => handleCopyCaption(post)}
                  title="Copy Caption & Hashtags"
                  className="p-2 sm:p-1.5 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-300 cursor-pointer"
                >
                  {copiedPostId === post.id ? (
                    <Check className="w-3.5 h-3.5 sm:w-3 sm:h-3 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5 sm:w-3 sm:h-3" />
                  )}
                </button>

                <a
                  href={`${apiBase}${post.local_file_path}`}
                  download={`${post.clip_title.replace(
                    /[^a-z0-9]/gi,
                    "_"
                  )}.mp4`}
                  title="Download MP4"
                  className="p-2 sm:p-1.5 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-300"
                >
                  <Download className="w-3.5 h-3.5 sm:w-3 sm:h-3" />
                </a>

                <button
                  type="button"
                  onClick={() => handleDeletePost(post.id)}
                  title="Remove from slot"
                  className="p-2 sm:p-1.5 rounded bg-zinc-900 hover:bg-rose-950/60 text-zinc-500 hover:text-rose-400 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5 sm:w-3 sm:h-3" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  const selectedMobileDay = weekDays[mobileDayIndex] || weekDays[0];

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Top Planner Header Bar */}
      <div className="bg-[#141417] border border-zinc-800 rounded-xl p-3.5 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-3.5 sm:gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
            <h2 className="text-sm sm:text-base font-semibold text-zinc-100">
              3x Daily Upload Planner
            </h2>
            <span className="text-[10px] sm:text-[11px] font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700">
              TikTok + FB Reels
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            Spaced across peak engagement windows (12:30 PM, 5:30 PM, 9:00 PM)
            so posts never cannibalize reach.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
          {/* Week Navigation */}
          <div className="flex items-center justify-between bg-[#0C0C0E] border border-zinc-800 rounded-lg p-1">
            <button
              type="button"
              onClick={() => {
                setWeekOffset((w) => w - 1);
                setMobileDayIndex(0);
              }}
              className="p-1.5 text-zinc-400 hover:text-white rounded transition cursor-pointer"
              title="Previous 7 days"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                setWeekOffset(0);
                setMobileDayIndex(0);
              }}
              className="px-2.5 text-xs font-medium text-zinc-300 hover:text-white cursor-pointer"
            >
              {weekDays[0]?.dateLabel} – {weekDays[6]?.dateLabel}
            </button>
            <button
              type="button"
              onClick={() => {
                setWeekOffset((w) => w + 1);
                setMobileDayIndex(0);
              }}
              className="p-1.5 text-zinc-400 hover:text-white rounded transition cursor-pointer"
              title="Next 7 days"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Auto-Fill Unscheduled Clips */}
          <button
            type="button"
            onClick={handleAutoSchedule}
            disabled={autoScheduling || unscheduledClips.length === 0}
            className="bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-zinc-950 font-semibold text-xs px-3.5 py-2.5 sm:py-2 rounded-lg flex items-center justify-center gap-1.5 transition cursor-pointer"
          >
            <Zap className="w-3.5 h-3.5 shrink-0" />
            {autoScheduling
              ? "Scheduling..."
              : `Auto-Fill Queue (${unscheduledClips.length} Ready)`}
          </button>
        </div>
      </div>

      {/* Collapsible Algorithm Timing Strip on Mobile, Always Open on Desktop */}
      <div>
        <button
          type="button"
          onClick={() => setShowTimingMobile((prev) => !prev)}
          className="md:hidden w-full bg-[#141417] border border-zinc-800 rounded-xl px-3.5 py-2.5 flex items-center justify-between text-xs font-medium text-zinc-300 cursor-pointer"
        >
          <span className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            Peak Posting Windows (12:30 PM • 5:30 PM • 9:00 PM)
          </span>
          <ChevronDown
            className={`w-4 h-4 text-zinc-400 transition-transform ${
              showTimingMobile ? "rotate-180" : ""
            }`}
          />
        </button>

        <div
          className={`${
            showTimingMobile ? "grid mt-2.5" : "hidden"
          } md:grid grid-cols-1 md:grid-cols-3 gap-2.5 sm:gap-3`}
        >
          {DAILY_ALGO_SLOTS.map((slot) => (
            <div
              key={slot.slot_label}
              className="bg-[#141417] border border-zinc-800/90 rounded-xl p-3 sm:p-3.5 flex items-start justify-between gap-3"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-zinc-100">
                    {slot.slot_label}
                  </span>
                  <span className="text-[11px] font-mono text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                    {slot.post_time}
                  </span>
                </div>
                <p className="text-[11px] text-zinc-400 mt-1">
                  {slot.windowNote}
                </p>
              </div>
              <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-300 shrink-0">
                {slot.platform}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Mobile Day Pill Selector + Single-Day View */}
      <div className="md:hidden space-y-3">
        <div className="grid grid-cols-7 gap-1 bg-[#141417] border border-zinc-800 rounded-xl p-1">
          {weekDays.map((day, idx) => {
            const isSelected = idx === mobileDayIndex;
            const slotCount = DAILY_ALGO_SLOTS.filter(
              (s) => !!postsByDateAndSlot[`${day.iso}__${s.slot_label}`]
            ).length;

            return (
              <button
                key={day.iso}
                type="button"
                onClick={() => setMobileDayIndex(idx)}
                className={`py-2 px-1 rounded-lg flex flex-col items-center justify-center transition cursor-pointer ${
                  isSelected
                    ? "bg-amber-500 text-zinc-950 font-semibold"
                    : day.isToday
                    ? "bg-zinc-800/80 text-amber-400"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <span className="text-[10px] uppercase">{day.dayName}</span>
                <span className="text-xs font-mono mt-0.5">
                  {day.dayNumber}
                </span>
                <span
                  className={`w-1.5 h-1.5 rounded-full mt-1 ${
                    slotCount > 0
                      ? isSelected
                        ? "bg-zinc-950"
                        : "bg-amber-400"
                      : "bg-transparent"
                  }`}
                />
              </button>
            );
          })}
        </div>

        {selectedMobileDay && renderDayCard(selectedMobileDay)}
      </div>

      {/* Desktop / Tablet 7-Day Editorial Board */}
      <div className="hidden md:grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7 gap-3">
        {weekDays.map((day) => renderDayCard(day))}
      </div>

      {/* Safe Posting Note */}
      <div className="bg-[#141417] border border-zinc-800 rounded-xl p-3.5 sm:p-4 flex items-start gap-3 text-xs text-zinc-400">
        <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          <span className="text-zinc-200 font-medium">
            Workflow for Maximum Reach:
          </span>{" "}
          Click <span className="text-zinc-200">Download</span> +{" "}
          <span className="text-zinc-200">Copy Caption</span> at each scheduled
          window, upload natively in the TikTok or Facebook Reels app (native
          uploads get higher initial test distribution than third-party API
          posts), and click <span className="text-zinc-200">Mark Done</span>.
        </p>
      </div>

      {/* Assign Clip Modal (Bottom Sheet on Mobile, Centered on Desktop) */}
      {assignTarget && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <form
            onSubmit={handleSaveAssignment}
            className="bg-[#141417] border-t sm:border border-zinc-800 rounded-t-2xl sm:rounded-2xl max-w-md w-full p-4 sm:p-5 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div>
                <h3 className="text-sm font-semibold text-white">
                  Schedule Clip
                </h3>
                <p className="text-xs text-zinc-400 font-mono mt-0.5">
                  {assignTarget.date} • {assignTarget.slot.post_time}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAssignTarget(null)}
                className="text-xs text-zinc-400 hover:text-white px-2.5 py-1.5 rounded-lg bg-zinc-900 sm:bg-transparent cursor-pointer"
              >
                Close
              </button>
            </div>

            {allClips.length === 0 ? (
              <p className="text-xs text-zinc-400 py-4">
                Generate at least one video in the Clipper Studio first.
              </p>
            ) : (
              <>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-300">
                    Select Clip
                  </label>
                  <select
                    value={selectedClipId}
                    onChange={(e) => handleClipSelectionChange(e.target.value)}
                    className="w-full bg-[#0C0C0E] border border-zinc-800 rounded-lg px-3 py-2.5 sm:py-2 text-xs text-zinc-200 focus:outline-none focus:border-amber-500"
                  >
                    {allClips.map((c) => (
                      <option key={c.id} value={c.id}>
                        [{c.viral_score}/100] {c.title}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-300">
                    Target Platform
                  </label>
                  <select
                    value={selectedPlatform}
                    onChange={(e) => setSelectedPlatform(e.target.value)}
                    className="w-full bg-[#0C0C0E] border border-zinc-800 rounded-lg px-3 py-2.5 sm:py-2 text-xs text-zinc-200 focus:outline-none focus:border-amber-500"
                  >
                    <option value="TikTok">TikTok</option>
                    <option value="Facebook Reels">Facebook Reels</option>
                    <option value="TikTok + FB Reels">TikTok + FB Reels</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-300">
                    Post Caption & Attribution
                  </label>
                  <textarea
                    rows={4}
                    value={customCaption}
                    onChange={(e) => setCustomCaption(e.target.value)}
                    className="w-full bg-[#0C0C0E] border border-zinc-800 rounded-lg p-2.5 text-xs text-zinc-200 focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setAssignTarget(null)}
                    className="px-3.5 py-2 rounded-lg text-xs text-zinc-400 hover:text-white cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={savingSlot}
                    className="bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold px-4 py-2 rounded-lg text-xs cursor-pointer"
                  >
                    {savingSlot ? "Saving..." : "Save to Calendar"}
                  </button>
                </div>
              </>
            )}
          </form>
        </div>
      )}
    </div>
  );
}