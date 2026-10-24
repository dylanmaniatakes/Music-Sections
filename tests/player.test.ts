import test from 'node:test';
import assert from 'node:assert/strict';
import { Player } from '../src/audio';
class MockContext {
  currentTime = 10; destination = {}; sources: any[] = []; resume: () => Promise<void> = async () => {};
  createBuffer(channels: number, length: number, rate: number) { const data = Array.from({ length: channels }, () => new Float32Array(length).fill(0.2)); return { duration: length / rate, length, sampleRate: rate, numberOfChannels: channels, getChannelData: (ch: number) => data[ch] }; }
  createGain() { return { gain: { value: 1, setTargetAtTime() {}, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} }, connect() {}, disconnect() {} }; }
  createBufferSource() { const source = { loop: false, stopped: false, startArgs: [] as number[], onended: null, connect() {}, disconnect() {}, addEventListener() {}, stop() { this.stopped = true; }, start(...args: number[]) { this.startArgs = args; } }; this.sources.push(source); return source; }
}
function setup() { const ctx = new MockContext(); const player = new Player(ctx as unknown as AudioContext); player.setBuffer(ctx.createBuffer(2, 10000, 100) as AudioBuffer); return { ctx, player }; }
test('immediate jump starts at exact saved offset and cancels loops', async () => {
  const { ctx, player } = setup(); await player.play(12, 'loop', { start: 10, end: 20 });
  await player.jump({ id: 'v2', name: 'Verse 2', kind: 'Verse', start: 40 });
  assert.equal(player.mode, 'normal'); assert.deepEqual(ctx.sources.at(-1).startArgs, [10, 40]); assert.equal(player.position, 40);
});
test('repeat once schedules the restart on the audio clock then continues linearly', async () => {
  const { ctx, player } = setup(); await player.play(16, 'once', { start: 10, end: 20 });
  assert.deepEqual(ctx.sources[0].startArgs, [10, 16, 4]); assert.deepEqual(ctx.sources[1].startArgs, [14, 10]);
  ctx.currentTime = 13; assert.equal(player.position, 19); assert.equal(player.displayMode, 'once');
  ctx.currentTime = 15; assert.equal(player.position, 11); assert.equal(player.displayMode, 'once'); assert.equal(player.repeatPass, 1);
  ctx.currentTime = 25; assert.equal(player.position, 21); assert.equal(player.displayMode, 'normal');
});
test('three extra passes finish the current pass, wrap three times, then continue', async () => {
  const { ctx, player } = setup(); await player.play(16, 'once', { start: 10, end: 20 }, 3);
  assert.deepEqual(ctx.sources.map(s => s.startArgs), [[10, 16, 4], [14, 10, 10], [24, 10, 10], [34, 10]]);
  assert.equal(player.repeatPass, 0);
  for (const [clock, position, pass] of [[14, 10, 1], [23, 19, 1], [24, 10, 2], [34, 10, 3], [43, 19, 3]]) {
    ctx.currentTime = clock; assert.equal(player.position, position); assert.equal(player.repeatPass, pass); assert.equal(player.displayMode, 'once');
  }
  ctx.currentTime = 44; assert.equal(player.position, 20); assert.equal(player.repeatPass, 0); assert.equal(player.displayMode, 'normal');
  ctx.currentTime = 49; assert.equal(player.position, 25);
});
test('cancelling counted repeats continues at the heard position and stops all queued passes', async () => {
  const { ctx, player } = setup(); await player.play(16, 'once', { start: 10, end: 20 }, 3);
  const scheduled = [...ctx.sources]; ctx.currentTime = 26;
  await player.setRepeat('normal', 10, 20);
  assert.equal(player.mode, 'normal'); assert.equal(player.position, 12);
  assert.deepEqual(ctx.sources.at(-1).startArgs, [26, 12]); assert.ok(scheduled.every(s => s.stopped));
});
test('the last section repeats its count and then finishes the song', async () => {
  const { ctx, player } = setup(); await player.play(95, 'once', { start: 90, end: 100 }, 2);
  assert.deepEqual(ctx.sources.map(s => s.startArgs), [[10, 95, 5], [15, 90, 10], [25, 90]]);
  ctx.currentTime = 35; assert.equal(player.position, 100); assert.equal(player.displayMode, 'normal');
  ctx.sources.at(-1).onended(); assert.equal(player.playing, false); assert.equal(player.position, 100);
});
test('invalid counts or regions do not interrupt an existing song', async () => {
  const { ctx, player } = setup(); await player.play(40);
  for (const count of [0, -1, 1.5, 21, NaN, Infinity]) await assert.rejects(player.setRepeat('once', 10, 20, count), /extra repeats/);
  await assert.rejects(player.play(16, 'once', { start: 10, end: 101 }, 2), /inside the song/);
  assert.equal(ctx.sources.length, 1); assert.equal(ctx.sources[0].stopped, false); assert.equal(player.position, 40);
});
test('jump, pause, and stop clear every scheduled counted repeat', async () => {
  for (const action of ['jump', 'pause', 'stop']) {
    const { ctx, player } = setup(); await player.play(16, 'once', { start: 10, end: 20 }, 3);
    const scheduled = [...ctx.sources]; ctx.currentTime = 26;
    if (action === 'jump') await player.jump({ id: 'v2', name: 'Verse 2', kind: 'Verse', start: 40 });
    else if (action === 'pause') player.pause(); else player.stop();
    assert.ok(scheduled.every(s => s.stopped)); assert.equal(player.displayMode, 'normal');
    assert.equal(player.position, action === 'jump' ? 40 : action === 'pause' ? 12 : 0);
  }
});
test('loop wraps exact region and disabling it continues from the current point', async () => {
  const { ctx, player } = setup(); await player.play(16, 'loop', { start: 10, end: 20 });
  assert.equal(ctx.sources[0].loop, true); assert.equal(ctx.sources[0].loopStart, 0); assert.equal(ctx.sources[0].loopEnd, 10); assert.deepEqual(ctx.sources[0].startArgs, [10, 6]);
  ctx.currentTime = 15; assert.equal(player.position, 11); ctx.currentTime = 25; assert.equal(player.position, 11);
  await player.setRepeat('normal', 10, 20); assert.equal(ctx.sources.at(-1).loop, false); assert.deepEqual(ctx.sources.at(-1).startArgs, [25, 11]);
});
test('pause retains location, stop resets it, and stop during async resume wins', async () => {
  const { ctx, player } = setup(); await player.play(40); ctx.currentTime = 12; player.pause(); assert.equal(player.position, 42); assert.equal(player.playing, false);
  player.stop(); assert.equal(player.position, 0);
  let resume!: () => void; ctx.resume = () => new Promise(resolve => { resume = resolve; });
  const pending = player.play(10); player.stop(); resume(); await pending; assert.equal(player.playing, false); assert.equal(player.position, 0);
});
