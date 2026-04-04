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

  useEffect(() => {
    if (names.length > 0) {
      const idleAnim = names.find(n =>
        n.toLowerCase().includes('idle') || n.toLowerCase().includes('stand')
      ) || names[0]
      actions[idleAnim]?.reset().fadeIn(0.3).play()
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

    group.current.traverse(obj => {
      if (obj.isBone && (
        obj.name.toLowerCase().includes('head') ||
        obj.name.toLowerCase().includes('neck')
      )) {
        const isNeck = obj.name.toLowerCase().includes('neck')
        const s = isNeck ? 0.35 : 1.0
        const targetY = mx * 0.55 * s
        const targetX = -my * 0.25 * s

        if (st === 'talking') {
          obj.rotation.x += (targetX + Math.sin(t * 3.2) * 0.04 * amp - obj.rotation.x) * 0.08
          obj.rotation.y += (targetY + Math.sin(t * 2.1) * 0.05 * amp - obj.rotation.y) * 0.06
        } else if (st === 'thinking') {
          obj.rotation.x += (targetX - 0.06 - obj.rotation.x) * 0.05
          obj.rotation.y += (targetY + Math.sin(t * 0.7) * 0.1 - obj.rotation.y) * 0.05
        } else {
          obj.rotation.x += (targetX - obj.rotation.x) * 0.05
          obj.rotation.y += (targetY - obj.rotation.y) * 0.05
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
      <primitive object={scene} scale={1.8} position={[0, -2.6, 0]} />
    </group>
  )
}

// ---- App ----
export default function App() {
  const [callState, setCallState] = useState('idle')
  const [avatarState, setAvatarState] = useState('idle')
  const [amplitude, setAmplitude] = useState(0)
  const [transcript, setTranscript] = useState('')
  const [duration, setDuration] = useState(0)

  const ws = useRef(null)
  const workletNode = useRef(null)
  const audioCtx = useRef(null)
  const outAnalyser = useRef(null)
  const animFrame = useRef(null)
  const timerRef = useRef(null)
  const transcriptRef = useRef('')
  const nextPlayTime = useRef(0)
  const isAgentTalking = useRef(false)
  const mousePosRef = useRef({ x: 0, y: 0 })

  const WS_URL = process.env.REACT_APP_WS_URL || 'ws://localhost:8000/ws'

  // מעקב עכבר לhead tracking
  useEffect(() => {
    const onMove = (e) => {
      mousePosRef.current = {
        x: (e.clientX / window.innerWidth) * 2 - 1,
        y: (e.clientY / window.innerHeight) * 2 - 1,
      }
    }
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [])

  // טיימר שיחה
  useEffect(() => {
    if (callState === 'active') {
      timerRef.current = setInterval(() => setDuration(d => d + 1), 1000)
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

      audioCtx.current = new AudioContext({ sampleRate: 24000 })

      outAnalyser.current = audioCtx.current.createAnalyser()
      outAnalyser.current.fftSize = 256
      outAnalyser.current.connect(audioCtx.current.destination)

      ws.current = new WebSocket(WS_URL)
      ws.current.binaryType = 'arraybuffer'

      ws.current.onopen = async () => {
        setCallState('active')
        await startRecording(stream)
        trackAmplitude()
      }

      ws.current.onmessage = async (event) => {
        const msg = JSON.parse(event.data)
        if (msg.type === 'audio' && msg.data) {
          playAudioChunk(msg.data)
        } else if (msg.type === 'transcript' && msg.text) {
          transcriptRef.current += msg.text
          setTranscript(transcriptRef.current)
        } else if (msg.type === 'avatar_talking') {
          setAvatarState('talking')
          isAgentTalking.current = true
          // אפס רק אם לא מנגנים כרגע — מונע חיתוך אודיו של תשובה קודמת
          const now = audioCtx.current?.currentTime || 0
          if (nextPlayTime.current <= now) nextPlayTime.current = 0
        } else if (msg.type === 'avatar_idle') {
          setAvatarState('idle')
          // המתן עד שהאודיו המתוזמן יסתיים לפני שמדליקים את המיק
          // מונע VAD מיידי שיפסיק את האודיו הנוכחי
          const waitMs = Math.max(0, (nextPlayTime.current - (audioCtx.current?.currentTime || 0)) * 1000) + 300
          setTimeout(() => { isAgentTalking.current = false }, waitMs)
        } else if (msg.type === 'user_speaking') {
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
    } catch (e) {
      console.warn('audio chunk error:', e)
    }
  }

  function interruptAgent() {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: 'stop_agent' }))
    }
    isAgentTalking.current = false
    setAvatarState('idle')
    nextPlayTime.current = 0
  }

  function endCall() {
    workletNode.current?.disconnect()
    cancelAnimationFrame(animFrame.current)
    ws.current?.close()
    audioCtx.current?.close()
    nextPlayTime.current = 0
    setCallState('ended')
    setAvatarState('idle')
  }

  function resetCall() {
    setCallState('idle')
    setTranscript('')
    setDuration(0)
  }

  return (
    <div className="app">

      {/* ---- Sidebar שמאל ---- */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className={`status-pill ${callState === 'active' ? 'active' : ''}`}>
            <span className="status-dot" />
            {callState === 'active' ? 'בשיחה' : 'זמין לשיחה'}
          </div>
        </div>

        <div className="profile-section">
          <p className="greeting">שלום, אני</p>
          <h1 className="profile-name">שחף ישראל</h1>
          <p className="profile-role">Full Stack & AI Developer</p>
        </div>

        {callState === 'idle' && (
          <div className="welcome-section">
            <p className="welcome-text">
              בוגר הנדסת תוכנה עם ניסיון בפיתוח backend, AI וכלי DevOps.
              שאל אותי על הפרויקטים, הכישורים, או כל שאלה שתעזור לך להחליט.
            </p>
            <div className="skill-chips">
              {['Python', 'React', 'FastAPI', 'Docker', 'Azure', 'AI'].map(s => (
                <span key={s} className="chip">{s}</span>
              ))}
            </div>
          </div>
        )}

        {transcript && (
          <div className="transcript">
            <div className="transcript-label">שחף אומר</div>
            <p>{transcript}</p>
          </div>
        )}

        <div className="controls">
          {callState === 'idle' && (
            <>
              <button className="btn-start" onClick={startCall}>התחל שיחה</button>
              <p className="disclaimer">* סוכן AI — לא אדם אמיתי</p>
            </>
          )}

          {callState === 'connecting' && (
            <p className="connecting">מתחבר...</p>
          )}

          {callState === 'active' && (
            <div className="active-controls">
              <div className="timer">{formatTime(duration)}</div>
              {avatarState === 'talking' ? (
                <button className="btn-interrupt" onClick={interruptAgent}>הפסק ✋</button>
              ) : (
                <div className="mic-indicator">
                  <div className="mic-dot" style={{ transform: `scale(${1 + amplitude * 0.5})` }} />
                  <span>{avatarState === 'thinking' ? 'מעבד...' : 'מקשיב...'}</span>
                </div>
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
        <Canvas camera={{ position: [0, -0.2, 3.2], fov: 40 }} gl={{ antialias: true }}>
          <ambientLight intensity={0.7} />
          <directionalLight position={[3, 5, 4]} intensity={1.0} />
          <directionalLight position={[-2, 2, -2]} intensity={0.3} color="#8899ff" />
          <Suspense fallback={null}>
            <Avatar state={avatarState} amplitude={amplitude} mousePosRef={mousePosRef} />
          </Suspense>
          <OrbitControls
            enableZoom={false}
            enablePan={false}
            target={[0, -0.2, 0]}
            minPolarAngle={Math.PI * 0.3}
            maxPolarAngle={Math.PI * 0.65}
          />
        </Canvas>

        <div className={`state-badge ${avatarState}`}>
          {avatarState === 'talking' ? '● מדבר' :
           avatarState === 'thinking' ? '● מקשיב' : '○ ממתין'}
        </div>

        <div className="canvas-bottom-fade" />
      </div>

    </div>
  )
}
