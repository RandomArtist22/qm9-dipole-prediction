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

  const api = { PRESETS, bondDipole, resultant, clampAngle };

  if (typeof module !== "undefined") {
    module.exports = api;
  } else {
    window.DipoleSandbox = Object.assign(window.DipoleSandbox || {}, api);
  }
})();
