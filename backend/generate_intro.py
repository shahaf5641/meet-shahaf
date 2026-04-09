"""
הרץ פעם אחת כדי לייצר את קובץ intro.mp3:
  cd backend
  venv\Scripts\activate
  python generate_intro.py
"""
import os
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

INTRO_TEXT = (
    "היי, נעים מאוד, אני שחף ישראל, בן 28 מקרית אתא, בוגר B.Sc. בהנדסת תוכנה ממכללת אורט בראודה. "
    "במהלך השנה האחרונה ללימודים שלי עשיתי internship בחברת Hexagon ALI, שם השתלבתי בסביבת פיתוח אג'ילית "
    "ועבדתי בעיקר על תשתיות בדיקות ואוטומציה. במסגרת התפקיד יצרתי בדיקות health-check למערכת מבוססת אירועים, "
    "שיפרתי תשתית ליצירת אובייקטים בטסטים כדי להפוך את העבודה ליותר מסודרת ויעילה, "
    "וגם בניתי תשתית לבדיקות הרשאות מקצה לקצה לפי תפקידי מערכת שונים. "
    "מעבר לזה, עבדתי על כמה פרויקטים משמעותיים, ביניהם EscapeCode, משחק פאזלים תלת-ממדי ללימוד קוד עם דגש על נגישות, "
    "ופרויקט אוטומציה לאיסוף מידע מקבוצות פייסבוק שכולל ממשק web, ניהול תהליכים וייצוא נתונים. "
    "היום אני מחפש את מקום העבודה הבא שלי, מקום שבו אני אוכל להמשיך לצמוח, להתפתח מקצועית, "
    "ולהביא ערך אמיתי דרך תוכנה."
)

output_path = os.path.join(os.path.dirname(__file__), "../frontend/public/intro.mp3")

print("מייצר intro.mp3...")
response = client.audio.speech.create(
    model="tts-1",
    voice="echo",
    input=INTRO_TEXT,
)
response.stream_to_file(output_path)
print(f"✅ נשמר ב: {output_path}")
