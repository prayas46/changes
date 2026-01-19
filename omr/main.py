import argparse
import json
import os
import sys
from typing import Any, Dict

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(CURRENT_DIR)
if CURRENT_DIR not in sys.path:
    sys.path.insert(0, CURRENT_DIR)
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)


def main() -> None:
    parser = argparse.ArgumentParser(description="NEET OMR evaluator")
    parser.add_argument("--image", required=True, help="Path to filled OMR image")
    parser.add_argument("--config", required=True, help="Path to JSON config")

    args = parser.parse_args()

    from omr.parser.omr_parser import (  # noqa: E402
        DEFAULT_TEMPLATE_HEIGHT,
        DEFAULT_TEMPLATE_WIDTH,
        build_answer_key_json,
        build_student_answers_json,
        infer_bubbles,
        learn_bubble_centers_from_image,
        load_and_align,
        normalize_bubble_centers,
    )
    from omr.utils.config import (  # noqa: E402
        load_json,
        normalize_scoring_config,
        pick_first_path,
    )
    from omr.utils.neet_mapping import (  # noqa: E402
        infer_columns_from_bubble_centers,
        subject_for_question,
    )
    from omr.utils.scoring import evaluate_neet  # noqa: E402

    def _build_question_to_subject(bubble_centers: Dict[int, Dict[str, Any]]) -> Dict[int, str]:
        inference = infer_columns_from_bubble_centers(bubble_centers, expected_columns=4)
        out: Dict[int, str] = {}
        for qn in bubble_centers.keys():
            out[int(qn)] = subject_for_question(int(qn), inference.question_to_column)
        return out

    cfg = load_json(args.config)
    if not isinstance(cfg, dict):
        raise SystemExit("config must be a JSON object")

    template_w = int(cfg.get("templateWidth", DEFAULT_TEMPLATE_WIDTH))
    template_h = int(cfg.get("templateHeight", DEFAULT_TEMPLATE_HEIGHT))

    scoring_cfg = normalize_scoring_config(cfg.get("scoring") or cfg)

    selection_threshold = float(cfg.get("selectionThreshold", 0.25))

    bubble_centers_raw = cfg.get("bubbleCenters")
    bubble_centers = None
    if bubble_centers_raw:
        bubble_centers = normalize_bubble_centers(bubble_centers_raw)

    if not bubble_centers:
        template_path = pick_first_path(cfg, ["templateImage", "blankOmrImage", "answerKeyImage"])
        if not template_path:
            template_path = args.image
        aligned_template = load_and_align(template_path, template_width=template_w, template_height=template_h)
        bubble_centers = learn_bubble_centers_from_image(aligned_template)

    if not bubble_centers:
        raise SystemExit(
            "Failed to detect bubble centers. Provide bubbleCenters in config or a clear templateImage/answerKeyImage."
        )

    aligned_student = load_and_align(args.image, template_width=template_w, template_height=template_h)
    student_bubbles = infer_bubbles(aligned_student, bubble_centers=bubble_centers)
    student_answers = build_student_answers_json(student_bubbles, selection_threshold=selection_threshold)

    answer_key = cfg.get("answerKey")
    if not answer_key:
        ans_img_path = pick_first_path(cfg, ["answerKeyImage", "answerKeyOmrImage"]) 
        if not ans_img_path:
            raise SystemExit("config must include answerKey or answerKeyImage")
        aligned_key = load_and_align(ans_img_path, template_width=template_w, template_height=template_h)
        key_bubbles = infer_bubbles(aligned_key, bubble_centers=bubble_centers)
        answer_key = build_answer_key_json(key_bubbles, selection_threshold=selection_threshold)

    question_to_subject = _build_question_to_subject(bubble_centers)

    evaluation = evaluate_neet(
        answer_key_raw=answer_key,
        student_answers_raw=student_answers,
        scoring_cfg=scoring_cfg,
        question_to_subject=question_to_subject,
    )

    output = {
        **evaluation,
        "answerKey": answer_key,
        "studentAnswers": student_answers,
        "bubbleCenters": bubble_centers,
    }

    print(json.dumps(output))


if __name__ == "__main__":
    main()
