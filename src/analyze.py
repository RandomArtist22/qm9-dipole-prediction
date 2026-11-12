"""Step 5: collect all runs, quantify uncertainty, analyse errors, make figures
and export the JSON that the website reads.

Outputs
  results/metrics.csv                 every (split, feature set, model) test score
  results/predictions/<split>.parquet test predictions of every run, per split
  results/summary.json                tables used by the site and README
  results/figures/*.png               static figures (README / notebook)
  docs/data/summary.json              copy for the website
  docs/data/explorer.json             sampled test molecules for the interactive explorer
"""
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

from config import FEATURES_PATH, FIGURES, RESULTS, SITE_DATA, SPLITS, TARGET  # noqa: E402
from models import FEATURESET_LABELS, MODEL_LABELS  # noqa: E402

RUNS = RESULTS / "runs"
PRED_DIR = RESULTS / "predictions"
PRED_DIR.mkdir(exist_ok=True)
MAIN = "random_s0"
BEST = ("full", "hgb")
N_BOOT = 2000


def mae(a, b):
    return float(np.mean(np.abs(a - b)))


def boot_ci(y, p, n=N_BOOT, seed=0):
    rng = np.random.default_rng(seed)
    err = np.abs(y - p)
    idx = rng.integers(0, len(y), size=(n, len(y)))
    stats = err[idx].mean(1)
    return float(np.percentile(stats, 2.5)), float(np.percentile(stats, 97.5))


def paired_boot(y, pa, pb, n=N_BOOT, seed=0):
    """Bootstrap the difference MAE(a) - MAE(b) over test molecules (paired)."""
    rng = np.random.default_rng(seed)
    d = np.abs(y - pa) - np.abs(y - pb)
    idx = rng.integers(0, len(y), size=(n, len(y)))
    stats = d[idx].mean(1)
    lo, hi = np.percentile(stats, [2.5, 97.5])
    # two-sided bootstrap p-value for "difference = 0"
    p = 2 * min((stats <= 0).mean(), (stats >= 0).mean())
    return {"diff": float(d.mean()), "ci_lo": float(lo), "ci_hi": float(hi), "p_boot": float(max(p, 1 / n))}


# ----------------------------------------------------------------------------
def collect(df, splits):
    recs, preds = [], {}
    for f in sorted(RUNS.glob("*.json")):
        r = json.loads(f.read_text())
        recs.append({k: v for k, v in r.items() if k != "cv_table"})
        split = r["split"]
        te = np.flatnonzero(splits[split].to_numpy() == "test")
        if split not in preds:
            preds[split] = pd.DataFrame({"mol_id": df["mol_id"].to_numpy()[te],
                                         "y_true": df[TARGET].to_numpy()[te]})
        preds[split][f"{r['featureset']}__{r['model']}"] = np.load(f.with_suffix(".npy"))
    m = pd.DataFrame(recs)
    m["best_params"] = m["best_params"].apply(json.dumps)
    m.sort_values(["split", "featureset", "test_mae"]).to_csv(RESULTS / "metrics.csv", index=False)
    for s, p in preds.items():
        p.to_parquet(PRED_DIR / f"{s}.parquet", index=False)
    return m, preds


