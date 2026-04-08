# Meet Shahaf 🎙️

An AI voice agent with a 3D avatar that represents me in recruiter conversations — available 24/7, no scheduling needed.

Recruiters visit the link, see my 3D avatar, and have a real voice conversation with an AI that answers as if it were me.

---

## Architecture

```mermaid
flowchart TD
    A([Recruiter]) -->|1. access code + setup form| B[React Frontend\nVercel]

    B -->|2. open WebSocket| C[FastAPI Backend\nRailway]
    C -->|3. save session| D[(SQLite DB)]
    C -->|4. open WebSocket +\nSystem Prompt| E[OpenAI Realtime API\ngpt-4o-realtime-preview]

    E -->|System Prompt contains| F[Shahaf profile +\nbehavior rules +\njob description]

    A -->|5. speaks into mic| B
    B -->|6. PCM16 audio stream| C
    C -->|7. proxy audio| E

    E -->|8. AI voice response| C
    C -->|9. proxy back| B
    B -->|10. plays audio| A

    B -->|audio amplitude| G[3D Avatar\nThree.js]
    G -->|Idle · Talking · Hello| G
```

---

## How It Works

A recruiter opens the link, enters an access code, and fills in their name and company. They can optionally upload a job description PDF. Once the call starts, they speak naturally — the AI responds in real time as Shahaf.

The entire audio pipeline is a single continuous stream — no separate speech-to-text or text-to-speech steps.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, Three.js, @react-three/fiber |
| 3D Avatar | GLB model with embedded animations |
| Backend | Python, FastAPI, WebSockets |
| AI | OpenAI Realtime API (`gpt-4o-realtime-preview`) |
| Deploy | Vercel (frontend) · Railway (backend) |

---

## Live

[meet-shahaf.vercel.app](https://meet-shahaf.vercel.app)
