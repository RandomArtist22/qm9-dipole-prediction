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
  // the mobile top bar and the desktop sidebar both list the sections; highlight the current one in each
  const links = $$("#nav a.sec-link, .toc a[href^='#']");
  const obs = new IntersectionObserver((ents) => {
    ents.forEach((e) => {
      // sections without their own nav link (e.g. Reproduce) keep the previous highlight
      if (e.isIntersecting && links.some((a) => a.getAttribute("href") === "#" + e.target.id))
      {
        links.forEach((a) => a.classList.toggle("active", a.getAttribute("href") === "#" + e.target.id));
        // on narrow screens the nav scrolls sideways: keep the active link visible
        const bar = $("#nav"), act = $$("a.sec-link.active", bar)[0];
        if (act && bar.scrollWidth > bar.clientWidth) bar.scrollTo({ left: act.offsetLeft - bar.clientWidth / 2 + act.offsetWidth / 2 });
      }
    });
  }, { rootMargin: "-40% 0px -55% 0px" });
  $$("section[id]").forEach((s) => obs.observe(s));

  // ---------------- reading progress (thin line under the top bar) ----------------
  const prog = $("#progress");
  let progQueued = false;
  const setProg = () => {
    progQueued = false;
    const max = document.documentElement.scrollHeight - innerHeight;
    prog.style.transform = `scaleX(${max > 0 ? Math.min(1, scrollY / max) : 0})`;
  };
  if (prog) { addEventListener("scroll", () => { if (!progQueued) { progQueued = true; requestAnimationFrame(setProg); } }, { passive: true }); setProg(); }

  // ---------------- tabs (Method section) ----------------
  $$(".tabs button").forEach((b) => b.addEventListener("click", () => {
    const bar = b.parentElement;
    $$("button", bar).forEach((x) => { const on = x === b; x.classList.toggle("on", on); x.setAttribute("aria-selected", on); $("#" + x.dataset.tab).hidden = !on; });
  }));

  // Plotly sizes charts to their container; a chart revealed later (details/tab) needs a resize
  document.addEventListener("toggle", (e) => {
    if (e.target.matches && e.target.matches("details") && e.target.open)
      window.Plotly && $$(".js-plotly-plot", e.target).forEach((p) => Plotly.Plots.resize(p));
  }, true);

  // Axes, margin and legend are merged per key (not replaced), so a chart that sets its own
  // xaxis title still keeps automargin + shared styling and its axis title is never clipped.
  function baseLayout(extra = {}) {
    const axis = () => ({
      gridcolor: css("--grid") || css("--line"), zerolinecolor: css("--line"), linecolor: css("--line"),
      tickfont: { color: css("--muted"), size: 11.5 }, title: { font: { color: css("--muted"), size: 12.5 }, standoff: 10 },
      automargin: true, ticks: "", showline: false,
    });
    const mergeAxis = (base, over) => {
      if (!over) return base;
      const out = Object.assign({}, base, over);
      if (over.title !== undefined) out.title = Object.assign({}, base.title, typeof over.title === "string" ? { text: over.title } : over.title);
      return out;
    };
    const base = {
      paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
      font: { family: "Inter, Arial, sans-serif", size: 12, color: css("--ink") },
      margin: { l: 60, r: 16, t: 24, b: 50 },
      legend: { orientation: "h", y: -0.2, font: { color: css("--muted") } },
      hoverlabel: { bgcolor: css("--surface"), bordercolor: css("--line"), font: { color: css("--ink"), family: "Inter, Arial, sans-serif" } },
    };
    const out = Object.assign({}, base, extra);
    out.margin = Object.assign({}, base.margin, extra.margin);
    out.legend = Object.assign({}, base.legend, extra.legend);
    out.xaxis = mergeAxis(axis(), extra.xaxis);
    out.yaxis = mergeAxis(axis(), extra.yaxis);
    return out;
  }
  const CFG = { displaylogo: false, responsive: true, modeBarButtonsToRemove: ["lasso2d", "select2d"] };
  // A fixed layout.height does not size the (overflow:hidden) .plot box, so legends and axis titles
  // below the min-height were clipped. Grow the box to fit whatever height the chart asked for.
  function plotReact(gd, data, layout, config) {
    const el = typeof gd === "string" ? document.getElementById(gd) : gd;
    if (el && layout && layout.height) el.style.minHeight = Math.max(layout.height + 2, parseFloat(el.style.minHeight) || 0) + "px";
    if (window.Plotly) return Plotly.react(gd, data, layout, config);
  }
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
    plotReact("plot-hist", [{ type: "bar", x, y: h, marker: { color: css("--accent") }, hovertemplate: "μ ≈ %{x:.2f} D<br>%{y} molecules<extra></extra>" }],
      baseLayout({ xaxis: { title: "dipole moment μ (Debye)" }, yaxis: { title: "molecules", type: "log" }, bargap: 0, height: 300 }), CFG);
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
    const t = { mae: "test MAE (D), lower is better", rmse: "test RMSE (D), lower is better", r2: "test R², higher is better" }[metric];
    plotReact("plot-models", tr, baseLayout({ barmode: "group", height: 420, showlegend: false, margin: { l: 10, r: 16, t: 10, b: 50 },
      xaxis: { title: t }, yaxis: { categoryorder: "array", categoryarray: lab, automargin: true } }), CFG);
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
      const short = { composition: "atom<br>counts", "2d": "2D<br>graph", "2d_geo": "2D +<br>shape", "2d_phys": "2D + dipole<br>estimates", full: "all<br>features" };
      return { type: "bar", name: ML()[m], x: order.map((fs) => short[fs]), customdata: order.map((fs) => S.featureset_labels[fs]), y: pts.map((p) => (p ? p.test_mae : null)),
        marker: { color: i ? css("--cfull") : css("--c2d") }, hovertemplate: "%{customdata}<br>MAE %{y:.3f}<extra>" + ML()[m] + "</extra>" };
    });
    plotReact("plot-ablation", tr, baseLayout({ barmode: "group", height: 340, margin: { l: 55, r: 10, t: 10, b: 60 },
      yaxis: { title: "test MAE (D)" }, xaxis: { tickangle: 0, automargin: true }, legend: { orientation: "h", y: 1.12 } }), CFG);
    const gi = S.group_importance.slice().sort((a, b) => a.delta_mae_mean - b.delta_mae_mean);
    plotReact("plot-importance", [{ type: "bar", orientation: "h", y: gi.map((g) => g.label), x: gi.map((g) => g.delta_mae_mean),
      error_x: { type: "data", array: gi.map((g) => g.delta_mae_std), color: css("--muted") }, marker: { color: css("--cfull") },
      hovertemplate: "%{y}<br>MAE rises by %{x:.3f} D<extra></extra>" }],
      baseLayout({ height: 340, margin: { l: 10, r: 10, t: 10, b: 50 }, yaxis: { automargin: true }, xaxis: { title: "Δ MAE (D)" } }), CFG);
  }

  function drawLC() {
    const tr = [];
    [["2d", css("--c2d")], ["full", css("--cfull")]].forEach(([fs, c]) => {
      const d = S.learning_curve.filter((r) => r.featureset === fs);
      tr.push({ x: d.map((r) => r.n_train), y: d.map((r) => r.test_mae), mode: "lines+markers", name: S.featureset_labels[fs] + " · test", line: { color: c } });
      tr.push({ x: d.map((r) => r.n_train), y: d.map((r) => r.train_mae), mode: "lines+markers", name: "train", line: { color: c, dash: "dot" }, opacity: 0.6 });
    });
    plotReact("plot-lc", tr, baseLayout({ height: 330, xaxis: { type: "log", title: "training molecules" }, yaxis: { title: "MAE (D)" } }), CFG);
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
    plotReact("plot-bins", [
      { type: "bar", name: "mean baseline", x, y: b.map((r) => r.mae_mean_baseline), marker: { color: css("--cbase") } },
      { type: "bar", name: "GB structure only", x, y: b.map((r) => r.mae_2d), marker: { color: css("--c2d") } },
      { type: "bar", name: "GB + geometry", x, y: b.map((r) => r.mae), marker: { color: css("--cfull") } },
      { type: "scatter", mode: "lines+markers", name: "mean residual (pred − true), GB + geometry", x, y: b.map((r) => r.mean_resid), yaxis: "y2", line: { color: css("--bad") } },
    ], baseLayout({ barmode: "group", height: 360, yaxis: { title: "test MAE (D)" },
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
    const rr = S.robustness;
    const cols = [["random_all", "random (all)"], ["random_ring_only", "random (ring-only)"], ["scaffold", "scaffold split"],
      ["size_control", "size control<br>(random, same n)"], ["size_le8", "train ≤ 8<br>→ test 9"]];
    const sel = rr.filter((r) => ["hgb", "rf", "ridge", "linreg_comp", "mean"].includes(r.model));
    const tr = sel.map((r) => ({ type: "bar", name: `${r.model_label}${r.featureset === "composition" ? "" : r.featureset === "full" ? " · +geom" : " · 2D"}`,
      x: cols.map((c) => c[1]), y: cols.map((c) => r[c[0]]),
      marker: { color: (r.model === "ridge" && r.featureset === "full") ? css("--bad") : r.featureset === "composition" ? css("--cbase") : r.featureset === "full" ? css("--cfull") : css("--c2d"),
        opacity: (r.model === "hgb" || (r.model === "ridge" && r.featureset === "full")) ? 1 : r.model === "rf" ? 0.75 : 0.5 },
      // keep the default view readable: the four series that carry the story; the rest are one legend click away
      visible: (r.model === "mean" || (r.model === "ridge" && r.featureset === "full") || r.model === "hgb") ? true : "legendonly",
      hovertemplate: "%{x}<br>MAE %{y:.3f}<extra>%{fullData.name}</extra>" }));
    plotReact("plot-robust", tr, baseLayout({ barmode: "group", height: 420, yaxis: { title: "test MAE (D)" },
      xaxis: { automargin: true }, margin: { l: 60, r: 10, t: 10, b: 40 }, legend: { orientation: "h", y: -0.18, title: { text: "click to show/hide: " } } }), CFG);
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
    ["#ex-model", "#ex-heavy", "#ex-ring", "#ex-lo", "#ex-hi"].forEach((id) => $(id).addEventListener("input", () => { cancelCloud(); drawExplorer(); }));
    $("#ex-play").addEventListener("click", animateCloud);
    $$("#ex-fs button").forEach((b) => b.addEventListener("click", () => {
      cancelCloud();
      $$("#ex-fs button").forEach((x) => x.classList.toggle("on", x === b)); exFS = b.dataset.f; drawExplorer(); if (selected) showMol(selected);
    }));
  }
  let cloudRAF = null;
  function cancelCloud() { if (cloudRAF !== null) { cancelAnimationFrame(cloudRAF); cloudRAF = null; } }
  function setFS(v) { exFS = v; $$("#ex-fs button").forEach((x) => x.classList.toggle("on", x.dataset.f === v)); }
  function animateCloud() {
    const model = $("#ex-model").value;
    if (model === "mean" || model === "linreg_comp") return;
    cancelCloud();
    if (!window.Plotly) return;
    setFS("2d"); drawExplorer(); if (selected) showMol(selected);
    const finish = () => { cloudRAF = null; setFS("full"); drawExplorer(); if (selected) showMol(selected); };
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { finish(); return; }
    const mols = exFiltered(), n = mols.length;
    if (!n) { finish(); return; }
    const a = mols.map((m) => m.p["2d__" + model]), b = mols.map((m) => m.p["full__" + model]);
    const T = 1500, t0 = performance.now();
    const maeEl = () => { const s = $("#ex-stats").children[1]; return s && s.querySelector("b"); };
    const step = (now) => {
      const u = Math.min(1, (now - t0) / T), e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
      const ys = a.map((v, i) => v + (b[i] - v) * e);
      const err = ys.map((v, i) => Math.abs(v - mols[i].y));
      Plotly.restyle("plot-explorer", { y: [ys], "marker.color": [err] }, [0]);
      const el = maeEl(); if (el) el.textContent = f(err.reduce((s, v) => s + v, 0) / n);
      if (u < 1) cloudRAF = requestAnimationFrame(step); else finish();
    };
    cloudRAF = requestAnimationFrame(step);
  }
  function exFiltered() {
    const hv = $("#ex-heavy").value, rg = $("#ex-ring").value;
    const lo = parseFloat($("#ex-lo").value) || 0, hi = parseFloat($("#ex-hi").value); const hiv = Number.isFinite(hi) ? hi : 99;
    return EX.molecules.filter((m) => (hv === "all" || (hv === "le7" ? m.h <= 7 : m.h === +hv)) &&
      (rg === "all" || m.ring === +rg) && m.y >= lo && m.y <= hiv);
  }
  function drawExplorer() {
    const model = $("#ex-model").value, key = exKey(model), mols = exFiltered();
    const pb = $("#ex-play"), noGeo = model === "mean" || model === "linreg_comp";
    pb.disabled = noGeo || !window.Plotly; pb.title = !window.Plotly ? "Charts failed to load" : noGeo ? "This model uses composition only, so geometry changes nothing." : "";
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
    plotReact("plot-explorer", tr, baseLayout({ height: 440, showlegend: false, margin: { l: 55, r: 10, t: 10, b: 50 },
      xaxis: { title: "true μ (D)", range: [0, mx * 1.03] }, yaxis: { title: `predicted μ (D) · ${ML()[model]}`, range: [0, mx * 1.03] } }), CFG);
    const el = $("#plot-explorer");
    if (window.Plotly && !el._bound) {
      el.on("plotly_click", (ev) => { const p = ev.points[0]; if (p && p.customdata) { cancelCloud(); selected = p.customdata; $$("#demo-chips button").forEach((x) => x.classList.toggle("on", x.dataset.id === selected)); const chip = $$("#demo-chips button").find((x) => x.dataset.id === selected); showMol(selected, chip ? chip.dataset.story : null); drawExplorer(); } });
      el._bound = true;
    }
  }
  // ---------------- 3D molecule rendering (3Dmol.js) ----------------
  let STRUCT = null, labViewer = null, heroViewer = null, labMode = "3d", currentStory = null;
  const ELEM = { H: "#e9edf5", C: "#5b6477", N: "#3a6df0", O: "#e8453c", F: "#35c27d" };
  function renderMol(viewer, id, opts = {}) {
    const s = STRUCT && STRUCT[id];
    if (!viewer || !s) return false;
    viewer.removeAllModels(); viewer.removeAllShapes();
    viewer.addModel(s.x, "xyz");
    viewer.setStyle({}, { stick: { radius: 0.13, colorscheme: { prop: "elem", map: ELEM } },
      sphere: { scale: 0.27, colorscheme: { prop: "elem", map: ELEM } } });
    const d = s.d, mag = Math.hypot(d[0], d[1], d[2]);
    if (mag > 0.02) {
      const L = Math.min(0.55 * mag, 7.5) / mag;  // arrow length proportional to the estimate (0.55 Å per D, capped)
      viewer.addArrow({ start: { x: -d[0] * L / 2, y: -d[1] * L / 2, z: -d[2] * L / 2 },
        end: { x: d[0] * L / 2, y: d[1] * L / 2, z: d[2] * L / 2 }, radius: 0.2, radiusRatio: 2.0, mid: 0.75,
        color: opts.arrow || css("--arrow") });
    }
    viewer.zoomTo(); viewer.zoom(opts.zoom || 1.25); viewer.render();
    return mag;
  }
  function makeViewer(el) {
    if (typeof $3Dmol === "undefined") return null;
    try {
      const v = $3Dmol.createViewer(el, { backgroundAlpha: 0, antialias: true });
      v.setBackgroundColor(0xffffff, 0);
      return v;
    } catch (e) { console.warn("3D viewer unavailable", e); return null; }
  }
  const HERO_ID = "gdb_130921";
  function initHero() {
    heroViewer = makeViewer($("#hero-viewer"));
    if (!heroViewer) { $("#hero-viewer").innerHTML = '<p class="muted" style="padding:20px">3D view needs WebGL.</p>'; return; }
    const id = HERO_ID;
    renderMol(heroViewer, id, { zoom: 1.55 });
    heroViewer.spin("y", 0.6);
    const m = EX.molecules.find((q) => q.id === id);
    if (m) $("#hero-cap").innerHTML = `True dipole <b>${f(m.y, 2)} D</b> · predicted <b>${f(m.p["full__hgb"], 2)} D</b> with geometry,
      ${f(m.p["2d__hgb"], 2)} D without. Arrow = dipole estimated from charges × positions.`;
  }

  // ---------------- 2D structure (SmilesDrawer) ----------------
  // Note: #mol-svg is an SVG element, which has no `hidden` property, so visibility is toggled on
  // its HTML wrapper #lab-2d. We draw only while the wrapper is visible so the drawer can measure text.
  let drawn2d = null;
  function isDark() {
    const t = document.documentElement.getAttribute("data-theme");
    return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  }
  function draw2D(id) {
    const m = EX && EX.molecules.find((q) => q.id === id);
    const key = id + (isDark() ? ":d" : ":l");
    if (!m || drawn2d === key) return;
    const svg = $("#mol-svg");
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (typeof SmilesDrawer === "undefined") { $("#lab-2d").innerHTML = '<p class="muted">2D drawing library failed to load.</p>'; return; }
    try {
      const drawer = new SmilesDrawer.SvgDrawer({ width: 320, height: 300, bondThickness: 1.1, padding: 18, compactDrawing: false });
      SmilesDrawer.parse(m.s, (tree) => {
        drawer.draw(tree, svg, isDark() ? "dark" : "light", null);
        svg.removeAttribute("width"); svg.removeAttribute("height"); svg.removeAttribute("style");
        svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
        drawn2d = key;
      }, (err) => console.warn("SMILES parse failed", m.s, err));
    } catch (e) { console.warn("2D drawing failed", e); }
  }

  // ---------------- feature-by-feature stepper ----------------
  const STEPS = [["Atom counts", "composition__hgb"], ["+ 2D graph", "2d__hgb"], ["+ 3D shape", "2d_geo__hgb"], ["+ dipole estimates", "full__hgb"]];
  let stepIdx = 3, stepMol = null, stepFS = null, stepTimer = null, stepM = null;
  function stopStepper() { if (stepTimer) { clearInterval(stepTimer); stepTimer = null; } }
  function renderStepper(m) {
    const host = $("#lab-stepper"); if (!host) return;
    stepM = m;
    const vals = STEPS.map(([, k]) => m.p[k]);
    const lo = Math.min(0, ...vals), hi = Math.max(Math.max(...vals, m.y) * 1.1, lo + 2), span = hi - lo || 1;
    const pos = (v) => Math.min(100, Math.max(0, (v - lo) / span * 100));
    if (host.dataset.id !== m.id || !host.firstChild) {
      host.dataset.id = m.id;
      host.innerHTML = `
        <div class="st-steps">${STEPS.map((s, i) => `<button type="button" data-i="${i}">${s[0]}</button>`).join("")}<button type="button" class="st-play" aria-label="Play steps">&#9654;</button></div>
        <div class="st-line"><div class="st-axis"></div>
          <span class="st-end" style="left:0">${lo > -0.05 ? "0" : f(lo, 1)} D</span><span class="st-end r" style="left:100%">${f(hi, 1)} D</span>
          <span class="st-tick" style="left:${pos(m.y)}%"><span class="st-lab">true ${f(m.y, 2)}</span></span>
          ${vals.map((v, i) => `<span class="st-dot" data-i="${i}" style="left:${pos(v)}%"></span>`).join("")}
          <span class="st-mark"><span class="st-pill"></span></span></div>
        <div class="st-err"></div>
        <div class="st-cap muted">Always gradient boosting, whatever the model selector says.</div>`;
      $$(".st-steps button[data-i]", host).forEach((b) => b.addEventListener("click", () => { stopStepper(); stepIdx = +b.dataset.i; renderStepper(stepM); }));
      $(".st-play", host).addEventListener("click", playStepper);
    }
    const pred = vals[stepIdx], err = Math.abs(pred - m.y);
    $$(".st-steps button[data-i]", host).forEach((b) => { const on = +b.dataset.i === stepIdx; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); });
    $$(".st-dot", host).forEach((d) => d.classList.toggle("vis", +d.dataset.i < stepIdx));
    const mk = $(".st-mark", host); mk.style.left = pos(pred) + "%"; $(".st-pill", host).textContent = f(pred, 2);
    const e = $(".st-err", host);
    e.classList.remove("is-good", "is-warn", "is-bad");
    e.classList.add(err < 0.5 ? "is-good" : err > 1.5 ? "is-bad" : "is-warn");
    e.textContent = `error: |${f(pred, 2)} − ${f(m.y, 2)}| = ${f(err, 2)} D`;
  }
  function playStepper() {
    stopStepper();
    if (!stepM) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { stepIdx = 3; renderStepper(stepM); return; }
    stepIdx = 0; renderStepper(stepM);
    stepTimer = setInterval(() => {
      if (stepIdx >= 3) { stopStepper(); return; }
      stepIdx++; renderStepper(stepM);
    }, 900);
  }

  function showMol(id, story) {
    const m = EX.molecules.find((q) => q.id === id); if (!m) return;
    const wasOpen = stepMol === id && $("#lab-body details.more")?.open; // new molecule -> collapsed
    if (stepMol !== id || stepFS !== exFS) { stopStepper(); stepIdx = exFS === "2d" ? 1 : 3; stepMol = id; stepFS = exFS; }
    if (story !== undefined) currentStory = story;
    $("#lab-title").innerHTML = `${m.id} <span class="pill">${m.h} heavy atoms</span> <span class="pill">${m.ring ? "ring" : "acyclic"}</span>`;
    if (!labViewer) labViewer = makeViewer($("#lab-3d"));
    let est = null;
    const st = STRUCT && STRUCT[id];
    if (st) est = Math.hypot(st.d[0], st.d[1], st.d[2]);
    setLabMode(labMode);
    const storyEl = $("#lab-story");
    if (currentStory) { storyEl.textContent = currentStory; storyEl.hidden = false; } else storyEl.hidden = true;

    const pred = m.p[exKey("hgb")];
    const models = ["mean", "linreg_comp", "ridge", "lasso", "knn", "tree", "svr", "mlp", "rf", "hgb"].filter((x) => m.p[exKey(x)] !== undefined);
    const vmax = Math.max(m.y, ...models.map((x) => m.p[exKey(x)]), 1) * 1.08;
    const bars = models.map((x) => {
      const p = m.p[exKey(x)], e = p - m.y, w = Math.max(0, p) / vmax * 100;
      const col = Math.abs(e) < 0.5 ? css("--good") : Math.abs(e) > 1.5 ? css("--bad") : css("--c2d");
      return `<div class="predbar"><span>${ML()[x]}</span><span class="track"><span class="fill" style="width:${w}%;background:${col}"></span>
        <span class="truth" style="left:${m.y / vmax * 100}%"></span></span><span class="num${p < 0 ? " neg" : ""}" ${p < 0 ? 'title="negative: impossible for a magnitude"' : ""}>${f(p, 2)}</span></div>`;
    }).join("");
    $("#lab-body").innerHTML = `
      <div class="vals">
        <div><div class="k">DFT μ (true)</div><div class="v">${f(m.y, 2)}</div></div>
        <div><div class="k">GB prediction</div><div class="v ${Math.abs(pred - m.y) < 0.5 ? "is-good" : "is-bad"}">${f(pred, 2)}</div></div>
        <div><div class="k">charge×position est.</div><div class="v">${typeof est === "number" ? f(est, 2) : "–"}</div></div>
      </div>
      <div id="lab-stepper" class="stepper"></div>
      <div style="margin:2px 0 6px"><code>${m.s}</code></div>
      <details class="more"${wasOpen ? " open" : ""}><summary>Compare all models</summary><div class="more-body">
        <div class="muted" style="font-size:12.5px;margin-bottom:4px">All models (${exFS === "full" ? "+ geometry" : "structure only"}), in Debye. Black tick = true value.</div>
        <div class="predbars">${bars}</div></div></details>`;
    renderStepper(m);
  }
  let rendered3d = null;
  function setLabMode(mode) {
    labMode = mode;
    $$("#lab-view button").forEach((b) => b.classList.toggle("on", b.dataset.v === mode));
    $("#lab-3d").hidden = mode !== "3d";
    $("#lab-2d").hidden = mode !== "2d";
    $("#lab-legend").hidden = mode !== "3d";
    if (!selected) return;
    if (mode === "3d" && labViewer) {
      labViewer.resize();   // canvas was 0×0 while hidden
      if (rendered3d !== selected) { renderMol(labViewer, selected); rendered3d = selected; } else labViewer.render();
    }
    if (mode === "2d") draw2D(selected);
  }
  $$("#lab-view button").forEach((b) => b.addEventListener("click", () => setLabMode(b.dataset.v)));
  $$("#demo-chips button").forEach((b) => b.addEventListener("click", () => {
    $$("#demo-chips button").forEach((x) => x.classList.toggle("on", x === b));
    selected = b.dataset.id; showMol(selected, b.dataset.story); drawExplorer();
  }));

  // ---------------- count-up + reveal ----------------
  function countUp() {
    $$(".card .big").forEach((el) => {
      const txt = el.textContent, mm = txt.match(/^([+−-]?)([0-9.]+)(.*)$/);
      if (!mm) return;
      const target = parseFloat(mm[2]), dec = (mm[2].split(".")[1] || "").length, t0 = performance.now(), dur = 1100;
      const step = (t) => {
        const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
        el.textContent = mm[1] + (target * e).toFixed(dec) + mm[3];
        if (k < 1) requestAnimationFrame(step); else el.textContent = txt;
      };
      requestAnimationFrame(step);
    });
  }
  function reveal() {
    if (!("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver((ents) => ents.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { rootMargin: "0px 0px -8% 0px" });
    $$("main section > *").forEach((el) => { el.classList.add("reveal"); io.observe(el); });
  }

  function drawAll() {
    bind(); drawHist(); drawModels(); tableModels(); drawAblation(); drawLC(); tableTests();
    drawBins(); tableGroups(); tableWorst(); drawRobust(); if (EX) drawExplorer();
    if (selected && STRUCT) showMol(selected);
    if (heroViewer && STRUCT) renderMol(heroViewer, HERO_ID, { zoom: 1.55 });
  }

  reveal();
  Promise.all([fetch("data/summary.json").then((r) => r.json()), fetch("data/explorer.json").then((r) => r.json())])
    .then(([s, ex]) => {
      S = s; EX = ex; exInit(); drawAll(); countUp();
      return fetch("data/structures.json").then((r) => r.json()).then((st) => {
        STRUCT = st; initHero();
        const first = $("#demo-chips button[data-id='gdb_130921']");
        if (first && !selected) { first.classList.add("on"); selected = first.dataset.id; showMol(selected, first.dataset.story); drawExplorer(); }
      });
    })
    .catch((e) => {
      console.error(e);
      document.querySelector("main").insertAdjacentHTML("afterbegin",
        '<div class="callout warn">Could not load the result data. If you opened this file directly from disk, serve the folder instead (e.g. <code>python -m http.server</code> inside <code>docs/</code>).</div>');
    });
})();