def model_table(m, preds):
    """Main comparison: random splits, mean +- sd over seeds, bootstrap CI on seed 0."""
    rnd = m[m["split"].str.startswith("random_s")]
    rows = []
    p0 = preds[MAIN]
    y = p0["y_true"].to_numpy()
    for (fs, model), g in rnd.groupby(["featureset", "model"]):
        if fs not in ("2d", "full", "composition") or (fs == "composition" and model not in ("mean", "linreg_comp")):
            continue
        col = f"{fs}__{model}"
        lo, hi = boot_ci(y, p0[col].to_numpy()) if col in p0 else (None, None)
        rows.append({
            "model": model, "model_label": MODEL_LABELS[model], "featureset": fs,
            "featureset_label": FEATURESET_LABELS[fs],
            "mae_s0": float(g.loc[g.split == MAIN, "test_mae"].iloc[0]),
            "mae_ci_lo": lo, "mae_ci_hi": hi,
            "rmse_s0": float(g.loc[g.split == MAIN, "test_rmse"].iloc[0]),
            "r2_s0": float(g.loc[g.split == MAIN, "test_r2"].iloc[0]),
            "n_seeds": int(len(g)),
            "mae_mean": float(g["test_mae"].mean()), "mae_std": float(g["test_mae"].std(ddof=1)) if len(g) > 1 else None,
            "r2_mean": float(g["test_r2"].mean()),
            "cv_mae_s0": (float(g.loc[g.split == MAIN, "cv_mae_tuning"].iloc[0])
                          if pd.notna(g.loc[g.split == MAIN, "cv_mae_tuning"].iloc[0]) else None),
            "best_params_s0": json.loads(g.loc[g.split == MAIN, "best_params"].iloc[0]),
            "n_train_fit": int(g.loc[g.split == MAIN, "n_train_fit"].iloc[0]),
        })
    t = pd.DataFrame(rows).sort_values("mae_s0").reset_index(drop=True)
    base = t.loc[t.model == "mean", "mae_s0"].iloc[0]
    ols = t.loc[t.model == "linreg_comp", "mae_s0"].iloc[0]
    t["improve_vs_mean_pct"] = 100 * (1 - t["mae_s0"] / base)
    t["improve_vs_ols_pct"] = 100 * (1 - t["mae_s0"] / ols)
    return t


def paired_tests(preds):
    p = preds[MAIN]
    y = p["y_true"].to_numpy()
    tests = {}
    pairs = [
        ("full__hgb", "2d__hgb", "Gradient boosting: full vs structure-only features"),
        ("full__hgb", "full__rf", "Full features: gradient boosting vs random forest"),
        ("full__hgb", "composition__linreg_comp", "Best model vs linear regression on atom counts"),
        ("full__ridge", "2d__ridge", "Ridge: full vs structure-only features"),
    ]
    if "full__svr" in p:
        pairs.append(("full__hgb", "full__svr", "Full features: gradient boosting vs SVR"))
    if "full__mlp" in p:
        pairs.append(("full__hgb", "full__mlp", "Full features: gradient boosting vs MLP"))
    for a, b, label in pairs:
        if a in p and b in p:
            tests[f"{a}_vs_{b}"] = {"label": label, **paired_boot(y, p[a].to_numpy(), p[b].to_numpy())}
    return tests


def robustness(m, preds, meta):
    out = []
    get = lambda s, fs, mo: m[(m.split == s) & (m.featureset == fs) & (m.model == mo)]  # noqa: E731
    # random split restricted to ring-containing test molecules = control for scaffold split
    p0 = preds[MAIN].merge(meta[["mol_id", "scaffold"]], on="mol_id")
    ring = p0["scaffold"] != ""
    for fs in ["2d", "full"]:
        for mo in ["mean", "linreg_comp", "ridge", "tree", "rf", "hgb"]:
            fs_eff = "composition" if mo in ("mean", "linreg_comp") else fs
            if mo in ("mean", "linreg_comp") and fs == "full":
                continue
            row = {"featureset": fs_eff, "model": mo, "model_label": MODEL_LABELS[mo]}
            col = f"{fs_eff}__{mo}"
            if col in p0:
                row["random_all"] = mae(p0["y_true"], p0[col])
                row["random_ring_only"] = mae(p0.loc[ring, "y_true"], p0.loc[ring, col])
            for s in ["scaffold", "size_le8", "size_control"]:
                g = get(s, fs_eff, mo)
                row[s] = float(g["test_mae"].iloc[0]) if len(g) else None
            out.append(row)
    return out


