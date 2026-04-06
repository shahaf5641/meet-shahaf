import { useState, useRef, useEffect, Suspense } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, useGLTF, useAnimations } from '@react-three/drei'
import './App.css'

// ---- Avatar ----
function Avatar({ state, amplitude, mousePosRef }) {
  const group = useRef()
  const { scene, animations } = useGLTF('/model.glb')
  const { actions, names } = useAnimations(animations, group)

  // refs כדי ש-useFrame תמיד יקרא ערכים עדכניים
  const stateRef = useRef(state)
  const ampRef = useRef(amplitude)
  useEffect(() => { stateRef.current = state }, [state])
  useEffect(() => { ampRef.current = amplitude }, [amplitude])

  const idleActionRef = useRef(null)

  useEffect(() => {
    if (names.length > 0) {
      const idleAnim = names.find(n =>
        n.toLowerCase().includes('idle') || n.toLowerCase().includes('stand')
      ) || names[0]
      const action = actions[idleAnim]
      action?.reset().fadeIn(0.3).play()
      idleActionRef.current = action || null
    }
  }, [actions, names])

  // useFrame רץ בתוך render loop של Three.js — אחרי animation mixer
  // כך ה-bone rotations שלנו לא יינסחפו על ידי האנימציה
  useFrame(() => {
    if (!group.current) return
    const mx = mousePosRef?.current?.x || 0
    const my = mousePosRef?.current?.y || 0
    const t = Date.now() * 0.001
    const st = stateRef.current
    const amp = ampRef.current

    // חשב damping לפי מרחק מנקודת הלופ — 0.5s לפני ו-0.5s אחרי
    let loopDamping = 1.0
    const idleAction = idleActionRef.current
    if (idleAction) {
      const clipDuration = idleAction.getClip().duration
      const actionTime = idleAction.time
      const timeToLoop = Math.min(actionTime, clipDuration - actionTime)
      if (timeToLoop < 1.0) {
        loopDamping = timeToLoop / 1.0  // 0 בנקודת הלופ, 1 אחרי שניה
      }
    }

    group.current.traverse(obj => {
      if (obj.isBone && (
        obj.name.toLowerCase().includes('head') ||
        obj.name.toLowerCase().includes('neck')
      )) {
        const isNeck = obj.name.toLowerCase().includes('neck')
        const s = isNeck ? 0.35 : 1.0
        const targetY = mx * 6.6 * s
        const targetX = my * 3.0 * s

        if (st === 'talking') {
          obj.rotation.x += (targetX + Math.sin(t * 3.2) * 0.04 * amp - obj.rotation.x) * 0.08 * loopDamping
          obj.rotation.y += (targetY + Math.sin(t * 2.1) * 0.05 * amp - obj.rotation.y) * 0.06 * loopDamping
        } else if (st === 'thinking') {
          obj.rotation.x += (targetX - 0.06 - obj.rotation.x) * 0.05 * loopDamping
          obj.rotation.y += (targetY + Math.sin(t * 0.7) * 0.1 - obj.rotation.y) * 0.05 * loopDamping
        } else {
          obj.rotation.x += (targetX - obj.rotation.x) * 0.05 * loopDamping
          obj.rotation.y += (targetY - obj.rotation.y) * 0.05 * loopDamping
        }
      }

      if (obj.isMesh && obj.morphTargetDictionary) {
        const jawIdx = obj.morphTargetDictionary['jawOpen'] ??
                       obj.morphTargetDictionary['mouthOpen'] ?? -1
        if (jawIdx >= 0 && obj.morphTargetInfluences) {
          const target = stateRef.current === 'talking' ? ampRef.current * 0.6 : 0
          obj.morphTargetInfluences[jawIdx] +=
            (target - obj.morphTargetInfluences[jawIdx]) * 0.25
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
  const [jobDesc, setJobDesc] = useState('')
  const [pdfContent, setPdfContent] = useState('')
  const [pdfFileName, setPdfFileName] = useState('')
  const [pdfLoading, setPdfLoading] = useState(false)
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

  // ---- בניית מאגר שאלות (15) לפי דרישות המשרה ----
  function buildQuestionPool(desc) {
    const d = desc.toLowerCase()

    // שאלות רלוונטיות למשרה — נבחרות לפי מילות מפתח
    const keywordQ = [
      { kw: ['react'],              q: 'ספר לי על הניסיון שלך עם React' },
      { kw: ['python'],             q: 'אילו פרויקטים בנית עם Python?' },
      { kw: ['docker'],             q: 'מה הניסיון שלך עם Docker?' },
      { kw: ['node'],               q: 'עבדת עם Node.js? באיזה הקשר?' },
      { kw: ['sql', 'database', 'postgres', 'mysql'], q: 'מה הניסיון שלך עם SQL ובסיסי נתונים?' },
      { kw: ['java'],               q: 'ספר לי על הניסיון שלך עם Java' },
      { kw: ['c#', '.net', 'dotnet'], q: 'ספר לי על הניסיון שלך עם C# ו-.NET' },
      { kw: ['azure'],              q: 'מה הניסיון שלך עם Azure DevOps?' },
      { kw: ['devops', 'ci/cd', 'cicd'], q: 'ספר לי על עבודה עם CI/CD ו-DevOps' },
      { kw: ['git'],                q: 'איך אתה עובד עם Git בצוות?' },
      { kw: ['api', 'rest'],        q: 'ספר לי על עבודה עם REST APIs' },
      { kw: ['frontend', 'ui', 'ux'], q: 'מה הרמה שלך בפרונטאנד?' },
      { kw: ['backend'],            q: 'ספר לי על הניסיון שלך בבאקאנד' },
      { kw: ['fullstack', 'full stack'], q: 'ספר לי על הניסיון שלך כ-Full Stack' },
      { kw: ['ai', 'ml', 'machine learning'], q: 'ספר לי על הפרויקט ה-AI שבנית' },
      { kw: ['selenium', 'automation', 'testing'], q: 'ספר לי על הניסיון שלך עם אוטומציה ובדיקות' },
      { kw: ['redis', 'queue'],     q: 'ספר לי על Facebook Data Extractor' },
      { kw: ['unity', 'game'],      q: 'ספר לי על EscapeCode שבנית ב-Unity' },
      { kw: ['microservices', 'micro'], q: 'עבדת עם Microservices? ספר לי' },
      { kw: ['agile', 'scrum', 'sprint'], q: 'איך עבדת עם Agile ו-Scrum?' },
    ]

    // שאלות על ניסיון ופרויקטים — תמיד רלוונטיות
    const experienceQ = [
      'ספר לי על ניסיון העבודה שלך ב-Hexagon ALI',
      'ספר לי על הפרויקט הכי מאתגר שעבדת עליו',
      'מה החוזקות הטכניות הכי גדולות שלך?',
      'ספר לי על EscapeCode — פרויקט הגמר שלך',
      'מה למדת מהתמחות ב-Hexagon?',
      'איך פתרת בעיה טכנית קשה שנתקלת בה?',
      'ספר לי על Facebook Data Extractor',
      'מה הפרויקט שאתה הכי גאה בו?',
    ]

    // שאלות אישיות ומקצועיות
    const personalQ = [
      'איך אתה לומד טכנולוגיות חדשות?',
      'איך אתה עובד בצוות?',
      'מה מניע אותך בעבודה?',
      'איפה אתה רואה את עצמך בעוד 3 שנים?',
      'מה אתה מחפש בסביבת עבודה?',
      'מה ציפיות השכר שלך?',
    ]

    const matched = keywordQ
      .filter(({ kw }) => kw.some(k => d.includes(k)))
      .map(({ q }) => q)

    const all = [...new Set([...matched, ...experienceQ, ...personalQ])]
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

  async function handlePdfUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setPdfLoading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`${API_BASE}/extract-pdf`, { method: 'POST', body: form })
      const data = await res.json()
      if (data.text) {
        setPdfContent(data.text)
        setPdfFileName(file.name)
      }
    } catch {
      alert('שגיאה בחילוץ ה-PDF. נסה להדביק את הטקסט ידנית.')
    } finally {
      setPdfLoading(false)
      e.target.value = ''
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
        const combined = [jobDesc, pdfContent].filter(Boolean).join('\n\n')
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

  if (!setupDone) {
    return (
      <div className="setup-screen">
        <div className="setup-card">
          <h2 className="setup-title">שחף ישראל — AI Recruiter</h2>
          <p className="setup-subtitle">
            הכנס את דרישות המשרה שלך לפני השיחה
          </p>

          <textarea
            className="setup-textarea"
            placeholder="הדבק כאן את תיאור המשרה ודרישותיה..."
            value={jobDesc}
            onChange={e => setJobDesc(e.target.value)}
            rows={10}
          />

          <label className="btn-pdf-full">
            {pdfLoading ? '⏳ טוען קובץ...' : '📎 העלה קובץ PDF'}
            <input
              type="file"
              accept=".pdf"
              style={{ display: 'none' }}
              onChange={handlePdfUpload}
              disabled={pdfLoading}
            />
          </label>

          {pdfFileName && (
            <p className="pdf-confirm">✓ {pdfFileName} נטען בהצלחה — הסוכן יכיר את הדרישות</p>
          )}

          <button
            className="btn-confirm-full"
            onClick={() => setSetupDone(true)}
            disabled={!jobDesc.trim() && !pdfContent}
          >
            התחל ראיון ←
          </button>

          {!pdfContent && (
            <button
              className="btn-skip-full"
              onClick={() => setSetupDone(true)}
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
            <Avatar state={avatarState} amplitude={amplitude} mousePosRef={mousePosRef} />
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
