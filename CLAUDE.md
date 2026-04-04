# AI Recruiter Avatar — CLAUDE.md

## מה הפרויקט הזה
סוכן AI קולי בדמות שחף (המפתח האמיתי).
מגייס נכנס לקישור → רואה אווטר תלת-מימד → מדבר איתו בשיחה קולית → הסוכן עונה כאילו הוא שחף.

**המטרה:** מגייסים יכולים לראיין את הסוכן במקום שחף האמיתי, 24/7, בלי תיאום.

---

## ארכיטקטורה

```
מגייס (דפדפן)
    ↓ מיקרופון → audio chunks (base64 PCM16)
React Frontend (localhost:3000)
    ↓ WebSocket
FastAPI Backend (localhost:8000)
    ↓ WebSocket
OpenAI Realtime API (gpt-4o-realtime-preview-2025-06-03)
    ↓ audio chunks חזרה
FastAPI Backend
    ↓ WebSocket
React Frontend
    ↓ AudioContext → רמקול
מגייס שומע את שחף
```

**אין STT. אין TTS. הכל audio streaming בזמן אמת.**
OpenAI Realtime API מקבל audio ומחזיר audio — pipeline אחד רציף.

---

## סטאק טכנולוגי

| שכבה | טכנולוגיה |
|------|-----------|
| Frontend | React 18, @react-three/fiber, @react-three/drei, Three.js |
| Avatar | GLB מ-Avaturn (model.glb ב-public/) |
| Backend | Python FastAPI, WebSockets, uvicorn |
| AI | OpenAI Realtime API — gpt-4o-realtime-preview-2025-06-03 |
| Audio | WebAudio API (AnalyserNode לamplitude), MediaRecorder |

---

## מבנה קבצים

```
ai-recruiter/
├── CLAUDE.md                  ← אתה כאן
├── backend/
│   ├── main.py                ← FastAPI + WebSocket + OpenAI Realtime
│   ├── requirements.txt
│   └── .env                   ← OPENAI_API_KEY (לא ב-git!)
└── frontend/
    ├── package.json
    ├── public/
    │   ├── index.html
    │   ├── model.glb          ← אווטר שחף מ-Avaturn (4.1MB)
    │   └── shahaf_cv.pdf      ← יתווסף בקרוב
    └── src/
        ├── index.js
        ├── App.jsx            ← Main component + WebSocket + Audio
        └── App.css            ← עיצוב כהה
```

---

## הרצה מקומית (Windows)

### Backend
```cmd
cd D:\ai-recruiter\backend
venv\Scripts\activate
uvicorn main:app --reload --port 8000
```

### Frontend
```cmd
cd D:\ai-recruiter\frontend
npm start
```

---

## מה עובד עכשיו ✅
- [x] FastAPI backend עם WebSocket endpoint
- [x] חיבור ל-OpenAI Realtime API
- [x] React frontend עם Canvas תלת-מימד
- [x] אווטר GLB של שחף נטען ומוצג
- [x] כפתור "התחל שיחה" + זמן שיחה
- [x] אנימציית ראש בסיסית לפי amplitude

## מה צריך לתקן / לשפר 🔧

### עדיפות גבוהה
- [ ] **מצלמה** — מוצגים הגוף/רגליים במקום הפנים. צריך לכוון למעלה (y~1.5, position avatar y~-2.4)
- [ ] **Audio pipeline** — לבדוק שהמיקרופון → OpenAI → רמקול עובד end-to-end
- [ ] **PCM16 encoding** — MediaRecorder שולח webm, צריך להמיר ל-PCM16 לפני שליחה ל-OpenAI
- [ ] **Audio playback** — לוודא שה-hex→PCM→AudioBuffer עובד בלי glitches

### עדיפות בינונית
- [ ] **System Prompt** — לטעון מקו"ח אמיתי של שחף (PDF/טקסט)
- [ ] **UI** — להציג רק פנים + חצי גוף עליון, רקע נקי
- [ ] **Amplitude animation** — לחבר AnalyserNode לאודיו היוצא (לא הנכנס) כדי שהאווטר יזוז כשהוא מדבר
- [ ] **Loading state** — spinner בזמן טעינת GLB
- [ ] **Error handling** — הודעה ברורה אם מיקרופון נדחה

### עדיפות נמוכה
- [ ] **Job context** — קישור דינמי עם job_id שמשנה את ה-system prompt
- [ ] **Rate limiting** — מקסימום 10 דקות לשיחה
- [ ] **Deploy** — Railway (backend) + Vercel (frontend)

---

## הבעיה הטכנית הכי קריטית
MediaRecorder ב-browser מייצר **webm/opus**, אבל OpenAI Realtime API מצפה ל-**PCM16 24kHz mono**.
צריך להמיר בצד ה-frontend לפני שליחה:
```js
// AudioContext → ScriptProcessor → Float32 → Int16 → base64
```
או להשתמש ב-AudioWorklet לביצועים טובים יותר.

---

## מידע על שחף (למלא!)
```
שם: שחף
תפקיד מבוקש: Full Stack Developer / AI Developer
כישורים: Python, React, FastAPI, ...
ניסיון: X שנים
פרויקטים: ...
אתר פורטפוליו: ...
```
**חשוב: הסוכן לא ממציא כלום. רק מידע שמופיע כאן.**

---

## System Prompt (backend/main.py)
עדכן את SYSTEM_PROMPT עם המידע האמיתי של שחף.
הסוכן צריך:
1. לדבר בעברית, בטון ידידותי ומקצועי
2. לענות קצר (2-3 משפטים)
3. לא להמציא מידע שלא נמסר לו
4. לשאול שאלה חזרה בסוף כל תשובה
5. להתמקד בכישורים הרלוונטיים לתפקיד הספציפי

---

## משתני סביבה
```env
OPENAI_API_KEY=sk-...  # ב-backend/.env בלבד, לא ב-git
```
