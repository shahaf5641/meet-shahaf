import { useState, useRef, useEffect, Suspense } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, useGLTF, useAnimations } from '@react-three/drei'
import './App.css'

// ---- Avatar ----
function Avatar({ state, callActive, analyserRef, mousePosRef }) {
  const group    = useRef()
  const { scene, animations } = useGLTF('/model.glb')
  const { actions, mixer }    = useAnimations(animations, group)

  const stateRef       = useRef(state)
  const currentAction  = useRef(null)
  const helloStarted   = useRef(false)   // Hello הופעל
  const helloFinished  = useRef(false)   // Hello הסתיים — רק אז מגיבים לstate
  useEffect(() => { stateRef.current = state }, [state])

  const playAnim = (name, fadeIn = 0.4, fadeOut = 0.4) => {
    const next = actions[name]
    if (!next || currentAction.current === next) return
    currentAction.current?.fadeOut(fadeOut)
    next.reset().fadeIn(fadeIn).play()
    currentAction.current = next
  }

  // Idle immediately on mount (לפני שיחה)
  useEffect(() => {
    if (!actions['Idle']) return
    playAnim('Idle', 0.3)
  }, [actions])

  // Hello פעם אחת כשהשיחה מתחילה → אחריו Idle (או Talking אם כבר מדבר)
  useEffect(() => {
    if (!callActive) return
    if (!actions['HelloWithMouth'] || !actions['Idle']) return
    if (helloStarted.current) return
    helloStarted.current = true

    actions['HelloWithMouth'].loop              = 2200  // THREE.LoopOnce
    actions['HelloWithMouth'].clampWhenFinished = true
    playAnim('HelloWithMouth', 0.3)

    const onFinished = (e) => {
      if (e.action === actions['HelloWithMouth']) {
        mixer.removeEventListener('finished', onFinished)
        helloFinished.current = true
        if (stateRef.current === 'talking') playAnim('TalkWithMouth', 0.3)
        else                               playAnim('Idle', 0.6)
      }
    }
    mixer.addEventListener('finished', onFinished)
  }, [callActive, actions, mixer])

  // החלפת אנימציה לפי state — רק אחרי שHello הסתיים
  useEffect(() => {
    if (!helloFinished.current) return
    if (state === 'talking') playAnim('TalkWithMouth', 0.3)
    else                     playAnim('Idle',      0.5)
  }, [state, actions])

  // Lock Hips direction to Idle orientation across all animations
  const idleHipsY = useRef(null)

  useFrame(() => {
    if (!group.current) return
    group.current.traverse(obj => {
      if (!obj.isBone) return
      if (obj.name.toLowerCase() === 'hips') {
        if (currentAction.current === actions['Idle']) {
          idleHipsY.current = obj.rotation.y
        } else if (idleHipsY.current !== null) {
          obj.rotation.y = idleHipsY.current
        }
      }
    })
  })

  // ---- Jaw animation based on audio amplitude ----
  const jawBoneRef = useRef(null)
  const jawRotRef  = useRef(0)

  useEffect(() => {
    scene.traverse(obj => {
      if (obj.isBone && obj.name === 'Head.003') jawBoneRef.current = obj
    })
  }, [scene])

  useFrame(() => {
    if (!jawBoneRef.current) return
    const isTalking = stateRef.current === 'talking'

    let target = 0
    if (isTalking && analyserRef?.current) {
      const data = new Uint8Array(analyserRef.current.frequencyBinCount)
      analyserRef.current.getByteFrequencyData(data)
      const avg = data.reduce((a, b) => a + b, 0) / data.length
      target = Math.min(avg / 55, 1) * 0.32   // max ~18° open
    }

    // smooth lerp
    jawRotRef.current += (target - jawRotRef.current) * 0.28
    jawBoneRef.current.rotation.x = jawRotRef.current
  }, -1)  // priority -1 → runs after animation mixer (priority 0)

  return (
    <group ref={group}>
      <primitive object={scene} scale={1.8} position={[0, -2.6, 0]} rotation={[0, 0.5, 0]} />
    </group>
  )
}

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:8000'

