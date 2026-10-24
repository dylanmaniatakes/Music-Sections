import test from 'node:test';
import assert from 'node:assert/strict';
import { lyricHints, type TimedLyrics } from '../src/lyrics';
import { detect, extract, analyze } from '../src/analysis';
import { demoFile } from '../src/demo';
import { validateSections } from '../src/model';
import { restoreEvidence } from '../src/enrichment';
const lyrics: TimedLyrics = { id: 1, duration: 96, plainLyrics: 'Morning paints the window\nWe begin another day\n\nCarry every kindness\nLet the little lights remain\n\nEvening fills the garden\nWe return along the lane\n\nCarry every kindness\nLet the little lights remain', syncedLyrics: '[00:09.00]Morning paints the window\n[00:15.00]We begin another day\n[00:25.00]Carry every kindness\n[00:31.00]Let the little lights remain\n[00:41.00]Evening fills the garden\n[00:47.00]We return along the lane\n[00:57.00]Carry every kindness\n[01:03.00]Let the little lights remain' };
async function features() {
  const bytes = await demoFile().arrayBuffer(), view = new DataView(bytes), samples = new Float32Array((bytes.byteLength - 44) / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(44 + i * 2, true) / 32768;
  return { features: extract(samples, 16000), samples };
}
test('timed repeated stanzas label separate verses and choruses without retaining text', () => {
  const hints = lyricHints(lyrics, 96);
  assert.deepEqual(hints.map(h => h.kind), ['Verse', 'Chorus', 'Verse', 'Chorus']);
  assert.equal(hints[1].group, hints[3].group);
  assert.ok(!JSON.stringify(hints).includes('kindness'));
  assert.equal(lyricHints(lyrics, 110).length, 0);
});
test('lyric entries snap back to musical pickups and preserve valid ordered markers', async () => {
  const { features: f } = await features();
  const result = detect(f, 0.5, lyricHints(lyrics, 96));
  const chorus = result.sections.filter(s => s.kind === 'Chorus');
  assert.equal(chorus.length, 2);
  assert.ok(Math.abs(chorus[0].start - 24) < 1.2, JSON.stringify(result.sections));
  assert.ok(Math.abs(chorus[1].start - 56) < 1.2);
  assert.deepEqual(chorus.map(s => s.name), ['Chorus 1', 'Chorus 2']);
  assert.ok(result.sections[1].start > 4, 'The opening must not be duplicated into a tiny extra section.');
  validateSections(result.sections.map((s, i) => ({ ...s, id: String(i) })), 96);
});
test('timed lyric hints belong to the reference and map to a delayed backing track', async () => {
  const { features: reference, samples } = await features();
  const shifted = new Float32Array(samples.length + 32000); shifted.set(samples, 32000);
  const result = analyze(extract(shifted, 16000), 0.5, reference, lyricHints(lyrics, 96));
  assert.ok(result.mapped);
  const chorus = result.sections.filter(s => s.kind === 'Chorus');
  assert.ok(Math.abs(chorus[0].start - 26) < 1.5);
  assert.ok(Math.abs(chorus[1].start - 58) < 1.5);
});
test('explicit section labels and repeated timestamps in LRC are supported', () => {
  const input = { ...lyrics, plainLyrics: lyrics.plainLyrics.replace('Morning paints', '[Verse 1]\nMorning paints'), syncedLyrics: lyrics.syncedLyrics.replace('[00:57.00]Carry every kindness\n', '').replace('[00:25.00]', '[00:25.00][00:57.00]') };
  assert.equal(lyricHints(input, 96)[0].kind, 'Verse');
});
test('lyric timestamps that lead or trail the music align in both directions', async () => {
  const { features: f } = await features();
  for (const offset of [-3, 3]) {
    const hints = lyricHints(lyrics, 96).map(h => ({ ...h, start: h.start + offset, end: h.end + offset }));
    const result = detect(f, 0.5, hints);
    for (const start of [8, 24, 40, 56]) assert.ok(result.sections.some(s => Math.abs(s.start - start) < 1.2), `Offset ${offset}, missing ${start}: ${JSON.stringify(result.sections)}`);
    assert.match(result.note, /timings adjusted/);
  }
});
test('paragraph breaks within the same musical verse do not become extra verse buttons', async () => {
  const { features: f } = await features();
  const hints = [
    { start: 8, end: 11, kind: 'Verse', group: 1, basis: 'paragraph' },
    { start: 13, end: 16, kind: 'Verse', group: 2, basis: 'paragraph' },
    { start: 18, end: 21, kind: 'Verse', group: 3, basis: 'paragraph' },
    { start: 24, end: 35, kind: 'Chorus', group: 4, basis: 'repeat' },
    { start: 40, end: 43, kind: 'Verse', group: 5, basis: 'paragraph' },
    { start: 45, end: 49, kind: 'Verse', group: 6, basis: 'paragraph' },
    { start: 56, end: 67, kind: 'Chorus', group: 4, basis: 'repeat' },
  ] as const;
  const result = detect(f, 0.5, [...hints]);
  assert.equal(result.sections.filter(s => s.kind === 'Verse').length, 2, JSON.stringify(result.sections));
  assert.equal(result.sections.filter(s => s.kind === 'Chorus').length, 2);
  assert.match(result.note, /Joined 3/);
});
test('long online lyric blocks cannot erase strong internal musical changes', async () => {
  const { features: f } = await features();
  const result = detect(f, .5, [
    { start: 8, end: 54, kind: 'Verse', group: 1, basis: 'label' },
    { start: 56, end: 70, kind: 'Chorus', group: 2, basis: 'label' },
    { start: 72, end: 94, kind: 'Bridge', group: 3, basis: 'label' },
  ]);
  for (const start of [24, 40]) assert.ok(result.sections.some(s => Math.abs(s.start - start) < 1.2), `Hidden change at ${start}: ${JSON.stringify(result.sections)}`);
  assert.match(result.note, /Kept .* strong musical/);
});
test('backups retain timing clue strength and still accept older saved clues', () => {
  const hints = lyricHints(lyrics, 96);
  const evidence = { duration: 96, reference: false, hints, note: 'Test' };
  assert.deepEqual(restoreEvidence(evidence)?.hints, hints);
  assert.ok(restoreEvidence({ ...evidence, hints: hints.map(({ basis, ...hint }) => hint) }));
  assert.equal(restoreEvidence({ ...evidence, hints: [{ ...hints[0], basis: 'untrusted-value' }] })?.hints[0].basis, undefined);
});
test('long distinct verses are retained even when the accompaniment has no musical change', () => {
  const f = { frames: Array.from({ length: 400 }, () => Float32Array.from([1, 0, 0])), chroma: Array.from({ length: 400 }, () => new Float32Array(12)), energy: new Array(400).fill(.3), step: .25, duration: 100 };
  const result = detect(f, .5, [5, 35, 65].map((start, i) => ({ start, end: start + 27, kind: 'Verse', group: i, basis: 'paragraph' })));
  assert.deepEqual(result.sections.filter(s => s.kind === 'Verse').map(s => s.start), [5, 35, 65]);
  assert.match(result.note, /0 of 3 starts/);
});
