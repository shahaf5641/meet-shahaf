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
            "עבדתי בסביבה אג'ילית עם .NET, C#, Azure DevOps ומערכות מבוססות אירועים, "
            "שם בניתי health-check tests, שיפרתי תשתיות בדיקות קיימות, "
            "והקמתי מאפס תשתית לבדיקות הרשאות end-to-end לפי תפקידי המערכת. "
            "הניסיון הזה חיזק לי את היכולת לעבוד בצורה מסודרת בסביבה תעשייתית, "
            "לכתוב קוד איכותי, ולהשתלב נכון בתוך צוות פיתוח."
        ),
    },
    {
        "file": "q2_escapecode.wav",
        "text": (
            "EscapeCode הוא משחק פאזל תלת-ממדי שפיתחתי ב-Unity עם C# כפרויקט גמר. "
            "מדובר במשחק escape room לימודי, שבו השחקן מתקדם בין חדרים באמצעות פתרון חידות ואתגרי קוד שמלמדים יסודות בתכנות. "
            "בפרויקט שמתי דגש משמעותי על נגישות, עם שילוב של eye tracking, speech-to-text ועוזר AI שמסייע לשחקן במהלך המשחק."
        ),
    },
    {
        "file": "q3_facebook.wav",
        "text": (
            "פיתחתי מערכת לאיסוף אוטומטי של פוסטים מקבוצות פייסבוק. "
            "המערכת בנויה עם Python ו-Selenium לאוטומציה של הדפדפן, Flask לבקאנד ולממשק ה-web, "
            "Redis לניהול תור וריצה בזמן אמת, ו-PostgreSQL לשמירת היסטוריית ריצות. "
            "הכול רץ בתוך Docker Compose, והמערכת יכולה להיחשף דרך ngrok, "
            "כך שמשתמשים יכולים לגשת אליה מרחוק בלי להתקין כלום. "
            "בנוסף, יש מנגנון תור שבו רק ריצה אחת מתבצעת בכל רגע, ושאר הבקשות ממתינות בצורה מסודרת."
        ),
    },
    {
        "file": "q4_strengths.wav",
        "text": (
            "החוזקות המרכזיות שלי הן Python ו-C#, בעיקר בצד הבקאנד. "
            "יש לי ניסיון משמעותי בבדיקות, אוטומציה ועבודה עם מערכות מורכבות מה-internship ב-Hexagon, "
            "ואני נהנה להיכנס לעומק של בעיות טכניות, בין אם זה תשתיות בדיקות, אינטגרציה עם APIs, "
            "או פיתוח של מערכות server-side. "
            "בנוסף, תחום ה-AI integrations מאוד מעניין אותי, ואני גם נהנה לעבוד עליו בפועל בפרויקטים שלי."
        ),
    },
    {
        "file": "q5_learning.wav",
        "text": (
            "אני בדרך כלל מתחיל מסרטוני יוטיוב כדי לקבל תמונה כללית על התחום, "
            "ואחר כך נעזר ב-AI לשאלות יותר ממוקדות ולהבנה של נקודות ספציפיות. "
            "אבל מבחינתי הלמידה האמיתית מתחילה כשאני בונה משהו בעצמי, "
            "כי שם באמת מבינים איך הדברים עובדים בפועל. "
            "ככה למדתי למשל את OpenAI Realtime API ואת WebSockets בפרויקט Meet Shahaf."
        ),
    },
    {
        "file": "q6_future.wav",
        "text": (
            "בעוד שלוש שנים אני רואה את עצמי במקום שבו צברתי עומק מקצועי אמיתי, "
            "מכיר את המערכת לעומק, ולוקח אחריות על תחומים משמעותיים. "
            "חשוב לי להמשיך להתפתח כמהנדס תוכנה, להיות מישהו שאפשר לסמוך עליו, "
            "ולתרום בצורה משמעותית לצוות ולארגון."
        ),
    },
    {
        "file": "q7_environment.wav",
        "text": (
            "אני מחפש סביבה שמאפשרת למידה והתפתחות מקצועית לאורך זמן, "
            "עם אנשים חזקים שאפשר ללמוד מהם ואתגרים טכניים אמיתיים. "
            "חשוב לי לעבוד במקום שיש בו ownership, "
            "שבו אפשר לקחת אחריות אמיתית ולא רק לבצע משימות. "
            "מעבר לזה, מאוד חשוב לי לעבוד על מוצר או מערכת שיש להם ערך והשפעה אמיתית."
        ),
    },
    {
        "file": "q_gold.wav",
        "text": (
            "Meet Shahaf נולד מתוך רעיון לאפשר למגייסים ליצור איתי אינטראקציה גם בלי להיות תלויים בשעה מסוימת. "
            "בניתי frontend ב-React עם Three.js, שמציג אווטר תלת-ממדי ומייצר חוויית שיחה אינטראקטיבית. "
            "בצד השרת בניתי backend ב-FastAPI שעובד כ-WebSocket proxy מול OpenAI Realtime API. "
            "החלק הכי מעניין מבחינתי היה לבנות את ה-audio pipeline בזמן אמת, "
            "כך שהדפדפן שולח אודיו בזרם רציף ומקבל תשובה קולית חזרה, "
            "כדי לייצר שיחה טבעית, רציפה, וב-latency נמוך."
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
