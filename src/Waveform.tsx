import { useEffect, useRef } from 'react';
import type { Section } from './model';
import { time } from './model';
export function Waveform({ peaks, duration, sections, position, onSeek, selected, onSelect, disabled = false }: {
  peaks: number[]; duration: number; sections: Section[]; position: number; onSeek: (position: number) => void; selected: string | null; onSelect: (id: string) => void; disabled?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current!;
    function draw() {
      const bounds = element.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1;
      element.width = bounds.width * dpr; element.height = bounds.height * dpr;
      const ctx = element.getContext('2d')!; ctx.scale(dpr, dpr);
      const w = bounds.width, h = bounds.height;
      ctx.clearRect(0, 0, w, h);
      const count = Math.floor(w / 3), max = Math.max(0.02, ...peaks);
      for (let i = 0; i < count; i++) {
        const sample = peaks[Math.floor(i * peaks.length / count)] ?? 0;
        const height = Math.max(2, sample / max * (h - 38));
        ctx.fillStyle = i / count < position / duration ? '#89b6ff' : '#4b6488';
        ctx.fillRect(i * 3, (h - height) / 2, 1.8, height);
      }
      ctx.strokeStyle = '#ebf1ff'; ctx.lineWidth = 1.5; const x = position / duration * w;
      ctx.beginPath(); ctx.moveTo(x, 8); ctx.lineTo(x, h - 8); ctx.stroke();
    }
    draw(); const observer = new ResizeObserver(draw); observer.observe(element);
    return () => observer.disconnect();
  }, [peaks, duration, position]);
  return <div className="waveform-shell">
    <div className="waveform-markers" aria-label="Section markers">{sections.map((section, i) => <button disabled={disabled} key={section.id} className={`marker ${selected === section.id ? 'selected' : ''}`} style={{ left: `${section.start / duration * 100}%`, maxWidth: `${((sections[i + 1]?.start ?? duration) - section.start) / duration * 100}%` }} onClick={() => onSelect(section.id)} title={`${section.name} · ${time(section.start, true)}`}>{section.name}</button>)}</div>
    <canvas ref={canvas} className="waveform" aria-hidden="true" />
    <input type="range" className="waveform-seek" min="0" max={duration} step="0.01" value={Math.min(position, duration)} disabled={disabled} aria-label="Seek through song" aria-valuetext={time(position, true)} onChange={e => onSeek(Number(e.target.value))}/>
    <div className="waveform-times">{[0, 0.25, 0.5, 0.75, 1].map(fraction => <span key={fraction}>{time(duration * fraction)}</span>)}</div>
  </div>;
}
