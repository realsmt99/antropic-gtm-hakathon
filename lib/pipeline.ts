import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { spawn } from 'child_process';
import Anthropic from '@anthropic-ai/sdk';
import ffmpeg from 'fluent-ffmpeg';
import AdmZip from 'adm-zip';
import { SseController } from './sse';
import { setPack } from './store';
import logger from './logger';
import type { Pack, SlideAsset, SlideScript, SseEvent } from './types';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const GAMMA_BASE = 'https://public-api.gamma.app';
const GRADIUM_BASE = 'https://api.gradium.ai';
const OUTPUT_BASE = process.env.OUTPUT_DIR ?? 'public/generated';
const MOCK_LANDING_PAGE = process.env.MOCK_LANDING_PAGE === 'true';
const MOCK_LANDING_PAGE_URL = 'https://copy-of-wise-women-reche-8dl8tuw.gamma.site/';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function now(): string {
  return new Date().toISOString();
}

function emit(sse: SseController, pack: Pack, event: SseEvent): void {
  event.ts = now();
  pack.events.push(event);
  pack.updatedAt = now();
  setPack(pack);
  sse.emit(event);
  logger.info(event, event.step);
}

function packDir(packId: string): string {
  return path.join(process.cwd(), OUTPUT_BASE, packId);
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

async function download(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod
      .get(url, (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          download(res.headers.location, dest).then(resolve, reject);
          return;
        }
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`Download ${url} → ${res.statusCode}`));
          return;
        }
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve()));
      })
      .on('error', reject);
  });
}

/** Runs a system ffmpeg command with the given args (always overwrites output). */
function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', ['-y', ...args]);
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

/** Returns the duration in seconds of an audio/video file via ffprobe. */
function getMediaDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) return reject(err);
      const duration = data.format.duration;
      if (!duration) return reject(new Error(`No duration for ${filePath}`));
      resolve(duration);
    });
  });
}

/**
 * Downloads the Gamma export archive (zip of PNGs, or a single PDF/PNG) and
 * returns the extracted slide image paths sorted in slide order.
 */
async function exportSlideImages(
  exportUrl: string,
  dir: string,
): Promise<string[]> {
  const isZip = exportUrl.toLowerCase().endsWith('.zip');
  const downloadPath = path.join(dir, isZip ? 'export.zip' : 'export.png');
  await download(exportUrl, downloadPath);

  if (!isZip) return [downloadPath];

  const zip = new AdmZip(downloadPath);
  const entries = zip.getEntries().filter((e) => /\.(png|jpe?g)$/i.test(e.entryName));
  entries.sort((a, b) => a.entryName.localeCompare(b.entryName, undefined, { numeric: true }));

  const imagePaths: string[] = [];
  entries.forEach((entry, i) => {
    const imagePath = path.join(dir, `slide_${i}.png`);
    fs.writeFileSync(imagePath, entry.getData());
    imagePaths.push(imagePath);
  });
  return imagePaths;
}

// ---------------------------------------------------------------------------
// Step 0: detect the target language from the avatar persona via Claude
// ---------------------------------------------------------------------------

/**
 * Resolves the language to generate everything in (script, slides, landing
 * page, voiceover). An explicit `companyContext.language` always wins; if
 * absent, we ask Claude to infer the most natural language for the target
 * sponsor persona described in `avatarText`.
 */
async function detectLanguage(
  avatarText: string,
  companyContext: Pack['companyContext'],
): Promise<string> {
  if (companyContext.language) return companyContext.language;

  const prompt = `What is the single most natural language for a sponsorship pitch aimed at the persona below? Base this on the language the persona description itself is written in / implies they speak.

Persona:
${avatarText}

Respond with ONLY the two-letter ISO 639-1 language code (e.g. "fr", "en", "es", "de"). No other text.`;

  const message = await anthropic.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 10,
    messages: [{ role: 'user', content: prompt }],
  });

  const text =
    message.content[0].type === 'text' ? message.content[0].text : '';
  const match = text.trim().toLowerCase().match(/[a-z]{2}/);
  return match ? match[0] : 'en';
}

// ---------------------------------------------------------------------------
// Step 1: generate slide scripts via Claude
// ---------------------------------------------------------------------------

