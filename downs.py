import tkinter as tk
from tkinter import ttk, simpledialog, messagebox, filedialog
import subprocess
import threading
import re
import os
import json
import shutil
import time

# --- Configuration ---
CONFIG_FILE = "settings.json"
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
        self.root.geometry("750x550")
        
        self.config = load_config()
        self.tasks = []

        # --- Top Bar ---
        top_frame = tk.Frame(root, pady=10, padx=10)
        top_frame.pack(fill="x")
        
        tk.Label(top_frame, text="URL:").pack(side="left")
        self.url_entry = tk.Entry(top_frame)
        self.url_entry.pack(side="left", fill="x", expand=True, padx=5)
        
        tk.Button(top_frame, text="Download", command=self.manual_add_task).pack(side="left", padx=2)
        tk.Button(top_frame, text="⚙ Settings", command=self.open_settings).pack(side="left", padx=2)

        # --- Task List ---
        self.canvas = tk.Canvas(root, borderwidth=0, background="#f0f0f0")
        self.scrollbar = tk.Scrollbar(root, orient="vertical", command=self.canvas.yview)
        self.scrollable_frame = tk.Frame(self.canvas, background="#f0f0f0")

        self.scrollable_frame.bind(
            "<Configure>",
            lambda e: self.canvas.configure(scrollregion=self.canvas.bbox("all"))
        )

        self.canvas.create_window((0, 0), window=self.scrollable_frame, anchor="nw")
        self.canvas.configure(yscrollcommand=self.scrollbar.set)

        self.canvas.pack(side="top", fill="both", expand=True, padx=10)
        self.scrollbar.pack(side="right", fill="y")
        
        # --- Logs ---
        log_frame = tk.LabelFrame(root, text="Logs", padx=5, pady=5)
        log_frame.pack(fill="x", padx=10, pady=10, side="bottom")
        
        self.log_text = tk.Text(log_frame, height=5, state="disabled", font=("Menlo", 9))
        self.log_text.pack(fill="both", expand=True)

        # --- Bindings ---
        self.root.bind_all("<Command-v>", self.handle_paste)
        self.root.bind_all("<Control-v>", self.handle_paste)

        self.log("Ready.")
        self.check_ffmpeg_status()

    # --- Core Helpers ---

    def resolve_ffmpeg(self):
        # 1. Configured path
        if self.config["ffmpeg_path"] and os.path.exists(self.config["ffmpeg_path"]):
            return self.config["ffmpeg_path"]
        # 2. Script Directory
        script_dir = os.path.dirname(os.path.abspath(__file__))
        exe_name = "ffmpeg.exe" if os.name == 'nt' else "ffmpeg"
        local_path = os.path.join(script_dir, exe_name)
        if os.path.exists(local_path):
            return local_path
        # 3. System PATH
        return shutil.which("ffmpeg")

    def check_ffmpeg_status(self):
        path = self.resolve_ffmpeg()
        if path:
            self.log(f"FFmpeg found: {path}")
        else:
            self.log("WARNING: FFmpeg not found! Check Settings.", is_error=True)

    def log(self, message, is_error=False):
        def _log():
            self.log_text.config(state="normal")
            prefix = "[!!] " if is_error else "[>>] "
            self.log_text.insert("end", prefix + message + "\n")
            self.log_text.see("end")
            self.log_text.config(state="disabled")
        self.root.after(0, _log)

    # --- Settings ---
    def open_settings(self):
        win = tk.Toplevel(self.root)
        win.title("Settings")
        win.geometry("500x350")
        
        # Save Dir
        tk.Label(win, text="Download Folder:", anchor="w").pack(fill="x", padx=10, pady=(10, 0))
        f_frame = tk.Frame(win)
        f_frame.pack(fill="x", padx=10)
        dir_var = tk.StringVar(value=self.config["save_dir"])
        tk.Entry(f_frame, textvariable=dir_var).pack(side="left", fill="x", expand=True)
        tk.Button(f_frame, text="Browse", command=lambda: dir_var.set(filedialog.askdirectory() or dir_var.get())).pack(side="left")

        # FFmpeg
        tk.Label(win, text="FFmpeg Path (Optional):", anchor="w").pack(fill="x", padx=10, pady=(10, 0))
        ff_frame = tk.Frame(win)
        ff_frame.pack(fill="x", padx=10)
        ff_var = tk.StringVar(value=self.config["ffmpeg_path"])
        tk.Entry(ff_frame, textvariable=ff_var).pack(side="left", fill="x", expand=True)
        
        def browse_ffmpeg():
            f = filedialog.askopenfilename()
            if f: ff_var.set(f)
        tk.Button(ff_frame, text="Browse", command=browse_ffmpeg).pack(side="left")
        
        # Auto Remove
        ar_var = tk.BooleanVar(value=self.config["auto_remove"])
        tk.Checkbutton(win, text="Auto-remove finished jobs", variable=ar_var).pack(anchor="w", padx=10, pady=10)

        def save():
            self.config["save_dir"] = dir_var.get()
            self.config["ffmpeg_path"] = ff_var.get()
            self.config["auto_remove"] = ar_var.get()
            save_config(self.config)
            self.check_ffmpeg_status()
            win.destroy()
            
        tk.Button(win, text="Save & Close", command=save, bg="#dddddd").pack(pady=20)

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
        
        t = threading.Thread(target=self.process_download, args=(task_ui, ffmpeg_bin))
        t.daemon = True
        t.start()
    
    def delete_task(self, task_ui):
        """Called by the TaskRow or Auto-remove logic to cleanup."""
        if task_ui in self.tasks:
            self.tasks.remove(task_ui)
        # Safely destroy the UI element
        self.root.after(0, task_ui.frame.destroy)

    def process_download(self, task, ffmpeg_bin):
        filepath = os.path.join(self.config["save_dir"], f"{task.filename}.mp4")
        
        # Probe
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
                cmd, 
                stdout=subprocess.PIPE, 
                stderr=subprocess.PIPE, 
                universal_newlines=True,
                startupinfo=startupinfo
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
                task.mark_finished() # Changes button to Delete
                self.log(f"Finished: {task.filename}")
                
                # Auto Remove
                if self.config["auto_remove"]:
                    # Wait 1.5s then trigger delete
                    self.root.after(1500, lambda: self.delete_task(task))
            else:
                if task.cancelled:
                    task.update_status("Cancelled")
                    task.mark_finished()
                else:
                    task.update_status("Error")
                    task.mark_finished()
                    self.log(f"Error: {task.filename}", is_error=True)

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

        self.frame = tk.Frame(parent, pady=5, bg="#ffffff", bd=1, relief="solid")
        self.frame.pack(fill="x", pady=2)

        tk.Label(self.frame, text=filename, width=20, anchor="w", bg="#ffffff", font=("Arial", 10, "bold")).pack(side="left", padx=5)

        self.progress_var = tk.DoubleVar()
        self.progress_bar = ttk.Progressbar(self.frame, variable=self.progress_var, maximum=100)
        self.progress_bar.pack(side="left", padx=5, fill="x", expand=True)

        self.status_label = tk.Label(self.frame, text="Queued", width=10, bg="#ffffff", font=("Arial", 9))
        self.status_label.pack(side="left", padx=5)

        # Single Button for Cancel/Delete
        self.action_btn = tk.Button(self.frame, text="[X]", command=self.on_click, fg="red", relief="flat", width=5)
        self.action_btn.pack(side="right", padx=5)

    def update_progress(self, val, text):
        self.app.root.after(0, lambda: self.progress_var.set(val))
        self.app.root.after(0, lambda: self.status_label.config(text=text))

    def update_status(self, text):
        self.app.root.after(0, lambda: self.status_label.config(text=text))

    def on_click(self):
        """Handle click based on state."""
        if self.is_finished:
            # Delete state
            self.app.delete_task(self)
        else:
            # Cancel state
            self.cancel()

    def cancel(self):
        self.cancelled = True
        if self.process and self.process.poll() is None:
            self.process.terminate()
            self.update_status("Cancelling...")
        # Note: We don't delete here; we wait for process_download to finish and call mark_finished

    def mark_finished(self):
        self.is_finished = True
        def _ui():
            self.action_btn.config(text="[Del]", fg="black")
        self.app.root.after(0, _ui)

if __name__ == "__main__":
    root = tk.Tk()
    app = FfmpegDownloaderApp(root)
<<<<<<< HEAD
    root.mainloop()
=======
    root.mainloop()
>>>>>>> 2a0cd124b57a5949b93bd08d7e16cb8544e5a005
