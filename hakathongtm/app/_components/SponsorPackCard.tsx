"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  FilmSlate,
  CircleNotch,
  LinkSimple,
  PencilSimple,
  PlayCircle,
  Warning,
} from "@phosphor-icons/react";
import { api, type SponsorPackStatus } from "@/app/_lib/api";
import type { RefinedAvatar, Generation } from "@/app/_lib/api";
import { avatarId } from "@/lib/sponsor-pack-client";

/** Generates + tracks the fr1 sponsor pack (video + landing page) for one avatar. */
export function SponsorPackCard({
  avatar,
  companyContext,
  onReady,
}: {
  avatar: RefinedAvatar;
  companyContext?: Generation["companyContext"];
  /** Called whenever this avatar's pack progress/urls update — lets the parent
   * cache it (e.g. for outreach emails to reference the landing page/video). */
  onReady?: (avatarId: string, status: SponsorPackStatus) => void;
}) {
  const [packId, setPackId] = useState<string | null>(null);
  const [status, setStatus] = useState<SponsorPackStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const id = avatarId(avatar);

  // Hydrate from any prior run on mount.
  useEffect(() => {
    api
      .listSponsorPacks()
      .then((packs) => {
        const rec = packs[id];
        if (rec) setPackId(rec.packId);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const poll = useCallback(async () => {
    if (!packId) return;
    try {
      const s = await api.sponsorPackStatus(packId);
      setStatus(s);
      onReady?.(id, s);
      if (s.status === "done" || s.status === "failed") {
        if (timer.current) clearInterval(timer.current);
        timer.current = null;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
    }
  }, [packId, id, onReady]);

  useEffect(() => {
    if (!packId) return;
    poll();
    timer.current = setInterval(poll, 4000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packId]);

  async function generate() {
    setStarting(true);
    setError(null);
    try {
      const settings = companyContext
        ? {
            companyName: companyContext.name,
            companyUrl: companyContext.url,
            companyInfo: companyContext.companyInfo,
            goal: companyContext.goal,
            language: companyContext.language,
            logoUrl: companyContext.logoUrl,
            referenceImageUrls: companyContext.referenceImageUrls,
            speaker: companyContext.speaker,
          }
        : undefined;
      const res = await api.generateSponsorPack({ avatar, settings });
      setPackId(res.packId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  }

  const isRunning = !!packId && status?.status !== "done" && status?.status !== "failed";
  const isDone = status?.status === "done";

  return (
    <div className="mt-3 border-t border-border pt-3">
      {!packId && (
        <button
          onClick={generate}
          disabled={starting}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:border-foreground/30 disabled:opacity-60"
        >
          {starting ? (
            <CircleNotch size={13} weight="bold" className="animate-spin" />
          ) : (
            <FilmSlate size={13} weight="fill" className="text-accent" />
          )}
          {starting ? "Starting…" : "Generate video & site"}
        </button>
      )}

      {isRunning && (
        <div className="flex items-center gap-2 text-[11px] text-muted">
          <CircleNotch size={13} weight="bold" className="animate-spin text-accent" />
          <span>
            {status?.status?.replace(/_/g, " ") ?? "starting"} · {status?.progressPercent ?? 0}%
          </span>
        </div>
      )}

      {status?.status === "failed" && (
        <div className="flex items-center gap-1.5 text-[11px] text-[#c2410c]">
          <Warning size={13} weight="fill" /> {status.error || "generation failed"}
        </div>
      )}

      {isDone && status && (
        <div className="flex flex-wrap items-center gap-2">
          {status.videoAbsoluteUrl && (
            <a
              href={status.videoAbsoluteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-[11px] font-medium text-foreground transition-colors hover:border-foreground/30"
            >
              <PlayCircle size={13} weight="fill" className="text-accent" /> Preview video
            </a>
          )}
          {status.publicLandingPageUrl && (
            <a
              href={status.publicLandingPageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-[11px] font-medium text-foreground transition-colors hover:border-foreground/30"
            >
              <LinkSimple size={13} weight="bold" className="text-accent" /> Landing page
            </a>
          )}
          {status.presentationEditUrl && (
            <a
              href={status.presentationEditUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-[11px] font-medium text-foreground transition-colors hover:border-foreground/30"
            >
              <PencilSimple size={13} weight="bold" className="text-accent" /> Edit slides
            </a>
          )}
        </div>
      )}

      {error && <p className="mt-1.5 font-mono text-[10px] text-[#c2410c]">{error}</p>}
    </div>
  );
}