async function generateScript(
  avatarText: string,
  companyContext: Pack['companyContext'],
  language: string,
): Promise<SlideScript[]> {
  const speaker = companyContext.speaker;
  const speakerInstructions = speaker
    ? `\nThe voiceover is recorded by a real person from the company: ${speaker.name}${speaker.info ? ` (${speaker.info})` : ''}.
On slide 2 ("Who we are"), open with a short, warm self-introduction along the lines of "Hi, I'm ${speaker.name} from ${companyContext.name}..." — naturally translated/phrased in "${language}" — before moving into the pitch.`
    : '';

  const prompt = `You are an expert presentation writer for associations seeking corporate sponsors.

Company: ${companyContext.name} (${companyContext.url})
${companyContext.companyInfo ? `Company info: ${companyContext.companyInfo}\n` : ''}Goal of this deck: ${companyContext.goal}
Language: write everything in the language with ISO 639-1 code "${language}" — use natural, native-sounding phrasing for that language.

Target sponsor persona:
${avatarText}
${speakerInstructions}

Create a polished, professional sponsorship deck with 7 slides. The first slide is the cover, the last slide is a thank-you + CTA. Each slide should speak directly to this sponsor persona.

For each slide, produce TWO distinct texts:
- "slideText": the short, punchy text that appears ON the slide (a headline + a few supporting lines/bullets). Keep it visual, scannable and professional. Include the company name, URL or a clear CTA where appropriate (cover, info, closing slides).
- "voiceoverScript": 2–4 sentences of what the speaker SAYS OUT LOUD. This is NOT a reading of slideText — it's a real human riffing on the same idea: add color, a light personal aside, a rhetorical question, or a different framing. Never restate slideText verbatim. Sound warm, upbeat and natural.

Return a JSON array with exactly this shape (no markdown, no extra text):
[{"title":"...","slideText":"...","voiceoverScript":"..."},...]

Slides must be:
1) COVER: bold title, company name and logo, one-line mission/tagline, website URL. Hook the listener immediately.
2) WHO WE ARE: company info / mission, what we do, why we exist. Human, not corporate.
3) WHY THIS MATTERS: the problem and why this sponsor persona specifically should care.
4) OUR IMPACT: concrete outcomes, numbers or stories. Keep it credible and grounded.
5) PARTNERSHIP BENEFITS: what the sponsor gains (brand, impact, alignment, visibility, etc.).
6) WHAT IT LOOKS LIKE: a concrete, imaginable partnership or a short testimonial/social proof.
7) THANK YOU + CTA: clear thank you, recap the ask, and a direct call-to-action with the website URL or contact.

For voiceoverScript:
- Write like a warm, cheerful, real person talking directly to the listener — not a marketing robot, not a narrator reading the screen.
- Use natural spoken phrasing, contractions, filler-free but casual rhythm, and a friendly tone appropriate to the "${language}" language.
- Avoid jargon, buzzwords and stiff corporate phrasing.
- Vary sentence structure and energy across slides so it doesn't feel templated.`;

  const message = await anthropic.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  });

  const text =
    message.content[0].type === 'text' ? message.content[0].text : '';
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('Claude did not return a JSON array');
  return JSON.parse(jsonMatch[0]) as SlideScript[];
}

// ---------------------------------------------------------------------------
// Step 2/3: Gamma – create generation and poll until completed
// ---------------------------------------------------------------------------

interface GammaGenerationResult {
  generationId: string;
  status: string;
  gammaUrl?: string;
  exportUrl?: string;
}

async function gammaRequest<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${GAMMA_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': process.env.GAMMA_API_KEY ?? '',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Gamma ${method} ${path} → ${res.status}: ${txt}`);
  }
  return res.json() as Promise<T>;
}

async function gammaPoll(
  generationId: string,
  timeoutMs = 300_000,
): Promise<GammaGenerationResult> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await gammaRequest<GammaGenerationResult>(
      'GET',
      `/v1.0/generations/${generationId}`,
    );
    if (result.status === 'completed') return result;
    if (result.status === 'failed')
      throw new Error(`Gamma generation ${generationId} failed`);
    await new Promise((r) => setTimeout(r, 4_000));
  }
  throw new Error(`Gamma generation ${generationId} timed out`);
}

interface GammaTheme {
  id: string;
  name: string;
  type: string;
  colorKeywords?: string[];
  toneKeywords?: string[];
}

let cachedThemes: GammaTheme[] | null = null;

