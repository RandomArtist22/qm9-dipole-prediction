"""Step 4 (extra experiments, all on the main split random_s0).

(a) Learning curve: how test MAE of gradient boosting falls with training-set
    size, for the structure-only (2d) and full feature sets. Hyper-parameters
    are the ones chosen by CV on the training data in train_eval.py; the test
    set is used only to report the curve, never to choose anything.
(b) Grouped permutation importance: refit the best model (gradient boosting,
    full features), then shuffle one whole feature GROUP at a time across the
    test molecules and measure how much MAE gets worse. Grouping avoids the
    usual problem that correlated single features hide each other's importance.

Outputs: results/learning_curve.csv, results/group_importance.csv
"""
import json

import numpy as np
import pandas as pd
from sklearn.base import clone
from sklearn.metrics import mean_absolute_error

from config import FEATURES_PATH, RESULTS, SPLITS, TARGET
from models import feature_columns, make_model

SPLIT = "random_s0"
SIZES = [1000, 2000, 5000, 10000, 20000, 50000, None]  # None = full training set
GROUPS = {"comp": "Composition", "d2": "2D descriptors", "q2": "Gasteiger charge stats",
          "geo": "Coulomb eigenvalues + shape", "phys": "Dipole estimates (charges x coords)"}


def best_params(fs, model="hgb"):
    res = json.loads((RESULTS / "runs" / f"{SPLIT}__{fs}__{model}.json").read_text())
    return res["best_params"]


def main():
    df = pd.read_parquet(FEATURES_PATH)
    sp = pd.read_csv(SPLITS / "splits.csv.gz", keep_default_na=False)[SPLIT].to_numpy()
    tr, te = np.flatnonzero(sp == "train"), np.flatnonzero(sp == "test")
    y = df[TARGET].to_numpy()
    rng = np.random.default_rng(7)
    perm_tr = rng.permutation(tr)

    rows = []
    for fs in ["2d", "full"]:
        cols = feature_columns(df.columns, fs)
        X = df[cols].to_numpy(float)
        pipe, _, _, _ = make_model("hgb", seed=0)
        pipe.set_params(**best_params(fs))
        for n in SIZES:
            idx = perm_tr if n is None else perm_tr[:n]
            m = clone(pipe).fit(X[idx], y[idx])
            p = m.predict(X[te])
            mae_tr = mean_absolute_error(y[idx], m.predict(X[idx]))
            rows.append({"featureset": fs, "n_train": len(idx), "test_mae": mean_absolute_error(y[te], p),
                         "train_mae": mae_tr})
            print(rows[-1], flush=True)
            if fs == "full" and n is None:
                full_model, full_cols, Xfull = m, cols, X
    pd.DataFrame(rows).to_csv(RESULTS / "learning_curve.csv", index=False)

    # ---- grouped permutation importance on the test set ----
    Xte = Xfull[te].copy()
    base = mean_absolute_error(y[te], full_model.predict(Xte))
    imp = []
    for g, label in GROUPS.items():
        gi = [i for i, c in enumerate(full_cols) if c.split("_")[0] == g]
        deltas = []
        for r in range(5):
            Xp = Xte.copy()
            order = np.random.default_rng(r).permutation(len(Xp))
            Xp[:, gi] = Xp[order][:, gi]  # shuffle the group's columns jointly
            deltas.append(mean_absolute_error(y[te], full_model.predict(Xp)) - base)
        imp.append({"group": g, "label": label, "n_features": len(gi), "base_mae": base,
                    "delta_mae_mean": float(np.mean(deltas)), "delta_mae_std": float(np.std(deltas))})
        print(imp[-1], flush=True)
    pd.DataFrame(imp).to_csv(RESULTS / "group_importance.csv", index=False)


if __name__ == "__main__":
    main()
