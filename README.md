# Meet Shahaf 🎙️

An AI voice agent with a 3D avatar that represents me in recruiter conversations — available 24/7, no scheduling needed.

Recruiters visit the link, see my 3D avatar, and have a real voice conversation with an AI that answers as if it were me.

---

## How It Works

A recruiter opens the link, enters an access code, and fills in their name and company. They can optionally upload a job description PDF. Once the call starts, they speak naturally — the AI responds in real time as Shahaf.

The entire audio pipeline is a single continuous stream:

```
Recruiter's mic → React Frontend → FastAPI Backend → OpenAI Realtime API
                                                              ↓
                                         Shahaf's AI voice back to recruiter
```

No speech-to-text. No text-to-speech. One end-to-end audio stream.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, Three.js, @react-three/fiber |
| 3D Avatar | GLB model with embedded animations (Avaturn + Mixamo) |
| Backend | Python, FastAPI, WebSockets |
| AI | OpenAI Realtime API (`gpt-4o-realtime-preview`) |
| Deploy | Vercel (frontend) · Railway (backend) |

---

## Live Demo

[meet-shahaf.vercel.app](https://meet-shahaf.vercel.app)
