import { useState, useRef, useEffect, Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, useGLTF, useAnimations } from '@react-three/drei'
import * as THREE from 'three'
import './App.css'

// ---- Avatar component ----
function Avatar({ state, amplitude }) {
  const group = useRef()
  const { scene, animations } = useGLTF('/model.glb')
  const { actions, names } = useAnimations(animations, group)

  // הפעל אנימציה מהGLB אם קיימת
  useEffect(() => {
    if (names.length > 0) {
      const idleAnim = names.find(n =>
        n.toLowerCase().includes('idle') ||
        n.toLowerCase().includes('stand')
      ) || names[0]
      actions[idleAnim]?.reset().fadeIn(0.3).play()
    }
  }, [actions, names])

  // אנימציית ראש לפי amplitude + state
  useEffect(() => {
    if (!group.current) return
    const interval = setInterval(() => {
      group.current.traverse(obj => {
        if (obj.isBone && (
          obj.name.toLowerCase().includes('head') ||
          obj.name.toLowerCase().includes('neck')
        )) {
          const t = Date.now() * 0.001
          if (state === 'talking') {
            obj.rotation.x = Math.sin(t * 3.2) * 0.04 * amplitude
            obj.rotation.y = Math.sin(t * 2.1) * 0.05 * amplitude
          } else if (state === 'thinking') {
            obj.rotation.y = Math.sin(t * 0.7) * 0.12
            obj.rotation.x = -0.06
          } else {
            obj.rotation.x *= 0.9
            obj.rotation.y *= 0.9
          }
        }
        // פה — אם יש morph targets
        if (obj.isMesh && obj.morphTargetDictionary) {
          const jawIdx = obj.morphTargetDictionary['jawOpen'] ??
                         obj.morphTargetDictionary['mouthOpen'] ?? -1
          if (jawIdx >= 0 && obj.morphTargetInfluences) {
            const target = state === 'talking' ? amplitude * 0.6 : 0
            obj.morphTargetInfluences[jawIdx] +=
              (target - obj.morphTargetInfluences[jawIdx]) * 0.25
          }
        }
      })
    }, 16)
    return () => clearInterval(interval)
  }, [state, amplitude])

  return (
    <group ref={group}>
      <primitive
        object={scene}
        scale={1.8}
        position={[0, -2.6, 0]}
      />
    </group>
  )
}

