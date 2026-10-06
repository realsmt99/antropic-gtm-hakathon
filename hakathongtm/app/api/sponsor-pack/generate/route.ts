import { NextRequest, NextResponse } from "next/server";
import type { RefinedAvatar } from "@/lib/avatar-engine";
import { generateSponsorPack, avatarId, type SponsorPackSettings } from "@/lib/sponsor-pack-client";
import { saveJSON, loadJSON } from "@/lib/memory-store";

export const dynamic = "force-dynamic";

interface SponsorPackRecord {
  avatarId: string;
  avatarLabel: string;
  packId: string;
  created_at: string;
}

/**
 * Kicks off video/landing-page generation on the Sponsor Pack service (fr1)
 * for one refined avatar. Body: { avatar: RefinedAvatar, settings?: SponsorPackSettings }
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { avatar?: RefinedAvatar; settings?: SponsorPackSettings };
    if (!body.avatar?.label) {
      return NextResponse.json({ error: "Body must include 'avatar' with a label." }, { status: 400 });
    }

    const { packId } = await generateSponsorPack(body.avatar, body.settings ?? {});

    const id = avatarId(body.avatar);
    const map = loadJSON<Record<string, SponsorPackRecord>>("sponsor_packs") ?? {};
    map[id] = {
      avatarId: id,
      avatarLabel: body.avatar.label,
      packId,
      created_at: new Date().toISOString(),
    };
    saveJSON("sponsor_packs", map);

    return NextResponse.json({ ok: true, avatarId: id, packId });
  } catch (err) {
    return NextResponse.json(
      { error: String(err instanceof Error ? err.message : err) },
      { status: 500 }
    );
  }
}

/** Returns the stored avatarId -> packId map (for hydrating the UI on load). */
export async function GET() {
  const map = loadJSON<Record<string, SponsorPackRecord>>("sponsor_packs") ?? {};
  return NextResponse.json({ ok: true, packs: map });
}
