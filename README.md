# Music Sections

Music Sections is a local desktop player for backing tracks and songs with vocals. Prepare named sections once, then jump to a verse, repeat a chorus, or loop a passage during playback.

## Start on Windows

1. Extract `Music-Sections-0.2.3-win-x64.zip` into a folder on a 64-bit Windows computer.
2. Open `Music Sections.exe` inside that folder. Keep the other extracted files with it.
3. Select **Try the practice track** to try the controls, or **Add a song** to import a recording.

The application is an unsigned portable application. It does not require Node.js, Python, an account, or a server. Playback and section analysis work without internet access. The app uses the computer's default audio output; select your mixer/interface as the Windows output device before playback.

## Prepare a song

Import a ripped CD track or another audio file. WAV and MP3 are good starting choices; M4A, FLAC, and OGG are also accepted when the bundled audio decoder supports the file. Limits: 250 MB per recording and 20 minutes per song.

The app immediately suggests sections from musical changes at two time scales and repeated passages. Feature comparisons emphasize differences within the recording, which helps distinguish sections in dense or heavily compressed music. Every generated boundary and label is a suggestion. Adjust **Detection detail** and select **Find sections** to try broader or finer boundaries. Reanalysis asks before replacing an existing arrangement.

Use the timeline to seek. Select a marker or a row to edit the section name, type, and starting time. Times accept `minutes:seconds.hundredths` or plain seconds. Nudge controls move the start by 0.1 seconds. Each section ends at the next marker; the final section ends at the recording's end. The first marker stays at 0:00. **Add section here** inserts a marker at the playhead. Removing a marker merges its time into the preceding section.

Audition the beginning and end of each section, especially pickup notes and reverb tails. Select **Mark reviewed** once the names and transitions are ready. Changes save automatically; wait until **Saving…** disappears before closing or exporting.

### Matching vocal and instrumental versions

Add the vocal version under **Matching vocal recording**, enable **Analyze reference and match timings**, and select **Find sections**. This analyzes the musical structure of the reference and aligns its suggested starts to the playback recording. The reference is used for preparation only; performance always plays the imported playback track.

Check the mapped boundaries by listening. Alignment can be wrong when recordings differ in arrangement or have similar repeated verses. If alignment fails, disable the reference checkbox and analyze the playback track directly. Select **Identify & improve sections** to recognize the vocal reference and apply matching timed lyric clues before mapping its sections to the backing track. This does not transcribe sung lyrics.

### Song identification

Common MP3 title and artist tags are read automatically. Otherwise, the filename becomes the title. **Look up title** optionally searches MusicBrainz using the title/artist text you enter. Selecting a result updates the song details. Only search text is sent online; no audio is uploaded. Lookup requires internet access and may return multiple versions or no match. 

**Identify & improve sections** compares up to three different 12-second passages using locally generated audio fingerprints. Only the fingerprints go to Shazam; the original audio and sample clips stay on your computer. Two different matching fingerprints are required before the app changes the title and artist. Conflicting or single-sample matches keep your existing details. You can explicitly accept a one-sample suggestion using **Use this song title**. A failed sample request preserves previous matches and tries the remaining passages; requests to a busy service stop rather than continuing to hit it.

After recognition, the app looks for timed lyrics in LRCLIB using the title, artist, and recording duration. If the exact lookup misses or has no usable timing, it searches alternate database entries for the same named song. It accepts matching titles/artists with a duration difference of at most two seconds. Stanza breaks and repeated lyric passages suggest verse, pre-chorus, chorus, and bridge labels. Refrains can also be found across different stanza breaks or when one occurrence has an extra line. Adjacent chorus paragraphs are joined into one passage. When repeated or explicit labels provide no naming evidence, unique stanzas keep generic section labels. Section timing is checked against nearby musical changes on both sides of each lyric clue (within six seconds), so clues that lead or trail the music can be corrected. Unsupported short paragraph splits within the same verse are joined; long distinct verses are retained even with steady accompaniment. Strong musical changes inside long lyric blocks remain available. If stanza breaks are absent, complete repeated passages are used rather than splitting each repeated line into a section. The analysis note reports how many starts aligned to musical changes and which timings remain approximate. These are still suggestions: stanza breaks can differ from musical sections, lyrics can have timing errors, and recordings with a different arrangement can have a similar length.

**Use online help when importing and finding sections** is enabled by default: each new recording first attempts recognition and timed lyric assistance, then falls back to local musical analysis. Uncheck it when you want local preparation only. Matching section clues are saved without lyric text and can be reused by **Find sections** offline. Unavailable services or missing matches fall back to musical analysis. The result panel separately reports song recognition and timed lyric availability, including missing timestamps, version-length mismatches, missing title/artist details, and service failures. Playback always stays offline.

Backing tracks, live recordings, cover versions, and uncommon songs may have no fingerprint or timed lyric match. Entering a known title and artist can still help lyric lookup when the exact version has matching duration. For a backing track, a matching vocal reference is the better source of recognition and lyric clues. Shazam recognition uses an unofficial service interface that may change or become unavailable; no account or API key is required in this edition.

## Perform

Select **Perform** for large section buttons and a clear playback display.

- **Select a section:** immediately start it, then continue through the original recording. This clears an active repeat or loop.
- **Extra repeats:** choose 1–20 extra plays, then select **Repeat** (or press **R**). The current pass finishes, the section plays that many extra times, then the song continues. For example, 3 means three additional full passes. The performance badge shows the current repeat out of the total. Select Repeat again to cancel and continue from the current point. When paused, this starts playback. The chosen count is remembered on this computer; changing it does not arm repeats automatically.
- **Loop section:** finish the current pass and keep repeating that section. Switch looping off to continue from the current point without restarting the section.
- **Pause:** keep the position and clear repetition.
- **Stop:** return to the beginning and clear repetition.

Transitions use the audio clock. Short fades reduce clicks on jumps and repeated boundaries, but section cuts still need to make musical sense. Immediate jumps can interrupt a beat, chord, lyric, or phrase.

Normal songs retain their recorded vocals. Vocal removal, pitch shifting, tempo changes, and separate instrument mixing are not included.

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| Space | Play / pause |
| Esc | Stop |
| 1–9 | Start the corresponding section |
| R | Toggle repeat using the chosen count |
| L | Toggle section loop |

Text entry suppresses playback shortcuts. In a dialog, Esc closes the dialog.

## Save and transfer

Audio is copied into the app's local song library; the original files are untouched. Prepared songs remain available when their original source files are disconnected. The library is stored in the application's user-data folder and is separate from the extracted application folder.

Select **Export song** to create a `.musicsections` backup containing the playback audio, markers, names, song details, optional reference audio, and saved recognition/section clues. **Restore song backup** imports it as a new library entry, without overwriting existing songs. A backup is limited to 300 MB total. Keep backups before replacing the computer or clearing application data.

The browser preview has its own local library, separate from the desktop app. Use export and restore to transfer a prepared song between them.

## Development

Requirements: Node.js 22.12 or newer and npm. Run these commands in the project folder:

```sh
npm ci
npm run dev
```

Open the local address printed by the development server. To launch the desktop version:

```sh
npm run desktop
```

To package a portable Windows application:

```sh
npm run package:windows
```

Windows archives are created in `release/`. No publishing or signing service is used.

### Checks

```sh
npm test
npx playwright install chromium
npm run test:browser
npm run build
node tests/desktop-smoke.mjs
```

See [validation](docs/VALIDATION.md) for what was tested and what still needs validation on Windows and with real songs.
