<div align="center">
  <img src="downs.png" alt="Downs icon" width="300">
</div>

# Downs: Dead-Simple M3U8 Downloader

A lightweight Python GUI for downloading M3U8 / HLS streaming playlists into MP4 files using FFmpeg.

It is intentionally small: paste URL, name file, download. No cathedral. Just a useful little goblin with a hard hat.

## Features

- **Paste-to-download:** Press `Cmd+V` on macOS or `Ctrl+V` on Windows/Linux to detect a copied stream URL.
- **Manual URL entry:** Paste or type a stream URL into the input field and click `Download`.
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
