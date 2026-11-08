"""Step 3: tune on training data only, fit, and evaluate once on the test set.

For each (split, feature set, model):
  1. take that split's TRAINING molecules;
  2. tune hyper-parameters by 5-fold CV (MAE) on a random 15k subsample of them
     (the test molecules are never touched here);
  3. refit the chosen configuration on the full training set (SVR: a 20k
     subsample, because kernel methods scale as O(n^2)-O(n^3));
  4. predict the held-out test molecules once and record MAE / RMSE / R^2.

Each run writes results/runs/<split>__<featureset>__<model>.json (+ .npy test
predictions). `collect_results.py` merges them.

Usage: python train_eval.py --splits random_s0 --featuresets 2d full --models all
"""
import argparse
import json
import time
import warnings

import numpy as np
import pandas as pd
from sklearn.base import clone
from sklearn.exceptions import ConvergenceWarning
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import GridSearchCV, KFold

from config import (CV_FOLDS, FEATURES_PATH, KERNEL_TRAIN_SUBSAMPLE, RESULTS, SPLITS,
                    TARGET, TUNE_SUBSAMPLE)
from models import ALL_MODELS, feature_columns, make_model

warnings.filterwarnings("ignore", category=ConvergenceWarning)
RUNS = RESULTS / "runs"
RUNS.mkdir(parents=True, exist_ok=True)


def split_seed(split):
    return int(split[-1]) if split.startswith("random_s") else 0


def run_one(df, splits, split, featureset, model_name, force=False):
    seed = split_seed(split)
    pipe, grid, subsample, fixed_fs = make_model(model_name, seed=seed)
    fs = fixed_fs or featureset
    tag = f"{split}__{fs}__{model_name}"
    out_json = RUNS / f"{tag}.json"
    if out_json.exists() and not force:
        print(f"skip {tag} (exists)")
        return
    cols = feature_columns(df.columns, fs)
    tr = np.flatnonzero(splits[split].to_numpy() == "train")
    te = np.flatnonzero(splits[split].to_numpy() == "test")
    X = df[cols].to_numpy(dtype=np.float64)
    y = df[TARGET].to_numpy()
    rng = np.random.default_rng(1000 + seed)

    t0 = time.time()
    best_params, cv_mae = {}, None
    if grid:
        sub = rng.choice(tr, size=min(TUNE_SUBSAMPLE, len(tr)), replace=False)
        tune_pipe = clone(pipe)
        if "m__n_jobs" in tune_pipe.get_params():
            tune_pipe.set_params(m__n_jobs=1)  # parallelise over CV fits instead
        gs = GridSearchCV(tune_pipe, grid, scoring="neg_mean_absolute_error",
                          cv=KFold(CV_FOLDS, shuffle=True, random_state=seed),
                          n_jobs=-1, refit=False)
        gs.fit(X[sub], y[sub])
        best_params = gs.best_params_
        cv_mae = float(-gs.best_score_)
        cv_table = [{"params": {k: str(v) for k, v in p.items()}, "cv_mae": float(-s), "cv_std": float(sd)}
                    for p, s, sd in zip(gs.cv_results_["params"], gs.cv_results_["mean_test_score"],
                                        gs.cv_results_["std_test_score"])]
    else:
        cv_table = []
    t_tune = time.time() - t0

    fit_idx = tr
    if subsample == "kernel" and len(tr) > KERNEL_TRAIN_SUBSAMPLE:
        fit_idx = rng.choice(tr, size=KERNEL_TRAIN_SUBSAMPLE, replace=False)
    final = clone(pipe).set_params(**best_params)
    t1 = time.time()
    final.fit(X[fit_idx], y[fit_idx])
    pred = final.predict(X[te])
    t_fit = time.time() - t1

    n_kept = None
    if "drop_const" in final.named_steps:
        n_kept = int(final.named_steps["drop_const"].get_support().sum())
    res = {
        "split": split, "featureset": fs, "model": model_name,
        "n_train_fit": int(len(fit_idx)), "n_test": int(len(te)),
        "n_features_in": len(cols), "n_features_after_const_drop": n_kept,
        "best_params": {k: (v if isinstance(v, (int, float, str)) or v is None else str(v))
                        for k, v in best_params.items()},
        "cv_mae_tuning": cv_mae, "cv_table": cv_table,
        "test_mae": float(mean_absolute_error(y[te], pred)),
        "test_rmse": float(np.sqrt(mean_squared_error(y[te], pred))),
        "test_r2": float(r2_score(y[te], pred)),
        "tune_seconds": round(t_tune, 1), "fit_predict_seconds": round(t_fit, 1),
    }
    np.save(RUNS / f"{tag}.npy", pred.astype(np.float32))
    out_json.write_text(json.dumps(res, indent=2))
    print(f"{tag:45s} MAE={res['test_mae']:.4f} RMSE={res['test_rmse']:.4f} "
          f"R2={res['test_r2']:.4f} cvMAE={cv_mae} params={res['best_params']} "
          f"({t_tune:.0f}s tune, {t_fit:.0f}s fit)", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--splits", nargs="+", required=True)
    ap.add_argument("--featuresets", nargs="+", default=["2d", "full"])
    ap.add_argument("--models", nargs="+", default=["all"])
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    models = ALL_MODELS if a.models == ["all"] else a.models
    df = pd.read_parquet(FEATURES_PATH)
    splits = pd.read_csv(SPLITS / "splits.csv.gz", keep_default_na=False)
    assert (splits["mol_id"].to_numpy() == df["mol_id"].to_numpy()).all(), "row order mismatch"
    for split in a.splits:
        for fs in a.featuresets:
            for m in models:
                run_one(df, splits, split, fs, m, force=a.force)


if __name__ == "__main__":
    main()
