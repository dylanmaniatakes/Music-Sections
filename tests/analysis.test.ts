import test from 'node:test';
import assert from 'node:assert/strict';
import { extract, detect, align } from '../src/analysis';
import { demoFile } from '../src/demo';
import { validateSections, parseTime } from '../src/model';
async function demoSamples() {
  const bytes = await demoFile().arrayBuffer(); const view = new DataView(bytes); const samples = new Float32Array((bytes.byteLength - 44) / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(44 + i * 2, true) / 32768;
  return samples;
}
test('quiet audio stays as one section', () => {
  const result = detect(extract(new Float32Array(16000 * 30), 16000));
  assert.equal(result.sections.length, 1); assert.match(result.note, /silent/);
});
test('synthetic arrangement finds real changes without arbitrary equal-length chopping', async () => {
  const result = detect(extract(await demoSamples(), 16000));
  const expected = [8, 24, 40, 56, 72, 88];
  assert.ok(result.sections.length >= 5, JSON.stringify(result));
  for (const start of expected) assert.ok(result.sections.some(section => Math.abs(section.start - start) < 1.6), `No boundary near ${start}: ${JSON.stringify(result.sections)}`);
  validateSections(result.sections.map((section, i) => ({ ...section, id: String(i) })), 96);
});
test('reference alignment maps a delayed matching recording', async () => {
  const samples = await demoSamples(); const shifted = new Float32Array(samples.length + 16000 * 2); shifted.set(samples, 32000);
  const ref = extract(samples, 16000), target = extract(shifted, 16000);
  const result = align(ref, target);
  assert.ok(result.match > 0.9);
  for (const start of [8, 24, 40, 56, 72, 88]) assert.ok(Math.abs(result.mapping[Math.round(start / ref.step)] - (start + 2)) < 1.5, `Bad alignment at ${start}`);
});
test('invalid marker data and malformed times are rejected', () => {
  assert.equal(parseTime('1:23.45'), 83.45); assert.equal(parseTime('0:99'), null); assert.equal(parseTime('abc'), null);
  assert.throws(() => validateSections([{ id: 'a', name: 'A', kind: 'Section', start: 0 }, { id: 'b', name: 'B', kind: 'Section', start: -2 }], 30));
  assert.throws(() => validateSections([{ id: 'a', name: 'A', kind: 'Section', start: 1 }], 30));
});
