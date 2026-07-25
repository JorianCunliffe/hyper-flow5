# twilio-openai-realtime

Real-time voice AI built on **Twilio Media Streams** and the **OpenAI Realtime API**, deployed on **Vercel**.

Every call — inbound or outbound — instantly looks up the caller's phone number in Supabase, builds a personalised AI context from their contact record, and bridges live audio between Twilio and OpenAI with no transcoding (G.711 μ-law end-to-end).

---

## How it works

```
Inbound call
  Twilio ──POST──▶ /api/twilio/voice          (returns TwiML)
                        │
                        └──wss://──▶ /api/twilio/stream ◀──▶ OpenAI Realtime
                                          │
                                    Supabase lookup
                                   (phone → contact)

Outbound call
  Your API ──POST──▶ /api/calls/outbound
                          │
                    Twilio REST → dials number
                          │ (answered)
                    /api/twilio/outbound-twiml  (returns TwiML)
                          │
                         wss://──▶ /api/twilio/stream ◀──▶ OpenAI Realtime
```

**Audio path**: Twilio sends G.711 μ-law at 8 kHz → forwarded directly to OpenAI Realtime (which also accepts G.711 μ-law) → OpenAI audio delta chunks sent back to Twilio as-is. No transcoding, no latency tax.

**Contact lookup**: When a stream starts, the app queries `contacts` by `phone_number`. The matched record (name, company, notes, custom fields) is injected into the AI system prompt so the assistant already knows who it's speaking with.

**Transcript storage**: Every `response.audio_transcript.done` and user speech-to-text event is appended to an in-memory buffer and written to the `calls` table when the call ends.

---

## Prerequisites

