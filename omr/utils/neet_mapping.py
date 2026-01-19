from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Iterable, List, Tuple

import numpy as np


NEET_COLUMN_TO_SUBJECT = {
    1: "Physics",
    2: "Chemistry",
    3: "Biology",
    4: "Biology",
}

NEET_SECTIONS = [
    {"name": "Section A", "subject": "Biology"},
    {"name": "Section B", "subject": "Chemistry"},
    {"name": "Section C", "subject": "Physics"},
]


@dataclass(frozen=True)
class ColumnInference:
    question_to_column: Dict[int, int]
    column_centers_x: List[float]


def _kmeans_1d(values: np.ndarray, k: int, iters: int = 25) -> Tuple[np.ndarray, np.ndarray]:
    if values.size == 0:
        raise ValueError("cannot cluster empty array")

    v = values.astype(np.float64)
    v_sorted = np.sort(v)

    if k <= 1:
        centers = np.array([float(np.mean(v_sorted))])
        labels = np.zeros_like(v_sorted, dtype=np.int32)
        return labels, centers

    quantiles = np.linspace(0, 1, num=k, endpoint=False) + (0.5 / k)
    centers = np.quantile(v_sorted, quantiles)

    labels = np.zeros_like(v_sorted, dtype=np.int32)
    for _ in range(iters):
        d = np.abs(v_sorted[:, None] - centers[None, :])
        new_labels = np.argmin(d, axis=1).astype(np.int32)

        if np.array_equal(new_labels, labels):
            break
        labels = new_labels

        for i in range(k):
            pts = v_sorted[labels == i]
            if pts.size > 0:
                centers[i] = float(np.mean(pts))

    return labels, centers


def infer_columns_from_bubble_centers(
    bubble_centers: Dict[int, Dict[str, Tuple[int, int]]],
    expected_columns: int = 4,
) -> ColumnInference:
    if not bubble_centers:
        return ColumnInference(question_to_column={}, column_centers_x=[])

    reps: List[Tuple[int, float]] = []
    for q, opt_map in bubble_centers.items():
        xs = [float(pt[0]) for pt in opt_map.values() if isinstance(pt, tuple) and len(pt) == 2]
        if not xs:
            continue
        reps.append((int(q), float(np.median(np.array(xs, dtype=np.float64)))))

    if not reps:
        return ColumnInference(question_to_column={}, column_centers_x=[])

    questions = np.array([q for q, _ in reps], dtype=np.int32)
    x_vals = np.array([x for _, x in reps], dtype=np.float64)

    uniq_x = np.unique(x_vals)
    k = min(int(expected_columns), int(uniq_x.size))

    labels_sorted, centers = _kmeans_1d(x_vals, k=k)

    order = np.argsort(centers)
    remap = {int(old): int(new + 1) for new, old in enumerate(order)}

    question_to_column: Dict[int, int] = {}
    for q, lab in zip(questions.tolist(), labels_sorted.tolist()):
        question_to_column[int(q)] = remap[int(lab)]

    sorted_centers = [float(c) for c in centers[order].tolist()]
    return ColumnInference(question_to_column=question_to_column, column_centers_x=sorted_centers)


def subject_for_question(
    question_number: int,
    question_to_column: Dict[int, int],
) -> str:
    col = question_to_column.get(int(question_number))
    if not col:
        return "General"
    return NEET_COLUMN_TO_SUBJECT.get(int(col), "General")


def build_section_subject_map() -> Dict[str, str]:
    return {s["name"]: s["subject"] for s in NEET_SECTIONS}
