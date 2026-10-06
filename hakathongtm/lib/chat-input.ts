import { extractJSON } from "./avatar-engine";
import type { LinkedInRow } from "./csv-parser";
import type { CompanyContext } from "./generation-store";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "";
const CLAUDE_MODEL = process.env.CLAUDE_MODEL ?? "claude-sonnet-4-5-20250929";

export interface ChatInputResult {
  companyContext: CompanyContext;
  rows: LinkedInRow[];
  aiMessage: string;
  filename?: string;
}

interface ChatParseResponse {
  companyName: string;
  companyUrl?: string;
  companyInfo?: string;
  goal?: string;
  language?: string;
  rows: Array<Partial<LinkedInRow>>;
  aiMessage: string;
}

function cleanRow(row: Partial<LinkedInRow>): LinkedInRow {
  const fullName = row.fullName?.trim() || "Unknown";
  const firstName = row.firstName?.trim() || "";
  const lastName = row.lastName?.trim() || "";
  return {
    firstName,
    lastName,
    fullName,
    title: row.title?.trim() || "",
    company: row.company?.trim() || "",
    linkedinUrl: row.linkedinUrl?.trim() || "",
    email: row.email?.trim() || undefined,
    phone: row.phone?.trim() || undefined,
    about: row.about?.trim() || undefined,
    location: row.location?.trim() || undefined,
    connectedOn: row.connectedOn?.trim() || undefined,
  };
}

export async function processChatInput(
  text: string,
  providedRows?: LinkedInRow[],
  logoUrl?: string,
  referenceImageUrls?: string[]
): Promise<ChatInputResult> {
  if (!ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set. Add it to .env.local to enable chat input.");
  }

  const hasCSV = providedRows && providedRows.length > 0;

  const csvHint = hasCSV
    ? `A CSV with ${providedRows.length} donor rows is attached. Use it as the primary donor list. You may add extra rows from the text if the user explicitly mentions additional people.`
    : "No CSV was attached. Extract any donors or companies explicitly mentioned in the text, or create 3-5 representative donor rows based on the description.";

  const prompt = `You are a helpful fundraising assistant. The user is describing a corporate-giving / sponsorship project in plain language.

USER MESSAGE:
${text}

${csvHint}

Please extract the following and return ONLY a JSON object:
{
  "companyName": "the company or non-profit name",
  "companyUrl": "website URL if mentioned, otherwise infer from the company name or empty",
  "companyInfo": "1-2 sentence mission / what they do",
  "goal": "the fundraising or sponsorship goal in one sentence",
  "language": "the dominant language of the user's message as ISO 639-1 code (e.g. 'fr', 'en')",
  "rows": [
    {
      "fullName": "optional",
      "title": "optional",
      "company": "required if possible",
      "linkedinUrl": "optional",
      "email": "optional",
      "location": "optional",
      "about": "optional"
    }
  ],
  "aiMessage": "a short, friendly response confirming what you understood (company name, number of donors, goal). Keep it warm and concise."
}

Rules:
- If the CSV is attached, trust those rows first. Keep every row, filling missing fields from the text where possible.
- If no CSV, create plausible donor rows based on the description (company names, typical titles). The rows must be useful for ICP synthesis.
- The "language" field must be the language the user is writing in.
- Return ONLY the JSON object, no markdown, no prose.`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  let res: Response;
  try {
    res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`Anthropic API error (HTTP ${res.status}): ${raw.slice(0, 400)}`);
  }

  const json = JSON.parse(raw) as { content?: { type: string; text?: string }[] };
  const textResponse = json.content?.find((c) => c.type === "text")?.text ?? "";

  const parsed = extractJSON(textResponse) as ChatParseResponse;

  const rows = hasCSV
    ? providedRows.map((r, i) => {
        const parsedRow = parsed.rows[i] ?? {};
        return cleanRow({ ...r, ...parsedRow });
      })
    : (parsed.rows ?? []).map(cleanRow);

  const companyContext: CompanyContext = {
    name: parsed.companyName || "Wise Women",
    url: parsed.companyUrl || "",
    companyInfo: parsed.companyInfo,
    goal: parsed.goal,
    language: parsed.language,
    logoUrl: logoUrl,
    referenceImageUrls: referenceImageUrls ?? [],
  };

  return {
    companyContext,
    rows,
    aiMessage: parsed.aiMessage || "Got it. I’ve set up your project.",
  };
}
