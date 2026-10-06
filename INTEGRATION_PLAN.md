# Integration Plan — Sponsor Pack Service (fr1) × GTM App (hakathongtm)

## 1. Big picture

Two Next.js apps, communicating over HTTP:

| App | Role | Port |
|---|---|---|
| **fr1** (this repo) | *Sponsor Pack Service* — turns an avatar persona into: Gamma presentation, public landing page, voiceover video (MP4). Pure generation API. | `3000` |
| **hakathongtm** | *GTM app* — avatar creation (CSV → ICP → Claude-refined avatars), lead search via Sillage, outreach email generation + sending via Resend. Orchestrates fr1. | `3001` |

```
CSV upload ─▶ ICP synth ─▶ Claude refine ─▶ RefinedAvatar[]
                                             │
                       ┌─────────────────────┤ per avatar
                       ▼                     ▼
        [fr1] POST /api/packs      Sillage persona + agents
        (video + landing page)     signals ─▶ leads
                       │                     │
                       ▼                     ▼
              pack ready (poll)      outreach email (Claude)
                       └───────┬─────────────┘
                               ▼
              Resend email: video attached (or linked)
              + public Gamma landing page URL
```

> Note: `hakathongtm/` currently lives **inside** `fr1/`. Recommended: move it to
> `/Users/mohamad/Desktop/hktns/hakathongtm` (sibling) so each app has its own
> `tsconfig`/`node_modules` and fr1's typecheck stops picking up its files.

## 2. Environment

### fr1 `.env.local` (already set)
- `GAMMA_API_KEY`, `GRADIUM_API_KEY`, `ANTHROPIC_API_KEY`
- `NEXT_PUBLIC_APP_URL=http://localhost:3000` — used to build **absolute** video URLs returned to hakathongtm.

### hakathongtm `.env.local` (additions)
```
SPONSOR_PACK_API_URL=http://localhost:3000     # fr1 base URL
RESEND_API_KEY=...                             # required for real sends
RESEND_FROM="Wise Women <hello@yourdomain.com>"
```
Run hakathongtm on port 3001: `next dev -p 3001`.

> ⚠️ **Security**: the API keys were pasted in plain text (chat + committed env).
> Rotate all of them before any demo/deploy, and make sure `.env.local` is
> gitignored in both repos.

## 3. API contract (fr1 = service)

### Existing endpoints (no breaking changes)
- `POST /api/packs` — body `{ avatarText, companyContext }`, streams SSE, header `X-Pack-Id`.
- `GET /api/packs/:id` — full pack (slides, events, URLs).
- `GET /api/packs/:id/progress` — lightweight polling: `status`, `progressPercent`, `ready.*`, `presentationEditUrl`, `publicLandingPageUrl`, `videoUrl`.

