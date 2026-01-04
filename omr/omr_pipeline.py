"""OMR processing pipeline for NEET‑style sheets.

Responsibilities:
- Load a scanned OMR image (answer key or student sheet).
- Preprocess and roughly align it to a fixed template size.
- For each bubble position defined in `bubble_map.BUBBLE_CENTERS`, crop a
  small patch and classify it as filled/empty.
- Build `answerKey` / `studentAnswers` JSON compatible with the
  Node.js backend `/exam/evaluate/:submissionId` endpoint.

The classifier supports two modes:
- Simple intensity heuristic (no ML dependencies, default).
- Optional CNN mode if a TensorFlow/Keras model file is provided and
  `tensorflow` is installed.
"""

import argparse
import collections
import json
import os
from typing import Dict, List, Tuple

import cv2
import numpy as np
import requests

try:
    # Optional dependency – only used if a model path is provided
    from tensorflow.keras.models import load_model  # type: ignore
except Exception:  # tensorflow not installed
    load_model = None  # type: ignore

from bubble_map import BUBBLE_CENTERS

TEMPLATE_WIDTH = 2480   # example A4 @ 300dpi
TEMPLATE_HEIGHT = 3508


class BubbleClassifier:
    """Classifies bubble patches as filled or empty.

    If a Keras model path is provided and can be loaded, uses that CNN.
    Otherwise falls back to a simple intensity‑based heuristic.
    """

    def __init__(self, model_path: str | None = None, threshold: float = 0.5) -> None:
        self.threshold = threshold
        self.model = None
        self.use_cnn = False

        if model_path and load_model is not None and os.path.exists(model_path):
            try:
                self.model = load_model(model_path)
                self.use_cnn = True
            except Exception:
                # Fall back to heuristic if model cannot be loaded
                self.model = None
                self.use_cnn = False

    def predict_probs(self, patches: np.ndarray) -> np.ndarray:
        """Return probability of being filled for each patch.

        patches: (N, H, W, 1) float32 in [0, 1]
        """

        if self.use_cnn and self.model is not None:
            preds = self.model.predict(patches, verbose=0)
            preds = np.array(preds).reshape(-1)
            return preds

        # Heuristic mode: darker patches -> higher probability of being filled
        # Compute mean intensity per patch and invert.
        means = patches[:, 4:-4, 4:-4, :].mean(axis=(1, 2, 3))  # (N,)
        probs = 1.0 - means  # darker -> closer to 1
        return probs


