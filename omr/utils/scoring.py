from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

from .neet_mapping import NEET_SECTIONS


@dataclass
class Counts:
    correct: int = 0
    incorrect: int = 0
    unattempted: int = 0


def _normalize_answer_key(answer_key: Any) -> Dict[int, str]:
    if isinstance(answer_key, dict):
        out: Dict[int, str] = {}
        for k, v in answer_key.items():
            try:
                q = int(k)
            except Exception:
                continue
            if v is None:
                continue
            out[q] = str(v).strip().upper()
        return out

    if isinstance(answer_key, list):
        out = {}
        for item in answer_key:
            if not isinstance(item, dict):
                continue
            q = item.get("questionNumber")
            c = item.get("correctOption")
            try:
                qn = int(q)
            except Exception:
                continue
            if c is None:
                continue
            out[qn] = str(c).strip().upper()
        return out

    return {}


def _normalize_student_answers(student_answers: Any) -> Dict[int, Optional[str]]:
    if isinstance(student_answers, dict):
        out: Dict[int, Optional[str]] = {}
        for k, v in student_answers.items():
            try:
                q = int(k)
            except Exception:
                continue
            if v is None:
                out[q] = None
            else:
                s = str(v).strip().upper()
                out[q] = s if s else None
        return out

    if isinstance(student_answers, list):
        out: Dict[int, Optional[str]] = {}
        for item in student_answers:
            if not isinstance(item, dict):
                continue
            q = item.get("questionNumber")
            s = item.get("selectedOption")
            try:
                qn = int(q)
            except Exception:
                continue
            if s is None:
                out[qn] = None
            else:
                ss = str(s).strip().upper()
                out[qn] = ss if ss else None
        return out

    return {}


def evaluate_neet(
    answer_key_raw: Any,
    student_answers_raw: Any,
    scoring_cfg: Dict[str, Any],
    question_to_subject: Dict[int, str],
) -> Dict[str, Any]:
    answer_key = _normalize_answer_key(answer_key_raw)
    student_answers = _normalize_student_answers(student_answers_raw)

    marks_per_correct = float(scoring_cfg["marksPerCorrect"])
    marks_per_wrong = float(scoring_cfg["marksPerWrong"])
    marks_per_unattempted = float(scoring_cfg["marksPerUnattempted"])

    subject_stats: Dict[str, Dict[str, Any]] = {}

    def ensure_subject(name: str) -> Dict[str, Any]:
        if name not in subject_stats:
            subject_stats[name] = {
                "marks": 0.0,
                "correctCount": 0,
                "incorrectCount": 0,
                "unattemptedCount": 0,
            }
        return subject_stats[name]

    counts = Counts()
    wrong_questions: List[Dict[str, Any]] = []

    total_score = 0.0

    for qn, correct in sorted(answer_key.items(), key=lambda x: x[0]):
        subject = question_to_subject.get(int(qn), "General")
        stats = ensure_subject(subject)

        selected = student_answers.get(int(qn))
        if not selected:
            counts.unattempted += 1
            stats["unattemptedCount"] += 1
            stats["marks"] += marks_per_unattempted
            total_score += marks_per_unattempted
            continue

        if selected == correct:
            counts.correct += 1
            stats["correctCount"] += 1
            stats["marks"] += marks_per_correct
            total_score += marks_per_correct
        else:
            counts.incorrect += 1
            stats["incorrectCount"] += 1
            stats["marks"] += marks_per_wrong
            total_score += marks_per_wrong
            wrong_questions.append(
                {
                    "questionNumber": int(qn),
                    "subject": subject,
                    "selectedOption": selected,
                    "correctOption": correct,
                }
            )

    subject_wise_marks = {
        "Physics": subject_stats.get("Physics", {"marks": 0.0, "correctCount": 0, "incorrectCount": 0, "unattemptedCount": 0}),
        "Chemistry": subject_stats.get("Chemistry", {"marks": 0.0, "correctCount": 0, "incorrectCount": 0, "unattemptedCount": 0}),
        "Biology": subject_stats.get("Biology", {"marks": 0.0, "correctCount": 0, "incorrectCount": 0, "unattemptedCount": 0}),
    }

    section_wise_marks: List[Dict[str, Any]] = []
    for sec in NEET_SECTIONS:
        subj = sec["subject"]
        sec_stats = subject_wise_marks.get(subj, {"marks": 0.0, "correctCount": 0, "incorrectCount": 0, "unattemptedCount": 0})
        section_wise_marks.append(
            {
                "name": sec["name"],
                "subject": subj,
                "marks": float(sec_stats.get("marks", 0.0)),
                "correctCount": int(sec_stats.get("correctCount", 0)),
                "incorrectCount": int(sec_stats.get("incorrectCount", 0)),
                "unattemptedCount": int(sec_stats.get("unattemptedCount", 0)),
            }
        )

    total_possible = len(answer_key) * marks_per_correct

    return {
        "sectionWiseMarks": section_wise_marks,
        "subjectWiseMarks": {
            "Physics": subject_wise_marks["Physics"],
            "Chemistry": subject_wise_marks["Chemistry"],
            "Biology": subject_wise_marks["Biology"],
        },
        "totalScore": float(total_score),
        "totalPossible": float(total_possible),
        "correctCount": int(counts.correct),
        "incorrectCount": int(counts.incorrect),
        "unattemptedCount": int(counts.unattempted),
        "wrongQuestions": wrong_questions,
    }
