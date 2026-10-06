import { NextRequest, NextResponse } from 'next/server';
import { getPack } from '@/lib/store';
import { computePackProgress } from '@/lib/progress';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/packs/:id/progress
 * Lightweight polling endpoint: current status, progress percent, which
 * artifacts are ready, and direct URLs (public landing page, presentation
 * edit link, final video) as soon as each becomes available.
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
  return NextResponse.json(computePackProgress(pack));
}
