"""Step 2: define every train/test split BEFORE any model is fitted.

Output: data/splits/splits.csv.gz  (one row per molecule, one column per split,
values 'train' / 'test' / '' (= not used by that split)) and
results/split_summary.json.

Splits
------
random_s{0,1,2}  80/20 random split, *grouped by 2D graph*: the 326 graphs that
                 occur more than once (stereo-isomers / conformers) are kept on one
                 side so the test set never contains a molecule whose bond graph
                 is already in training.
scaffold         80/20 Bemis-Murcko scaffold split: whole ring systems are held
                 out, so test molecules have ring scaffolds never seen in training.
                 Acyclic molecules have no scaffold (empty string, 14k rows); they
                 are kept in training, so this test set is ring-only. Its matched
                 control is the random split evaluated on ring-containing molecules.
size_le8         Extrapolation stress test: train on molecules with <= 8 heavy atoms,
                 test on a fixed pool of 9-heavy-atom molecules (20% of them).
size_control     Same test pool, but training molecules are a RANDOM sample of the
                 same size as size_le8's training set, drawn from every molecule not in
                 the pool. Comparing the two isolates the effect of "never seeing a
                 9-atom molecule" from the effect of having less training data.
"""
import json

import numpy as np
import pandas as pd

from config import FEATURES_PATH, RESULTS, SEEDS, SPLITS, TEST_FRACTION


def grouped_split(groups: pd.Series, frac: float, seed: int, force_train=()):
    """Assign whole groups to test (random order) until `frac` of rows is reached."""
    rng = np.random.default_rng(seed)
    sizes = groups.value_counts()
    candidates = [g for g in sizes.index if g not in set(force_train)]
    order = rng.permutation(len(candidates))
    target = frac * len(groups)
    test_groups, n = set(), 0
    for i in order:
        g = candidates[i]
        if n >= target:
            break
        test_groups.add(g)
        n += sizes[g]
    return np.where(groups.isin(test_groups), "test", "train")


def main():
    df = pd.read_parquet(FEATURES_PATH, columns=["mol_id", "smiles_2d", "scaffold", "comp_nheavy", "mu"])
    out = pd.DataFrame({"mol_id": df["mol_id"]})

    for s in SEEDS:
        out[f"random_s{s}"] = grouped_split(df["smiles_2d"], TEST_FRACTION, seed=s)

    out["scaffold"] = grouped_split(df["scaffold"], TEST_FRACTION, seed=0, force_train=[""])

    rng = np.random.default_rng(0)
    nine = np.flatnonzero(df["comp_nheavy"].to_numpy() == 9)
    pool = rng.choice(nine, size=int(TEST_FRACTION * len(nine)), replace=False)
    in_pool = np.zeros(len(df), bool)
    in_pool[pool] = True
    small = df["comp_nheavy"].to_numpy() <= 8

    size = np.full(len(df), "", dtype=object)
    size[small] = "train"
    size[in_pool] = "test"
    out["size_le8"] = size

    ctrl = np.full(len(df), "", dtype=object)
    # exclude molecules whose 2D graph also occurs in the test pool (no graph leakage)
    pool_graphs = set(df.loc[in_pool, "smiles_2d"])
    eligible = np.flatnonzero(~in_pool & ~df["smiles_2d"].isin(pool_graphs).to_numpy())
    ctrl_train = rng.choice(eligible, size=int(small.sum()), replace=False)
    ctrl[ctrl_train] = "train"
    ctrl[in_pool] = "test"
    out["size_control"] = ctrl

    out.to_csv(SPLITS / "splits.csv.gz", index=False)

    summary = {}
    for col in out.columns[1:]:
        tr, te = out[col] == "train", out[col] == "test"
        summary[col] = {
            "n_train": int(tr.sum()), "n_test": int(te.sum()),
            "mu_mean_train": round(float(df.loc[tr, "mu"].mean()), 4),
            "mu_mean_test": round(float(df.loc[te, "mu"].mean()), 4),
            "test_frac_acyclic": round(float((df.loc[te, "scaffold"] == "").mean()), 4),
            "graph_overlap": int(len(set(df.loc[tr, "smiles_2d"]) & set(df.loc[te, "smiles_2d"]))),
            "scaffold_overlap_rows": int(df.loc[te, "scaffold"].isin(set(df.loc[tr, "scaffold"]) - {""}).sum()),
        }
    (RESULTS / "split_summary.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
