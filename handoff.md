# Downs handoff — download manager polish pass

## Mission

Downs 2.x is now working end-to-end on real sites in desktop Chrome and Kiwi Android for the currently supported DIRECT path.

The next pass is not about expanding HLS format support. It is about making the download experience feel like Downs instead of dropping the user into Kiwi's own download page at the end.

The goal is a small, persistent **Downs Downloads** manager that owns job state, progress, history, cleanup, and final export.

Keep it simple. No cathedral.

---

## Current state

The current `main` already has:

- extension-only architecture;
- no Python helper;
- no localhost bridge;
- no external FFmpeg for the normal path;
- HLS detection in the authenticated browser session;
- playlist inspection / classification;
- master/media handling;
- variant inspection;
- conservative support gating;
- dedicated long-lived processing page;
- MPEG-TS VOD direct download for the currently supported subset;
- bounded segment concurrency;
- JS remux to MP4 via bundled mux.js;
- progress reporting;
- cancellation;
- OPFS/private-storage output when available;
- bounded in-memory fallback;
- browser Downloads API handoff;
- Chrome + Kiwi compatibility tested manually on real sites.

Do not rewrite the working networking/remux core unless the manager genuinely requires it.

---

## Observed UX problem

Current rough flow:

```text
popup
  ↓
choose stream / variant
  ↓
processing page
  ↓
download + remux
  ↓
browser Downloads API
  ↓
Kiwi/native downloads page / "open in" flow
```

The native save works, but it becomes the main user experience right at the end.

Desired flow:

```text
popup
  ↓
start job
  ↓
Downs Downloads
  ↓
progress / state / errors
  ↓
Done in Downs
  ↓
user taps Save to device when desired
```

Browser-native downloads should become the **final export step**, not the download manager.

---

## Target UI

Example:

```text
Downs Downloads

↓ nature-documentary.mp4
  63% · 812 / 1280 segments
  6.2 MB/s
  [Cancel]

✓ cat-video.mp4
  Done · 428 MB
  [Save to device] [Delete]

! weird-stream.mp4
  Failed: segment 418 returned 403
  [Retry] [Details] [Delete]
```

Keep the existing Downs visual language: compact, readable, touch-friendly.

---

## Ownership model

Downs should own:

```text
queued jobs
active jobs
progress
success/failure state
finished-file presence
cleanup
retry
small recent history
```

The browser-native download system should only be invoked when the user explicitly chooses to export a finished file.

---

## Strong preference: retain finished media before export

Where OPFS/private extension storage works, prefer:

```text
segments
  ↓
remux
  ↓
finished MP4 in private extension storage
  ↓
job becomes DONE
  ↓
[Save to device]
```

Do not automatically trigger the browser's download UI immediately after every successful remux if the completed file can safely remain in private storage.

The user should be able to download/remux first and export later.

If a browser/platform cannot retain the completed file safely, fall back gracefully and explain the limitation.

---

## Manager entry point

Add an obvious **Downloads** button/link in the toolbar popup.

Example:

```text
Downs

Detected streams...

[ Downloads (2) ]
```

The number may represent active jobs or active + finished-unexported jobs.

Do not repurpose the toolbar badge if it is already useful for detected-stream counts. Prefer showing download count inside the popup.

---

## Job states

Keep the visible state model small:

```text
queued
downloading
remuxing
done
failed
cancelled
```

Do not implement pause/resume in this pass.

Use clean cancel + retry-from-scratch instead.

---

## Persistent job metadata

Suggested model:

```text
Job {
  id
  createdAt
  updatedAt

  sourcePageTitle?
  sourcePageUrl?
  playlistUrl
  variantLabel?

  filename

  state

  segmentCount?
  completedSegments?
  bytesDownloaded?
  totalBytes?
  speedBytesPerSecond?

  outputStorage?: 'opfs' | 'memory' | 'exported'
  outputPathOrKey?
  outputSize?

  error?: {
    code?
    message
    segmentIndex?
    httpStatus?
  }
}
```

Rules:

- never put media bytes in `chrome.storage`;
- keep media in OPFS/private file storage where possible;
- keep job metadata in extension storage or IndexedDB;
- metadata should survive popup close/reopen;
- finished job metadata should survive manager close/reopen;
- if practical, keep finished jobs across browser restart while the private output still exists.

---

## Long-running processing

Preserve the existing good decision: do not make the MV3 service worker own a long download.

Suggested responsibilities:

```text
background/service worker
  detection
  routing
  job metadata coordination

Downloads manager page
  displays jobs
  receives state updates
  exposes actions

processing page/context
  playlist refresh
  segment fetch
  remux
  output writing
```

Do not move multi-hour media processing into the service worker just to simplify UI wiring.

If the current processing page must remain open, make it feel like part of the manager rather than a disposable random tab.

If one manager page can safely own multiple jobs on both Chrome and Kiwi, that may be worth considering — but only after verifying lifetime and memory behavior.

---

## Active job UI

Show at minimum:

