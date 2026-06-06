import tkinter as tk
from tkinter import ttk, simpledialog, messagebox, filedialog
import subprocess
import threading
import re
import os
import json
import shutil
import secrets
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


# --- Configuration ---
CONFIG_FILE = os.path.join(os.path.expanduser("~"), ".downs_config.json")
FEED_HOST = "127.0.0.1"
FEED_PORT = 8765

DEFAULT_CONFIG = {
    "save_dir": os.path.join(os.path.expanduser("~"), "Desktop"),
    "ffmpeg_path": "",
    "auto_remove": False
}


def load_config():
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                return {**DEFAULT_CONFIG, **json.load(f)}
        except Exception:
            pass
    return DEFAULT_CONFIG.copy()


def save_config(config):
    try:
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=4)
    except Exception as e:
        print(f"Failed to save config: {e}")


class FfmpegDownloaderApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Downs - M3U8 Downloader")
        self.root.geometry("800x600")

        style = ttk.Style()
        if "aqua" in style.theme_names():
            style.theme_use("aqua")

        self.config = load_config()
        self.tasks = []
        self.feed_server = None

        self.root.protocol("WM_DELETE_WINDOW", self.on_close)

        # --- Top Bar ---
        top_frame = ttk.Frame(root, padding=10)
        top_frame.pack(fill="x")

        ttk.Label(top_frame, text="M3U8 URL:", font=("Helvetica", 12, "bold")).pack(side="left")

        self.url_entry = ttk.Entry(top_frame)
        self.url_entry.pack(side="left", fill="x", expand=True, padx=10)

        ttk.Button(top_frame, text="Download", command=self.manual_add_task).pack(side="left", padx=2)
        ttk.Button(top_frame, text="Settings", command=self.open_settings).pack(side="left", padx=2)

        # --- Task List ---
        list_container = ttk.Frame(root, padding=(10, 0))
        list_container.pack(side="top", fill="both", expand=True)

        self.canvas = tk.Canvas(
            list_container,
            borderwidth=0,
            highlightthickness=0,
            background="#ececec"
        )
        self.scrollbar = ttk.Scrollbar(list_container, orient="vertical", command=self.canvas.yview)
        self.scrollable_frame = ttk.Frame(self.canvas)

        self.scrollable_frame.bind(
            "<Configure>",
            lambda e: self.canvas.configure(scrollregion=self.canvas.bbox("all"))
        )

        self.canvas_window = self.canvas.create_window(
            (0, 0),
            window=self.scrollable_frame,
            anchor="nw"
        )
        self.canvas.configure(yscrollcommand=self.scrollbar.set)

        self.canvas.bind("<Configure>", self.on_canvas_resize)

        self.canvas.pack(side="left", fill="both", expand=True)
        self.scrollbar.pack(side="right", fill="y")

        # --- Logs Section ---
        log_outer_frame = ttk.LabelFrame(root, text="System Logs", padding=5)
        log_outer_frame.pack(fill="x", padx=10, pady=10, side="bottom")

        log_tools = ttk.Frame(log_outer_frame)
        log_tools.pack(fill="x")

        ttk.Button(log_tools, text="Copy Logs", command=self.copy_logs).pack(side="right", pady=2)
        ttk.Button(log_tools, text="Clear Logs", command=self.clear_logs).pack(side="right", padx=5, pady=2)

        log_inner = ttk.Frame(log_outer_frame)
        log_inner.pack(fill="both", expand=True)

        self.log_text = tk.Text(
            log_inner,
            height=6,
            state="disabled",
            font=("Menlo", 11),
            wrap="word"
        )
        log_scroll = ttk.Scrollbar(log_inner, orient="vertical", command=self.log_text.yview)
        self.log_text.configure(yscrollcommand=log_scroll.set)

        self.log_text.pack(side="left", fill="both", expand=True)
        log_scroll.pack(side="right", fill="y")

        # --- Bindings ---
        self.root.bind_all("<Command-v>", self.handle_paste)
        self.root.bind_all("<Control-v>", self.handle_paste)

        self.log("Ready. Paste an M3U8 URL with Cmd+V / Ctrl+V, or enter it manually.")
        self.check_ffmpeg_status()
        self.start_feed_server()

    # --- UI helpers ---

    def on_canvas_resize(self, event):
        self.canvas.itemconfigure(self.canvas_window, width=event.width)

    def log(self, message, is_error=False):
        def _log():
            self.log_text.config(state="normal")
            prefix = "[ERROR] " if is_error else "[INFO] "
            self.log_text.insert("end", prefix + str(message) + "\n")
            self.log_text.see("end")
            self.log_text.config(state="disabled")

        self.root.after(0, _log)

    def copy_logs(self):
        self.root.clipboard_clear()
        self.root.clipboard_append(self.log_text.get("1.0", tk.END))
        messagebox.showinfo("Copied", "Logs copied to clipboard.")

    def clear_logs(self):
        self.log_text.config(state="normal")
        self.log_text.delete("1.0", tk.END)
        self.log_text.config(state="disabled")

    def on_close(self):
        if self.feed_server:
            self.feed_server.shutdown()
            self.feed_server.server_close()

        self.root.destroy()

    def start_feed_server(self):
        app = self

        class FeedHandler(BaseHTTPRequestHandler):
            def log_message(self, format, *args):
                return

            def end_headers(self):
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Content-Type")
                super().end_headers()

            def do_OPTIONS(self):
                self.send_response(204)
                self.end_headers()

            def do_POST(self):
                if self.path != "/download":
                    self.send_json(404, {"ok": False, "error": "Not found"})
                    return

                length = int(self.headers.get("Content-Length", "0") or 0)
                raw_body = self.rfile.read(min(length, 65536))

                try:
                    payload = json.loads(raw_body.decode("utf-8"))
                except Exception:
                    self.send_json(400, {"ok": False, "error": "Expected JSON body"})
                    return

                url = app.extract_url_from_text(payload.get("url", "")) or str(payload.get("url", "")).strip()

                if not app.looks_like_stream_url(url):
                    self.send_json(400, {"ok": False, "error": "Expected an http/https stream URL"})
                    return

                if not app.resolve_ffmpeg():
                    self.send_json(503, {"ok": False, "error": "FFmpeg not found in Downs"})
                    return

                filename = app.random_download_name()
                app.root.after(0, lambda: app.start_download(url, filename, source="browser addon"))
                self.send_json(202, {"ok": True, "filename": filename})

            def send_json(self, status, payload):
                body = json.dumps(payload).encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        try:
            self.feed_server = ThreadingHTTPServer((FEED_HOST, FEED_PORT), FeedHandler)
        except OSError as e:
            self.log(f"Browser addon feed unavailable on http://{FEED_HOST}:{FEED_PORT}: {e}", is_error=True)
            return

        t = threading.Thread(target=self.feed_server.serve_forever, daemon=True)
        t.start()
        self.log(f"Browser addon feed listening at http://{FEED_HOST}:{FEED_PORT}/download")

    # --- Core helpers ---

    def resolve_ffmpeg(self):
        custom_path = self.config.get("ffmpeg_path", "").strip()

        if custom_path and os.path.exists(custom_path):
            return custom_path

        script_dir = os.path.dirname(os.path.abspath(__file__))
        exe_name = "ffmpeg.exe" if os.name == "nt" else "ffmpeg"
        local_path = os.path.join(script_dir, exe_name)

        if os.path.exists(local_path):
            return local_path

        return shutil.which("ffmpeg")

    def check_ffmpeg_status(self):
        path = self.resolve_ffmpeg()
        if path:
            self.log(f"FFmpeg found: {path}")
        else:
            self.log("WARNING: FFmpeg not found. Set FFmpeg path in Settings.", is_error=True)

    def make_startupinfo(self):
        if os.name != "nt":
            return None

        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        return startupinfo

    def safe_filename(self, name):
        name = str(name).strip()
        name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name)
        name = re.sub(r"\s+", " ", name)
        name = name.strip(" .")
        return name or "download"

    def unique_output_path(self, folder, filename):
        os.makedirs(folder, exist_ok=True)

        base = self.safe_filename(filename)
        path = os.path.join(folder, base + ".mp4")

        if not os.path.exists(path):
            return path, base

        counter = 2
        while True:
            candidate_base = f"{base}_{counter}"
            candidate_path = os.path.join(folder, candidate_base + ".mp4")

            if not os.path.exists(candidate_path):
                return candidate_path, candidate_base

            counter += 1

    def extract_url_from_text(self, text):
        text = str(text).strip()

        match = re.search(r"https?://[^\s\"'<>]+", text, re.IGNORECASE)
        if not match:
            return ""

        url = match.group(0).strip()

        # Trim common punctuation accidentally copied after URLs.
        url = url.rstrip(").,;]}>")

        return url

    def looks_like_stream_url(self, url):
        if not re.match(r"^https?://", url, re.IGNORECASE):
            return False

        # Keep it permissive. Some HLS URLs are signed and ugly.
        # But at least require a real URL, not random pasted text saying "http lol".
        return True

    def random_download_name(self):
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        suffix = secrets.token_hex(3)
        return f"downs_{timestamp}_{suffix}"

    def parse_time(self, time_str):
        try:
            h, m, s = time_str.split(":")
            return int(h) * 3600 + int(m) * 60 + float(s)
        except Exception:
            return 0

    # --- Settings ---

    def open_settings(self):
        win = tk.Toplevel(self.root)
        win.title("Settings")
        win.geometry("550x300")
        win.configure(padx=20, pady=20)

        ttk.Label(win, text="Download Folder:", font=("Helvetica", 12, "bold")).pack(
            anchor="w",
            pady=(0, 5)
        )

        f_frame = ttk.Frame(win)
        f_frame.pack(fill="x", pady=(0, 15))

        dir_var = tk.StringVar(value=self.config.get("save_dir", DEFAULT_CONFIG["save_dir"]))

        ttk.Entry(f_frame, textvariable=dir_var).pack(
            side="left",
            fill="x",
            expand=True,
            padx=(0, 10)
        )

        ttk.Button(
            f_frame,
            text="Browse...",
            command=lambda: dir_var.set(filedialog.askdirectory() or dir_var.get())
        ).pack(side="left")

        ttk.Label(win, text="Custom FFmpeg Path (Optional):", font=("Helvetica", 12, "bold")).pack(
            anchor="w",
            pady=(0, 5)
        )

        ff_frame = ttk.Frame(win)
        ff_frame.pack(fill="x", pady=(0, 15))

        ff_var = tk.StringVar(value=self.config.get("ffmpeg_path", ""))

        ttk.Entry(ff_frame, textvariable=ff_var).pack(
            side="left",
            fill="x",
            expand=True,
            padx=(0, 10)
        )

        ttk.Button(
            ff_frame,
            text="Browse...",
            command=lambda: ff_var.set(filedialog.askopenfilename() or ff_var.get())
        ).pack(side="left")

        ar_var = tk.BooleanVar(value=self.config.get("auto_remove", False))

        ttk.Checkbutton(
            win,
            text="Auto-remove finished jobs from queue",
            variable=ar_var
        ).pack(anchor="w", pady=10)

        def save():
            self.config["save_dir"] = dir_var.get().strip() or DEFAULT_CONFIG["save_dir"]
            self.config["ffmpeg_path"] = ff_var.get().strip()
            self.config["auto_remove"] = ar_var.get()

            save_config(self.config)
            self.log("Settings saved.")
            self.check_ffmpeg_status()
            win.destroy()

        ttk.Button(win, text="Save Settings", command=save).pack(pady=20)

    # --- Task logic ---

    def handle_paste(self, event):
        try:
            content = self.root.clipboard_get()
        except Exception:
            return

        url = self.extract_url_from_text(content)

        if not url or not self.looks_like_stream_url(url):
            return

        filename = simpledialog.askstring(
            "New Download",
            "URL detected.\nEnter filename, without extension:"
        )

        if filename:
            self.start_download(url, filename)

    def manual_add_task(self):
        raw_url = self.url_entry.get().strip()
        url = self.extract_url_from_text(raw_url) or raw_url

        if not url:
            return

        if not self.looks_like_stream_url(url):
            messagebox.showerror("Bad URL", "Please enter a valid http/https stream URL.")
            return

        filename = simpledialog.askstring(
            "Filename",
            "Enter output filename, without extension:"
        )

        if filename:
            self.start_download(url, filename)
            self.url_entry.delete(0, "end")

    def start_download(self, url, filename, source="manual"):
        ffmpeg_bin = self.resolve_ffmpeg()

        if not ffmpeg_bin:
            messagebox.showerror("Error", "FFmpeg not found. Check Settings.")
            return

        safe_name = self.safe_filename(filename)

        if source != "manual":
            self.log(f"Received from {source}: {url}")

        task_ui = TaskRow(self.scrollable_frame, safe_name, url, self)
        self.tasks.append(task_ui)

        self.root.after(
            100,
            lambda: self.canvas.configure(scrollregion=self.canvas.bbox("all"))
        )

        t = threading.Thread(target=self.process_download, args=(task_ui, ffmpeg_bin))
        t.daemon = True
        t.start()

    def delete_task(self, task_ui):
        if task_ui in self.tasks:
            self.tasks.remove(task_ui)

        self.root.after(0, task_ui.frame.destroy)

    def process_download(self, task, ffmpeg_bin):
        try:
            filepath, safe_name = self.unique_output_path(
                self.config.get("save_dir", DEFAULT_CONFIG["save_dir"]),
                task.filename
            )

            task.set_filename(safe_name)

            task.update_status("Probing...")
            duration = self.get_duration(ffmpeg_bin, task.url)
            task.duration = duration

            if duration > 0:
                self.log(f"Duration detected for {task.filename}: {int(duration)} seconds")
            else:
                self.log(f"No fixed duration detected for {task.filename}. Progress may stay unknown.")

            self.log(f"Started: {task.filename}")

            cmd = [
                ffmpeg_bin,
                "-protocol_whitelist", "file,http,https,tcp,tls,crypto",
                "-y",
                "-i", task.url,
                "-c", "copy",
                "-bsf:a", "aac_adtstoasc",
                filepath
            ]

            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                universal_newlines=True,
                startupinfo=self.make_startupinfo(),
                bufsize=1,
                errors="replace"
            )

            task.process = process
            last_lines = []

            while True:
                line = process.stderr.readline()

                if not line and process.poll() is not None:
                    break

                if not line:
                    continue

                clean_line = line.strip()
                if clean_line:
                    last_lines.append(clean_line)
                    last_lines = last_lines[-20:]

                if task.duration > 0:
                    match = re.search(r"time=(\d{2}:\d{2}:\d{2}(?:\.\d+)?)", line)
                    if match:
                        sec = self.parse_time(match.group(1))
                        percent = (sec / task.duration) * 100
                        percent = max(0, min(100, percent))
                        task.update_progress(percent, f"{int(percent)}%")
                else:
                    task.update_status("Working")

            return_code = process.poll()

            if return_code == 0:
                task.update_status("Done")
                task.update_progress(100, "100%")
                task.mark_finished()
                self.log(f"Finished: {task.filename}")
                self.log(f"Saved to: {filepath}")

                if self.config.get("auto_remove", False):
                    self.root.after(1500, lambda: self.delete_task(task))

            else:
                if task.cancelled:
                    task.update_status("Cancelled")
                    self.log(f"Cancelled: {task.filename}")
                else:
                    task.update_status("Error")
                    self.log(f"Error: {task.filename} (FFmpeg exit code {return_code})", is_error=True)

                    if last_lines:
                        self.log("Last FFmpeg messages:", is_error=True)
                        for errline in last_lines[-8:]:
                            self.log(errline, is_error=True)

                task.mark_finished()

        except Exception as e:
            task.update_status("Error")
            self.log(f"System Error: {str(e)}", is_error=True)
            task.mark_finished()

    def get_duration(self, ffmpeg_bin, url):
        try:
            cmd = [ffmpeg_bin, "-i", url]

            result = subprocess.run(
                cmd,
                stderr=subprocess.PIPE,
                stdout=subprocess.PIPE,
                text=True,
                startupinfo=self.make_startupinfo(),
                timeout=30,
                errors="replace"
            )

            match = re.search(r"Duration: (\d{2}:\d{2}:\d{2}\.\d+)", result.stderr)

            if match:
                return self.parse_time(match.group(1))

        except subprocess.TimeoutExpired:
            self.log("Duration probe timed out. Continuing without fixed progress.")
        except Exception as e:
            self.log(f"Duration probe failed: {e}")

        return 0


