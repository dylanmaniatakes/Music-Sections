/** Read common ID3 title/artist tags without sending the recording anywhere. */
export async function fileMetadata(file: File) {
  const fallback = file.name.replace(/\.[^.]+$/, '').replace(/[_]/g, ' ').replace(/^\d+[ ._-]+/, '').trim() || 'Untitled song';
  const result = { title: fallback, artist: '' };
  const bytes = new Uint8Array(await file.slice(0, 1024 * 1024).arrayBuffer());
  if (String.fromCharCode(...bytes.slice(0, 3)) !== 'ID3' || bytes.length < 10) return result;
  const version = bytes[3]; if (version !== 3 && version !== 4 || bytes[5] & 0xc0) return result;
  let at = 10;
  while (at + 10 <= bytes.length) {
    const key = String.fromCharCode(...bytes.slice(at, at + 4));
    if (!/^[A-Z0-9]{4}$/.test(key)) break;
    const b = bytes.slice(at + 4, at + 8);
    const size = version === 4 ? ((b[0] & 127) << 21) | ((b[1] & 127) << 14) | ((b[2] & 127) << 7) | (b[3] & 127) : new DataView(b.buffer).getUint32(0);
    if (size <= 0 || at + 10 + size > bytes.length) break;
    if (key === 'TIT2' || key === 'TPE1') {
      const value = bytes.slice(at + 10, at + 10 + size); const encoding = value[0];
      const decoder = new TextDecoder(encoding === 3 ? 'utf-8' : encoding === 2 ? 'utf-16be' : encoding === 1 ? 'utf-16' : 'iso-8859-1');
      const text = decoder.decode(value.slice(1)).replace(/\0/g, '').trim().slice(0, 160);
      if (text) result[key === 'TIT2' ? 'title' : 'artist'] = text;
    }
    at += 10 + size;
  }
  return result;
}