// ---- Main App ----
export default function App() {
  const [callState, setCallState] = useState('idle') // idle | connecting | active | ended
  const [avatarState, setAvatarState] = useState('idle') // idle | talking | thinking
  const [amplitude, setAmplitude] = useState(0)
  const [transcript, setTranscript] = useState('')
  const [duration, setDuration] = useState(0)

  const ws = useRef(null)
  const workletNode = useRef(null)
  const audioCtx = useRef(null)
  const analyser = useRef(null)
  const outAnalyser = useRef(null)
  const animFrame = useRef(null)
  const timerRef = useRef(null)
  const transcriptRef = useRef('')
  const nextPlayTime = useRef(0)

  const WS_URL = process.env.REACT_APP_WS_URL || 'ws://localhost:8000/ws'

  // Timer
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
      // מיקרופון
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 24000, channelCount: 1, echoCancellation: true }
      })

      // AudioContext
      audioCtx.current = new AudioContext({ sampleRate: 24000 })

      // Analyser לקלט (מיקרופון) — למדידת amplitude של המשתמש
      analyser.current = audioCtx.current.createAnalyser()
      analyser.current.fftSize = 256
      const src = audioCtx.current.createMediaStreamSource(stream)
      src.connect(analyser.current)

      // Analyser לפלט (אודיו יוצא) — למדידת amplitude של האווטר
      outAnalyser.current = audioCtx.current.createAnalyser()
      outAnalyser.current.fftSize = 256
      outAnalyser.current.connect(audioCtx.current.destination)

      // WebSocket
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
        } else if (msg.type === 'avatar_idle') {
          setAvatarState('idle')
          transcriptRef.current = ''
          setTranscript('')
        } else if (msg.type === 'user_speaking') {
          setAvatarState('thinking')
        }
      }

      ws.current.onerror = () => {
        setCallState('idle')
        alert('לא ניתן להתחבר לשרת. ודא שה-backend רץ.')
      }

      ws.current.onclose = () => {
        setCallState('ended')
      }

    } catch (err) {
      console.error(err)
      setCallState('idle')
      alert('לא ניתן לגשת למיקרופון: ' + err.message)
    }
  }

  async function startRecording(stream) {
    // טען את ה-AudioWorklet processor
    await audioCtx.current.audioWorklet.addModule('/pcm-processor.js')

    const src = audioCtx.current.createMediaStreamSource(stream)
    workletNode.current = new AudioWorkletNode(audioCtx.current, 'pcm-processor')

    // קבל PCM16 chunks ושלח ל-backend כ-base64
    workletNode.current.port.onmessage = (e) => {
      if (ws.current?.readyState !== WebSocket.OPEN) return
      const bytes = new Uint8Array(e.data)
      let binary = ''
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
      ws.current.send(btoa(binary))
    }

    src.connect(workletNode.current)
    // לא מחברים ל-destination — לא רוצים לשמוע את עצמנו
  }

  function trackAmplitude() {
    const outData = new Uint8Array(outAnalyser.current.frequencyBinCount)
    function loop() {
      outAnalyser.current.getByteFrequencyData(outData)
      const avg = outData.reduce((a, b) => a + b, 0) / outData.length
      setAmplitude(avg / 128)
      animFrame.current = requestAnimationFrame(loop)
    }
    loop()
  }

  function playAudioChunk(b64Data) {
    try {
      // base64 → bytes
      const binary = atob(b64Data)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

      // PCM16 → Float32
      const pcm = new Int16Array(bytes.buffer)
      const float = new Float32Array(pcm.length)
      for (let i = 0; i < pcm.length; i++) float[i] = pcm[i] / 32768

      const buf = audioCtx.current.createBuffer(1, float.length, 24000)
      buf.copyToChannel(float, 0)

      const src = audioCtx.current.createBufferSource()
      src.buffer = buf
      // עבור דרך outAnalyser כדי שהאווטר יזוז כשהוא מדבר
      src.connect(outAnalyser.current)

      // scheduling חלק — ללא gaps בין chunks
      const now = audioCtx.current.currentTime
      if (nextPlayTime.current < now) nextPlayTime.current = now
      src.start(nextPlayTime.current)
      nextPlayTime.current += buf.duration
    } catch (e) {
      console.warn('audio chunk error:', e)
    }
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
      {/* Avatar Canvas */}
      <div className="canvas-wrap">
        <Canvas
          camera={{ position: [0, 1.3, 2.2], fov: 36 }}
          gl={{ antialias: true }}
        >
          <ambientLight intensity={0.7} />
          <directionalLight position={[3, 5, 4]} intensity={1.0} />
          <directionalLight position={[-2, 2, -2]} intensity={0.3} color="#8899ff" />
          <Suspense fallback={null}>
            <Avatar state={avatarState} amplitude={amplitude} />
          </Suspense>
          <OrbitControls
            enableZoom={false}
            enablePan={false}
            target={[0, 1.3, 0]}
            minPolarAngle={Math.PI * 0.3}
            maxPolarAngle={Math.PI * 0.65}
          />
        </Canvas>

        {/* State indicator */}
        <div className={`state-badge ${avatarState}`}>
          {avatarState === 'talking' ? '🎙️ מדבר' :
           avatarState === 'thinking' ? '💭 מקשיב' : '⏳ ממתין'}
        </div>
      </div>

      {/* Transcript */}
      {transcript && (
        <div className="transcript">{transcript}</div>
      )}

      {/* Controls */}
      <div className="controls">
        {callState === 'idle' && (
          <>
            <h2 className="title">דבר עם השחף AI</h2>
            <p className="subtitle">סוכן AI שיסביר למה אני מתאים לתפקיד</p>
            <button className="btn-start" onClick={startCall}>
              התחל שיחה
            </button>
            <p className="disclaimer">* אתה עומד לשוחח עם סוכן AI, לא עם אדם אמיתי</p>
          </>
        )}

        {callState === 'connecting' && (
          <p className="connecting">מתחבר...</p>
        )}

        {callState === 'active' && (
          <div className="active-controls">
            <div className="timer">{formatTime(duration)}</div>
            <div className="mic-indicator">
              <div className="mic-dot" style={{ transform: `scale(${1 + amplitude * 0.5})` }} />
              <span>מיקרופון פעיל</span>
            </div>
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
    </div>
  )
}
