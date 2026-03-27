import tkinter as tk
from tkinter import ttk, simpledialog, messagebox, filedialog
import subprocess
import threading
import re
import os
import json
import shutil

# --- Configuration ---
# Fix for Mac: Save settings in the User's Home directory so it's never lost
CONFIG_FILE = os.path.join(os.path.expanduser("~"), ".downs_config.json")

DEFAULT_CONFIG = {
    "save_dir": os.path.join(os.path.expanduser("~"), "Desktop"),
    "ffmpeg_path": "",
    "auto_remove": False
}

def load_config():
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r") as f:
                return {**DEFAULT_CONFIG, **json.load(f)}
        except:
            pass
    return DEFAULT_CONFIG.copy()

def save_config(config):
    try:
        with open(CONFIG_FILE, "w") as f:
            json.dump(config, f, indent=4)
    except Exception as e:
        print(f"Failed to save config: {e}")

class FfmpegDownloaderApp:
    def __init__(self, root):
        self.root = root
        self.root.title("M3U8 Downloader Pro")
        self.root.geometry("800x600")
        
        # Polish: Use native OS theme if available (makes Mac look like Mac)
        style = ttk.Style()
        if 'aqua' in style.theme_names():
            style.theme_use('aqua')
            
        self.config = load_config()
        self.tasks = []

        # --- Top Bar ---
        top_frame = ttk.Frame(root, padding=10)
        top_frame.pack(fill="x")
        
        ttk.Label(top_frame, text="M3U8 URL:", font=("Helvetica", 12, "bold")).pack(side="left")
        self.url_entry = ttk.Entry(top_frame)
        self.url_entry.pack(side="left", fill="x", expand=True, padx=10)
        
        ttk.Button(top_frame, text="Download", command=self.manual_add_task).pack(side="left", padx=2)
        ttk.Button(top_frame, text="⚙ Settings", command=self.open_settings).pack(side="left", padx=2)

        # --- Task List (Polished) ---
        list_container = ttk.Frame(root, padding=(10, 0))
        list_container.pack(side="top", fill="both", expand=True)
        
        self.canvas = tk.Canvas(list_container, borderwidth=0, highlightthickness=0, background="#ececec")
        self.scrollbar = ttk.Scrollbar(list_container, orient="vertical", command=self.canvas.yview)
        self.scrollable_frame = ttk.Frame(self.canvas)

        self.scrollable_frame.bind(
            "<Configure>",
            lambda e: self.canvas.configure(scrollregion=self.canvas.bbox("all"))
        )

        self.canvas.create_window((0, 0), window=self.scrollable_frame, anchor="nw")
        self.canvas.configure(yscrollcommand=self.scrollbar.set)

        self.canvas.pack(side="left", fill="both", expand=True)
        self.scrollbar.pack(side="right", fill="y")
        
        # --- Logs Section (with scrollbar & copy button) ---
        log_outer_frame = ttk.LabelFrame(root, text="System Logs", padding=5)
        log_outer_frame.pack(fill="x", padx=10, pady=10, side="bottom")
        
        # Small top bar for logs
        log_tools = ttk.Frame(log_outer_frame)
        log_tools.pack(fill="x")
        ttk.Button(log_tools, text="Copy Logs", command=self.copy_logs).pack(side="right", pady=2)
        
        # Text and Scrollbar
        log_inner = ttk.Frame(log_outer_frame)
        log_inner.pack(fill="both", expand=True)
        
        self.log_text = tk.Text(log_inner, height=6, state="disabled", font=("Menlo", 11), wrap="word")
        log_scroll = ttk.Scrollbar(log_inner, orient="vertical", command=self.log_text.yview)
        self.log_text.configure(yscrollcommand=log_scroll.set)
        
        self.log_text.pack(side="left", fill="both", expand=True)
        log_scroll.pack(side="right", fill="y")

        # --- Bindings ---
        self.root.bind_all("<Command-v>", self.handle_paste)
        self.root.bind_all("<Control-v>", self.handle_paste)

        self.log("Ready. Press Cmd+V anywhere to paste a link and start.")
        self.check_ffmpeg_status()

    # --- Core Helpers ---

    def resolve_ffmpeg(self):
        if self.config["ffmpeg_path"] and os.path.exists(self.config["ffmpeg_path"]):
            return self.config["ffmpeg_path"]
        script_dir = os.path.dirname(os.path.abspath(__file__))
        exe_name = "ffmpeg.exe" if os.name == 'nt' else "ffmpeg"
        local_path = os.path.join(script_dir, exe_name)
        if os.path.exists(local_path):
            return local_path
        return shutil.which("ffmpeg")

    def check_ffmpeg_status(self):
        path = self.resolve_ffmpeg()
        if path:
            self.log(f"FFmpeg found: {path}")
        else:
            self.log("WARNING: FFmpeg not found! Please check Settings.", is_error=True)

    def log(self, message, is_error=False):
        def _log():
            self.log_text.config(state="normal")
            prefix = "[ERROR] " if is_error else "[INFO] "
            self.log_text.insert("end", prefix + message + "\n")
            self.log_text.see("end")
            self.log_text.config(state="disabled")
        self.root.after(0, _log)

    def copy_logs(self):
        self.root.clipboard_clear()
        self.root.clipboard_append(self.log_text.get("1.0", tk.END))
        messagebox.showinfo("Copied", "Logs copied to clipboard!")

    # --- Settings ---
    def open_settings(self):
        win = tk.Toplevel(self.root)
        win.title("Settings")
        win.geometry("550x300")
        win.configure(padx=20, pady=20)
        
        ttk.Label(win, text="Download Folder:", font=("Helvetica", 12, "bold")).pack(anchor="w", pady=(0, 5))
        f_frame = ttk.Frame(win)
        f_frame.pack(fill="x", pady=(0, 15))
        dir_var = tk.StringVar(value=self.config["save_dir"])
        ttk.Entry(f_frame, textvariable=dir_var).pack(side="left", fill="x", expand=True, padx=(0, 10))
        ttk.Button(f_frame, text="Browse...", command=lambda: dir_var.set(filedialog.askdirectory() or dir_var.get())).pack(side="left")

        ttk.Label(win, text="Custom FFmpeg Path (Optional):", font=("Helvetica", 12, "bold")).pack(anchor="w", pady=(0, 5))
        ff_frame = ttk.Frame(win)
        ff_frame.pack(fill="x", pady=(0, 15))
        ff_var = tk.StringVar(value=self.config["ffmpeg_path"])
        ttk.Entry(ff_frame, textvariable=ff_var).pack(side="left", fill="x", expand=True, padx=(0, 10))
        ttk.Button(ff_frame, text="Browse...", command=lambda: ff_var.set(filedialog.askopenfilename() or ff_var.get())).pack(side="left")
        
        ar_var = tk.BooleanVar(value=self.config["auto_remove"])
        ttk.Checkbutton(win, text="Auto-remove finished jobs from queue", variable=ar_var).pack(anchor="w", pady=10)

        def save():
            self.config["save_dir"] = dir_var.get()
            self.config["ffmpeg_path"] = ff_var.get()
            self.config["auto_remove"] = ar_var.get()
            save_config(self.config)
            self.check_ffmpeg_status()
            win.destroy()
            
        ttk.Button(win, text="Save Settings", command=save).pack(pady=20)

    # --- Task Logic ---
    def handle_paste(self, event):
        try:
            content = self.root.clipboard_get()
            if "http" in content or ".m3u8" in content:
                filename = simpledialog.askstring("New Download", "URL detected!\nEnter filename (no extension):")
                if filename:
                    self.start_download(content.strip(), filename)
        except:
            pass 

    def manual_add_task(self):
        url = self.url_entry.get().strip()
        if not url: return
        filename = simpledialog.askstring("Filename", "Enter output filename (no extension):")
        if filename:
            self.start_download(url, filename)
            self.url_entry.delete(0, 'end')

    def start_download(self, url, filename):
        ffmpeg_bin = self.resolve_ffmpeg()
        if not ffmpeg_bin:
            messagebox.showerror("Error", "FFmpeg not found. Check Settings.")
            return

        task_ui = TaskRow(self.scrollable_frame, filename, url, self)
        self.tasks.append(task_ui)
        
        # Update canvas scroll region after adding row
        self.root.after(100, lambda: self.canvas.configure(scrollregion=self.canvas.bbox("all")))
        
        t = threading.Thread(target=self.process_download, args=(task_ui, ffmpeg_bin))
        t.daemon = True
        t.start()
    
    def delete_task(self, task_ui):
        if task_ui in self.tasks:
            self.tasks.remove(task_ui)
        self.root.after(0, task_ui.frame.destroy)

    def process_download(self, task, ffmpeg_bin):
        filepath = os.path.join(self.config["save_dir"], f"{task.filename}.mp4")
        task.update_status("Probing...")
        duration = self.get_duration(ffmpeg_bin, task.url)
        task.duration = duration
        self.log(f"Started: {task.filename}")

        cmd = [
            ffmpeg_bin, "-protocol_whitelist", "file,http,https,tcp,tls,crypto",
            "-y", "-i", task.url, "-c", "copy",
            "-bsf:a", "aac_adtstoasc", filepath
        ]

        try:
            startupinfo = None
            if os.name == 'nt':
                startupinfo = subprocess.STARTUPINFO()
                startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW

            process = subprocess.Popen(
                cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, 
                universal_newlines=True, startupinfo=startupinfo
            )
            task.process = process

            while True:
                line = process.stderr.readline()
                if not line and process.poll() is not None:
                    break
                if line and task.duration > 0:
                    match = re.search(r"time=(\d{2}:\d{2}:\d{2}\.\d{2})", line)
                    if match:
                        sec = self.parse_time(match.group(1))
                        percent = (sec / task.duration) * 100
                        task.update_progress(percent, f"{int(percent)}%")

            if process.poll() == 0:
                task.update_status("Done")
                task.update_progress(100, "100%")
                task.mark_finished()
                self.log(f"Finished: {task.filename}")
                if self.config["auto_remove"]:
                    self.root.after(1500, lambda: self.delete_task(task))
            else:
                if task.cancelled:
                    task.update_status("Cancelled")
                else:
                    task.update_status("Error")
                    self.log(f"Error: {task.filename}", is_error=True)
                task.mark_finished()
        except Exception as e:
            self.log(f"System Error: {str(e)}", is_error=True)
            task.mark_finished()

    def get_duration(self, ffmpeg_bin, url):
        try:
            startupinfo = None
            if os.name == 'nt':
                startupinfo = subprocess.STARTUPINFO()
                startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            cmd = [ffmpeg_bin, "-i", url]
            result = subprocess.run(cmd, stderr=subprocess.PIPE, stdout=subprocess.PIPE, text=True, startupinfo=startupinfo)
            match = re.search(r"Duration: (\d{2}:\d{2}:\d{2}\.\d{2})", result.stderr)
            if match:
                return self.parse_time(match.group(1))
        except:
            pass
        return 0

    def parse_time(self, time_str):
        try:
            h, m, s = time_str.split(':')
            return int(h) * 3600 + int(m) * 60 + float(s)
        except:
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

        # Polish: Use grid layout for perfectly aligned columns
        self.frame = ttk.Frame(parent, padding=5, relief="groove")
        # Let the frame stretch across the canvas
        self.frame.pack(fill="x", pady=2, padx=5, expand=True)
        
        self.frame.columnconfigure(1, weight=1) # Makes progress bar expand

        # Column 0: Filename
        short_name = filename if len(filename) < 25 else filename[:22] + "..."
        self.lbl_name = ttk.Label(self.frame, text=short_name, width=25, font=("Helvetica", 11, "bold"))
        self.lbl_name.grid(row=0, column=0, sticky="w", padx=(5, 10))

        # Column 1: Progress Bar
        self.progress_var = tk.DoubleVar()
        self.progress_bar = ttk.Progressbar(self.frame, variable=self.progress_var, maximum=100)
        self.progress_bar.grid(row=0, column=1, sticky="ew", padx=10)

        # Column 2: Status
        self.status_label = ttk.Label(self.frame, text="Queued", width=10, anchor="center")
        self.status_label.grid(row=0, column=2, padx=10)

        # Column 3: Button
        self.action_btn = ttk.Button(self.frame, text="Cancel", command=self.on_click, width=8)
        self.action_btn.grid(row=0, column=3, padx=(10, 5))

    def update_progress(self, val, text):
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
        if self.process and self.process.poll() is None:
            self.process.terminate()
            self.update_status("Cancelling...")

    def mark_finished(self):
        self.is_finished = True
        self.app.root.after(0, lambda: self.action_btn.config(text="Clear"))

if __name__ == "__main__":
    root = tk.Tk()
    app = FfmpegDownloaderApp(root)
    root.mainloop()