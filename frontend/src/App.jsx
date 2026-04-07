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
    if (!actions['Hello'] || !actions['Idle']) return
    if (helloStarted.current) return
    helloStarted.current = true

    actions['Hello'].loop              = 2200  // THREE.LoopOnce
    actions['Hello'].clampWhenFinished = true
    playAnim('Hello', 0.3)

    const onFinished = (e) => {
      if (e.action === actions['Hello']) {
        mixer.removeEventListener('finished', onFinished)
        helloFinished.current = true
        playAnim('Idle', 0.6)
      }
    }
    mixer.addEventListener('finished', onFinished)
  }, [callActive, actions, mixer])

  // החלפת אנימציה לפי state — רק אחרי שHello הסתיים
  useEffect(() => {
    if (!helloFinished.current) return
    if (state === 'talking') playAnim('Goodtalk', 0.3)
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

  return (
    <group ref={group}>
      <primitive object={scene} scale={1.8} position={[0, -2.6, 0]} rotation={[0, 0.5, 0]} />
    </group>
  )
}

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:8000'

// ---- App ----
export default function App() {
  const [callState, setCallState] = useState('idle')
  const [avatarState, setAvatarState] = useState('idle')
  const [amplitude, setAmplitude] = useState(0)
  const [transcript, setTranscript] = useState('')
  const chunkQueue = useRef([])
  const processingChunks = useRef(false)
  const [duration, setDuration] = useState(0)
  const [setupDone, setSetupDone] = useState(false)
  const [recruiterName, setRecruiterName] = useState('')
  const [recruiterCompany, setRecruiterCompany] = useState('')
  const [jobDesc, setJobDesc] = useState('')
  const [jobUrlText, setJobUrlText] = useState('')   // טקסט שחולץ מה-URL
  const [jobUrl, setJobUrl] = useState('')
  const [urlLoading, setUrlLoading] = useState(false)
  const [urlError, setUrlError] = useState('')
  const [suggestedQuestions, setSuggestedQuestions] = useState([])
  const [questionPending, setQuestionPending] = useState(false)
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

  const MAX_DURATION = 600 // 10 דקות

  // ---- בניית מאגר שאלות דינמי לפי דרישות המשרה ----
  function buildQuestionPool(desc) {
    const d = desc.toLowerCase()
    const questions = []

    // כל הטכנולוגיות האפשריות — סריקה ישירה על תיאור המשרה
    const techMap = [
      { kw: ['python'],                       q: 'מה הניסיון שלך עם Python ואיפה השתמשת בו?' },
      { kw: ['c#', 'csharp', '.net', 'dotnet'], q: 'ספר לי על הניסיון שלך עם C# ו-.NET' },
      { kw: ['java'],                         q: 'מה הניסיון שלך עם Java?' },
      { kw: ['javascript', 'typescript', 'ts', 'js'], q: 'מה הרמה שלך ב-JavaScript/TypeScript?' },
      { kw: ['react'],                        q: 'ספר לי על הניסיון שלך עם React' },
      { kw: ['angular'],                      q: 'עבדת עם Angular? מה הרמה שלך?' },
      { kw: ['vue'],                          q: 'עבדת עם Vue.js?' },
      { kw: ['node', 'nodejs'],               q: 'עבדת עם Node.js? באיזה הקשר?' },
      { kw: ['fastapi', 'flask', 'django'],   q: 'ספר לי על הניסיון שלך עם Python web frameworks' },
      { kw: ['sql', 'postgres', 'mysql', 'mssql', 'database', 'db'], q: 'מה הניסיון שלך עם SQL ובסיסי נתונים?' },
      { kw: ['mongodb', 'nosql', 'redis'],    q: 'עבדת עם NoSQL databases? באיזה הקשר?' },
      { kw: ['docker'],                       q: 'מה הניסיון שלך עם Docker וקונטיינרים?' },
      { kw: ['kubernetes', 'k8s'],            q: 'מה הניסיון שלך עם Kubernetes?' },
      { kw: ['aws', 'amazon web'],            q: 'ספר לי על הניסיון שלך עם AWS' },
      { kw: ['azure'],                        q: 'מה הניסיון שלך עם Azure?' },
      { kw: ['gcp', 'google cloud'],          q: 'עבדת עם Google Cloud?' },
      { kw: ['devops', 'ci/cd', 'cicd', 'jenkins', 'github actions'], q: 'ספר לי על הניסיון שלך עם CI/CD ו-DevOps' },
      { kw: ['git'],                          q: 'איך אתה עובד עם Git בצוות?' },
      { kw: ['api', 'rest', 'graphql'],       q: 'ספר לי על ניסיון בפיתוח ועבודה עם APIs' },
      { kw: ['microservice'],                 q: 'עבדת עם ארכיטקטורת Microservices?' },
      { kw: ['testing', 'unit test', 'selenium', 'automation', 'qa'], q: 'ספר לי על הניסיון שלך עם בדיקות ואוטומציה' },
      { kw: ['agile', 'scrum', 'sprint', 'jira'], q: 'איך עבדת עם Agile/Scrum?' },
      { kw: ['ai', 'machine learning', 'ml', 'llm', 'openai'], q: 'ספר לי על הניסיון שלך עם AI ו-ML' },
      { kw: ['unity', 'game'],                q: 'ספר לי על EscapeCode — פרויקט הגיימינג שלך' },
      { kw: ['frontend', 'ui', 'ux'],         q: 'מה הרמה שלך בפרונטאנד?' },
      { kw: ['backend', 'server'],            q: 'ספר לי על הניסיון שלך בפיתוח בק-אנד' },
      { kw: ['fullstack', 'full-stack', 'full stack'], q: 'ספר לי על הניסיון שלך כ-Full Stack' },
      { kw: ['linux', 'bash', 'shell'],       q: 'מה הניסיון שלך עם Linux ו-Bash?' },
      { kw: ['security', 'אבטחה', 'cyber'],  q: 'יש לך ניסיון עם אבטחת מידע?' },
      { kw: ['golang', 'go lang', ' go '],    q: 'עבדת עם Go?' },
      { kw: ['rust'],                         q: 'עבדת עם Rust?' },
      { kw: ['c++', 'cpp'],                   q: 'מה הניסיון שלך עם C++?' },
    ]

    // שאלות קבועות על ההתאמה למשרה — תמיד ראשונות אם יש תיאור
    if (desc.trim()) {
      questions.push('למה אתה חושב שאתה מתאים למשרה הזו?')
      questions.push('מה מייחד אותך כמועמד לתפקיד הזה?')
    }

    // שאלות טכניות לפי מה שמוזכר בתיאור
    for (const { kw, q } of techMap) {
      if (kw.some(k => d.includes(k))) questions.push(q)
    }

    // שאלות על ניסיון ופרויקטים — תמיד רלוונטיות
    const baseQ = [
      'ספר לי על ניסיון העבודה שלך ב-Hexagon',
      'מה הפרויקט שאתה הכי גאה בו?',
      'ספר לי על EscapeCode — פרויקט הגמר שלך',
      'ספר לי על Facebook Data Extractor',
      'מה החוזקות הטכניות הכי גדולות שלך?',
      'איך אתה לומד טכנולוגיות חדשות?',
      'ספר לי על ה-AI Recruiter שבנית',
      'איך פתרת בעיה טכנית קשה שנתקלת בה?',
      'איפה אתה רואה את עצמך בעוד 3 שנים?',
      'מה אתה מחפש בסביבת עבודה?',
    ]

    const all = [...new Set([...questions, ...baseQ])]
    return all.slice(0, 15)
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

  async function handleUrlExtract() {
    const url = jobUrl.trim()
    if (!url) return
    setUrlError('')
    setUrlLoading(true)
    setJobUrlText('')
    try {
      const res = await fetch(`${API_BASE}/api/extract-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      })
      const data = await res.json()
      if (!res.ok) {
        setUrlError(data.detail || 'שגיאה בטעינת הדף')
      } else {
        setJobUrlText(data.text)
      }
    } catch {
      setUrlError('לא ניתן להתחבר לשרת. ודא שהשרת פועל.')
    } finally {
      setUrlLoading(false)
    }
  }

  async function startCall() {
    setCallState('connecting')
    setTranscript('')
    transcriptRef.current = ''
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 24000, channelCount: 1, echoCancellation: true }
      })

      audioCtx.current = new AudioContext({ sampleRate: 24000 })

      outAnalyser.current = audioCtx.current.createAnalyser()
      outAnalyser.current.fftSize = 256
      outAnalyser.current.connect(audioCtx.current.destination)

      ws.current = new WebSocket(WS_URL)
      ws.current.binaryType = 'arraybuffer'

      ws.current.onopen = async () => {
        // שלח job description כהודעה ראשונה לפני האודיו
        const combined = [jobDesc, jobUrlText].filter(Boolean).join('\n\n')
        ws.current.send(JSON.stringify({
          type: 'job_description',
          text: combined
        }))
        setCallState('active')
        const pool = buildQuestionPool(combined)
        questionPoolRef.current = pool.slice(5) // שמור שאר השאלות
        setSuggestedQuestions(pool.slice(0, 5))  // הצג 5 ראשונות
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
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: 'stop_agent' }))
    }
    // חסום כל audio/transcript שיגיע מהרשת אחרי הלחיצה
    blockAgentOutput.current = true
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

  async function handleSetupConfirm() {
    try {
      await fetch(`${API_BASE}/api/save-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recruiter_name: recruiterName.trim(),
          company: recruiterCompany.trim(),
          job_desc: jobUrlText || jobDesc
        })
      })
    } catch (e) {
      console.warn('שגיאה בשמירת סשן:', e)
    }
    setSetupDone(true)
  }

  if (!setupDone) {
    const canProceed = recruiterName.trim() && recruiterCompany.trim()
    return (
      <div className="setup-screen">
        <div className="setup-card">
          <h2 className="setup-title">שחף ישראל — AI Recruiter</h2>
          <p className="setup-subtitle">
            מלא את הפרטים שלך לפני השיחה
          </p>

          <div className="setup-fields">
            <input
              className="setup-input"
              type="text"
              placeholder="השם שלך *"
              value={recruiterName}
              onChange={e => setRecruiterName(e.target.value)}
            />
            <input
              className="setup-input"
              type="text"
              placeholder="שם החברה *"
              value={recruiterCompany}
              onChange={e => setRecruiterCompany(e.target.value)}
            />
          </div>

          <p className="url-note">⚠️ קישורי LinkedIn אינם נתמכים — הדבק את תיאור המשרה ישירות בשדה הטקסט</p>

          <div className="url-input-row">
            <input
              className="setup-input url-input"
              type="url"
              placeholder="קישור למשרה (LinkedIn, Glassdoor, כל אתר...)"
              value={jobUrl}
              onChange={e => { setJobUrl(e.target.value); setUrlError(''); setJobUrlText('') }}
              onKeyDown={e => e.key === 'Enter' && handleUrlExtract()}
              disabled={urlLoading}
            />
            <button
              className="btn-url-fetch"
              onClick={handleUrlExtract}
              disabled={urlLoading || !jobUrl.trim()}
            >
              {urlLoading ? '⏳' : 'טען'}
            </button>
          </div>

          {urlError && <p className="url-error">{urlError}</p>}
          {jobUrlText && <p className="pdf-confirm">✓ המשרה נטענה בהצלחה — הסוכן יכיר את הדרישות</p>}

          <div className="setup-divider"><span>או הדבק ידנית</span></div>

          <textarea
            className="setup-textarea"
            placeholder="הדבק כאן את תיאור המשרה ודרישותיה..."
            value={jobDesc}
            onChange={e => setJobDesc(e.target.value)}
            rows={6}
          />

          <button
            className="btn-confirm-full"
            onClick={handleSetupConfirm}
            disabled={!canProceed}
          >
            התחל ראיון ←
          </button>

          {canProceed && !jobUrlText && !jobDesc.trim() && (
            <button
              className="btn-skip-full"
              onClick={handleSetupConfirm}
            >
              דלג — התחל בלי דרישות
            </button>
          )}
        </div>
        {CursorElements}
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
            setSetupDone(false)
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
              זהו הסוכן ה-AI שלי — הוא מייצג אותי ויענה על כל שאלה שתרצה לשאול.
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
              <p className="disclaimer">* סוכן AI — לא אדם אמיתי. עלולות להיות טעויות קטנות.</p>
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

        <div className="sidebar-footer">
          <p>מופעל על ידי OpenAI Realtime API</p>
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
            {suggestedQuestions.map((q, i) => (
              <button
                key={i}
                className={`suggested-q${questionPending ? ' suggested-q-disabled' : ''}`}
                disabled={questionPending}
                onClick={() => sendTextQuestion(q)}
              >
                {q}
              </button>
            ))}
          </div>
        )}

        <div className="canvas-bottom-fade" />
        <div className="bg-glow-center" />
        <div className="bg-light-left" />
        <div className="bg-light-right" />
      </div>

      {CursorElements}
    </div>
  )
}
