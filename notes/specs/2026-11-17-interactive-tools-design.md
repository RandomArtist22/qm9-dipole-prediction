# Interactive concept tools + typography pass — design (approved 2026-11-17)

## Intent
The site's explorer feels static. Visitors should *play* with the concept: see the textbook
vector-sum rule work and fail, and see how each feature group moves the model toward the truth.
Also improve readability (spacing, margins, typography).

## Goals
1. **Bend-a-molecule sandbox** (in "Why this project", after the first NCERT excerpt, as a "Try it" card)
   - Flat 2D SVG; bond-dipole arrows added tip-to-tail into a bold resultant with value in Debye.
   - Presets: H₂O, CO₂, BeF₂, NH₃, NF₃. Angle slider (180°→90°) for triatomics.
   - Arrow sizes from standard textbook bond-dipole values (verified before use); H₂O at 104.5° ≈ 1.84 D.
   - NH₃ / NF₃ show rule result vs measured value so the lone-pair failure is visible.
2. **Feature-by-feature stepper** (molecule panel; replaces 10-model bars as the main view)
   - Cumulative steps: atom counts (`composition__hgb`) → + 2D graph (`2d__hgb`) → + 3D shape (`2d_geo__hgb`)
     → + dipole estimates = all features (`full__hgb`).
   - Number line with true-value tick; marker animates between steps; ▶ auto-play.
   - 10-model bars move into a "Compare all models" disclosure.
3. **Animated cloud** (above the scatter)
   - ▶ morphs every point from structure-only to + geometry prediction (~1.5 s); MAE readout updates.
   - Disabled for the baselines (no 2D/3D variants).
4. **Typography / spacing**: 4-8-12-16-24-32-48-72 spacing scale; 17px body, 1.7 line height, ~68ch measure;
   tighter headings with `text-wrap: balance`; more section breathing room; roomier cards; contrast checked in both themes.

## Non-goals
Guessing game; bond-arrow overlay in the 3D viewer; any pipeline / data re-export.

## Constraints
Static GitHub Pages site (`docs/`), no build step; existing libs only (Plotly 2.35.2, 3Dmol, SmilesDrawer).
Must work at 375px width, both themes, no console errors. `prefers-reduced-motion` disables animation.

## Approaches considered
- Sandbox in 2D SVG (chosen: clearest for vector addition, no extra lib) vs 3D via 3Dmol (harder to read arrows, angles).
- Stepper using existing per-featureset predictions (chosen: no new data) vs re-running models (out of scope).
- Cloud morph via Plotly `animate` on the existing scattergl trace (chosen) vs a separate canvas animation.

## Left to the builder
Exact bond-moment table (must be sourced/verified), visual details, copy.
