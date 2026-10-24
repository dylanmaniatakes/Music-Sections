# Music Sections: product plan

## Agreed requirements

- Primary device: a Windows computer.
- Input: CD-ripped backing tracks, matching vocal versions when available, and ordinary songs with vocals.
- Selecting a section jumps immediately.
- Automatic section suggestions with editable boundaries and labels.
- Internet use is allowed during preparation; playback remains offline.
- A persistent local song library and portable prepared-song backups.
- No performer-side controls are assumed; the first edition runs on one computer.

## Current implementation

The desktop application implements import, automatic musical-feature analysis, musical similarity alignment to an optional reference recording, waveform preparation, named sections, immediate jumps, counted section repeats (1–20 extra passes before continuing), continuous section loops, a performance screen, keyboard shortcuts, local persistence, and per-song backups. File tags and optional text lookup provide song details. Online preparation is on by default for each new import and falls back to local analysis when necessary. Fingerprint recognition confirms song identity across different passages and retrieves duration-matched timed lyrics to help infer section labels and place boundaries. Clues and their source strength are persisted without lyric text and can be reused offline. Timing fusion checks musical boundaries before and after lyric cues, consolidates unsupported short verse paragraph splits, preserves distinct long verses with steady accompaniment, and retains strong audio changes inside long lyric blocks. Missing stanza breaks use full repeated passages rather than per-line boundaries. Recognition of the vocal reference can assist an instrumental playback track.

The analysis is a lightweight local heuristic. It centers spectral/chroma features within each recording, compares short and longer windows alongside energy, chooses novelty peaks, and compares passage progression with duration constraints. Verse/chorus labels are inferred from repeated groups and relative energy. It is deliberately presented as suggestions, with review status carried through editing and saving. It is not a trained semantic section-labeling model or a sung-lyric transcription system.

## Next evidence milestone

Use one matching vocal/backing pair from a church CD and one normal song. Check:

1. Number and placement of suggested boundaries against listening-based markers.
2. Incorrect labels and whether a verse begins with a pickup.
3. Reference-to-backing timing accuracy, including intro/outro differences.
4. Audibility of immediate jumps and loop joins through the actual church sound output.
5. Save, restart, export, and restore on the target Windows computer.

Use these results to improve detection rather than choosing a larger model based only on benchmark scores.

## Candidate later improvements

- Evaluate a trained music structure model (for example SongFormer) against the same real tracks; measure Windows CPU/GPU needs, model footprint, packaging, and redistribution license before adopting it.
- Explore lyric transcription and alignment using the matching vocal version, with corrections for repeated lyrics and instrumental pickups.
- Measure fingerprint/lyric coverage on the actual CD collection; unknown instrumental editions may not exist in lookup databases.
- Add performer control only after deciding whether it should be a keyboard, foot pedal, or remote device.

These are further evaluation items. Fingerprint recognition and duration-matched lyric clues are already implemented.

## Research references

- [SongFormer research](https://arxiv.org/abs/2510.02797)
- [Music structure segmentation](https://msaf.readthedocs.io/en/latest/tutorial.html)
- [Music alignment](https://librosa.org/doc/0.10.2/auto_examples/plot_music_sync.html)
- [AcoustID metadata lookup](https://acoustid.org/webservice)

- [Shazam fingerprint engine](https://github.com/Inrixia/shazamio-core)
- [LRCLIB API](https://lrclib.net/docs)
