# Interactive Concept Tools + Typography Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bend-a-molecule dipole sandbox, a feature-by-feature prediction stepper, an animated prediction cloud, and a typography/spacing pass to the static project site.

**Architecture:** Plain static site in `docs/` (no build step). Sandbox math + UI live in a new `docs/sandbox.js` (pure functions exported for Node tests, UI mounted on `window`). Stepper and cloud animation extend the existing explorer IIFE in `docs/app.js`. Styles go in `docs/style.css`.

**Tech Stack:** Vanilla JS, inline SVG, Plotly 2.35.2 (already loaded), Node `node --test` for pure-function tests, Playwright (MCP browser tools) for in-page checks against `python3 -m http.server 8765` run inside `docs/`.

**Spec:** `notes/specs/2026-11-17-interactive-tools-design.md`

## Global Constraints

- Static GitHub Pages site in `docs/`; no build step, no new libraries.
- Works at 375px width with no horizontal page scroll; light and dark themes.
- No console errors or warnings after interacting with every new control.
- `prefers-reduced-motion: reduce` → animations jump to their end state.
- Sandbox uses the same rule the site tested on QM9: bond dipole (D) = 1.34 × Δχ(Pauling) × bond length (Å); resultant = vector sum.
- Commit each task on `main` (user chose this); never push. Bump `?v=` on `style.css`, `app.js` and the new `sandbox.js` when done.

## Review Focus

1. Switching preset while the angle slider is outside the new preset's range → slider clamps to the new range and the readout updates, no NaN.
2. Pyramidal molecule at 120° (planar) and triatomic at 180° → resultant is exactly `0.00 D`, arrow hidden, no division by zero.
3. Starting the cloud animation, then changing model / filter / feature toggle mid-animation → animation is cancelled and the plot shows the correct static state.
4. Stepper on a molecule where a step's prediction is negative or larger than the axis max → marker stays inside the track (axis range covers min(0, values) … max(values, truth) × 1.1).
5. Theme toggle while sandbox / stepper are visible → colours follow the theme (they read CSS variables at render time).

---

### Task 1: Sandbox math module

**Files:**
- Create: `docs/sandbox.js`
- Test: `notes/tests/sandbox.test.js`

**Interfaces:**
- Produces (exported via `module.exports` when defined, else `window.DipoleSandbox`):
  - `PRESETS: Record<"H2O"|"CO2"|"BeF2"|"NH3"|"NF3", {label, center, ligand, shape: "bent"|"pyramidal", n, length, angle, min, max, measured}>`
  - `bondDipole(key: string) -> number` (Debye)
  - `resultant(key: string, angleDeg: number) -> number` (Debye)
  - `clampAngle(key: string, angleDeg: number) -> number`

Preset data (exact):

| key | center | ligand | shape | n | length Å | default angle | min | max | measured D |
|---|---|---|---|---|---|---|---|---|---|
| H2O | O | H | bent | 2 | 0.958 | 104.5 | 90 | 180 | 1.85 |
| CO2 | C | O | bent | 2 | 1.16 | 180 | 90 | 180 | 0 |
| BeF2 | Be | F | bent | 2 | 1.39 | 180 | 90 | 180 | 0 |
| NH3 | N | H | pyramidal | 3 | 1.012 | 106.7 | 90 | 120 | 1.47 |
| NF3 | N | F | pyramidal | 3 | 1.365 | 102.2 | 90 | 120 | 0.23 |

Pauling χ: H 2.20, Be 1.57, C 2.55, N 3.04, O 3.44, F 3.98. Scale `K = 1.34`.
Measured values are NCERT Table 4.5 (H₂O 1.85, CO₂ 0, NH₃ 1.47, NF₃ 0.23; BeF₂ 0 from p. 111).

Geometry: bent → resultant = n·μb·cos(θ/2) with n=2. Pyramidal (θ = X–N–X angle) → angle α between each bond and the C₃ axis has cos α = √((1 + 2 cos θ)/3); resultant = 3·μb·cos α (0 when 1+2cosθ ≤ 0).

- [ ] **Step 1: Write the failing tests** (`node:test` + `node:assert`)

```js
test("bond dipole uses 1.34·Δχ·length", () => approx(bondDipole("H2O"), 1.34 * 1.24 * 0.958, 1e-9));
test("water at 104.5° ≈ 1.95 D", () => approx(resultant("H2O", 104.5), 1.949, 0.005));
test("linear molecules cancel", () => { approx(resultant("CO2", 180), 0, 1e-9); approx(resultant("BeF2", 180), 0, 1e-9); });
test("bending CO2 makes it polar", () => assert.ok(resultant("CO2", 120) > 1));
test("NF3 rule overshoots ~10x", () => { approx(resultant("NF3", 102.2), 2.263, 0.005); assert.ok(resultant("NF3", 102.2) > 5 * PRESETS.NF3.measured); });
test("NH3 rule ≈ 1.29 D", () => approx(resultant("NH3", 106.7), 1.287, 0.02));
test("planar pyramidal = 0", () => approx(resultant("NH3", 120), 0, 1e-9));
test("clampAngle respects preset range", () => { assert.equal(clampAngle("NH3", 150), 120); assert.equal(clampAngle("H2O", 60), 90); });
```

