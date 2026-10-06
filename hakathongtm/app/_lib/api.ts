import type { ICPOutput, ICPAvatar } from "@/lib/icp-synthesizer";
import type { ClaudeAnalysis, RefinedAvatar } from "@/lib/claude-client";
import type { Generation, GenerationRecord } from "@/lib/generation-store";
import type { SponsorPackSettings } from "@/lib/sponsor-pack-client";

export type { ICPOutput, ICPAvatar, ClaudeAnalysis, RefinedAvatar, Generation, GenerationRecord };

export interface Row {
  fullName: string;
  title: string;
  company: string;
  linkedinUrl?: string;
  email?: string;
  location?: string;
  about?: string;
}

export interface UploadResp {
  ok: boolean;
  filename: string;
  valid_rows: number;
  skipped: number;
  warnings: string[];
  preview: Row[];
  rows: Row[];
  error?: string;
}

export interface HarvestResp {
  ok: boolean;
  mock: boolean;
  content_count: number;
  signal_count: number;
  activity_count: number;
  activity: { text: string; type: string; company?: string; author?: string }[];
  activity_full: { text: string; type: string; company?: string; author?: string }[];
  error?: string;
}

export interface AnalyzeResp {
  ok: boolean;
  analysis: ClaudeAnalysis;
  analyzed_count: number;
  error?: string;
}

export interface RefineResp {
  ok: boolean;
  pushed_keywords: string[];
  pushed_industries: string[];
  pushed_triggers: string[];
  refined_agent_id?: number;
  log: string[];
  error?: string;
}

export interface SignalLead {
  name: string;
  title?: string;
  linkedin_url?: string;
}

export interface Signal {
  id: number | string;
  type: string;
  summary: string;
  detected_at: string | null;
  lead: SignalLead | null;
  account: { name?: string; domain?: string } | null;
  mock?: boolean;
}

export interface SignalsResp {
  ok: boolean;
  mode: "live" | "mock";
  mock: boolean;
  count: number;
  signals: Signal[];
  live_error?: string;
  error?: string;
}

export interface EnrichedLead {
  name: string;
  title: string;
  company: string;
  linkedin_url: string;
  email: string;
  email_status: string;
  phone: string;
  confidence: number;
  location: string;
}

export interface EnrichResp {
  ok: boolean;
  mock: boolean;
  cached?: boolean;
  status?: string;
  credits?: number;
  lead: EnrichedLead;
  error?: string;
}

export interface OutreachEmail {
  subject: string;
  body: string;
}

export interface GenerateOutreachResp {
  ok: boolean;
  email: OutreachEmail;
  error?: string;
}

export interface SendOutreachResp {
  ok: boolean;
  id: string;
  sent_at: string;
  error?: string;
}

// A signal as delivered over the SSE stream (same shape as Signal, no mock flag).
export type StreamSignal = Omit<Signal, "mock">;

export interface StreamDone {
  count: number;
  mode: "live" | "mock";
  mock: boolean;
  cached: boolean;
  live_error?: string;
}

export interface RunRecord {
  run_id: string;
  created_at: string;
  csv_filename: string;
  row_count: number;
  avatar_count: number;
  signal_count: number;
}

export interface SponsorPackStatus {
  ok: boolean;
  packId: string;
  status: string;
  progressPercent: number;
  presentationEditUrl?: string;
  publicLandingPageUrl?: string;
  videoUrl?: string;
  videoAbsoluteUrl?: string;
  error?: string;
}

async function jsonPost<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  let data: T;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`HTTP ${res.status}: ${raw.slice(0, 200)}`);
  }
  if (!res.ok || (data as { ok?: boolean }).ok === false) {
    throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  }
  return data;
}

