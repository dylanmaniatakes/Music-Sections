import test from 'node:test';
import assert from 'node:assert/strict';
import { lyricHints } from '../src/lyrics';
test('repeated refrains crossing different stanza breaks are found without treating every stanza as a chorus', () => {
  const data = { id: 1, duration: 120, plainLyrics: 'A morning scene\nA winding road\n\nA gentle light\nA steady hand\nA place to rest\nOne extra line\n\nAn evening scene\nAnother road\n\nA gentle light\nA steady hand\n\nA place to rest\nDifferent extra line', syncedLyrics: '[00:05]A morning scene\n[00:10]A winding road\n[00:25]A gentle light\n[00:30]A steady hand\n[00:35]A place to rest\n[00:40]One extra line\n[00:55]An evening scene\n[01:00]Another road\n[01:15]A gentle light\n[01:20]A steady hand\n[01:25]A place to rest\n[01:30]Different extra line' };
  const hints = lyricHints(data, 120), chorus = hints.filter(h => h.kind === 'Chorus');
  assert.deepEqual(chorus.map(h => h.start), [25, 75]);
  assert.equal(chorus[0].group, chorus[1].group);
  assert.ok(hints.some(h => h.kind === 'Verse'));
  assert.ok(hints.some(h => h.start === 40 && h.kind === 'Verse'), 'The different line after the refrain must remain available as a separate clue.');
});
test('contiguous chorus paragraphs are combined into a single passage', () => {
  const data = { id: 1, duration: 120, plainLyrics: '[Verse]\nA morning scene\nA winding road\n\n[Chorus]\nA gentle light\nA steady hand\n\n[Chorus]\nA place to rest\nA welcome home\n\n[Verse]\nAn evening scene\nAnother road', syncedLyrics: '[00:05]A morning scene\n[00:10]A winding road\n[00:25]A gentle light\n[00:30]A steady hand\n[00:35]A place to rest\n[00:40]A welcome home\n[00:55]An evening scene\n[01:00]Another road' };
  const chorus = lyricHints(data, 120).filter(h => h.kind === 'Chorus');
  assert.equal(chorus.length, 1); assert.equal(chorus[0].start, 25); assert.equal(chorus[0].end, 43);
});
test('unique stanzas without repeating passages do not all receive confident verse labels', () => {
  const data = { id: 1, duration: 90, plainLyrics: 'A morning scene\nA winding road\n\nAn evening scene\nA different road\n\nAnother scene\nA distant road', syncedLyrics: '[00:05]A morning scene\n[00:10]A winding road\n[00:25]An evening scene\n[00:30]A different road\n[00:55]Another scene\n[01:00]A distant road' };
  const hints = lyricHints(data, 90);
  assert.equal(hints.length, 3); assert.ok(hints.every(h => h.kind === 'Section'));
});
test('missing stanza breaks keep complete recurring passages together', () => {
  const rows = ['First scene', 'Second scene', 'Carry the light', 'Follow the road', 'Find the way', 'Keep the hope', 'Later scene', 'Final scene', 'Carry the light', 'Follow the road', 'Find the way', 'Keep the hope', 'Closing scene'];
  const starts = [5, 10, 25, 30, 35, 40, 55, 60, 75, 80, 85, 90, 105];
  const data = { id: 1, duration: 120, plainLyrics: rows.join('\n'), syncedLyrics: rows.map((row, i) => `[${Math.floor(starts[i] / 60)}:${String(starts[i] % 60).padStart(2, '0')}]${row}`).join('\n') };
  const hints = lyricHints(data, 120);
  const chorus = hints.filter(h => h.kind === 'Chorus');
  assert.deepEqual(chorus.map(h => h.start), [25, 75]);
  assert.deepEqual(chorus.map(h => h.end), [43, 93]);
  assert.equal(hints.length, 5, JSON.stringify(hints));
  assert.ok(!hints.some(h => [30, 35, 40, 80, 85, 90].includes(h.start)));
});
test('provisional line tails cannot overlap the next timed section', () => {
  const data = { id: 1, duration: 60, plainLyrics: '[Verse]\nFirst scene\nSecond scene\n\n[Chorus]\nCarry the light\nFollow the road', syncedLyrics: '[00:05]First scene\n[00:23]Second scene\n[00:24]Carry the light\n[00:29]Follow the road' };
  const hints = lyricHints(data, 60);
  assert.equal(hints.length, 2); assert.equal(hints[0].end, 24); assert.equal(hints[1].start, 24);
  assert.equal(hints[0].basis, 'label');
});
test('a short first vocal paragraph after an instrumental intro is not pulled back to zero', () => {
  const data = { id: 1, duration: 90, plainLyrics: 'First scene\nSecond scene\n\nMore thoughts\nFurther thoughts\n\nCarry the light\nFollow the road\n\nCarry the light\nFollow the road', syncedLyrics: '[00:09]First scene\n[00:11]Second scene\n[00:14]More thoughts\n[00:16]Further thoughts\n[00:25]Carry the light\n[00:30]Follow the road\n[00:55]Carry the light\n[01:00]Follow the road' };
  const first = lyricHints(data, 90)[0];
  assert.equal(first.start, 9); assert.equal(first.kind, 'Verse');
});
test('an extra verse paragraph before a recurring chorus is not mislabeled as a bridge', () => {
  const blocks = [['First scene', 'First ending'], ['More thoughts', 'More ending'], ['Further thoughts', 'Further ending'], ['Carry the light', 'Follow the road'], ['Later scene', 'Later ending'], ['Later thoughts', 'Later thoughts ending'], ['Carry the light', 'Follow the road']];
  const starts = [9, 11, 14, 16, 19, 21, 25, 31, 41, 43, 46, 49, 57, 63];
  const data = { id: 1, duration: 90, plainLyrics: blocks.map(b => b.join('\n')).join('\n\n'), syncedLyrics: blocks.flat().map((row, i) => `[${Math.floor(starts[i] / 60)}:${String(starts[i] % 60).padStart(2, '0')}]${row}`).join('\n') };
  const hints = lyricHints(data, 90);
  assert.equal(hints.find(h => h.start === 46)?.kind, 'Verse');
  assert.ok(!hints.some(h => h.kind === 'Bridge'));
});
