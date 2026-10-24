export type SectionKind = 'Intro' | 'Verse' | 'Chorus' | 'Pre-chorus' | 'Bridge' | 'Instrumental' | 'Ending' | 'Section';
export type Section = { id: string; name: string; kind: SectionKind; start: number; suggested?: boolean; group?: number };
export type Song = {
  id: string; title: string; artist: string; filename: string; audio: Blob; duration: number;
  sections: Section[]; reviewed: boolean; created: number; reference?: Blob; referenceName?: string;
  analysisNote?: string; peaks: number[]; preparation?: import('./enrichment').PreparationEvidence;
};
export const sectionKinds: SectionKind[] = ['Intro', 'Verse', 'Chorus', 'Pre-chorus', 'Bridge', 'Instrumental', 'Ending', 'Section'];
export function sectionEnd(sections: Section[], index: number, duration: number) { return sections[index + 1]?.start ?? duration; }
export function currentSection(sections: Section[], position: number) {
  for (let i = sections.length - 1; i >= 0; i--) if (position >= sections[i].start - 0.00001) return i;
  return 0;
}
export function time(seconds: number, precise = false) {
  const s = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(s / 60);
  const remainder = precise ? (s % 60).toFixed(2).padStart(5, '0') : Math.floor(s % 60).toString().padStart(2, '0');
  return `${minutes}:${remainder}`;
}
export function parseTime(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+(?::[0-5]?\d(?:\.\d{1,3})?)?(?:\.\d{1,3})?$/.test(trimmed)) return null;
  const parts = trimmed.split(':').map(Number);
  const n = parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0];
  return Number.isFinite(n) ? n : null;
}
export function validateSections(sections: Section[], duration: number) {
  if (!Number.isFinite(duration) || duration <= 0 || !sections.length || sections.length > 150 || sections[0].start !== 0) throw new Error('Sections must start at 0:00.');
  const ids = new Set<string>();
  sections.forEach((s, i) => {
    if (typeof s.id !== 'string' || ids.has(s.id) || typeof s.name !== 'string' || s.name.length > 120 || !sectionKinds.includes(s.kind)) throw new Error('Invalid section data.');
    ids.add(s.id);
    if (!Number.isFinite(s.start) || s.start < 0 || s.start >= duration || (i && s.start - sections[i - 1].start < 0.1)) throw new Error('Section starts must be in order and at least 0.1 seconds apart.');
  });
}
