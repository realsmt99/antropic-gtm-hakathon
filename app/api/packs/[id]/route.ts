import { NextRequest, NextResponse } from 'next/server';
import { getPack } from '@/lib/store';
import { computePackProgress } from '@/lib/progress';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const pack = getPack(id);
  if (!pack) {
    return NextResponse.json({ error: 'Pack not found' }, { status: 404 });
  }
  // presentationEditUrl: open in Gamma as the API key's owner to edit.
  // publicLandingPageUrl: the published Gamma site, viewable by anyone.
  const progress = computePackProgress(pack);
  return NextResponse.json({
    ...pack,
    presentationEditUrl: progress.presentationEditUrl,
    publicLandingPageUrl: progress.publicLandingPageUrl,
    progressPercent: progress.progressPercent,
    ready: progress.ready,
  });
}
