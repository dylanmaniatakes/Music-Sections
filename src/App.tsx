import { useEffect, useRef, useState } from 'react';
import { Music2, Plus, Play, Pause, Square, Repeat, Repeat1, Upload, Download, ChevronRight, ChevronLeft, Search, X, Check, SlidersHorizontal, Radio, Headphones, Pencil, Trash2, CircleHelp, FolderOpen, LoaderCircle, Volume2, Sparkles, ListMusic, Keyboard, ArrowLeft, CheckCheck } from 'lucide-react';
import { Player, waveform, monoForAnalysis, MAX_SECTION_REPEATS, type PlaybackMode } from './audio';
import { type Song, type Section, type SectionKind, currentSection, sectionEnd, time, parseTime, validateSections, sectionKinds } from './model';
import { listSongs, saveSong, deleteSong } from './storage';
import { demoFile } from './demo';
import { fileMetadata } from './metadata';
import { exportSong, importSong } from './backup';
import { Waveform } from './Waveform';
import type { AnalysisResult } from './analysis';
import { enrich, type PreparationEvidence } from './enrichment';
function errorText(error: unknown) { return error instanceof Error ? error.message : 'Something went wrong. Please try again.'; }
type Lookup = { id: string; title: string; length?: number; 'artist-credit'?: { name: string }[] };
function PreparationStatus({ evidence }: { evidence: PreparationEvidence }) {
  const match = evidence.recognition;
  const recognition = match?.confirmed ? `Identified: ${match.artist} — ${match.title}.` : match ? `Possible match: ${match.artist} — ${match.title}. Only one sample matched.` : evidence.recognitionStatus === 'unavailable' ? 'Recognition service could not complete the lookup. Try again later, or enter the title and artist.' : evidence.recognitionStatus === 'conflict' ? 'Samples returned different songs. Saved details were kept.' : evidence.recognitionStatus === 'quiet' ? 'Samples were too quiet to recognize.' : 'No audio fingerprint match. A backing track or alternate recording may need its matching vocal reference.';
  const lyrics = evidence.lyricsMessage ?? (evidence.lyricsId ? evidence.hints.length ? `Timed lyrics matched · ${evidence.hints.length} section clues saved for offline use.` : 'Timed lyrics matched but gave no usable section clues.' : 'No matching timed lyric sections. Musical analysis used.');
  return <div className="preparation-status" role="status"><p><strong>Song recognition</strong><span>{recognition}</span></p><p><strong>Timed lyrics</strong><span>{lyrics}</span></p></div>;
}
function BoundaryEditor({ section, min, max, onChange }: { section: Section; min: number; max: number; onChange: (start: number) => void }) {
  const [text, setText] = useState(time(section.start, true)); const [invalid, setInvalid] = useState(false);
  useEffect(() => { setText(time(section.start, true)); setInvalid(false); }, [section.id, section.start]);
  function commit() { const value = parseTime(text); if (value === null || value < min || value > max) { setInvalid(true); return; } setInvalid(false); onChange(value); }
  return <div className="boundary-input"><label htmlFor="section-start">Starts at</label><input id="section-start" aria-invalid={invalid} disabled={section.start === 0} value={text} onChange={e => setText(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit(); }}/>{invalid && <small className="error-text">Use a time between {time(min, true)} and {time(max, true)}.</small>}</div>;
}
export default function App() {
  const [player] = useState(() => new Player());
  const [library, setLibrary] = useState<Song[]>([]);
  const [song, setSong] = useState<Song | null>(null); const songRef = useRef(song); songRef.current = song;
  const [view, setView] = useState<'prepare' | 'perform'>('prepare');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [position, setPosition] = useState(0); const [playing, setPlaying] = useState(false); const [mode, setMode] = useState<PlaybackMode>('normal');
  const [repeatCount, setRepeatCount] = useState(() => {
    const saved = Number(localStorage.getItem('music-sections-repeat-count'));
    return Number.isInteger(saved) && saved >= 1 && saved <= MAX_SECTION_REPEATS ? saved : 1;
  });
  const [repeatPass, setRepeatPass] = useState(0);
  const [saving, setSaving] = useState(0); const [saveFailed, setSaveFailed] = useState(false);
  const [volume, setVolume] = useState(0.7); const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(''); const [progress, setProgress] = useState(0); const [notice, setNotice] = useState(''); const [error, setError] = useState('');
  const [help, setHelp] = useState(false); const [lookupOpen, setLookupOpen] = useState(false); const [query, setQuery] = useState(''); const [lookupResults, setLookupResults] = useState<Lookup[] | null>(null); const [lookupBusy, setLookupBusy] = useState(false); const [lookupError, setLookupError] = useState('');
  const [sensitivity, setSensitivity] = useState(0.5); const [useReference, setUseReference] = useState(true);
  const [onlinePreparation, setOnlinePreparation] = useState(() => {
    // Older builds defaulted online help off. Apply the new default once, preserving later choices.
    if (localStorage.getItem('music-sections-online-default') !== '1') {
      localStorage.setItem('music-sections-online-default', '1'); localStorage.setItem('music-sections-online', 'true');
    }
    return localStorage.getItem('music-sections-online') !== 'false';
  });
  const pendingOnline = useRef(false); const preparationController = useRef<AbortController | null>(null);
  const [confirm, setConfirm] = useState<'delete-song' | 'analyze' | null>(null);
  const importInput = useRef<HTMLInputElement>(null); const referenceInput = useRef<HTMLInputElement>(null); const backupInput = useRef<HTMLInputElement>(null);
  const worker = useRef<Worker | null>(null); const operation = useRef(0); const lookupVersion = useRef(0);
  const current = song ? currentSection(song.sections, position) : 0;
  const active = song?.sections[current]; const selectedIndex = song?.sections.findIndex(s => s.id === selectedId) ?? -1;
  const selected = song?.sections[selectedIndex];
  const selectedEnd = song && selected ? sectionEnd(song.sections, selectedIndex, song.duration) : 0;
  useEffect(() => {
    listSongs().then(songs => setLibrary(songs.sort((a, b) => b.created - a.created))).catch(e => setError(errorText(e)));
    player.setVolume(0.7);
    let frame: number;
    const tick = () => { setPosition(player.position); setPlaying(player.playing); setMode(player.displayMode); setRepeatPass(player.repeatPass); frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); player.stop(); worker.current?.terminate(); };
  }, [player]);
  useEffect(() => { player.setVolume(volume); }, [volume, player]);
  useEffect(() => { localStorage.setItem('music-sections-repeat-count', String(repeatCount)); }, [repeatCount]);
  useEffect(() => { if (!notice) return; const id = setTimeout(() => setNotice(''), 5000); return () => clearTimeout(id); }, [notice]);
  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      const element = event.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName) || element.isContentEditable || event.ctrlKey || event.altKey || event.metaKey || help || lookupOpen || confirm || busy || !song) return;
      if (event.code === 'Space') { event.preventDefault(); togglePlay(); }
      else if (event.key === 'Escape') { event.preventDefault(); player.stop(); }
      else if (/^[1-9]$/.test(event.key)) { const section = song.sections[Number(event.key) - 1]; if (section) { event.preventDefault(); run(() => player.jump(section)); } }
      else if (event.key.toLowerCase() === 'l') { event.preventDefault(); toggleRepeat('loop'); }
      else if (event.key.toLowerCase() === 'r') { event.preventDefault(); toggleRepeat('once'); }
    }
    window.addEventListener('keydown', keyboard); return () => window.removeEventListener('keydown', keyboard);
  });
  useEffect(() => {
    if (!help && !lookupOpen && !confirm) return;
    const previous = document.activeElement as HTMLElement | null;
    const modal = document.querySelector<HTMLElement>('.modal'); if (!modal) return;
    const focusable = () => [...modal.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]')];
    const first = focusable()[0]; first?.focus();
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    function handle(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); setHelp(false); setLookupOpen(false); lookupVersion.current++; setLookupBusy(false); setConfirm(null); }
      if (event.key === 'Tab') { const items = focusable(), first = items[0], last = items.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }
    }
    document.addEventListener('keydown', handle);
    return () => { document.removeEventListener('keydown', handle); document.body.style.overflow = overflow; previous?.focus(); };
  }, [help, lookupOpen, confirm]);
  async function run(action: () => unknown | Promise<unknown>) { try { await action(); } catch (e) { setError(errorText(e)); } }
  async function persist(next: Song) {
    await saveSong(next); setLibrary(previous => [next, ...previous.filter(s => s.id !== next.id)].sort((a, b) => b.created - a.created));
  }
  async function updateSong(patch: Partial<Song>) {
    const previous = songRef.current; if (!previous) return false;
    if ((patch.title !== undefined && patch.title !== previous.title) || (patch.artist !== undefined && patch.artist !== previous.artist) || 'reference' in patch) patch.preparation = undefined;
    const next = { ...previous, ...patch }; songRef.current = next; setSong(next); setSaving(n => n + 1);
    try { await persist(next); setSaveFailed(false); return true; } catch (e) { setSaveFailed(true); setError(errorText(e)); return false; } finally { setSaving(n => n - 1); }
  }
  function updateSections(sections: Section[], reviewed = false) {
    if (!song) return; validateSections(sections, song.duration); player.pause(); updateSong({ sections, reviewed });
  }
  async function decode(blob: Blob) {
    if (blob.size > 250 * 1024 * 1024) throw new Error('Please use a recording under 250 MB.');
    let buffer: AudioBuffer;
    try { buffer = await player.context.decodeAudioData(await blob.arrayBuffer()); } catch { throw new Error('This recording could not be opened. Try a WAV or MP3 file ripped from the CD.'); }
    if (buffer.duration > 20 * 60) throw new Error('Please use a song under 20 minutes for this first version.');
    if (buffer.duration < 0.2) throw new Error('This recording is too short.');
    return buffer;
  }
  async function loadSong(item: Song) {
    if (busy) return;
    player.stop(); setBusy('Opening song'); setProgress(0); setError(''); setNotice(''); setLookupOpen(false); lookupVersion.current++;
    try {
      const buffer = await decode(item.audio);
      const next = { ...item, duration: buffer.duration, peaks: item.peaks.length ? item.peaks : waveform(buffer) };
      validateSections(next.sections, next.duration); player.setBuffer(buffer);
      songRef.current = next; setSong(next); setSelectedId(next.sections[0]?.id ?? null); setPosition(0); setUseReference(Boolean(next.reference));
    } catch (e) { setError(errorText(e)); } finally { setBusy(''); }
  }
  async function addSong(file: File, demo = false) {
    if (busy) return; player.stop(); setBusy('Opening audio'); setError(''); setNotice(''); setProgress(0); lookupVersion.current++; setLookupOpen(false);
    let imported: Song | null = null;
    try {
      const buffer = await decode(file); const tags = await fileMetadata(file);
      const starts = demo ? [0, 8, 24, 40, 56, 72, 88] : [0];
      const names = ['Intro', 'Verse 1', 'Chorus 1', 'Verse 2', 'Chorus 2', 'Bridge', 'Ending'];
      const kinds: SectionKind[] = ['Intro', 'Verse', 'Chorus', 'Verse', 'Chorus', 'Bridge', 'Ending'];
      imported = { id: crypto.randomUUID(), title: demo ? 'Practice arrangement' : tags.title, artist: demo ? 'Original synthesized demo' : tags.artist, filename: file.name, audio: file, duration: buffer.duration, sections: starts.map((start, i) => ({ id: crypto.randomUUID(), start, name: demo ? names[i] : 'Whole song', kind: demo ? kinds[i] : 'Section' })), reviewed: demo, created: Date.now(), peaks: waveform(buffer), analysisNote: demo ? 'An original synthesized practice track with prepared sections. Use it to try jumps and repeat controls.' : undefined };
      await persist(imported); player.setBuffer(buffer); songRef.current = imported; setSong(imported); setSelectedId(imported.sections[0].id); setView('prepare'); setUseReference(false);
    } catch (e) { setError(errorText(e)); } finally { setBusy(''); }
    if (imported && !demo) await analyzeSong(imported, onlinePreparation);
  }
  async function analyzeSong(item = songRef.current, useOnline = onlinePreparation) {
    if (!item || !player.buffer) return;
    player.pause(); setConfirm(null); setBusy('Preparing audio analysis'); setProgress(0.02); setError(''); setNotice('');
    const token = ++operation.current;
    const controller = new AbortController(); preparationController.current = controller;
    try {
      const referenceBuffer = useReference && item.reference ? await decode(item.reference) : undefined;
      if (token !== operation.current) return;
      const sourceBuffer = referenceBuffer ?? player.buffer;
      let preparation = item.preparation;
      if (preparation && (preparation.reference !== Boolean(referenceBuffer) || Math.abs(preparation.duration - sourceBuffer.duration) > 0.1)) preparation = undefined;
      if (useOnline) preparation = await enrich(sourceBuffer, item, Boolean(referenceBuffer), controller.signal, stage => { if (token === operation.current) { setBusy(stage); setProgress(0.03); } });
      if (token !== operation.current) return;
      const target = monoForAnalysis(player.buffer);
      const reference = referenceBuffer ? monoForAnalysis(referenceBuffer) : undefined;
      const instance = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' }); worker.current = instance;
      const result = await new Promise<AnalysisResult>((resolve, reject) => {
        instance.onmessage = event => { if (event.data.error) reject(new Error(event.data.error)); else if (event.data.result) resolve(event.data.result); else { setBusy(event.data.stage); setProgress(event.data.progress); } };
        instance.onerror = () => reject(new Error('Analysis stopped unexpectedly. You can still mark sections manually.'));
        const transfer: Transferable[] = [target.samples.buffer]; if (reference) transfer.push(reference.samples.buffer);
        instance.postMessage({ target, reference, sensitivity, hints: preparation?.hints ?? [] }, transfer);
      });
      if (token !== operation.current) return;
      const sections = result.sections.map(s => ({ ...s, id: crypto.randomUUID(), suggested: true })); validateSections(sections, item.duration);
      const match = preparation?.recognition;
      const next = { ...item, title: match?.confirmed ? match.title : item.title, artist: match?.confirmed ? match.artist : item.artist, sections, reviewed: false, preparation, analysisNote: `${preparation?.note ? preparation.note + ' ' : ''}${result.note}` };
      await persist(next); songRef.current = next; setSong(next); setSelectedId(sections[0].id); setNotice(`${sections.length} suggested ${sections.length === 1 ? 'section' : 'sections'} ready to review.`);
    } catch (e) { if (token === operation.current) setError(errorText(e)); }
    finally { if (token === operation.current) { worker.current?.terminate(); worker.current = null; preparationController.current = null; setBusy(''); } }
  }
  function cancelAnalysis() { operation.current++; preparationController.current?.abort(); preparationController.current = null; worker.current?.terminate(); worker.current = null; setBusy(''); setNotice('Analysis cancelled. Your saved sections are unchanged.'); }
  function requestAnalysis(useOnline = onlinePreparation) { pendingOnline.current = useOnline; if (song && (song.reviewed || song.sections.length > 1)) setConfirm('analyze'); else run(() => analyzeSong(songRef.current, useOnline)); }
  function togglePlay() { if (!song || busy) return; if (player.playing) player.pause(); else run(() => player.play(player.position >= song.duration - 0.02 ? 0 : player.position)); }
  function toggleRepeat(nextMode: PlaybackMode) {
    if (!song || !active || busy) return;
    run(() => player.setRepeat(player.displayMode === nextMode ? 'normal' : nextMode, active.start, sectionEnd(song.sections, current, song.duration), repeatCount));
  }
  function addMarker() {
    if (!song) return; const start = Math.round(player.position * 100) / 100;
    if (song.sections.some(s => Math.abs(s.start - start) < 0.1) || song.duration - start < 0.1) { setError('Move the playhead at least 0.1 seconds away from an existing marker or the end of the song.'); return; }
    const marker: Section = { id: crypto.randomUUID(), start, name: `Section ${song.sections.length + 1}`, kind: 'Section' };
    run(() => updateSections([...song.sections, marker].sort((a, b) => a.start - b.start))); setSelectedId(marker.id);
  }
  function editSection(patch: Partial<Section>) { if (!song || !selected || Object.entries(patch).every(([key, value]) => selected[key as keyof Section] === value)) return; run(() => updateSections(song.sections.map(s => s.id === selected.id ? { ...s, ...patch, suggested: false } : s))); }
  function moveBoundary(delta: number) {
    if (!song || !selected) return;
    const min = selectedIndex > 0 ? song.sections[selectedIndex - 1].start + 0.1 : 0;
    const max = selectedEnd - 0.1;
    if (selectedIndex > 0) editSection({ start: Math.round(Math.max(min, Math.min(max, selected.start + delta)) * 100) / 100 });
  }
  async function addReference(file: File) {
    if (!song || busy) return; setBusy('Checking reference recording'); setError(''); player.pause();
    try { await decode(file); const saved = await updateSong({ reference: file, referenceName: file.name }); setUseReference(true); if (saved) setNotice('Reference added. Choose Find sections to use it.'); } catch (e) { setError(errorText(e)); } finally { setBusy(''); }
  }
  async function restore(file: File) {
    if (busy) return; setBusy('Restoring song backup'); setProgress(0); setError(''); setNotice(''); player.stop();
    try { const restored = await importSong(file); const buffer = await decode(restored.audio); restored.duration = buffer.duration; validateSections(restored.sections, restored.duration); restored.peaks = waveform(buffer); await persist(restored); player.setBuffer(buffer); songRef.current = restored; setSong(restored); setSelectedId(restored.sections[0].id); setView('prepare'); setUseReference(Boolean(restored.reference)); setNotice('Song and audio restored.'); } catch (e) { setError(errorText(e)); } finally { setBusy(''); }
  }
  async function removeSong() {
    if (!song) return; const id = song.id; await deleteSong(id); player.stop(); setSong(null); songRef.current = null; setLibrary(previous => previous.filter(s => s.id !== id)); setConfirm(null); setNotice('Song removed from this library.');
  }
  async function lookup() {
    const text = query.trim(); if (text.length < 2) { setLookupError('Enter at least two characters.'); return; }
    const version = ++lookupVersion.current; setLookupBusy(true); setLookupError(''); setLookupResults(null);
    try {
      let response: unknown;
      if (window.musicSections) response = await window.musicSections.lookupTitle(text);
      else {
        const endpoint = new URL('https://musicbrainz.org/ws/2/recording/'); endpoint.search = new URLSearchParams({ query: text, fmt: 'json', limit: '8' }).toString();
        const result = await fetch(endpoint, { signal: AbortSignal.timeout(12000) }); if (result.status === 503) throw new Error('Song lookup is busy. Try again later, or enter the title yourself.'); if (!result.ok) throw new Error('Song lookup is unavailable. You can enter the title yourself.'); response = await result.json();
      }
      if (version === lookupVersion.current) setLookupResults((response as { recordings?: Lookup[] }).recordings ?? []);
    } catch (e) { if (version === lookupVersion.current) setLookupError(errorText(e)); } finally { if (version === lookupVersion.current) setLookupBusy(false); }
  }
  const filtered = library.filter(s => `${s.title} ${s.artist}`.toLowerCase().includes(filter.toLowerCase()));
  return <div className={`app ${view === 'perform' ? 'performance' : ''}`}>
    <input ref={importInput} type="file" hidden accept="audio/*,.wav,.mp3,.m4a,.flac,.ogg" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) run(() => addSong(file)); }}/>
    <input ref={referenceInput} type="file" hidden accept="audio/*,.wav,.mp3,.m4a,.flac,.ogg" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) run(() => addReference(file)); }}/>
    <input ref={backupInput} type="file" hidden accept=".musicsections,.zip" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) run(() => restore(file)); }}/>
    <aside className="sidebar" inert={help || lookupOpen || Boolean(confirm)}>
      <div className="brand"><div className="brand-mark"><span/><span/><span/></div><div>Music Sections<small>YOUR SONGS. YOUR CUES.</small></div></div>
      <div className="library-heading"><span><ListMusic size={17}/> Song library</span><span className="count">{library.length}</span></div>
      <button className="import-button" disabled={Boolean(busy)} onClick={() => importInput.current?.click()}><Plus size={18}/> Add a song</button>
      <div className="library-search"><Search size={16}/><input aria-label="Find a saved song" placeholder="Find a song" value={filter} onChange={e => setFilter(e.target.value)}/></div>
      <div className="library-list">{filtered.map(item => <button className={`library-song ${song?.id === item.id ? 'active' : ''}`} key={item.id} disabled={Boolean(busy)} onClick={() => run(() => loadSong(item))}><span className="song-icon"><Music2 size={19}/></span><span className="library-song-text"><strong>{item.title}</strong><small>{item.artist || item.filename}</small></span><span className="song-length">{time(item.duration)}</span></button>)}{!library.length && <p className="library-empty">Imported songs and their sections will appear here.</p>}{library.length > 0 && !filtered.length && <p className="library-empty">No matching songs.</p>}</div>
      <div className="sidebar-footer"><button disabled={Boolean(busy)} onClick={() => backupInput.current?.click()}><FolderOpen size={17}/> Restore song backup</button><button onClick={() => setHelp(true)}><CircleHelp size={17}/> Help & shortcuts</button><div className="local-label"><Headphones size={15}/><span>Playback stays on this computer</span></div><small className="version">Music Sections · 0.2.3</small></div>
    </aside>
    <main inert={help || lookupOpen || Boolean(confirm)}>
      <header className="topbar"><div className="breadcrumb"><Music2 size={16}/><span>Song workspace</span>{song && <><ChevronRight size={15}/><strong>{song.title}</strong></>}</div><div className="topbar-actions">{song && <button className="quiet-button" disabled={Boolean(busy)} onClick={() => run(async () => { await exportSong(song); setNotice('Song backup exported with audio and sections.'); })}><Download size={16}/> Export song</button>}<button className="icon-button" aria-label="Help and keyboard shortcuts" onClick={() => setHelp(true)}><CircleHelp size={20}/></button></div></header>
      {error && <div className="message error" role="alert"><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError('')}><X size={18}/></button></div>}
      {notice && <div className="message success" role="status"><Check size={17}/><span>{notice}</span><button aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={18}/></button></div>}
      {busy && <div className="busy-panel" role="status"><LoaderCircle className="spin" size={20}/><div><strong>{busy}</strong><progress value={progress || 0.02} max="1"/></div>{operation.current > 0 && preparationController.current && <button className="quiet-button" onClick={cancelAnalysis}>Cancel</button>}</div>}
      {!song ? <div className="empty-workspace"><div className="empty-icon"><Music2 size={42}/></div><p className="eyebrow">START WITH A RECORDING</p><h1>Add your first song</h1><p>Import a backing track or a song with vocals.<br/>Find its sections, then jump and repeat as you play.</p><button className="primary-button" disabled={Boolean(busy)} onClick={() => importInput.current?.click()}><Upload size={19}/> Import audio</button><button className="demo-button" disabled={Boolean(busy)} onClick={() => run(() => addSong(demoFile(), true))}><Play size={16}/> Try the practice track</button><div className="format-note">WAV · MP3 · M4A · FLAC · OGG<br/><span>Files stay local. No account needed.</span></div></div> : <>
        <section className="song-heading"><div><p className="eyebrow">{view === 'perform' ? 'READY AT YOUR FINGERTIPS' : 'PREPARE ONCE. PLAY ANYTIME.'}</p><h1>{song.title}</h1><div className="song-meta"><span>{song.artist || 'Artist not set'}</span><span className="separator">/</span><span>{time(song.duration)}</span><span className="separator">/</span><span>{song.sections.length} sections</span></div></div><div className="view-tabs" role="tablist" aria-label="Workspace mode"><button role="tab" disabled={Boolean(busy)} aria-selected={view === 'prepare'} onClick={() => setView('prepare')}><SlidersHorizontal size={17}/> Prepare</button><button role="tab" disabled={Boolean(busy)} aria-selected={view === 'perform'} onClick={() => setView('perform')}><Radio size={17}/> Perform</button></div></section>
        {view === 'prepare' ? <div className="prepare-grid">
          <div className="prepare-primary">
            <section className="panel timeline-panel"><div className="panel-header"><div><h2>Song timeline</h2><p>Seek to a moment or select a section marker.</p></div><span className="time-pill">{time(position, true)}</span></div><Waveform peaks={song.peaks} duration={song.duration} sections={song.sections} position={position} selected={selectedId} disabled={Boolean(busy)} onSelect={id => { setSelectedId(id); const section = song.sections.find(s => s.id === id); if (section) run(() => player.seek(section.start)); }} onSeek={pos => run(() => player.seek(pos))}/><div className="timeline-actions"><button className="secondary-button" disabled={Boolean(busy)} onClick={addMarker}><Plus size={16}/> Add section here</button><span>{saving ? <><LoaderCircle size={15} className="spin"/> Saving…</> : saveFailed ? <><Pencil size={15}/> Changes not saved</> : song.reviewed ? <><CheckCheck size={15}/> Reviewed and saved</> : <><Pencil size={15}/> Sections need review</>}</span></div></section>
            <section className="panel sections-panel"><div className="panel-header"><div><h2>Sections</h2><p>Click a play button to jump immediately.</p></div><button className={`review-button ${song.reviewed ? 'done' : ''}`} disabled={Boolean(busy) || song.reviewed} onClick={() => run(async () => { const saved = await updateSong({ reviewed: true, sections: songRef.current!.sections.map(s => ({ ...s, suggested: false })) }); if (saved) setNotice('Sections reviewed and saved.'); })}><CheckCheck size={16}/>{song.reviewed ? 'Reviewed' : 'Mark reviewed'}</button></div>
              <div className="section-table"><div className="section-table-heading"><span>SECTION</span><span>START</span><span>LENGTH</span><span/></div>{song.sections.map((section, i) => <div key={section.id} className={`section-row ${selectedId === section.id ? 'selected' : ''} ${current === i && playing ? 'playing' : ''}`}><button disabled={Boolean(busy)} className="section-select" onClick={() => setSelectedId(section.id)}><span className={`section-color kind-${section.kind.toLowerCase()}`}/><strong>{section.name}</strong>{section.suggested && <span className="suggested-label">Suggested</span>}{playing && current === i && <span className="playing-bars"><i/><i/><i/></span>}</button><span>{time(section.start, true)}</span><span>{time(sectionEnd(song.sections, i, song.duration) - section.start)}</span><button className="section-play" disabled={Boolean(busy)} aria-label={`Play ${section.name}`} onClick={() => run(() => player.jump(section))}><Play size={16}/></button></div>)}</div>
              <div className="analysis-note"><Sparkles size={17}/><p>{song.analysisNote || 'Add section markers while listening. Each marker starts a section that ends at the next marker.'}</p></div>
            </section>
            <section className="panel metadata-panel"><div className="panel-header"><h2>Song details</h2><button className="quiet-button" disabled={Boolean(busy)} onClick={() => { setQuery(song.title); setLookupOpen(true); setLookupBusy(false); setLookupResults(null); setLookupError(''); }}><Search size={16}/> Look up title</button></div><div className="metadata-fields" key={song.id}><label>Title<input disabled={Boolean(busy)} key={`${song.id}-${song.title}`} defaultValue={song.title} maxLength={160} onBlur={e => updateSong({ title: e.target.value.trim() || song.filename })}/></label><label>Artist<input disabled={Boolean(busy)} key={`${song.id}-${song.artist}`} defaultValue={song.artist} maxLength={160} onBlur={e => updateSong({ artist: e.target.value.trim() })}/></label></div><p className="file-note">Playback file: {song.filename}</p></section>
          </div>
          <aside className="prepare-tools">
            <section className="panel analysis-panel"><div className="tool-icon"><Sparkles size={20}/></div><h2>Find song sections</h2><p>Suggest boundaries from changes in the music and repeated passages.</p><div className="online-preparation"><h3>Identify &amp; improve</h3><p>Recognize the recording, then use matching timed lyrics to help find verses and repeated choruses.</p><button className="secondary-button full" disabled={Boolean(busy)} onClick={() => requestAnalysis(true)}><Search size={17}/> Identify &amp; improve sections</button><label className="checkbox-label"><input type="checkbox" disabled={Boolean(busy)} checked={onlinePreparation} onChange={e => { setOnlinePreparation(e.target.checked); localStorage.setItem('music-sections-online', String(e.target.checked)); }}/> Use online help when importing and finding sections</label><small>Needs internet. Sends audio fingerprints to Shazam and song details to LRCLIB. Your audio file stays on this computer.</small>{song.preparation && <><PreparationStatus evidence={song.preparation}/>{song.preparation.recognition && !song.preparation.recognition.confirmed && <button className="quiet-button" disabled={Boolean(busy)} onClick={() => { const match = song.preparation!.recognition!; updateSong({ title: match.title, artist: match.artist }); setNotice('Song details updated. Choose Identify & improve to look for timed sections.'); }}>Use this song title</button>}</>}</div><label className="sensitivity-label" htmlFor="sensitivity">Detection detail</label><input disabled={Boolean(busy)} id="sensitivity" type="range" min="0" max="1" step="0.05" value={sensitivity} onChange={e => setSensitivity(Number(e.target.value))}/><div className="range-labels"><span>Broader</span><span>Finer</span></div><button className="primary-button full" disabled={Boolean(busy)} onClick={() => requestAnalysis()}><Sparkles size={17}/> Find sections</button><small>Musical analysis runs locally. Suggestions can be edited.</small><div className="reference-block"><h3>Matching vocal recording</h3><p>Optional: use the vocal version to suggest timings for this playback track.</p>{song.reference ? <><div className="reference-file"><Headphones size={16}/><span>{song.referenceName}</span><button aria-label="Remove reference recording" disabled={Boolean(busy)} onClick={() => { updateSong({ reference: undefined, referenceName: undefined }); setUseReference(false); }}><X size={16}/></button></div><label className="checkbox-label"><input type="checkbox" checked={useReference} disabled={Boolean(busy)} onChange={e => setUseReference(e.target.checked)}/> Analyze reference and match timings</label></> : <button className="secondary-button full" disabled={Boolean(busy)} onClick={() => referenceInput.current?.click()}><Plus size={16}/> Add reference</button>}</div></section>
            <section className="panel editor-panel"><div className="panel-header"><h2>Section editor</h2><Pencil size={17}/></div>{selected ? <fieldset disabled={Boolean(busy)}><label>Section name<input key={selected.id + selected.name} defaultValue={selected.name} maxLength={120} onBlur={e => editSection({ name: e.target.value.trim() || 'Section' })}/></label><label>Type<select value={selected.kind} onChange={e => { const kind = e.target.value as SectionKind; const number = song.sections.slice(0, selectedIndex).filter(s => s.kind === kind).length + 1; editSection({ kind, name: ['Intro', 'Ending', 'Bridge', 'Instrumental'].includes(kind) ? kind : `${kind} ${number}` }); }}>{sectionKinds.map(kind => <option key={kind}>{kind}</option>)}</select></label><BoundaryEditor key={selected.id} section={selected} min={selectedIndex > 0 ? song.sections[selectedIndex - 1].start + 0.1 : 0} max={selectedEnd - 0.1} onChange={start => editSection({ start })}/><div className="nudge-controls"><button disabled={selectedIndex === 0} aria-label="Move section start earlier by one tenth of a second" onClick={() => moveBoundary(-0.1)}><ChevronLeft size={15}/> 0.1s</button><button disabled={selectedIndex === 0} onClick={() => { const pos = Math.round(player.position * 100) / 100; editSection({ start: pos }); }}>Use playhead</button><button disabled={selectedIndex === 0} aria-label="Move section start later by one tenth of a second" onClick={() => moveBoundary(0.1)}>0.1s <ChevronRight size={15}/></button></div><p className="section-end">Ends at {time(selectedEnd, true)} · {time(selectedEnd - selected.start)} long</p><button className="secondary-button full" onClick={() => run(() => player.jump(selected))}><Play size={16}/> Audition section</button><button className="text-danger" disabled={selectedIndex === 0} onClick={() => { updateSections(song.sections.filter(s => s.id !== selected.id)); setSelectedId(song.sections[Math.max(0, selectedIndex - 1)].id); }}><Trash2 size={15}/> Remove marker</button></fieldset> : <p>Select a section to adjust its name and starting point.</p>}</section>
            <button className="remove-song" disabled={Boolean(busy)} onClick={() => setConfirm('delete-song')}><Trash2 size={15}/> Remove song from library</button>
          </aside>
        </div> : <div className="perform-workspace">
          {!song.reviewed && <div className="review-reminder"><Pencil size={17}/><span>These sections haven’t been marked as reviewed.</span><button onClick={() => setView('prepare')}>Review sections</button></div>}
          <section className="now-playing"><div className="now-playing-label"><span>{playing ? 'NOW PLAYING' : position >= song.duration - 0.02 ? 'FINISHED' : 'READY TO PLAY'}</span><span className={`mode-badge ${mode !== 'normal' ? 'on' : ''}`}>{mode === 'loop' ? <><Repeat size={16}/> Looping section</> : mode === 'once' ? <><Repeat1 size={16}/> {repeatPass ? `Repeat ${repeatPass} of ${repeatCount}` : `${repeatCount} extra ${repeatCount === 1 ? 'repeat' : 'repeats'} armed`}</> : 'Straight through'}</span></div><h2>{active?.name}</h2><div className="performance-time"><span>{time(position)}</span><small>of {time(song.duration)}</small><div className="section-remaining">{time(Math.max(0, (song ? sectionEnd(song.sections, current, song.duration) : 0) - position))}<small>left in section</small></div></div><input type="range" min="0" max={song.duration} step="0.01" value={Math.min(song.duration, position)} disabled={Boolean(busy)} aria-label="Performance song position" onChange={e => run(() => player.seek(Number(e.target.value)))}/></section>
          <div className="performance-section-heading"><h2>Jump to a section</h2><span>Click to play immediately · keys 1–9</span></div><div className="section-cards">{song.sections.map((section, i) => <button key={section.id} disabled={Boolean(busy)} className={`section-card kind-${section.kind.toLowerCase()} ${i === current ? 'current' : ''}`} onClick={() => run(() => player.jump(section))}><div><span className="card-number">{String(i + 1).padStart(2, '0')}</span>{current === i && playing ? <span className="playing-bars"><i/><i/><i/></span> : <Play size={20}/>}</div><strong>{section.name}</strong><span className="card-time">{time(section.start)} <span>· {time(sectionEnd(song.sections, i, song.duration) - section.start)}</span></span></button>)}</div>
        </div>}
      </>}
      {song && <footer className="transport"><div className="transport-buttons"><button className="stop-button" disabled={Boolean(busy)} aria-label="Stop playback" title="Stop · Esc" onClick={() => player.stop()}><Square size={20}/></button><button className="play-button" disabled={Boolean(busy)} aria-label={playing ? 'Pause playback' : 'Play song'} title="Play / pause · Space" onClick={togglePlay}>{playing ? <Pause size={25} fill="currentColor"/> : <Play size={25} fill="currentColor"/>}</button><button className="next-button" disabled={Boolean(busy) || current >= song.sections.length - 1} aria-label="Play next section" onClick={() => run(() => player.jump(song.sections[current + 1]))}><ChevronRight size={24}/></button></div><div className="transport-track"><strong>{active?.name || song.title}</strong><span><span data-testid="position">{time(position)}</span> / {time(song.duration)}</span></div><div className="repeat-controls"><label className="repeat-count" title="Extra plays after the current pass, then continue"><span>Extra repeats</span><select aria-label="Extra section repeats" value={repeatCount} disabled={Boolean(busy) || mode === 'once'} onChange={e => setRepeatCount(Number(e.target.value))}>{Array.from({ length: MAX_SECTION_REPEATS }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}</select></label><button disabled={Boolean(busy)} aria-pressed={mode === 'once'} onClick={() => toggleRepeat('once')} aria-label={repeatCount === 1 ? 'Repeat once' : `Repeat ${repeatCount} times`} title={`Finish this pass, repeat ${repeatCount} extra ${repeatCount === 1 ? 'time' : 'times'}, then continue. Select again to cancel · R`}><Repeat1 size={20}/><span>{repeatCount === 1 ? 'Repeat once' : `Repeat ${repeatCount} times`}</span></button><button disabled={Boolean(busy)} aria-pressed={mode === 'loop'} onClick={() => toggleRepeat('loop')} title="Repeat the current section until switched off · L"><Repeat size={20}/><span>Loop section</span></button></div><div className="volume-control"><Volume2 size={20}/><input aria-label="Playback volume" type="range" min="0" max="1" step="0.01" value={volume} onChange={e => setVolume(Number(e.target.value))}/><span>{Math.round(volume * 100)}%</span></div></footer>}
    </main>
    {help && <div className="modal-backdrop" onClick={() => setHelp(false)}><section className="modal help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={e => e.stopPropagation()}><button className="modal-close" aria-label="Close help" onClick={() => setHelp(false)}><X size={21}/></button><Keyboard size={28}/><h2 id="help-title">A few things to know</h2><p>Import a backing track or a normal song. Regular songs keep their vocals; this app doesn’t remove them.</p><ol><li>Review suggested boundaries and names in <strong>Prepare</strong>.</li><li>Use <strong>Perform</strong> for large section buttons. Selecting a section starts it immediately and clears repeats.</li><li>Set <strong>Extra repeats</strong> (1–20), then press <strong>Repeat</strong> or <kbd>R</kbd>. The current pass finishes, the section plays that many extra times, then the song continues. Select Repeat again to cancel; pause, stop, and jumps also clear repeats. <strong>Loop section</strong> repeats until switched off.</li><li>Export a song backup to transfer the audio and saved sections to another computer.</li></ol><div className="shortcut-list"><span><kbd>Space</kbd> Play / pause</span><span><kbd>Esc</kbd> Stop</span><span><kbd>1–9</kbd> Jump to section</span><span><kbd>R</kbd> Toggle counted repeat</span><span><kbd>L</kbd> Toggle loop</span></div><p className="help-footnote">Shortcuts work when a text field isn’t focused. Section suggestions use musical features. Identify & improve sends locally generated audio fingerprints to Shazam, then song details and duration to LRCLIB for timed lyric clues. It requires internet and may not recognize backing tracks or alternate versions. Add the matching vocal recording to help. Saved clues and playback work offline. Title lookup sends your search text to MusicBrainz; your audio files stay local.</p><button className="primary-button" onClick={() => setHelp(false)}>Got it</button></section></div>}
    {lookupOpen && <div className="modal-backdrop"><section className="modal lookup-modal" role="dialog" aria-modal="true" aria-labelledby="lookup-title"><button className="modal-close" aria-label="Close title lookup" onClick={() => { setLookupOpen(false); lookupVersion.current++; setLookupBusy(false); }}><X size={21}/></button><Search size={25}/><h2 id="lookup-title">Look up song details</h2><p>Search by title or artist. Only this text is sent to MusicBrainz; your recording stays local. Results update the title and artist, not section timings.</p><form className="lookup-form" onSubmit={e => { e.preventDefault(); run(lookup); }}><input aria-label="Song title or artist to look up" value={query} maxLength={160} onChange={e => setQuery(e.target.value)}/><button className="primary-button" disabled={lookupBusy}>{lookupBusy ? <LoaderCircle size={17} className="spin"/> : <Search size={17}/>}Search</button></form>{lookupError && <p className="error-text" role="alert">{lookupError}</p>}<div className="lookup-results">{lookupResults?.map(result => <button key={result.id} onClick={() => { updateSong({ title: result.title, artist: result['artist-credit']?.map(a => a.name).join(', ') || '' }); setLookupOpen(false); setNotice('Song details updated.'); }}><div><strong>{result.title}</strong><span>{result['artist-credit']?.map(a => a.name).join(', ') || 'Unknown artist'}</span></div><span>{result.length ? time(result.length / 1000) : ''}</span><Check size={18}/></button>)}{lookupResults?.length === 0 && <p>No results. Try adding the artist, or enter song details yourself.</p>}</div></section></div>}
    {confirm && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title"><h2 id="confirm-title">{confirm === 'delete-song' ? 'Remove this song?' : 'Replace the current sections?'}</h2><p>{confirm === 'delete-song' ? 'This removes the saved audio and markers from this library. Your original recording is untouched. Export a backup first if you want to keep the prepared song.' : 'Finding sections again will replace your current markers and names with new suggestions. Export a backup first if you want to keep this arrangement.'}</p><div className="modal-actions"><button className="secondary-button" onClick={() => setConfirm(null)}>Cancel</button><button className={confirm === 'delete-song' ? 'danger-button' : 'primary-button'} onClick={() => run(confirm === 'delete-song' ? removeSong : () => analyzeSong(songRef.current, pendingOnline.current))}>{confirm === 'delete-song' ? 'Remove song' : pendingOnline.current ? 'Identify & improve' : 'Find sections'}</button></div></section></div>}
  </div>;
}
