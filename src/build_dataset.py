"""Step 1: parse QM9 (DeepChem/MoleculeNet copy) into one row per molecule.

Inputs : data/raw/gdb9.sdf      (3D structures, one block per molecule)
         data/raw/gdb9.sdf.csv  (DFT properties; we keep ONLY the target `mu`)
Outputs: data/processed/qm9_features.parquet
         results/data_quality.json

Leakage rule: every column of gdb9.sdf.csv other than `mu` (rotational
constants A/B/C, alpha, HOMO/LUMO/gap, r2, zpve, energies, Cv) comes out of the
same DFT calculation as the dipole, so none of them is used as an input.
All features are computed from the molecular graph (element + bonds) and,
for the geometry feature sets, the atomic coordinates.

Feature groups (column prefixes):
  comp_*  composition: atom counts                  (baseline features)
  d2_*    2D descriptors from the bond graph (RDKit), incl. fr_* functional-group counts
  q2_*    summary statistics of Gasteiger partial charges (graph-only, no DFT)
  geo_*   geometry: sorted Coulomb-matrix eigenvalues, inertia/shape descriptors
  phys_*  physics-motivated vectors: Gasteiger-charge dipole and electronegativity
          bond-dipole sum, both using the 3D coordinates
"""
import json
import time
from multiprocessing import Pool

import numpy as np
import pandas as pd
from rdkit import Chem, RDLogger
from rdkit.Chem import Descriptors, rdPartialCharges
from rdkit.Chem.Scaffolds import MurckoScaffold

from config import CSV_PATH, FEATURES_PATH, RESULTS, SDF_PATH

RDLogger.DisableLog("rdApp.*")

Z = {"H": 1, "C": 6, "N": 7, "O": 8, "F": 9}
MASS = {"H": 1.008, "C": 12.011, "N": 14.007, "O": 15.999, "F": 18.998}
PAULING = {"H": 2.20, "C": 2.55, "N": 3.04, "O": 3.44, "F": 3.98}
E_ANGSTROM_TO_DEBYE = 4.80320  # 1 e*Angstrom = 4.8032 D
MAX_ATOMS = 29  # largest QM9 molecule
# Descriptors dropped up front: Ipc spans ~20 orders of magnitude and is
# numerically unstable; the BCUT2D_* family depends on Gasteiger/Crippen
# charges that are already summarised in q2_*.
DROP_DESC = {"Ipc"}


def coulomb_eigenvalues(elems, xyz):
    """Sorted eigenvalues of the Coulomb matrix (Rupp et al. 2012), zero-padded.

    Invariant to translation, rotation and atom ordering.
    """
    z = np.array([Z[e] for e in elems], dtype=float)
    d = np.linalg.norm(xyz[:, None, :] - xyz[None, :, :], axis=-1)
    np.fill_diagonal(d, 1.0)
    cm = np.outer(z, z) / d
    np.fill_diagonal(cm, 0.5 * z**2.4)
    ev = np.sort(np.linalg.eigvalsh(cm))[::-1]
    return np.pad(ev, (0, MAX_ATOMS - len(ev)))


def shape_features(elems, xyz):
    m = np.array([MASS[e] for e in elems])
    com = (m[:, None] * xyz).sum(0) / m.sum()
    r = xyz - com
    # inertia tensor
    inertia = np.zeros((3, 3))
    for mi, ri in zip(m, r):
        inertia += mi * (np.dot(ri, ri) * np.eye(3) - np.outer(ri, ri))
    pm = np.sort(np.linalg.eigvalsh(inertia))  # I1 <= I2 <= I3
    rg = np.sqrt((m * (r**2).sum(1)).sum() / m.sum())
    # gyration-tensor asphericity (0 = spherical)
    g = (r.T @ r) / len(r)
    lam = np.sort(np.linalg.eigvalsh(g))
    asph = lam[2] - 0.5 * (lam[0] + lam[1])
    dmax = np.max(np.linalg.norm(r[:, None] - r[None], axis=-1))
    return {
        "geo_I1": pm[0], "geo_I2": pm[1], "geo_I3": pm[2],
        "geo_rgyr": rg, "geo_asphericity": asph, "geo_dmax": dmax,
    }


