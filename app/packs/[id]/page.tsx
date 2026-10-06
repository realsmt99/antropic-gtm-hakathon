'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface SlideAsset {
  index: number;
  title: string;
  slideText: string;
  voiceoverScript: string;
  imagePath?: string;
  audioPath?: string;
  videoPath?: string;
}

interface Pack {
  id: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  companyContext: { name: string; url: string; goal: string; language?: string };
  presentationEditUrl?: string;
  publicLandingPageUrl?: string;
  videoUrl?: string;
  voiceId?: string;
  themeName?: string;
  progressPercent?: number;
  slides: SlideAsset[];
  events: { step: string; ts: string; [key: string]: unknown }[];
  error?: string;
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    done: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-700',
    pending: 'bg-gray-100 text-gray-600',
  };
  const cls = colors[status] ?? 'bg-purple-100 text-purple-700';
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${cls}`}>
      {status}
    </span>
  );
}

export default function PackPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [pack, setPack] = useState<Pack | null>(null);
  const [resolvedId, setResolvedId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    params.then(({ id }) => {
      setResolvedId(id);
    });
  }, [params]);

  useEffect(() => {
    if (!resolvedId) return;

    async function load() {
      const res = await fetch(`/api/packs/${resolvedId}`);
      if (!res.ok) {
        setError('Pack not found');
        return;
      }
      const data = (await res.json()) as Pack;
      setPack(data);
    }

    load();
    const interval = setInterval(load, 3_000);
    return () => clearInterval(interval);
  }, [resolvedId]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-red-600">{error}</p>
      </div>
    );
  }

  if (!pack) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-gray-500">Loading…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-50 p-8">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex items-center gap-3">
          <Link href="/" className="text-sm text-purple-600 underline">
            ← Dashboard
          </Link>
          <h1 className="text-xl font-bold text-purple-900">
            {pack.companyContext.name} – Pack
          </h1>
          <StatusBadge status={pack.status} />
        </div>

        <div className="grid gap-4 sm:grid-cols-3 mb-6">
          <Stat label="Created" value={new Date(pack.createdAt).toLocaleString()} />
          <Stat label="Updated" value={new Date(pack.updatedAt).toLocaleString()} />
          <Stat label="Voice" value={pack.voiceId ?? '—'} />
          <Stat label="Theme" value={pack.themeName ?? '—'} />
        </div>

        {/* Progress bar */}
        <div className="mb-6 rounded-2xl bg-white p-5 shadow">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-semibold text-gray-800">Progress</span>
            <span className="text-gray-500">{pack.progressPercent ?? 0}%</span>
          </div>
          <div className="h-2 w-full rounded-full bg-gray-100">
            <div
              className="h-2 rounded-full bg-purple-600 transition-all"
              style={{ width: `${pack.progressPercent ?? 0}%` }}
            />
          </div>
        </div>

        {/* Assets */}
        <div className="mb-6 rounded-2xl bg-white p-5 shadow">
          <h2 className="mb-3 font-semibold text-gray-800">Assets</h2>
          <div className="space-y-2 text-sm">
            {pack.presentationEditUrl && (
              <a
                href={pack.presentationEditUrl}
                target="_blank"
                rel="noopener"
                className="flex items-center gap-2 text-purple-600 underline"
              >
                ✏️ Edit Presentation in Gamma
              </a>
            )}
            {pack.publicLandingPageUrl && (
              <a
                href={pack.publicLandingPageUrl}
                target="_blank"
                rel="noopener"
                className="flex items-center gap-2 text-purple-600 underline"
              >
                🌐 Public Landing Page (share with sponsors)
              </a>
            )}
            {pack.videoUrl && (
              <div>
                <p className="mb-1 font-medium text-gray-700">🎬 Final Video</p>
                <video
                  src={pack.videoUrl}
                  controls
                  className="rounded-lg w-full max-w-lg"
                />
              </div>
            )}
            {pack.error && (
              <p className="text-red-600">Error: {pack.error}</p>
            )}
          </div>
        </div>

        {/* Slides */}
        {pack.slides.length > 0 && (
          <div className="mb-6 rounded-2xl bg-white p-5 shadow">
            <h2 className="mb-3 font-semibold text-gray-800">
              Slides ({pack.slides.length})
            </h2>
            <div className="space-y-3">
              {pack.slides.map((s) => (
                <div
                  key={s.index}
                  className="rounded-lg border border-gray-100 p-3"
                >
                  <p className="font-medium text-gray-800">
                    {s.index + 1}. {s.title}
                  </p>
                  <p className="mt-1 text-sm text-gray-500">{s.slideText}</p>
                  <p className="mt-1 text-sm italic text-purple-500">
                    🎙️ {s.voiceoverScript}
                  </p>
                  <div className="mt-2 flex gap-3 text-xs text-gray-400">
                    {s.imagePath && <span>✅ Image</span>}
                    {s.audioPath && <span>✅ Audio</span>}
                    {s.videoPath && <span>✅ Video</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Events log */}
        <div className="rounded-2xl bg-gray-900 p-5 shadow">
          <h2 className="mb-3 font-semibold text-gray-100">Event log</h2>
          <div className="max-h-80 overflow-y-auto space-y-1 font-mono text-xs">
            {pack.events.map((e, i) => (
              <div
                key={i}
                className={`rounded px-2 py-1 ${
                  e.step === 'done'
                    ? 'bg-green-800 text-green-100'
                    : e.step === 'failed'
                      ? 'bg-red-800 text-red-100'
                      : 'bg-gray-800 text-gray-200'
                }`}
              >
                <span className="text-purple-400">{e.step}</span>{' '}
                <span className="text-gray-500">{e.ts}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white p-4 shadow">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
        {label}
      </p>
      <p className="mt-1 truncate text-sm font-semibold text-gray-700">{value}</p>
    </div>
  );
}
