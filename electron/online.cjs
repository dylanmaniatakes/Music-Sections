const { DecodedSignature } = require('shazamio-core');
const { randomUUID } = require('node:crypto');
const agent = 'MusicSections/0.2.3 (local song preparation)';
const cache = new Map();
let recognizing = false;
async function recognizeSong(input) {
  if (!input || !Array.isArray(input.clips) || input.clips.length < 1 || input.clips.length > 3) throw new Error('Invalid recognition samples.');
  const clips = input.clips.map(clip => {
    if (!Array.isArray(clip) || clip.length < 16000 || clip.length > 192000 || clip.some(n => !Number.isFinite(n) || Math.abs(n) > 1.01)) throw new Error('Invalid recognition samples.');
    return Float32Array.from(clip);
  });
  if (recognizing) throw new Error('Recognition is already running. Try again shortly.');
  recognizing = true;
  try {
    const matches = new Map(), seen = new Set(); let lastError;
    for (const clip of clips) {
      const signature = DecodedSignature.new(clip, 16000, 1);
      let uri, samplems;
      try { uri = signature.uri; samplems = signature.samplems; } finally { signature.free(); }
      if (seen.has(uri)) continue;
      seen.add(uri);
      let result = cache.get(uri);
      if (!result) {
        const endpoint = new URL(`https://amp.shazam.com/discovery/v5/en/US/android/-/tag/${randomUUID().toUpperCase()}/${randomUUID().toUpperCase()}`);
        endpoint.search = new URLSearchParams({ sync: 'true', webv3: 'true', sampling: 'true', connected: '', shazamapiversion: 'v3', sharehub: 'true', video: 'v3' }).toString();
        try {
          const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'Shazam/14.1.0 (iPhone; iOS 17.0)', 'X-Shazam-Platform': 'IPHONE', 'X-Shazam-AppVersion': '14.1.0', 'Accept-Language': 'en' }, body: JSON.stringify({ signature: { uri, samplems }, timestamp: Date.now(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, context: {}, geolocation: {} }), signal: AbortSignal.timeout(12000) });
          if (!response.ok) { lastError = new Error(response.status === 429 ? 'Song recognition is busy. Try again later.' : 'Song recognition is unavailable. Using the saved song details and local analysis.'); if (response.status < 500) break; continue; }
          result = await response.json();
          // A temporary miss must not make all later attempts on this recording miss forever.
          if (Array.isArray(result.matches) && result.matches.length) {
            if (cache.size >= 40) cache.delete(cache.keys().next().value);
            cache.set(uri, result);
          }
        } catch { lastError = new Error('Song recognition could not connect. Using the saved song details and local analysis.'); continue; }
      }
      const track = result.matches?.length ? result.track : undefined;
      if (track && typeof track.key === 'string' && clean(track.title) && clean(track.subtitle)) {
        // Providers may use different recording IDs for the same named song on different releases.
        const identity = `${normalize(track.title)}|${normalize(track.subtitle)}`;
        const found = matches.get(identity) || { id: track.key.slice(0, 100), title: track.title.slice(0, 160), artist: track.subtitle.slice(0, 160), hits: 0 };
        found.hits++; matches.set(identity, found);
        if (found.hits >= 2) return { ...found, confirmed: true };
      }
    }
    if (matches.size > 1) return { conflict: true };
    const match = [...matches.values()][0];
    if (!match && lastError) throw lastError;
    return match ? { ...match, confirmed: false } : null;
  } finally { recognizing = false; }
}
const clean = text => typeof text === 'string' && text.trim().length > 0 && text.length <= 160;
const normalize = text => text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/&/g, 'and').replace(/[^\p{L}\p{N}]/gu, '');
async function timedLyrics(input) {
  if (!input || !clean(input.title) || !clean(input.artist) || !Number.isFinite(input.duration) || input.duration < 1 || input.duration > 1200) throw new Error('Set the song title and artist before looking for timed lyrics.');
  const endpoint = new URL('https://lrclib.net/api/get');
  endpoint.search = new URLSearchParams({ track_name: input.title.trim(), artist_name: input.artist.trim(), duration: String(Math.round(input.duration)) }).toString();
  const request = async url => {
    const response = await fetch(url, { headers: { 'User-Agent': agent, Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('Timed lyrics are unavailable. Using musical changes instead.');
    return response.json();
  };
  const sameSong = result => result && typeof result.trackName === 'string' && typeof result.artistName === 'string' && normalize(result.trackName) === normalize(input.title) && normalize(result.artistName) === normalize(input.artist) && Number.isFinite(result.duration);
  const hasTiming = result => !result.instrumental && typeof result.syncedLyrics === 'string' && result.syncedLyrics.trim().length > 0 && result.syncedLyrics.length <= 100000;
  const pack = result => ({ id: Number(result.id), duration: result.duration, syncedLyrics: result.syncedLyrics, plainLyrics: typeof result.plainLyrics === 'string' ? result.plainLyrics.slice(0, 100000) : '' });
  const exact = await request(endpoint);
  if (sameSong(exact) && Math.abs(exact.duration - input.duration) <= 2 && hasTiming(exact)) return pack(exact);
  const search = new URL('https://lrclib.net/api/search');
  search.search = new URLSearchParams({ track_name: input.title.trim(), artist_name: input.artist.trim() }).toString();
  const results = await request(search);
  const candidates = [exact, ...(Array.isArray(results) ? results.slice(0, 100) : [])].filter(sameSong).sort((a, b) => Math.abs(a.duration - input.duration) - Math.abs(b.duration - input.duration));
  const usable = candidates.find(result => Math.abs(result.duration - input.duration) <= 2 && hasTiming(result));
  if (usable) return pack(usable);
  const matching = candidates.filter(result => Math.abs(result.duration - input.duration) <= 2);
  if (matching.some(result => typeof result.plainLyrics === 'string' && result.plainLyrics.trim())) return { status: 'plain-only' };
  if (matching.some(result => result.instrumental)) return { status: 'instrumental' };
  const nearest = candidates.find(hasTiming);
  if (nearest) return { status: 'different-version', nearestDuration: nearest.duration };
  return { status: 'not-found' };
}
module.exports = { recognizeSong, timedLyrics };