| Service | What you need |
|---|---|
| [Twilio](https://twilio.com) | Account SID, Auth Token, a Voice-capable phone number |
| [OpenAI](https://platform.openai.com) | API key with Realtime API access |
| [Supabase](https://supabase.com) | Project URL + service role key |
| [Vercel](https://vercel.com) | Account (Pro recommended for Fluid Compute / long-lived functions) |

---

## Quick start

### 1 — Clone and install

```bash
git clone https://github.com/JorianCunliffe/hyper-flow
cd hyper-flow  # or whatever you named the local folder
npm install
```

### 2 — Environment variables

Copy `.env.example` to `.env.local` and fill in every value:

```bash
cp .env.example .env.local
```

| Variable | Description |
|---|---|
| `TWILIO_ACCOUNT_SID` | Twilio account SID (`ACxxx…`) |
| `TWILIO_AUTH_TOKEN` | Twilio auth token |
| `TWILIO_PHONE_NUMBER` | E.164 number to call from, e.g. `+14155550100` |
| `OPENAI_API_KEY` | OpenAI API key (`sk-…`) |
| `OPENAI_VOICE` | Realtime voice — `alloy` · `echo` · `shimmer` · `ash` · `verse` (default: `alloy`) |
| `SUPABASE_URL` | Project URL, e.g. `https://xxxx.supabase.co` |
| `SUPABASE_ANON_KEY` | Anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (used server-side to bypass RLS) |
| `BASE_URL` | Your public URL, e.g. `https://twilio-openai-realtime.vercel.app` |
| `API_SECRET_KEY` | Random secret for protecting REST endpoints |

### 3 — Database

The migration in `supabase/migrations/20260620_init.sql` has already been applied to the Supabase project. If you're connecting to a fresh project, run it manually in the Supabase SQL editor.

### 4 — Local development

```bash
npm run dev
# → http://localhost:3000
```

For local Twilio testing, expose port 3000 with [ngrok](https://ngrok.com):

```bash
ngrok http 3000
```

Set `BASE_URL=https://<your-ngrok-id>.ngrok.io` in `.env.local`, then configure Twilio (see step 6).

### 5 — Deploy to Vercel

```
vercel deploy --prod
```

Or connect the GitHub repo in the Vercel dashboard and push to trigger a deployment.

Set all environment variables in **Vercel → Project → Settings → Environment Variables**.

> **Important**: The WebSocket stream function must stay alive for the duration of a call. Set `maxDuration = 300` in `vercel.json` (already done) and ensure your Vercel plan supports Fluid Compute / long-lived functions.

### 6 — Configure Twilio

In the [Twilio Console](https://console.twilio.com) → Phone Numbers → your number → Voice Configuration:

| Field | Value |
|---|---|
| **A call comes in** | Webhook · `POST` · `https://your-app.vercel.app/api/twilio/voice` |
| **Call status changes** | `POST` · `https://your-app.vercel.app/api/twilio/status` |

---

## API reference

All endpoints except the Twilio webhooks require the header:

```
x-api-key: <API_SECRET_KEY>
```

---

### Contacts

#### `GET /api/contacts`

List contacts with optional search and pagination.

**Query parameters**

| Param | Type | Default | Description |
|---|---|---|---|
| `page` | number | `1` | Page number |
| `limit` | number | `20` | Results per page (max 100) |
| `search` | string | — | Case-insensitive match on name, phone, email, company |

**Response `200`**

```json
{
  "contacts": [
    {
      "id": "uuid",
      "phone_number": "+14155550100",
      "name": "Jane Smith",
      "email": "jane@acme.com",
      "company": "Acme Corp",
      "notes": "Interested in Pro plan",
      "tags": ["lead", "hot"],
      "custom_data": { "crm_id": "SF-001" },
      "created_at": "2026-06-20T10:00:00Z",
      "updated_at": "2026-06-20T10:00:00Z"
    }
  ],
  "total": 42,
  "page": 1,
  "limit": 20
}
```

---

#### `POST /api/contacts`

Create a new contact. The `phone_number` is used to match callers in real time.

**Body**

```json
{
  "phone_number": "+14155550100",
  "name": "Jane Smith",
  "email": "jane@acme.com",
  "company": "Acme Corp",
  "notes": "Interested in Pro plan. Prefers mornings.",
  "tags": ["lead", "hot"],
  "custom_data": { "crm_id": "SF-001", "tier": "enterprise" }
}
```

| Field | Required | Description |
|---|---|---|
| `phone_number` | **Yes** | E.164 format |
| `name` | No | Full name |
| `email` | No | Email address |
| `company` | No | Company / organisation |
| `notes` | No | Free-text notes fed to the AI |
| `tags` | No | Array of strings |
| `custom_data` | No | Any JSON object — also fed to the AI |

**Response `201`**

```json
{ "contact": { /* full contact object */ } }
```

**Response `409`** — phone number already exists.

---

#### `GET /api/contacts/:id`

Fetch a single contact including their call history.

**Response `200`**

```json
{
  "contact": {
    "id": "uuid",
    "phone_number": "+14155550100",
    "name": "Jane Smith",
    "calls": [
      {
        "id": "uuid",
        "direction": "inbound",
        "status": "completed",
        "started_at": "2026-06-20T10:00:00Z",
        "ended_at": "2026-06-20T10:04:32Z",
        "duration_seconds": 272
      }
    ]
  }
}
```

---

#### `PUT /api/contacts/:id`

Update any contact fields (same body shape as POST, all fields optional).

**Response `200`** — updated contact object.

---

#### `DELETE /api/contacts/:id`

Delete a contact. Associated call records are retained with `contact_id = null`.

**Response `200`**

```json
{ "success": true }
```

---

### Calls

#### `GET /api/calls`

List call history.

**Query parameters**

| Param | Type | Description |
|---|---|---|
| `page` | number | Page number (default 1) |
| `limit` | number | Per page (default 20, max 100) |
| `direction` | `inbound` \| `outbound` | Filter by direction |
| `status` | string | Filter by Twilio status |
| `contact_id` | uuid | Filter by contact |

**Response `200`**

```json
{
  "calls": [
    {
      "id": "uuid",
      "twilio_call_sid": "CAxxxx",
      "phone_number": "+14155550100",
      "direction": "inbound",
      "status": "completed",
      "duration_seconds": 272,
      "started_at": "2026-06-20T10:00:00Z",
      "ended_at": "2026-06-20T10:04:32Z",
      "contact": {
        "id": "uuid",
        "name": "Jane Smith",
        "phone_number": "+14155550100"
      }
    }
  ],
  "total": 100,
  "page": 1,
  "limit": 20
}
```

---

#### `GET /api/calls/:id`

Fetch a single call including the full transcript.

**Response `200`**

```json
{
  "call": {
    "id": "uuid",
    "direction": "inbound",
    "status": "completed",
    "system_prompt": "You are a professional AI assistant…",
    "transcript": [
      { "role": "user", "content": "Hi, I wanted to ask about pricing.", "timestamp": "2026-06-20T10:00:05Z" },
      { "role": "assistant", "content": "Hi Jane! Happy to help with that…", "timestamp": "2026-06-20T10:00:07Z" }
    ],
    "contact": { /* full contact object */ }
  }
}
```

---

#### `POST /api/calls/outbound`

Dial a number and start an AI-powered conversation.

**Body**

```json
{
  "to": "+14155550100",
  "systemPrompt": "You are a follow-up assistant. Ask Jane if she's ready to upgrade her plan.",
  "metadata": { "campaign": "q2-upsell" }
}
```

| Field | Required | Description |
|---|---|---|
| `to` | **Yes** | E.164 number to dial |
| `systemPrompt` | No | Override the auto-generated AI instructions |
| `metadata` | No | Arbitrary JSON stored on the call record |

If `systemPrompt` is omitted, the AI is given default instructions and the contact's full record (name, notes, custom_data) as context.

**Response `200`**

```json
{
  "success": true,
  "callSid": "CAxxxx",
  "callId": "uuid",
  "status": "queued"
}
```

---

### Twilio webhooks (internal)

These are called by Twilio automatically — you do not call them directly.

| Endpoint | Caller | Purpose |
|---|---|---|
| `POST /api/twilio/voice` | Twilio | Returns TwiML for inbound calls |
| `POST /api/twilio/outbound-twiml` | Twilio | Returns TwiML when outbound call is answered |
| `POST /api/twilio/status` | Twilio | Updates call status in the database |
| `WS /api/twilio/stream` | Twilio | Bidirectional audio bridge → OpenAI Realtime |

---

## Database schema

```sql
contacts (
  id           UUID  PRIMARY KEY,
  phone_number TEXT  UNIQUE NOT NULL,
  name         TEXT,
  email        TEXT,
  company      TEXT,
  notes        TEXT,
  tags         TEXT[],
  custom_data  JSONB,
  created_at   TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ   -- auto-updated by trigger
)

calls (
  id               UUID  PRIMARY KEY,
  twilio_call_sid  TEXT  UNIQUE,
  contact_id       UUID  → contacts.id (SET NULL on delete),
  phone_number     TEXT,
  direction        TEXT  CHECK IN ('inbound','outbound'),
  status           TEXT,
  system_prompt    TEXT,
  transcript       JSONB,  -- [{ role, content, timestamp }]
  summary          TEXT,
  duration_seconds INTEGER,
  started_at       TIMESTAMPTZ,
  ended_at         TIMESTAMPTZ,
  metadata         JSONB
)
```

---

## Architecture notes

**WebSocket lifecycle on Vercel**

The Twilio voice webhook (`/api/twilio/voice`) fires first. It initialises the WebSocket server on the underlying Node.js HTTP server instance and attaches an `upgrade` event listener. Twilio then opens the Media Stream WebSocket to the same instance. `vercel.json` sets `maxDuration: 300` on the stream function so Vercel's Fluid Compute keeps the instance alive for up to 5 minutes per call.

**Audio format**

Twilio Media Streams produce G.711 μ-law (8 kHz, mono). OpenAI Realtime API accepts `g711_ulaw` natively. Both input and output are configured as `g711_ulaw`, so audio passes through the bridge as raw base64 strings — no CPU-intensive transcoding.

**AI turn detection**

The session uses `server_vad` (server-side voice activity detection). OpenAI detects when the caller stops speaking and generates a response automatically, without manual commit signals.

**Outbound call greeting**

When `direction === 'outbound'`, the bridge sends an initial synthetic user message (`"Hello"`) after the OpenAI session is ready, causing the AI to speak first.
