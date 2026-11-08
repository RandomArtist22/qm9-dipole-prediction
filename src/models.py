"""Feature sets and model definitions (pipelines + hyper-parameter grids).

Every learned preprocessing step (median imputation, removal of constant
columns, standardisation) lives INSIDE a scikit-learn Pipeline, so during
cross-validation it is re-fitted on the training folds only and is never fitted
on validation or test molecules.
"""
from sklearn.dummy import DummyRegressor
from sklearn.ensemble import HistGradientBoostingRegressor, RandomForestRegressor
from sklearn.feature_selection import VarianceThreshold
from sklearn.impute import SimpleImputer
from sklearn.linear_model import Lasso, LinearRegression, Ridge
from sklearn.neighbors import KNeighborsRegressor
from sklearn.neural_network import MLPRegressor
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVR
from sklearn.tree import DecisionTreeRegressor


def feature_columns(columns, featureset):
    pref = lambda *ps: [c for c in columns if c.split("_")[0] in ps]  # noqa: E731
    sets = {
        "composition": pref("comp"),
        "2d": pref("comp", "d2", "q2"),
        "2d_phys": pref("comp", "d2", "q2", "phys"),
        "2d_geo": pref("comp", "d2", "q2", "geo"),
        "full": pref("comp", "d2", "q2", "geo", "phys"),
    }
    return sets[featureset]


FEATURESET_LABELS = {
    "composition": "Composition (atom counts)",
    "2d": "Structure only (2D graph)",
    "2d_phys": "2D + dipole estimates",
    "2d_geo": "2D + Coulomb/shape geometry",
    "full": "Structure + geometry (full)",
}


def _pre(scale=True):
    steps = [("impute", SimpleImputer(strategy="median")), ("drop_const", VarianceThreshold(0.0))]
    if scale:
        steps.append(("scale", StandardScaler()))
    return steps


def make_model(name, seed=0):
    """Return (pipeline, param_grid, train_subsample_or_None, fixed_featureset_or_None)."""
    if name == "mean":
        return Pipeline([("m", DummyRegressor(strategy="mean"))]), {}, None, "composition"
    if name == "linreg_comp":
        # Baseline 2: ordinary least squares on atom counts only.
        return Pipeline(_pre() + [("m", LinearRegression())]), {}, None, "composition"
    if name == "ridge":
        return (Pipeline(_pre() + [("m", Ridge())]),
                {"m__alpha": [0.1, 1, 10, 100, 1000]}, None, None)
    if name == "lasso":
        return (Pipeline(_pre() + [("m", Lasso(max_iter=5000, tol=1e-3, random_state=seed))]),
                {"m__alpha": [1e-4, 1e-3, 1e-2, 1e-1]}, None, None)
    if name == "knn":
        return (Pipeline(_pre() + [("m", KNeighborsRegressor(weights="distance", n_jobs=-1))]),
                {"m__n_neighbors": [5, 10, 20, 40]}, None, None)
    if name == "tree":
        return (Pipeline(_pre(False) + [("m", DecisionTreeRegressor(random_state=seed))]),
                {"m__max_depth": [6, 10, 14, None], "m__min_samples_leaf": [5, 20, 50]}, None, None)
    if name == "rf":
        return (Pipeline(_pre(False) + [("m", RandomForestRegressor(
                    n_estimators=200, max_samples=0.5, n_jobs=-1, random_state=seed))]),
                {"m__max_features": [0.33, "sqrt"], "m__min_samples_leaf": [1, 5]}, None, None)
    if name == "hgb":
        return (Pipeline(_pre(False) + [("m", HistGradientBoostingRegressor(
                    max_iter=1500, early_stopping=True, validation_fraction=0.1,
                    n_iter_no_change=30, random_state=seed))]),
                {"m__learning_rate": [0.05, 0.1], "m__max_leaf_nodes": [31, 63],
                 "m__l2_regularization": [0.0, 1.0]}, None, None)
    if name == "svr":
        return (Pipeline(_pre() + [("m", SVR(kernel="rbf", epsilon=0.1, cache_size=1000))]),
                {"m__C": [1, 10], "m__gamma": ["scale", 0.002]}, "kernel", None)
    if name == "mlp":
        return (Pipeline(_pre() + [("m", MLPRegressor(
                    hidden_layer_sizes=(256, 128), learning_rate_init=1e-3, batch_size=256,
                    max_iter=200, early_stopping=True, n_iter_no_change=10, random_state=seed))]),
                {"m__alpha": [1e-4, 1e-2]}, None, None)
    raise ValueError(name)


MODEL_LABELS = {
    "mean": "Mean baseline",
    "linreg_comp": "Linear reg. on atom counts",
    "ridge": "Ridge",
    "lasso": "Lasso",
    "knn": "k-NN",
    "tree": "Decision tree",
    "rf": "Random forest",
    "hgb": "Gradient boosting",
    "svr": "SVR (RBF)",
    "mlp": "MLP (neural net)",
}
ALL_MODELS = list(MODEL_LABELS)
