'use client';

import { useState } from 'react';
import Link from 'next/link';

const DEFAULT_AVATAR =
  'Responsable RSE dans une maison de luxe. Veut associer la marque à des femmes leaders de la culture et de la création. Craint le greenwashing et veut des preuves d\'impact concret.';

const DEFAULT_COMPANY = {
  name: 'Wise Women',
  url: 'https://www.wisewomen.fr/',
  companyInfo: 'A French non-profit advancing women\'s empowerment and equal opportunity through education, mentorship and leadership programmes.',
  goal: 'Obtenir plus de sponsors',
  language: '',
  logoUrl: '',
  referenceImageUrls: '',
  speakerName: '',
  speakerInfo: '',
  speakerVoiceId: '',
};

interface SseEvent {
  step: string;
  ts: string;
  [key: string]: unknown;
}

export default function Home() {
  const [avatarText, setAvatarText] = useState(DEFAULT_AVATAR);
  const [company, setCompany] = useState(DEFAULT_COMPANY);
  const [logs, setLogs] = useState<SseEvent[]>([]);
  const [packId, setPackId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  async function startPipeline() {
    setLogs([]);
    setPackId(null);
    setRunning(true);

    const companyContext = {
      name: company.name,
      url: company.url,
      companyInfo: company.companyInfo || undefined,
      goal: company.goal,
      language: company.language || undefined,
      logoUrl: company.logoUrl || undefined,
      referenceImageUrls: company.referenceImageUrls
        .split(',')
        .map((u) => u.trim())
        .filter(Boolean),
      speaker: company.speakerName
        ? {
            name: company.speakerName,
            info: company.speakerInfo || undefined,
            voiceId: company.speakerVoiceId || undefined,
          }
        : undefined,
    };

    const res = await fetch('/api/packs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ avatarText, companyContext }),
    });

    const id = res.headers.get('X-Pack-Id');
    if (id) setPackId(id);

    const reader = res.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop() ?? '';
      for (const part of parts) {
        const line = part.replace(/^data: /, '').trim();
        if (!line) continue;
        try {
          const event = JSON.parse(line) as SseEvent;
          setLogs((prev) => [...prev, event]);
        } catch {}
      }
    }
    setRunning(false);
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-50 p-8">
      <div className="mx-auto max-w-4xl">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-purple-900">
            🎯 Wise Women – Sponsor Pack Generator
          </h1>
          <p className="mt-1 text-sm text-purple-600">
            Generate a Gamma presentation, landing page, voiceover and final MP4
            from a marketing avatar.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Inputs */}
          <div className="rounded-2xl bg-white p-6 shadow">
            <h2 className="mb-4 font-semibold text-gray-800">Avatar & Company</h2>
            <label className="mb-1 block text-xs font-medium text-gray-500 uppercase tracking-wide">
              Avatar text
            </label>
            <textarea
              className="mb-4 w-full rounded-lg border border-gray-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
              rows={4}
              value={avatarText}
              onChange={(e) => setAvatarText(e.target.value)}
            />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Company name
                </label>
                <input
                  className="w-full rounded-lg border border-gray-200 p-2 text-sm"
                  value={company.name}
                  onChange={(e) =>
                    setCompany({ ...company, name: e.target.value })
                  }
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Language (optional, auto-detected from avatar if empty)
                </label>
                <input
                  className="w-full rounded-lg border border-gray-200 p-2 text-sm"
                  placeholder="auto"
                  value={company.language}
                  onChange={(e) =>
                    setCompany({ ...company, language: e.target.value })
                  }
                />
              </div>
              <div className="col-span-2">
                <label className="mb-1 block text-xs font-medium text-gray-500 uppercase tracking-wide">
                  URL
                </label>
                <input
                  className="w-full rounded-lg border border-gray-200 p-2 text-sm"
                  value={company.url}
                  onChange={(e) =>
                    setCompany({ ...company, url: e.target.value })
                  }
                />
              </div>
              <div className="col-span-2">
                <label className="mb-1 block text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Goal
                </label>
                <input
                  className="w-full rounded-lg border border-gray-200 p-2 text-sm"
                  value={company.goal}
                  onChange={(e) =>
                    setCompany({ ...company, goal: e.target.value })
                  }
                />
              </div>
              <div className="col-span-2">
                <label className="mb-1 block text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Company info / mission
                </label>
                <textarea
                  className="w-full rounded-lg border border-gray-200 p-2 text-sm"
                  rows={2}
                  value={company.companyInfo}
                  onChange={(e) =>
                    setCompany({ ...company, companyInfo: e.target.value })
                  }
                />
              </div>
              <div className="col-span-2">
                <label className="mb-1 block text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Logo URL (optional)
                </label>
                <input
                  className="w-full rounded-lg border border-gray-200 p-2 text-sm"
                  placeholder="https://.../logo.png"
                  value={company.logoUrl}
                  onChange={(e) =>
                    setCompany({ ...company, logoUrl: e.target.value })
                  }
                />
              </div>
              <div className="col-span-2">
                <label className="mb-1 block text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Reference image URLs (optional, comma-separated)
                </label>
                <input
                  className="w-full rounded-lg border border-gray-200 p-2 text-sm"
                  placeholder="https://.../photo1.jpg, https://.../photo2.jpg"
                  value={company.referenceImageUrls}
                  onChange={(e) =>
                    setCompany({ ...company, referenceImageUrls: e.target.value })
                  }
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Speaker name (optional)
                </label>
                <input
                  className="w-full rounded-lg border border-gray-200 p-2 text-sm"
                  placeholder="e.g. Sarah Martin"
                  value={company.speakerName}
                  onChange={(e) =>
                    setCompany({ ...company, speakerName: e.target.value })
                  }
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Speaker info (optional)
                </label>
                <input
                  className="w-full rounded-lg border border-gray-200 p-2 text-sm"
                  placeholder="e.g. Co-founder & CEO"
                  value={company.speakerInfo}
                  onChange={(e) =>
                    setCompany({ ...company, speakerInfo: e.target.value })
                  }
                />
              </div>
              <div className="col-span-2">
                <label className="mb-1 block text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Speaker Gradium voice ID (optional, pins the exact voice)
                </label>
                <input
                  className="w-full rounded-lg border border-gray-200 p-2 text-sm"
                  placeholder="e.g. kbZq1iX34tHibquE"
                  value={company.speakerVoiceId}
                  onChange={(e) =>
                    setCompany({ ...company, speakerVoiceId: e.target.value })
                  }
                />
              </div>
            </div>
            <button
              onClick={startPipeline}
              disabled={running}
              className="mt-5 w-full rounded-xl bg-purple-600 py-3 text-sm font-semibold text-white transition hover:bg-purple-700 disabled:opacity-50"
            >
              {running ? 'Running pipeline…' : '▶ Generate Sponsor Pack'}
            </button>
            {packId && (
              <p className="mt-3 text-center text-xs text-gray-500">
                Pack ID:{' '}
                <Link
                  href={`/packs/${packId}`}
                  className="font-mono text-purple-600 underline"
                >
                  {packId}
                </Link>
              </p>
            )}
          </div>

          {/* Live log */}
          <div className="rounded-2xl bg-gray-900 p-5 shadow">
            <h2 className="mb-3 font-semibold text-gray-100">Live events</h2>
            <div className="h-96 overflow-y-auto space-y-1 font-mono text-xs">
              {logs.length === 0 && (
                <p className="text-gray-500">Waiting for pipeline to start…</p>
              )}
              {logs.map((e, i) => (
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
                  {Object.entries(e)
                    .filter(([k]) => !['step', 'ts'].includes(k))
                    .map(([k, v]) => (
                      <span key={k} className="text-gray-400">
                        {k}=
                        <span className="text-white">
                          {String(v).slice(0, 60)}
                        </span>{' '}
                      </span>
                    ))}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Pack link */}
        {packId && (
          <div className="mt-6 rounded-2xl bg-white p-5 shadow">
            <h2 className="mb-2 font-semibold text-gray-800">Result</h2>
            <Link
              href={`/packs/${packId}`}
              className="text-sm text-purple-600 underline"
            >
              View pack details →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
