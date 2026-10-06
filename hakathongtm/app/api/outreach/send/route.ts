import { NextRequest, NextResponse } from "next/server";
import { saveJSON, loadJSON } from "@/lib/memory-store";
import { downloadVideoBase64 } from "@/lib/sponsor-pack-client";

export const dynamic = "force-dynamic";

const RESEND_API_KEY = process.env.RESEND_API_KEY ?? "";
// User chose "real prospects + my domain": send from a verified domain address.
// RESEND_FROM (full "Name <email>") wins; otherwise build one from
// RESEND_FROM_MAIL + OUTREACH_ORG_NAME (falls back to a generic label).
const RESEND_FROM =
  process.env.RESEND_FROM ||
  (process.env.RESEND_FROM_MAIL
    ? `${process.env.OUTREACH_ORG_NAME || "Wise Women"} <${process.env.RESEND_FROM_MAIL}>`
    : "");

interface SentRecord {
  id: string;
  to: string;
  subject: string;
  from: string;
  sent_at: string;
  name?: string;
}

function logSend(rec: SentRecord) {
  const log = loadJSON<SentRecord[]>("outreach_log") ?? [];
  log.unshift(rec);
  saveJSON("outreach_log", log.slice(0, 200));
}

interface Attachment {
  /** File name shown to the recipient, e.g. "sponsor-pack.mp4". */
  filename: string;
  /** Base64-encoded file content. */
  content: string;
}

/**
 * Send one outreach email via Resend. Requires RESEND_API_KEY and RESEND_FROM
 * (a verified-domain sender, e.g. "Cause <hello@yourdomain.com>"). Sends to the
 * real prospect email. Optionally attaches files (e.g. the sponsor pack video).
 * Logs each send to the memory store.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      to?: string;
      subject?: string;
      text?: string;
      name?: string;
      replyTo?: string;
      attachments?: Attachment[];
      /** Absolute sponsor-pack video URL — downloaded server-side and attached. */
      videoUrl?: string;
    };

    const to = (body.to || "").trim();
    const subject = (body.subject || "").trim();
    const text = (body.text || "").trim();
    const attachments = (body.attachments ?? []).filter((a) => a?.filename && a?.content);

    if (body.videoUrl) {
      try {
        const video = await downloadVideoBase64(body.videoUrl);
        if (video) attachments.push({ filename: video.filename, content: video.base64 });
      } catch {
        // video too large or unreachable — email still sends without it
      }
    }

    if (!to || !/.+@.+\..+/.test(to)) {
      return NextResponse.json({ error: "A valid recipient 'to' email is required." }, { status: 400 });
    }
    if (!subject || !text) {
      return NextResponse.json({ error: "Both 'subject' and 'text' are required." }, { status: 400 });
    }

    if (!RESEND_API_KEY) {
      return NextResponse.json(
        { error: "RESEND_API_KEY is not set. Add it to .env.local to send emails." },
        { status: 400 }
      );
    }
    if (!RESEND_FROM) {
      return NextResponse.json(
        {
          error:
            "RESEND_FROM is not set. Add a verified-domain sender to .env.local, e.g. RESEND_FROM=\"Cause <hello@yourdomain.com>\".",
        },
        { status: 400 }
      );
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [to],
        subject,
        text,
        ...(body.replyTo ? { reply_to: body.replyTo } : {}),
        ...(attachments.length ? { attachments } : {}),
      }),
    });

    const raw = await res.text();
    let data: { id?: string; message?: string; name?: string };
    try {
      data = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: `Resend non-JSON response (${res.status}): ${raw.slice(0, 200)}` }, { status: 502 });
    }

    if (!res.ok || !data.id) {
      return NextResponse.json(
        { error: `Resend error (${res.status}): ${data.message || data.name || raw.slice(0, 200)}` },
        { status: 502 }
      );
    }

    const record: SentRecord = {
      id: data.id,
      to,
      subject,
      from: RESEND_FROM,
      sent_at: new Date().toISOString(),
      name: body.name,
    };
    logSend(record);

    return NextResponse.json({ ok: true, id: data.id, sent_at: record.sent_at });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  }
}
