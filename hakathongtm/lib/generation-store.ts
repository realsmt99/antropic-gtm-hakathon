import { randomUUID } from "crypto";
import { saveJSON, loadJSON } from "./memory-store";
import type { ICPOutput } from "./icp-synthesizer";
import type { ClaudeAnalysis, RefinedAvatar } from "./claude-client";
import type { LinkedInRow } from "./csv-parser";
import type { SponsorPackStatus } from "@/app/_lib/api";

export interface CompanyContext {
  name: string;
  url: string;
  companyInfo?: string;
  goal?: string;
  language?: string;
  logoUrl?: string;
  referenceImageUrls?: string[];
  speaker?: { name: string; info?: string; voiceId?: string };
}

export interface Generation {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  phase: "upload" | "thinking" | "graph" | "crm";
  userMessage?: string;
  aiMessage?: string;
  filename?: string;
  rows: LinkedInRow[];
  row_count: number;
  icp: ICPOutput | null;
  analysis: ClaudeAnalysis | null;
  companyContext: CompanyContext;
  seeded: boolean;
  signal_count: number;
  saved_run_id?: string;
  sponsor_packs: Record<string, SponsorPackStatus>;
  avatar_count: number;
}

export interface GenerationRecord {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  phase: Generation["phase"];
  row_count: number;
  avatar_count: number;
  signal_count: number;
  overview?: string;
}

function indexPath() {
  return "generations_index";
}

function generationPath(id: string) {
  return `generation_${id}`;
}

export function listGenerations(): GenerationRecord[] {
  return loadJSON<GenerationRecord[]>(indexPath()) ?? [];
}

export function loadGeneration(id: string): Generation | null {
  return loadJSON<Generation>(generationPath(id));
}

export function deleteGeneration(id: string): boolean {
  const index = listGenerations();
  const next = index.filter((g) => g.id !== id);
  if (next.length === index.length) return false;
  saveJSON(indexPath(), next);
  return true;
}

export function saveGeneration(generation: Generation): void {
  saveJSON(generationPath(generation.id), generation);

  const index = listGenerations();
  const record: GenerationRecord = {
    id: generation.id,
    name: generation.name,
    created_at: generation.created_at,
    updated_at: generation.updated_at,
    phase: generation.phase,
    row_count: generation.row_count,
    avatar_count: generation.avatar_count,
    signal_count: generation.signal_count,
    overview: generation.analysis?.overview,
  };

  const existing = index.findIndex((g) => g.id === generation.id);
  if (existing >= 0) {
    index[existing] = record;
  } else {
    index.unshift(record);
  }
  saveJSON(indexPath(), index);
}

export function createGeneration(partial: Partial<Generation> & { name: string; companyContext: CompanyContext }): Generation {
  const now = new Date().toISOString();
  const generation: Generation = {
    id: partial.id ?? randomUUID(),
    name: partial.name,
    created_at: partial.created_at ?? now,
    updated_at: now,
    phase: partial.phase ?? "upload",
    userMessage: partial.userMessage,
    aiMessage: partial.aiMessage,
    filename: partial.filename,
    rows: partial.rows ?? [],
    row_count: partial.rows?.length ?? 0,
    icp: partial.icp ?? null,
    analysis: partial.analysis ?? null,
    companyContext: partial.companyContext,
    seeded: partial.seeded ?? false,
    signal_count: partial.signal_count ?? 0,
    saved_run_id: partial.saved_run_id,
    sponsor_packs: partial.sponsor_packs ?? {},
    avatar_count: partial.analysis?.refined_avatars.length ?? partial.icp?.avatars.length ?? 0,
  };
  saveGeneration(generation);
  return generation;
}

export function updateGeneration(id: string, patch: Partial<Generation>): Generation | null {
  const existing = loadGeneration(id);
  if (!existing) return null;
  const updated: Generation = {
    ...existing,
    ...patch,
    id: existing.id,
    updated_at: new Date().toISOString(),
    avatar_count:
      patch.analysis?.refined_avatars.length ??
      patch.icp?.avatars.length ??
      existing.analysis?.refined_avatars.length ??
      existing.icp?.avatars.length ??
      0,
    row_count: patch.rows?.length ?? existing.rows.length,
  };
  saveGeneration(updated);
  return updated;
}