// ---- Static Q&A answers ----
const STATIC_ANSWERS = {
  'ספר לי על ניסיון העבודה שלך ב-Hexagon': {
    audio: '/answers/q1_hexagon.wav',
    transcript: "ב-Hexagon עשיתי internship כחלק מצוות הפיתוח, ועבדתי בצמוד ל-SDET של הצוות. עבדתי בסביבה אג'ילית עם .NET, C#, Azure DevOps ומערכות מבוססות אירועים, שם בניתי health-check tests, שיפרתי תשתיות בדיקות קיימות, והקמתי מאפס תשתית לבדיקות הרשאות end-to-end לפי תפקידי המערכת. הניסיון הזה חיזק לי את היכולת לעבוד בצורה מסודרת בסביבה תעשייתית, לכתוב קוד איכותי, ולהשתלב נכון בתוך צוות פיתוח.",
  },
  'ספר לי על EscapeCode — פרויקט הגמר שלך': {
    audio: '/answers/q2_escapecode.wav',
    transcript: 'EscapeCode הוא משחק פאזל תלת-ממדי שפיתחתי ב-Unity עם C# כפרויקט גמר. מדובר במשחק escape room לימודי, שבו השחקן מתקדם בין חדרים באמצעות פתרון חידות ואתגרי קוד שמלמדים יסודות בתכנות. בפרויקט שמתי דגש משמעותי על נגישות, עם שילוב של eye tracking, speech-to-text ועוזר AI שמסייע לשחקן במהלך המשחק.',
  },
  'ספר לי על Facebook Data Extractor': {
    audio: '/answers/q3_facebook.wav',
    transcript: 'פיתחתי מערכת לאיסוף אוטומטי של פוסטים מקבוצות פייסבוק. המערכת בנויה עם Python ו-Selenium לאוטומציה של הדפדפן, Flask לבקאנד ולממשק ה-web, Redis לניהול תור וריצה בזמן אמת, ו-PostgreSQL לשמירת היסטוריית ריצות. הכול רץ בתוך Docker Compose, והמערכת יכולה להיחשף דרך ngrok, כך שמשתמשים יכולים לגשת אליה מרחוק בלי להתקין כלום. בנוסף, יש מנגנון תור שבו רק ריצה אחת מתבצעת בכל רגע, ושאר הבקשות ממתינות בצורה מסודרת.',
  },
  'מה החוזקות הטכניות הכי גדולות שלך?': {
    audio: '/answers/q4_strengths.wav',
    transcript: "החוזקות המרכזיות שלי הן Python ו-C#, בעיקר בצד הבקאנד. יש לי ניסיון משמעותי בבדיקות, אוטומציה ועבודה עם מערכות מורכבות מה-internship ב-Hexagon, ואני נהנה להיכנס לעומק של בעיות טכניות, בין אם זה תשתיות בדיקות, אינטגרציה עם APIs, או פיתוח של מערכות server-side. בנוסף, תחום ה-AI integrations מאוד מעניין אותי, ואני גם נהנה לעבוד עליו בפועל בפרויקטים שלי.",
  },
  'איך אתה לומד טכנולוגיות חדשות?': {
    audio: '/answers/q5_learning.wav',
    transcript: 'אני בדרך כלל מתחיל מסרטוני יוטיוב כדי לקבל תמונה כללית על התחום, ואחר כך נעזר ב-AI לשאלות יותר ממוקדות ולהבנה של נקודות ספציפיות. אבל מבחינתי הלמידה האמיתית מתחילה כשאני בונה משהו בעצמי, כי שם באמת מבינים איך הדברים עובדים בפועל. ככה למדתי למשל את OpenAI Realtime API ואת WebSockets בפרויקט Meet Shahaf.',
  },
  'איפה אתה רואה את עצמך בעוד 3 שנים?': {
    audio: '/answers/q6_future.wav',
    transcript: 'בעוד שלוש שנים אני רואה את עצמי במקום שבו צברתי עומק מקצועי אמיתי, מכיר את המערכת לעומק, ולוקח אחריות על תחומים משמעותיים. חשוב לי להמשיך להתפתח כמהנדס תוכנה, להיות מישהו שאפשר לסמוך עליו, ולתרום בצורה משמעותית לצוות ולארגון.',
  },
  'מה אתה מחפש בסביבת עבודה?': {
    audio: '/answers/q7_environment.wav',
    transcript: 'אני מחפש סביבה שמאפשרת למידה והתפתחות מקצועית לאורך זמן, עם אנשים חזקים שאפשר ללמוד מהם ואתגרים טכניים אמיתיים. חשוב לי לעבוד במקום שיש בו ownership, שבו אפשר לקחת אחריות אמיתית ולא רק לבצע משימות. מעבר לזה, מאוד חשוב לי לעבוד על מוצר או מערכת שיש להם ערך והשפעה אמיתית.',
  },
}

