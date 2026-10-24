import type { SectionKind } from './model';
export type LyricHint = { start: number; end: number; kind: SectionKind; group: number; basis?: 'label' | 'repeat' | 'paragraph' | 'gap' };
export type TimedLyrics = { id: number; duration: number; syncedLyrics: string; plainLyrics: string };
const normalize = (text: string) => text.toLowerCase().replace(/\[[^\]]+\]/g, '').replace(/[^\p{L}\p{N}]/gu, '');
type TimedLine = { start: number; text: string };
function recurringPassage(lines: TimedLine[]) {
  let best: { length: number; positions: number[]; score: number } | undefined;
  const pairs = new Map<string, number[]>();
  for (let i = 0; i < lines.length - 1; i++) { const key = `${lines[i].text}|${lines[i + 1].text}`; const indexes = pairs.get(key) ?? []; indexes.push(i); pairs.set(key, indexes); }
  for (const indexes of pairs.values()) for (let a = 0; a < indexes.length; a++) for (let b = a + 1; b < indexes.length; b++) {
    const i = indexes[a], j = indexes[b];
    if (lines[j].start - lines[i].start < 18 || (i && lines[i - 1].text === lines[j - 1].text)) continue;
    let length = 0;
    while (length < 32 && i + length < j && j + length < lines.length && lines[i + length].text === lines[j + length].text) length++;
    if (length < 3) continue;
    const positions = indexes.filter(at => at + length <= lines.length && lines.slice(i, i + length).every((line, k) => lines[at + k].text === line.text));
    const separated: number[] = [];
    for (const at of positions) if (!separated.length || lines[at].start - lines[separated.at(-1)!].start >= 18) separated.push(at);
    const score = length * separated.length;
    if (separated.length >= 2 && (!best || score > best.score)) best = { length, positions: separated, score };
  }
  return best;
}
/** Reduce lyrics to timing/section clues; the app does not save or display the lyric text. */
export function lyricHints(data: TimedLyrics, duration: number): LyricHint[] {
  if (Math.abs(data.duration - duration) > 2) return [];
  const lines: TimedLine[] = [];
  for (const line of data.syncedLyrics.split('\n')) {
    const text = normalize(line);
    if (!text) continue;
    for (const match of line.matchAll(/\[(\d+):([0-5]?\d(?:\.\d+)?)\]/g)) {
      const start = Number(match[1]) * 60 + Number(match[2]);
      if (start >= 0 && start < duration) lines.push({ start, text });
    }
  }
  lines.sort((a, b) => a.start - b.start);
  if (lines.length < 4 || lines.length > 1000) return [];
  const recurring = recurringPassage(lines);
  const blocks: { start: number; end: number; text: string; count: number; explicit?: SectionKind; gap?: boolean }[] = [];
  let cursor = 0;
  for (const paragraph of data.plainLyrics.split(/\n\s*\n/)) {
    const rows = paragraph.split('\n').filter(row => row.trim() && !/^\s*\[[^\]]+\]\s*$/.test(row)).map(normalize).filter(Boolean);
    if (!rows.length) continue;
    const at = lines.findIndex((line, i) => i >= cursor && line.text === rows[0]);
    if (at < 0 || rows.some((row, j) => lines[at + j]?.text !== row)) continue;
    const label = paragraph.match(/\[(pre[- ]?chorus|chorus|verse|bridge|intro|outro|instrumental)[^\]]*\]/i)?.[1].toLowerCase();
    const explicit: SectionKind | undefined = label?.startsWith('pre') ? 'Pre-chorus' : label === 'outro' ? 'Ending' : label ? (label[0].toUpperCase() + label.slice(1)) as SectionKind : undefined;
    blocks.push({ start: lines[at].start, end: Math.min(duration, lines[at + rows.length - 1].start + 3), text: rows.join('|'), count: rows.length, explicit }); cursor = at + rows.length;
  }
  // Missing stanza breaks do not make every repeated line a separate section.
  // Use complete recurring passages and vocal gaps, preserving all text for comparison.
  if (blocks.length < 2) {
    blocks.length = 0;
    const starts = new Set<number>([0]);
    for (const at of recurring?.positions ?? []) { starts.add(at); if (at + recurring!.length < lines.length) starts.add(at + recurring!.length); }
    for (let i = 1; i < lines.length; i++) if (lines[i].start - lines[i - 1].start > 12) starts.add(i);
    const sorted = [...starts].sort((a, b) => a - b);
    sorted.forEach((at, i) => { const rows = lines.slice(at, sorted[i + 1] ?? lines.length); blocks.push({ start: rows[0].start, end: Math.min(duration, rows.at(-1)!.start + 3), text: rows.map(row => row.text).join('|'), count: rows.length, gap: true }); });
  }
  if (blocks.length < 2 || blocks.length > 80) return [];
  const keys = [...new Set(blocks.map(b => b.text))];
  const repeated = keys.filter(key => blocks.filter(b => b.text === key).length >= 2 && blocks.find(b => b.text === key)!.count >= 2);
  const chorus = repeated.sort((a, b) => {
    const score = (key: string) => blocks.filter(block => block.text === key).length * Math.min(8, blocks.find(block => block.text === key)!.count);
    return score(b) - score(a);
  })[0];
  // Refrains can repeat across stanza breaks or with an extra line added to one occurrence.
  // Whole-paragraph equality alone misses those recurring passages.
  let refrain: LyricHint[] = [];
  if (recurring && !blocks.some(block => block.explicit === 'Chorus') && (!chorus || blocks.find(block => block.text === chorus)!.count < 3)) {
    refrain = recurring.positions.map(at => ({ start: lines[at].start, end: Math.min(duration, lines[at + recurring.length - 1].start + 3, (lines[at + recurring.length]?.start ?? duration) - 0.01), kind: 'Chorus', group: 1000, basis: 'repeat' }));
  }
  const hints: LyricHint[] = blocks.map((block, i) => {
    let kind: SectionKind = block.explicit ?? (chorus || refrain.length ? 'Verse' : 'Section');
    if (!block.explicit) {
      if (block.text === chorus) kind = 'Chorus';
      else if (repeated.includes(block.text) && blocks[i + 1]?.text === chorus) kind = 'Pre-chorus';
      else if (i === 0 && block.start < 4 && block.count <= 2 && blocks[1].start - block.start < 12) kind = 'Intro';
      // Unique text before the last chorus is not enough evidence for a bridge.
      // In particular, extra verse paragraphs must not change the song's structure.
    }
    return { start: block.start, end: block.end, kind, group: keys.indexOf(block.text) + 100, basis: block.explicit ? 'label' : ['Chorus', 'Pre-chorus'].includes(kind) ? 'repeat' : block.gap ? 'gap' : 'paragraph' };
  });
  const retained: LyricHint[] = [];
  for (const hint of hints) {
    const run = refrain.find(run => hint.start >= run.start - 0.1 && hint.start < run.end);
    if (!run) retained.push(hint);
    else if (hint.end > run.end) {
      const remainder = lines.find(line => line.start >= run.end && line.start < hint.end);
      if (remainder) retained.push({ ...hint, start: remainder.start });
    }
  }
  const combined = [...retained, ...refrain].sort((a, b) => a.start - b.start);
  const merged: LyricHint[] = [];
  for (const hint of combined) {
    const previous = merged.at(-1);
    if (previous?.kind === 'Chorus' && hint.kind === 'Chorus' && hint.start - previous.end <= 8) previous.end = Math.max(previous.end, hint.end);
    else merged.push(hint);
  }
  // A line's provisional tail must never cover the next section's entry.
  return merged.slice(0, 80).map((hint, i) => ({ ...hint, end: Math.max(hint.start, Math.min(hint.end, merged[i + 1]?.start ?? duration)) }));
}
