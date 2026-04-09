"""
מייצר intro.wav דרך OpenAI Realtime API — אותו קול בדיוק כמו בשיחה.
הרץ פעם אחת:
  cd backend
  venv\Scripts\activate
  python generate_intro_realtime.py
"""
import asyncio
import json
import os
import struct
import wave
import base64
from dotenv import load_dotenv
from websockets.sync.client import connect as ws_connect_sync

load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
MODEL = "gpt-4o-mini-realtime-preview"
REALTIME_URL = f"wss://api.openai.com/v1/realtime?model={MODEL}"

INTRO_TEXT = (
    "היי, נעים מאוד, אני שחף ישראל, בן עשרים ושמונה מקריית אתא, בוגר הנדסת תוכנה ממכללת אורט בראודה. "
    "במהלך הלימודים עשיתי התמחות בחברת Hexagon, שם עבדתי בצוות פיתוח "
    "ועבדתי בעיקר על תשתיות בדיקות ואוטומציה. "
    "בין הדברים שעשיתי שם: יצרתי בדיקות health-check למערכת מבוססת אירועים, "
    "שיפרתי את תשתית יצירת האובייקטים בטסטים, "
    "ובניתי מאפס תשתית לבדיקות הרשאות מקצה לקצה לפי תפקידי המערכת. "
    "מעבר לזה, פיתחתי כמה פרויקטים עצמאיים — "
    "ביניהם EscapeCode, משחק פאזלים תלת-ממדי ללימוד קוד עם דגש על נגישות, "
    "ופרויקט אוטומציה לאיסוף נתונים מקבוצות פייסבוק עם ממשק web מלא. "
    "היום אני מחפש את התפקיד הבא שלי — מקום שבו אוכל לצמוח, להתפתח, ולהביא ערך אמיתי."
)

OUTPUT_PATH = os.path.join(os.path.dirname(__file__), "../frontend/public/intro.wav")
SAMPLE_RATE = 24000

def generate():
    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "OpenAI-Beta": "realtime=v1",
    }

    pcm_chunks = []

    with ws_connect_sync(REALTIME_URL, additional_headers=headers) as ws:
        print("Connected to Realtime API...")

        # הגדר session
        ws.send(json.dumps({
            "type": "session.update",
            "session": {
                "instructions": (
                    "You are a TTS (text-to-speech) engine. "
                    "Your ONLY job is to read the user message out loud, word for word, exactly as written, in Hebrew. "
                    "Do NOT add any commentary, reaction, introduction, or extra words. "
                    "Do NOT say things like 'זה נשמע כמו' or 'אני שומע ש' or any similar phrase. "
                    "Do NOT respond to the content — just read it verbatim and stop."
                ),
                "voice": "echo",
                "input_audio_format": "pcm16",
                "output_audio_format": "pcm16",
                "turn_detection": None,
                "max_response_output_tokens": 4096,
            }
        }))

        # שלח את הטקסט
        ws.send(json.dumps({
            "type": "conversation.item.create",
            "item": {
                "type": "message",
                "role": "user",
                "content": [{"type": "input_text", "text": INTRO_TEXT}]
            }
        }))
        ws.send(json.dumps({"type": "response.create"}))

        # קבל audio chunks
        while True:
            msg = json.loads(ws.recv())
            t = msg.get("type", "")

            if t == "response.audio.delta" and msg.get("delta"):
                chunk = base64.b64decode(msg["delta"])
                pcm_chunks.append(chunk)

            elif t == "response.done":
                print(f"Done. Received {len(pcm_chunks)} audio chunks.")
                break

            elif t == "error":
                print(f"Error: {msg}")
                break

    if not pcm_chunks:
        print("No audio received!")
        return

    # שמור כ-WAV
    raw_pcm = b"".join(pcm_chunks)
    with wave.open(OUTPUT_PATH, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)  # 16-bit
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(raw_pcm)

    duration = len(raw_pcm) / (SAMPLE_RATE * 2)
    print(f"Saved to {OUTPUT_PATH} ({duration:.1f}s)")

if __name__ == "__main__":
    generate()
