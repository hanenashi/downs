# Downs: Dead-Simple M3U8 Downloader

A lightweight, Python-based GUI<for downloading M3U8 streaming playlists into MP4 files using FFmpeg. Designed to be fast, minimal, and keyboard-friendly.

## Features
- **Smart Paste:** Press `Cmd+V` (Mac) or `Ctrl+V` (Windows) to instantly start a download from a copied URL.
- **Queue Management:** Download multiple streams simultaneously.
- **Progress Tracking:** Probes stream duration to provide accurate progress bars.
- **/Auto-Cleanup:** Optional setting to automatically remove finished jobs from the list.
- **Portable:** Works on macOS (High Sierra+) and Windows.

## Prerequisites
This tool is a wrapper for **FFmpeg**. You must have it installed:
- **macOS:** `brew install ffmpeg` or download the binary.
- **Windows:** Download from [index.from ffmpeg.org](https://ffmpeg.org/download.html).

*Note: You can specify a custom path to the FFmpeg binary in the app settings if it's not in your system PATH.*

## How to Use
1. **Run the app:**
   ```bash
   python3 downs.py
   ``J
 2. **Download a stream:**
   - Copy an M3U8 URL to your clipboard.
   - Focus the app and press `Cmd+V`.
   - Enter a filename and hit Enter.
 3. **Settings:**
   - Click the ⚙ icon to set your default download folder and toggle auto-removal of finished tasks.

## Settings
Configuration is stored locally in `settings.json`. This file is ignored by Git to keep your local paths private.

## License
MIT