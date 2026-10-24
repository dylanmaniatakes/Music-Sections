import { lyricHints, type LyricHint, type TimedLyrics } from './lyrics';
export type Recognition = { id: string; title: string; artist: string; hits: number; confirmed: boolean };
export type RecognitionStatus = 'confirmed' | 'possible' | 'not-found' | 'conflict' | 'unavailable' | 'quiet';
export type LyricsStatus = 'matched' | 'no-clues' | 'plain-only' | 'instrumental' | 'different-version' | 'not-found' | 'unavailable' | 'missing-details';
export type PreparationEvidence = { recognition?: Recognition; recognitionStatus?: RecognitionStatus; lyricsStatus?: LyricsStatus; lyricsMessage?: string; lyricsId?: number; duration: number; hints: LyricHint[]; note: string; reference: boolean };
async function online<T>(route: 'recognize-song' | 'timed-lyrics', input: unknown, signal: AbortSignal): Promise<T> {
  if (window.musicSections) {
    const result = await (route === 'recognize-song' ? window.musicSections.recognizeSong(input) : window.musicSections.timedLyrics(input));
    signal.throwIfAborted(); return result as T;
  }
  const response = await fetch(`/api/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal });
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || 'Online preparation is unavailable.'); }
  return response.json();
}
export function recognitionClips(buffer: AudioBuffer): number[][] {
  const seconds = Math.min(12, buffer.duration), length = Math.floor(seconds * 16000);
  const positions = [...new Set([0.2, 0.5, 0.75].map(part => Math.max(0, Math.min(buffer.duration - seconds, buffer.duration * part))))];
  return positions.map(start => {
    const clip = new Array<number>(length); let energy = 0;
    for (let i = 0; i < length; i++) {
      const from = Math.floor((start + i / 16000) * buffer.sampleRate), to = Math.max(from + 1, Math.floor((start + (i + 1) / 16000) * buffer.sampleRate));
      let sample = 0;
      for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
        const channel = buffer.getChannelData(ch); let sum = 0;
        for (let k = from; k < to; k++) sum += channel[k] ?? 0;
        sample += sum / (to - from) / buffer.numberOfChannels;
      }
      clip[i] = Math.max(-1, Math.min(1, sample)); energy += sample * sample;
    }
    return energy / length > 0.00001 ? clip : [];
  }).filter(clip => clip.length >= 16000);
}
export async function enrich(buffer: AudioBuffer, details: { title: string; artist: string }, reference: boolean, signal: AbortSignal, stage: (text: string) => void): Promise<PreparationEvidence> {
  const notes: string[] = []; let recognition: Recognition | undefined, recognitionStatus: RecognitionStatus = 'not-found';
  stage(reference ? 'Identifying the vocal reference' : 'Identifying the recording');
  try {
    const clips = recognitionClips(buffer);
    const result = clips.length ? await online<Recognition | { conflict: boolean } | null>('recognize-song', { clips }, signal) : null;
    if (result && 'title' in result) { recognition = result; recognitionStatus = result.confirmed ? 'confirmed' : 'possible'; notes.push(result.confirmed ? 'Song identity agreed across two audio samples.' : `Possible match: ${result.artist} — ${result.title}. Only one sample matched; saved details were kept.`); }
    else { recognitionStatus = !clips.length ? 'quiet' : result ? 'conflict' : 'not-found'; notes.push(!clips.length ? 'Audio samples were too quiet for recognition.' : result ? 'Recognition samples disagreed; saved details were kept.' : 'No audio fingerprint match found.'); }
  } catch (error) { signal.throwIfAborted(); recognitionStatus = 'unavailable'; notes.push(error instanceof Error ? error.message : 'Recognition is unavailable.'); }
  signal.throwIfAborted();
  const title = recognition?.confirmed ? recognition.title : details.title, artist = recognition?.confirmed ? recognition.artist : details.artist;
  let hints: LyricHint[] = [], lyricsId: number | undefined, lyricsStatus: LyricsStatus = 'missing-details', lyricsMessage = 'Enter the title and artist, then try Identify & improve again.';
  if (title && artist) {
    stage('Matching timed lyrics to this recording');
    try {
      const result = await online<TimedLyrics | { status: 'plain-only' | 'instrumental' | 'different-version' | 'not-found'; nearestDuration?: number } | null>('timed-lyrics', { title, artist, duration: buffer.duration }, signal);
      if (result && 'syncedLyrics' in result) {
        hints = lyricHints(result, buffer.duration); lyricsId = result.id; lyricsStatus = hints.length ? 'matched' : 'no-clues';
        lyricsMessage = hints.length ? `Timed lyrics matched · ${hints.length} section clues saved for offline use.` : 'Timed lyrics matched but gave no usable section clues.';
      } else {
        lyricsStatus = result?.status ?? 'not-found';
        lyricsMessage = lyricsStatus === 'plain-only' ? 'Lyrics found, but they have no timings. Musical analysis used.' : lyricsStatus === 'instrumental' ? 'The lyric database lists this version as instrumental. Try a matching vocal reference.' : lyricsStatus === 'different-version' ? `Timed lyrics found for a different length (${Math.round(result!.nearestDuration!)}s versus ${Math.round(buffer.duration)}s). Those timings were not used.` : 'No matching timed lyrics after exact lookup and fallback search. Check the title and artist or add a matching vocal reference.';
      }
      notes.push(hints.length ? `Matched timed lyrics supplied ${hints.length} section clues.` : lyricsMessage);
    } catch (error) { signal.throwIfAborted(); lyricsStatus = 'unavailable'; lyricsMessage = error instanceof Error ? error.message : 'Timed lyrics are unavailable.'; notes.push(lyricsMessage); }
  } else notes.push(lyricsMessage);
  return { recognition, recognitionStatus, lyricsStatus, lyricsMessage, lyricsId, hints, duration: buffer.duration, note: notes.join(' '), reference };
}
export function restoreEvidence(value: unknown): PreparationEvidence | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const data = value as PreparationEvidence;
  const kinds = ['Intro', 'Verse', 'Chorus', 'Pre-chorus', 'Bridge', 'Instrumental', 'Ending', 'Section'];
  if (!Number.isFinite(data.duration) || data.duration <= 0 || data.duration > 1200 || typeof data.reference !== 'boolean' || typeof data.note !== 'string' || !Array.isArray(data.hints) || data.hints.length > 80 || data.hints.some(h => !h || !Number.isFinite(h.start) || !Number.isFinite(h.end) || h.start < 0 || h.start >= data.duration || h.end < h.start || h.end > data.duration || !Number.isFinite(h.group) || !kinds.includes(h.kind))) return undefined;
  const match = data.recognition;
  const recognition = match && ['id', 'title', 'artist'].every(key => typeof match[key as keyof typeof match] === 'string' && (match[key as keyof typeof match] as string).length <= 160) && Number.isFinite(match.hits) && typeof match.confirmed === 'boolean' ? { id: match.id, title: match.title, artist: match.artist, hits: match.hits, confirmed: match.confirmed } : undefined;
  const recognitionStatus = ['confirmed', 'possible', 'not-found', 'conflict', 'unavailable', 'quiet'].includes(data.recognitionStatus ?? '') ? data.recognitionStatus : undefined;
  const lyricsStatus = ['matched', 'no-clues', 'plain-only', 'instrumental', 'different-version', 'not-found', 'unavailable', 'missing-details'].includes(data.lyricsStatus ?? '') ? data.lyricsStatus : undefined;
  return { duration: data.duration, reference: data.reference, note: data.note.slice(0, 1000), hints: data.hints.map(h => ({ start: h.start, end: h.end, kind: h.kind, group: h.group, ...(['label', 'repeat', 'paragraph', 'gap'].includes(h.basis ?? '') ? { basis: h.basis } : {}) })), recognition, recognitionStatus, lyricsStatus, lyricsMessage: typeof data.lyricsMessage === 'string' ? data.lyricsMessage.slice(0, 500) : undefined, lyricsId: Number.isFinite(data.lyricsId) ? data.lyricsId : undefined };
}
