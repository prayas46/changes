const DEFAULT_NEET_SCORING_CONFIG = {
  marksPerCorrect: 4,
  marksPerWrong: -1,
  marksPerUnattempted: 0,
  totalQuestions: 180,
  totalMarks: 720,
  sections: [
    { name: "Physics", startQuestion: 1, endQuestion: 45 },
    { name: "Chemistry", startQuestion: 46, endQuestion: 90 },
    { name: "Biology", startQuestion: 91, endQuestion: 180 },
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
      DEFAULT_NEET_SCORING_CONFIG.marksPerCorrect,
    ),
    marksPerWrong: normalizeNumber(
      cfg.marksPerWrong,
      DEFAULT_NEET_SCORING_CONFIG.marksPerWrong,
    ),
    marksPerUnattempted: normalizeNumber(
      cfg.marksPerUnattempted,
      DEFAULT_NEET_SCORING_CONFIG.marksPerUnattempted,
    ),
    totalQuestions: normalizeNumber(
      cfg.totalQuestions,
      DEFAULT_NEET_SCORING_CONFIG.totalQuestions,
    ),
    totalMarks: normalizeNumber(
      cfg.totalMarks,
      DEFAULT_NEET_SCORING_CONFIG.totalMarks,
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

const cluster1d = (values, k, iters = 25) => {
  const arr = (values || [])
    .filter((n) => Number.isFinite(Number(n)))
    .map(Number);
  if (arr.length === 0) {
    return null;
  }

  const uniq = Array.from(new Set(arr.map((n) => Math.round(n))));
  const kk = Math.max(1, Math.min(Number(k) || 1, uniq.length));

  const sorted = [...arr].sort((a, b) => a - b);

  let centers = [];
  for (let i = 0; i < kk; i += 1) {
    const idx = Math.min(
      sorted.length - 1,
      Math.max(0, Math.floor(((i + 0.5) / kk) * sorted.length)),
    );
    centers.push(sorted[idx]);
  }

  let labels = new Array(sorted.length).fill(0);
  for (let iter = 0; iter < iters; iter += 1) {
    let changed = false;
    for (let i = 0; i < sorted.length; i += 1) {
      let best = 0;
      let bestDist = Math.abs(sorted[i] - centers[0]);
      for (let c = 1; c < kk; c += 1) {
        const d = Math.abs(sorted[i] - centers[c]);
        if (d < bestDist) {
          best = c;
          bestDist = d;
        }
      }
      if (labels[i] !== best) {
        labels[i] = best;
        changed = true;
      }
    }

    const sums = new Array(kk).fill(0);
    const counts = new Array(kk).fill(0);
    for (let i = 0; i < sorted.length; i += 1) {
      sums[labels[i]] += sorted[i];
      counts[labels[i]] += 1;
    }
    for (let c = 0; c < kk; c += 1) {
      if (counts[c] > 0) {
        centers[c] = sums[c] / counts[c];
      }
    }

    if (!changed) {
      break;
    }
  }

  const order = [...centers]
    .map((v, i) => ({ v, i }))
    .sort((a, b) => a.v - b.v)
    .map((x) => x.i);
  const remap = new Map(order.map((oldIdx, newIdx) => [oldIdx, newIdx + 1]));
  const centersSorted = order.map((i) => centers[i]);

  return { centersSorted, remap, kk };
};

const inferQuestionSubjectsFromStudentAnswers = (studentAnswers) => {
  const entries = Array.isArray(studentAnswers) ? studentAnswers : [];
  const xs = entries
    .map((a) => Number(a?.centerX))
    .filter((n) => Number.isFinite(n));
  const clustered = cluster1d(xs, 4);
  if (!clustered || !Array.isArray(clustered.centersSorted)) {
    return new Map();
  }

  const getColumn = (x) => {
    const v = Number(x);
    if (!Number.isFinite(v) || clustered.centersSorted.length === 0) {
      return null;
    }
    let bestIdx = 0;
    let bestDist = Math.abs(v - clustered.centersSorted[0]);
    for (let i = 1; i < clustered.centersSorted.length; i += 1) {
      const d = Math.abs(v - clustered.centersSorted[i]);
      if (d < bestDist) {
        bestIdx = i;
        bestDist = d;
      }
    }
    return bestIdx + 1;
  };

  const colToSubject = {
    1: "Physics",
    2: "Chemistry",
    3: "Biology",
    4: "Biology",
  };

  const map = new Map();
  for (const a of entries) {
    const q = Number(a?.questionNumber);
    if (!Number.isFinite(q)) {
      continue;
    }
    const col = getColumn(a?.centerX);
    const subj = col ? colToSubject[col] || "General" : "General";
    map.set(q, subj);
  }

  return map;
};

export const evaluateOmr = ({ answerKey, studentAnswers, scoringConfig }) => {
  const cfg = normalizeScoringConfig(scoringConfig);

  const questionSubjectMap =
    inferQuestionSubjectsFromStudentAnswers(studentAnswers);

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
    const subject =
      questionSubjectMap.get(questionNumber) ||
      getSectionName(questionNumber, sections);
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

  const subjectWiseMarks = {
    Physics: {
      marks: ensureSection("Physics").marks,
      correctCount: ensureSection("Physics").correctCount,
      incorrectCount: ensureSection("Physics").incorrectCount,
      unattemptedCount: ensureSection("Physics").unattemptedCount,
    },
    Chemistry: {
      marks: ensureSection("Chemistry").marks,
      correctCount: ensureSection("Chemistry").correctCount,
      incorrectCount: ensureSection("Chemistry").incorrectCount,
      unattemptedCount: ensureSection("Chemistry").unattemptedCount,
    },
    Biology: {
      marks: ensureSection("Biology").marks,
      correctCount: ensureSection("Biology").correctCount,
      incorrectCount: ensureSection("Biology").incorrectCount,
      unattemptedCount: ensureSection("Biology").unattemptedCount,
    },
  };

  const sectionWiseMarks = [
    {
      name: "Section A",
      subject: "Biology",
      ...subjectWiseMarks.Biology,
    },
    {
      name: "Section B",
      subject: "Chemistry",
      ...subjectWiseMarks.Chemistry,
    },
    {
      name: "Section C",
      subject: "Physics",
      ...subjectWiseMarks.Physics,
    },
  ];

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
    subjectWiseMarks,
    sectionWiseMarks,
  };
};

export const evaluateNeetOMR = ({ answerKey, studentAnswers }) => {
  return evaluateOmr({
    answerKey,
    studentAnswers,
    scoringConfig: DEFAULT_NEET_SCORING_CONFIG,
  });
};
