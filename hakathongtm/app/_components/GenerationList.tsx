"use client";

import { motion } from "framer-motion";
import { ClockCounterClockwise, Trash, ArrowRight, PlayCircle, Sparkle } from "@phosphor-icons/react";
import type { GenerationRecord } from "@/lib/generation-store";

export function GenerationList({
  generations,
  onContinue,
  onDelete,
  onNew,
}: {
  generations: GenerationRecord[];
  onContinue: (id: string) => void;
  onDelete: (id: string) => void;
  onNew?: () => void;
}) {
  if (generations.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="mt-8 text-center"
      >
        <p className="text-[13px] text-muted">No generations yet. Start your first one above.</p>
      </motion.div>
    );
  }

  const phaseLabel = (phase: string) => {
    switch (phase) {
      case "upload":
        return "Draft";
      case "thinking":
        return "Thinking";
      case "graph":
        return "Patron graph";
      case "crm":
        return "CRM";
      default:
        return phase;
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-10 w-full max-w-2xl"
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[13px] font-medium text-foreground">
          <ClockCounterClockwise size={15} weight="bold" className="text-muted" />
          Previous generations
        </div>
        {onNew && (
          <button
            onClick={onNew}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:bg-surface hover:text-foreground"
          >
            <Sparkle size={12} weight="fill" /> New
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2.5">
        {generations.map((g) => (
          <div
            key={g.id}
            className="flex items-center justify-between rounded-xl border border-border bg-surface px-4 py-3 transition-colors hover:border-foreground/20"
          >
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium text-foreground">{g.name}</p>
              <p className="mt-0.5 font-mono text-[10px] text-muted">
                {new Date(g.created_at).toLocaleString()} · {phaseLabel(g.phase)} · {g.row_count} rows · {g.avatar_count} avatars
                {g.signal_count > 0 ? ` · ${g.signal_count} signals` : ""}
              </p>
            </div>
            <div className="flex items-center gap-1 pl-3">
              <button
                onClick={() => onDelete(g.id)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-background hover:text-[#c2410c]"
                aria-label="Delete generation"
              >
                <Trash size={14} weight="bold" />
              </button>
              <button
                onClick={() => onContinue(g.id)}
                className="flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-[#1f2325]"
              >
                {g.phase === "upload" ? (
                  <>
                    <PlayCircle size={13} weight="fill" /> Start
                  </>
                ) : (
                  <>
                    Continue <ArrowRight size={13} weight="bold" />
                  </>
                )}
              </button>
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}