- [ ] **Step 2: Run, expect FAIL** — `node --test notes/tests/sandbox.test.js` → fails (`Cannot find module`).
- [ ] **Step 3: Implement** the four exports in `docs/sandbox.js` (UMD-style: `if (typeof module !== "undefined") module.exports = api; else window.DipoleSandbox = Object.assign(window.DipoleSandbox || {}, api);`).
- [ ] **Step 4: Run, expect PASS** — `node --test notes/tests/sandbox.test.js` → all 8 pass.

---

### Task 2: Sandbox UI in "Why this project"

**Files:**
- Modify: `docs/sandbox.js` (add `mountSandbox(root: HTMLElement) -> void`)
- Modify: `docs/index.html` (insert card after the first `.story-row` in `#why`; add `<script src="sandbox.js?v=10"></script>` before `app.js`)
- Modify: `docs/style.css` (`.sandbox` block)

**Interfaces:**
- Consumes: Task 1 exports.
- Produces: `window.DipoleSandbox.mountSandbox(root)`; markup `<div class="sandbox" id="sandbox"></div>` inside a card headed **"Try it: add up the bond dipoles"**.

Behaviour: preset chips (H₂O, CO₂, BeF₂, NH₃, NF₃; default H₂O); range slider labelled with the angle (`X–C–X angle` wording per preset); inline SVG (viewBox ~ 360×260) drawing atoms as circles with element labels, each bond dipole as an arrow (length ∝ μb, **pointing toward the more electronegative atom — the NCERT crossed-arrow convention visitors learned**; the caption notes that the 3D viewer's arrow uses the physics convention, the opposite direction), tip-to-tail sum drawn faintly, and the resultant as a bold `--arrow`-coloured arrow. Pyramidal molecules are drawn in side view (axis vertical, one bond in-plane, two projected). Readout row: **Rule: x.xx D · Measured: y.yy D** with the measured value only shown at the preset's default angle (label "measured at the real angle"); for NF₃ add a one-line note: *"The rule says NF₃ is more polar than NH₃. It's 6× less: the lone pair points the other way."* Re-render on slider `input`, chip click, and theme toggle (listen to `#theme` click; read CSS vars at render).

- [ ] **Step 1:** Add markup + script tag; implement `mountSandbox`; call it from `sandbox.js` on `DOMContentLoaded` if `#sandbox` exists.
- [ ] **Step 2: Verify in browser** (Playwright `browser_evaluate` at 1366 and 375 width):
  - click each chip → readout matches `resultant(key, default angle)` to 2 dp; H₂O shows `1.95`, NF₃ shows `2.26` and the NF₃ note.
  - set slider to max on CO₂ → readout `0.00 D`; resultant arrow element hidden (`display:none` or zero length).
  - choose H₂O, set slider 170, click NH₃ → slider value 106.7 (preset default), no `NaN` anywhere in `#sandbox` text.
  - `document.documentElement.scrollWidth === clientWidth` at 375px; console has 0 errors/warnings.

---

### Task 3: Feature-by-feature stepper

**Files:**
- Modify: `docs/app.js` (`showMol`, new `renderStepper(m)`, `playStepper()`)
- Modify: `docs/style.css` (`.stepper` block)

**Interfaces:**
- Consumes: `EX.molecules[i].p` keys `composition__hgb`, `2d__hgb`, `2d_geo__hgb`, `full__hgb`; `m.y`.
- Produces: `renderStepper(m) -> void` writing into `#lab-stepper` (new element in `#lab-body`, placed right after `.vals`); `let stepIdx` (0–3).

Steps (exact labels): `Atom counts` · `+ 2D graph` · `+ 3D shape` · `+ dipole estimates`. Number line: axis from `min(0, …values)` to `max(…values, m.y) × 1.1`; tick for truth labelled `true`; marker labelled with the current prediction (2 dp); faint dots for already-visited steps. Clicking a step sets `stepIdx`; ▶ button auto-advances every 900 ms from 0 to 3; marker moves with a CSS `transition: left .5s` (none under reduced motion). Under the line: `error: |pred − true| D` coloured `--good` (<0.5), `--c2d` (0.5–1.5) or `--bad` (>1.5). Opening a new molecule resets `stepIdx = 3` (show the final answer first). The stepper always uses gradient boosting regardless of the explorer's model select; say so in a one-line caption.

The existing `.predbars` block moves inside `<details class="more"><summary>Compare all models</summary>…</details>`.

- [ ] **Step 1:** Implement; keep `showMol` the single entry point.
- [ ] **Step 2: Verify in browser:**
  - for each demo chip, step 0→3 marker labels equal `f(m.p[key], 2)` for the four keys in order (gdb_130921: step 1 shows `3.37`, step 3 shows `6.26`).
  - gdb_3269 (Ridge-negative molecule): marker `left` within 0–100% at every step.
  - press ▶ then click another chip within 1 s → no stale interval (after 3 s `stepIdx === 3` and labels belong to the new molecule).
  - "Compare all models" contains 10 `.predbar` rows.

---

### Task 4: Animated prediction cloud

**Files:**
- Modify: `docs/index.html` (▶ button `#ex-play` + label inside `.ex-controls`, next to the feature toggle)
- Modify: `docs/app.js` (`animateCloud()`, `cancelCloud()`)

**Interfaces:**
- Consumes: `drawExplorer`, `exFiltered`, `exKey`, current model select.
- Produces: `animateCloud() -> void`, `cancelCloud() -> void`; module-level `let cloudRAF = null`.

Behaviour: button text **"▶ Watch geometry tighten the cloud"**. On click: set feature toggle to *Structure only* state, draw, then interpolate each point's y from `p["2d__<model>"]` to `p["full__<model>"]` over 1500 ms with ease-in-out using `requestAnimationFrame` + `Plotly.restyle("plot-explorer", {y:[ys]}, [0])` (do not rebuild the figure per frame); update the `#ex-stats` MAE figure each frame; at the end switch the toggle to *+ Geometry* and call `drawExplorer()` so the static state is exact. Disabled (with `title` explaining why) when the model is `mean` or `linreg_comp`. Any change to model select, filters, feature toggle, or a point click calls `cancelCloud()` first. Reduced motion → skip straight to the end state.

- [ ] **Step 1:** Implement.
- [ ] **Step 2: Verify in browser:**
  - click ▶ with Gradient boosting; sample MAE at ~200 ms and at end: first value > last; final MAE text equals the static *+ Geometry* MAE (`0.350`).
  - choose `Mean baseline` → button `disabled === true`.
  - click ▶ then change Heavy atoms to `9` at 500 ms → after 2 s, `#ex-stats` "shown" equals the 9-heavy-atom count (3,353), exactly one `#ex-fs` button has class `on`, and the plotted y values equal that toggle's predictions (compare `document.getElementById("plot-explorer").data[0].y[0]` to the expected key).
  - console 0 errors/warnings.

---

### Task 5: Typography and spacing pass

**Files:**
- Modify: `docs/style.css`

Values (from spec): spacing scale tokens `--s1:4px --s2:8px --s3:12px --s4:16px --s5:24px --s6:32px --s7:48px --s8:72px` on `:root`; replace ad-hoc margins/paddings in section, card, finding, tile, details, controls, panel rules with these tokens. Body `font-size: 17px; line-height: 1.7`; `.prose p, .prose li, .takeaway, .step p, .more-body p { max-width: 68ch }`; `h1, h2, h3, .takeaway { text-wrap: balance }`, `p { text-wrap: pretty }`; headings `line-height: 1.2`; section `padding-top: var(--s8)` (`var(--s7)` under 760px); cards padding `var(--s4) var(--s5)`; `.figcap` 14px with `var(--s5)` bottom margin; small UI text (pills, legends, table headers) unchanged in size. Contrast: muted text vs background ≥ 4.5:1 in both themes (check `--muted` on `--bg` and on `--surface`; darken/lighten `--muted` if below).

- [ ] **Step 1:** Apply.
- [ ] **Step 2: Verify:** compute contrast ratios in the browser for `--muted` on `--bg`/`--surface`, light and dark → all ≥ 4.5; screenshot hero, Why (with sandbox), Results, Explorer at 1366 and 375 and inspect; 375px `scrollWidth === clientWidth`.

---

### Task 6: Full regression check

- [ ] Run `node --test notes/tests/sandbox.test.js` → pass.
- [ ] In the browser (1366, then 375; light, then dark): all 8 Plotly plots render with no clipped text; 5 tables populated; no unbound `[data-v]`; 2D/3D toggle works for all 4 demo molecules; Method tabs switch; sandbox, stepper and cloud checks from Tasks 2–4 still pass; console 0 errors/warnings.
- [ ] Emulate `prefers-reduced-motion: reduce` (Playwright `browser_emulate_media`) → cloud ▶ jumps to end state, stepper marker has no transition.
- [ ] Bump `?v=` on `style.css`, `app.js`, `sandbox.js`; report to user; offer push.
