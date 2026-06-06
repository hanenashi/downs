<div align="center">
  <img src="downs.png" alt="Downs icon" width="300">
</div>

# Downs: Dead-Simple M3U8 Downloader

A lightweight Python GUI for downloading M3U8 / HLS streaming playlists into MP4 files using FFmpeg.

It is intentionally small: paste URL, name file, download. No cathedral. Just a useful little goblin with a hard hat.

## Features

- **Paste-to-download:** Press `Cmd+V` on macOS or `Ctrl+V` on Windows/Linux to detect a copied stream URL.
- **Manual URL entry:** Paste or type a stream URL into the input field and click `Download`.
- **Browser addon feed:** Use the included extension to pick detected M3U8 links from a tab and send them to Downs.
- **Multiple downloads:** Start several downloads at once.
- **Progress tracking:** Probes stream duration when available and shows progress.
- **Safer filenames:** Cleans invalid filename characters before saving.
- **No silent overwrite:** If a file already exists, Downs automatically appends `_2`, `_3`, etc.
- **Useful error logs:** FFmpeg failure output is shown in the log box.
- **Auto-cleanup option:** Finished jobs can be removed from the list automatically.
- **Portable:** Works on macOS and Windows as long as FFmpeg is available.

## Prerequisites

Downs is a wrapper around **FFmpeg**. You must have FFmpeg installed.

### macOS

Using Homebrew:

```bash
brew install ffmpeg
```

## Browser addon link sucker

Downs includes a tiny unpacked browser extension in `extension/` that watches the current tab for HLS playlist traffic and feeds selected links straight into the desktop app.

### How it works

1. Start `downs.py`. The app opens a local-only feed endpoint at `http://127.0.0.1:8765/download`.
2. Load `extension/` as an unpacked extension in a Chromium-style browser.
3. Open a page with an HLS video and start playback so the browser requests the playlist.
4. Click the Downs Link Sucker toolbar button.
5. Pick a detected `.m3u8` link and click `Download`.

The addon sends the selected URL to the running Downs app. Downs starts the FFmpeg download immediately, saves it to the configured default folder, and gives it a random `downs_YYYYMMDD_HHMMSS_xxxxxx` filename so there is no naming prompt.

### Loading the extension in Chrome / Edge / Brave

1. Open `chrome://extensions` (or the browser's equivalent extensions page).
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this repo's `extension/` folder.

The addon is intentionally small: it does not download anything itself, render previews, or scrape page HTML. It only observes network responses that look like M3U8/HLS playlists and hands the chosen URL to Downs.