### fr1 changes needed
1. **`avatarId` passthrough** — add optional `avatarId?: string` + `avatarLabel?: string` to `PacksCreateBody` and `Pack`, so hakathongtm can map avatar → pack. Add `GET /api/packs?avatarId=...` filter.
2. **Absolute `videoUrl`** — progress/pack responses should also return `videoAbsoluteUrl` built from `NEXT_PUBLIC_APP_URL` so hakathongtm (different origin) can download/attach it.
3. **Non-SSE create option** — `POST /api/packs?async=1` returns `202 { packId }` immediately (hakathongtm polls `/progress`; it doesn't need the SSE stream).
4. **CORS** — allow `http://localhost:3001` on `/api/*` (Next middleware or route headers), or proxy through hakathongtm's server routes (server-to-server calls need no CORS — **preferred, zero config**: hakathongtm calls fr1 from its own API routes only).

### Mapping `RefinedAvatar` → fr1 payload (in hakathongtm)
```ts
{
  avatarId: avatar.label,            // or a generated uuid stored with the run
  avatarText: `${avatar.label}. ${avatar.summary}
Interests: ${avatar.interests.join(', ')}
Pains: ${avatar.pains.join(', ')}
Tone: ${avatar.tone}. Angle: ${avatar.outreach_angle}`,
  companyContext: {
    name: 'Wise Women',
    url: 'https://www.wisewomen.fr/',
    goal: 'Obtenir plus de sponsors',
    logoUrl: <from settings>,
    speaker: { name: 'Coralie Marabelle', info: 'Fondatrice', voiceId: 'kbZq1iX34tHibquE' },
  },
}
```
Language is auto-detected by fr1 from the avatar text (already implemented).

## 4. hakathongtm UI additions

New "Sponsor Pack" stage/panel after avatar refinement:

1. **Avatar cards** — for each `RefinedAvatar`: `[🎬 Generate video & site]` button.
2. On click → hakathongtm server route `POST /api/sponsor-pack/generate` → calls fr1 `POST /api/packs?async=1`, stores `{avatarId → packId}` in `memory-store`.
3. **Progress chip** on the card — polls hakathongtm `GET /api/sponsor-pack/status?packId=` (which proxies fr1 `/progress`): shows `progressPercent` + step label.
4. When ready, card shows:
   - ▶️ inline `<video>` preview (`videoAbsoluteUrl`)
   - 🔗 **Public landing page** (`publicLandingPageUrl`) — copyable, goes in emails
   - ✏️ **Edit slides in Gamma** (`presentationEditUrl`) — opens Gamma editor
5. **Outreach drawer change** — when generating/sending an email for a prospect matched to avatar X, automatically:
   - append the avatar's `publicLandingPageUrl` in the email body (Claude prompt gets it as context: "include this link naturally as the CTA"),
   - attach the video (see §5).

New hakathongtm server routes:
- `POST /api/sponsor-pack/generate` — body `{ avatar, settings }`, proxies fr1.
- `GET  /api/sponsor-pack/status` — `?packId=`, proxies fr1 `/progress`.
- (memory-store keys: `sponsor_packs: { [avatarId]: { packId, urls... } }`)

## 5. Outreach email with video + landing page

Flow (per prospect, in hakathongtm):
1. Lead found via Sillage signal (`lead.name/title/linkedin_url`) → enriched (FullEnrich) for email address.
2. `generateOutreachEmail(prospect, avatar, sender)` — extend the prompt with `landing_page_url` so the email naturally links it as CTA.
3. **Send via Resend with attachment**: Resend supports `attachments: [{ filename, content(base64) | path(url) }]`, total message limit **40 MB**.
   - fr1's final.mp4 is ~3–6 MB for 6 slides → attach directly via `path: videoAbsoluteUrl` (Resend fetches it — requires fr1 to be reachable; for local dev use base64 `content` instead: hakathongtm downloads the MP4 server-side and base64-encodes it).
   - Guard: if video > 25 MB, skip attachment and only link the landing page (+ optional hosted video link).
4. Extend `outreach/send/route.ts` to accept `attachments` and pass them to Resend; log sends as today.

## 6. Video polish (fr1 rendering)

### 6a. Better, varied transitions (fix lag)
Current: single **custom-expression** `xfade` (per-pixel `expr` eval = slow, causes the lag/stutter) for every boundary.
Plan:
- Switch to **built-in C-optimized xfade transitions** (no `expr`): rotate through a curated set per boundary — `fade`, `smoothleft`, `smoothright`, `smoothup`, `circleopen`, `wipeleft`, `dissolve`. Built-ins already ease smoothly and render ~10× faster.
- Deterministic-random pick per boundary (seeded by pack id + index) so each video feels alive but reproducible.
- Keep `acrossfade` for audio (unchanged, it's cheap).
- Encode tuning to remove playback lag: `-preset medium -crf 20 -movflags +faststart -r 30` on the final concat (constant frame rate + faststart for instant web playback).

### 6b. Laser pointer overlay 🔴
Simulate a presenter pointing at content occasionally:
- Pre-generate (per slide, seeded random) 1–2 "pointer gestures": a time window (e.g. t=2.0→4.5s) and a target point + small wander path.
- Implement as an ffmpeg overlay of a small radial-gradient red dot PNG (generated once with `lavfi`/canvas, ~26×26px, soft glow):
  `overlay=x='...eased path expr...':y='...':enable='between(t,2,4.5)'`
  - Path: start off toward the content area, ease-in (smoothstep on t), tiny sinusoidal jitter (`+6*sin(9*t)`) so it looks hand-held.
  - 40–60% of slides get a gesture; never during the first/last 0.8 s (keeps transitions clean).
- Optional v2: target real content — use slide text block coordinates (left/right half heuristic based on Gamma layout) so the pointer lands near bullets/numbers.

### 6c. Acceptance checks
- `ffprobe` duration == sum(audio) − transitions ±0.2 s.
- Extract frames at transition midpoints + pointer windows → visual check.
- Playback starts instantly in browser (`faststart`), no frame drops at 30 fps.

## 7. Delivery phases

| Phase | Scope | Est. |
|---|---|---|
| **P1** | fr1: `avatarId`, `async=1`, `videoAbsoluteUrl`, `GET ?avatarId=` | small |
| **P2** | fr1: transitions rework (built-in xfade set + encode tuning) | small-mid |
| **P3** | fr1: laser pointer overlay | mid |
| **P4** | hakathongtm: sponsor-pack routes + avatar card UI (generate / progress / links / preview) | mid |
| **P5** | hakathongtm: outreach integration (landing URL in prompt, video attachment in Resend send) | small-mid |
| **P6** | E2E test: CSV → avatar → pack → signal → email w/ attachment to a test inbox | small |

Suggested order: P1 → P4 (unblocks the visible demo) → P2/P3 (polish) → P5 → P6.

## 8. Open questions
1. Resend sender domain — is a verified domain available for `RESEND_FROM`?
2. Should packs be persisted (fr1 store is in-memory today — a restart loses the avatarId→pack mapping; a JSON-file store mirror would fix it cheaply)?
3. Laser pointer: subtle glow dot (recommended) or a moving "hand cursor" icon?
4. One pack per avatar, or allow regeneration history (versioning)?
