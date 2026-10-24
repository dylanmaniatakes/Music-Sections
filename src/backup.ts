import { zip, unzip, strToU8, strFromU8 } from 'fflate';
import type { Song } from './model';
import { validateSections } from './model';
import { restoreEvidence } from './enrichment';
export async function exportSong(song: Song) {
  const { audio, reference, ...meta } = song;
  if (audio.size + (reference?.size ?? 0) > 299 * 1024 * 1024) throw new Error('The audio and reference exceed the 300 MB backup limit. Remove the reference or use smaller audio files before exporting.');
  const payload: Record<string, Uint8Array> = { 'song.json': strToU8(JSON.stringify({ version: 1, song: meta, audioType: audio.type, referenceType: reference?.type }, null, 2)), 'audio': new Uint8Array(await audio.arrayBuffer()) };
  if (reference) payload.reference = new Uint8Array(await reference.arrayBuffer());
  const packed = await new Promise<Uint8Array>((resolve, reject) => zip(payload, { level: 0 }, (error, data) => error ? reject(error) : resolve(data)));
  const blob = new Blob([packed as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `${song.title.replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 80) || 'song'}.musicsections`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export async function importSong(file: File): Promise<Song> {
  if (file.size > 300 * 1024 * 1024) throw new Error('This backup is too large. Maximum size is 300 MB.');
  const data = new Uint8Array(await file.arrayBuffer());
  // Our backups are uncompressed ZIPs. Reject compressed/unexpected ZIP entries before allocation
  // to avoid a crafted archive expanding into an unbounded amount of memory.
  const unpacked = await new Promise<Record<string, Uint8Array>>((resolve, reject) => unzip(data, { filter: entry => {
    if (!['song.json', 'audio', 'reference'].includes(entry.name) || entry.originalSize > 250 * 1024 * 1024 || entry.compression !== 0) return false;
    return true;
  } }, (error, files) => error ? reject(new Error('This is not a valid Music Sections backup.')) : resolve(files)));
  if (!unpacked['song.json'] || unpacked['song.json'].length > 1024 * 1024 || !unpacked.audio) throw new Error('The backup is missing song information or audio.');
  const envelope = JSON.parse(strFromU8(unpacked['song.json']));
  if (envelope.version !== 1) throw new Error('This backup format is not supported.');
  const meta = envelope.song;
  if (!meta || typeof meta.title !== 'string' || typeof meta.artist !== 'string' || typeof meta.filename !== 'string' || !Array.isArray(meta.sections)) throw new Error('The backup contains invalid song information.');
  validateSections(meta.sections, meta.duration);
  return { id: crypto.randomUUID(), title: meta.title.slice(0, 160), artist: meta.artist.slice(0, 160), filename: meta.filename.slice(0, 255), duration: meta.duration, sections: meta.sections, reviewed: Boolean(meta.reviewed), created: Date.now(), audio: new Blob([unpacked.audio as Uint8Array<ArrayBuffer>], { type: typeof envelope.audioType === 'string' ? envelope.audioType : '' }), peaks: [], preparation: restoreEvidence(meta.preparation), reference: unpacked.reference ? new Blob([unpacked.reference as Uint8Array<ArrayBuffer>], { type: typeof envelope.referenceType === 'string' ? envelope.referenceType : '' }) : undefined, referenceName: typeof meta.referenceName === 'string' ? meta.referenceName.slice(0, 255) : undefined, analysisNote: typeof meta.analysisNote === 'string' ? meta.analysisNote.slice(0, 1000) : undefined };
}
