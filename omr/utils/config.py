import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Union


def load_json(path: Union[str, Path]) -> Any:
    p = Path(path)
    with p.open("r", encoding="utf-8") as f:
        return json.load(f)


def as_number(value: Any, default: float) -> float:
    try:
        n = float(value)
    except Exception:
        return float(default)
    return float(n)


def as_int(value: Any, default: int) -> int:
    try:
        n = int(value)
    except Exception:
        return int(default)
    return int(n)


def normalize_scoring_config(raw: Any) -> Dict[str, Any]:
    cfg = raw if isinstance(raw, dict) else {}

    marks_per_correct = as_number(cfg.get("marksPerCorrect"), 4.0)

    if "marksPerWrong" in cfg:
        marks_per_wrong = as_number(cfg.get("marksPerWrong"), -1.0)
    else:
        negative = as_number(cfg.get("negativeMarking"), 1.0)
        marks_per_wrong = -abs(float(negative))

    marks_per_unattempted = as_number(cfg.get("marksPerUnattempted"), 0.0)

    total_questions = as_int(cfg.get("totalQuestions"), 180)

    return {
        "marksPerCorrect": marks_per_correct,
        "marksPerWrong": marks_per_wrong,
        "marksPerUnattempted": marks_per_unattempted,
        "totalQuestions": total_questions,
    }


def pick_first_path(cfg: Dict[str, Any], keys: List[str]) -> Optional[str]:
    for k in keys:
        v = cfg.get(k)
        if isinstance(v, str) and v.strip():
            return v
    return None
