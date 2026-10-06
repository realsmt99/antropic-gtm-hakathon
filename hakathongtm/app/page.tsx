"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Sparkle, ClockCounterClockwise, ArrowCounterClockwise, WarningCircle } from "@phosphor-icons/react";
import { ChatInput } from "./_components/ChatInput";
import { GenerationList } from "./_components/GenerationList";
import { ThinkingStream, type ThinkStep } from "./_components/ThinkingStream";
import { GraphStage } from "./_components/GraphStage";
import { CRMStage } from "./_components/CRMStage";
import { SavedRuns } from "./_components/SavedRuns";
import { api } from "./_lib/api";
import type { Row, ICPOutput, ClaudeAnalysis, RunRecord, Generation, GenerationRecord } from "./_lib/api";

type Phase = "upload" | "thinking" | "graph" | "crm";

const INITIAL_STEPS: ThinkStep[] = [
  { key: "parse", label: "Reading your donor list and validating rows", status: "pending" },
  { key: "baseline", label: "Sketching baseline patron avatars", status: "pending" },
  { key: "seed", label: "Tracking the donors in Sillage (people-first)", status: "pending" },
  { key: "harvest", label: "Harvesting their real LinkedIn activity", status: "pending" },
  { key: "analyze", label: "Claude is profiling the fundable-patron archetypes", status: "pending" },
];

