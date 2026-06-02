#!/usr/bin/env python3
import os
import json
from typing import Dict, Any

import numpy as np
from flask import Flask, request, jsonify

try:
    from flask_cors import CORS
except Exception:
    CORS = None  # optional

from stable_baselines3 import PPO

# Optional VecNormalize stats for observation normalization
try:
    import cloudpickle as pickle
except Exception:
    import pickle  # type: ignore


BASE_DIR = os.path.dirname(os.path.abspath(__file__))

MODEL_PATH = os.environ.get(
    "MODEL_PATH",
    os.path.join(BASE_DIR, "best_model.zip"),
)
VECNORM_PATH = os.environ.get(
    "VECNORM_PATH",
    os.path.join(BASE_DIR, "vecnormalize_squeeze.pkl"),
)

# Map action u in [-1, 1] to jaw angle [CLOSE, OPEN]
JAW_OPEN_RAD = np.deg2rad(60.0)
JAW_CLOSE_RAD = 0.0

def action_to_angle(u: float) -> float:
    u01 = 0.5 * (u + 1.0)
    return float((1.0 - u01) * JAW_CLOSE_RAD + u01 * JAW_OPEN_RAD)


# Load PPO model
if not os.path.isfile(MODEL_PATH):
    raise FileNotFoundError(f"MODEL_PATH not found: {MODEL_PATH}")
model = PPO.load(MODEL_PATH)

# Try to load VecNormalize stats (optional but recommended)
vecnorm = None
if VECNORM_PATH and os.path.isfile(VECNORM_PATH):
    try:
        with open(VECNORM_PATH, "rb") as f:
            vecnorm = pickle.load(f)
    except Exception:
        vecnorm = None


def maybe_normalize_obs(obs: Dict[str, np.ndarray]) -> Dict[str, np.ndarray]:
    """Normalize dict observation with VecNormalize stats if available.
    Works for dict observation spaces where vecnorm.obs_rms is a dict of RunningMeanStd.
    """
    if vecnorm is None:
        return obs
    try:
        # SB3 VecNormalize keeps epsilon and obs_rms per key
        eps = getattr(vecnorm, "epsilon", 1e-8)
        obs_rms = getattr(vecnorm, "obs_rms", None)
        if obs_rms is None:
            return obs
        normed = {}
        for k, v in obs.items():
            rms = obs_rms[k] if isinstance(obs_rms, dict) else obs_rms
            mean = np.asarray(getattr(rms, "mean", 0.0), dtype=np.float32)
            var = np.asarray(getattr(rms, "var", 1.0), dtype=np.float32)
            # reshape broadcast if needed
            normed[k] = (v.astype(np.float32) - mean) / np.sqrt(var + eps)
        return normed
    except Exception:
        return obs


app = Flask(__name__)
if CORS is not None:
    CORS(app, resources={r"/*": {"origins": "*"}})

# Always add permissive CORS headers (fallback if flask-cors not installed)
@app.after_request
def add_cors_headers(response):
    response.headers.setdefault("Access-Control-Allow-Origin", "*")
    response.headers.setdefault("Access-Control-Allow-Headers", "Content-Type, Authorization")
    response.headers.setdefault("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    return response


@app.route("/health", methods=["GET"])  # simple readiness probe
def health() -> Any:
    ok = os.path.isfile(MODEL_PATH)
    return jsonify({"ok": ok, "model_path": MODEL_PATH, "vecnorm": bool(vecnorm is not None)})


@app.route("/predict", methods=["POST"])  # expects JSON with obs fields
def predict() -> Any:
    try:
        payload: Dict[str, Any] = request.get_json(force=True)  # type: ignore
    except Exception:
        return jsonify({"error": "invalid JSON"}), 400

    jaw_angle = float(payload.get("jaw_angle", 0.2))
    prev_action = float(payload.get("prev_action", 0.0))
    radius_m = float(payload.get("radius_m", 0.0020))
    thickness = float(payload.get("thickness_factor", 1.0))
    deterministic = bool(payload.get("deterministic", True))

    obs = {
        "observation": np.array([jaw_angle, prev_action, radius_m, thickness], dtype=np.float32),
        "achieved_goal": np.array([0.0], dtype=np.float32),
        "desired_goal": np.array([0.0], dtype=np.float32),
    }

    obs_in = maybe_normalize_obs(obs)

    try:
        action, _ = model.predict(obs_in, deterministic=deterministic)
        u = float(np.asarray(action, dtype=np.float32).reshape(-1)[0])
        target_angle = action_to_angle(u)
    except Exception as e:
        return jsonify({"error": f"prediction failed: {e.__class__.__name__}: {e}"}), 500

    return jsonify({
        "action": u,
        "target_jaw_angle_rad": target_angle,
        "target_jaw_angle_deg": target_angle * 180.0 / np.pi,
        "deterministic": deterministic,
        "normalized_obs": bool(vecnorm is not None),
    })


@app.route("/predict", methods=["OPTIONS"])  # CORS preflight
def predict_options() -> Any:
    return ("", 204)


@app.route("/predict_batch", methods=["POST"])  # batch inference for many angles
def predict_batch() -> Any:
    try:
        payload: Dict[str, Any] = request.get_json(force=True)  # type: ignore
    except Exception:
        return jsonify({"error": "invalid JSON"}), 400

    angles = payload.get("jaw_angles", None)
    if angles is None:
        return jsonify({"error": "missing jaw_angles"}), 400
    try:
        jaw_angles = np.asarray(angles, dtype=np.float32).reshape(-1)
    except Exception:
        return jsonify({"error": "jaw_angles must be a list of floats"}), 400

    prev_action = float(payload.get("prev_action", 0.0))
    radius_m = float(payload.get("radius_m", 0.0020))
    thickness = float(payload.get("thickness_factor", 1.0))
    deterministic = bool(payload.get("deterministic", True))

    # Build batched dict observation
    n = jaw_angles.shape[0]
    obs = {
        "observation": np.stack([
            jaw_angles,
            np.full(n, prev_action, dtype=np.float32),
            np.full(n, radius_m, dtype=np.float32),
            np.full(n, thickness, dtype=np.float32),
        ], axis=1).astype(np.float32),
        "achieved_goal": np.zeros((n, 1), dtype=np.float32),
        "desired_goal": np.zeros((n, 1), dtype=np.float32),
    }

    obs_in = maybe_normalize_obs(obs)

    try:
        actions, _ = model.predict(obs_in, deterministic=deterministic)
        actions = np.asarray(actions, dtype=np.float32).reshape(-1)
        targets = np.array([action_to_angle(u) for u in actions], dtype=np.float32)
    except Exception as e:
        return jsonify({"error": f"prediction failed: {e.__class__.__name__}: {e}"}), 500

    return jsonify({
        "actions": actions.tolist(),
        "target_jaw_angle_rad": targets.tolist(),
        "deterministic": deterministic,
        "normalized_obs": bool(vecnorm is not None),
        "count": int(n),
    })


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    app.run(host="0.0.0.0", port=port, debug=False)