def load_and_align(path: str) -> np.ndarray:
    img = cv2.imread(path, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError(f"Cannot read image: {path}")

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    aligned = cv2.resize(gray, (TEMPLATE_WIDTH, TEMPLATE_HEIGHT))
    return aligned


def crop_patch(img: np.ndarray, center: Tuple[int, int], size: int = 28) -> np.ndarray:
    cx, cy = center
    half = size // 2
    x1 = int(cx - half)
    y1 = int(cy - half)
    x2 = int(cx + half)
    y2 = int(cy + half)
    patch = img[y1:y2, x1:x2]
    if patch.shape != (size, size):
        patch = cv2.resize(patch, (size, size))
    patch = patch.astype("float32") / 255.0
    patch = np.expand_dims(patch, axis=-1)  # (H, W, 1)
    return patch


def _cluster_sorted_1d(values: List[float], tol: float) -> List[List[float]]:
    if not values:
        return []
    values_sorted = sorted(values)
    clusters: List[List[float]] = []
    current: List[float] = [values_sorted[0]]
    current_mean = float(values_sorted[0])
    for v in values_sorted[1:]:
        if abs(float(v) - current_mean) <= tol:
            current.append(float(v))
            current_mean = float(sum(current) / len(current))
        else:
            clusters.append(current)
            current = [float(v)]
            current_mean = float(v)
    clusters.append(current)
    return clusters


def _pick_mode_int(values: List[int]) -> int | None:
    if not values:
        return None
    counter = collections.Counter(values)
    return int(counter.most_common(1)[0][0])


def _normalize_bubble_centers(raw: object) -> Dict[int, Dict[str, Tuple[int, int]]]:
    if not isinstance(raw, dict):
        raise ValueError("bubble-map JSON must be an object")

    normalized: Dict[int, Dict[str, Tuple[int, int]]] = {}
    for q_key, options in raw.items():
        try:
            q_num = int(q_key)
        except Exception:
            continue

        if not isinstance(options, dict):
            continue

        opt_map: Dict[str, Tuple[int, int]] = {}
        for opt_key, pt in options.items():
            opt = str(opt_key).upper()
            if not isinstance(pt, (list, tuple)) or len(pt) != 2:
                continue
            try:
                x = int(float(pt[0]))
                y = int(float(pt[1]))
            except Exception:
                continue
            opt_map[opt] = (x, y)

        if opt_map:
            normalized[q_num] = opt_map

    return normalized


def learn_bubble_centers_from_image(
    aligned_gray: np.ndarray,
) -> Dict[int, Dict[str, Tuple[int, int]]]:
    blur = cv2.GaussianBlur(aligned_gray, (5, 5), 0)
    _, thresh = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    thresh = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel, iterations=1)
    thresh = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel, iterations=1)

    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    candidates: List[Tuple[float, float, float, int, int]] = []
    for c in contours:
        area = float(cv2.contourArea(c))
        if area <= 0:
            continue
        x, y, w, h = cv2.boundingRect(c)
        if w <= 0 or h <= 0:
            continue
        aspect = float(w) / float(h)
        if aspect < 0.65 or aspect > 1.35:
            continue
        per = float(cv2.arcLength(c, True))
        if per <= 0:
            continue
        circ = float(4.0 * np.pi * area / (per * per))
        if circ < 0.25:
            continue
        cx = float(x) + float(w) / 2.0
        cy = float(y) + float(h) / 2.0
        candidates.append((cx, cy, area, int(w), int(h)))

    if not candidates:
        return {}

    areas = np.array([c[2] for c in candidates], dtype=np.float32)
    med_area = float(np.median(areas))
    min_area = max(25.0, med_area * 0.35)
    max_area = med_area * 3.0

    centers: List[Tuple[float, float]] = []
    for cx, cy, area, w, h in candidates:
        if area < min_area or area > max_area:
            continue
        if min(w, h) < 8:
            continue
        centers.append((cx, cy))

    if not centers:
        return {}

    ys = sorted([c[1] for c in centers])
    y_diffs = [ys[i + 1] - ys[i] for i in range(len(ys) - 1) if ys[i + 1] > ys[i]]
    median_y_diff = float(np.median(y_diffs)) if y_diffs else 25.0
    row_tol = max(6.0, median_y_diff * 0.55)

    centers_sorted_y = sorted(centers, key=lambda p: p[1])
    rows: List[List[Tuple[float, float]]] = []
    current: List[Tuple[float, float]] = []
    current_mean_y: float | None = None
    for pt in centers_sorted_y:
        if current_mean_y is None:
            current = [pt]
            current_mean_y = float(pt[1])
            continue
        if abs(float(pt[1]) - current_mean_y) <= row_tol:
            current.append(pt)
            current_mean_y = float(sum(p[1] for p in current) / len(current))
        else:
            rows.append(current)
            current = [pt]
            current_mean_y = float(pt[1])
    if current:
        rows.append(current)

    segmented_rows: List[List[List[Tuple[float, float]]]] = []
    for row in rows:
        row_sorted_x = sorted(row, key=lambda p: p[0])
        if len(row_sorted_x) <= 1:
            continue
        x_diffs = [
            float(row_sorted_x[i + 1][0] - row_sorted_x[i][0])
            for i in range(len(row_sorted_x) - 1)
        ]
        pos_diffs = [d for d in x_diffs if d > 0]
        median_x_diff = float(np.median(pos_diffs)) if pos_diffs else 25.0
        gap_thresh = max(median_x_diff * 2.8, float(TEMPLATE_WIDTH) * 0.035)

        segments: List[List[Tuple[float, float]]] = []
        seg: List[Tuple[float, float]] = [row_sorted_x[0]]
        for idx, d in enumerate(x_diffs):
            if float(d) > gap_thresh:
                segments.append(seg)
                seg = [row_sorted_x[idx + 1]]
            else:
                seg.append(row_sorted_x[idx + 1])
        segments.append(seg)
        segments = [s for s in segments if len(s) >= 2]
        if segments:
            segmented_rows.append(segments)

    if not segmented_rows:
        return {}

    segment_sizes = [len(seg) for row in segmented_rows for seg in row if len(seg) > 1]
    options_count = _pick_mode_int(segment_sizes)
    if not options_count or options_count < 2:
        return {}

    segment_counts = [
        len([seg for seg in row if len(seg) >= options_count]) for row in segmented_rows
    ]
    col_count = _pick_mode_int([c for c in segment_counts if c > 0])
    if not col_count or col_count < 1:
        return {}

    filtered_rows: List[List[List[Tuple[float, float]]]] = []
    for row in segmented_rows:
        good = [seg for seg in row if len(seg) >= options_count]
        if len(good) == col_count:
            filtered_rows.append(good)

    if not filtered_rows:
        return {}

    option_letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[:options_count]
    bubble_centers: Dict[int, Dict[str, Tuple[int, int]]] = {}
    row_count = len(filtered_rows)

    for col_idx in range(col_count):
        for row_idx, row in enumerate(filtered_rows):
            seg = sorted(row[col_idx], key=lambda p: p[0])[:options_count]
            q_num = int(col_idx * row_count + row_idx + 1)
            bubble_centers[q_num] = {
                opt: (int(round(seg[i][0])), int(round(seg[i][1])))
                for i, opt in enumerate(option_letters)
            }

    return bubble_centers