export default function Home() {
  const [phase, setPhase] = useState<Phase>("upload");
  const [steps, setSteps] = useState<ThinkStep[]>(INITIAL_STEPS);
  const [rows, setRows] = useState<Row[]>([]);
  const [filename, setFilename] = useState("upload.csv");
  const [icp, setIcp] = useState<ICPOutput | null>(null);
  const [analysis, setAnalysis] = useState<ClaudeAnalysis | null>(null);
  const [companyContext, setCompanyContext] = useState<Generation["companyContext"] | null>(null);
  const [generation, setGeneration] = useState<Generation | null>(null);
  const [pushing, setPushing] = useState(false);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [savedOpen, setSavedOpen] = useState(false);
  const [generations, setGenerations] = useState<GenerationRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    try {
      setRuns(await api.runs());
    } catch {
      /* ignore */
    }
  }, []);

  const loadGenerations = useCallback(async () => {
    try {
      setGenerations(await api.listGenerations());
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    loadRuns();
    loadGenerations();
  }, [loadRuns, loadGenerations]);

  function patch(key: string, status: ThinkStep["status"], detail?: string) {
    setSteps((prev) => prev.map((s) => (s.key === key ? { ...s, status, detail: detail ?? s.detail } : s)));
  }

  function syncSteps(gen: Generation) {
    setSteps(
      INITIAL_STEPS.map((s) => {
        if (s.key === "parse") return { ...s, status: gen.rows.length ? "done" : "pending", detail: gen.rows.length ? `${gen.rows.length} rows` : undefined };
        if (s.key === "baseline") return { ...s, status: gen.icp ? "done" : "pending", detail: gen.icp ? `${gen.icp.avatars.length} baseline avatars` : undefined };
        if (s.key === "seed") return { ...s, status: gen.seeded ? "done" : "pending", detail: gen.seeded ? "patrons tracked" : undefined };
        if (s.key === "harvest") return { ...s, status: gen.analysis ? "done" : "pending", detail: gen.analysis ? `${gen.signal_count} signals` : undefined };
        if (s.key === "analyze") return { ...s, status: gen.analysis ? "done" : "pending", detail: gen.analysis ? `${gen.analysis.refined_avatars.length} refined avatars` : undefined };
        return s;
      })
    );
  }

  function restoreGeneration(gen: Generation) {
    setGeneration(gen);
    setRows(gen.rows as Row[]);
    setFilename(gen.filename || "upload.csv");
    setIcp(gen.icp);
    setAnalysis(gen.analysis);
    setCompanyContext(gen.companyContext);
    syncSteps(gen);
  }

  async function runPipeline(gen: Generation) {
    let currentGen = { ...gen };
    let currentStep = "";
    setLoading(true);
    setError(null);
    setPhase("thinking");
    syncSteps(currentGen);

    try {
      if (!currentGen.rows || currentGen.rows.length === 0) {
        throw new Error("No donor rows. Describe your donors or attach a CSV.");
      }

      patch("parse", "done", `${currentGen.rows.length} rows`);

      if (!currentGen.icp) {
        currentStep = "baseline";
        patch("baseline", "active");
        const synth = await api.synthesize(currentGen.rows);
        currentGen = { ...currentGen, icp: synth.icp, row_count: currentGen.rows.length, avatar_count: synth.icp.avatars.length };
        setIcp(synth.icp);
        await api.updateGeneration(currentGen.id, { icp: synth.icp, row_count: currentGen.rows.length, avatar_count: synth.icp.avatars.length });
        patch("baseline", "done", `${synth.icp.avatars.length} baseline avatars · ${synth.icp.sillage_feed_parameters.target_industries.length} industries`);
      } else {
        setIcp(currentGen.icp);
        patch("baseline", "done", `${currentGen.icp.avatars.length} baseline avatars · ${currentGen.icp.sillage_feed_parameters.target_industries.length} industries`);
      }

      if (!currentGen.seeded) {
        currentStep = "seed";
        patch("seed", "active");
        const seed = await api.seedAccounts(currentGen.rows);
        currentGen = { ...currentGen, seeded: true };
        await api.updateGeneration(currentGen.id, { seeded: true });
        patch("seed", "done", `${seed.leads_resolved} patrons resolved · ${seed.accounts_pushed} accounts tracked`);
      } else {
        patch("seed", "done", "already tracked");
      }

      if (!currentGen.analysis) {
        currentStep = "harvest";
        patch("harvest", "active");
        const harvest = await api.harvest(currentGen.rows);
        const signalCount = harvest.signal_count ?? 0;
        currentGen = { ...currentGen, signal_count: signalCount };
        await api.updateGeneration(currentGen.id, { signal_count: signalCount });
        patch(
          "harvest",
          "done",
          `${harvest.activity_count} activity items${harvest.mock ? " (simulated)" : ""} · ${harvest.content_count} posts/comments · ${signalCount} signals`
        );

        currentStep = "analyze";
        patch("analyze", "active");
        const seedAvatars = currentGen.icp!.avatars.map((a) => ({ label: a.label, dominantIndustry: a.dominantIndustry, seniority: a.seniority }));
        const analyzed = await api.analyze(
          harvest.activity_full,
          seedAvatars,
          currentGen.icp!.sillage_feed_parameters.target_industries
        );
        currentGen = { ...currentGen, analysis: analyzed.analysis, phase: "graph", avatar_count: analyzed.analysis.refined_avatars.length };
        setAnalysis(analyzed.analysis);
        await api.updateGeneration(currentGen.id, { analysis: analyzed.analysis, phase: "graph", avatar_count: analyzed.analysis.refined_avatars.length, signal_count: signalCount });
        patch("analyze", "done", `${analyzed.analysis.refined_avatars.length} refined avatars from ${analyzed.analyzed_count} items`);
      } else {
        setAnalysis(currentGen.analysis);
        patch("harvest", "done", `${currentGen.signal_count} signals`);
        patch("analyze", "done", `${currentGen.analysis.refined_avatars.length} refined avatars`);
      }

      setGeneration(currentGen);
      setPhase("graph");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong";
      if (currentStep) patch(currentStep, "error", msg);
      else patch("parse", "error", msg);
      setError(msg);
      setPhase("upload");
    } finally {
      setLoading(false);
    }
  }

  async function onChatSubmit(formData: FormData) {
    setLoading(true);
    setError(null);
    try {
      const { generation: gen } = await api.processChat(formData);
      restoreGeneration(gen);
      if (gen.phase === "graph" || gen.phase === "crm") {
        setPhase(gen.phase);
      } else {
        await runPipeline(gen);
      }
      await loadGenerations();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function continueGeneration(id: string) {
    setLoading(true);
    setError(null);
    try {
      const gen = await api.getGeneration(id);
      restoreGeneration(gen);
      if (gen.phase === "graph" || gen.phase === "crm") {
        setPhase(gen.phase);
      } else {
        await runPipeline(gen);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function deleteGeneration(id: string) {
    await api.deleteGeneration(id);
    await loadGenerations();
    if (generation?.id === id) reset();
  }

  async function pushPersona() {
    if (!analysis || !generation) return;
    setPushing(true);
    try {
      const locCount: Record<string, number> = {};
      rows.forEach((r) => {
        if (r.location) locCount[r.location] = (locCount[r.location] || 0) + 1;
      });
      const location = Object.entries(locCount).sort((a, b) => b[1] - a[1])[0]?.[0] || "Paris, France";
      await api.refinePersona(analysis, location);
      const updated = await api.updateGeneration(generation.id, { phase: "crm" });
      setGeneration(updated);
      setPhase("crm");
    } catch {
      /* stay on graph */
    } finally {
      setPushing(false);
    }
  }

  function reset() {
    setPhase("upload");
    setSteps(INITIAL_STEPS.map((s) => ({ ...s })));
    setRows([]);
    setFilename("upload.csv");
    setIcp(null);
    setAnalysis(null);
    setCompanyContext(null);
    setGeneration(null);
    setError(null);
  }

  return (
    <>
      <div className="ambient drift" />

      {/* Header */}
      <header className="relative z-30 flex items-center justify-between px-6 py-4">
        <button onClick={reset} className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-foreground text-white">
            <Sparkle size={15} weight="fill" />
          </span>
          <span className="text-[14px] font-medium tracking-tight text-foreground">Mécène · Patron Radar</span>
        </button>

        <div className="flex items-center gap-2">
          {phase !== "upload" && (
            <button
              onClick={reset}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-[12px] text-foreground transition-colors hover:border-foreground/30"
            >
              <ArrowCounterClockwise size={13} weight="bold" /> New
            </button>
          )}
          <button
            onClick={() => setSavedOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-[12px] text-foreground transition-colors hover:border-foreground/30"
          >
            <ClockCounterClockwise size={13} weight="bold" /> Saved
            {runs.length > 0 && (
              <span className="ml-0.5 rounded-full bg-foreground px-1.5 text-[10px] text-white">{runs.length}</span>
            )}
          </button>
        </div>
      </header>

      <main className="relative flex-1">
        <AnimatePresence mode="wait">
          {phase === "upload" && (
            <motion.div
              key="upload"
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="relative z-10 flex min-h-[80vh] flex-col items-center px-6 py-12 text-center"
            >
              <motion.div
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                className="max-w-2xl"
              >
                <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs uppercase tracking-[0.12em] text-muted">
                  Mécène · Patron Radar
                </div>
                <h1 className="font-serif text-5xl leading-[1.05] tracking-[-0.02em] text-foreground sm:text-6xl">
                  Tell us about your cause,
                  <br />
                  let the AI find your patrons.
                </h1>
                <p className="mx-auto mt-5 max-w-lg text-[15px] leading-7 text-muted">
                  Describe your project, attach a donor CSV, your logo, or reference images. We parse the input, build
                  the fundable-patron archetypes, and surface the right corporate foundations.
                </p>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, delay: 0.12, ease: [0.16, 1, 0.3, 1] }}
                className="mt-10 flex w-full flex-col items-center"
              >
                {error && (
                  <div className="mb-4 flex w-full max-w-2xl items-center gap-2 rounded-xl border border-[#f4c5c5] bg-[#faeaea] px-4 py-3 text-[13px] text-[#b91c1c]">
                    <WarningCircle size={16} weight="fill" /> {error}
                  </div>
                )}
                <ChatInput onSubmit={onChatSubmit} loading={loading} />
                <GenerationList generations={generations} onContinue={continueGeneration} onDelete={deleteGeneration} onNew={reset} />
              </motion.div>
            </motion.div>
          )}
          {phase === "thinking" && (
            <motion.div key="thinking" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <ThinkingStream steps={steps} />
            </motion.div>
          )}
          {phase === "graph" && icp && analysis && (
            <motion.div key="graph" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <GraphStage icp={icp} analysis={analysis} companyContext={companyContext ?? undefined} pushing={pushing} onPush={pushPersona} />
            </motion.div>
          )}
          {phase === "crm" && icp && analysis && (
            <motion.div key="crm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <CRMStage
                icp={icp}
                analysis={analysis}
                companyContext={companyContext ?? undefined}
                csvFilename={filename}
                rowCount={rows.length}
                onSaved={setRuns}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <SavedRuns open={savedOpen} runs={runs} onClose={() => setSavedOpen(false)} />
    </>
  );
}