export const api = {
  async upload(file: File): Promise<UploadResp> {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    const data = (await res.json()) as UploadResp;
    if (!res.ok || !data.ok) throw new Error(data.error || "Upload failed");
    return data;
  },
  synthesize: (rows: Row[]) =>
    jsonPost<{ ok: boolean; icp: ICPOutput }>("/api/synthesize", { rows, signals: [] }),
  seedAccounts: (rows: Row[]) =>
    jsonPost<{ ok: boolean; accounts_pushed: number; leads_resolved: number; companies: string[] }>(
      "/api/seed-accounts",
      { rows }
    ),
  harvest: (rows?: Row[]) => jsonPost<HarvestResp>("/api/harvest", { rows: rows ?? [] }),
  analyze: (activity: HarvestResp["activity"], seedAvatars: unknown[], seedIndustries: string[]) =>
    jsonPost<AnalyzeResp>("/api/analyze", { activity, seedAvatars, seedIndustries }),
  refinePersona: (analysis: ClaudeAnalysis, location: string) =>
    jsonPost<RefineResp>("/api/refine-persona", { analysis, location }),
  async signals(mode: "live" | "mock" = "live"): Promise<SignalsResp> {
    const res = await fetch(`/api/signals?mode=${mode}`);
    const data = (await res.json()) as SignalsResp;
    if (!res.ok || !data.ok) throw new Error(data.error || "Signals failed");
    return data;
  },
  enrichLead: (lead: { name: string; title?: string; company?: string; linkedin_url?: string }) =>
    jsonPost<EnrichResp>("/api/enrich-lead", lead),
  /**
   * Open an SSE stream of signals that arrive one-by-one. Returns a cleanup
   * function that closes the stream.
   */
  streamSignals(
    mode: "live" | "mock",
    handlers: {
      onSignal: (s: StreamSignal) => void;
      onDone?: (d: StreamDone) => void;
      onError?: (message: string) => void;
    }
  ): () => void {
    const es = new EventSource(`/api/signals/stream?mode=${mode}`);
    es.addEventListener("signal", (e) => {
      try {
        handlers.onSignal(JSON.parse((e as MessageEvent).data) as StreamSignal);
      } catch {
        /* ignore malformed frame */
      }
    });
    es.addEventListener("done", (e) => {
      try {
        handlers.onDone?.(JSON.parse((e as MessageEvent).data) as StreamDone);
      } catch {
        /* ignore */
      }
      es.close();
    });
    es.addEventListener("error", (e) => {
      const data = (e as MessageEvent).data;
      handlers.onError?.(typeof data === "string" && data ? data : "stream connection error");
      es.close();
    });
    return () => es.close();
  },
  generateOutreach: (payload: {
    prospect: {
      name: string;
      title?: string;
      company?: string;
      signal_summary?: string;
      signal_type?: string;
      landing_page_url?: string;
      has_video_attachment?: boolean;
    };
    avatar?: RefinedAvatar | null;
    sender?: { sender_name?: string; org_name?: string; cause?: string };
  }) => jsonPost<GenerateOutreachResp>("/api/outreach/generate", payload),
  sendOutreach: (payload: {
    to: string;
    subject: string;
    text: string;
    name?: string;
    replyTo?: string;
    attachments?: { filename: string; content: string }[];
    videoUrl?: string;
  }) => jsonPost<SendOutreachResp>("/api/outreach/send", payload),
  generateSponsorPack: (payload: { avatar: RefinedAvatar; settings?: SponsorPackSettings }) =>
    jsonPost<{ ok: boolean; avatarId: string; packId: string; error?: string }>(
      "/api/sponsor-pack/generate",
      payload
    ),
  async listSponsorPacks(): Promise<Record<string, { avatarId: string; avatarLabel: string; packId: string; created_at: string }>> {
    const res = await fetch("/api/sponsor-pack/generate");
    const data = (await res.json()) as { ok: boolean; packs: Record<string, { avatarId: string; avatarLabel: string; packId: string; created_at: string }> };
    return data.packs ?? {};
  },
  async sponsorPackStatus(packId: string): Promise<SponsorPackStatus> {
    const res = await fetch(`/api/sponsor-pack/status?packId=${encodeURIComponent(packId)}`);
    const data = (await res.json()) as SponsorPackStatus & { error?: string };
    if (!res.ok) throw new Error(data.error || "Sponsor pack status failed");
    return data;
  },
  async processChat(formData: FormData): Promise<{ ok: boolean; generation: Generation; aiMessage: string }> {
    const res = await fetch("/api/chat", { method: "POST", body: formData });
    const data = (await res.json()) as { ok: boolean; generation: Generation; aiMessage: string } & { error?: string };
    if (!res.ok) throw new Error(data.error || "Chat processing failed");
    return data;
  },
  async listGenerations(): Promise<GenerationRecord[]> {
    const res = await fetch("/api/generations");
    const data = (await res.json()) as { ok: boolean; generations: GenerationRecord[] };
    return data.generations ?? [];
  },
  async getGeneration(id: string): Promise<Generation> {
    const res = await fetch(`/api/generations/${id}`);
    const data = (await res.json()) as { ok: boolean; generation: Generation };
    if (!res.ok) throw new Error("Generation not found");
    return data.generation;
  },
  createGeneration: (payload: Partial<Generation>) =>
    jsonPost<{ ok: boolean; generation: Generation }>("/api/generations", payload),
  async updateGeneration(id: string, payload: Partial<Generation>): Promise<Generation> {
    const res = await fetch(`/api/generations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await res.json()) as { ok: boolean; generation: Generation } & { error?: string };
    if (!res.ok) throw new Error(data.error || "Update failed");
    return data.generation;
  },
  async deleteGeneration(id: string): Promise<void> {
    await fetch(`/api/generations/${id}`, { method: "DELETE" });
  },
  saveRun: (payload: unknown) =>
    jsonPost<{ ok: boolean; run_id: string; saved_leads: number; runs: RunRecord[] }>(
      "/api/save-run",
      payload
    ),
  async runs(): Promise<RunRecord[]> {
    const res = await fetch("/api/save-run");
    const data = (await res.json()) as { runs: RunRecord[] };
    return data.runs ?? [];
  },
};
