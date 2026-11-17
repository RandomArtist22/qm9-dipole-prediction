# Predicting Molecular Dipole Moments on QM9

**ES 335 Machine Learning · course project** · P Sai Ramcharan Reddy (25110220) · Vasu Garg (25110342)

**Website:** https://randomartist22.github.io/qm9-dipole-prediction/ — the full reasoning, figures and an
interactive prediction explorer. This README covers how to reproduce and check everything.

## The question in one paragraph

Can the DFT-computed dipole-moment magnitude μ (Debye) of a small organic molecule be predicted from its structure
alone, without running the property calculation? One row = one QM9 molecule (≤ 9 heavy atoms; H, C, N, O, F); the
target is μ from B3LYP/6-31G(2df,p). We compare two baselines (training mean; linear regression on atom counts) with
Ridge, Lasso, k-NN, a decision tree, a random forest, gradient boosting, an RBF-SVR and an MLP. We use two feature sets:
**structure-only** (2D bond graph) and **structure + geometry** (adds 3D-coordinate features). The models are tested on a
grouped random split (3 seeds), a Bemis–Murcko **scaffold** split, and a train-≤8 → test-9-heavy-atom **size-extrapolation**
split with a size-matched control.

## Headline results

Test set of the main random split (26,394 molecules). MAE / RMSE in Debye. 95% bootstrap CI on seed 0; 
mean ± sd over 3 random splits where available.

| Model | Features | MAE [95% CI] | MAE over seeds | RMSE | R² |
|---|---|---|---|---|---|
| **Gradient boosting** | structure + geometry | **0.341** [0.337, 0.346] | 0.341 ± 0.001 | 0.530 | 0.879 |
| MLP (neural net) | structure + geometry | 0.356 [0.351, 0.361] | 1 seed | 0.552 | 0.869 |
| Random forest | structure + geometry | 0.363 [0.358, 0.369] | 1 seed | 0.595 | 0.847 |
| SVR (RBF) | structure + geometry | 0.428 [0.422, 0.434] | 1 seed | 0.688 | 0.796 |
| Decision tree | structure + geometry | 0.461 [0.454, 0.468] | 0.465 ± 0.023 | 0.741 | 0.764 |
| Gradient boosting | structure only | 0.542 [0.535, 0.549] | 0.540 ± 0.002 | 0.784 | 0.735 |
| Random forest | structure only | 0.549 [0.542, 0.556] | 1 seed | 0.816 | 0.713 |
| Ridge | structure + geometry | 0.573 [0.565, 0.580] | 0.570 ± 0.002 | 0.843 | 0.694 |
| Lasso | structure + geometry | 0.575 [0.568, 0.583] | 1 seed | 0.848 | 0.690 |
| MLP (neural net) | structure only | 0.575 [0.568, 0.583] | 1 seed | 0.828 | 0.705 |
| k-NN | structure + geometry | 0.578 [0.570, 0.586] | 1 seed | 0.859 | 0.682 |
| k-NN | structure only | 0.613 [0.605, 0.621] | 1 seed | 0.902 | 0.649 |
| SVR (RBF) | structure only | 0.623 [0.615, 0.631] | 1 seed | 0.920 | 0.635 |
| Decision tree | structure only | 0.667 [0.659, 0.675] | 0.671 ± 0.005 | 0.960 | 0.603 |
| Ridge | structure only | 0.748 [0.739, 0.757] | 0.747 ± 0.001 | 1.039 | 0.535 |
| Lasso | structure only | 0.751 [0.743, 0.760] | 1 seed | 1.044 | 0.531 |
| Linear reg. on atom counts | atom counts | 1.005 [0.995, 1.016] | 1.009 ± 0.005 | 1.340 | 0.227 |
| Mean baseline | none | 1.190 [1.179, 1.202] | 1.187 ± 0.010 | 1.523 | -0.000 |

