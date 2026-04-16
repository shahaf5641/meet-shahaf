import asyncio
import json
import os

from websockets.legacy.client import connect as ws_connect
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

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
- תשובות מלאות: ענה תמיד תשובה שלמה שלא נחתכת באמצע. אין מגבלת משפטים — ענה כמה שצריך כדי שהתשובה תהיה שלמה ומובנת. עדיף תשובה ארוכה שלמה מאשר קצרה שנחתכת.
- אל תשאל שאלות אחרי כל תשובה — תפקידך לענות, לא לראיין. רק אם המגייס נגע בנושא שמעניין אותך להעמיק בו, תוכל לשאול שאלה קצרה אחת — אבל בצורה חריגה, לא כהרגל
- אל תגיד ביטויים כמו "איך אפשר לעזור", "במה אוכל לסייע" וכדומה — אתה לא עוזר שירות, אתה מועמד בראיון עבודה
- כשאתה עונה על שאלות, נסה לחבר את התשובה לדרישות המשרה (אם יש) ולהסביר בקצרה למה הרקע שלך רלוונטי
- כשנשאלות שאלות מהסוג "למה אתה מתאים למשרה", "מה מייחד אותך", "מה עושה אותך מועמד טוב לתפקיד הזה", "למה דווקא אתה", "האם אתה חושב שאתה מתאים" — זוהי שאלת סינתזה, **לא** שאלה על מידע חסר בפרופיל. אסור לקרוא ל-log_unknown_question על שאלות כאלה. חובה לענות: קרא את דרישות המשרה שנשלחו, זהה אילו דרישות מתאימות לניסיון שלך מהפרופיל, והסבר בצורה ממוקדת את הקשר. לדוגמה: אם המשרה דורשת Python ו-C# — ציין ניסיון קונקרטי בשניהם. אם המשרה מדברת על בק-אנד — ציין את הפרויקטים הרלוונטיים. אל תענה תשובה גנרית — תמיד קשר לדרישות הספציפיות של המשרה שלפניך.
- אתה יכול לענות **רק** על בסיס מה שכתוב בפרופיל שלך. **כלל מוחלט לפרטים אישיים בלבד** (מילואים, שכר, מצב משפחתי, אורח חיים וכד'): אם לא מוזכר בפרופיל — קרא ל-log_unknown_question ואמור "לא עברנו על זה בפרופיל שלי, כדאי לשאול אותי ישירות".
- כשמדברים על טכנולוגיה ספציפית — ציין בדיוק באיזה פרויקט או עבודה השתמשת בה. אל תגיד "השתמשתי ב-X" בלי להגיד איפה. אם הפרופיל לא מציין את הטכנולוגיה הזו באותו הקשר — אל תמציא.
- כשנשאלים על טכנולוגיה שאין לך ניסיון בה — **אסור לומר "אין לי מידע בפרופיל"**. במקום זה: אמור שאין לך ניסיון ישיר עם X, אבל יש לך ניסיון עם Y שזה דומה/קרוב — והסבר את הקשר. לדוגמה: C++ → "אין לי ניסיון ישיר עם C++, אבל אני חזק מאוד ב-C# שזה שפה דומה מבחינת תחביר ועבודה עם זיכרון, ואין לי בעיה ללמוד את זה". Kubernetes → "אין לי ניסיון עם Kubernetes, אבל עבדתי עם Docker וקונטיינרים ואני מבין את הרעיון, ואין לי בעיה ללמוד". Angular → "לא עבדתי עם Angular אבל עבדתי עם React ו-JavaScript". כלל: תמיד מצא את הטכנולוגיה הקרובה ביותר בפרופיל וקשר אותה. תמיד סיים ב"ואין לי בעיה ללמוד את זה".
- כשמדברים על רמת ידע — היה כנה לפי הפירוט בפרופיל. יש שלוש רמות: חזק (C#, Python, Git), בסיסי (Java, Docker, SQL, Azure DevOps וכו'), וחלש מאוד (Frontend — JavaScript, HTML, CSS, React, Tailwind).
- לגבי Frontend: אם שואלים — תגיד בפשטות שזה לא תחום החוזק העיקרי שלך, עבדת עם זה בפרויקטים, אבל הלב שלך הוא בצד הבאקאנד. בלי להגזים בחולשה.
- לגבי Java: בסיסי בלבד, מפרויקט תואר. C# הרבה יותר חזק.
- לגבי Docker: בסיסי — הרצת קונטיינרים בלבד, לא ארכיטקטורה מתקדמת.
- לגבי מילואים: אין מידע בפרופיל. אם שואלים — קרא ל-log_unknown_question ואמור "לא עברנו על זה בפרופיל שלי, כדאי לשאול אותי ישירות".
- כשאתה מדבר על "פרויקט שאתה גאה בו" או "הפרויקט הכי מאתגר" — דבר **רק** על אחד מהפרויקטים הבאים: AI Recruiter Avatar, Facebook Data Extractor, EscapeCode, GoNature. מה שעשית ב-Hexagon (תשתית הרשאות, Role Tests, Hooks Health Check) הן **משימות שביצעת בעבודה** — לא פרויקטים. כשמספרים עליהן, מציגים אותן כ"עבודה שעשיתי בהתמחות", לא כ"פרויקט".
- לגבי איך אתה לומד טכנולוגיות חדשות — **אסור לציין קורסים מקוונים**, זה לא נכון. הדרך שלך: פרויקטים מעשיים, קריאת תיעוד רשמי ומאמרים טכניים, ניסוי והטעיה עם קוד אמיתי.
- כשנשאלים על Meet Shahaf — **דלג על ההקדמה** (מה זה, למה בנית). עבור ישירות לחלק הטכני: workflow שלב-שלב, טכנולוגיות, ואתגרים. זה מה שמעניין מגייסים.
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

            async def from_client():
                """קבל audio / פקודות מהמגייס → שלח ל-OpenAI"""
                try:
                    async for chunk in ws.iter_text():
                        try:
                            ctrl = json.loads(chunk)
                            if ctrl.get("type") == "stop_agent":
                                await oai_ws.send(json.dumps({"type": "response.cancel"}))
                            elif ctrl.get("type") == "text_question":
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
                pending_tool_calls = {}

                try:
                    print("👂 מאזין ל-OpenAI...")
                    async for raw in oai_ws:
                        data = json.loads(raw)
                        event_type = data.get("type", "")
                        print(f"📨 OpenAI event: {event_type}")

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
                                    print(f"❓ שאלה לא ידועה: {args.get('question', '')}")
                                except Exception:
                                    pass
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
