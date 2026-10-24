# Optional real-music smoke check

`real-song-smoke.mjs` expects local fixtures under `tests/local-fixtures/`. These recordings are not distributed with the app or source archive. The folder is ignored.

For the recorded validation run, the OGG file was librosa's example of Karissa Hobbs' “Let's Go Fishin'” (CC-BY-NC-SA-4.0), and the MP3 was an FFmpeg conversion of that same recording. Source and attribution are in `docs/VALIDATION.md`.

To reproduce that check for private evaluation:

```sh
mkdir -p tests/local-fixtures
curl --fail --location --output tests/local-fixtures/voice-song.ogg https://librosa.org/data/audio/Karissa_Hobbs_-_Lets_Go_Fishin.ogg
ffmpeg -i tests/local-fixtures/voice-song.ogg -c:a libmp3lame -b:a 128k tests/local-fixtures/voice-song.mp3
```

With the development server running, execute:

```sh
node tests/real-song-smoke.mjs
```

The smoke check establishes decoding and control operation. It does not measure section-label accuracy or validate physical audio output.
