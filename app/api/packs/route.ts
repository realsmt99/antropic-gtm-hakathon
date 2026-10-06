import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { SseController } from '@/lib/sse';
import { setPack, listPacks } from '@/lib/store';
import { runPipeline } from '@/lib/pipeline';
import { computePackProgress } from '@/lib/progress';
import type { Pack, PacksCreateBody } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const avatarId = req.nextUrl.searchParams.get('avatarId');
  const packs = listPacks()
    .filter((p) => !avatarId || p.avatarId === avatarId)
    .map((p) => {
      const progress = computePackProgress(p);
      return {
        id: p.id,
        status: p.status,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        avatarId: p.avatarId,
        avatarLabel: p.avatarLabel,
        companyContext: p.companyContext,
        progressPercent: progress.progressPercent,
        // presentationEditUrl: open in Gamma as the API key's owner to edit.
        presentationEditUrl: progress.presentationEditUrl,
        // publicLandingPageUrl: the published Gamma site, viewable by anyone.
        publicLandingPageUrl: progress.publicLandingPageUrl,
        videoUrl: progress.videoUrl,
        videoAbsoluteUrl: progress.videoAbsoluteUrl,
      };
    });
  return NextResponse.json(packs);
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as PacksCreateBody;

  if (!body.avatarText || !body.companyContext) {
    return NextResponse.json(
      { error: 'avatarText and companyContext are required' },
      { status: 400 },
    );
  }

  const packId = uuidv4();
  const now = new Date().toISOString();

  const pack: Pack = {
    id: packId,
    createdAt: now,
    updatedAt: now,
    status: 'pending',
    avatarId: body.avatarId,
    avatarLabel: body.avatarLabel,
    avatarText: body.avatarText,
    companyContext: body.companyContext,
    slides: [],
    events: [],
  };

  setPack(pack);

  // async mode: fire the pipeline in the background and return the pack id
  // immediately — callers poll GET /api/packs/:id/progress instead of SSE.
  if (req.nextUrl.searchParams.get('async') === '1') {
    const sse = new SseController(null);
    runPipeline(pack, sse).catch(() => {});
    return NextResponse.json(
      { packId, progressUrl: `/api/packs/${packId}/progress` },
      { status: 202, headers: { 'X-Pack-Id': packId } },
    );
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const sse = new SseController(controller);
      runPipeline(pack, sse).catch(() => {});
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Pack-Id': packId,
    },
  });
}