```text
filename
state
percent when calculable
segments completed / total
bytes downloaded when known
speed when reliable
Cancel
```

Example:

```text
nature-doc.mp4
Downloading · 63%
812 / 1280 segments · 6.2 MB/s
[Cancel]
```

ETA is optional. Do not fake precision.

---

## Remuxing state

Show remuxing separately:

```text
nature-doc.mp4
Remuxing…
```

Do not leave the UI at `100% Downloading` while CPU work continues.

---

## Done state

Prefer:

```text
cat-video.mp4
Done · 428 MB
[Save to device] [Delete]
```

After export:

```text
cat-video.mp4
Saved · 428 MB
[Save again] [Delete]
```

Keep the private copy until the user deletes it, subject to reasonable storage limits.

---

## Failed state

Preserve specific diagnostics.

Example:

```text
weird-stream.mp4
Failed
Segment 418 returned HTTP 403
[Retry] [Details] [Delete]
```

Do not collapse useful existing errors into a generic `Download failed`.

---

## Retry behavior

Implement **retry from scratch**.

Retry should:

1. clean previous partial output;
2. re-fetch / re-inspect the media playlist;
3. re-run support validation;
4. obtain fresh current segment URLs;
5. start again.

Do not reuse stale stored segment lists from the failed attempt.

This is important for time-limited or changing playlist URLs.

---

## Cancel behavior

On cancel:

- abort outstanding fetches;
- stop remux processing;
- close writers/streams;
- remove partial private output;
- update job state cleanly.

A cancelled job may remain briefly with Retry/Delete or disappear after cleanup. Choose whichever keeps the manager simpler.

---

## Delete behavior

Delete should remove:

```text
job metadata
finished private output
partial/temp output
```

Do not leave orphaned private media indefinitely.

---

## Bounded history

Do not let metadata grow forever.

A simple bounded history is enough, e.g.:

```text
latest 20–50 jobs
```

or age-based cleanup for older exported entries.

No database museum.

---

## Save to device

The native browser handoff should become an explicit action:

```text
[Save to device]
```

When pressed:

1. read/expose the completed private MP4;
2. pass it to the browser Downloads API or best supported mechanism;
3. keep the private copy until export succeeds or user deletes it;
4. mark the job as saved/exported when appropriate.

On Kiwi verify:

- filename handling;
- OPFS/private-file export;
- Blob/Object URL behavior if used;
- Android/Kiwi native download UI;
- `Save again` behavior.

It is acceptable for Kiwi's native UI to appear **after the user taps Save to device**.

The goal is only to stop that native UI from being the main Downs job-management experience.

---

## Open / Share

Not a blocker.

Priority:

```text
1. Save to device
2. Save again
3. Delete
4. Retry / Details
5. Open/Share only if easy and reliable
```

Do not add a native companion app just for Open/Share.

---

## Pause / resume — not this pass

Do not implement pause/resume now.

Reasons include changing or expiring playlist/segment URLs and extra state complexity.

For this pass:

```text
Cancel
Retry from scratch
```

is enough.

---

## Keep current format support conservative

Do not combine this manager pass with a major expansion of HLS support.

Preserve current clear support gating and failure messages.

The manager should become excellent for the currently working DIRECT path before broadening format support.

---

## Kiwi status

Manual user report:

- extension loaded successfully in Kiwi;
- tested on two different real sites;
- core detection/download path worked nicely;
- main rough edge was the download-management / native download-page experience.

Treat this as strong evidence that the architecture is viable on Kiwi.

Do not casually refactor away working Kiwi behavior.

Every major manager change should be manually checked on:

```text
Chrome desktop
Kiwi Android
```

Especially verify:

- phone-width manager layout;
- touch-friendly controls;
- active job continues when popup closes;
- manager state persists when reopened;
- scrolling/history works;
- final export works;
- cancel cleans partial data;
- closing manager/processing tabs has clear behavior;
- browser restart behavior is sane.

---

## Suggested implementation order

### C1 — persistent manager shell

1. Add Downloads entry in popup.
2. Create/rework manager page.
3. Persist job metadata.
4. Show active / done / failed jobs.
5. Keep existing processing mechanics mostly unchanged.

Success criterion:

> Start a job, close popup, open Downloads, and still see correct state/progress.

### C2 — retain finished output

1. Stop automatic export where private storage allows retention.
2. Mark job `done`.
3. Show output size.
4. Add `Save to device`.
5. Add `Delete`.
6. Add `Save again`.

Success criterion:

> Finished MP4 remains safely in Downs until the user explicitly exports it.

### C3 — retry / failure polish

1. Persist detailed error state.
2. Add Retry from scratch.
3. Re-inspect playlist before retry.
4. Clean partial files reliably.
5. Add minimal Details view if useful.

Success criterion:

> Failed jobs are understandable and retry with fresh playlist data.

### C4 — history / mobile polish

1. Bounded history.
2. Reliable cleanup.
3. Phone-width layout.
4. Touch-friendly controls.
5. Manual Chrome + Kiwi verification.

