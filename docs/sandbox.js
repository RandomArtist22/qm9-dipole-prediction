// Bond-dipole "sandbox" math: a simple electronegativity-difference model
// (bond dipole = K · Δχ · bond length) summed over the molecular geometry.
(function () {
  const K = 1.34; // Debye per (Pauling unit · Å)

  const PAULING = { H: 2.20, Be: 1.57, C: 2.55, N: 3.04, O: 3.44, F: 3.98 };

  const PRESETS = {
    H2O: { label: "H₂O", center: "O", ligand: "H", shape: "bent", n: 2, length: 0.958, angle: 104.5, min: 90, max: 180, measured: 1.85 },
    CO2: { label: "CO₂", center: "C", ligand: "O", shape: "bent", n: 2, length: 1.16, angle: 180, min: 90, max: 180, measured: 0 },
    BeF2: { label: "BeF₂", center: "Be", ligand: "F", shape: "bent", n: 2, length: 1.39, angle: 180, min: 90, max: 180, measured: 0 },
    NH3: { label: "NH₃", center: "N", ligand: "H", shape: "pyramidal", n: 3, length: 1.012, angle: 106.7, min: 90, max: 120, measured: 1.47 },
    NF3: { label: "NF₃", center: "N", ligand: "F", shape: "pyramidal", n: 3, length: 1.365, angle: 102.2, min: 90, max: 120, measured: 0.23 },
  };

  function preset(key) {
    const p = PRESETS[key];
    if (!p) throw new Error(`Unknown molecule preset: ${key}`);
    return p;
  }

  // Bond dipole magnitude in Debye for one bond of the preset.
  function bondDipole(key) {
    const p = preset(key);
    const deltaChi = Math.abs(PAULING[p.center] - PAULING[p.ligand]);
    return K * deltaChi * p.length;
  }

  // Net molecular dipole in Debye for the preset geometry at angleDeg.
  // Bent: n bonds, each at half-angle θ/2 from the symmetry axis.
  // Pyramidal: θ is the X–N–X angle; each bond makes angle α with the C3 axis,
  // where cos α = √((1 + 2cos θ)/3), and the axial components add.
  function resultant(key, angleDeg) {
    const p = preset(key);
    const mu = bondDipole(key);
    const theta = (angleDeg * Math.PI) / 180;
    if (p.shape === "bent") {
      return p.n * mu * Math.abs(Math.cos(theta / 2));
    }
    // Tolerance guards floating-point noise at the planar limit (θ = 120°),
    // where 1 + 2cos θ is ~1e-16 rather than 0 and its square root would not be.
    const cosAlphaSq = (1 + 2 * Math.cos(theta)) / 3;
    if (cosAlphaSq <= 1e-12) return 0;
    return p.n * mu * Math.sqrt(cosAlphaSq);
  }

  function clampAngle(key, angleDeg) {
    const p = preset(key);
    return Math.min(p.max, Math.max(p.min, angleDeg));
  }

  // ---------------------------------------------------------------- UI
  // px per Debye, per molecule: chosen so the largest resultant in the slider range is ~95 px tall.
  function scaleFor(key) {
    const p = PRESETS[key];
    let max = 0;
    for (let a = p.min; a <= p.max; a += 1) max = Math.max(max, resultant(key, a));
    return Math.min(30, 95 / max);
  }
  const BOND_PX = 80; // drawn bond length
  const MOL = { x: 100, bentY: 90, pyrY: 80 };
  const ORIGIN = { x: 262, y: 130 }; // where the vector sum is built
  const f1 = (v) => v.toFixed(1);
  const f2 = (v) => v.toFixed(2);

  // Unit direction vectors (screen coords, y down) from the centre atom to each ligand.
  function bondDirections(p, angleDeg) {
    const theta = (angleDeg * Math.PI) / 180;
    if (p.shape === "bent") {
      return [[-Math.sin(theta / 2), Math.cos(theta / 2)], [Math.sin(theta / 2), Math.cos(theta / 2)]];
    }
    const c = Math.sqrt(Math.max(0, (1 + 2 * Math.cos(theta)) / 3)); // cos α
    const s = Math.sqrt(1 - c * c);
    // Side view with the C3 axis vertical; slightly rotated so the two out-of-plane bonds do not overlap.
    return [180 + 25, 60 + 25, -60 + 25].map((d) => {
      const phi = (d * Math.PI) / 180;
      return [s * Math.cos(phi), c];
    });
  }

  function arrow(x1, y1, x2, y2, cls, head) {
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
    if (len < 1) return "";
    const ux = dx / len, uy = dy / len, h = Math.min(head, len * 0.6), w = h * 0.55;
    const bx = x2 - ux * h, by = y2 - uy * h;
    return `<g class="${cls}"><line x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(bx)}" y2="${f1(by)}"/>` +
      `<path d="M${f1(x2)} ${f1(y2)} L${f1(bx - uy * w)} ${f1(by + ux * w)} L${f1(bx + uy * w)} ${f1(by - ux * w)} Z"/></g>`;
  }

  function drawMolecule(key, angle) {
    const p = PRESETS[key];
    const sgn = PAULING[p.ligand] > PAULING[p.center] ? 1 : -1; // toward the more electronegative atom
    const mu = bondDipole(key), SCALE = scaleFor(key);
    const cx = MOL.x, cy = p.shape === "bent" ? MOL.bentY : MOL.pyrY;
    const dirs = bondDirections(p, angle);
    let bonds = "", arrows = "", atoms = "", sumFaint = "";
    let rx = 0, ry = 0, tx = ORIGIN.x, ty = ORIGIN.y;
    dirs.forEach(([ux, uy]) => {
      const lx = cx + BOND_PX * ux, ly = cy + BOND_PX * uy;
      bonds += `<line class="sb-bond" x1="${cx}" y1="${cy}" x2="${f1(lx)}" y2="${f1(ly)}"/>`;
      atoms += `<circle class="sb-atom" cx="${f1(lx)}" cy="${f1(ly)}" r="13"/><text class="sb-el" x="${f1(lx)}" y="${f1(ly + 4.5)}">${p.ligand}</text>`;
      // bond dipole arrow, offset a little to the side of the bond, centred on it
      const blen = Math.hypot(ux, uy) * BOND_PX;
      const nx = -uy / (blen / BOND_PX), ny = ux / (blen / BOND_PX);
      const mx = cx + (lx - cx) / 2 + nx * 10, my = cy + (ly - cy) / 2 + ny * 10;
      const vx = sgn * mu * SCALE * ux, vy = sgn * mu * SCALE * uy;
      arrows += arrow(mx - vx / 2, my - vy / 2, mx + vx / 2, my + vy / 2, "sb-bondarrow", 8);
      // tip-to-tail construction
      sumFaint += arrow(tx, ty, tx + vx, ty + vy, "sb-faint", 8);
      tx += vx; ty += vy; rx += vx; ry += vy;
    });
    const lone = p.shape === "pyramidal"
      ? `<ellipse class="sb-lone" cx="${cx}" cy="${cy - 24}" rx="8" ry="13"/><text class="sb-note" x="${cx}" y="${cy - 44}">lone pair</text>` : "";
    atoms = `${lone}${atoms}<circle class="sb-atom center" cx="${cx}" cy="${cy}" r="15"/><text class="sb-el" x="${cx}" y="${cy + 4.5}">${p.center}</text>`;
    const value = resultant(key, angle);
    const res = value < 0.005 ? "" : arrow(ORIGIN.x, ORIGIN.y, ORIGIN.x + rx, ORIGIN.y + ry, "sb-res", 13);
    const dot = `<circle class="sb-origin" cx="${ORIGIN.x}" cy="${ORIGIN.y}" r="3"/>`;
    const cap = `<text class="sb-note" x="${ORIGIN.x}" y="250">vector sum</text>`;
    return { svg: bonds + arrows + atoms + sumFaint + dot + res + cap, value };
  }

  function mountSandbox(root) {
    if (!root) return;
    const keys = Object.keys(PRESETS);
    let key = "H2O";
    let angle = PRESETS[key].angle;

    root.innerHTML =
      `<div class="sb-chips" role="group" aria-label="Choose a molecule">` +
      keys.map((k) => `<button type="button" class="sb-chip" data-key="${k}" aria-pressed="false">${PRESETS[k].label}</button>`).join("") +
      `</div>` +
      `<svg class="sb-svg" viewBox="0 0 360 260" role="img" aria-label="Bond dipoles and their vector sum"></svg>` +
      `<div class="sb-slider"><label for="sb-range"><span class="sb-lab"></span> <b class="sb-val"></b></label>` +
      `<input id="sb-range" type="range" step="0.1"></div>` +
      `<p class="sb-read"><span class="sb-rule"></span> <span class="sb-sep">·</span> <span class="sb-meas"></span></p>` +
      `<p class="sb-nf3" hidden>The rule says NF₃ is more polar than NH₃. It's 6× less: the lone pair points the other way.</p>` +
      `<p class="sb-cap">Thin arrows beside each bond are the bond dipoles, pointing toward the more electronegative atom (the NCERT convention). ` +
      `Faint arrows add them tip to tail; the bold arrow is the resultant. Arrow scale is set per molecule. The 3D viewer draws its arrow the opposite way (physics convention).</p>`;

    const $ = (s) => root.querySelector(s);
    const svg = $(".sb-svg"), range = $(".sb-slider input"), chips = root.querySelectorAll(".sb-chip");

    function render() {
      const p = PRESETS[key];
      angle = clampAngle(key, angle);
      const { svg: markup, value } = drawMolecule(key, angle);
      svg.innerHTML = markup;
      svg.setAttribute("aria-label", `${p.label}: resultant dipole ${f2(value)} D at ${f1(angle)} degrees`);
      range.value = angle;
      $(".sb-lab").textContent = `${p.ligand}–${p.center}–${p.ligand} angle`;
      $(".sb-val").textContent = `${f1(angle)}°`;
      $(".sb-rule").innerHTML = `Rule: <b>${f2(value)} D</b>`;
      const real = Math.abs(angle - p.angle) < 0.05;
      $(".sb-meas").innerHTML = real
        ? `Measured: <b>${f2(p.measured)} D</b> <span class="sb-sub">(measured at the real angle)</span>`
        : `<span class="sb-sub">Measured: only at the real angle (${f1(p.angle)}°)</span>`;
      $(".sb-nf3").hidden = key !== "NF3";
      chips.forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.key === key)));
    }

    function select(k) {
      key = k;
      angle = PRESETS[k].angle;
      range.min = PRESETS[k].min;
      range.max = PRESETS[k].max;
      render();
    }

    chips.forEach((c) => c.addEventListener("click", () => select(c.dataset.key)));
    range.addEventListener("input", () => {
      const v = parseFloat(range.value);
      if (Number.isFinite(v)) { angle = v; render(); }
    });
    select(key);
  }

  const api = { PRESETS, bondDipole, resultant, clampAngle, mountSandbox };

  if (typeof module !== "undefined") {
    module.exports = api;
  } else {
    window.DipoleSandbox = Object.assign(window.DipoleSandbox || {}, api);
  }

  if (typeof document !== "undefined") {
    const auto = () => mountSandbox(document.getElementById("sandbox"));
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", auto);
    else auto();
  }
})();
