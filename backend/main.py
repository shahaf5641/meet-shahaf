import asyncio
import io
import json
import os
import re
import sqlite3
from datetime import datetime
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup
from fastapi import HTTPException
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
    con.execute("""
        CREATE TABLE IF NOT EXISTS recruiter_sessions (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            recruiter_name   TEXT NOT NULL,
            company          TEXT NOT NULL,
            job_desc         TEXT,
            timestamp        TEXT NOT NULL
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
MODEL = "gpt-4o-mini-realtime-preview"
REALTIME_URL = f"wss://api.openai.com/v1/realtime?model={MODEL}"

# טען פרופיל מקובץ חיצוני
_profile_path = os.path.join(os.path.dirname(__file__), "shahaf_profile.txt")
with open(_profile_path, encoding="utf-8") as f:
    SHAHAF_PROFILE = f.read()

SYSTEM_PROMPT = f"""אתה שחף ישראל — מפתח תוכנה שמדבר עם מגייס בשיחה קולית.
אתה מייצג את שחף האמיתי. דבר בגוף ראשון, בעברית, בטון ידידותי וישיר.

כללי שיחה:
- ענה תמיד בעברית (אלא אם המגייס פונה באנגלית)
- תשובות מלאות: ענה תמיד תשובה שלמה שלא נחתכת באמצע. אין מגבלת משפטים — ענה כמה שצריך כדי שהתשובה תהיה שלמה ומובנת. עדיף תשובה ארוכה שלמה מאשר קצרה שנחתכת.
- אל תשאל שאלות אחרי כל תשובה — תפקידך לענות, לא לראיין. רק אם המגייס נגע בנושא שמעניין אותך להעמיק בו, תוכל לשאול שאלה קצרה אחת — אבל בצורה חריגה, לא כהרגל
- אל תגיד ביטויים כמו "איך אפשר לעזור", "במה אוכל לסייע" וכדומה — אתה לא עוזר שירות, אתה מועמד בראיון עבודה
- כשאתה עונה על שאלות, נסה לחבר את התשובה לדרישות המשרה (אם יש) ולהסביר בקצרה למה הרקע שלך רלוונטי
- כשנשאלות שאלות מהסוג "למה אתה מתאים למשרה", "מה מייחד אותך", "מה עושה אותך מועמד טוב לתפקיד הזה", "למה דווקא אתה", "האם אתה חושב שאתה מתאים" — זוהי שאלת סינתזה, **לא** שאלה על מידע חסר בפרופיל. אסור לקרוא ל-log_unknown_question על שאלות כאלה. חובה לענות: קרא את דרישות המשרה שנשלחו, זהה אילו דרישות מתאימות לניסיון שלך מהפרופיל, והסבר בצורה ממוקדת את הקשר. לדוגמה: אם המשרה דורשת Python ו-C# — ציין ניסיון קונקרטי בשניהם. אם המשרה מדברת על בק-אנד — ציין את הפרויקטים הרלוונטיים. אל תענה תשובה גנרית — תמיד קשר לדרישות הספציפיות של המשרה שלפניך.
- אתה יכול לענות **רק** על בסיס מה שכתוב בפרופיל שלך. **כלל מוחלט:** אם מידע כלשהו — בין אם זה כישור טכני, פרט אישי, שאלה על אורח חיים, מילואים, שכר, מצב משפחתי, או כל דבר אחר — לא מוזכר במפורש בפרופיל, אסור לענות עליו. לא לנחש. לא להסיק. לא לענות "לא" ולא "כן". חובה לקרוא ל-log_unknown_question ואז לומר: "אין לי מידע על זה בפרופיל שלי — כדאי לשאול אותי ישירות". זה כולל גם שאלות שנשמעות פשוטות כמו "האם אתה עושה מילואים?" — אם זה לא בפרופיל, אל תענה עליהן.
- כשמדברים על טכנולוגיה ספציפית — ציין בדיוק באיזה פרויקט או עבודה השתמשת בה. אל תגיד "השתמשתי ב-X" בלי להגיד איפה. אם הפרופיל לא מציין את הטכנולוגיה הזו באותו הקשר — אל תמציא.
- כשאין לך ניסיון בטכנולוגיה מסוימת — אמור זאת בכנות, אבל ציין ידע קרוב או מקביל מהפרופיל שיש לך. לדוגמה: אין ניסיון ב-Kubernetes → ציין ניסיון עם Docker. אין ניסיון ב-C++ → ציין ידע ב-C#. אין ניסיון בטכנולוגיה X → ציין את הדבר הכי דומה שכן יש בפרופיל. תמיד סיים עם "ואין לי בעיה ללמוד את זה".
- כשמדברים על רמת ידע — היה כנה לפי הפירוט בפרופיל. יש שלוש רמות: חזק (C#, Python, Git), בסיסי (Java, Docker, SQL, Azure DevOps וכו'), וחלש מאוד (Frontend — JavaScript, HTML, CSS, React, Tailwind).
- לגבי Frontend: אם שואלים — תגיד בפשטות שזה לא תחום החוזק העיקרי שלך, עבדת עם זה בפרויקטים, אבל הלב שלך הוא בצד הבאקאנד. בלי להגזים בחולשה.
- לגבי Java: בסיסי בלבד, מפרויקט תואר. C# הרבה יותר חזק.
- לגבי Docker: בסיסי — הרצת קונטיינרים בלבד, לא ארכיטקטורה מתקדמת.
- לגבי מילואים: אין מידע בפרופיל. אם שואלים — קרא ל-log_unknown_question ואמור "אין לי מידע על כך בפרופיל, כדאי לשאול אותי ישירות".
- כשאתה מדבר על "פרויקט שאתה גאה בו" או "הפרויקט הכי מאתגר" — דבר **רק** על אחד מהפרויקטים הבאים: AI Recruiter Avatar, Facebook Data Extractor, EscapeCode, GoNature. מה שעשית ב-Hexagon (תשתית הרשאות, Role Tests, Hooks Health Check) הן **משימות שביצעת בעבודה** — לא פרויקטים. כשמספרים עליהן, מציגים אותן כ"עבודה שעשיתי בהתמחות", לא כ"פרויקט".
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

from pydantic import BaseModel

TECH_KEYWORDS = [
    "developer","engineer","software","backend","frontend","fullstack","full-stack",
    "python","javascript","typescript","react","node","java","c#","golang","rust",
    "devops","cloud","aws","azure","gcp","kubernetes","docker","api","microservice",
    "מפתח","מהנדס","תוכנה","פיתוח","ריאקט","פייתון","ג'אווה","ענן","דבאופס"
]

class UrlExtractRequest(BaseModel):
    url: str

@app.post("/api/extract-url")
async def extract_url(req: UrlExtractRequest):
    url = req.url.strip()

    # ולידציה בסיסית של כתובת
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            raise ValueError()
    except Exception:
        raise HTTPException(status_code=400, detail="כתובת URL לא תקינה. ודא שהיא מתחילה ב-http:// או https://")

    # שליפת הדף
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        "Accept-Language": "he,en-US;q=0.9,en;q=0.8",
    }
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=12) as client:
            resp = await client.get(url, headers=headers)
    except Exception:
        raise HTTPException(status_code=400, detail="לא ניתן לגשת לכתובת. ודא שהיא פתוחה לציבור")

    if resp.status_code != 200:
        if "linkedin.com" in url:
            raise HTTPException(status_code=400, detail="לינקדאין דורש התחברות. נסה להעתיק את תיאור המשרה ולהדביק אותו ידנית")
        raise HTTPException(status_code=400, detail=f"הדף החזיר שגיאה {resp.status_code}")

    # חילוץ טקסט מ-HTML
    soup = BeautifulSoup(resp.text, "html.parser")
    for tag in soup(["script","style","nav","footer","header"]):
        tag.decompose()
    text = re.sub(r'\s+', ' ', soup.get_text(separator=' ')).strip()
    text = text[:6000]   # מקסימום 6000 תווים

    if len(text) < 100:
        raise HTTPException(status_code=400, detail="לא נמצא תוכן מספיק בדף")

    # ולידציה — האם זו משרה בהייטק/תוכנה?
    text_lower = text.lower()
    if not any(kw in text_lower for kw in TECH_KEYWORDS):
        raise HTTPException(status_code=400, detail="הדף לא נראה כמו משרת תוכנה/הייטק. ודא שהקישור מוביל למשרה רלוונטית")

    return {"text": text, "url": url}


