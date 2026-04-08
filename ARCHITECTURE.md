# Architecture — Meet Shahaf

## Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        RECRUITER (Browser)                       │
│                                                                   │
│   ┌─────────────┐    ┌──────────────┐    ┌───────────────────┐  │
│   │ Access Code │───▶│  Setup Form  │───▶│   Interview UI    │  │
│   │   Screen    │    │ name/company │    │  3D Avatar + Mic  │  │
│   └─────────────┘    │ + job desc   │    └────────┬──────────┘  │
│                       └──────────────┘             │             │
└───────────────────────────────────────────────────┼─────────────┘
                                                     │
                                          PCM16 audio chunks
                                          (via WebSocket)
                                                     │
                                                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                     REACT FRONTEND (Vercel)                      │
│                                                                   │
│   ┌──────────────────────────────────────────────────────────┐  │
│   │  AudioWorklet                                             │  │
│   │  MediaStream → Float32 → Int16 → base64 PCM16            │  │
│   └────────────────────────────┬─────────────────────────────┘  │
│                                 │                                 │
│   ┌──────────────────────────────────────────────────────────┐  │
│   │  WebSocket Client                                         │  │
│   │  sends: { type: "audio", data: base64 }                  │  │
│   │  receives: { type: "audio" / "transcript" / "state" }    │  │
│   └────────────────────────────┬─────────────────────────────┘  │
│                                 │                                 │
│   ┌──────────────────────────────────────────────────────────┐  │
│   │  Three.js Avatar                                          │  │
│   │  model.glb (Avaturn + Mixamo animations)                  │  │
│   │  Idle → Hello (on call start) → Talking / Idle           │  │
│   │  Amplitude from AnalyserNode drives mouth/head motion    │  │
│   └──────────────────────────────────────────────────────────┘  │
└───────────────────────────────────┬─────────────────────────────┘
                                     │
                                  WebSocket
                                  wss://railway
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                     FASTAPI BACKEND (Railway)                    │
│                                                                   │
│   ┌──────────────────────────────────────────────────────────┐  │
│   │  /ws  WebSocket endpoint                                  │  │
│   │                                                           │  │
│   │  1. Receives session config (job description, name)       │  │
│   │  2. Opens WebSocket to OpenAI Realtime API                │  │
│   │  3. Injects System Prompt + Shahaf's profile              │  │
│   │  4. Proxies audio chunks: browser ↔ OpenAI               │  │
│   │  5. Forwards transcript events back to frontend           │  │
│   └────────────────────────────┬─────────────────────────────┘  │
│                                 │                                 │
│   ┌──────────────────────────────────────────────────────────┐  │
│   │  SQLite DB                                                │  │
│   │  recruiter_sessions — logs name, company, job desc        │  │
│   └──────────────────────────────────────────────────────────┘  │
└───────────────────────────────────┬─────────────────────────────┘
                                     │
                              WebSocket (WSS)
                              audio in / audio out
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                   OPENAI REALTIME API                            │
│                                                                   │
│   Model: gpt-4o-realtime-preview                                 │
│                                                                   │
│   • Receives PCM16 24kHz mono audio from recruiter               │
│   • Understands speech in real time (no separate STT)            │
│   • Generates response as Shahaf based on system prompt          │
│   • Streams PCM16 audio response back (no separate TTS)          │
│   • Sends transcript of both sides as text events                │
└─────────────────────────────────────────────────────────────────┘
```

---

## Audio Pipeline (detailed)

```
Recruiter mic
    │
    ▼
MediaStream (browser)
    │
    ▼
AudioWorklet (Float32, 48kHz stereo)
    │  downsample to 24kHz mono + convert to Int16
    ▼
base64 PCM16 chunks
    │
    ▼ WebSocket
FastAPI /ws
    │  proxy — no processing
    ▼ WebSocket
OpenAI Realtime API
    │  generates audio response
    ▼ WebSocket
FastAPI /ws
    │  proxy back
    ▼ WebSocket
React Frontend
    │
    ▼
AudioContext → AudioBuffer → destination (speakers)
    │
    ▼
AnalyserNode → amplitude value → Avatar animation intensity
```

---

## Avatar Animation State Machine

```
Call starts
    │
    ▼
[ Hello ] — plays once, LoopOnce + clampWhenFinished
    │
    └─ on finish
         │
         ▼
    [ Idle ] ◀─────────────────────────────┐
         │                                  │
         │  OpenAI starts sending audio     │
         ▼                                  │
    [ Talking ]                             │
         │                                  │
         │  OpenAI audio ends               │
         └──────────────────────────────────┘

Note: Hips bone Y rotation is locked to Idle's value
      across all animations to prevent direction changes.
```

---

## Request Flow (one full exchange)

```
1. Recruiter opens meet-shahaf.vercel.app
2. Enters access code → validated client-side against env var
3. Fills setup form (name, company, optional job PDF)
4. Clicks "התחל ראיון" → POST /api/save-session (logged to DB)
5. WebSocket opens: frontend → backend → OpenAI
6. System prompt sent to OpenAI:
       - Shahaf's full profile (shahaf_profile.txt)
       - Job description (from PDF or typed text)
       - Recruiter's name and company
7. OpenAI sends greeting audio → recruiter hears Shahaf
8. Recruiter speaks → audio streamed to OpenAI in real time
9. OpenAI responds → audio streamed back → recruiter hears answer
10. Avatar animates based on whether audio is playing
11. Call ends → WebSocket closes → all connections released
```
