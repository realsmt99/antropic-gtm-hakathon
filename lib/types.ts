export interface Speaker {
  /** Name of the real person (founder/co-founder/etc.) recording the voiceover. */
  name: string;
  /** Short bio/role info, e.g. "Co-founder & CEO". Used to enrich the intro line. */
  info?: string;
  /** Pin an exact Gradium voice UID to use for this speaker, bypassing the
   * Claude-based auto-selection (useful when the person has a cloned voice). */
  voiceId?: string;
}

export interface CompanyContext {
  name: string;
  url: string;
  goal: string;
  /** Short description/mission of the company (e.g. "We empower women
   * through education and mentorship"). Used to make the 'Who we are'
   * slide concrete and professional. */
  companyInfo?: string;
  /** ISO 639-1 code (e.g. "fr", "en"). Optional — if omitted, it is
   * auto-detected from the avatar persona's most natural language. */
  language?: string;
  /** Public URL to the company logo. Placed in a fixed corner of every
   * presentation slide; referenced as an image in the landing page. */
  logoUrl?: string;
  /** Public URLs to reference images (product shots, event photos, etc.)
   * Gamma should draw from when generating slides/landing page content. */
  referenceImageUrls?: string[];
  /** Optional real person recording the voiceover. When set, the intro
   * slide opens with a short self-introduction from this person. */
  speaker?: Speaker;
}

export interface SlideScript {
  title: string;
  /** Concise on-screen text for the slide itself (what Gamma renders). */
  slideText: string;
  /** What the speaker actually says out loud — a more human, conversational
   * take that riffs on the slide rather than reading it verbatim. */
  voiceoverScript: string;
}

export interface SlideAsset {
  index: number;
  title: string;
  slideText: string;
  voiceoverScript: string;
  imagePath?: string;
  audioPath?: string;
  videoPath?: string;
}

export type PackStatus =
  | 'pending'
  | 'generating_script'
  | 'creating_presentation'
  | 'creating_landing'
  | 'selecting_voice'
  | 'exporting_slides'
  | 'generating_audio'
  | 'rendering_videos'
  | 'concatenating'
  | 'done'
  | 'failed';

export interface Pack {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: PackStatus;
  /** Caller-supplied identifier linking this pack to an external avatar. */
  avatarId?: string;
  /** Human-readable label of the external avatar (for listings/UI). */
  avatarLabel?: string;
  avatarText: string;
  companyContext: CompanyContext;
  slides: SlideAsset[];
  presentationId?: string;
  presentationUrl?: string;
  exportUrl?: string;
  landingPageUrl?: string;
  themeId?: string;
  themeName?: string;
  voiceId?: string;
  videoPath?: string;
  videoUrl?: string;
  error?: string;
  events: SseEvent[];
}

export interface SseEvent {
  step: string;
  ts: string;
  [key: string]: unknown;
}

export interface PacksCreateBody {
  avatarText: string;
  companyContext: CompanyContext;
  avatarId?: string;
  avatarLabel?: string;
}
