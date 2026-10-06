import type { RefinedAvatar } from "./avatar-engine";

const SPONSOR_PACK_API_URL =
  process.env.SPONSOR_PACK_API_URL ?? "http://localhost:3000";

/** Settings the caller can override per-org; falls back to Wise Women defaults. */
export interface SponsorPackSettings {
  companyName?: string;
  companyUrl?: string;
  companyInfo?: string;
  goal?: string;
  logoUrl?: string;
  referenceImageUrls?: string[];
  language?: string;
  speaker?: { name: string; info?: string; voiceId?: string };
}

const DEFAULT_SETTINGS: Required<Pick<SponsorPackSettings, "companyName" | "companyUrl" | "companyInfo" | "goal">> = {
  companyName: "Wise Women",
  companyUrl: "https://www.wisewomen.fr/",
  companyInfo: "A French non-profit advancing women's empowerment and equal opportunity through education, mentorship and leadership programmes.",
  goal: "Obtenir plus de sponsors",
};

/** Builds the fr1 avatarText from a RefinedAvatar (label/summary/interests/pains/tone/angle). */
export function avatarToText(avatar: RefinedAvatar): string {
  return `${avatar.label}. ${avatar.summary}
Interests: ${(avatar.interests ?? []).join(", ") || "—"}
Pains: ${(avatar.pains ?? []).join(", ") || "—"}
Tone: ${avatar.tone || "warm, professional"}. Outreach angle: ${avatar.outreach_angle || "—"}`;
}

/** Stable id for an avatar (no natural id on RefinedAvatar — derive from its label). */
export function avatarId(avatar: RefinedAvatar): string {
  return avatar.label
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export interface SponsorPackProgress {
  packId: string;
  status: string;
  progressPercent: number;
  presentationEditUrl?: string;
  publicLandingPageUrl?: string;
  videoUrl?: string;
  videoAbsoluteUrl?: string;
  error?: string;
}

/** Kicks off async generation on fr1 and returns the new packId. */
export async function generateSponsorPack(
  avatar: RefinedAvatar,
  settings: SponsorPackSettings = {}
): Promise<{ packId: string }> {
  const merged = { ...DEFAULT_SETTINGS, ...settings };

  const res = await fetch(`${SPONSOR_PACK_API_URL}/api/packs?async=1`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      avatarId: avatarId(avatar),
      avatarLabel: avatar.label,
      avatarText: avatarToText(avatar),
      companyContext: {
        name: merged.companyName,
        url: merged.companyUrl,
        companyInfo: merged.companyInfo,
        goal: merged.goal,
        language: merged.language,
        logoUrl: merged.logoUrl,
        referenceImageUrls: merged.referenceImageUrls,
        speaker: merged.speaker,
      },
    }),
  });

  const text = await res.text();
  let data: { packId?: string; error?: string };
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Sponsor Pack service non-JSON response (${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok || !data.packId) {
    throw new Error(data.error || `Sponsor Pack service error (${res.status})`);
  }
  return { packId: data.packId };
}

/** Proxies fr1's lightweight progress endpoint. */
export async function getSponsorPackProgress(packId: string): Promise<SponsorPackProgress> {
  const res = await fetch(`${SPONSOR_PACK_API_URL}/api/packs/${packId}/progress`, {
    cache: "no-store",
  });
  const text = await res.text();
  let data: SponsorPackProgress & { error?: string };
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Sponsor Pack service non-JSON response (${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    throw new Error(data.error || `Sponsor Pack service error (${res.status})`);
  }
  return data;
}

/** Downloads the final video from fr1 and returns it base64-encoded (for Resend attachments). */
export async function downloadVideoBase64(
  videoAbsoluteUrl: string,
  maxBytes = 25 * 1024 * 1024
): Promise<{ base64: string; filename: string } | null> {
  const res = await fetch(videoAbsoluteUrl);
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > maxBytes) return null;
  const filename = videoAbsoluteUrl.split("/").pop() || "sponsor-pack.mp4";
  return { base64: buf.toString("base64"), filename };
}
