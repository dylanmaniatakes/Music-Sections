import type { Section } from './model';
export type PlaybackMode = 'normal' | 'once' | 'loop';
export const MAX_SECTION_REPEATS = 20;
type NodePair = { source: AudioBufferSourceNode; gain: GainNode };
/** Uses the audio clock for transitions. UI repaint timing never controls a repeat. */
export class Player {
  context: AudioContext;
  master: GainNode;
  buffer: AudioBuffer | null = null;
  playing = false;
  mode: PlaybackMode = 'normal';
  private offset = 0;
  private started = 0;
  private region = { start: 0, end: 0 };
  private jumpAt = Infinity;
  private extraRepeats = 1;
  private nodes: NodePair[] = [];
  private epoch = 0;
  private loopCache: { original: AudioBuffer; start: number; end: number; buffer: AudioBuffer } | null = null;
  constructor(context = new AudioContext({ latencyHint: 'interactive' })) {
    this.context = context; this.master = context.createGain(); this.master.connect(context.destination);
  }
  get position() {
    if (!this.buffer) return 0;
    if (!this.playing) return this.offset;
    const elapsed = Math.max(0, this.context.currentTime - this.started);
    const raw = this.offset + elapsed;
    if (this.mode === 'loop' && raw >= this.region.end) return this.region.start + (raw - this.region.end) % (this.region.end - this.region.start);
    if (this.mode === 'once' && this.context.currentTime >= this.jumpAt) {
      const elapsed = this.context.currentTime - this.jumpAt, length = this.region.end - this.region.start;
      const lastRestart = (this.extraRepeats - 1) * length;
      return elapsed < lastRestart ? this.region.start + elapsed % length : Math.min(this.buffer.duration, this.region.start + elapsed - lastRestart);
    }
    return Math.min(this.buffer.duration, raw);
  }
  get displayMode(): PlaybackMode { return this.mode === 'once' && this.context.currentTime >= this.jumpAt + this.extraRepeats * (this.region.end - this.region.start) ? 'normal' : this.mode; }
  /** Zero while armed; otherwise the extra pass currently playing, starting at one. */
  get repeatPass() {
    if (this.displayMode !== 'once' || this.context.currentTime < this.jumpAt) return 0;
    return Math.min(this.extraRepeats, 1 + Math.floor((this.context.currentTime - this.jumpAt) / (this.region.end - this.region.start)));
  }
  setBuffer(buffer: AudioBuffer) { this.stop(); this.buffer = buffer; this.loopCache = null; }
  setVolume(value: number) { this.master.gain.setTargetAtTime(Math.max(0, Math.min(1, value)), this.context.currentTime, 0.015); }
  private clear() {
    this.epoch++;
    const now = this.context.currentTime;
    for (const { source, gain } of this.nodes) {
      source.onended = null;
      gain.gain.cancelScheduledValues(now); gain.gain.setValueAtTime(gain.gain.value, now); gain.gain.linearRampToValueAtTime(0, now + 0.008);
      try { source.stop(now + 0.01); } catch { /* Source already ended. */ }
      source.addEventListener('ended', () => { source.disconnect(); gain.disconnect(); }, { once: true });
    }
    this.nodes = [];
  }
  private source(when: number, offset: number, final: boolean, length?: number, loop = false) {
    const source = this.context.createBufferSource();
    const gain = this.context.createGain(); gain.gain.setValueAtTime(0, when); gain.gain.linearRampToValueAtTime(1, when + 0.004);
    source.connect(gain); gain.connect(this.master);
    if (loop) {
      const original = this.buffer!;
      if (!this.loopCache || this.loopCache.original !== original || this.loopCache.start !== this.region.start || this.loopCache.end !== this.region.end) {
        const first = Math.round(this.region.start * original.sampleRate), last = Math.round(this.region.end * original.sampleRate);
        const clipped = this.context.createBuffer(original.numberOfChannels, Math.max(1, last - first), original.sampleRate);
        const fade = Math.min(Math.floor(clipped.length / 4), Math.round(original.sampleRate * 0.004));
        for (let ch = 0; ch < original.numberOfChannels; ch++) {
          const output = clipped.getChannelData(ch); output.set(original.getChannelData(ch).subarray(first, last));
          for (let i = 0; i < fade; i++) { output[i] *= i / fade; output[output.length - 1 - i] *= i / fade; }
        }
        this.loopCache = { original, start: this.region.start, end: this.region.end, buffer: clipped };
      }
      source.buffer = this.loopCache.buffer; offset -= this.region.start;
      source.loop = true; source.loopStart = 0; source.loopEnd = source.buffer.duration;
    }
    if (!loop) source.buffer = this.buffer;
    const finish = length ?? (!loop ? this.buffer!.duration - offset : undefined);
    if (finish !== undefined && finish > 0.008) { gain.gain.setValueAtTime(1, when + finish - 0.004); gain.gain.linearRampToValueAtTime(0, when + finish); }
    const token = this.epoch;
    if (final && !loop) source.onended = () => {
      if (token === this.epoch && this.playing) { this.offset = this.buffer!.duration; this.playing = false; this.mode = 'normal'; this.nodes = []; }
      source.disconnect(); gain.disconnect();
    };
    if (!final) source.onended = () => { source.disconnect(); gain.disconnect(); };
    if (length !== undefined) source.start(when, offset, length); else source.start(when, offset);
    this.nodes.push({ source, gain });
  }
  async play(position = this.position, mode: PlaybackMode = 'normal', region?: { start: number; end: number }, extraRepeats = 1) {
    if (!this.buffer) return;
    if (mode === 'once' && (!Number.isInteger(extraRepeats) || extraRepeats < 1 || extraRepeats > MAX_SECTION_REPEATS)) throw new Error(`Choose 1 to ${MAX_SECTION_REPEATS} extra repeats.`);
    const selectedRegion = region ?? this.region;
    if (mode !== 'normal' && (!Number.isFinite(selectedRegion.start) || !Number.isFinite(selectedRegion.end) || selectedRegion.start < 0 || selectedRegion.end > this.buffer.duration || selectedRegion.end <= selectedRegion.start)) throw new Error('Choose a section inside the song.');
    // Invalidate pending resume operations as well as sources; stop during resume must stay stopped.
    this.clear(); const token = this.epoch;
    await this.context.resume();
    if (token !== this.epoch) return;
    this.mode = mode; if (region) this.region = region; this.extraRepeats = extraRepeats;
    let target = Math.max(0, Math.min(this.buffer.duration - 0.0001, position));
    if (mode !== 'normal' && (target < this.region.start || target >= this.region.end)) target = this.region.start;
    this.offset = target; this.started = this.context.currentTime; this.playing = true; this.jumpAt = Infinity;
    if (mode === 'loop') this.source(this.started, target, true, undefined, true);
    else if (mode === 'once' && this.region.end > target) {
      const remaining = this.region.end - target; this.jumpAt = this.started + remaining;
      this.source(this.started, target, false, remaining);
      // Schedule every restart up front on the audio clock, including the final pass
      // that continues through the rest of the recording. No UI timer controls it.
      for (let pass = 0; pass < extraRepeats; pass++) {
        const final = pass === extraRepeats - 1;
        this.source(this.jumpAt + pass * (this.region.end - this.region.start), this.region.start, final, final ? undefined : this.region.end - this.region.start);
      }
    } else this.source(this.started, target, true);
  }
  pause() { const position = this.position; this.clear(); this.offset = position; this.playing = false; this.mode = 'normal'; }
  stop() { this.clear(); this.offset = 0; this.playing = false; this.mode = 'normal'; }
  seek(position: number) { if (this.playing) return this.play(position); this.clear(); this.offset = Math.max(0, Math.min(this.buffer?.duration ?? 0, position)); this.mode = 'normal'; }
  async jump(section: Section) { await this.play(section.start); }
  async setRepeat(mode: PlaybackMode, start: number, end: number, extraRepeats = 1) {
    if (!(end > start)) return;
    let pos = this.position;
    if (pos < start || pos >= end) pos = start;
    await this.play(pos, mode, { start, end }, extraRepeats);
  }
}
export function waveform(buffer: AudioBuffer, bins = 1200): number[] {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  return Array.from({ length: bins }, (_, bin) => {
    const from = Math.floor(bin * buffer.length / bins), to = Math.floor((bin + 1) * buffer.length / bins);
    let peak = 0;
    for (let i = from; i < to; i += Math.max(1, Math.floor((to - from) / 100))) for (const ch of channels) peak = Math.max(peak, Math.abs(ch[i]));
    return peak;
  });
}
export function monoForAnalysis(buffer: AudioBuffer): { samples: Float32Array; rate: number } {
  // Retain 11 kHz for pitch and timbre analysis, limiting transfer size without touching playback audio.
  const desired = 11025; const stride = Math.max(1, Math.floor(buffer.sampleRate / desired));
  const samples = new Float32Array(Math.ceil(buffer.length / stride));
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  for (let i = 0; i < samples.length; i++) {
    let sum = 0;
    for (let k = 0; k < stride && i * stride + k < buffer.length; k++) {
      // RMS-like channel choice avoids phase cancellation in unusual stereo tracks.
      let largest = 0; for (const ch of channels) { const x = ch[i * stride + k]; if (Math.abs(x) > Math.abs(largest)) largest = x; }
      sum += largest;
    }
    samples[i] = sum / stride;
  }
  return { samples, rate: buffer.sampleRate / stride };
}