**Robustness (gradient boosting, full features):** random split ring-only control 0.334 → scaffold split 0.393 (+18%); size-matched random control 0.420 → train ≤8 / test 9 heavy atoms 0.450 (+7%). Ridge with full features fails the size test (0.583 → 1.916) because one Coulomb eigenvalue leaves its training range.

**Ablation (gradient boosting, seed 0):** Composition (atom counts) 0.950, Structure only (2D graph) 0.542, 2D + Coulomb/shape geometry 0.513, 2D + dipole estimates 0.345, Structure + geometry (full) 0.341

All numbers: `results/metrics.csv`, `results/summary.json`, `notebooks/02_results_walkthrough.ipynb`.

## Repository layout

```
src/
  config.py              paths, seeds, split fractions, tuning subsample sizes
  build_dataset.py       SDF -> one row per molecule; feature groups; data-quality report
  make_splits.py         every train/test split, fixed before any model is trained
  models.py              feature sets; pipelines + hyper-parameter grids for every model
  train_eval.py          per split: 5-fold CV tuning on train only -> refit -> single test evaluation
  run_all.sh             the exact set of runs reported on the site
  extra_experiments.py   learning curve, grouped permutation importance
  analyze.py             metrics table, bootstrap CIs, paired tests, error analysis, figures, site JSON
  export_3d.py           3D structures + charge-dipole vectors of the explorer molecules (website 3D viewer)
notebooks/
  01_data_exploration.ipynb   target distribution, sizes, duplicates, quality checks (executed)
  02_results_walkthrough.ipynb all result tables and figures (executed)
data/
  raw/SHA256SUMS         checksum of the downloaded archive (raw data itself is not committed)
  splits/splits.csv.gz   the exact splits: one column per split, values train / test / ''
results/
  metrics.csv            every (split, feature set, model): chosen hyper-parameters, CV MAE, test MAE/RMSE/R²
  predictions/*.parquet  test-set predictions of every run
  summary.json           all tables shown on the website
  data_quality.json, split_summary.json, learning_curve.csv, group_importance.csv
  rdkit_failed_molecules.csv  the 1,915 molecules RDKit could not parse
  figures/               static PNG figures
  train_log.txt          console log of the experiment runs
docs/                    the GitHub Pages website (static HTML/CSS/JS + JSON data)
```

## Setup and reproduction

Tested with Python 3.12 on Linux (28 cores, 32 GB RAM).

```bash
git clone https://github.com/RandomArtist22/qm9-dipole-prediction && cd qm9-dipole-prediction
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# 1. data (44.8 MB, public, no account or API key needed)
cd data/raw
curl -LO https://deepchemdata.s3-us-west-1.amazonaws.com/datasets/molnet_publish/qm9.zip
sha256sum -c SHA256SUMS          # must print: qm9.zip: OK
unzip qm9.zip                    # -> gdb9.sdf, gdb9.sdf.csv, QM9_README
cd ../../src

# 2. pipeline
python build_dataset.py          # ~2 min  -> data/processed/qm9_features.parquet, results/data_quality.json
python make_splits.py            # seconds -> data/splits/splits.csv.gz (identical to the committed file)
bash run_all.sh                  # ~1.5 h on 28 cores; each run is cached in results/runs/
python extra_experiments.py      # ~10 min: learning curve + permutation importance
python analyze.py                # tables, CIs, figures, docs/data/*.json
python export_3d.py              # docs/data/structures.json for the 3D viewer (~30 s)

# 3. notebooks (optional)
cd ../notebooks && jupyter nbconvert --to notebook --execute --inplace *.ipynb

# 4. view the site locally
cd ../docs && python -m http.server 8000   # open http://localhost:8000
```

Results are deterministic up to library versions and thread scheduling: all splits, subsamples and models use fixed
seeds (`src/config.py`, `random_state` in `src/models.py`).

### Data access

* **Source:** QM9 (Ramakrishnan et al., 2014), via the MoleculeNet/DeepChem mirror above. The original release is on figshare
  (collection 978904); its automated download was blocked by a bot check when we built the project, so we used the mirror,
  which contains the same 133,885 molecules with 3D structures (`gdb9.sdf`) and properties (`gdb9.sdf.csv`).
