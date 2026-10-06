import { NextRequest, NextResponse } from 'next/server';
import { getPack } from '@/lib/store';
import { sseFrame } from '@/lib/sse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/packs/:id/stream
 * Replays all stored events for reconnection, then closes.
 * A live stream is only available during the initial POST /api/packs.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const pack = getPack(id);
  if (!pack) {
    return NextResponse.json({ error: 'Pack not found' }, { status: 404 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of pack.events) {
        controller.enqueue(encoder.encode(sseFrame(event)));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
