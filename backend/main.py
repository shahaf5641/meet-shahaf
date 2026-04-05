import asyncio
import io
import json
import os
import sqlite3
from datetime import datetime
from websockets.legacy.client import connect as ws_connect
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from pypdf import PdfReader

DB_PATH = os.path.join(os.path.dirname(__file__), "recruiter.db")

def init_db():
    con = sqlite3.connect(DB_PATH)
    con.execute("""
        CREATE TABLE IF NOT EXISTS unknown_questions (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            question  TEXT NOT NULL,
            timestamp TEXT NOT NULL
        )
    """)
    con.commit()
    con.close()

def save_unknown_question(question: str, job_context: str = ""):
    try:
        con = sqlite3.connect(DB_PATH)
        con.execute(
            "INSERT INTO unknown_questions (question, timestamp) VALUES (?, ?)",
            (question, datetime.now().isoformat())
        )
        con.commit()
        con.close()
        print(f"❓ שאלה נשמרה: {question}")
    except Exception as e:
        print(f"שגיאה בשמירת שאלה: {e}")

init_db()

load_dotenv()

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
MODEL = "gpt-4o-realtime-preview"
REALTIME_URL = f"wss://api.openai.com/v1/realtime?model={MODEL}"

# טען פרופיל מקובץ חיצוני
_profile_path = os.path.join(os.path.dirname(__file__), "shahaf_profile.txt")
with open(_profile_path, encoding="utf-8") as f:
    SHAHAF_PROFILE = f.read()

SYSTEM_PROMPT = f"""אתה שחף ישראל — מפתח תוכנה שמדבר עם מגייס בשיחה קולית.
אתה מייצג את שחף האמיתי. דבר בגוף ראשון, בעברית, בטון ידידותי וישיר.

כללי שיחה:
- ענה תמיד בעברית (אלא אם המגייס פונה באנגלית)
- תשובות קצרות: עד 4 משפטים בלבד — זו שיחה קולית, לא מייל. אם התשובה ארוכה יותר, קצר אותה.
- אל תשאל שאלות אחרי כל תשובה — תפקידך לענות, לא לראיין. רק אם המגייס נגע בנושא שמעניין אותך להעמיק בו, תוכל לשאול שאלה קצרה אחת — אבל בצורה חריגה, לא כהרגל
- אל תגיד ביטויים כמו "איך אפשר לעזור", "במה אוכל לסייע" וכדומה — אתה לא עוזר שירות, אתה מועמד בראיון עבודה
- כשאתה עונה על שאלות, נסה לחבר את התשובה לדרישות המשרה (אם יש) ולהסביר בקצרה למה הרקע שלך רלוונטי
- אתה יכול לענות **רק** על בסיס מה שכתוב בפרופיל שלך. אתה לא משתמש בידע כללי — אתה שחף, לא AI. אם שאלה נוגעת לכישור, טכנולוגיה, או נסיון שלא מוזכר בפרופיל — חובה לקרוא ל-log_unknown_question ואז לומר שאין לך מידע על זה. גם אם אתה "יודע" את התשובה כ-AI — אם זה לא בפרופיל, אל תענה עליו.
- כשמדברים על טכנולוגיה ספציפית — ציין בדיוק באיזה פרויקט או עבודה השתמשת בה. אל תגיד "השתמשתי ב-X" בלי להגיד איפה. אם הפרופיל לא מציין את הטכנולוגיה הזו באותו הקשר — אל תמציא.
- כשאין לך ניסיון בטכנולוגיה מסוימת — אמור זאת בכנות, אבל ציין ידע קרוב או מקביל מהפרופיל שיש לך. לדוגמה: אין ניסיון ב-Kubernetes → ציין ניסיון עם Docker. אין ניסיון ב-C++ → ציין C# ו-Java. אין ניסיון בטכנולוגיה X → ציין את הדבר הכי דומה שכן יש בפרופיל. תמיד סיים עם "ואין לי בעיה ללמוד את זה".
- הדגש את הפרויקטים והיכולת ללמוד מהר
- אתה בוגר טרי עם ניסיון מעשי אמיתי — היה ביטחוני בלי להגזים
- לגבי תפקידים: אל תאמר שאתה "פתוח לכל תפקיד" — זה נשמע נואש. במקום זה, אמור שאתה נמשך לכל עולמות התוכנה. רק אם שואלים ספציפית מה הכי מעניין — אז תגיד DevOps
- לגבי הטיול: אל תזכיר את הטיול ביוזמתך. רק אם שואלים ישירות על מה עשית לאחרונה / מה היה בחצי השנה האחרונה / למה יש פער — אז תסביר

--- פרופיל שחף ---
{SHAHAF_PROFILE}
-------------------
"""

