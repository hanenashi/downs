# Downs handoff — 2.7 GUI / feeling polish pass

## Mission

Downs 2.7 is technically getting serious. The next pass should **not** chase another format milestone yet.

The immediate goal is to make the current popup + Downloads manager feel less like an HLS developer inspector that happens to download, and more like a small downloader that happens to have an excellent inspector.

Keep the current architecture, strict DIRECT gates, request-context handling, grouping, fMP4/audio selection, manager, OPFS retention, and export flow intact. This pass is mostly presentation, hierarchy, touch ergonomics, and feedback.

No cathedral.

---

## Current functional baseline

Preserve all currently working behavior:

- muxed MPEG-TS VOD DIRECT path;
- separate H.264 + AAC fMP4/CMAF VOD path;
- alternate audio selection;
- persistent Downloads manager;
- OPFS/private output retention;
- Save to device / Save again / Delete;
- retry/cancel/failure details;
- conservative grouping of related playlists;
- sanitized Referer-origin replay for exact extension fetches;
- Chrome desktop + Kiwi Android behavior already verified;
- Firefox package remains experimental.

Do not weaken any support gate merely to improve appearance.

---

## Overall UX direction

Current feeling:

```text
technical stream list
→ inspect playlist
→ inspect variant
→ download
```

Target feeling:

```text
found playable video
→ obvious human-readable choice
→ optional technical detail
→ clear Ready state
→ Download
→ visible confirmation that the job went to Downloads
```

Technical information must remain available, but it should no longer dominate the first glance.

---

## 1. Make detected stream rows more human

The primary row should prefer a useful human summary over the raw playlist URL.

Current-ish pattern:

```text
Some title
https://cdn.example.com/path/master.m3u8?token=...
2m ago
```

Preferred pattern:

```text
Some title
Master · 4 variants · 2 audio tracks
2m ago
```

or, when the detected row is already a media playlist:

```text
Some title
1080p · H.264/AAC · HLS
2m ago
```

The exact secondary summary may depend on how much is known before inspection. Do not invent metadata that has not actually been parsed.

Raw URL should remain available through:

- expanded related-playlist details;
- inspector details;
- a compact technical/details section;
- or another low-friction reveal.

Do not remove diagnostic access.

---

## 2. Add subtle status chips in the inspector

Where classification is already known, use compact subdued chips for important facts instead of forcing the user to read the full grid every time.

Examples:

```text
[VOD] [fMP4] [Split A/V] [2 audio] [Supported]
```

or:

```text
[VOD] [MPEG-TS] [Muxed A/V] [Supported]
```

Rules:

- keep them visually quiet;
- avoid rainbow UI;
- use border/background differences sparingly;
- unsupported/warning states can reuse existing warning/error colors;
- chips summarize existing truth; they are not a replacement for detailed diagnostics.

The inspection grid should remain available below/behind them.

---

## 3. Give supported streams a stronger "Ready" moment

When a selected media combination passes DIRECT validation, make that state obvious before the primary button.

Example:

```text
Ready
VOD · fMP4/CMAF · H.264 + Japanese AAC

[ Download ]
```

or:

```text
✓ Ready to download
MPEG-TS · muxed H.264/AAC

[ Download ]
```

Use current support reason text where possible rather than inventing duplicate logic.

For unsupported streams, preserve precise existing failure/rejection reasons.

---

## 4. Keep filename/audio controls visually attached to Download

The Download action area should read as one coherent decision block.

For fMP4 with alternate audio:

```text
Audio
[ Japanese (default/etc.) ▼ ]

Filename
[ example-title.mp4          ]

✓ Ready to download
[ Download ]
```

Filename editing before the job starts is worth considering now that the manager persists jobs afterward.

Important:

- keep existing filename-mode settings (suggested/date/hash);
- if an editable filename field is added, prefill it from the current mode;
- job creation should store the final edited/sanitized filename;
- do not make filename editing mandatory.

If adding editable filename now complicates the pass disproportionately, leave it for a tiny follow-up rather than blocking the other polish.

---

## 5. Improve the Downloads entry summary

A naked count is less useful now that the manager is a real part of the app.

Prefer compact state-aware text such as:

```text
Downloads · 1 active · 2 ready
```

or:

```text
Downloads
1 active · 2 ready to save
```

If there is nothing active/unexported, plain `Downloads` is fine.

Do not overload the browser toolbar badge if it is already useful for detected-stream count.

---

## 6. Add explicit start confirmation

After the user taps Download and the job is successfully queued, give a brief visible confirmation.

Example button transition:

```text
Download
→
Added to Downloads ✓
```

for roughly a second or until the UI naturally changes.

Avoid the feeling that the click vanished into another tab.

Preferred behavior:

- do not close the popup just for feedback;
- if the Downloads manager is focused/opened by current behavior, still show an immediate success state before/while that happens where practical;
- errors should remain explicit and inline.

---

## 7. Manager row ergonomics

Keep the manager compact but make each job row feel more tappable on Kiwi.

Suggested behavior:

- entire non-button area of a row may open details / reveal metadata;
- explicit action buttons remain explicit;
- keep generous touch targets;
- avoid dense icon-only controls;
- continue to show filename, state, progress/size, and useful failure reason at a glance.

Simple glyphs such as `↓`, `✓`, `!`, `×` are enough if icons are used. Do not introduce a heavy icon framework.

---

## 8. Dark mode

Current popup CSS explicitly uses `color-scheme: light`. Add a restrained dark theme using `prefers-color-scheme: dark` if it can be done without destabilizing layouts.

