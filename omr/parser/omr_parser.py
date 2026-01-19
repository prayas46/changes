from __future__ import annotations

import collections
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np


DEFAULT_TEMPLATE_WIDTH = 2480
DEFAULT_TEMPLATE_HEIGHT = 3508


class BubbleClassifier:
    def __init__(self) -> None:
        pass

    def predict_probs(self, patches: np.ndarray) -> np.ndarray:
        means = patches[:, 4:-4, 4:-4, :].mean(axis=(1, 2, 3))
        probs = 1.0 - means
        return probs


def load_and_align(path: str, template_width: int, template_height: int) -> np.ndarray:
    img = cv2.imread(path, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError(f"Cannot read image: {path}")

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    aligned = cv2.resize(gray, (int(template_width), int(template_height)))
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
    patch = np.expand_dims(patch, axis=-1)
    return patch


def _pick_mode_int(values: List[int]) -> Optional[int]:
    if not values:
        return None
    counter = collections.Counter(values)
    return int(counter.most_common(1)[0][0])


def normalize_bubble_centers(raw: object) -> Dict[int, Dict[str, Tuple[int, int]]]:
    if not isinstance(raw, dict):
        raise ValueError("bubbleCenters must be an object")

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


def learn_bubble_centers_from_image(aligned_gray: np.ndarray) -> Dict[int, Dict[str, Tuple[int, int]]]:
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
    current_mean_y: Optional[float] = None
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
        x_diffs = [float(row_sorted_x[i + 1][0] - row_sorted_x[i][0]) for i in range(len(row_sorted_x) - 1)]
        pos_diffs = [d for d in x_diffs if d > 0]
        median_x_diff = float(np.median(pos_diffs)) if pos_diffs else 25.0
        gap_thresh = max(median_x_diff * 2.8, float(aligned_gray.shape[1]) * 0.035)

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

    segment_counts = [len([seg for seg in row if len(seg) >= options_count]) for row in segmented_rows]
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
                opt: (int(round(seg[i][0])), int(round(seg[i][1]))) for i, opt in enumerate(option_letters)
            }

    return bubble_centers


def infer_bubbles(
    aligned_img: np.ndarray,
    bubble_centers: Dict[int, Dict[str, Tuple[int, int]]],
) -> List[dict]:
    patches: List[np.ndarray] = []
    meta: List[Tuple[int, str, int, int]] = []

    for q_num, options in bubble_centers.items():
        for opt, (x, y) in options.items():
            patch = crop_patch(aligned_img, (x, y))
            patches.append(patch)
            meta.append((int(q_num), str(opt), int(x), int(y)))

    if not patches:
        return []

    batch = np.stack(patches, axis=0)
    classifier = BubbleClassifier()
    probs = classifier.predict_probs(batch)

    results: List[dict] = []
    for (q_num, opt, x, y), p in zip(meta, probs):
        results.append(
            {
                "questionNumber": int(q_num),
                "option": str(opt).upper(),
                "centerX": float(x),
                "centerY": float(y),
                "confidence": float(p),
            }
        )

    return results


def build_answer_key_json(bubble_results: List[dict], selection_threshold: float = 0.25) -> List[dict]:
    by_q: Dict[int, List[dict]] = {}
    for r in bubble_results:
        by_q.setdefault(int(r["questionNumber"]), []).append(r)

    answer_key: List[dict] = []
    for q, arr in by_q.items():
        best = max(arr, key=lambda x: float(x.get("confidence", 0.0)))
        if float(best.get("confidence", 0.0)) < float(selection_threshold):
            continue
        answer_key.append({"questionNumber": int(q), "correctOption": str(best["option"]).upper()})

    return answer_key


def build_student_answers_json(bubble_results: List[dict], selection_threshold: float = 0.25) -> List[dict]:
    by_q: Dict[int, List[dict]] = {}
    for r in bubble_results:
        by_q.setdefault(int(r["questionNumber"]), []).append(r)

    student_answers: List[dict] = []
    for q, arr in by_q.items():
        best = max(arr, key=lambda x: float(x.get("confidence", 0.0)))
        selected = str(best["option"]).upper() if float(best.get("confidence", 0.0)) >= float(selection_threshold) else None

        student_answers.append(
            {
                "questionNumber": int(q),
                "selectedOption": selected,
                "centerX": float(best["centerX"]),
                "centerY": float(best["centerY"]),
                "confidence": float(best["confidence"]),
            }
        )

    return student_answers
