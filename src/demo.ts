// An original synthesized arrangement; no copyrighted recording is bundled.
export function demoFile(): File {
  const rate = 16000, length = 96, samples = new Float32Array(rate * length);
  const parts = [
    { start: 0, end: 8, chords: [261.63, 329.63, 392], gain: 0.16 },
    { start: 8, end: 24, chords: [220, 261.63, 329.63], gain: 0.24 },
    { start: 24, end: 40, chords: [174.61, 220, 261.63], gain: 0.4 },
    { start: 40, end: 56, chords: [220, 261.63, 329.63], gain: 0.24 },
    { start: 56, end: 72, chords: [174.61, 220, 261.63], gain: 0.4 },
    { start: 72, end: 88, chords: [196, 246.94, 293.66], gain: 0.3 },
    { start: 88, end: 96, chords: [261.63, 329.63, 392], gain: 0.12 },
  ];
  for (const p of parts) for (let i = p.start * rate; i < p.end * rate; i++) {
    const t = i / rate, local = t - p.start;
    const envelope = Math.min(1, local / 0.02, (p.end - t) / 0.035);
    const pulse = 0.65 + 0.35 * Math.exp(-(local % 0.5) * 12);
    let value = 0;
    for (const f of p.chords) value += Math.sin(t * 2 * Math.PI * f) / 3 + 0.1 * Math.sin(t * 4 * Math.PI * f);
    samples[i] = value * envelope * pulse * p.gain;
  }
  const bytes = new ArrayBuffer(44 + samples.length * 2), view = new DataView(bytes);
  const text = (at: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, Math.round(samples[i] * 32767), true);
  return new File([bytes], 'Practice arrangement.wav', { type: 'audio/wav' });
}