async function getGammaThemes(): Promise<GammaTheme[]> {
  if (cachedThemes) return cachedThemes;
  const res = await gammaRequest<{ data: GammaTheme[] }>('GET', '/v1.0/themes');
  cachedThemes = res.data;
  return cachedThemes;
}

/** Uses Claude to pick the Gamma theme whose tone/color best matches the avatar + brand. */
async function selectGammaTheme(
  avatarText: string,
  companyContext: Pack['companyContext'],
): Promise<{ themeId: string; themeName: string }> {
  const themes = await getGammaThemes();
  const catalog = themes.map((t) => ({
    id: t.id,
    name: t.name,
    tone: t.toneKeywords,
    color: t.colorKeywords,
  }));

  const prompt = `Pick the best visual theme for a sponsorship presentation.

Company: ${companyContext.name} (${companyContext.url})
Target sponsor persona:
${avatarText}

Available themes (id, name, tone keywords, color keywords):
${JSON.stringify(catalog)}

Choose the theme whose tone and color best match the company's brand and the sponsor persona's taste.
Return JSON only: {"themeId":"<id>"}`;

  const message = await anthropic.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 200,
    messages: [{ role: 'user', content: prompt }],
  });

  const text =
    message.content[0].type === 'text' ? message.content[0].text : '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const parsed = jsonMatch
    ? (JSON.parse(jsonMatch[0]) as { themeId: string })
    : null;

  const match = themes.find((t) => t.id === parsed?.themeId);
  const chosen = match ?? themes[0];
  return { themeId: chosen.id, themeName: chosen.name };
}

/**
 * Shared image-style guidance: favor meaningful graphic/illustrative
 * elements tied to the content over generic stock photos of full human
 * faces, which tend to look staged and disconnect from the message.
 */
const IMAGE_STYLE_INSTRUCTIONS =
  'Avoid photos of full human faces or generic corporate stock photography. ' +
  'Prefer graphic elements, abstract shapes, icons, textures, or objects/scenes ' +
  'that have real meaning tied to the specific idea on each slide, the sponsor ' +
  "persona's world, and the brand's theme. If people must appear, favor candid, " +
  'cropped, or silhouette shots over posed close-up faces.';

/** Design guidance for the sponsorship deck itself. */
const DECK_DESIGN_INSTRUCTIONS =
  'Design a premium, modern sponsorship deck. ' +
  'The first slide must be a bold cover with the company name, logo and a strong one-line mission. ' +
  'The second slide is a clean "Who we are" information slide. ' +
  'The final slide must be a thank-you / call-to-action slide with the company URL and a clear next step. ' +
  'Use the logo in the top-right corner of every slide. Keep layouts clean, with plenty of white space and cohesive brand colors.';

/** cardOptions.headerFooter placing a custom logo image on every card. */
function buildLogoHeaderFooter(logoUrl?: string) {
  if (!logoUrl) return undefined;

  // Gamma rejects anything that is not a valid, absolute URL.
  let parsed: URL;
  try {
    parsed = new URL(logoUrl);
  } catch {
    logger.warn({ logoUrl }, 'logoUrl is not a valid URL; skipping headerFooter');
    return undefined;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    logger.warn({ logoUrl }, 'logoUrl must be http(s); skipping headerFooter');
    return undefined;
  }

  return {
    topRight: {
      type: 'image',
      source: 'url',
      src: parsed.toString(),
      size: 'sm',
    },
  };
}

/** Appends reference image URLs (with guidance) to a page's inputText. */
function withReferenceImages(inputText: string, referenceImageUrls?: string[]): string {
  if (!referenceImageUrls || referenceImageUrls.length === 0) return inputText;
  const urls = referenceImageUrls.join('\n');
  return `${inputText}\n\nReference images to draw from where relevant:\n${urls}`;
}

