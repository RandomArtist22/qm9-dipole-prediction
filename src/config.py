"""Shared paths and constants for the QM9 dipole-moment project."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
PROCESSED = ROOT / "data" / "processed"
SPLITS = ROOT / "data" / "splits"
RESULTS = ROOT / "results"
FIGURES = ROOT / "results" / "figures"
SITE_DATA = ROOT / "docs" / "data"

SDF_PATH = RAW / "gdb9.sdf"
CSV_PATH = RAW / "gdb9.sdf.csv"
FEATURES_PATH = PROCESSED / "qm9_features.parquet"

TARGET = "mu"  # DFT (B3LYP/6-31G(2df,p)) dipole moment magnitude, Debye

# Random seeds for the repeated random splits. Seed 0 is the "main" split
# used for error analysis and the website.
SEEDS = [0, 1, 2]
TEST_FRACTION = 0.20

# Hyper-parameter tuning uses a random subsample of each split's TRAINING
# portion only (5-fold CV) to keep the grid search affordable.
TUNE_SUBSAMPLE = 15_000
CV_FOLDS = 5
# SVR and KNN scale badly with n, so they are fitted on a training subsample.
KERNEL_TRAIN_SUBSAMPLE = 20_000

for p in (PROCESSED, SPLITS, RESULTS, FIGURES, SITE_DATA):
    p.mkdir(parents=True, exist_ok=True)