Requirements:

- preserve current green accent identity;
- ensure warning/error contrast remains readable;
- inspector grids, chips, selected rows, inputs, manager rows, settings panel, and buttons all need coherent dark equivalents;
- do not hardcode dozens of unrelated colors; prefer CSS variables;
- reduced-motion behavior remains respected.

Test at least:

```text
Chrome desktop light
Chrome desktop dark
Kiwi light
Kiwi dark if device/browser theme exposes it
```

If Kiwi does not propagate `prefers-color-scheme` reliably, document the behavior rather than adding a brittle browser-specific hack.

---

## 9. Version footer cleanup

The popup currently ends with `Downs 2.7`.

That is useful during development but visually reads like bookkeeping.

Preferred direction:

- move version information into Settings/About or another low-priority location;
- let normal popup content end with actual content rather than a version footer.

During active development it is acceptable to retain a subtle version string temporarily if it materially helps distinguish side-by-side Kiwi installs. If kept, make it less visually prominent.

---

## 10. Preserve the Downs visual identity

Do **not** redesign the extension from scratch.

Keep:

- white/neutral surface;
- restrained green accent;
- compact system typography;
- simple separators;
- minimal border radius;
- information-dense but readable inspector;
- no oversized cards;
- no gradients;
- no dashboard cosplay.

The goal is refinement, not a rebrand.

---

## Responsive / Kiwi expectations

The current popup already targets roughly 420px and shrinks to phone width. Preserve that.

Manually verify at minimum:

```text
420 × 640
320 × 640
physical Kiwi popup
```

Check:

- no horizontal overflow;
- long titles truncate sensibly;
- chips wrap cleanly;
- audio selector remains usable;
- filename field, if added, does not squeeze actions;
- primary Download button remains easy to hit;
- related-playlist disclosure still works;
- manager rows remain touch friendly.

---

## Suggested implementation order

### P1 — hierarchy cleanup

1. human-readable secondary stream summaries;
2. raw URL moved to technical/detail reveal;
3. Ready state above Download;
4. Downloads entry state summary.

### P2 — compact visual language

1. status chips;
2. selected/expanded row polish;
3. start-success confirmation;
4. manager row touch ergonomics.

### P3 — optional filename edit

If low-risk:

1. prefilled filename input in Download action block;
2. sanitize on input/start;
3. preserve filename-mode defaults;
4. store final name on job creation.

### P4 — theme / cleanup

1. CSS variable cleanup;
2. dark mode;
3. version footer moved/de-emphasized;
4. Chrome + Kiwi light/dark manual QA.

---

## Testing

Do not let visual polish regress the working downloader.

Run the full current automated suite and packaging checks after changes.

Manual smoke path:

```text
1. open a page with a known supported stream
2. verify grouped stream row is understandable without reading URL
3. inspect master / variant
4. confirm chips + Ready state reflect actual parser/support data
5. switch audio rendition where available
6. optionally edit filename if implemented
7. start download
8. observe Added to Downloads confirmation
9. open manager
10. verify progress, completion, Save to device, Save again, Delete
11. repeat on Kiwi
```

Also manually inspect unsupported streams to ensure the prettier UI has not hidden the real rejection reason.

---

## Non-goals for this pass

Do not combine this polish pass with:

- multiplexed fMP4 support;
- byte-range support;
- live/event downloads;
- broader codec support;
- CAPTURE/DUMP;
- pause/resume;
- cloud sync;
- media-library artwork;
- giant settings expansion.

Collect real-world evidence while testing, but keep this pass UI-focused.

---

# Beechan / Codex CLI prompt

```text
Read the whole repository first, especially README.md, handoff.md, popup.html/css/js, downloads.html/css/js, job-core.js, download-core.js, audio-core.js, tests, and the latest 2.7 fMP4/audio-selection work.

Downs 2.7 is technically working well enough that the next task is GUI/feeling polish, not a new media-format milestone.

Implement the polish pass in handoff.md while preserving every current DIRECT support gate and all working Chrome/Kiwi behavior.

Primary goals:

- make primary detected-stream rows human-readable instead of URL-first;
- keep raw URLs available in technical/details views;
- add subtle status chips for facts already known (VOD, MPEG-TS/fMP4, split/muxed A/V, audio count, supported);
- make a clear Ready state appear before the Download button when validation passes;
- keep audio and any filename controls visually attached to the Download action;
- if low-risk, add an editable prefilled filename before starting a job while preserving existing suggested/date/hash modes;
- make the Downloads entry show useful state such as active and ready-to-save counts, not just a naked total;
- add a brief Added to Downloads success state after a job is queued;
- improve manager row touch ergonomics without turning actions into icon soup;
- add restrained dark mode using CSS variables and prefers-color-scheme where practical;
- move or de-emphasize the popup version footer;
- preserve the current Downs green/neutral visual identity and compact layout.

Do not redesign the extension, weaken support checks, or broaden media support in this pass.

Keep diagnostic detail available. Unsupported streams must still show precise reasons. Never invent metadata in the UI that has not actually been parsed.

Manual QA must include 420x640, 320x640, desktop Chrome, and physical Kiwi. Check long titles, chip wrapping, audio selector, Download action layout, manager rows, and no horizontal overflow. Verify the full known supported download/export path still works after visual changes.

After implementation:

1. run all existing tests;
2. run JS syntax and extension validation;
3. package Chromium and Firefox builds;
4. update README only where user-facing behavior changed;
5. record any browser-specific dark-mode or popup quirks rather than hiding them with brittle hacks;
6. commit the completed polish pass.
```