def error_analysis(preds, meta):
    p = preds[MAIN].merge(meta, on="mol_id")
    col = f"{BEST[0]}__{BEST[1]}"
    p["pred"] = p[col]
    p["abs_err"] = (p["y_true"] - p["pred"]).abs()
    p["resid"] = p["pred"] - p["y_true"]
    bins = [0, 0.5, 1, 2, 3, 4, 5, 7, 100]
    labels = ["0-0.5", "0.5-1", "1-2", "2-3", "3-4", "4-5", "5-7", ">7"]
    p["mu_bin"] = pd.cut(p["y_true"], bins=bins, labels=labels, right=False)
    by_bin = p.groupby("mu_bin", observed=True).agg(
        n=("abs_err", "size"), mae=("abs_err", "mean"), mean_resid=("resid", "mean")).reset_index()
    by_bin["mae_2d"] = p.groupby("mu_bin", observed=True).apply(
        lambda g: mae(g["y_true"], g["2d__hgb"]), include_groups=False).to_numpy()
    by_bin["mae_mean_baseline"] = p.groupby("mu_bin", observed=True).apply(
        lambda g: mae(g["y_true"], g["composition__mean"]), include_groups=False).to_numpy()

    by_heavy = p.groupby("comp_nheavy").agg(n=("abs_err", "size"), mae=("abs_err", "mean")).reset_index()

    groups = {
        "Acyclic (no ring)": p["scaffold"] == "",
        "Aromatic ring": p["d2_NumAromaticRings"] > 0,
        "Nitrile (C#N)": p["d2_fr_nitrile"] > 0,
        "Carbonyl (C=O)": p["d2_fr_C_O"] > 0,
        "Hydroxyl (OH)": (p["d2_fr_Al_OH"] + p["d2_fr_Ar_OH"]) > 0,
        "Ether (C-O-C)": p["d2_fr_ether"] > 0,
        "Primary amine (NH2)": p["d2_fr_NH2"] > 0,
        "Fluorine": p["comp_nF"] > 0,
        "Charged / zwitterion": p["smiles"].str.contains(r"\+") & p["smiles"].str.contains("-]"),
        "Near-zero dipole (<0.5 D)": p["y_true"] < 0.5,
        "Shares 2D graph w/ another molecule": p["dup2d"],
    }
    by_group = []
    for name, mask in groups.items():
        if mask.sum() == 0:
            continue
        by_group.append({"group": name, "n": int(mask.sum()), "mae": float(p.loc[mask, "abs_err"].mean()),
                         "mae_2d": mae(p.loc[mask, "y_true"], p.loc[mask, "2d__hgb"]),
                         "mean_true": float(p.loc[mask, "y_true"].mean()),
                         "mean_resid": float(p.loc[mask, "resid"].mean())})
    worst = p.nlargest(15, "abs_err")[["mol_id", "smiles", "y_true", "pred", "2d__hgb", "abs_err", "comp_nheavy"]]
    near0 = p[p["y_true"] < 0.1]
    corr = float(np.corrcoef(p["y_true"], p["resid"])[0, 1])
    return {
        "by_mu_bin": by_bin.to_dict("records"), "by_heavy": by_heavy.to_dict("records"),
        "by_group": by_group, "worst": worst.round(3).to_dict("records"),
        "near_zero": {"n": int(len(near0)), "mae": float(near0["abs_err"].mean()),
                      "mean_pred": float(near0["pred"].mean())},
        "resid_true_corr": corr,
        "frac_within_0_5D": float((p["abs_err"] < 0.5).mean()),
        "frac_within_1D": float((p["abs_err"] < 1.0).mean()),
        "median_abs_err": float(p["abs_err"].median()),
    }, p


def explorer(p, n=4000, seed=0):
    """Sample of test molecules with every model's prediction for the site."""
    rng = np.random.default_rng(seed)
    idx = rng.choice(len(p), size=min(n, len(p)), replace=False)
    # make sure the 15 worst molecules are always present
    worst = p.nlargest(15, "abs_err").index.to_numpy()
    take = p.loc[np.unique(np.concatenate([p.index.to_numpy()[idx], worst]))]
    pred_cols = [c for c in p.columns if "__" in c]
    rows = []
    for _, r in take.iterrows():
        rows.append({"id": r["mol_id"], "s": r["smiles"], "y": round(float(r["y_true"]), 3),
                     "h": int(r["comp_nheavy"]), "ring": int(r["scaffold"] != ""),
                     "p": {c: round(float(r[c]), 3) for c in pred_cols}})
    return {"columns": pred_cols, "molecules": rows}


