"""
מייצר קבצי WAV סטטיים לתשובות לשאלות הצפות.
הרץ פעם אחת:
  cd backend
  venv\Scripts\activate
  python generate_questions_audio.py
"""
import json
import os
import wave
import base64
from dotenv import load_dotenv
from websockets.sync.client import connect as ws_connect_sync

load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
MODEL = "gpt-4o-mini-realtime-preview"
REALTIME_URL = f"wss://api.openai.com/v1/realtime?model={MODEL}"
SAMPLE_RATE = 24000

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "../frontend/public/answers")
os.makedirs(OUTPUT_DIR, exist_ok=True)

QUESTIONS = [
    {
        "file": "q1_hexagon.wav",
        "text": (
            "ב-Hexagon עשיתי internship כחלק מצוות הפיתוח, ועבדתי בצמוד ל-SDET של הצוות. "
            "עבדתי בסביבה אג'ילית עם C#, Azure DevOps ומערכות מבוססות אירועים — "
            "בניתי health-check tests, שיפרתי תשתיות בדיקות קיימות, "
            "ובניתי מאפס תשתית לבדיקות הרשאות end-to-end לפי תפקידי המערכת. "
            "הניסיון הזה לימד אותי לעבוד בצורה מסודרת בסביבה תעשייתית, "
            "לכתוב קוד איכותי, ולהשתלב נכון בתוך צוות פיתוח."
        ),

    },
    {
        "file": "q2_escapecode.wav",
        "text": (
            "EscapeCode הוא משחק פאזלים תלת-ממדי שפיתחתי ב-Unity עם C# כפרויקט גמר. "
            "כל חידה במשחק מייצגת קונספט תכנותי כמו לולאות ותנאים, בצורה חווייתית. "
            "שמתי דגש גדול על נגישות — תמיכה בקוראי מסך, ניגודיות גבוהה ואפשרויות התאמה אישית לממשק."
        ),
    },
    {
        "file": "q3_facebook.wav",
        "text": (
            "פיתחתי כלי לאיסוף אוטומטי של פוסטים מקבוצות פייסבוק. "
            "הכלי עובד עם Python ו-Selenium לאוטומציה של Chrome, Flask לבקאנד וממשק web, "
            "Redis לניהול תור עבודות, ו-PostgreSQL לשמירת היסטוריית ריצות. "
            "הכל רץ בתוך Docker Compose, והשרת חשוף לאינטרנט דרך ngrok — "
            "כך שמשתמשים יכולים להשתמש בו מכל מקום בלי להתקין כלום. "
            "יש תור — רק ריצה אחת פועלת בכל זמן נתון, והשאר ממתינים."
        ),
    },
    {
        "file": "q4_strengths.wav",
        "text": (
            "החוזקות שלי הן Python ו-C#, בעיקר בצד הבקאנד. "
            "יש לי ניסיון חזק בבדיקות ואוטומציה מה-internship ב-Hexagon, "
            "ואני נהנה לעבוד על בעיות מורכבות — בין אם זה תשתיות בדיקות, integration עם APIs, "
            "או פיתוח מערכות server-side. "
            "AI integrations זה תחום שאני נוגע בו הרבה ומוצא בו עניין אמיתי."
        ),
    },
    {
        "file": "q5_learning.wav",
        "text": (
            "אני מתחיל בסרטוני יוטיוב להבנה כללית, אחר כך נעזר ב-AI לשאלות ספציפיות ולהסברים. "
            "אחרי שיש לי בסיס, הכי יעיל זה לבנות פרויקט קטן מאפס — ממש להתלכלך בקוד ולראות מה קורה. "
            "ככה למדתי OpenAI Realtime API ו-WebSockets לפרויקט Meet Shahaf."
        ),
    },
    {
        "file": "q6_future.wav",
        "text": (
            "אני רוצה לצמוח בתוך הצוות שאצטרף אליו ולהפוך למישהו שאפשר לסמוך עליו. "
            "להכיר את הקוד לעומק, לקחת אחריות על תחומים, "
            "ואולי בעתיד לקחת תפקיד בכיר יותר — בין אם טכני או בכיוון של Scrum Master. "
            "העיקר זה לגדול בתוך הארגון."
        ),
    },
    {
        "file": "q7_environment.wav",
        "text": (
            "אני מחפש סביבה שמאפשרת למידה מתמדת — עם קולגות שאפשר ללמוד מהם ואתגרים טכניים אמיתיים. "
            "חשוב לי שתהיה תרבות של ownership, שאוכל לקחת אחריות על דברים ולא רק לבצע משימות. "
            "ועבודה על מוצר עם השפעה אמיתית — זה מה שנותן לי מוטיבציה."
        ),
    },
    {
        "file": "q_gold.wav",
        "text": (
            "Meet Shahaf נולד מרעיון פשוט: מגייסים יוכלו לראיין אותי בכל שעה, גם בלילה. "
            "בניתי frontend ב-React עם Three.js לאווטר תלת-ממדי שמונפש בזמן אמת לפי amplitude הדיבור. "
            "הבקאנד הוא FastAPI שמחזיק WebSocket ישיר ל-gpt-4o-realtime-preview של OpenAI — "
            "המודל הכי מתקדם של Realtime API. "
            "הכי מעניין טכנית זה ה-audio pipeline: "
            "הדפדפן מצלם PCM16 24kHz ושולח ישירות ל-OpenAI, "
            "שמחזיר audio בחזרה — pipeline אחד רציף, ללא latency."
        ),
    },
]


def generate_one(text, output_path):
    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "OpenAI-Beta": "realtime=v1",
    }
    pcm_chunks = []

    with ws_connect_sync(REALTIME_URL, additional_headers=headers) as ws:
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
        ws.send(json.dumps({
            "type": "conversation.item.create",
            "item": {
                "type": "message",
                "role": "user",
                "content": [{"type": "input_text", "text": text}]
            }
        }))
        ws.send(json.dumps({"type": "response.create"}))

        while True:
            msg = json.loads(ws.recv())
            t = msg.get("type", "")
            if t == "response.audio.delta" and msg.get("delta"):
                pcm_chunks.append(base64.b64decode(msg["delta"]))
            elif t == "response.done":
                break
            elif t == "error":
                print(f"  Error: {msg}")
                return False

    if not pcm_chunks:
        print("  No audio received!")
        return False

    raw_pcm = b"".join(pcm_chunks)
    with wave.open(output_path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(raw_pcm)

    duration = len(raw_pcm) / (SAMPLE_RATE * 2)
    print(f"  Saved ({duration:.1f}s, {len(pcm_chunks)} chunks)")
    return True


if __name__ == "__main__":
    print(f"Generating {len(QUESTIONS)} answer files...\n")
    for i, q in enumerate(QUESTIONS, 1):
        output_path = os.path.join(OUTPUT_DIR, q["file"])
        print(f"[{i}/{len(QUESTIONS)}] {q['file']}")
        generate_one(q["text"], output_path)

    print("\nDone! All files saved to frontend/public/answers/")