def featurize(block):
    mol = Chem.MolFromMolBlock(block, removeHs=False, sanitize=True)
    if mol is None:
        # keep the id so the failure can be reported
        name = block.strip().splitlines()[0].strip() if block.strip() else "?"
        return {"mol_id": name, "_ok": False}
    name = mol.GetProp("_Name")
    elems = [a.GetSymbol() for a in mol.GetAtoms()]
    xyz = mol.GetConformer().GetPositions()
    heavy = Chem.RemoveHs(mol)

    row = {"mol_id": name, "_ok": True}
    row["smiles"] = Chem.MolToSmiles(heavy)
    row["smiles_2d"] = Chem.MolToSmiles(heavy, isomericSmiles=False)
    row["scaffold"] = MurckoScaffold.MurckoScaffoldSmiles(mol=heavy)

    # --- composition (baseline) ---
    for e in Z:
        row[f"comp_n{e}"] = elems.count(e)
    row["comp_natoms"] = len(elems)
    row["comp_nheavy"] = heavy.GetNumAtoms()

    # --- 2D descriptors (graph only) ---
    desc = Descriptors.CalcMolDescriptors(heavy)
    for k, v in desc.items():
        if k in DROP_DESC or k.startswith("BCUT2D"):
            continue
        row[f"d2_{k}"] = float(v) if v is not None else np.nan

    # --- Gasteiger charges: electronegativity equalisation on the graph ---
    rdPartialCharges.ComputeGasteigerCharges(mol)
    q = np.array([a.GetDoubleProp("_GasteigerCharge") for a in mol.GetAtoms()])
    q = np.where(np.isfinite(q), q, 0.0)
    row["q2_max"] = q.max()
    row["q2_min"] = q.min()
    row["q2_absmean"] = np.abs(q).mean()
    row["q2_std"] = q.std()

    # --- geometry ---
    for i, v in enumerate(coulomb_eigenvalues(elems, xyz)):
        row[f"geo_cm{i:02d}"] = v
    row.update(shape_features(elems, xyz))

    # --- physics-motivated dipole estimates (need geometry) ---
    centred = xyz - xyz.mean(0)
    mu_vec = (q[:, None] * centred).sum(0)
    row["phys_gasteiger_dipole"] = np.linalg.norm(mu_vec) * E_ANGSTROM_TO_DEBYE
    bvec = np.zeros(3)
    for b in mol.GetBonds():
        i, j = b.GetBeginAtomIdx(), b.GetEndAtomIdx()
        dchi = PAULING[elems[j]] - PAULING[elems[i]]
        bvec += dchi * (xyz[j] - xyz[i])
    row["phys_bond_dipole"] = np.linalg.norm(bvec)
    return row


def main():
    t0 = time.time()
    text = SDF_PATH.read_text()
    blocks = [b for b in text.split("$$$$\n") if b.strip()]
    print(f"{len(blocks)} SDF blocks")
    with Pool() as pool:
        rows = pool.map(featurize, blocks, chunksize=500)
    df = pd.DataFrame(rows)
    print(f"featurised in {time.time() - t0:.0f}s")

    labels = pd.read_csv(CSV_PATH, usecols=["mol_id", "mu"])
    df = df.merge(labels, on="mol_id", how="left", validate="one_to_one")
    df["gdb_index"] = df["mol_id"].str.replace("gdb_", "").astype(int)

    failed = df[~df["_ok"]]
    ok = df[df["_ok"]].drop(columns="_ok").reset_index(drop=True)

    # ---------------- data-quality report ----------------
    feat_cols = [c for c in ok.columns if c.split("_")[0] in {"comp", "d2", "q2", "geo", "phys"}]
    nan_counts = ok[feat_cols].isna().sum()
    inf_counts = np.isinf(ok[feat_cols].select_dtypes("number")).sum()
    dup_iso = ok["smiles"].duplicated(keep=False)
    dup_2d = ok["smiles_2d"].duplicated(keep=False)
    # spread of mu among molecules that share an identical 2D graph:
    grp = ok[dup_2d].groupby("smiles_2d")["mu"]
    spread = (grp.max() - grp.min())
    quality = {
        "n_sdf_blocks": int(len(blocks)),
        "n_label_rows": int(len(labels)),
        "n_rdkit_failures": int(len(failed)),
        "mu_failed_mean": float(failed["mu"].mean()),
        "mu_failed_median": float(failed["mu"].median()),
        "mu_kept_mean": float(ok["mu"].mean()),
        "mu_kept_median": float(ok["mu"].median()),
        "n_kept": int(len(ok)),
        "n_missing_labels": int(ok["mu"].isna().sum()),
        "n_features": len(feat_cols),
        "features_with_nan": {k: int(v) for k, v in nan_counts[nan_counts > 0].items()},
        "features_with_inf": {k: int(v) for k, v in inf_counts[inf_counts > 0].items()},
        "n_mu_exactly_zero": int((ok["mu"] == 0).sum()),
        "n_mu_below_0.1": int((ok["mu"] < 0.1).sum()),
        "n_mu_above_10": int((ok["mu"] > 10).sum()),
        "mu_describe": {k: float(v) for k, v in ok["mu"].describe().items()},
        "mu_skew": float(ok["mu"].skew()),
        "n_rows_sharing_isomeric_smiles": int(dup_iso.sum()),
        "n_rows_sharing_2d_graph": int(dup_2d.sum()),
        "n_2d_graphs_with_duplicates": int(len(spread)),
        "median_mu_spread_within_same_2d_graph": float(spread.median()) if len(spread) else 0.0,
        "max_mu_spread_within_same_2d_graph": float(spread.max()) if len(spread) else 0.0,
        "n_acyclic": int((ok["scaffold"] == "").sum()),
        "n_unique_scaffolds": int(ok["scaffold"].nunique()),
        "heavy_atom_counts": {int(k): int(v) for k, v in ok["comp_nheavy"].value_counts().sort_index().items()},
        "top_mu_molecules": ok.nlargest(10, "mu")[["mol_id", "smiles", "mu"]].to_dict("records"),
        "failed_ids_sample": failed["mol_id"].head(20).tolist(),
    }
    (RESULTS / "data_quality.json").write_text(json.dumps(quality, indent=2))
    failed[["mol_id", "mu"]].to_csv(RESULTS / "rdkit_failed_molecules.csv", index=False)
    ok.to_parquet(FEATURES_PATH, index=False)
    print(json.dumps({k: v for k, v in quality.items() if not isinstance(v, (dict, list))}, indent=2))
    print(f"saved {ok.shape} to {FEATURES_PATH} in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
