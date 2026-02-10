# app.py
# Flask backend for Emotion Analysis using DeepFace
# Folder structure (recommended):
#   project/
#     app.py
#     templates/index.html
#     static/app.js
#
# Run:  python app.py
# Open: http://127.0.0.1:5000/

import os
import io
import base64
import time

import numpy as np
import cv2
from flask import Flask, request, jsonify, render_template, send_from_directory
from flask_cors import CORS
from deepface import DeepFace

app = Flask(__name__)
CORS(app)

# --------- Helpers ---------
def _bytes_to_ndarray(image_bytes: bytes):
    """Decode image bytes into a numpy BGR array (OpenCV)."""
    nparr = np.frombuffer(image_bytes, dtype=np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    return img

def _dominant_emotion_and_conf(result):
    """
    DeepFace.analyze may return dict or list of dicts (if multi-face).
    We’ll use the first entry and return dominant emotion and its confidence (%).
    """
    data = result[0] if isinstance(result, list) else result
    emotions = data.get("emotion") or data.get("emotions") or {}
    # DeepFace returns keys: angry, disgust, fear, happy, sad, surprise, neutral
    if not emotions:
        return None, 0.0
    dominant = data.get("dominant_emotion")
    if not dominant:
        # fallback if dominant_emotion missing
        dominant = max(emotions, key=emotions.get)
    conf = float(emotions.get(dominant, 0.0))
    # Some DeepFace versions already return probabilities (0-100). Normalize defensively.
    # If values look like 0..1, scale to 0..100.
    if conf <= 1.0:
        conf *= 100.0
    return dominant.lower(), conf

# --------- Routes ---------
@app.route("/", methods=["GET"])
def home():
    # Renders your uploaded index.html (place it under templates/)
    return render_template("index.html")

# Optional: serve static JS if needed (Flask's /static handles this already)
@app.route("/static/<path:filename>")
def static_files(filename):
    return send_from_directory("static", filename)

@app.route("/predict", methods=["POST"])
def predict():
    """
    Accepts: multipart/form-data with file field 'image'
    Returns: { success: bool, emotion: <string|None>, confidence: <float %>, error?: str }
    """
    try:
        if "image" not in request.files or request.files["image"].filename == "":
            return jsonify({"success": False, "error": "No image uploaded (field name 'image')."}), 400

        file_storage = request.files["image"]
        image_bytes = file_storage.read()
        img = _bytes_to_ndarray(image_bytes)
        if img is None:
            return jsonify({"success": False, "error": "Invalid image data."}), 400

        # Keep dependencies light: use OpenCV detector by default.
        # You can change to 'retinaface' if you have its deps installed.
        detector_backend = request.args.get("detector_backend", "opencv")

        started = time.time()
        result = DeepFace.analyze(
            img_path=img,                 # ndarray supported
            actions=["emotion"],
            enforce_detection=False,      # prevents hard crashes when no face is found
            align=True,
            detector_backend=detector_backend
        )
        elapsed_ms = round((time.time() - started) * 1000, 2)

        emotion, confidence = _dominant_emotion_and_conf(result)
        return jsonify({
            "success": True,
            "emotion": emotion,           # e.g., 'happy'
            "confidence": round(confidence, 2),  # percentage 0..100
            "time_ms": elapsed_ms
        }), 200

    except Exception as e:
        # Log e for debugging if needed
        return jsonify({"success": False, "error": f"Server error: {e}"}), 500


if __name__ == "__main__":
    # Make sure Flask can find templates/ and static/ where your index.html/app.js live.
    # If you keep a different layout, update the render/static paths above.
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "5000"))
    app.run(host=host, port=port, debug=True)
