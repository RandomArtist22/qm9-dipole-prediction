"""Step 6 (website only): export 3D structures for the molecules in the explorer.

For every molecule in docs/data/explorer.json this writes, to docs/data/structures.json:
  x : XYZ block (element + DFT-optimised coordinates, 2 decimals), drawn by 3Dmol.js
  d : the Gasteiger-charge dipole vector sum_i q_i (r_i - centroid), in Debye. Its length is
      exactly the `phys_gasteiger_dipole` model feature; it points toward the positive end.
QM9 only provides the magnitude of the DFT dipole, not its direction, so the arrow on the
site is the model's physics feature, not the DFT answer.
"""
import json

import numpy as np
from rdkit import Chem, RDLogger
from rdkit.Chem import rdPartialCharges

from config import SDF_PATH, SITE_DATA

RDLogger.DisableLog("rdApp.*")
E_ANGSTROM_TO_DEBYE = 4.80320


def main():
    ex = json.loads((SITE_DATA / "explorer.json").read_text())
    want = {m["id"] for m in ex["molecules"]}
    out = {}
    for mol in Chem.SDMolSupplier(str(SDF_PATH), removeHs=False, sanitize=True):
        if mol is None:
            continue
        name = mol.GetProp("_Name")
        if name not in want:
            continue
        xyz = mol.GetConformer().GetPositions()
        xyz = xyz - xyz.mean(0)
        rdPartialCharges.ComputeGasteigerCharges(mol)
        q = np.array([a.GetDoubleProp("_GasteigerCharge") for a in mol.GetAtoms()])
        q = np.where(np.isfinite(q), q, 0.0)
        d = (q[:, None] * xyz).sum(0) * E_ANGSTROM_TO_DEBYE
        lines = [str(mol.GetNumAtoms()), name] + [
            f"{a.GetSymbol()} {p[0]:.2f} {p[1]:.2f} {p[2]:.2f}" for a, p in zip(mol.GetAtoms(), xyz)]
        out[name] = {"x": "\n".join(lines), "d": [round(float(v), 3) for v in d]}
    missing = want - set(out)
    assert not missing, f"missing structures: {list(missing)[:5]}"
    (SITE_DATA / "structures.json").write_text(json.dumps(out, separators=(",", ":")))
    print(f"wrote {len(out)} structures")


if __name__ == "__main__":
    main()