const GOLD_ANSWER = {
  text: 'ספר לי איך בנית את Meet Shahaf',
  audio: '/answers/q_gold.wav',
  transcript: 'Meet Shahaf נולד מתוך רעיון לאפשר למגייסים ליצור איתי אינטראקציה גם בלי להיות תלויים בשעה מסוימת. בניתי frontend ב-React עם Three.js, שמציג אווטר תלת-ממדי ומייצר חוויית שיחה אינטראקטיבית. בצד השרת בניתי backend ב-FastAPI שעובד כ-WebSocket proxy מול OpenAI Realtime API. החלק הכי מעניין מבחינתי היה לבנות את ה-audio pipeline בזמן אמת, כך שהדפדפן שולח אודיו בזרם רציף ומקבל תשובה קולית חזרה, כדי לייצר שיחה טבעית, רציפה, וב-latency נמוך.',
}

// ---- App ----
export default function App() {
  const [callState, setCallState] = useState('idle')
  const [avatarState, setAvatarState] = useState('idle')
  const [amplitude, setAmplitude] = useState(0)
  const [transcript, setTranscript] = useState('')
  const chunkQueue = useRef([])
  const processingChunks = useRef(false)
  const [duration, setDuration] = useState(0)
  const [accessGranted, setAccessGranted] = useState(false)
  const [accessCode, setAccessCode] = useState('')
  const [accessError, setAccessError] = useState(false)
  const [suggestedQuestions, setSuggestedQuestions] = useState([])
  const [questionPending, setQuestionPending] = useState(false)
  const [highlightUsed, setHighlightUsed] = useState(false)
  const [copiedItem, setCopiedItem] = useState(null)

  function copyToClipboard(text, key) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedItem(key)
      setTimeout(() => setCopiedItem(null), 2000)
    })
  }
  const questionPendingRef = useRef(false)   // mirror של questionPending לשימוש בתוך closures
  const questionPoolRef = useRef([])

  const ws = useRef(null)
  const workletNode = useRef(null)
  const audioCtx = useRef(null)
  const outAnalyser = useRef(null)
  const animFrame = useRef(null)
  const timerRef = useRef(null)
  const transcriptRef = useRef('')
  const transcriptBoxRef = useRef(null)
  const nextPlayTime = useRef(0)
  const activeSourceNodes = useRef([])
  const isAgentTalking = useRef(false)
  const blockAgentOutput = useRef(false)
  const safetyTimerRef = useRef(null)   // טיימר בטיחות נפרד לשחרור questionPending
  const agentDoneTimer = useRef(null)
  const introAudioRef = useRef(null)
  const introResolveRef = useRef(null)
  const mousePosRef = useRef({ x: 0, y: 0 })

  const WS_URL = process.env.REACT_APP_WS_URL || 'ws://localhost:8000/ws'

  // עכבר מותאם — נקודה + טבעת עם lag
  const cursorDotRef = useRef(null)
  const cursorRingRef = useRef(null)
  const cursorPos = useRef({ x: -100, y: -100 })
  const ringPos = useRef({ x: -100, y: -100 })
  const isHovering = useRef(false)

  useEffect(() => {
    const onMove = (e) => {
      cursorPos.current = { x: e.clientX, y: e.clientY }
      mousePosRef.current = {
        x: (e.clientX / window.innerWidth) * 2 - 1,
        y: (e.clientY / window.innerHeight) * 2 - 1,
      }
      if (cursorDotRef.current) {
        cursorDotRef.current.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`
      }
    }

    const onMouseOver = (e) => {
      const el = e.target
      const clickable = el.closest('button, a, label, [role="button"], textarea, input')
      isHovering.current = !!clickable
      if (cursorRingRef.current) {
        cursorRingRef.current.classList.toggle('cursor-hover', !!clickable)
      }
    }

    let rafId
    const animateRing = () => {
      ringPos.current.x += (cursorPos.current.x - ringPos.current.x) * 0.12
      ringPos.current.y += (cursorPos.current.y - ringPos.current.y) * 0.12
      if (cursorRingRef.current) {
        cursorRingRef.current.style.transform = `translate(${ringPos.current.x}px, ${ringPos.current.y}px)`
      }
      rafId = requestAnimationFrame(animateRing)
    }
    rafId = requestAnimationFrame(animateRing)

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseover', onMouseOver)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseover', onMouseOver)
      cancelAnimationFrame(rafId)
    }
  }, [])

  const MAX_DURATION = 300 // 5 דקות

  // ---- מאגר שאלות סטטי ----
  function buildQuestionPool() {
    return Object.keys(STATIC_ANSWERS)
  }

  // טיימר שיחה + הגבלת זמן
  useEffect(() => {
    if (callState === 'active') {
      timerRef.current = setInterval(() => {
        setDuration(d => {
          if (d + 1 >= MAX_DURATION) {
            endCall()
            return d + 1
          }
          return d + 1
        })
      }, 1000)
    } else {
      clearInterval(timerRef.current)
      if (callState === 'idle') setDuration(0)
    }
    return () => clearInterval(timerRef.current)
  }, [callState])

  function formatTime(s) {
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
  }


  async function startCall() {
    setCallState('connecting')
    setTranscript('')
    transcriptRef.current = ''
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 24000, channelCount: 1, echoCancellation: true }
      })

      // נגן את הבריף המוקלט מראש לפני פתיחת ה-WebSocket
      await new Promise((resolve) => {
        introResolveRef.current = resolve
        const introAudio = new Audio('/intro.wav')
        introAudioRef.current = introAudio
        setAvatarState('talking')
        setCallState('active')
        setTranscript('היי, נעים מאוד, אני שחף ישראל, בן עשרים ושמונה מקריית אתא, בוגר הנדסת תוכנה ממכללת אורט בראודה. במהלך הלימודים עשיתי התמחות בחברת Hexagon, שם עבדתי בצוות פיתוח ועבדתי בעיקר על תשתיות בדיקות ואוטומציה. בין הדברים שעשיתי שם: יצרתי בדיקות health-check למערכת מבוססת אירועים, שיפרתי את תשתית יצירת האובייקטים בטסטים, ובניתי מאפס תשתית לבדיקות הרשאות מקצה לקצה לפי תפקידי המערכת. מעבר לזה, פיתחתי כמה פרויקטים עצמאיים — ביניהם EscapeCode, משחק פאזל תלת-ממדי ללימוד קוד עם דגש על נגישות, ופרויקט אוטומציה לאיסוף נתונים מקבוצות פייסבוק עם ממשק web מלא. היום אני מחפש את התפקיד הבא שלי — מקום שבו אוכל לצמוח, להתפתח, ולהביא ערך אמיתי.')
        introAudio.play().catch(() => {})
        introAudio.onended = resolve
        introAudio.onerror = resolve
      })
      setAvatarState('idle')
      setTranscript('')

      audioCtx.current = new AudioContext({ sampleRate: 24000 })

      outAnalyser.current = audioCtx.current.createAnalyser()
      outAnalyser.current.fftSize = 256
      outAnalyser.current.connect(audioCtx.current.destination)

      ws.current = new WebSocket(WS_URL)
      ws.current.binaryType = 'arraybuffer'

      ws.current.onopen = async () => {
        // שלח job description כהודעה ראשונה לפני האודיו
        ws.current.send(JSON.stringify({
          type: 'job_description',
          text: ''
        }))
        setCallState('active')
        const pool = buildQuestionPool()
        questionPoolRef.current = pool.slice(4) // שמור שאר השאלות
        setSuggestedQuestions(pool.slice(0, 4))  // הצג 4 ראשונות (+ שאלת זהב = 5 סה"כ)
        await startRecording(stream)
        trackAmplitude()
      }

      ws.current.onmessage = async (event) => {
        const msg = JSON.parse(event.data)
        if (msg.type === 'audio' && msg.data) {
          if (!blockAgentOutput.current) playAudioChunk(msg.data)
        } else if (msg.type === 'transcript' && msg.text) {
          if (!blockAgentOutput.current) enqueueChunk(msg.text)
        } else if (msg.type === 'avatar_talking') {
          // תגובה חדשה — בטל כל הטיימרים, שחרר נעילה
          if (agentDoneTimer.current) clearTimeout(agentDoneTimer.current)
          if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current)
          blockAgentOutput.current = false
          questionPendingRef.current = false
          setQuestionPending(false)
          setAvatarState('talking')
          isAgentTalking.current = true
          const now = audioCtx.current?.currentTime || 0
          if (nextPlayTime.current <= now) nextPlayTime.current = 0
        } else if (msg.type === 'avatar_idle') {
          // התעלם אם ממתינים לתגובה חדשה — זה avatar_idle מתגובה מבוטלת
          if (questionPendingRef.current) return
          const waitMs = Math.max(0, (nextPlayTime.current - (audioCtx.current?.currentTime || 0)) * 1000) + 200
          if (agentDoneTimer.current) clearTimeout(agentDoneTimer.current)
          agentDoneTimer.current = setTimeout(() => {
            setAvatarState('idle')
            isAgentTalking.current = false
          }, waitMs)
        } else if (msg.type === 'user_speaking') {
          if (agentDoneTimer.current) clearTimeout(agentDoneTimer.current)
          if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current)
          chunkQueue.current = []
          processingChunks.current = false
          questionPendingRef.current = false
          setQuestionPending(false)
          setAvatarState('thinking')
          isAgentTalking.current = false
          transcriptRef.current = ''
          setTranscript('')
        }
      }

      ws.current.onerror = () => {
        setCallState('idle')
        alert('לא ניתן להתחבר לשרת. ודא שה-backend רץ.')
      }

      ws.current.onclose = () => setCallState('ended')

    } catch (err) {
      console.error(err)
      setCallState('idle')
      alert('לא ניתן לגשת למיקרופון: ' + err.message)
    }
  }

  async function startRecording(stream) {
    await audioCtx.current.audioWorklet.addModule('/pcm-processor.js')
    const src = audioCtx.current.createMediaStreamSource(stream)
    workletNode.current = new AudioWorkletNode(audioCtx.current, 'pcm-processor')
    workletNode.current.port.onmessage = (e) => {
      if (ws.current?.readyState !== WebSocket.OPEN) return
      if (isAgentTalking.current) return
      const bytes = new Uint8Array(e.data)
      let binary = ''
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
      ws.current.send(btoa(binary))
    }
    src.connect(workletNode.current)
  }

  function trackAmplitude() {
    const data = new Uint8Array(outAnalyser.current.frequencyBinCount)
    function loop() {
      outAnalyser.current.getByteFrequencyData(data)
      const avg = data.reduce((a, b) => a + b, 0) / data.length
      setAmplitude(avg / 128)
      animFrame.current = requestAnimationFrame(loop)
    }
    loop()
  }

  function playAudioChunk(b64Data) {
    try {
      if (audioCtx.current.state === 'suspended') audioCtx.current.resume()
      const binary = atob(b64Data)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      const pcm = new Int16Array(bytes.buffer)
      const float = new Float32Array(pcm.length)
      for (let i = 0; i < pcm.length; i++) float[i] = pcm[i] / 32768
      const buf = audioCtx.current.createBuffer(1, float.length, 24000)
      buf.copyToChannel(float, 0)
      const src = audioCtx.current.createBufferSource()
      src.buffer = buf
      src.connect(outAnalyser.current)
      const now = audioCtx.current.currentTime
      if (nextPlayTime.current < now + 0.01) nextPlayTime.current = now + 0.01
      src.start(nextPlayTime.current)
      nextPlayTime.current += buf.duration
      activeSourceNodes.current.push(src)
      src.onended = () => {
        activeSourceNodes.current = activeSourceNodes.current.filter(n => n !== src)
      }
    } catch (e) {
      console.warn('audio chunk error:', e)
    }
  }

  function sendTextQuestion(text) {
    if (ws.current?.readyState !== WebSocket.OPEN) return
    if (questionPendingRef.current) return  // מניעת double-click — ref תמיד עדכני

    // עצור אודיו מקומי מיידית
    activeSourceNodes.current.forEach(src => { try { src.stop() } catch {} })
    activeSourceNodes.current = []
    nextPlayTime.current = audioCtx.current?.currentTime || 0
    blockAgentOutput.current = true
    isAgentTalking.current = false
    if (agentDoneTimer.current) clearTimeout(agentDoneTimer.current)

    // נקה תמליל ותור
    chunkQueue.current = []
    processingChunks.current = false
    transcriptRef.current = ''
    setTranscript('')

    // נעל כפתורות עד שהסוכן יתחיל לענות
    questionPendingRef.current = true
    setQuestionPending(true)
    setAvatarState('idle')

    // שלח את השאלה — הבאקנד מבטל תגובה קיימת ב-OpenAI לפני שיוצר חדשה
    ws.current.send(JSON.stringify({ type: 'text_question', text }))

    // timeout בטיחות נפרד — אם avatar_talking לא הגיע תוך 6 שניות, שחרר נעילה
    if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current)
    safetyTimerRef.current = setTimeout(() => {
      questionPendingRef.current = false
      setQuestionPending(false)
      blockAgentOutput.current = false
    }, 6000)

    // עדכן רשימת שאלות
    setSuggestedQuestions(prev => {
      const rest = prev.filter(q => q !== text)
      const next = questionPoolRef.current.shift()
      return next ? [...rest, next] : rest
    })
  }

  async function playStaticAnswer(questionText) {
    if (questionPendingRef.current) return
    const answer = STATIC_ANSWERS[questionText]
      ?? (questionText === GOLD_ANSWER.text ? GOLD_ANSWER : null)
    if (!answer) return

    // עצור audio קיים
    activeSourceNodes.current.forEach(src => { try { src.stop() } catch {} })
    activeSourceNodes.current = []
    nextPlayTime.current = audioCtx.current?.currentTime || 0
    blockAgentOutput.current = true
    isAgentTalking.current = false
    if (agentDoneTimer.current) clearTimeout(agentDoneTimer.current)
    chunkQueue.current = []
    processingChunks.current = false

    // נעל כפתורות ועדכן UI
    questionPendingRef.current = true
    setQuestionPending(true)
    setAvatarState('talking')
    // חסום שליחת מיקרופון — מונע echo שנשלח ל-OpenAI ומקבל תגובה
    isAgentTalking.current = true
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: 'stop_agent' }))
    }
    transcriptRef.current = answer.transcript
    setTranscript(answer.transcript)

    // עדכן רשימת שאלות
    setSuggestedQuestions(prev => {
      const rest = prev.filter(q => q !== questionText)
      const next = questionPoolRef.current.shift()
      return next ? [...rest, next] : rest
    })

    // טען ונגן דרך AudioContext → outAnalyser (לאנימציית amplitude)
    try {
      if (audioCtx.current.state === 'suspended') await audioCtx.current.resume()
      const resp = await fetch(answer.audio)
      const arrayBuffer = await resp.arrayBuffer()
      const audioBuffer = await audioCtx.current.decodeAudioData(arrayBuffer)

      const src = audioCtx.current.createBufferSource()
      src.buffer = audioBuffer
      src.connect(outAnalyser.current)
      activeSourceNodes.current.push(src)

      const now = audioCtx.current.currentTime
      nextPlayTime.current = now + 0.01
      src.start(nextPlayTime.current)
      nextPlayTime.current += audioBuffer.duration

      src.onended = () => {
        activeSourceNodes.current = activeSourceNodes.current.filter(n => n !== src)
        if (questionPendingRef.current) {
          questionPendingRef.current = false
          setQuestionPending(false)
          blockAgentOutput.current = false
          isAgentTalking.current = false
          setAvatarState('idle')
        }
      }
    } catch (e) {
      console.warn('static answer error:', e)
      questionPendingRef.current = false
      setQuestionPending(false)
      blockAgentOutput.current = false
      isAgentTalking.current = false
      setAvatarState('idle')
    }
  }

  // ---- תור טקסט סידורי — מונע בלגן בסדר הצגת chunks ----
  function enqueueChunk(chunk) {
    chunkQueue.current.push(chunk)
    if (!processingChunks.current) {
      processingChunks.current = true
      // עיכוב ראשוני = כמה האודיו מקודם לכאן
      const delay = Math.max(0,
        ((nextPlayTime.current || 0) - (audioCtx.current?.currentTime || 0)) * 1000
      )
      setTimeout(processNextChunk, delay)
    }
  }

  function processNextChunk() {
    if (!processingChunks.current) return // נוקה מבחוץ (סיום שיחה / user_speaking)
    if (chunkQueue.current.length === 0) {
      processingChunks.current = false
      return
    }
    const chunk = chunkQueue.current.shift()
    transcriptRef.current += chunk
    setTranscript(transcriptRef.current)
    if (transcriptBoxRef.current) {
      transcriptBoxRef.current.scrollTop = transcriptBoxRef.current.scrollHeight
    }
    setTimeout(processNextChunk, 40)
  }

  function interruptAgent() {
    if (introAudioRef.current) {
      introAudioRef.current.pause()
      introAudioRef.current = null
      setTranscript('')
      setAvatarState('idle')
      if (introResolveRef.current) {
        introResolveRef.current()
        introResolveRef.current = null
      }
      return
    }
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: 'stop_agent' }))
    }
    // חסום כל audio/transcript שיגיע מהרשת אחרי הלחיצה
    blockAgentOutput.current = true
    questionPendingRef.current = false
    setQuestionPending(false)
    isAgentTalking.current = false
    // עצור כל AudioBufferSourceNode שכבר מנגן או מתוזמן
    activeSourceNodes.current.forEach(src => { try { src.stop() } catch {} })
    activeSourceNodes.current = []
    nextPlayTime.current = audioCtx.current?.currentTime || 0
    // עצור טקסט ותור chunks
    chunkQueue.current = []
    processingChunks.current = false
    transcriptRef.current = ''
    setTranscript('')
    if (agentDoneTimer.current) clearTimeout(agentDoneTimer.current)
    isAgentTalking.current = false
    setAvatarState('idle')
  }

  function endCall() {
    if (introAudioRef.current) {
      introAudioRef.current.pause()
      introAudioRef.current = null
    }
    workletNode.current?.disconnect()
    cancelAnimationFrame(animFrame.current)
    ws.current?.close()
    audioCtx.current?.close()
    nextPlayTime.current = 0
    chunkQueue.current = []
    processingChunks.current = false
    if (agentDoneTimer.current) clearTimeout(agentDoneTimer.current)
    transcriptRef.current = ''
    setTranscript('')
    setCallState('ended')
    setAvatarState('idle')
  }

  function resetCall() {
    setCallState('idle')
    setTranscript('')
    setDuration(0)
  }

  const CursorElements = (
    <>
      <div className="cursor-dot" ref={cursorDotRef} />
      <div className="cursor-ring" ref={cursorRingRef} />
    </>
  )


  if (!accessGranted) {
    return (
      <div className="access-screen">
        {CursorElements}
        <div className="access-card">
          <h2 className="access-title">Meet Shahaf</h2>
          <p className="access-subtitle">Enter your access code to continue</p>
          <input
            className="access-input"
            type="password"
            placeholder="Access code"
            value={accessCode}
            onChange={e => { setAccessCode(e.target.value); setAccessError(false) }}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                if (accessCode === process.env.REACT_APP_ACCESS_CODE) setAccessGranted(true)
                else setAccessError(true)
              }
            }}
            autoFocus
          />
          {accessError && <p className="access-error">Incorrect code. Please try again.</p>}
          <button
            className="access-btn"
            onClick={() => {
              if (accessCode === process.env.REACT_APP_ACCESS_CODE) setAccessGranted(true)
              else setAccessError(true)
            }}
          >
            Enter →
          </button>
        </div>
      </div>
    )
  }


  return (
    <div className="app">

      {/* ---- Sidebar שמאל ---- */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <button className="btn-back" onClick={() => {
            if (callState === 'active') endCall()
            setAccessGranted(false)
          }}>
            חזור
          </button>
          <div className={`status-pill ${callState === 'active' ? 'active' : ''}`}>
            <span className="status-dot" />
            {callState === 'active' ? 'בשיחה' : 'זמין לשיחה'}
          </div>
        </div>

        <div className="profile-section">
          <p className="greeting">שלום, אני</p>
          <h1 className="profile-name">שחף ישראל</h1>
          <p className="profile-role">מפתח תוכנה</p>
        </div>

        {callState === 'idle' && (
          <div className="welcome-section">
            <p className="welcome-text">
              זה הוא סוכן ה-AI שלי — הוא מייצג אותי ויענה על כל שאלה שתרצה לשאול.
              דבר איתו כאילו אתה מדבר איתי.
            </p>
          </div>
        )}

        {transcript && (
          <div className="transcript" ref={transcriptBoxRef}>
            <div className="transcript-label">שחף אומר</div>
            <p>{transcript}</p>
          </div>
        )}

        <div className="controls">
          {callState === 'idle' && (
            <>
              <button className="btn-start" onClick={startCall}>התחל שיחה</button>
            </>
          )}

          {callState === 'connecting' && (
            <p className="connecting">מתחבר...</p>
          )}

          {callState === 'active' && (
            <div className="active-controls">
              <div className={`timer ${MAX_DURATION - duration <= 60 ? 'timer-warning' : ''}`}>
                {formatTime(duration)}
                {MAX_DURATION - duration <= 60 && (
                  <span className="timer-limit"> — נותרו {MAX_DURATION - duration}s</span>
                )}
              </div>
              <div className="mic-indicator">
                <div className="mic-dot" style={{ transform: `scale(${1 + amplitude * 0.5})` }} />
                <span>{avatarState === 'talking' ? 'שחף מדבר...' : avatarState === 'thinking' ? 'מקשיב לך...' : 'ממתין...'}</span>
              </div>
              {avatarState === 'talking' && (
                <button className="btn-interrupt" onClick={interruptAgent}>עצור</button>
              )}
              <button className="btn-end" onClick={endCall}>סיים שיחה</button>
            </div>
          )}

          {callState === 'ended' && (
            <div className="ended">
              <p>השיחה הסתיימה ({formatTime(duration)})</p>
              <button className="btn-start" onClick={resetCall}>שיחה חדשה</button>
            </div>
          )}
        </div>

      </aside>

      {/* ---- Canvas ימין ---- */}
      <div className="canvas-wrap">
        <Canvas camera={{ position: [0, 0.55, 3.2], fov: 42 }} gl={{ antialias: true }}>
          <ambientLight intensity={0.7} />
          <directionalLight position={[3, 5, 4]} intensity={1.0} />
          <directionalLight position={[-2, 2, -2]} intensity={0.3} color="#8899ff" />
          <Suspense fallback={null}>
            <Avatar state={avatarState} callActive={callState === 'active'} analyserRef={outAnalyser} mousePosRef={mousePosRef} />
          </Suspense>
          <OrbitControls
            enableZoom={false}
            enablePan={false}
            enableRotate={false}
            target={[0, 0.1, 0]}
          />
        </Canvas>

        <div className={`state-badge ${avatarState}`}>
          {avatarState === 'talking' ? '● מדבר' :
           avatarState === 'thinking' ? '● מקשיב לך' : '○ ממתין'}
        </div>

        {callState === 'active' && suggestedQuestions.length > 0 && (
          <div className="suggested-questions">
            {(() => {
              const mid = Math.floor(suggestedQuestions.length / 2)
              const items = []
              suggestedQuestions.forEach((q, i) => {
                if (i === mid && !highlightUsed) {
                  items.push(
                    <button
                      key="highlight"
                      className={`suggested-q suggested-q-highlight${questionPending ? ' suggested-q-disabled' : ''}`}
                      disabled={questionPending}
                      onClick={() => { setHighlightUsed(true); playStaticAnswer(GOLD_ANSWER.text) }}
                    >
                      ✦ ספר לי איך בנית את Meet Shahaf
                    </button>
                  )
                }
                items.push(
                  <button
                    key={i}
                    className={`suggested-q${questionPending ? ' suggested-q-disabled' : ''}`}
                    disabled={questionPending}
                    onClick={() => playStaticAnswer(q)}
                  >
                    {q}
                  </button>
                )
              })
              return items
            })()}
          </div>
        )}

        <div className="canvas-bottom-fade" />
        <div className="bg-glow-center" />
        <div className="bg-light-left" />
        <div className="bg-light-right" />
      </div>

      <footer className="contact-footer">
        <button className="footer-item footer-copy" onClick={() => copyToClipboard('shahaf564@gmail.com', 'email')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
          {copiedItem === 'email' ? '✓ הועתק' : 'shahaf564@gmail.com'}
        </button>

        <span className="footer-sep" />

        <button className="footer-item footer-copy" onClick={() => copyToClipboard('0545699472', 'phone')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.18 6.18l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
          {copiedItem === 'phone' ? '✓ הועתק' : '054-5699-472'}
        </button>

        <span className="footer-sep" />

        <a href="https://github.com/shahaf5641" target="_blank" rel="noreferrer" className="footer-item">
          <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>
          גיטהאב
        </a>

        <a href="https://www.linkedin.com/in/shahaf-israel-0a6502173/" target="_blank" rel="noreferrer" className="footer-item">
          <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
          לינקדין
        </a>

        <a href="https://shahafs-website.vercel.app/" target="_blank" rel="noreferrer" className="footer-item">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
          פורטפוליו
        </a>

        <span className="footer-sep" />

        <a href="/shahaf_cv.pdf" download="Shahaf_Israel_CV.pdf" className="footer-cv-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          הורד קורות חיים
        </a>
      </footer>

      {CursorElements}
    </div>
  )
}