def infer_bubbles(
    classifier: BubbleClassifier,
    aligned_img: np.ndarray,
    bubble_centers: Dict[int, Dict[str, Tuple[int, int]]] | None = None,
    prob_threshold: float = 0.0,
) -> List[Dict]:
    """Infer which bubbles are filled.

    Returns a list of dicts with
    {questionNumber, option, centerX, centerY, confidence}.
    """

    patches: List[np.ndarray] = []
    meta: List[Tuple[int, str, int, int]] = []

    centers = BUBBLE_CENTERS if bubble_centers is None else bubble_centers
    for q_num, options in centers.items():
        for opt, (x, y) in options.items():
            patch = crop_patch(aligned_img, (x, y))
            patches.append(patch)
            meta.append((int(q_num), str(opt), int(x), int(y)))

    if not patches:
        return []

    batch = np.stack(patches, axis=0)  # (N, H, W, 1)
    probs = classifier.predict_probs(batch)

    results: List[Dict] = []
    for (q_num, opt, x, y), p in zip(meta, probs):
        if float(p) < prob_threshold:
            continue
        results.append(
            {
                "questionNumber": q_num,
                "option": opt,
                "centerX": float(x),
                "centerY": float(y),
                "confidence": float(p),
            }
        )

    return results


def build_answer_key_json(bubble_results: List[Dict]) -> List[Dict]:
    by_q: Dict[int, List[Dict]] = {}
    for r in bubble_results:
        q = int(r["questionNumber"])
        by_q.setdefault(q, []).append(r)

    answer_key: List[Dict] = []
    for q, arr in by_q.items():
        best = max(arr, key=lambda x: x.get("confidence", 0.0))
        if float(best.get("confidence", 0.0)) < 0.25:
            continue
        answer_key.append(
            {
                "questionNumber": q,
                "correctOption": str(best["option"]).upper(),
            }
        )
    return answer_key


def build_student_answers_json(
    bubble_results: List[Dict],
    selection_threshold: float = 0.25,
) -> List[Dict]:
    by_q: Dict[int, List[Dict]] = {}
    for r in bubble_results:
        q = int(r["questionNumber"])
        by_q.setdefault(q, []).append(r)

    student_answers: List[Dict] = []
    for q, arr in by_q.items():
        best = max(arr, key=lambda x: x.get("confidence", 0.0))
        selected = (
            str(best["option"]).upper()
            if float(best.get("confidence", 0.0)) >= selection_threshold
            else None
        )
        student_answers.append(
            {
                "questionNumber": q,
                "selectedOption": selected,
                "centerX": float(best["centerX"]),
                "centerY": float(best["centerY"]),
                "confidence": float(best["confidence"]),
            }
        )
    return student_answers


