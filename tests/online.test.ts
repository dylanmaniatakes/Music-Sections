import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { recognizeSong, timedLyrics } = createRequire(import.meta.url)('../electron/online.cjs');
const clip = (frequency: number) => Array.from({ length: 16000 * 12 }, (_, i) => {
  const t = i / 16000, note = frequency * 2 ** ((Math.floor(t * 3) % 7) / 12), envelope = Math.exp(-((t * 3) % 1) * 4);
  return (Math.sin(t * note * Math.PI * 2) + Math.sin(t * note * 3 * Math.PI * 2) * 0.4 + Math.sin(t * note * 5 * Math.PI * 2) * 0.2) * 0.4 * envelope;
});
test('recognition sends only fingerprints, confirms agreement, and rejects conflicts', async () => {
  const original = globalThis.fetch; const bodies: any[] = []; let calls = 0;
  globalThis.fetch = (async (_url: unknown, options: any) => {
    bodies.push(JSON.parse(options.body)); calls++;
    return Response.json({ matches: [{}], track: { key: calls > 2 ? `different-${calls}` : 'matching-id', title: calls > 2 ? `Different song ${calls}` : 'Sample recording', subtitle: 'Sample artist' } });
  }) as typeof fetch;
  try {
    const match = await recognizeSong({ clips: [clip(440), clip(620), clip(900)] });
    assert.equal(match.confirmed, true); assert.equal(match.hits, 2); assert.equal(calls, 2);
    for (const body of bodies) { assert.ok(body.signature.uri.startsWith('data:audio/vnd.shazam.sig;base64,')); assert.ok(!('clips' in body)); assert.ok(!('audio' in body)); }
    const conflict = await recognizeSong({ clips: [clip(770), clip(1010)] });
    assert.equal(conflict.conflict, true);
    await assert.rejects(recognizeSong({ clips: [[NaN]] }), /Invalid/);
  } finally { globalThis.fetch = original; }
});
test('lyrics refuse alternate durations or artists and handle a missing recording', async () => {
  const original = globalThis.fetch;
  const details = { title: 'Sample recording', artist: 'Sample artist', duration: 96 };
  try {
    globalThis.fetch = (async () => Response.json({ id: 1, trackName: details.title, artistName: details.artist, duration: 108, syncedLyrics: '[00:01.00]invented' })) as typeof fetch;
    assert.equal((await timedLyrics(details)).status, 'different-version');
    globalThis.fetch = (async () => Response.json({ id: 1, trackName: details.title, artistName: 'Someone else', duration: 96, syncedLyrics: '[00:01.00]invented' })) as typeof fetch;
    assert.equal((await timedLyrics(details)).status, 'not-found');
    globalThis.fetch = (async () => new Response('', { status: 404 })) as typeof fetch;
    assert.equal((await timedLyrics(details)).status, 'not-found');
    globalThis.fetch = (async () => Response.json({ id: 1, trackName: details.title, artistName: details.artist, duration: 96, syncedLyrics: '[00:01.00]invented', plainLyrics: 'invented' })) as typeof fetch;
    assert.equal((await timedLyrics(details)).id, 1);
  } finally { globalThis.fetch = original; }
});
test('fallback finds timed lyrics among releases while refusing timings from a different version', async () => {
  const original = globalThis.fetch; const urls: string[] = [];
  const row = { id: 12, trackName: 'Sample recording', artistName: 'Sample artist', duration: 96, syncedLyrics: '[00:01.00]invented', plainLyrics: 'invented' };
  try {
    globalThis.fetch = (async (url: unknown) => {
      urls.push(String(url));
      return String(url).includes('/api/get?') ? new Response('', { status: 404 }) : Response.json([{ ...row, id: 10, duration: 110 }, { ...row, id: 11, syncedLyrics: null }, row]);
    }) as typeof fetch;
    const result = await timedLyrics({ title: row.trackName, artist: row.artistName, duration: 96 });
    assert.equal(result.id, 12); assert.equal(urls.length, 2); assert.match(urls[1], /api\/search/);
    const different = await timedLyrics({ title: row.trackName, artist: row.artistName, duration: 120 });
    assert.equal(different.status, 'different-version'); assert.equal(different.nearestDuration, 110); assert.ok(!('syncedLyrics' in different));
    const plain = await timedLyrics({ title: row.trackName, artist: row.artistName, duration: 96.5 });
    assert.equal(plain.id, 12);
  } finally { globalThis.fetch = original; }
});
test('plain lyrics, instrumental entries, and Unicode artist mismatches are distinguished', async () => {
  const original = globalThis.fetch;
  const details = { title: 'Test song', artist: 'Sample artist', duration: 96 };
  const row = { id: 1, trackName: details.title, artistName: details.artist, duration: 96, plainLyrics: 'invented', syncedLyrics: null };
  try {
    globalThis.fetch = (async () => Response.json(row)) as typeof fetch;
    assert.equal((await timedLyrics(details)).status, 'plain-only');
    globalThis.fetch = (async () => Response.json({ ...row, plainLyrics: '', instrumental: true })) as typeof fetch;
    assert.equal((await timedLyrics(details)).status, 'instrumental');
    globalThis.fetch = (async () => Response.json({ ...row, artistName: '北京', syncedLyrics: '[00:01.00]invented' })) as typeof fetch;
    assert.equal((await timedLyrics({ ...details, artist: '东京' })).status, 'not-found');
  } finally { globalThis.fetch = original; }
});
test('a failed middle sample retains matches and alternate release IDs can confirm the same song', async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = (async () => {
    calls++; if (calls === 2) return new Response('', { status: 503 });
    return Response.json({ matches: [{}], track: { key: `release-${calls}`, title: 'Agreement test song', subtitle: 'Agreement test artist' } });
  }) as typeof fetch;
  try {
    const result = await recognizeSong({ clips: [clip(275), clip(380), clip(1080)] });
    assert.equal(result.confirmed, true); assert.equal(result.hits, 2); assert.equal(calls, 3);
  } finally { globalThis.fetch = original; }
});
test('temporary recognition misses are not cached and duplicate fingerprints do not confirm a song', async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = (async () => {
    calls++; return calls === 1 ? Response.json({ matches: [] }) : Response.json({ matches: [{}], track: { key: 'retry', title: 'Retry test song', subtitle: 'Retry test artist' } });
  }) as typeof fetch;
  try {
    const input = clip(1550);
    assert.equal(await recognizeSong({ clips: [input] }), null);
    const result = await recognizeSong({ clips: [input, input] });
    assert.equal(result.confirmed, false); assert.equal(result.hits, 1); assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});
