import asyncio
import json
import os
import websockets
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
MODEL = "gpt-4o-realtime-preview-2025-06-03"
REALTIME_URL = f"wss://api.openai.com/v1/realtime?model={MODEL}"

# ✏️ ערוך את הפרופיל שלך כאן
SYSTEM_PROMPT = """אתה שחף, מפתח Full Stack עם 3 שנות ניסיון.
אתה מדבר עם מגייס בשיחה קולית. ענה בעברית, בקצרה (2-3 משפטים),
בטון ידידותי ומקצועי. אחרי כל תשובה שאל שאלה קצרה בחזרה.

כישורים עיקריים: Python, React, FastAPI, Node.js, PostgreSQL, Docker
ניסיון: פיתוח web apps, APIs, אינטגרציות AI
"""

@app.get("/")
def root():
    return {"status": "ok", "message": "AI Recruiter backend running"}

@app.websocket("/ws")
async def recruiter_session(ws: WebSocket):
    await ws.accept()
    print("✅ מגייס התחבר")

    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "OpenAI-Beta": "realtime=v1",
    }

    try:
        async with websockets.connect(
            REALTIME_URL, additional_headers=headers
        ) as oai_ws:

            # הגדר session
            await oai_ws.send(json.dumps({
                "type": "session.update",
                "session": {
                    "instructions": SYSTEM_PROMPT,
                    "voice": "shimmer",
                    "input_audio_format": "pcm16",
                    "output_audio_format": "pcm16",
                    "input_audio_transcription": {"model": "whisper-1"},
                    "turn_detection": {
                        "type": "server_vad",
                        "threshold": 0.5,
                        "silence_duration_ms": 600,
                    },
                    "max_response_output_tokens": 200,
                },
            }))

            async def from_client():
                """קבל audio מהמגייס → שלח ל-OpenAI"""
                try:
                    async for chunk in ws.iter_bytes():
                        await oai_ws.send(json.dumps({
                            "type": "input_audio_buffer.append",
                            "audio": chunk.decode("utf-8"),
                        }))
                except WebSocketDisconnect:
                    pass

            async def from_openai():
                """קבל תשובה מ-OpenAI → שלח למגייס"""
                try:
                    async for raw in oai_ws:
                        data = json.loads(raw)
                        event_type = data.get("type", "")

                        if event_type == "response.audio.delta":
                            # שלח audio chunk
                            audio_hex = data.get("delta", "")
                            if audio_hex:
                                await ws.send_json({
                                    "type": "audio",
                                    "data": audio_hex,
                                })

                        elif event_type == "response.audio_transcript.delta":
                            # שלח טקסט לתצוגה
                            await ws.send_json({
                                "type": "transcript",
                                "text": data.get("delta", ""),
                            })

                        elif event_type == "input_audio_buffer.speech_started":
                            await ws.send_json({"type": "user_speaking"})

                        elif event_type == "response.created":
                            await ws.send_json({"type": "avatar_talking"})

                        elif event_type == "response.done":
                            await ws.send_json({"type": "avatar_idle"})

                except Exception as e:
                    print(f"OpenAI error: {e}")

            await asyncio.gather(from_client(), from_openai())

    except WebSocketDisconnect:
        print("👋 מגייס התנתק")
    except Exception as e:
        print(f"❌ שגיאה: {e}")
        await ws.close()
