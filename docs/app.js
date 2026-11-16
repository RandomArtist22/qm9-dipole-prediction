/* QM9 dipole project site: binds numbers from data/summary.json, draws charts,
   and drives the prediction explorer (data/explorer.json). No server needed. */
(function () {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const f = (x, d = 3) => (x === null || x === undefined || Number.isNaN(x) ? "–" : Number(x).toFixed(d));
  const pct = (x) => `${Math.round(x)}%`;
  let S = null, EX = null;

  // ---------------- theme ----------------
  try {
    const saved = localStorage.getItem("theme");
    if (saved) document.documentElement.setAttribute("data-theme", saved);
  } catch (e) { /* storage unavailable */ }
  $("#theme").addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme") ||
      (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("theme", next); } catch (e) { /* ignore */ }
    if (S) drawAll();
  });

  // ---------------- nav highlight ----------------
  const links = $$("#nav a");
  const obs = new IntersectionObserver((ents) => {
    ents.forEach((e) => {
      if (e.isIntersecting) links.forEach((a) => a.classList.toggle("active", a.getAttribute("href") === "#" + e.target.id));
    });
  }, { rootMargin: "-40% 0px -55% 0px" });
  $$("section[id]").forEach((s) => obs.observe(s));

  function baseLayout(extra = {}) {
    return Object.assign({
      paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
      font: { family: "Inter, Arial, sans-serif", size: 12, color: css("--ink") },
      margin: { l: 60, r: 16, t: 30, b: 50 },
      xaxis: { gridcolor: css("--line"), zerolinecolor: css("--line") },
      yaxis: { gridcolor: css("--line"), zerolinecolor: css("--line") },
      legend: { orientation: "h", y: -0.2 },
    }, extra);
  }
  const CFG = { displaylogo: false, responsive: true, modeBarButtonsToRemove: ["lasso2d", "select2d"] };
  const ML = () => S.model_labels;

  function row(model, fs) {
    return S.model_table.find((r) => r.model === model && r.featureset === fs);
  }

  // ---------------- bindings ----------------
  function bind() {
    const q = S.data_quality, best = row("hgb", "full"), b2d = row("hgb", "2d"), mean = row("mean", "composition");
    const rob = S.robustness.find((r) => r.model === "hgb" && r.featureset === "full");
    const V = {
      best_mae: f(best.mae_s0, 3) + " D",
      best_vs_mean: pct(best.improve_vs_mean_pct),
      mean_mae: f(mean.mae_s0, 2),
      geo_gain: pct(100 * (1 - best.mae_s0 / b2d.mae_s0)),
      size_penalty: rob && rob.size_le8 ? "+" + pct(100 * (rob.size_le8 / rob.size_control - 1)) : "–",
      n_sdf: q.n_sdf_blocks.toLocaleString(), n_kept: q.n_kept.toLocaleString(),
      mu_mean: f(q.mu_describe.mean, 2), mu_median: f(q.mu_describe["50%"], 2), mu_max: f(q.mu_describe.max, 1),
      mu_skew: f(q.mu_skew, 2), n_fail: q.n_rdkit_failures.toLocaleString(), mu_fail: f(q.mu_failed_mean, 2),
      mu_kept: f(q.mu_kept_mean, 2), dup_rows: q.n_rows_sharing_2d_graph, dup_spread: f(q.max_mu_spread_within_same_2d_graph, 1),
      n_above10: q.n_mu_above_10, n_below01: q["n_mu_below_0.1"], n_zero: q.n_mu_exactly_zero,
      n_test: S.splits.random_s0.n_test.toLocaleString(), n_scaf_test: S.splits.scaffold.n_test.toLocaleString(),
      n_explorer: EX ? (EX.molecules.length - 15).toLocaleString() : "4,000",
    };
    $$("[data-v]").forEach((el) => { if (V[el.dataset.v] !== undefined) el.textContent = V[el.dataset.v]; });
  }

  // ---------------- histogram ----------------
  function drawHist() {
    const h = S.mu_histogram, x = h.map((_, i) => i * 0.25 + 0.125);
    Plotly.react("plot-hist", [{ type: "bar", x, y: h, marker: { color: css("--accent") }, hovertemplate: "μ ≈ %{x:.2f} D<br>%{y} molecules<extra></extra>" }],
      baseLayout({ xaxis: { title: "dipole moment μ (Debye)", gridcolor: css("--line") }, yaxis: { title: "molecules", type: "log", gridcolor: css("--line") }, bargap: 0, height: 300 }), CFG);
  }

  // ---------------- model comparison ----------------
  let metric = "mae";
  function drawModels() {
    const key = { mae: "mae_s0", rmse: "rmse_s0", r2: "r2_s0" }[metric];
    const models = ["mean", "linreg_comp", "ridge", "lasso", "knn", "tree", "svr", "mlp", "rf", "hgb"].filter((m) => S.model_table.some((r) => r.model === m));
    const order = models.slice().sort((a, b) => {
      const pick = (m) => row(m, "full") || row(m, "2d") || row(m, "composition");
      const ra = pick(a), rb = pick(b);
      return metric === "r2" ? ra[key] - rb[key] : rb[key] - ra[key];
    });
    const lab = order.map((m) => ML()[m]);
    const tr = [];
    const mk = (fs, name, color) => {
      const xs = [], ys = [], lo = [], hi = [];
      order.forEach((m) => {
        const r = row(m, fs);
        if (!r) { xs.push(null); ys.push(ML()[m]); lo.push(0); hi.push(0); return; }
        xs.push(r[key]); ys.push(ML()[m]);
        lo.push(metric === "mae" ? r.mae_s0 - r.mae_ci_lo : 0); hi.push(metric === "mae" ? r.mae_ci_hi - r.mae_s0 : 0);
      });
      tr.push({ type: "bar", orientation: "h", name, x: xs, y: ys, marker: { color },
        error_x: metric === "mae" ? { type: "data", symmetric: false, array: hi, arrayminus: lo, color: css("--muted"), thickness: 1 } : undefined,
        hovertemplate: `%{y}<br>${name}: %{x:.3f}<extra></extra>` });
    };
    mk("composition", "baseline", css("--cbase"));
    mk("2d", "structure only (2D)", css("--c2d"));
    mk("full", "structure + geometry", css("--cfull"));
    const t = { mae: "test MAE (Debye) — lower is better", rmse: "test RMSE (Debye) — lower is better", r2: "test R² — higher is better" }[metric];
    Plotly.react("plot-models", tr, baseLayout({ barmode: "group", height: 440, margin: { l: 170, r: 16, t: 10, b: 70 },
      xaxis: { title: t, gridcolor: css("--line") }, yaxis: { categoryorder: "array", categoryarray: lab, gridcolor: css("--line") } }), CFG);
  }
  $$("#metric-seg button").forEach((b) => b.addEventListener("click", () => {
    $$("#metric-seg button").forEach((x) => x.classList.toggle("on", x === b));
    metric = b.dataset.m; drawModels();
  }));

  function tableModels() {
    const rows = S.model_table.filter((r) => ["2d", "full", "composition"].includes(r.featureset))
      .sort((a, b) => a.mae_s0 - b.mae_s0);
    const bestKey = rows[0];
    let h = `<thead><tr><th>Model</th><th>Features</th><th class="n">MAE seed 0 [95% CI]</th><th class="n">MAE mean ± sd (seeds)</th>
      <th class="n">RMSE</th><th class="n">R²</th><th class="n">vs mean</th><th class="n">CV MAE (tuning)</th><th>chosen hyper-parameters</th></tr></thead><tbody>`;
    rows.forEach((r) => {
      const cls = r === bestKey ? "best" : (r.featureset === "composition" ? "base" : "");
      const params = Object.entries(r.best_params_s0 || {}).map(([k, v]) => `${k.replace("m__", "")}=${v}`).join(", ") || "—";
      h += `<tr class="${cls}"><td>${r.model_label}</td><td>${r.model === "mean" ? "none" : r.featureset === "composition" ? "atom counts" : r.featureset === "2d" ? "structure only" : "structure + geometry"}</td>
        <td class="n">${f(r.mae_s0)} [${f(r.mae_ci_lo)}, ${f(r.mae_ci_hi)}]</td>
        <td class="n">${r.n_seeds > 1 ? `${f(r.mae_mean)} ± ${f(r.mae_std)} (${r.n_seeds})` : "1 seed"}</td>
        <td class="n">${f(r.rmse_s0)}</td><td class="n">${f(r.r2_s0)}</td><td class="n">${r.model === "mean" ? "—" : "−" + pct(r.improve_vs_mean_pct)}</td>
        <td class="n">${f(r.cv_mae_s0)}</td><td style="font-size:12.5px">${params}</td></tr>`;
    });
    $("#tbl-models").innerHTML = h + "</tbody>";
  }

  // ---------------- ablation + importance ----------------
  function drawAblation() {
    const order = ["composition", "2d", "2d_geo", "2d_phys", "full"];
    const tr = ["ridge", "hgb"].map((m, i) => {
      const pts = order.map((fs) => S.ablation.find((a) => a.model === m && a.featureset === fs));
      return { type: "bar", name: ML()[m], x: order.map((fs) => S.featureset_labels[fs]), y: pts.map((p) => (p ? p.test_mae : null)),
        marker: { color: i ? css("--cfull") : css("--c2d") }, hovertemplate: "%{x}<br>MAE %{y:.3f}<extra>" + ML()[m] + "</extra>" };
    });
    Plotly.react("plot-ablation", tr, baseLayout({ barmode: "group", height: 340, margin: { l: 50, r: 10, t: 10, b: 110 },
      yaxis: { title: "test MAE (D)", gridcolor: css("--line") }, xaxis: { tickangle: -25 }, legend: { orientation: "h", y: 1.12 } }), CFG);
    const gi = S.group_importance.slice().sort((a, b) => a.delta_mae_mean - b.delta_mae_mean);
    Plotly.react("plot-importance", [{ type: "bar", orientation: "h", y: gi.map((g) => g.label), x: gi.map((g) => g.delta_mae_mean),
      error_x: { type: "data", array: gi.map((g) => g.delta_mae_std), color: css("--muted") }, marker: { color: css("--cfull") },
      hovertemplate: "%{y}<br>MAE rises by %{x:.3f} D<extra></extra>" }],
      baseLayout({ height: 340, margin: { l: 200, r: 10, t: 10, b: 50 }, xaxis: { title: "increase in test MAE when shuffled (D)", gridcolor: css("--line") } }), CFG);
  }

  function drawLC() {
    const tr = [];
    [["2d", css("--c2d")], ["full", css("--cfull")]].forEach(([fs, c]) => {
      const d = S.learning_curve.filter((r) => r.featureset === fs);
      tr.push({ x: d.map((r) => r.n_train), y: d.map((r) => r.test_mae), mode: "lines+markers", name: S.featureset_labels[fs] + " · test", line: { color: c } });
      tr.push({ x: d.map((r) => r.n_train), y: d.map((r) => r.train_mae), mode: "lines+markers", name: "train", line: { color: c, dash: "dot" }, opacity: 0.6 });
    });
    Plotly.react("plot-lc", tr, baseLayout({ height: 330, xaxis: { type: "log", title: "training molecules", gridcolor: css("--line") }, yaxis: { title: "MAE (D)", gridcolor: css("--line") } }), CFG);
  }

  function tableTests() {
    let h = `<thead><tr><th>Comparison (A vs B)</th><th class="n">MAE(A) − MAE(B)</th><th class="n">95% CI</th><th class="n">bootstrap p</th></tr></thead><tbody>`;
    Object.values(S.paired_tests).forEach((t) => {
      h += `<tr><td>${t.label}</td><td class="n">${f(t.diff)}</td><td class="n">[${f(t.ci_lo)}, ${f(t.ci_hi)}]</td><td class="n">${t.p_boot <= 0.0005 ? "&lt; 0.001" : f(t.p_boot, 3)}</td></tr>`;
    });
    $("#tbl-tests").innerHTML = h + "</tbody>";
  }

  // ---------------- error analysis ----------------
  function drawBins() {
    const b = S.error_analysis.by_mu_bin, x = b.map((r) => `${r.mu_bin} D<br>n=${r.n}`);
    Plotly.react("plot-bins", [
      { type: "bar", name: "mean baseline", x, y: b.map((r) => r.mae_mean_baseline), marker: { color: css("--cbase") } },
      { type: "bar", name: "GB structure only", x, y: b.map((r) => r.mae_2d), marker: { color: css("--c2d") } },
      { type: "bar", name: "GB + geometry", x, y: b.map((r) => r.mae), marker: { color: css("--cfull") } },
      { type: "scatter", mode: "lines+markers", name: "mean residual (pred − true), GB + geometry", x, y: b.map((r) => r.mean_resid), yaxis: "y2", line: { color: css("--bad") } },
    ], baseLayout({ barmode: "group", height: 360, yaxis: { title: "test MAE (D)", gridcolor: css("--line") },
      yaxis2: { title: "mean residual (D)", overlaying: "y", side: "right", zeroline: true, zerolinecolor: css("--bad"), showgrid: false },
      margin: { l: 60, r: 60, t: 10, b: 70 } }), CFG);
  }
  function tableGroups() {
    let h = `<thead><tr><th>Group (test molecules)</th><th class="n">n</th><th class="n">mean true μ</th><th class="n">MAE structure only</th><th class="n">MAE + geometry</th><th class="n">mean residual</th></tr></thead><tbody>`;
    S.error_analysis.by_group.forEach((g) => {
      h += `<tr><td>${g.group}</td><td class="n">${g.n.toLocaleString()}</td><td class="n">${f(g.mean_true, 2)}</td><td class="n">${f(g.mae_2d)}</td><td class="n">${f(g.mae)}</td><td class="n">${f(g.mean_resid)}</td></tr>`;
    });
    const all = row("hgb", "full");
    h += `<tr class="base"><td>All test molecules</td><td class="n">${S.splits.random_s0.n_test.toLocaleString()}</td><td class="n">—</td><td class="n">${f(row("hgb", "2d").mae_s0)}</td><td class="n">${f(all.mae_s0)}</td><td class="n">—</td></tr>`;
    $("#tbl-groups").innerHTML = h + "</tbody>";
  }
  function tableWorst() {
    let h = `<thead><tr><th>id</th><th>SMILES</th><th class="n">heavy</th><th class="n">true μ</th><th class="n">pred + geom</th><th class="n">pred 2D</th><th class="n">|error|</th></tr></thead><tbody>`;
    S.error_analysis.worst.forEach((w) => {
      h += `<tr><td>${w.mol_id}</td><td><code>${w.smiles}</code></td><td class="n">${w.comp_nheavy}</td><td class="n">${f(w.y_true, 2)}</td><td class="n">${f(w.pred, 2)}</td><td class="n">${f(w["2d__hgb"], 2)}</td><td class="n">${f(w.abs_err, 2)}</td></tr>`;
    });
    $("#tbl-worst").innerHTML = h + "</tbody>";
  }

  // ---------------- robustness ----------------
  function drawRobust() {
    const rr = S.robustness.filter((r) => r.featureset !== "2d" || true);
    const cols = [["random_all", "random (all)"], ["random_ring_only", "random (ring-only)"], ["scaffold", "scaffold split"],
      ["size_control", "size control (random, same n)"], ["size_le8", "train ≤ 8 → test 9"]];
    const sel = rr.filter((r) => ["hgb", "rf", "ridge", "linreg_comp", "mean"].includes(r.model));
    const tr = sel.map((r) => ({ type: "bar", name: `${r.model_label}${r.featureset === "composition" ? "" : r.featureset === "full" ? " · +geom" : " · 2D"}`,
      x: cols.map((c) => c[1]), y: cols.map((c) => r[c[0]]),
      marker: { color: r.featureset === "composition" ? css("--cbase") : r.featureset === "full" ? css("--cfull") : css("--c2d"),
        opacity: r.model === "hgb" ? 1 : r.model === "rf" ? 0.75 : 0.5 },
      hovertemplate: "%{x}<br>MAE %{y:.3f}<extra>%{fullData.name}</extra>" }));
    Plotly.react("plot-robust", tr, baseLayout({ barmode: "group", height: 400, yaxis: { title: "test MAE (D)", gridcolor: css("--line") }, margin: { l: 60, r: 10, t: 10, b: 110 } }), CFG);
    let h = `<thead><tr><th>Model</th><th>Features</th><th class="n">random (all)</th><th class="n">random ring-only</th><th class="n">scaffold</th><th class="n">scaffold vs ring-only</th><th class="n">size control</th><th class="n">≤8 → 9</th><th class="n">size vs control</th></tr></thead><tbody>`;
    rr.forEach((r) => {
      const sgn = (v) => (v >= 0 ? "+" : "−") + pct(Math.abs(v));
      const d1 = r.scaffold && r.random_ring_only ? sgn(100 * (r.scaffold / r.random_ring_only - 1)) : "–";
      const d2 = r.size_le8 && r.size_control ? (r.size_le8 >= r.size_control ? "+" : "−") + pct(Math.abs(100 * (r.size_le8 / r.size_control - 1))) : "–";
      h += `<tr><td>${r.model_label}</td><td>${r.model === "mean" ? "none" : r.featureset === "composition" ? "atom counts" : r.featureset === "full" ? "+ geometry" : "structure only"}</td>
        <td class="n">${f(r.random_all)}</td><td class="n">${f(r.random_ring_only)}</td><td class="n">${f(r.scaffold)}</td><td class="n">${d1}</td>
        <td class="n">${f(r.size_control)}</td><td class="n">${f(r.size_le8)}</td><td class="n">${d2}</td></tr>`;
    });
    $("#tbl-robust").innerHTML = h + "</tbody>";
  }

  // ---------------- explorer (main interaction) ----------------
  let exFS = "full", selected = null;
  function exKey(model) {
    if (model === "mean" || model === "linreg_comp") return `composition__${model}`;
    return `${exFS}__${model}`;
  }
  function exInit() {
    const models = [...new Set(EX.columns.map((c) => c.split("__")[1]))];
    const pref = ["hgb", "rf", "svr", "mlp", "knn", "tree", "ridge", "lasso", "linreg_comp", "mean"];
    const sel = $("#ex-model");
    pref.filter((m) => models.includes(m)).forEach((m) => {
      const o = document.createElement("option"); o.value = m; o.textContent = ML()[m]; sel.appendChild(o);
    });
    ["#ex-model", "#ex-heavy", "#ex-ring", "#ex-lo", "#ex-hi"].forEach((id) => $(id).addEventListener("input", drawExplorer));
    $$("#ex-fs button").forEach((b) => b.addEventListener("click", () => {
      $$("#ex-fs button").forEach((x) => x.classList.toggle("on", x === b)); exFS = b.dataset.f; drawExplorer(); if (selected) showMol(selected);
    }));
  }
  function exFiltered() {
    const hv = $("#ex-heavy").value, rg = $("#ex-ring").value;
    const lo = parseFloat($("#ex-lo").value) || 0, hi = parseFloat($("#ex-hi").value); const hiv = Number.isFinite(hi) ? hi : 99;
    return EX.molecules.filter((m) => (hv === "all" || (hv === "le7" ? m.h <= 7 : m.h === +hv)) &&
      (rg === "all" || m.ring === +rg) && m.y >= lo && m.y <= hiv);
  }
  function drawExplorer() {
    const model = $("#ex-model").value, key = exKey(model), mols = exFiltered();
    const xs = mols.map((m) => m.y), ys = mols.map((m) => m.p[key]);
    const err = mols.map((m) => Math.abs(m.p[key] - m.y));
    const n = mols.length, mae = n ? err.reduce((a, b) => a + b, 0) / n : NaN;
    const maeBase = n ? mols.reduce((a, m) => a + Math.abs(m.p["composition__mean"] - m.y), 0) / n : NaN;
    const bias = n ? mols.reduce((a, m) => a + (m.p[key] - m.y), 0) / n : NaN;
    const within = n ? err.filter((e) => e < 0.5).length / n : NaN;
    $("#ex-stats").innerHTML = `<span>shown: <b>${n.toLocaleString()}</b></span><span>MAE: <b>${f(mae)}</b> D</span>
      <span>mean-baseline MAE on same molecules: <b>${f(maeBase)}</b> D</span><span>bias (pred − true): <b>${f(bias)}</b> D</span>
      <span>within 0.5 D: <b>${Number.isFinite(within) ? pct(100 * within) : "–"}</b></span>`;
    const mx = Math.max(1, ...xs, ...ys.filter(Number.isFinite));
    const trace = { type: "scattergl", mode: "markers", x: xs, y: ys, customdata: mols.map((m) => m.id),
      text: mols.map((m) => m.s), marker: { size: 5, color: err, colorscale: "Viridis", cmin: 0, cmax: 2, opacity: 0.75,
        colorbar: { title: "|error| D", thickness: 10 } },
      hovertemplate: "%{text}<br>true %{x:.2f} D · pred %{y:.2f} D<extra></extra>" };
    const diag = { x: [0, mx], y: [0, mx], mode: "lines", line: { color: css("--muted"), dash: "dash", width: 1 }, hoverinfo: "skip", showlegend: false };
    const tr = [trace, diag];
    if (selected) {
      const m = EX.molecules.find((q) => q.id === selected);
      if (m) tr.push({ x: [m.y], y: [m.p[key]], mode: "markers", marker: { size: 14, color: "rgba(0,0,0,0)", line: { color: css("--bad"), width: 2.5 } }, hoverinfo: "skip", showlegend: false });
    }
    Plotly.react("plot-explorer", tr, baseLayout({ height: 440, showlegend: false, margin: { l: 55, r: 10, t: 10, b: 50 },
      xaxis: { title: "true μ (D)", range: [0, mx * 1.03], gridcolor: css("--line") }, yaxis: { title: `predicted μ (D) · ${ML()[model]}`, range: [0, mx * 1.03], gridcolor: css("--line") } }), CFG);
    const el = $("#plot-explorer");
    if (!el._bound) {
      el.on("plotly_click", (ev) => { const p = ev.points[0]; if (p && p.customdata) { selected = p.customdata; showMol(selected); drawExplorer(); } });
      el._bound = true;
    }
  }
  function showMol(id) {
    const m = EX.molecules.find((q) => q.id === id); if (!m) return;
    const models = ["mean", "linreg_comp", "ridge", "lasso", "knn", "tree", "svr", "mlp", "rf", "hgb"].filter((x) => m.p[exKey(x)] !== undefined);
    let rows = models.map((x) => {
      const p = m.p[exKey(x)], e = p - m.y;
      return `<tr><td>${ML()[x]}</td><td class="n">${f(p, 2)}</td><td class="n" style="color:${Math.abs(e) < 0.5 ? css("--good") : Math.abs(e) > 1.5 ? css("--bad") : "inherit"}">${e >= 0 ? "+" : ""}${f(e, 2)}</td></tr>`;
    }).join("");
    $("#ex-panel").innerHTML = `<h4>${m.id} <span class="pill">${m.h} heavy atoms</span> ${m.ring ? '<span class="pill">ring</span>' : '<span class="pill">acyclic</span>'}</h4>
      <svg id="mol-svg" role="img" aria-label="2D structure of ${m.s}"></svg>
      <div style="margin:6px 0"><code style="word-break:break-all">${m.s}</code></div>
      <div>True (DFT) μ: <b>${f(m.y, 2)} D</b> · features: ${exFS === "full" ? "+ geometry" : "structure only"}</div>
      <div class="tablewrap" style="margin-top:8px"><table><thead><tr><th>Model</th><th class="n">pred</th><th class="n">error</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    try {
      const drawer = new SmilesDrawer.SvgDrawer({ width: 300, height: 190, bondThickness: 1.2 });
      SmilesDrawer.parse(m.s, (tree) => drawer.draw(tree, "mol-svg", "light", null), () => {});
    } catch (e) { $("#mol-svg").outerHTML = '<p class="muted">(structure drawing unavailable)</p>'; }
  }

  function drawAll() {
    bind(); drawHist(); drawModels(); tableModels(); drawAblation(); drawLC(); tableTests();
    drawBins(); tableGroups(); tableWorst(); drawRobust(); if (EX) drawExplorer();
  }

  Promise.all([fetch("data/summary.json").then((r) => r.json()), fetch("data/explorer.json").then((r) => r.json())])
    .then(([s, ex]) => { S = s; EX = ex; exInit(); drawAll(); })
    .catch((e) => {
      console.error(e);
      document.querySelector("main").insertAdjacentHTML("afterbegin",
        '<div class="callout warn">Could not load the result data. If you opened this file directly from disk, serve the folder instead (e.g. <code>python -m http.server</code> inside <code>docs/</code>).</div>');
    });
})();