@app.get("/")
def root():
    return {"status": "ok", "message": "AI Recruiter backend running"}

@app.get("/unknown-questions")
def get_unknown_questions():
    """צפה בכל השאלות שהסוכן לא ידע לענות עליהן"""
    con = sqlite3.connect(DB_PATH)
    rows = con.execute(
        "SELECT id, question, timestamp FROM unknown_questions ORDER BY timestamp DESC"
    ).fetchall()
    con.close()
    return [{"id": r[0], "question": r[1], "timestamp": r[2]} for r in rows]

@app.post("/extract-pdf")
async def extract_pdf(file: UploadFile = File(...)):
    """חלץ טקסט מקובץ PDF של דרישות משרה"""
    contents = await file.read()

    def extract():
        reader = PdfReader(io.BytesIO(contents))
        return "\n".join(page.extract_text() or "" for page in reader.pages)

    loop = asyncio.get_event_loop()
    text = await loop.run_in_executor(None, extract)
    return {"text": text.strip()}

@app.websocket("/ws")
async def recruiter_session(ws: WebSocket):
    await ws.accept()
    print("✅ מגייס התחבר")

    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "OpenAI-Beta": "realtime=v1",
    }

    try:
        # קבל job description מהמגייס לפני שמתחילים (ההודעה הראשונה)
        job_description = ""
        try:
            first_msg = await asyncio.wait_for(ws.receive_text(), timeout=30.0)
            first_data = json.loads(first_msg)
            if first_data.get("type") == "job_description":
                job_description = first_data.get("text", "").strip()
        except (asyncio.TimeoutError, json.JSONDecodeError, Exception):
            pass

        # בנה system prompt דינמי עם דרישות המשרה
        job_section = ""
        if job_description:
            job_section = f"""
--- דרישות המשרה שהמגייס מחפש ---
{job_description}
---------------------------------

בהתבסס על דרישות המשרה הללו — הדגש את הניסיון והכישורים הרלוונטיים ביותר שלך.
אם שואלים על כישור שמופיע בדרישות — התייחס אליו ישירות.
"""
        dynamic_prompt = SYSTEM_PROMPT + job_section

        print(f"🔌 מתחבר ל-OpenAI: {REALTIME_URL}")
        async with ws_connect(
            REALTIME_URL, extra_headers=headers
        ) as oai_ws:
            print("✅ חיבור ל-OpenAI הצליח")

            # הגדר session עם prompt דינמי + tool לשאלות לא ידועות
            await oai_ws.send(json.dumps({

                "type": "session.update",
                "session": {
                    "instructions": dynamic_prompt,
                    "voice": "echo",
                    "input_audio_format": "pcm16",
                    "output_audio_format": "pcm16",
                    "input_audio_transcription": {"model": "whisper-1"},
                    "turn_detection": {
                        "type": "server_vad",
                        "threshold": 0.8,
                        "silence_duration_ms": 1200,
                        "prefix_padding_ms": 400,
                    },
                    "max_response_output_tokens": 600,
                    "tools": [{
                        "type": "function",
                        "name": "log_unknown_question",
                        "description": "Call this function whenever you are asked something you don't have information about in your profile, or when you are not confident in the answer. Always call this before responding that you don't know.",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "question": {
                                    "type": "string",
                                    "description": "The exact question the recruiter asked"
                                }
                            },
                            "required": ["question"]
                        }
                    }],
                    "tool_choice": "auto",
                },
            }))

            # טריגר לפתיחת השיחה — הסוכן מדבר ראשון
            if job_description:
                opening_instruction = (
                    "פתח את השיחה בברכה קצרה ואמור שראית את דרישות המשרה ואתה מוכן לשאלות. "
                    "אל תסכם את הדרישות ואל תפרט אותן — רק ברך והזמן לשאול. "
                    "משפט אחד-שניים בלבד."
                )
            else:
                opening_instruction = (
                    "פתח את השיחה בברכה חמה וקצרה — שלום, מה שלומך, שמח להיות כאן. "
                    "משפט אחד-שניים בלבד, ואז עצור וחכה לשאלה."
                )

            await oai_ws.send(json.dumps({
                "type": "conversation.item.create",
                "item": {
                    "type": "message",
                    "role": "user",
                    "content": [{"type": "input_text", "text": f"[{opening_instruction}]"}]
                }
            }))
            await oai_ws.send(json.dumps({"type": "response.create"}))

            async def from_client():
                """קבל audio / פקודות מהמגייס → שלח ל-OpenAI"""
                try:
                    async for chunk in ws.iter_text():
                        # בדוק אם זו פקודת שליטה (JSON) או אודיו (base64)
                        try:
                            ctrl = json.loads(chunk)
                            if ctrl.get("type") == "stop_agent":
                                await oai_ws.send(json.dumps({"type": "response.cancel"}))
                        except (json.JSONDecodeError, ValueError):
                            # לא JSON — זהו אודיו base64
                            await oai_ws.send(json.dumps({
                                "type": "input_audio_buffer.append",
                                "audio": chunk,
                            }))
                except WebSocketDisconnect:
                    pass

            async def from_openai():
                """קבל תשובה מ-OpenAI → שלח למגייס"""
                pending_tool_calls = {}  # call_id → accumulated args

                try:
                    print("👂 מאזין ל-OpenAI...")
                    async for raw in oai_ws:
                        event_type_log = json.loads(raw).get("type", "?")
                        print(f"📨 OpenAI event: {event_type_log}")
                        data = json.loads(raw)
                        event_type = data.get("type", "")

                        if event_type == "response.audio.delta":
                            audio_hex = data.get("delta", "")
                            if audio_hex:
                                await ws.send_json({"type": "audio", "data": audio_hex})

                        elif event_type == "response.audio_transcript.delta":
                            await ws.send_json({"type": "transcript", "text": data.get("delta", "")})

                        elif event_type == "input_audio_buffer.speech_started":
                            await ws.send_json({"type": "user_speaking"})

                        elif event_type == "response.created":
                            await ws.send_json({"type": "avatar_talking"})

                        elif event_type == "response.done":
                            await ws.send_json({"type": "avatar_idle"})

                        elif event_type == "response.output_item.added":
                            item = data.get("item", {})
                            if item.get("type") == "function_call":
                                call_id = item.get("call_id", "")
                                pending_tool_calls[call_id] = {"name": item.get("name", ""), "args": ""}

                        elif event_type == "response.function_call_arguments.delta":
                            call_id = data.get("call_id", "")
                            if call_id in pending_tool_calls:
                                pending_tool_calls[call_id]["args"] += data.get("delta", "")

                        elif event_type == "response.function_call_arguments.done":
                            call_id = data.get("call_id", "")
                            tool = pending_tool_calls.pop(call_id, None)
                            if tool and tool["name"] == "log_unknown_question":
                                try:
                                    args = json.loads(tool["args"])
                                    save_unknown_question(args.get("question", ""), job_description)
                                except Exception:
                                    pass
                            # החזר תוצאה ל-OpenAI כדי שהשיחה תמשיך
                            await oai_ws.send(json.dumps({
                                "type": "conversation.item.create",
                                "item": {
                                    "type": "function_call_output",
                                    "call_id": call_id,
                                    "output": "logged"
                                }
                            }))
                            await oai_ws.send(json.dumps({"type": "response.create"}))

                except Exception as e:
                    print(f"❌ OpenAI error: {type(e).__name__}: {e}")

            await asyncio.gather(from_client(), from_openai())

    except WebSocketDisconnect:
        print("👋 מגייס התנתק")
    except Exception as e:
        import traceback
        print(f"❌ שגיאה: {type(e).__name__}: {e}")
        traceback.print_exc()
        try:
            await ws.close()
        except Exception:
            pass
