import { NextRequest, NextResponse } from "next/server";
import { getSponsorPackProgress } from "@/lib/sponsor-pack-client";

export const dynamic = "force-dynamic";

/** Proxies fr1's GET /api/packs/:id/progress. Query: ?packId=... */
export async function GET(req: NextRequest) {
  const packId = req.nextUrl.searchParams.get("packId");
  if (!packId) {
    return NextResponse.json({ error: "Query param 'packId' is required." }, { status: 400 });
  }
  try {
    const progress = await getSponsorPackProgress(packId);
    return NextResponse.json({ ok: true, ...progress });
  } catch (err) {
    return NextResponse.json(
      { error: String(err instanceof Error ? err.message : err) },
      { status: 502 }
    );
  }
}
