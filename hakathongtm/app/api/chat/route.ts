import { NextRequest, NextResponse } from "next/server";
import { writeFileSync, mkdirSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { parseLinkedInCSV } from "@/lib/csv-parser";
import { processChatInput } from "@/lib/chat-input";
import { createGeneration, type CompanyContext } from "@/lib/generation-store";
import { saveJSON } from "@/lib/memory-store";

export const dynamic = "force-dynamic";

const PUBLIC_UPLOADS = path.join(process.cwd(), "public", "uploads");
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001").replace(/\/$/, "");

function ensureUploadDir(subdir: string) {
  mkdirSync(path.join(PUBLIC_UPLOADS, subdir), { recursive: true });
}

async function savePublicFile(file: File, subdir: string): Promise<string> {
  const ext = path.extname(file.name) || ".bin";
  const id = randomUUID();
  const filename = `${id}${ext}`;
  ensureUploadDir(subdir);
  const filePath = path.join(PUBLIC_UPLOADS, subdir, filename);
  const buf = await file.arrayBuffer();
  writeFileSync(filePath, Buffer.from(buf));
  return `${APP_URL}/uploads/${subdir}/${filename}`;
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const text = (formData.get("text") as string) || "";
    const csvFile = formData.get("csv") as File | null;
    const logoFile = formData.get("logo") as File | null;
    const referenceImages = formData.getAll("referenceImages") as File[];

    let providedRows = undefined;
    let filename = undefined;
    if (csvFile) {
      const csvText = await csvFile.text();
      const parsed = parseLinkedInCSV(csvText);
      providedRows = parsed.rows;
      filename = csvFile.name;
    }

    const logoUrl = logoFile ? await savePublicFile(logoFile, "logos") : undefined;
    const referenceImageUrls = await Promise.all(
      referenceImages.filter((f) => f.size > 0).map((f) => savePublicFile(f, "refs"))
    );

    const { companyContext, rows, aiMessage } = await processChatInput(
      text,
      providedRows,
      logoUrl,
      referenceImageUrls.length > 0 ? referenceImageUrls : undefined
    );

    const mergedContext: CompanyContext = {
      ...companyContext,
      logoUrl: logoUrl ?? companyContext.logoUrl,
      referenceImageUrls: referenceImageUrls.length > 0 ? referenceImageUrls : companyContext.referenceImageUrls,
    };

    saveJSON("latest_rows", { rows, uploaded_at: new Date().toISOString() });

    const name = text.trim().slice(0, 60) || (filename ? `Upload: ${filename}` : "Untitled generation");
    const generation = createGeneration({
      name,
      userMessage: text,
      aiMessage,
      filename,
      rows,
      companyContext: mergedContext,
      phase: "upload",
    });

    return NextResponse.json({ ok: true, generation, aiMessage });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