def process_answer_key(
    image_path: str,
    model_path: str | None = None,
    bubble_centers: Dict[int, Dict[str, Tuple[int, int]]] | None = None,
) -> List[Dict]:
    aligned = load_and_align(image_path)
    centers = bubble_centers
    if centers is None:
        centers = learn_bubble_centers_from_image(aligned)
    if not centers:
        raise ValueError("Failed to detect bubble centers from the provided OMR template")
    classifier = BubbleClassifier(model_path=model_path)
    bubbles = infer_bubbles(classifier, aligned, bubble_centers=centers)
    return build_answer_key_json(bubbles)


def process_student_omr(
    image_path: str,
    model_path: str | None = None,
    bubble_centers: Dict[int, Dict[str, Tuple[int, int]]] | None = None,
) -> List[Dict]:
    aligned = load_and_align(image_path)
    centers = bubble_centers
    if centers is None:
        centers = learn_bubble_centers_from_image(aligned)
    if not centers:
        raise ValueError("Failed to detect bubble centers from the provided OMR template")
    classifier = BubbleClassifier(model_path=model_path)
    bubbles = infer_bubbles(classifier, aligned, bubble_centers=centers)
    return build_student_answers_json(bubbles)


def call_backend_evaluate(
    submission_id: str,
    answer_key: List[Dict],
    student_answers: List[Dict],
    api_base: str,
    token: str | None = None,
) -> Dict:
    url = f"{api_base}/exam/evaluate/{submission_id}"
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    payload = {"answerKey": answer_key, "studentAnswers": student_answers}
    resp = requests.post(url, headers=headers, data=json.dumps(payload))
    resp.raise_for_status()
    return resp.json()


def main() -> None:
    parser = argparse.ArgumentParser(description="NEET OMR processing pipeline")
    parser.add_argument(
        "--mode", choices=["answer_key", "student", "template"], required=True
    )
    parser.add_argument("--image", required=True, help="Path to scanned OMR image")
    parser.add_argument("--model", help="Optional Keras model .h5 path", default=None)
    parser.add_argument("--bubble-map", help="Optional bubble-map JSON file")
    parser.add_argument("--submission-id", help="If provided, call backend evaluate")
    parser.add_argument(
        "--api-base",
        default="http://localhost:8080/api/v1/examiner",
        help="Base URL for backend examiner API",
    )
    parser.add_argument(
        "--token",
        help="Optional bearer token if backend requires Authorization header",
    )

    args = parser.parse_args()

    try:
        bubble_centers: Dict[int, Dict[str, Tuple[int, int]]] | None = None
        if args.bubble_map:
            with open(args.bubble_map, "r", encoding="utf-8") as f:
                raw = json.load(f)
            if isinstance(raw, dict) and "bubbleCenters" in raw:
                raw = raw.get("bubbleCenters")
            bubble_centers = _normalize_bubble_centers(raw)

        if args.mode == "template":
            aligned = load_and_align(args.image)
            detected = learn_bubble_centers_from_image(aligned)
            if not detected:
                raise ValueError(
                    "Failed to detect bubble centers from the provided OMR template"
                )
            print(json.dumps(detected, indent=2))
            return

        if args.mode == "answer_key":
            answer_key = process_answer_key(
                args.image, model_path=args.model, bubble_centers=bubble_centers
            )
            print(json.dumps(answer_key, indent=2))
        else:
            student_answers = process_student_omr(
                args.image, model_path=args.model, bubble_centers=bubble_centers
            )
            print(json.dumps(student_answers, indent=2))

            if args.submission_id:
                raise SystemExit(
                    "submission-id provided but answerKey loading is not implemented in this CLI."
                )
    except Exception as e:
        raise SystemExit(str(e))


if __name__ == "__main__":  # pragma: no cover
    main()