# ----------------------------------------------------------------------------
def figures(t, tests, rob, err, p, meta, lc, gi):
    plt.rcParams.update({"figure.dpi": 130, "font.size": 9, "axes.spines.top": False, "axes.spines.right": False})
    # target distribution
    fig, ax = plt.subplots(1, 2, figsize=(9, 3))
    ax[0].hist(meta[TARGET], bins=120, color="#4269d0")
    ax[0].set(xlabel="dipole moment μ (Debye)", ylabel="molecules", title="Target distribution (all 131,970)")
    ax[1].hist(meta[TARGET], bins=120, color="#4269d0", log=True)
    ax[1].set(xlabel="μ (Debye)", title="Same, log count: long zwitterion tail")
    fig.tight_layout(); fig.savefig(FIGURES / "target_distribution.png"); plt.close(fig)

    # model comparison
    tt = t[t.featureset.isin(["2d", "full"]) | t.model.isin(["mean", "linreg_comp"])].copy()
    order = (tt[tt.featureset != "2d"].sort_values("mae_s0", ascending=False)["model"].tolist())
    fig, ax = plt.subplots(figsize=(7, 4))
    for k, (fs, colr) in enumerate([("2d", "#efb118"), ("full", "#4269d0")]):
        for i, mo in enumerate(order):
            r = tt[(tt.model == mo) & ((tt.featureset == fs) | tt.model.isin(["mean", "linreg_comp"]))]
            if r.empty or (mo in ("mean", "linreg_comp") and k == 1):
                continue
            r = r.iloc[0]
            ax.barh(i + (0.2 if k == 0 else -0.2), r.mae_s0, height=0.38, color=colr if mo not in ("mean", "linreg_comp") else "#999",
                    xerr=[[r.mae_s0 - r.mae_ci_lo], [r.mae_ci_hi - r.mae_s0]], capsize=2)
    ax.set_yticks(range(len(order)), [MODEL_LABELS[o] for o in order])
    ax.set_xlabel("test MAE (Debye), random split seed 0, 95% bootstrap CI")
    ax.legend(handles=[plt.Rectangle((0, 0), 1, 1, color=c) for c in ["#999", "#efb118", "#4269d0"]],
              labels=["baseline", "structure only (2D)", "structure + geometry"], frameon=False, loc="lower right")
    fig.tight_layout(); fig.savefig(FIGURES / "model_comparison.png"); plt.close(fig)

    # predicted vs true
    fig, ax = plt.subplots(1, 2, figsize=(9, 4), sharey=True)
    for a, col, title in [(ax[0], "2d__hgb", "Gradient boosting, structure only"),
                          (ax[1], "full__hgb", "Gradient boosting, + geometry")]:
        a.hexbin(p["y_true"], p[col], gridsize=80, bins="log", cmap="Blues", extent=(0, 12, 0, 12))
        a.plot([0, 12], [0, 12], "k--", lw=0.8)
        a.set(xlim=(0, 12), ylim=(0, 12), xlabel="true μ (D)", title=f"{title}\nMAE {mae(p.y_true, p[col]):.3f} D")
    ax[0].set_ylabel("predicted μ (D)")
    fig.tight_layout(); fig.savefig(FIGURES / "pred_vs_true.png"); plt.close(fig)

    # error by mu bin
    b = pd.DataFrame(err["by_mu_bin"])
    fig, ax = plt.subplots(figsize=(7, 3.2))
    x = np.arange(len(b))
    ax.bar(x - 0.27, b["mae_mean_baseline"], 0.27, label="mean baseline", color="#999")
    ax.bar(x, b["mae_2d"], 0.27, label="GB structure only", color="#efb118")
    ax.bar(x + 0.27, b["mae"], 0.27, label="GB + geometry", color="#4269d0")
    ax.set_xticks(x, [f"{l}\n(n={n})" for l, n in zip(b["mu_bin"], b["n"])])
    ax.set(xlabel="true μ range (Debye)", ylabel="test MAE (D)"); ax.legend(frameon=False)
    fig.tight_layout(); fig.savefig(FIGURES / "error_by_mu_bin.png"); plt.close(fig)

    # robustness
    r = pd.DataFrame(rob)
    r = r[r.featureset.isin(["full", "composition"])]
    cols = ["random_all", "random_ring_only", "scaffold", "size_control", "size_le8"]
    names = ["random\n(all)", "random\n(ring-only)", "scaffold", "size control\n(random, same n)", "train ≤8 → test 9"]
    fig, ax = plt.subplots(figsize=(8, 3.5))
    w = 0.8 / len(r)
    for i, (_, row) in enumerate(r.iterrows()):
        vals = [np.nan if row[c] is None or pd.isna(row[c]) else row[c] for c in cols]
        ax.bar(np.arange(len(cols)) + i * w - 0.4 + w / 2, vals, w, label=row.model_label)
    ax.set_xticks(range(len(cols)), names); ax.set_ylabel("test MAE (D)"); ax.legend(frameon=False, fontsize=7, ncol=2)
    fig.tight_layout(); fig.savefig(FIGURES / "robustness.png"); plt.close(fig)

    if lc is not None:
        fig, ax = plt.subplots(figsize=(5.5, 3.5))
        for fs, c in [("2d", "#efb118"), ("full", "#4269d0")]:
            d = lc[lc.featureset == fs]
            ax.plot(d.n_train, d.test_mae, "o-", color=c, label=f"{FEATURESET_LABELS[fs]} (test)")
            ax.plot(d.n_train, d.train_mae, "o--", color=c, alpha=0.5, label="  (train)")
        ax.set(xscale="log", xlabel="training molecules", ylabel="MAE (D)", title="Learning curve, gradient boosting")
        ax.legend(frameon=False, fontsize=7)
        fig.tight_layout(); fig.savefig(FIGURES / "learning_curve.png"); plt.close(fig)