class TaskRow:
    def __init__(self, parent, filename, url, app):
        self.app = app
        self.filename = filename
        self.url = url
        self.process = None
        self.cancelled = False
        self.duration = 0
        self.is_finished = False

        self.frame = ttk.Frame(parent, padding=5, relief="groove")
        self.frame.pack(fill="x", pady=2, padx=5, expand=True)

        self.frame.columnconfigure(1, weight=1)

        short_name = self.make_short_name(filename)
        self.lbl_name = ttk.Label(
            self.frame,
            text=short_name,
            width=25,
            font=("Helvetica", 11, "bold")
        )
        self.lbl_name.grid(row=0, column=0, sticky="w", padx=(5, 10))

        self.progress_var = tk.DoubleVar()
        self.progress_bar = ttk.Progressbar(
            self.frame,
            variable=self.progress_var,
            maximum=100
        )
        self.progress_bar.grid(row=0, column=1, sticky="ew", padx=10)

        self.status_label = ttk.Label(
            self.frame,
            text="Queued",
            width=12,
            anchor="center"
        )
        self.status_label.grid(row=0, column=2, padx=10)

        self.action_btn = ttk.Button(
            self.frame,
            text="Cancel",
            command=self.on_click,
            width=8
        )
        self.action_btn.grid(row=0, column=3, padx=(10, 5))

    def make_short_name(self, filename):
        return filename if len(filename) < 25 else filename[:22] + "..."

    def set_filename(self, filename):
        self.filename = filename
        short_name = self.make_short_name(filename)
        self.app.root.after(0, lambda: self.lbl_name.config(text=short_name))

    def update_progress(self, val, text):
        val = max(0, min(100, val))
        self.app.root.after(0, lambda: self.progress_var.set(val))
        self.app.root.after(0, lambda: self.status_label.config(text=text))

    def update_status(self, text):
        self.app.root.after(0, lambda: self.status_label.config(text=text))

    def on_click(self):
        if self.is_finished:
            self.app.delete_task(self)
        else:
            self.cancel()

    def cancel(self):
        self.cancelled = True
        self.update_status("Cancelling...")

        if self.process and self.process.poll() is None:
            t = threading.Thread(target=self.stop_process)
            t.daemon = True
            t.start()

    def stop_process(self):
        try:
            if self.process and self.process.poll() is None:
                self.process.terminate()

                try:
                    self.process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self.process.kill()

        except Exception as e:
            self.app.log(f"Cancel failed: {e}", is_error=True)

    def mark_finished(self):
        self.is_finished = True
        self.app.root.after(0, lambda: self.action_btn.config(text="Clear"))


if __name__ == "__main__":
    root = tk.Tk()
    app = FfmpegDownloaderApp(root)
    root.mainloop()