class RecruiterSession(BaseModel):
    recruiter_name: str
    company: str
    job_desc: str = ""

@app.post("/api/save-session")
def save_session(data: RecruiterSession):
    """שמור פרטי מגייס ב-DB"""
    con = sqlite3.connect(DB_PATH)
    cur = con.execute(
        "INSERT INTO recruiter_sessions (recruiter_name, company, job_desc, timestamp) VALUES (?, ?, ?, ?)",
        (data.recruiter_name, data.company, data.job_desc, datetime.now().isoformat())
    )
    session_id = cur.lastrowid
    con.commit()
    con.close()
    print(f"📋 מגייס חדש: {data.recruiter_name} מ-{data.company}")
    return {"session_id": session_id}

@app.get("/api/sessions")
def get_sessions():
    """צפה בכל המגייסים שהתחברו"""
    con = sqlite3.connect(DB_PATH)
    rows = con.execute(
        "SELECT id, recruiter_name, company, job_desc, timestamp FROM recruiter_sessions ORDER BY timestamp DESC"
    ).fetchall()
    con.close()
    return [{"id": r[0], "name": r[1], "company": r[2], "job_desc": r[3][:100] if r[3] else "", "timestamp": r[4]} for r in rows]

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
                    "max_response_output_tokens": "inf",
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
                            elif ctrl.get("type") == "text_question":
                                # שאלה טקסטואלית — בטל תגובה קיימת, המתן, ואז צור חדשה
                                text = ctrl.get("text", "").strip()
                                if text:
                                    try:
                                        await oai_ws.send(json.dumps({"type": "response.cancel"}))
                                    except Exception:
                                        pass
                                    await asyncio.sleep(0.12)
                                    await oai_ws.send(json.dumps({
                                        "type": "conversation.item.create",
                                        "item": {
                                            "type": "message",
                                            "role": "user",
                                            "content": [{"type": "input_text", "text": text}]
                                        }
                                    }))
                                    await oai_ws.send(json.dumps({"type": "response.create"}))
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