async function createGammaPresentation(
  slides: SlideScript[],
  companyContext: Pack['companyContext'],
  themeId: string,
  language: string,
): Promise<GammaGenerationResult> {
  // Enrich the cover and final slide text with company name/URL so the deck
  // looks complete even if Claude omitted them from the script.
  const pages = slides.map((s, i) => {
    const isFirst = i === 0;
    const isLast = i === slides.length - 1;
    let slideText = s.slideText;
    if (isFirst && !slideText.includes(companyContext.url)) {
      slideText = `${slideText}\n${companyContext.url}`;
    }
    if (isLast && !slideText.includes(companyContext.url)) {
      slideText = `${slideText}\n${companyContext.url}`;
    }
    return {
      inputText: isFirst
        ? withReferenceImages(`${s.title}\n\n${slideText}`, companyContext.referenceImageUrls)
        : `${s.title}\n\n${slideText}`,
      textMode: 'preserve',
    };
  });

  const headerFooter = buildLogoHeaderFooter(companyContext.logoUrl);

  const instructions = [
    IMAGE_STYLE_INSTRUCTIONS,
    DECK_DESIGN_INSTRUCTIONS,
    companyContext.referenceImageUrls?.length
      ? 'Weave the provided reference images into the most relevant slides instead of generating new ones for those moments.'
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  const creation = await gammaRequest<{ generationId: string }>(
    'POST',
    '/v1.0/generations',
    {
      format: 'presentation',
      title: `Sponsorship Pack – ${companyContext.name}`,
      pages,
      exportAs: 'png',
      themeId,
      textOptions: { language },
      imageOptions: {
        source: 'aiGenerated',
        style: 'premium, modern corporate illustration, meaningful graphic elements, elegant typography, cohesive brand colors, no generic stock photography',
      },
      additionalInstructions: instructions,
      ...(headerFooter ? { cardOptions: { headerFooter } } : {}),
    },
  );

  return gammaPoll(creation.generationId);
}

async function createGammaLandingPage(
  avatarText: string,
  companyContext: Pack['companyContext'],
  themeId: string,
  language: string,
): Promise<GammaGenerationResult> {
  if (MOCK_LANDING_PAGE) {
    return {
      generationId: 'mock',
      status: 'completed',
      gammaUrl: MOCK_LANDING_PAGE_URL,
    };
  }

  // cardOptions.headerFooter (used for the logo on presentation slides) is
  // not supported for format: webpage, so reference the logo as an image
  // in the content instead — Gamma will place it near the top.
  const logoLine = companyContext.logoUrl
    ? `\nCompany logo (place near the top): ${companyContext.logoUrl}`
    : '';

  const infoLine = companyContext.companyInfo
    ? `\nAbout the company: ${companyContext.companyInfo}`
    : '';

  const inputText = withReferenceImages(
    `Create a polished, professional sponsorship landing page for ${companyContext.name} (${companyContext.url}).${logoLine}${infoLine}

Goal: ${companyContext.goal}

Target sponsor profile:
${avatarText}

Structure:
1. Hero with company name, mission, and a clear call-to-action.
2. Why partner with us (the opportunity for the sponsor).
3. Our impact / what we do.
4. Partnership benefits (brand, social impact, visibility, alignment).
5. Social proof or testimonial.
6. CTA block: contact us / visit ${companyContext.url}.
7. Footer with website and company name.

Language: ${language}`,
    companyContext.referenceImageUrls,
  );

  const landingInstructions = [
    IMAGE_STYLE_INSTRUCTIONS,
    'Design a premium, modern landing page. Use the logo near the top, cohesive brand colors, and a clear call-to-action above the fold.',
    companyContext.referenceImageUrls?.length
      ? 'Weave the provided reference images into the most relevant sections instead of generating new ones for those moments.'
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  const creation = await gammaRequest<{ generationId: string }>(
    'POST',
    '/v1.0/generations',
    {
      format: 'webpage',
      title: `Sponsor Landing – ${companyContext.name}`,
      inputText,
      textMode: 'generate',
      publish: true,
      themeId,
      textOptions: { language },
      imageOptions: {
        source: 'aiGenerated',
        style: 'premium, modern corporate website, meaningful graphic elements, elegant typography, cohesive brand colors, no generic stock photography',
      },
      additionalInstructions: landingInstructions,
    },
  );

  return gammaPoll(creation.generationId);
}

// ---------------------------------------------------------------------------
// Step 5: select best Gradium voice via Claude
// ---------------------------------------------------------------------------

interface GradiumVoice {
  uid: string;
  name: string;
  description?: string;
  language?: string;
  tags?: string[];
}

/**
 * Gradium's `/voices/` endpoint only returns custom voices owned by the
 * account. If it's empty, fall back to a small curated subset of Gradium's
 * public catalog (see https://docs.gradium.ai/guides/voices/all-voices).
 */
const CATALOG_VOICE_FALLBACK: GradiumVoice[] = [
  { uid: 'k1wgs3k8-wRxTJO6', name: 'Julie', language: 'fr', description: 'Joyful, upbeat French adult female voice — warm and lively, sounds like a real enthusiastic person.' },
  { uid: 'kw_VWSocR7vyA9Ty', name: 'Florian', language: 'fr', description: 'Joyful, cheerful French adult male voice — energetic and natural, not corporate-sounding.' },
  { uid: 'b35yykvVppLXyw_l', name: 'Elise', language: 'fr', description: 'Warm and smooth French adult voice, friendly, welcoming, conversational tone.' },
  { uid: 'axlOaUiFyOZhy4nv', name: 'Leo', language: 'fr', description: 'Warm and smooth French adult voice, friendly, welcoming, conversational tone.' },
  { uid: 'p1fSBpcmVWngBqVd', name: 'Manon', language: 'fr', description: 'Gentle, warm French young adult female voice — soft and natural, not stiff or formal.' },
  { uid: 'J4XbCGPYNMigXcfZ', name: 'Amélie', language: 'fr', description: 'Friendly, casual French young adult female voice — approachable and lively.' },
  { uid: '-dOnYAX4N4GqSOee', name: 'Sarah', language: 'fr', description: 'Warm French young adult female voice — relaxed, friendly, sounds like a real person chatting.' },
  { uid: 'zpmn3GOfiU_i5QGo', name: 'Romain', language: 'fr', description: 'Warm, joyful French adult male voice — down-to-earth, not stiff or robotic.' },
  { uid: 'Hdf5cdfaGrLDTD63', name: 'Dylan', language: 'fr', description: 'Sincere, warm French adult male voice — genuine and natural.' },
  { uid: 'B09t5S64xLaKwXeW', name: 'Vincent', language: 'fr', description: 'Warm and wise French adult male voice, gentle storyteller tone.' },
];

async function selectGradiumVoice(
  avatarText: string,
  language: string,
): Promise<string> {
  const res = await fetch(`${GRADIUM_BASE}/api/voices/`, {
    headers: { 'x-api-key': process.env.GRADIUM_API_KEY ?? '' },
  });
  if (!res.ok) throw new Error(`Gradium voices → ${res.status}`);
  const voices = (await res.json()) as GradiumVoice[];
  const pool = voices.length > 0 ? voices : CATALOG_VOICE_FALLBACK;

  const filtered = pool.filter(
    (v) =>
      !v.language ||
      v.language.toLowerCase().startsWith(language.toLowerCase()),
  );
  const list = (filtered.length > 0 ? filtered : pool).slice(0, 20);

  const prompt = `You are selecting the best voice (language: "${language}") for a sponsorship presentation targeting this persona:
${avatarText}

Voice style requirements (very important):
- Prefer a CHEERFUL, warm, and natural-sounding voice — someone who sounds genuinely happy and human.
- AVOID stiff, overly formal, "corporate narrator", or robotic-sounding voices.
- The voice should feel like a real enthusiastic person talking, not a professional announcer or a bot.

Available voices:
${JSON.stringify(list, null, 2)}

Return a JSON object with exactly: {"uid":"<chosen uid>","reason":"<one sentence reason>"}
No markdown, no extra text.`;

  const message = await anthropic.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 256,
    messages: [{ role: 'user', content: prompt }],
  });

  const text =
    message.content[0].type === 'text' ? message.content[0].text : '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Claude did not return voice JSON');
  const result = JSON.parse(jsonMatch[0]) as { uid: string; reason: string };

  const isValid = list.some((v) => v.uid === result.uid);
  return isValid ? result.uid : list[0].uid;
}

