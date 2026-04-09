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
    "היי, נעים מאוד, אני שחף ישראל, בן 28 מקריית אתא, בוגר B.Sc. בהנדסת תוכנה ממכללת אורט בראודה. "
    "במהלך השנה האחרונה ללימודים שלי עבדתי כסטודנט בחברת Hexagon, עבדתי בצוות פיתוח שם השתלבתי בסביבת פיתוח אגילית "
    "ועבדתי בעיקר על תשתיות בדיקות ואוטומציה. במסגרת התפקיד יצרתי בדיקות health-check למערכת מבוססת אירועים, "
    "שיפרתי תשתית ליצירת אובייקטים בטסטים, וגם בניתי תשתית לבדיקות הרשאות מקצה לקצה. "
    "מעבר לזה, עבדתי על פרויקטים משמעותיים, ביניהם EscapeCode, משחק פאזלים תלת-ממדי ללימוד קוד עם דגש על נגישות, "
    "ופרויקט אוטומציה לאיסוף מידע מקבוצות פייסבוק. "
    "היום אני מחפש את מקום העבודה הבא שלי, מקום שבו אוכל לצמוח ולהביא ערך אמיתי דרך תוכנה."
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
                "instructions": "You are a text-to-speech system. Read the given text exactly as written, word for word.",
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
