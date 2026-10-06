import { NextRequest, NextResponse } from "next/server";
import { listGenerations, createGeneration, loadGeneration, type Generation } from "@/lib/generation-store";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ ok: true, generations: listGenerations() });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<Generation>;
    const generation = createGeneration({
      id: body.id ?? randomUUID(),
      name: body.name ?? "Untitled generation",
      companyContext: body.companyContext ?? { name: "", url: "" },
      rows: body.rows,
      userMessage: body.userMessage,
      aiMessage: body.aiMessage,
      filename: body.filename,
      phase: body.phase,
      icp: body.icp,
      analysis: body.analysis,
      seeded: body.seeded,
      signal_count: body.signal_count,
      sponsor_packs: body.sponsor_packs,
    });
    return NextResponse.json({ ok: true, generation });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
