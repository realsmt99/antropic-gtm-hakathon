"use client";

import { useRef, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { PaperPlaneRight, Paperclip, FileCsv, Image, X, CircleNotch } from "@phosphor-icons/react";

export function ChatInput({
  onSubmit,
  loading,
  placeholder = "Describe your project, attach a donor CSV or logo, and let the AI set everything up…",
}: {
  onSubmit: (formData: FormData) => void;
  loading?: boolean;
  placeholder?: string;
}) {
  const [text, setText] = useState("");
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [referenceImages, setReferenceImages] = useState<File[]>([]);

  const csvRef = useRef<HTMLInputElement>(null);
  const logoRef = useRef<HTMLInputElement>(null);
  const refsRef = useRef<HTMLInputElement>(null);

  const submit = useCallback(() => {
    if (!text.trim() && !csvFile && !logoFile && referenceImages.length === 0) return;
    const fd = new FormData();
    fd.append("text", text.trim());
    if (csvFile) fd.append("csv", csvFile);
    if (logoFile) fd.append("logo", logoFile);
    referenceImages.forEach((f) => fd.append("referenceImages", f));
    onSubmit(fd);
  }, [text, csvFile, logoFile, referenceImages, onSubmit]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className="w-full max-w-2xl"
    >
      <div className="rounded-2xl border border-border bg-surface p-3 shadow-sm">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={3}
          className="w-full resize-none rounded-xl bg-transparent px-3 py-2 text-[15px] leading-6 text-foreground outline-none placeholder:text-muted"
          placeholder={placeholder}
          disabled={loading}
        />

        <div className="mt-2 flex flex-wrap gap-2">
          {csvFile && (
            <AttachmentChip
              icon={<FileCsv size={14} weight="bold" />}
              label={csvFile.name}
              onRemove={() => setCsvFile(null)}
            />
          )}
          {logoFile && (
            <AttachmentChip
              icon={<Image size={14} weight="bold" />}
              label={logoFile.name}
              onRemove={() => setLogoFile(null)}
            />
          )}
          {referenceImages.map((f, i) => (
            <AttachmentChip
              key={`${f.name}-${i}`}
              icon={<Image size={14} weight="bold" />}
              label={f.name}
              onRemove={() => setReferenceImages((prev) => prev.filter((_, idx) => idx !== i))}
            />
          ))}
        </div>

        <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => csvRef.current?.click()}
              disabled={loading}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-muted transition-colors hover:bg-background hover:text-foreground"
            >
              <FileCsv size={16} weight="bold" /> CSV
            </button>
            <button
              type="button"
              onClick={() => logoRef.current?.click()}
              disabled={loading}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-muted transition-colors hover:bg-background hover:text-foreground"
            >
              <Image size={16} weight="bold" /> Logo
            </button>
            <button
              type="button"
              onClick={() => refsRef.current?.click()}
              disabled={loading}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-muted transition-colors hover:bg-background hover:text-foreground"
            >
              <Paperclip size={16} weight="bold" /> References
            </button>
          </div>

          <button
            type="button"
            onClick={submit}
            disabled={loading || (!text.trim() && !csvFile && !logoFile && referenceImages.length === 0)}
            className="flex items-center gap-1.5 rounded-lg bg-foreground px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-[#1f2325] disabled:opacity-50"
          >
            {loading ? (
              <CircleNotch size={16} weight="bold" className="animate-spin" />
            ) : (
              <PaperPlaneRight size={16} weight="fill" />
            )}
            {loading ? "Thinking…" : "Send"}
          </button>
        </div>
      </div>

      <input
        ref={csvRef}
        type="file"
        accept=".csv,.txt"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.[0]) setCsvFile(e.target.files[0]);
        }}
      />
      <input
        ref={logoRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.[0]) setLogoFile(e.target.files[0]);
        }}
      />
      <input
        ref={refsRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) setReferenceImages((prev) => [...prev, ...Array.from(e.target.files!)]);
        }}
      />
    </motion.div>
  );
}

function AttachmentChip({
  icon,
  label,
  onRemove,
}: {
  icon: React.ReactNode;
  label: string;
  onRemove: () => void;
}) {
  return (
    <span className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-2 py-1 text-[11px] text-foreground">
      <span className="text-muted">{icon}</span>
      <span className="max-w-[120px] truncate">{label}</span>
      <button onClick={onRemove} className="text-muted hover:text-foreground">
        <X size={12} weight="bold" />
      </button>
    </span>
  );
}
