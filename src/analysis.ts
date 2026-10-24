import FFT from 'fft.js';
import type { SectionKind } from './model';
import type { LyricHint } from './lyrics';
export type Features = { frames: Float32Array[]; chroma: Float32Array[]; energy: number[]; step: number; duration: number };
export type AnalysisSection = { start: number; name: string; kind: SectionKind; group: number };
export type AnalysisResult = { sections: AnalysisSection[]; note: string; mapped?: boolean; match?: number };
const norm = (v: Float32Array) => { const length = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0)) || 1; for (let i = 0; i < v.length; i++) v[i] /= length; return v; };
export function distance(a: Float32Array, b: Float32Array) {
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
  if (aa < 1e-12 && bb < 1e-12) return 0;
  if (aa < 1e-12 || bb < 1e-12) return 1;
  return Math.max(0, Math.min(2, 1 - dot / Math.sqrt(aa * bb)));
}
export function extract(samples: Float32Array, rate: number, progress: (n: number) => void = () => {}): Features {
  if (!Number.isFinite(rate) || rate < 1000 || !samples.length) throw new Error('No usable audio was found.');
  const duration = samples.length / rate; const step = Math.max(0.25, duration / 1600);
  const size = 2048; const fft = new FFT(size); const input = new Float32Array(size); const spectrum = fft.createComplexArray();
  const frames: Float32Array[] = [], chroma: Float32Array[] = [], energy: number[] = [];
  const bands = new Int16Array(size / 2), pitches = new Int16Array(size / 2); pitches.fill(-1);
  for (let k = 1; k < size / 2; k++) {
    const hz = k * rate / size;
    bands[k] = Math.max(0, Math.min(23, Math.floor(Math.log2(Math.max(50, hz) / 50) / Math.log2(rate / 100) * 24)));
    if (hz >= 70 && hz <= 3000) pitches[k] = ((Math.round(69 + 12 * Math.log2(hz / 440)) % 12) + 12) % 12;
  }
  for (let t = 0; t < duration; t += step) {
    const start = Math.floor(t * rate); let rms = 0;
    for (let i = 0; i < size; i++) { const x = samples[start + i] ?? 0; rms += x * x; input[i] = x * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (size - 1))); }
    fft.realTransform(spectrum, input);
    const frame = new Float32Array(36), pitch = new Float32Array(12);
    for (let k = 1; k < size / 2; k++) {
      const magnitude = Math.sqrt(spectrum[2 * k] ** 2 + spectrum[2 * k + 1] ** 2);
      frame[bands[k]] += magnitude;
      if (pitches[k] >= 0) pitch[pitches[k]] += magnitude;
    }
    for (let j = 0; j < 24; j++) frame[j] = Math.log1p(frame[j]);
    const spectral = norm(frame.slice(0, 24)); norm(pitch);
    for (let j = 0; j < 24; j++) frame[j] = spectral[j] * 0.55;
    for (let j = 0; j < 12; j++) frame[j + 24] = pitch[j] * 0.85;
    frames.push(norm(frame)); chroma.push(pitch); energy.push(Math.sqrt(rms / size));
    if (frames.length % 80 === 0) progress(t / duration);
  }
  return { frames, chroma, energy, step, duration };
}
function mean(frames: Float32Array[], from: number, to: number) {
  const result = new Float32Array(frames[0]?.length ?? 36); let count = 0;
  for (let i = Math.max(0, from); i < Math.min(frames.length, to); i++) { count++; for (let j = 0; j < result.length; j++) result[j] += frames[i][j]; }
  if (count) for (let j = 0; j < result.length; j++) result[j] /= count;
  return norm(result);
}
function average(values: number[], from: number, to: number) { const part = values.slice(Math.max(0, from), Math.min(values.length, to)); return part.reduce((a, b) => a + b, 0) / Math.max(1, part.length); }
function percentile(values: number[], p: number) { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor((sorted.length - 1) * p)] ?? 0; }
function structuralFrames(frames: Float32Array[]) {
  // Loud, compressed recordings can have almost identical average spectra throughout.
  // Center each feature within this song to expose changes instead of clustering everything together.
  const dimensions = frames[0]?.length ?? 36, center = new Float64Array(dimensions), variance = new Float64Array(dimensions);
  for (const frame of frames) for (let j = 0; j < dimensions; j++) center[j] += frame[j] / frames.length;
  for (const frame of frames) for (let j = 0; j < dimensions; j++) variance[j] += (frame[j] - center[j]) ** 2 / frames.length;
  return frames.map(frame => norm(Float32Array.from(frame, (value, j) => (value - center[j]) / Math.max(0.035, Math.sqrt(variance[j])))));
}
export function detect(features: Features, sensitivity = 0.5, hints: LyricHint[] = []): AnalysisResult {
  const { energy, step, duration } = features;
  const frames = structuralFrames(features.frames);
  const silent = percentile(energy, 0.9) < 0.0001;
  if (silent || duration < 12) return { sections: [{ start: 0, name: 'Whole song', kind: 'Section', group: 0 }], note: silent ? 'The audio is silent or extremely quiet. Add sections manually if needed.' : 'This short recording has been kept as one section.' };
  const window = Math.max(2, Math.round(3.5 / step)); const novelty = new Array(frames.length).fill(0);
  for (let i = window; i < frames.length - window; i++) {
    const before = mean(frames, i - window, i), after = mean(frames, i, i + window);
    const left = average(energy, i - window, i), right = average(energy, i, i + window);
    const energyChange = Math.abs(Math.log((left + 0.00001) / (right + 0.00001)));
    const wider = window * 2;
    const broad = distance(mean(frames, i - wider, i), mean(frames, i, i + wider));
    novelty[i] = distance(before, after) * 0.65 + broad * 0.35 + Math.min(energyChange, 2) * 0.09;
  }
  const median = percentile(novelty, 0.5), mad = percentile(novelty.map(x => Math.abs(x - median)), 0.5);
  const threshold = Math.max(0.035, median + mad * (2.7 - sensitivity * 2.2));
  const minGap = 6 + (1 - sensitivity) * 8;
  const candidates: { t: number; score: number }[] = [];
  const reach = Math.max(2, Math.round(1.5 / step));
  for (let i = window; i < novelty.length - window; i++) {
    const t = i * step;
    if (t < 4 || t > duration - 3 || novelty[i] < threshold) continue;
    if (novelty.slice(i - reach, i + reach + 1).every(x => x <= novelty[i])) candidates.push({ t, score: novelty[i] });
  }
  candidates.sort((a, b) => b.score - a.score);
  const chosen: number[] = [0];
  for (const point of candidates) if (chosen.length < 40 && chosen.every(t => Math.abs(t - point.t) >= (t === 0 ? 4 : minGap))) chosen.push(point.t);
  chosen.sort((a, b) => a - b);
  // Place the marker near the local attack/quiet valley rather than in the middle of a change window.
  for (let i = 1; i < chosen.length; i++) {
    const center = Math.round(chosen[i] / step); let best = center, bestScore = -Infinity;
    for (let k = Math.max(1, center - 4); k <= Math.min(energy.length - 2, center + 4); k++) {
      const score = energy[k + 1] - energy[k - 1] + (novelty[k] ?? 0) * 0.1;
      if (score > bestScore) { bestScore = score; best = k; }
    }
    chosen[i] = Math.max(chosen[i - 1] + 0.1, best * step);
  }
  // Compare musical progression across each passage, not just its average instrumentation.
  const summaries = chosen.map((start, i) => {
    const end = chosen[i + 1] ?? duration, signature = new Float32Array(36 * 8);
    for (let slice = 0; slice < 8; slice++) {
      const from = start + (end - start) * slice / 8, to = start + (end - start) * (slice + 1) / 8;
      signature.set(mean(frames, Math.floor(from / step), Math.max(Math.floor(from / step) + 1, Math.floor(to / step))), slice * 36);
    }
    return norm(signature);
  });
  const groups: number[] = []; const prototypes: Float32Array[] = [];
  for (const summary of summaries) {
    const i = groups.length, length = (chosen[i + 1] ?? duration) - chosen[i];
    let best = -1, difference = 0.22;
    prototypes.forEach((prototype, group) => {
      const previous = groups.indexOf(group), previousLength = (chosen[previous + 1] ?? duration) - chosen[previous];
      const ratio = length / previousLength;
      const d = distance(summary, prototype); if (ratio >= 0.7 && ratio <= 1.4 && d < difference) { difference = d; best = group; }
    });
    if (best < 0) { best = prototypes.length; prototypes.push(summary); }
    groups.push(best);
  }
  const counts = groups.reduce<Record<number, number>>((a, group) => { a[group] = (a[group] ?? 0) + 1; return a; }, {});
  const groupEnergy = prototypes.map((_, group) => {
    const indexes = groups.map((g, i) => g === group ? i : -1).filter(i => i >= 0);
    return indexes.reduce((sum, i) => sum + average(energy, Math.floor(chosen[i] / step), Math.floor((chosen[i + 1] ?? duration) / step)), 0) / indexes.length;
  });
  const repeated = Object.keys(counts).map(Number).filter(group => counts[group] >= 2 && chosen.reduce((sum, start, i) => sum + (groups[i] === group ? (chosen[i + 1] ?? duration) - start : 0), 0) >= 24);
  const chorus = repeated.sort((a, b) => groupEnergy[b] - groupEnergy[a])[0];
  const verse = repeated.filter(g => g !== chorus).sort((a, b) => groups.indexOf(a) - groups.indexOf(b))[0];
  const instances: Record<string, number> = {};
  const sections = chosen.map((start, i): AnalysisSection => {
    let kind: SectionKind = 'Section';
    if (chosen.length >= 4 && i === 0 && chosen[1] < 24 && (counts[groups[i]] === 1 || !groups.slice(1, -1).includes(groups[i]))) kind = 'Intro';
    else if (chosen.length >= 4 && i === chosen.length - 1 && duration - start < 24 && (counts[groups[i]] === 1 || !groups.slice(1, -1).includes(groups[i]))) kind = 'Ending';
    else if (groups[i] === chorus && repeated.length >= 2) kind = 'Chorus';
    else if (groups[i] === verse) kind = 'Verse';
    const label = kind === 'Section' ? `Section ${String.fromCharCode(65 + groups[i] % 26)}` : kind;
    instances[label] = (instances[label] ?? 0) + 1;
    return { start: Math.round(start * 100) / 100, kind, name: kind === 'Intro' || kind === 'Ending' ? label : `${label} ${instances[label]}`, group: groups[i] };
  });
  if (hints.length >= 2) {
    const musical = sections;
    const clues = hints.filter(h => Number.isFinite(h.start) && Number.isFinite(h.end) && h.start >= 0 && h.start < duration && h.end >= h.start).sort((a, b) => a.start - b.start);
    if (clues.length < 2) return { sections, note: 'Timed lyric clues were unusable. Suggested from musical changes; review boundaries and labels.' };
    const cutScore = (start: number) => Math.max(...novelty.slice(Math.max(0, Math.round(start / step) - reach), Math.round(start / step) + reach + 1));
    const strongCut = (start: number) => cutScore(start) >= Math.max(threshold, median + mad * 3.5);
    const proposed = clues.map((hint, i) => {
      if (i === 0 && (hint.kind === 'Intro' || hint.start < 4)) return { ...hint, start: 0, supported: hint.start === 0, moved: false };
      // Check both sides: timestamps may lead the music as well as trail a pickup.
      // Neighbor midpoints prevent a correction from swapping two lyric passages.
      const from = Math.max(hint.start - 6, i ? (clues[i - 1].start + hint.start) / 2 : 0);
      const to = Math.min(hint.start + 6, clues[i + 1] ? (hint.start + clues[i + 1].start) / 2 : duration);
      const near = musical.filter(s => s.start > 0 && s.start >= from && s.start <= to);
      near.sort((a, b) => (cutScore(b.start) - Math.abs(b.start - hint.start) * 0.08) - (cutScore(a.start) - Math.abs(a.start - hint.start) * 0.08));
      const start = near[0]?.start ?? hint.start;
      return { ...hint, start: Math.round(start * 100) / 100, end: Math.max(start, Math.min(duration, hint.end)), supported: Boolean(near.length), moved: Math.abs(start - hint.start) >= 0.1 };
    });
    const anchors: typeof proposed = []; let joined = 0;
    for (const anchor of proposed) {
      const previous = anchors.at(-1);
      const weak = anchor.basis === 'paragraph' || (!anchor.basis && ['Verse', 'Section'].includes(anchor.kind));
      // Formatting alone must not split a continuous verse into several verse buttons.
      const shortSplit = anchor.end - anchor.start <= minGap || (previous && anchor.start - previous.start < minGap);
      if (previous && (anchor.start - previous.start < 0.1 || (weak && !anchor.supported && shortSplit && anchor.kind === previous.kind && anchor.start - previous.end < 10))) {
        if (anchor.start - previous.start < 0.1 && (anchor.basis === 'label' || anchor.basis === 'repeat')) {
          const end = Math.max(previous.end, anchor.end); Object.assign(previous, anchor, { end });
        } else previous.end = Math.max(previous.end, anchor.end);
        joined++; continue;
      }
      anchors.push(anchor);
    }
    let preserved = 0;
    const merged: AnalysisSection[] = musical.filter(s => {
      if (anchors.some(a => Math.abs(a.start - s.start) < 5)) return false;
      const covering = anchors.find(a => s.start > a.start && s.start < a.end - 1);
      if (!covering) return true;
      // Strong changes (for example a breakdown within a long stanza) remain available.
      if (s.start - covering.start >= minGap && anchors.every(a => Math.abs(s.start - a.start) >= minGap) && strongCut(s.start)) { preserved++; return true; }
      return false;
    });
    if (!anchors.some(a => a.start === 0) && !merged.some(s => s.start === 0)) merged.push({ start: 0, kind: anchors[0].start >= 4 ? 'Intro' : 'Section', name: '', group: -1 });
    for (const anchor of anchors) if (!merged.some(s => Math.abs(s.start - anchor.start) < 0.1)) merged.push({ start: anchor.start, kind: anchor.kind, name: '', group: anchor.group });
    merged.sort((a, b) => a.start - b.start);
    const numbers: Record<string, number> = {};
    merged.forEach((s, i) => {
      if (s.kind === 'Section') {
        const before = [...anchors].reverse().find(a => a.start < s.start), after = anchors.find(a => a.start > s.start);
        if (before && after && s.start >= before.end && after.start - s.start >= 8) s.kind = 'Instrumental';
      }
      const label = s.kind === 'Section' ? `Section ${String.fromCharCode(65 + Math.max(0, s.group) % 26)}` : s.kind;
      numbers[label] = (numbers[label] ?? 0) + 1;
      s.name = ['Intro', 'Ending'].includes(s.kind) ? label : `${label} ${numbers[label]}`;
      if (i && s.start - merged[i - 1].start < 0.1) s.start = merged[i - 1].start + 0.1;
    });
    const supported = anchors.filter(a => a.supported).length, moved = anchors.filter(a => a.moved).length;
    return { sections: merged, note: `Timed lyric clues checked against the audio: ${supported} of ${anchors.length} starts aligned with musical changes${moved ? `; ${moved} timings adjusted` : ''}.${joined ? ` Joined ${joined} overlapping or unsupported paragraph splits.` : ''}${preserved ? ` Kept ${preserved} strong musical ${preserved === 1 ? 'change' : 'changes'} inside lyric passages.` : ''} Other lyric starts remain approximate. Review section names and jump points by listening.` };
  }
  return { sections, note: sections.length === 1 ? 'No strong section changes were found. Try finer detection or add markers while listening.' : 'Suggested from musical changes at two time scales and repeated passages. Verse and chorus names are estimates; audition boundaries and confirm labels.' };
}
export function align(reference: Features, target: Features): { mapping: number[]; match: number } {
  const rows = reference.chroma.length, cols = target.chroma.length;
  if (reference.duration / target.duration < 0.65 || reference.duration / target.duration > 1.5) throw new Error('These recordings have very different lengths. Analyze the playback track directly instead.');
  const directions = new Uint8Array(rows * cols);
  let previous = new Float64Array(cols + 1); previous.fill(Infinity); previous[0] = 0;
  for (let i = 1; i <= rows; i++) {
    const next = new Float64Array(cols + 1); next.fill(Infinity);
    const expected = i * cols / rows, radius = Math.ceil(Math.max(cols, rows) * 0.18);
    for (let j = Math.max(1, Math.floor(expected - radius)); j <= Math.min(cols, Math.ceil(expected + radius)); j++) {
      const cost = distance(reference.chroma[i - 1], target.chroma[j - 1]);
      const diagonal = previous[j - 1], up = previous[j] + 0.03, left = next[j - 1] + 0.03;
      const choice = diagonal <= up && diagonal <= left ? 0 : up <= left ? 1 : 2;
      next[j] = cost + (choice === 0 ? diagonal : choice === 1 ? up : left); directions[(i - 1) * cols + j - 1] = choice;
    }
    previous = next;
  }
  let i = rows - 1, j = cols - 1, cost = 0, points = 0;
  const sums = new Float64Array(rows), counts = new Uint16Array(rows);
  while (i >= 0 && j >= 0) {
    sums[i] += j; counts[i]++; cost += distance(reference.chroma[i], target.chroma[j]); points++;
    if (i === 0 && j === 0) break;
    const d = directions[i * cols + j]; if (d === 0) { i--; j--; } else if (d === 1) i--; else j--;
  }
  const match = 1 - cost / Math.max(1, points);
  if (!Number.isFinite(match) || match < 0.6) throw new Error('The reference could not be matched confidently. Use a matching version or analyze the playback track directly.');
  const mapping = Array.from(sums, (sum, k) => counts[k] ? sum / counts[k] * target.step : k * target.duration / rows);
  return { mapping, match };
}
export function analyze(target: Features, sensitivity: number, reference?: Features, hints: LyricHint[] = []): AnalysisResult {
  const result = detect(reference ?? target, sensitivity, hints);
  if (!reference) return result;
  const aligned = align(reference, target);
  const sections: AnalysisSection[] = [];
  for (const [i, section] of result.sections.entries()) {
    const start = i === 0 ? 0 : Math.round((aligned.mapping[Math.min(aligned.mapping.length - 1, Math.round(section.start / reference.step))] ?? section.start) * 100) / 100;
    if (start < target.duration - 0.1 && (!sections.length || start - sections.at(-1)!.start >= 0.1)) sections.push({ ...section, start });
  }
  return { sections, mapped: true, match: aligned.match, note: `${hints.length ? 'Timed lyric clues were applied to the reference. ' : ''}Suggested using the reference recording and matched to the playback track. Check every boundary: different arrangements can still produce an incorrect match.` };
}
