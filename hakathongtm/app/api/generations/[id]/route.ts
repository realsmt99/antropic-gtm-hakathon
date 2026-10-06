import { NextRequest, NextResponse } from "next/server";
import { loadGeneration, updateGeneration, deleteGeneration } from "@/lib/generation-store";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    const { id } = await params;
    const generation = loadGeneration(id);
    if (!generation) {
      return NextResponse.json({ error: "Generation not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, generation });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    const { id } = await params;
    const body = (await req.json()) as Record<string, unknown>;
    const generation = updateGeneration(id, body);
    if (!generation) {
      return NextResponse.json({ error: "Generation not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, generation });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    const { id } = await params;
    const ok = deleteGeneration(id);
    if (!ok) {
      return NextResponse.json({ error: "Generation not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
