/**
 * AudioWorklet Processor — Float32 → PCM16 → postMessage
 * רץ ב-audio thread נפרד, ממיר כל chunk לפני שליחה ל-backend
 */
class PCMProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0]?.[0] // mono channel
    if (!input || input.length === 0) return true

    // Float32 → Int16
    const int16 = new Int16Array(input.length)
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]))
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
    }

    // שלח ל-main thread (transferable — ללא copy)
    this.port.postMessage(int16.buffer, [int16.buffer])
    return true
  }
}

registerProcessor('pcm-processor', PCMProcessor)
