const DEFAULT_NEET_SCORING_CONFIG = {
  marksPerCorrect: 4,
  marksPerWrong: -1,
  marksPerUnattempted: 0,
  totalQuestions: 180,
  totalMarks: 720,
  sections: [
    { name: "Physics", startQuestion: 1, endQuestion: 50 },
    { name: "Chemistry", startQuestion: 51, endQuestion: 100 },
    { name: "Biology", startQuestion: 101, endQuestion: 180 },
  ],
};

const normalizeNumber = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const normalizeScoringConfig = (scoringConfig) => {
  const cfg =
    scoringConfig && typeof scoringConfig === "object" ? scoringConfig : {};
  const sections =
    Array.isArray(cfg.sections) && cfg.sections.length > 0
      ? cfg.sections
      : DEFAULT_NEET_SCORING_CONFIG.sections;

  return {
    marksPerCorrect: normalizeNumber(
      cfg.marksPerCorrect,
      DEFAULT_NEET_SCORING_CONFIG.marksPerCorrect
    ),
    marksPerWrong: normalizeNumber(
      cfg.marksPerWrong,
      DEFAULT_NEET_SCORING_CONFIG.marksPerWrong
    ),
    marksPerUnattempted: normalizeNumber(
      cfg.marksPerUnattempted,
      DEFAULT_NEET_SCORING_CONFIG.marksPerUnattempted
    ),
    totalQuestions: normalizeNumber(
      cfg.totalQuestions,
      DEFAULT_NEET_SCORING_CONFIG.totalQuestions
    ),
    totalMarks: normalizeNumber(
      cfg.totalMarks,
      DEFAULT_NEET_SCORING_CONFIG.totalMarks
    ),
    sections,
  };
};

const getSectionName = (questionNumber, sections) => {
  for (const section of sections || []) {
    const start = Number(section?.startQuestion);
    const end = Number(section?.endQuestion);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      continue;
    }
    if (questionNumber >= start && questionNumber <= end) {
      const name = section?.name != null ? String(section.name) : "General";
      return name || "General";
    }
  }
  return "General";
};

export const evaluateOmr = ({ answerKey, studentAnswers, scoringConfig }) => {
  const cfg = normalizeScoringConfig(scoringConfig);

  const answerKeyMap = new Map();
  for (const item of answerKey || []) {
    const questionNumber = Number(item?.questionNumber);
    if (!Number.isFinite(questionNumber)) {
      continue;
    }
    const correctOption =
      item?.correctOption != null
        ? String(item.correctOption).toUpperCase()
        : null;
    if (!correctOption) {
      continue;
    }
    answerKeyMap.set(questionNumber, correctOption);
  }

  const studentMap = new Map();
  for (const item of studentAnswers || []) {
    const questionNumber = Number(item?.questionNumber);
    if (!Number.isFinite(questionNumber)) {
      continue;
    }
    const selectedOption =
      item?.selectedOption != null
        ? String(item.selectedOption).toUpperCase()
        : null;
    studentMap.set(questionNumber, { ...item, questionNumber, selectedOption });
  }

  const sections = cfg.sections || [];
  const sectionStatsMap = new Map();
  const ensureSection = (name) => {
    const key = name || "General";
    if (!sectionStatsMap.has(key)) {
      sectionStatsMap.set(key, {
        marks: 0,
        correctCount: 0,
        incorrectCount: 0,
        unattemptedCount: 0,
      });
    }
    return sectionStatsMap.get(key);
  };

  let totalMarks = 0;
  let correctCount = 0;
  let incorrectCount = 0;
  let unattemptedCount = 0;
  const wrongQuestions = [];

  for (const [questionNumber, correctOption] of answerKeyMap.entries()) {
    const subject = getSectionName(questionNumber, sections);
    const stats = ensureSection(subject);
    const studentEntry = studentMap.get(questionNumber);

    if (!studentEntry || !studentEntry.selectedOption) {
      unattemptedCount += 1;
      const delta = Number(cfg.marksPerUnattempted);
      totalMarks += delta;
      stats.unattemptedCount += 1;
      stats.marks += delta;
      continue;
    }

    if (studentEntry.selectedOption === correctOption) {
      correctCount += 1;
      const delta = Number(cfg.marksPerCorrect);
      totalMarks += delta;
      stats.correctCount += 1;
      stats.marks += delta;
    } else {
      incorrectCount += 1;
      const delta = Number(cfg.marksPerWrong);
      totalMarks += delta;
      stats.incorrectCount += 1;
      stats.marks += delta;

      wrongQuestions.push({
        questionNumber,
        subject,
        selectedOption: studentEntry.selectedOption,
        correctOption,
      });
    }
  }

  const sectionMarks = sections.map((s) => {
    const name = s?.name != null ? String(s.name) : "General";
    const stats = ensureSection(name);
    return {
      name,
      marks: stats.marks,
      correctCount: stats.correctCount,
      incorrectCount: stats.incorrectCount,
      unattemptedCount: stats.unattemptedCount,
    };
  });

  const totalPossibleMarks = answerKeyMap.size * Number(cfg.marksPerCorrect);

  const physicsMarks = ensureSection("Physics").marks;
  const chemistryMarks = ensureSection("Chemistry").marks;
  const biologyMarks = ensureSection("Biology").marks;

  return {
    physicsMarks,
    chemistryMarks,
    biologyMarks,
    totalMarks,
    totalPossibleMarks,
    correctCount,
    incorrectCount,
    unattemptedCount,
    wrongQuestions,
    sectionMarks,
  };
};

export const evaluateNeetOMR = ({ answerKey, studentAnswers }) => {
  return evaluateOmr({
    answerKey,
    studentAnswers,
    scoringConfig: DEFAULT_NEET_SCORING_CONFIG,
  });
};
