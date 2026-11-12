#!/usr/bin/env bash
# Runs every (split, feature set, model) combination reported in the project.
# Each run is skipped if results/runs/<tag>.json already exists (use --force to redo).
set -euo pipefail
cd "$(dirname "$0")"
PY=${PY:-python}

# Main split: all models, structure-only and full feature sets
$PY train_eval.py --splits random_s0 --models all
# Stress tests (each tuned inside its own training set)
$PY train_eval.py --splits scaffold size_le8 size_control --models mean linreg_comp ridge tree hgb rf
# Feature-set ablation on the main split
$PY train_eval.py --splits random_s0 --featuresets composition 2d_phys 2d_geo --models ridge hgb
# Repeated random splits for the seed spread (random forest omitted for time)
$PY train_eval.py --splits random_s1 random_s2 --models mean linreg_comp ridge tree hgb
# NOTE: run these steps one after another, never two in parallel: gradient boosting uses
# all cores via OpenMP, and two such jobs at once stalled for an hour on our machine.