---

## Testing

Keep all existing parser/downloader tests.

Add unit tests where practical for:

```text
job-state transitions
retry resets stale fields
history pruning
cleanup bookkeeping
error persistence
filename/output metadata
```

Do not pretend Node tests prove browser storage/download behavior. Manual browser QA remains required.

### Main manual path

Use the known supported Mux MPEG-TS VOD fixture:

`https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8`

Test:

```text
detect
inspect
choose supported media playlist
start download
manager shows progress
remux
job becomes Done
Save to device
verify audio + video
Save again
Delete
```

### Cancel test

```text
start longer job
wait for several segments
Cancel
verify fetches stop
verify partial output is removed
verify manager state is sane
```

### Failure test

Use fixture/mocking to force one segment to fail:

```text
job → Failed
exact reason visible
Retry re-inspects playlist
```

### Kiwi test

Verify on physical Kiwi:

```text
Downloads page
progress with popup closed
finished private output
Save to device
native final save behavior
Delete
Retry
phone-width layout
```

---

## Do not overbuild

Good:

```text
Downloads
2 active · 3 finished

[compact job rows]
```

Bad:

```text
accounts
cloud sync
categories
media artwork library
transcoding presets
scheduling
bandwidth dashboards
15 settings pages
```

We need a useful job list, not qBittorrent wearing a tiny HLS hat.

---

# Beechan / Codex CLI prompt

```text
Read the whole repository first, especially README.md, handoff.md, the current extension downloader/processing code, storage/output handling, popup, tests, and packaging scripts.

Current situation:

Downs 2.x is working successfully on real HLS sites in desktop Chrome and Kiwi Android for its currently supported DIRECT MPEG-TS VOD path. The user manually tested Kiwi on two different sites and reports that the core flow works nicely.

The next task is download-manager polish, not new format support.

The main UX problem is that after a successful job Kiwi's own download/native page becomes the main experience. We want Downs itself to own job state and only invoke browser-native saving when the user explicitly chooses Save to device.

Implement the manager pass described in handoff.md.

Requirements:

- add a persistent Downs Downloads manager page;
- add an obvious Downloads entry from the toolbar popup;
- persist job metadata independently of popup lifetime;
- show queued/downloading/remuxing/done/failed/cancelled states clearly;
- show useful progress: percent where available, segment counts, bytes, and speed where reliable;
- preserve existing detailed failure messages;
- keep long-running processing outside the MV3 service worker;
- retain completed MP4 output in OPFS/private extension storage where supported;
- do not automatically export every successful file when private storage can retain it;
- on completion mark the job Done and offer Save to device;
- allow Save again while the private copy remains;
- allow Delete to remove metadata and private output;
- add simple Retry from scratch for failed/cancelled jobs;
- Retry must re-fetch/re-inspect the playlist and must not reuse stale stored segment URLs;
- Cancel must stop work and clean partial output;
- keep a small bounded history;
- keep the UI mobile-friendly for Kiwi;
- preserve existing Chrome behavior and tests;
- do not broaden format support in this pass;
- no Python helper, localhost bridge, external FFmpeg, userscript, native companion app, or cloud service;
- do not implement pause/resume in this pass;
- do not add Open/Share unless it is straightforward after the core manager is complete.

Important architectural rule:

The MV3 service worker remains a detector/coordinator, not the owner of a long-running media job. Reuse the existing long-lived processing architecture as much as possible. Do not regress working Kiwi behavior just to make desktop architecture prettier.

Suggested staged work:

C1: persistent manager shell + job metadata
C2: retain finished output + Save to device / Save again / Delete
C3: failure persistence + Retry from scratch + cleanup
C4: bounded history + Chrome/Kiwi mobile polish

Before coding, inspect how the current processing page writes to OPFS/private storage and how the Downloads API handoff currently works. Reuse working code instead of rebuilding the downloader.

Add or adjust tests for pure job-state/history/cleanup helpers where practical. Keep manual browser QA documented where tests cannot prove browser behavior.

After implementation:

1. run all existing tests;
2. run JS syntax/extension validation;
3. package Chromium/Firefox builds as currently supported;
4. update README.md for the Downloads manager and Save-to-device flow;
5. summarize architecture changes and Kiwi-specific caveats;
6. commit with a clear message.

Keep Downs small. No cathedral.
```

---

## Definition of done

This pass is done when:

```text
1. User starts a supported HLS download.
2. Downs Downloads shows the active job and useful progress.
3. Popup can close without losing job visibility/state.
4. Successful remux becomes Done inside Downs.
5. Finished MP4 can remain in private Downs storage.
6. User explicitly taps Save to device for native export.
7. User can Save again or Delete while the private copy remains.
8. Failed jobs show a useful reason and can Retry from fresh playlist inspection.
9. Cancel reliably cleans partial output.
10. UI works sensibly on Chrome desktop and Kiwi Android.
```

If those ten points work, stop and test before expanding format support.
