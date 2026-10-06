import type { Pack } from './types';

/** Which artifacts are ready to be consumed right now. */
export interface PackReadiness {
  script: boolean;
  presentation: boolean;
  landingPage: boolean;
  voiceSelected: boolean;
  slidesExported: boolean;
  audioGenerated: boolean;
  videosRendered: boolean;
  finalVideo: boolean;
}

export interface PackProgress {
  packId: string;
  status: Pack['status'];
  updatedAt: string;
  progressPercent: number;
  ready: PackReadiness;
  /** Gamma URL for the slide presentation — open as the API key's owner to edit. */
  presentationEditUrl?: string;
  /** Publicly viewable Gamma landing page (published site). */
  publicLandingPageUrl?: string;
  videoUrl?: string;
  /** Absolute URL to the final video, usable from other origins/services. */
  videoAbsoluteUrl?: string;
  slidesTotal: number;
  error?: string;
}

const READINESS_STEP_COUNT = 8;

/** Computes a lightweight progress/readiness summary for a pack. */
export function computePackProgress(pack: Pack): PackProgress {
  const slidesTotal = pack.slides.length;

  const ready: PackReadiness = {
    script: slidesTotal > 0,
    presentation: !!pack.presentationUrl,
    landingPage: !!pack.landingPageUrl,
    voiceSelected: !!pack.voiceId,
    slidesExported:
      slidesTotal > 0 && pack.slides.every((s) => !!s.imagePath),
    audioGenerated:
      slidesTotal > 0 && pack.slides.every((s) => !!s.audioPath),
    videosRendered:
      slidesTotal > 0 && pack.slides.every((s) => !!s.videoPath),
    finalVideo: !!pack.videoUrl,
  };

  const readyCount = Object.values(ready).filter(Boolean).length;
  const progressPercent =
    pack.status === 'done'
      ? 100
      : Math.round((readyCount / READINESS_STEP_COUNT) * 100);

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '');

  return {
    packId: pack.id,
    status: pack.status,
    updatedAt: pack.updatedAt,
    progressPercent,
    ready,
    presentationEditUrl: pack.presentationUrl,
    publicLandingPageUrl: pack.landingPageUrl,
    videoUrl: pack.videoUrl,
    videoAbsoluteUrl:
      pack.videoUrl && appUrl ? `${appUrl}${pack.videoUrl}` : undefined,
    slidesTotal,
    error: pack.error,
  };
}