// ---------------------------------------------------------------------------
// Step 6: generate Gradium TTS per slide
// ---------------------------------------------------------------------------

async function generateAudio(
  text: string,
  voiceId: string,
  outputPath: string,
): Promise<void> {
  const res = await fetch(`${GRADIUM_BASE}/api/post/speech/tts`, {
    method: 'POST',
    headers: {
      'x-api-key': process.env.GRADIUM_API_KEY ?? '',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      voice_id: voiceId,
      output_format: 'wav',
      only_audio: true,
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Gradium TTS → ${res.status}: ${txt}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);
}

// ---------------------------------------------------------------------------
// Step 7: per-slide video (static image, no in-slide motion — all animation
// lives in the crossfade transitions between slides, see Step 8)
// ---------------------------------------------------------------------------

const VIDEO_FPS = 30;

/** Smoothstep ease-in-out expression in ffmpeg eval syntax, for progress `p` in [0,1]. */
function easeInOutExpr(p: string): string {
  return `(3*pow(${p},2)-2*pow(${p},3))`;
}

const SLIDE_SCALE_FILTER =
  'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2';

/**
 * Generates (once) a small glowing red "laser dot" PNG via lavfi and returns
 * its path. Radial-falloff alpha makes it look like a real laser pointer.
 */
let laserDotPromise: Promise<string> | null = null;
function ensureLaserDot(): Promise<string> {
  if (laserDotPromise) return laserDotPromise;
  laserDotPromise = (async () => {
    const dotPath = path.join(process.cwd(), OUTPUT_BASE, 'laser_dot.png');
    if (!fs.existsSync(dotPath)) {
      ensureDir(path.dirname(dotPath));
      await runFfmpeg([
        '-f', 'lavfi',
        '-i', 'color=c=black:s=40x40,format=rgba',
        '-vf', "geq=r='255':g='36':b='36':a='255*exp(-((X-20)*(X-20)+(Y-20)*(Y-20))/85)'",
        '-frames:v', '1',
        dotPath,
      ]);
    }
    return dotPath;
  })();
  return laserDotPromise;
}

/**
 * Builds an ffmpeg overlay filter simulating a presenter's laser pointer:
 * the dot eases in from the bottom-right toward a random content point with
 * a subtle hand-held wobble, visible only during a mid-slide window.
 * Returns null when the slide is too short or (randomly) skipped —
 * roughly half of longer slides get a gesture so it stays natural.
 */
function laserOverlayFilter(seedKey: string, duration: number): string | null {
  const rand = mulberry32(hashString(seedKey));
  if (duration < 6) return null;
  if (rand() < 0.45) return null;

  const t0 = 1.5 + rand() * 1.5;
  const t1 = Math.min(t0 + 2 + rand() * 2, duration - 0.8);
  if (t1 - t0 < 1.2) return null;

  const targetX = Math.round((0.35 + rand() * 0.5) * 1280);
  const targetY = Math.round((0.3 + rand() * 0.45) * 720);
  const startX = 1216;
  const startY = 648;

  const p = `min((t-${t0.toFixed(2)})/0.8,1)`;
  const ease = easeInOutExpr(p);
  const x = `${startX}+(${targetX}-${startX})*${ease}+6*sin(7*t)`;
  const y = `${startY}+(${targetY}-${startY})*${ease}+5*sin(9*t)`;

  return `overlay=x='${x}':y='${y}':enable='between(t,${t0.toFixed(2)},${t1.toFixed(2)})'`;
}

async function renderSlideVideo(
  imagePath: string,
  audioPath: string,
  outputPath: string,
): Promise<void> {
  const duration = await getMediaDuration(audioPath);
  const laser = laserOverlayFilter(outputPath, duration);

  const commonOutput = [
    '-c:v', 'libx264',
    '-tune', 'stillimage',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-t', duration.toFixed(3),
    '-pix_fmt', 'yuv420p',
    outputPath,
  ];

  if (!laser) {
    await runFfmpeg([
      '-loop', '1',
      '-r', String(VIDEO_FPS),
      '-i', imagePath,
      '-i', audioPath,
      '-vf', SLIDE_SCALE_FILTER,
      ...commonOutput,
    ]);
    return;
  }

  const laserPng = await ensureLaserDot();
  await runFfmpeg([
    '-loop', '1',
    '-r', String(VIDEO_FPS),
    '-i', imagePath,
    '-i', audioPath,
    '-i', laserPng,
    '-filter_complex', `[0:v]${SLIDE_SCALE_FILTER}[bg];[bg][2:v]${laser}[v]`,
    '-map', '[v]',
    '-map', '1:a',
    ...commonOutput,
  ]);
}

// ---------------------------------------------------------------------------
// Step 8: concatenate with varied, smooth built-in transitions between slides
// ---------------------------------------------------------------------------

const TRANSITION_DURATION = 0.9; // seconds

/**
 * Curated set of ffmpeg built-in xfade transitions. Built-ins are C-optimized
 * (unlike `transition=custom` with a per-pixel expression, which caused
 * rendering lag) and all ease smoothly.
 */
const XFADE_TRANSITIONS = [
  'fade',
  'smoothleft',
  'smoothright',
  'smoothup',
  'circleopen',
  'dissolve',
  'wipeleft',
] as const;

/** Small deterministic PRNG (mulberry32) so transition choice is stable per pack. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cheap string hash for seeding the PRNG. */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

async function concatenateVideos(
  videoPaths: string[],
  outputPath: string,
): Promise<void> {
  if (videoPaths.length === 0) return;

  if (videoPaths.length === 1) {
    fs.copyFileSync(videoPaths[0], outputPath);
    return;
  }

  const durations = await Promise.all(videoPaths.map(getMediaDuration));
  const shortest = Math.min(...durations);
  const transitionDuration = Math.max(
    0.05,
    Math.min(TRANSITION_DURATION, shortest / 2),
  );

  const rand = mulberry32(hashString(outputPath));

  const inputArgs: string[] = [];
  videoPaths.forEach((p) => inputArgs.push('-i', p));

  const filterParts: string[] = [];
  let cumulative = durations[0];
  let lastVideoLabel = '0:v';
  let lastAudioLabel = '0:a';
  let lastTransition = '';

  for (let i = 1; i < videoPaths.length; i++) {
    const isLast = i === videoPaths.length - 1;
    const videoOut = isLast ? 'vout' : `v${i}`;
    const audioOut = isLast ? 'aout' : `a${i}`;
    const offset = Math.max(cumulative - transitionDuration, 0);

    // Pick a varied transition, avoiding repeating the previous one.
    let transition: string = XFADE_TRANSITIONS[Math.floor(rand() * XFADE_TRANSITIONS.length)];
    if (transition === lastTransition) {
      transition = XFADE_TRANSITIONS[
        (XFADE_TRANSITIONS.indexOf(transition as typeof XFADE_TRANSITIONS[number]) + 1) %
          XFADE_TRANSITIONS.length
      ];
    }
    lastTransition = transition;

    filterParts.push(
      `[${lastVideoLabel}][${i}:v]xfade=transition=${transition}:duration=${transitionDuration.toFixed(3)}:offset=${offset.toFixed(3)}[${videoOut}]`,
    );
    filterParts.push(
      `[${lastAudioLabel}][${i}:a]acrossfade=d=${transitionDuration.toFixed(3)}:c1=hsin:c2=hsin[${audioOut}]`,
    );

    lastVideoLabel = videoOut;
    lastAudioLabel = audioOut;
    cumulative = cumulative + durations[i] - transitionDuration;
  }

  await runFfmpeg([
    ...inputArgs,
    '-filter_complex', filterParts.join(';'),
    '-map', `[${lastVideoLabel}]`,
    '-map', `[${lastAudioLabel}]`,
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '20',
    '-r', String(VIDEO_FPS),
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-c:a', 'aac',
    '-b:a', '192k',
    outputPath,
  ]);
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

export async function runPipeline(
  pack: Pack,
  sse: SseController,
): Promise<void> {
  const dir = packDir(pack.id);
  ensureDir(dir);

  try {
    // Step 0 – resolve the target language from the avatar persona
    const language = await detectLanguage(pack.avatarText, pack.companyContext);
    pack.companyContext.language = language;
    setPack(pack);
    emit(sse, pack, { step: 'language_detected', language, ts: now() });

    // Step 1 – script
    pack.status = 'generating_script';
    setPack(pack);
    const slides = await generateScript(pack.avatarText, pack.companyContext, language);
    pack.slides = slides.map((s, i) => ({
      index: i,
      title: s.title,
      slideText: s.slideText,
      voiceoverScript: s.voiceoverScript,
    }));
    emit(sse, pack, { step: 'script_generated', slideCount: slides.length, ts: now() });

    // Select a Gamma theme that matches the brand + sponsor persona
    const { themeId, themeName } = await selectGammaTheme(
      pack.avatarText,
      pack.companyContext,
    );
    pack.themeId = themeId;
    pack.themeName = themeName;
    setPack(pack);
    emit(sse, pack, { step: 'theme_selected', themeId, themeName, ts: now() });

    // Step 2 – Gamma presentation
    pack.status = 'creating_presentation';
    setPack(pack);
    const presentation = await createGammaPresentation(
      slides,
      pack.companyContext,
      themeId,
      language,
    );
    pack.presentationId = presentation.generationId;
    pack.presentationUrl = presentation.gammaUrl;
    pack.exportUrl = presentation.exportUrl;
    emit(sse, pack, {
      step: 'gamma_presentation_created',
      generationId: presentation.generationId,
      ts: now(),
    });
    emit(sse, pack, {
      step: 'gamma_presentation_completed',
      gammaUrl: presentation.gammaUrl,
      exportUrl: presentation.exportUrl,
      ts: now(),
    });

    // Step 3 – Gamma landing page
    pack.status = 'creating_landing';
    setPack(pack);
    const landing = await createGammaLandingPage(
      pack.avatarText,
      pack.companyContext,
      themeId,
      language,
    );
    pack.landingPageUrl = landing.gammaUrl;
    emit(sse, pack, { step: 'gamma_landing_created', ts: now() });
    emit(sse, pack, {
      step: 'gamma_landing_completed',
      gammaUrl: landing.gammaUrl,
      ts: now(),
    });

    // Step 4 – export slide images
    pack.status = 'exporting_slides';
    setPack(pack);
    if (pack.exportUrl) {
      const imagePaths = await exportSlideImages(pack.exportUrl, dir);
      for (let i = 0; i < slides.length && i < imagePaths.length; i++) {
        pack.slides[i].imagePath = imagePaths[i];
        emit(sse, pack, {
          step: 'slide_exported',
          slideIndex: i,
          imagePath: imagePaths[i],
          ts: now(),
        });
      }
    }

    // Step 5 – select voice (pinned speaker voice wins over auto-selection)
    pack.status = 'selecting_voice';
    setPack(pack);
    const pinnedVoiceId = pack.companyContext.speaker?.voiceId;
    const voiceId =
      pinnedVoiceId ?? (await selectGradiumVoice(pack.avatarText, language));
    pack.voiceId = voiceId;
    emit(sse, pack, {
      step: 'voice_selected',
      voiceId,
      pinned: Boolean(pinnedVoiceId),
      ts: now(),
    });

    // Step 6 – generate audio per slide
    pack.status = 'generating_audio';
    setPack(pack);
    for (let i = 0; i < slides.length; i++) {
      const audioPath = path.join(dir, `slide_${i}.wav`);
      await generateAudio(slides[i].voiceoverScript, voiceId, audioPath);
      pack.slides[i].audioPath = audioPath;
      emit(sse, pack, {
        step: 'voice_generated',
        slideIndex: i,
        audioPath,
        ts: now(),
      });
    }

    // Step 7 – render per-slide videos
    pack.status = 'rendering_videos';
    setPack(pack);
    const videoPaths: string[] = [];
    for (let i = 0; i < slides.length; i++) {
      const slide = pack.slides[i];
      if (!slide.imagePath || !slide.audioPath) continue;
      const videoPath = path.join(dir, `slide_${i}.mp4`);
      await renderSlideVideo(slide.imagePath, slide.audioPath, videoPath);
      slide.videoPath = videoPath;
      videoPaths.push(videoPath);
      emit(sse, pack, {
        step: 'slide_video_rendered',
        slideIndex: i,
        videoPath,
        ts: now(),
      });
    }

    // Step 8 – concatenate
    pack.status = 'concatenating';
    setPack(pack);
    if (videoPaths.length > 0) {
      const finalPath = path.join(dir, 'final.mp4');
      await concatenateVideos(videoPaths, finalPath);
      pack.videoPath = finalPath;
      pack.videoUrl = `/generated/${pack.id}/final.mp4`;
      emit(sse, pack, {
        step: 'video_concatenated',
        videoPath: finalPath,
        videoUrl: pack.videoUrl,
        ts: now(),
      });
    }

    // Done
    pack.status = 'done';
    pack.updatedAt = now();
    setPack(pack);
    emit(sse, pack, {
      step: 'done',
      // Open in Gamma as the API key's owner to edit the slides.
      presentationEditUrl: pack.presentationUrl,
      // Published Gamma site, viewable by anyone.
      publicLandingPageUrl: pack.landingPageUrl,
      videoUrl: pack.videoUrl,
      ts: now(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    pack.status = 'failed';
    pack.error = message;
    pack.updatedAt = now();
    setPack(pack);
    logger.error({ err }, 'pipeline failed');
    emit(sse, pack, { step: 'failed', error: message, ts: now() });
  } finally {
    sse.close();
  }
}