* QM9 is public and free to use with citation. We do **not** redistribute the raw data in this repo, only its checksum,
  the derived splits (molecule IDs) and our predictions.
* No credentials, API keys or private data are used or stored anywhere in the repository.

### Exact preprocessing and split details

* Only `mol_id` and `mu` are read from `gdb9.sdf.csv`. Every other column comes from the same DFT calculation as the
  target and would leak it, so none is used as an input.
* 1,915 SDF entries fail RDKit sanitisation and are excluded (`results/rdkit_failed_molecules.csv`), leaving 131,970 molecules.
* Feature groups (prefixes in `build_dataset.py`): `comp_` atom counts; `d2_` RDKit 2D descriptors (incl. 85 `fr_`
  functional-group counts); `q2_` Gasteiger partial-charge statistics; `geo_` 29 sorted Coulomb-matrix eigenvalues + 6 shape
  descriptors; `phys_` Gasteiger-charge dipole |Σ qᵢrᵢ| and an electronegativity bond-dipole sum.
* Learned preprocessing (median imputation, constant-column removal, standardisation for scale-sensitive models) sits
  inside an sklearn `Pipeline`, so it is fitted on training folds only.
* Random splits: 80/20, whole 2D graphs assigned to one side, seeds 0, 1, 2. Scaffold split: whole Murcko scaffolds held out
  (acyclic molecules stay in training). Size split: train on ≤ 8 heavy atoms, test on a fixed 20% pool of 9-heavy-atom
  molecules; the control trains on a random sample of equal size drawn from outside the pool.
* Tuning: 5-fold CV (MAE) on a 15,000-molecule random subsample of each split's training set; the chosen setting is refit
  on the whole training set (SVR: 20,000 molecules) and scored once on the test set.

## AI-use disclosure

Claude Code (Anthropic) was used to help write and debug code, run experiments, and draft the website and README text.

## Citations

* R. Ramakrishnan, P. O. Dral, M. Rupp, O. A. von Lilienfeld. *Quantum chemistry structures and properties of 134 kilo
  molecules.* Scientific Data 1, 140022 (2014).
* L. Ruddigkeit, R. van Deursen, L. C. Blum, J.-L. Reymond. *Enumeration of 166 billion organic small molecules in the
  chemical universe database GDB-17.* J. Chem. Inf. Model. 52, 2864 (2012).
* Z. Wu et al. *MoleculeNet: a benchmark for molecular machine learning.* Chem. Sci. 9, 513 (2018) — source of the mirror.
* M. Rupp, A. Tkatchenko, K.-R. Müller, O. A. von Lilienfeld. *Fast and accurate modeling of molecular atomization energies
  with machine learning.* Phys. Rev. Lett. 108, 058301 (2012) — Coulomb matrix.
* J. Gasteiger, M. Marsili. *Iterative partial equalization of orbital electronegativity.* Tetrahedron 36, 3219 (1980).
* G. W. Bemis, M. A. Murcko. *The properties of known drugs. 1. Molecular frameworks.* J. Med. Chem. 39, 2887 (1996).
* F. Pedregosa et al. *Scikit-learn: Machine learning in Python.* JMLR 12, 2825 (2011). · RDKit: Open-source cheminformatics,
  https://www.rdkit.org · Plotly.js · SmilesDrawer (D. Probst, J.-L. Reymond, J. Chem. Inf. Model. 58, 1 (2018)) · 3Dmol.js (N. Rego, D. Koes,
  Bioinformatics 31, 1322 (2015)).
* jilsnshah, *molecular_prediction_challange* (GitHub) — an earlier Kaggle-based dipole study, used only to compare
  representations (its Coulomb-eigenvalue result motivated our physics-based dipole features). No code was reused.
* ES 335 lecture notes and handbook (IIT Gandhinagar, 2026) for the methods and evaluation practices.
