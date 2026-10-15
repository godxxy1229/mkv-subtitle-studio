# MKV Subtitle Studio

[![Tests](https://github.com/godxxy1229/mkv-subtitle-studio/actions/workflows/tests.yml/badge.svg)](https://github.com/godxxy1229/mkv-subtitle-studio/actions/workflows/tests.yml)

Add an SRT subtitle track to an MKV file in your browser — no upload, no re-encoding.

**▶ [Open the app](https://godxxy1229.github.io/mkv-subtitle-studio/)** · [한국어](README.ko.md)

![Screenshot](docs/screenshot.png)

## How to use

1. Open the app in desktop Chrome or Edge.
2. Drop an `.mkv` video and an `.srt` subtitle file.
3. Pick the subtitle language and track name, then click **Add subtitles & save**.
4. Open the new MKV in your player and turn on the subtitle track.

## Good to know

- Video and audio are copied as-is; only a subtitle track is added. The original file is never modified or overwritten.
- Nothing is uploaded. Everything runs in your browser, and the page's Content-Security-Policy blocks all network requests.
- Desktop Chrome and Edge write straight to disk, so large files work. Other browsers are limited to 256 MiB.
- SRT only (UTF-8, UTF-16 with BOM, CP949/EUC-KR), up to 16 MiB or 50,000 cues.
- Some MKV layouts are rejected for safety (e.g. multiple Segments, unknown-size Clusters). This is not a full MKVToolNix replacement.
- Beta (v0.2): not yet tested on multi-GB real-world files, so keep your originals. See [test results](docs/TEST_RESULTS.md).

Found a problem? [Open an issue](https://github.com/godxxy1229/mkv-subtitle-studio/issues) with your browser, the error message, and `ffprobe -show_streams` output. Please don't attach the video itself.

## Development

No dependencies; requires Node.js 20+.

```sh
npm run serve             # http://localhost:8000
npm test                  # unit tests
npm run test:integration  # needs ffmpeg and ffprobe
```

Pushing to `main` deploys to GitHub Pages ([DEPLOY.md](DEPLOY.md), in Korean).

## License

[MIT](LICENSE). Inspired by [MKV Fast Muxer](https://github.com/11576865/MKV-Fast-Muxer); this is an independent implementation and copies none of its code.