def main():
    df = pd.read_parquet(FEATURES_PATH)
    splits = pd.read_csv(SPLITS / "splits.csv.gz", keep_default_na=False)
    meta = df[["mol_id", "smiles", "smiles_2d", "scaffold", "mu", "comp_nheavy", "comp_nF",
               "d2_NumAromaticRings", "d2_fr_nitrile", "d2_fr_C_O", "d2_fr_Al_OH", "d2_fr_Ar_OH",
               "d2_fr_ether", "d2_fr_NH2"]].copy()
    meta["dup2d"] = meta["smiles_2d"].duplicated(keep=False)
    meta["comp_nheavy"] = (df["comp_natoms"] - df["comp_nH"]).to_numpy()  # true heavy-atom count

    m, preds = collect(df, splits)
    t = model_table(m, preds)
    tests = paired_tests(preds)
    rob = robustness(m, preds, meta)
    err, p = error_analysis(preds, meta.drop(columns="mu"))
    lc = pd.read_csv(RESULTS / "learning_curve.csv") if (RESULTS / "learning_curve.csv").exists() else None
    gi = pd.read_csv(RESULTS / "group_importance.csv") if (RESULTS / "group_importance.csv").exists() else None
    abl = m[(m.split == MAIN) & m.model.isin(["ridge", "hgb"])][["featureset", "model", "test_mae", "test_r2"]]
    abl = abl.assign(featureset_label=abl.featureset.map(FEATURESET_LABELS))

    summary = {
        "data_quality": json.loads((RESULTS / "data_quality.json").read_text()),
        "splits": json.loads((RESULTS / "split_summary.json").read_text()),
        "model_table": json.loads(t.to_json(orient="records")),
        "paired_tests": tests,
        "robustness": rob,
        "ablation": abl.to_dict("records"),
        "error_analysis": err,
        "learning_curve": lc.to_dict("records") if lc is not None else [],
        "group_importance": gi.to_dict("records") if gi is not None else [],
        "mu_histogram": np.histogram(df[TARGET], bins=np.arange(0, 30.5, 0.25))[0].tolist(),
        "model_labels": MODEL_LABELS, "featureset_labels": FEATURESET_LABELS,
    }
    js = json.dumps(summary, indent=1, default=float)
    (RESULTS / "summary.json").write_text(js)
    (SITE_DATA / "summary.json").write_text(js)
    (SITE_DATA / "explorer.json").write_text(json.dumps(explorer(p), separators=(",", ":")))
    figures(t, tests, rob, err, p, df, lc, gi)
    pd.set_option("display.width", 200)
    print(t[["model", "featureset", "mae_s0", "mae_ci_lo", "mae_ci_hi", "mae_mean", "mae_std", "r2_s0", "n_seeds"]].round(4))
    print(json.dumps(tests, indent=1))
    print(pd.DataFrame(rob).round(3))
    print(pd.DataFrame(err["by_group"]).round(3))


if __name__ == "__main__":
    main()
