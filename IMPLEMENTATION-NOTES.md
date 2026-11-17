# IMPLEMENTATION NOTES — guided binocular observations (pre-game)

Status: **implemented inside `app/` only**. No framework, no build step, no new
dependencies. No commits/push, no git identity changes, no servers left running.
Equal mode gameplay and the existing game logic are untouched.

---

## 1. What was added / changed (files)

| File | Change |
| --- | --- |
| `app/src/anaglyph.js` | New eye tags `leftFull` / `rightFull` (single physical eye at that eye's **full** trim, **never** dimmed by `fellowContrast`); new `drawRing()` stroke primitive; `getIntensity()`/`colorFor()` understand the new tags; documented the `both` intensity contract. |
| `app/src/observations/targets.js` | **New.** Static, original shapes: `drawScreenCheckTarget`, `drawGameTargets`, `drawFourDotPattern`, `drawSplitDemo`, `FOUR_DOT_ASSIGNMENT`. No motion, no disparity, no flashing. |
| `app/src/screens/observations.js` | **New.** The guided 3-step flow + welcome demonstration + summary. |
| `app/src/screens/readiness.js` | **New.** Plain pre-game readiness screen replacing the offset-line "alignment gate". |
| `app/src/store.js` | `antisup_observations` key, `snapshotSettings()`, `getObservations()`, `addObservation()`, `clearObservations()`, `hasObservations()`, `OBSERVATION_SCHEMA_VERSION`, `exportObservationsJSON()`, `exportObservationsCSV()`; JSON export bumped to `version: 2` with an added `observations` section; CSV injection guard. |
| `app/src/screens/home.js` | New **Binocular observations** entry (sub-labelled "not a screening score"), Play now goes to `#readiness`, log button shows session/observation counts. Warning banner expanded with double-vision guidance. |
| `app/src/screens/calibration.js` | Leakage check corrected to physical-eye cover steps + labelled approximate; alignment section **removed**; new "8. Binocular observations" link section; full-strength patch colour. |
| `app/src/screens/log.js` | Rewritten: separate **Game sessions** and **Binocular observations** sections, each with own export/clear buttons; observation records are expandable `<details>` with answers + settings snapshot. |
| `app/src/screens/settings.js` | Added "Clear binocular observations" (separate from clearing sessions). |
| `app/src/screens/gameselect.js` | Games route into `#readiness`; added observations shortcut. |
| `app/src/app.js` | New routes `#readiness` and `#observations`. |
| `app/src/display.js` | Removed the unused `showAlignmentCheck()` (the offset-line gate) and its default export entry. |
| `app/src/games/tetris.js` | Removed the `showAlignmentCheck` import and gate; `phase` starts as `ready` with a plain Start / Readiness / Back overlay. No gameplay, scoring, spawning, timing or HUD changes. |
| `app/styles.css` | Observation/fieldset/radio/textarea/canvas styles; removed `.align-canvas-wrap`. |
| `app/service-worker.js` | Cache version `antisup-v3-2026-11-17`; new files precached. |
| `app/IMPLEMENTATION-NOTES.md` | **This file.** Progress + final report. |

---

## 2. Flow details

### Entry points
* Home → **Binocular observations** (`#observations`) — labelled "not a screening score".
* Home → **Play** → `#readiness` → Start Falling Blocks → `#tetris`.
* Calibration §8 → observations; Games screen → observations; readiness screen → observations; observation summary → log.
* No participant codes, accounts, cloud or identifiers anywhere.

### Welcome (demonstration)
* One static split-image demo canvas + legend (bars = left eye, blocks = right eye, frame/centre line = shared).
* Shows the current lens orientation, which eye wears red/cyan, and the declared weaker eye.
* "Start step 1 of 3" and "Back to home".
* **Leaving the welcome screen creates no record.**

### Step 1 — Screen / glasses check
* Static target: hollow ring + solid inner square + base bar + two upper ticks.
* Explicit target selector (`Target intended for the LEFT/RIGHT eye`, radio). **No automatic reversal, no flashing**; lens orientation reminder text states the target is not flipped automatically and that lens assignment can be checked separately in Calibration/Settings.
* Documented values shown for the selected target: target eye, channel colour, eye brightness trim, the resulting `rgb()` actually drawn, and an explicit "Fellow-eye contrast: not applied to this target".
* Instructions use **physical eye cover** wording throughout: "Cover your RIGHT eye and KEEP the LEFT eye open" (never "close your eye and look through it"). Each side checks:
  * **A. Intended target visibility** — clear / faint / absent / not sure.
  * **B. Extra or ghost image** — none / ghosting / not sure (split out from A).
  * **C. Unwanted leakage into the other eye** — clear / faint / absent / not sure, with the cover steps reversed.
* Answers are stored per side (`leftIntended`, `leftLeakage`, `rightIntended`, `rightLeakage`) and survive switching the target back and forth.
* Button order: **Next: target for the RIGHT eye** → **Continue to step 2** (both after Back/Skip/Stop).

### Step 2 — Target visibility
* Static game-like shapes: a falling-piece shape and a landed stack, on a shared ground line + centre fixation mark.
* Monocular sample canvas with an explicit **Left eye / Right eye** switch (no auto-assignment), captioned "Sample shown to the X eye only".
* A. Left eye only, B. Right eye only: clear / blurred / faint / not visible / not sure.
* C. Both eyes open: both visible / one missing / alternating / doubled / not sure.
* The both-open canvas assigns the piece to the declared weaker eye and the stack to the other, **full strength each (per-eye trim only)**, shared frame in both eyes, zero disparity, no moving offsets.
* Copy explicitly distinguishes "intentionally absent for that eye" from "could not see an intended target", and states that seeing both **does NOT establish binocular fusion**.

### Step 3 — Four-dot observation
* Labelled a **generic, unvalidated browser pattern — NOT the Worth 4 Dot test**, with a demonstration canvas (all dots in both eyes, layout only) followed by the observation pattern.
* Legend documents the assignment: top = shared/both, left + bottom = left channel, right = right channel, and explains that the shared dot and any ghosting make the count ambiguous.
* Answers: count (0/1/2/3/4/5+/not sure/**cannot do this**), colours (multi-select), displacement description, stability (stable/alternating/not sure).
* Optional free-text comment with explicit "**avoid names or personal information**".
* Skip is available; no expected count is enforced, no diagnosis/classification/severity/eye-deviation computation, and no claim that extra dots are normal or that all four imply fusion.

### Summary
* Per-step recorded/skipped/partly-answered status, all individual answers, timestamp.
* Explicit non-diagnostic statement.
* Run again (resets to welcome, fresh snapshot, `saved` flag cleared), observation history, back to home.

### Exit / cancellation
* Every step has **Back**, **Skip this step**, **Stop and exit**.
* Route change mid-flow (e.g. browser back, hash edit) persists the partial record as `outcome: 'stopped'` — answers are never lost.
* The disposer clears canvases, `ResizeObserver`, `resize`/`orientationchange` listeners and any queued `requestAnimationFrame` work.

---

## 3. Storage schema

Key: `antisup_observations` (separate from `antisup_sessions` and `antisup_settings`).

```jsonc
[
  {
    "id": "obs_xxxxx_yyyyy",
    "kind": "binocular-observations",
    "schemaVersion": 1,
    "timestamp": "2026-11-17T02:00:00.000Z",   // flow start
    "outcome": "completed" | "stopped",
    "completedSteps": ["screenCheck", "targetVisibility", "fourDot"],
    "settings": {                                // immutable snapshot at flow start
      "lensOrientation": "RL",
      "redEye": "left",
      "cyanEye": "right",
      "amblyopicEye": "right",
      "fellowContrast": 0.2,
      "redColor": { "r": 255, "g": 0, "b": 0 },
      "cyanColor": { "r": 0, "g": 255, "b": 255 },
      "leftEyeTrim": 1,
      "rightEyeTrim": 1,
      "screenMmPerPx": 0.2646,
      "screenMethod": "guessed",
      "viewingDistanceCm": 60
    },
    "screenCheck": {
      "skipped": false, "completed": true,
      "answers": {
        "leftIntended":  { "code": "clear", "label": "Clear", "ghostingCode": "none", "ghostingLabel": "No extra image" },
        "leftLeakage":   { "code": "faint", "label": "Faint" },
        "rightIntended": { "code": "clear", "label": "Clear", "ghostingCode": "none", "ghostingLabel": "No extra image" },
        "rightLeakage":  { "code": "absent", "label": "Absent" }
      }
    },
    "targetVisibility": {
      "skipped": false, "completed": true,
      "answers": {
        "leftEye":  { "code": "clear", "label": "Clear" },
        "rightEye": { "code": "blurred", "label": "Blurred" },
        "bothOpen": { "code": "both-visible", "label": "Both targets visible" }
      }
    },
    "fourDot": {
      "skipped": false, "completed": true,
      "count": 4, "countLabel": "4",
      "colorsSeen": ["Red", "Cyan"],
      "displacement": "none", "displacementLabel": "No displacement noticed",
      "stability": "stable", "stabilityLabel": "Stable"
    },
    "comment": ""
  }
]
```

* Bounded to the last **200** records, in line with the sessions log's 500-record cap.
* `normalizeObservation()` coerces every field on read: unknown/missing fields
  become empty, colours are clamped, unknown enum values fall back to safe
  defaults, and step `answers` are kept flat (string/number/boolean scalars
  only, values capped at 160 chars). Unknown future answer keys therefore load
  without any migration, and corrupt/non-array payloads degrade to `[]`.
* There is no participant/name/account field. Comments are capped at 1000 chars
  and the UI states "avoid names or personal information".

### Export compatibility
* **Sessions JSON** (`Export sessions JSON` → `antisup-sessions-*.json`):
  `version` is now `2`; `settings` and `sessions` are byte-for-byte the same
  shape as version 1 (v1 readers keep working), and two sections are added:
  `observationSchemaVersion` and `observations`.
* **Sessions CSV** (`Export sessions CSV`): **unchanged** header and rows — the
  previous ten columns, same order.
* **Observations JSON** (`Export observations JSON` →
  `antisup-observations-*.json`): own payload with `section:
  "binocular-observations"`, `observationSchemaVersion`, a non-diagnostic note,
  the snapshot policy sentence, and the `observations` array.
* **Observations CSV** (`Export observations CSV` → `antisup-observations-*.csv`):
  33 columns (`OBSERVATION_CSV_HEADER` in `src/store.js`; header and every row
  use the same list) covering timestamp/outcome/completed steps/schema version, the
  whole settings snapshot (lens orientation, red- and cyan-lens eye, declared
  eye, fellow contrast, both colours, both trims, screen mm-per-px + method,
  viewing distance), per-step status, every individual answer (intended target,
  ghosting, leakage for both eyes; left-eye-only, right-eye-only, both-open;
  four-dot count/colours/displacement/stability) and the comment.
* Each dataset is cleared independently (`Clear game sessions` /
  `Clear observations`, and Settings has both).
* **CSV safety**: `csvCell()` RFC-4180 quotes/escapes `"` `,` CR LF. It also
  prefixes any *string* cell beginning with `= + - @ \t \r` with an apostrophe,
  so user-supplied comment/answers cannot act as spreadsheet formulas. Numeric
  cells are unaffected (the guard only fires for `typeof v === 'string'`).
  Verified: `=cmd|calc` → `'=cmd|calc`, `=1+1,"quoted"` → `"'=1+1,""quoted"""`.

---

## 4. Renderer behaviour (inspected, verified)

`AnaglyphRenderer.configure()` computes four colour strings per configure
call. Per physical eye:

| tag | intensity applied |
| --- | --- |
| `both` | `eyeTrim` only — **full**, in each eye |
| `amblyopic` | `eyeTrim` (equal mode → both eyes) |
| `fellow` | `eyeTrim * fellowContrast` in the fellow eye; `eyeTrim` in the amblyopic eye (equal mode → both eyes full) |
| `left` / `right` (forced eye) | that eye's *own image* colour, i.e. fellow eye is dimmed — describes "what this eye's own content looks like" |
| **`leftFull` / `rightFull` (new)** | `eyeTrim` only, never `fellowContrast`; draws to exactly one physical eye |

**`both` was not regressed**: it was and is full-strength in both eyes, and
`fellowContrast` affects only fellow-tagged content. Verified by a unit test
that stubs the 2D contexts and inspects each offscreen buffer:

```
both       L=rgb(255,0,0)  R=rgb(0,255,255)      # neither eye dimmed
fellow     L=rgb(51,0,0)   R=(nothing)           # only fellow eye, ×0.2
amblyopic  L=(nothing)     R=rgb(0,255,255)
leftFull   only left buffer written, rgb(255,0,0)
rightFull  only right buffer written, rgb(0,255,255)
leftFull with leftEyeTrim 0.5 → rgb(128,0,0)     # trim applies, contrast does not
both with leftEyeTrim 0.5 → L rgb(128,0,0), R rgb(0,255,255)
equal mode + fellow tag → both eyes full          # unchanged
```

`colorFor('leftFull'|'rightFull')` is used by the calibration leakage patch
(the observation screens draw their targets directly and do not call
`colorFor`). `colorFor()` answers only for a *single* physical eye: it
returns the exact string the draw calls use for `'left'`, `'right'`,
`'leftFull'`, `'rightFull'`, and for a tag that resolves to one eye
(`'amblyopic'`/`'fellow'` outside equal mode). For a tag drawn to both eyes with
two different strings — always `'both'`, and `'amblyopic'`/`'fellow'` in equal
mode — there is no single truthful colour, so it returns `null` instead of one
eye's (earlier it returned the fellow-dimmed colour for `'both'`, which did not
match the drawn pixels). Read `_colorsFor(tag)` / the left/right buffers when
you need both eyes.

The observation APIs draw **directly by physical left/right** through these
tags. They never call `saveSettings()` and never mutate persisted settings —
`ctx.settings` is read once into an immutable snapshot per flow run
(`snapshotSettings()` deep-copies the colour objects).

---

## 5. Safety / claims audit

* Home banner and observation banner: research prototype, not a medical
  assessment or treatment; stop for double vision/discomfort; don't persist
  with symptoms; new/persistent double vision outside the app needs
  professional assessment; sudden new double vision needs prompt care. Concise,
  no invented time threshold, no dosage language.
* No diagnosis, classification, severity score, pass/fail, or eye-deviation
  calculation anywhere in the new flow, log or exports.
* Four-dot step names itself a generic unvalidated browser pattern, not a
  clinical test, and never asserts an expected dot count.
* "Both targets visible" is explicitly stated not to establish fusion.
* Screen check is labelled approximate/subjective; it never asks the user to see
  through a closed eye, and it does not imply a fixed dot count or target
  verifies channels or fusion.
* Manual contrast remains manual in Calibration: no suggestions, no automatic
  alignment corrections. The 60-minute adjustable session timer is untouched
  and makes no dosage claim.
* Removed: the offset-line "alignment check", the "do these lines appear as one
  → OK" declaration, and the calibration instruction to adjust trims until the
  patch is invisible to the covered eye (an unsupported mini-calibration).

---

## 6. Accessibility

* One `<h1>` per route; observation screen uses a `<main>` landmark; sections
  use `h2`/`h3` in order.
* Every option group is a real `<fieldset><legend>` with native radios /
  checkboxes (`label[for]` + `id`), so arrow-key and screen-reader semantics are
  free. Verified: 0 fieldsets without a legend, 0 unlabelled inputs/textareas on
  every route.
* A single `role="status" aria-live="polite" aria-atomic="true"` region
  announces each recorded answer and step change (never per frame).
* Canvases are `role="img"` with a descriptive `aria-label` and fallback
  text content; every value that matters is also in text (documented target
  values, legends, assignment list).
* Sticky keyboard order is the natural DOM order; `:focus-visible` outlines are
  inherited from the global button/input rules and added for
  `.obs-option:has(input:focus-visible)` and `details > summary`.
* `details/summary` observation records are keyboard operable and carry a
  visible disclosure marker.
* Mobile: verified at 360×740 DPR 3 — 0 px horizontal overflow, canvas backing
  store exactly `round(cssWidth × dpr)`.
* `prefers-reduced-motion` is not needed: nothing animates. No `setInterval`,
  no flashing, no RAF loop in the observation flow (a single `requestAnimationFrame`
  per paint request, coalesced).

---

## 7. Cleanup / lifecycle

* `staticCanvas()` returns a `cleanup()` that sets `disposed`, disconnects the
  `ResizeObserver`, and removes `resize`/`orientationchange` listeners. Every
  canvas registered during a step is cleaned before the next render and again
  in the route disposer.
* Paint is skipped when `disposed` or `!canvas.isConnected`, so a resize that
  lands after unmount is a no-op.
* `body.replaceChildren()` swaps step content; `screen.remove()` on unmount.
* Tetris: the old gate held a promise + `MutationObserver` + window listeners
  that had to be torn down on navigation. The new overlay is plain DOM inside
  `overlayHost` and is removed by the existing `clearOverlay()` path, so the
  game-start / cancellation cleanup is simpler and unchanged elsewhere.
  Verified: rapid route churn (8 routes × 4 loops) leaves 1 screen node, 0
  canvases, 0 overlay nodes, and zero console errors/page errors/failed
  requests.

---

## 8. Checks actually run

No browser-based *independent* tester was run by me beyond the local harness
below; an independent tester still follows.

1. **Syntax**: `node --check` on every `app/src/**/*.js` and
   `app/service-worker.js` → clean.
2. **Renderer unit test** (stubbed 2D contexts, colours inspected per eye
   buffer) → table in §4, all assertions as expected.
3. **Store/export unit test** (stubbed `localStorage`, `Blob`, `URL`,
   minimal `document`):
   * `snapshotSettings()` produces the documented immutable shape.
   * `addObservation()` → `getObservations()` round-trip keeps count, colours
     and `schemaVersion`.
   * Session store untouched by observation writes.
   * Observation CSV quoting + formula-injection prefixing verified.
   * Sessions CSV header still exactly
     `timestamp,game,durationSec,score,level,lines,fellowContrast,amblyopicEye,lensOrientation,screenMethod`.
   * Combined JSON has `version: 2`, `observations`, `sessions`.
4. **Playwright verification suite** — `.test-harness/verify-observations.mjs`
   (added by this work; re-runnable with `node verify-observations.mjs` from
   `.test-harness`). Result: **PASS 50/50 checks**, no console/page errors and
   no failed requests, on desktop 1200×900 DPR 2 and mobile 360×740 DPR 3.
   It asserts, among others:
   * home has the observations entry and Play routes to readiness;
   * readiness copy has no alignment language and links the observations;
   * step 1 uses cover + KEEP wording, never "close your eye", has the
     explicit target selector, and documents the drawn `rgb()` values;
   * the left-intended canvas centre pixel is `rgb(255,0,0)` and the
     right-intended one `rgb(0,255,255)`, with a pure-black corner (one channel
     only) in both cases;
   * answers (visibility / ghosting / leakage) survive target switching;
   * step 2 states both-visible does not prove fusion and distinguishes
     intentional absence;
   * step 3 states NOT the Worth 4 Dot test, offers "Cannot do this", warns
     about personal information, and documents channel assignment;
   * the saved record has `schemaVersion: 1`, an immutable settings snapshot,
     no identifier fields, and all three steps completed;
   * the observation flow performs **no** settings write (`antisup_settings` is
     byte-identical before/after);
   * log sections/buttons are separate, both observation downloads work, and
     the combined JSON is `version: 2` with `observations` + `sessions`;
   * the comment `=SUM(1,2) "quoted", comma` is exported as
     `"'=SUM(1,2) ""quoted"", comma"` — apostrophe-prefixed and RFC-4180 quoted;
   * the game start overlay contains no alignment declaration, Start plays, Stop
     records a session;
   * calibration has no alignment section, its leakage copy uses cover + KEEP
     and is labelled approximate, and it links the observations;
   * mobile 360 px: 0 horizontal overflow, DPR-correct canvas backing store,
     all buttons/option rows ≥ 44 px tall.

5. **Renderer / store unit tests** — the stubbed-context and stubbed-storage
   scripts described above were run ad hoc during implementation (colours per
   eye buffer; CSV escaping; JSON shapes). They are not committed as files.

6. **Target staticness** — the step-1 canvas hash was identical across a 700 ms
   gap (no animation), and an idle 500 ms `requestAnimationFrame` probe counted
   only the browser's own frames (no app RAF loop).

7. **Regression spot-check of the old suites**: `test-1-2-load-nav`,
   `test-9-scope`, `test-11-timer-session`, `test-14-settings-leak`,
   `test-17-robust` pass. `test-3-calibration`, `test-10-level-timer`,
   `test-12-fps`, `test-15-edge`, `test-16-leak-staleness`,
   `test-18-integration`, `test-19-details` and `test-game.mjs` fail **only**
   because they wait for the deliberately removed UI: the `they look aligned`
   button (alignment gate) or the old `Showing … eye only` leak button label.
   Those assertions are stale, not regressions — every other step of those
   suites (game start, HUD, timer, session save) passed before the removed
   selector was reached.

---

## 9. Limitations / deferred

* **No independent browser test yet** — the orchestrator's independent tester
  should re-run the flow on real hardware with real anaglyph glasses.
  `node .test-harness/verify-observations.mjs` reproduces the automated checks;
  screenshots are in `.test-harness/screenshots/obs-*.png`.
* Stale harness suites listed above were **not** edited (they live outside
  `app/`); they need their alignment-gate and leak-button selectors updated
  before `run-all.mjs` is green again.
* The four-dot pattern is deliberately generic and unvalidated: it does not
  reproduce any clinical stimulus geometry, viewing distance or screen
  calibration, and the CSV exports it as raw answers only.
* Observation targets use the current channel colours/trims, so an unbalanced
  calibration will change what is drawn. That is intentional (the snapshot
  records the actual values), but it means two observations taken with
  different calibrations are not directly comparable.
* No export **import** and no CSV of the summary text — out of scope.
* The `left`/`right` forced-eye tags in `anaglyph.js` still describe the eye's
  own (possibly dimmed) image; no caller in `app/` uses them any more except
  `_getColor()` recursion. Kept for compatibility rather than removed.
* Analytics/metrics: none, by design.
