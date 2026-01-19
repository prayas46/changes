import axios from "axios";
import { spawn } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const downloadToFile = async (url, outPath) => {
  const resp = await axios.get(url, { responseType: "arraybuffer" });
  await fs.writeFile(outPath, Buffer.from(resp.data));
};

const runPython = async (command, args) => {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });

    child.on("error", (err) => {
      reject(err);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(stderr || `python exited with code ${code}`));
      }
    });
  });
};

const pickPythonCandidates = () => {
  const configured = process.env.OMR_PYTHON;
  const list = [];
  if (configured) list.push(configured);
  list.push("python");
  if (process.platform === "win32") {
    list.push("py");
  }
  return list;
};

const normalizePythonEvaluation = (parsed) => {
  const subjectWise =
    parsed?.subjectWiseMarks && typeof parsed.subjectWiseMarks === "object"
      ? parsed.subjectWiseMarks
      : {};

  const physics = Number(subjectWise?.Physics?.marks) || 0;
  const chemistry = Number(subjectWise?.Chemistry?.marks) || 0;
  const biology = Number(subjectWise?.Biology?.marks) || 0;

  const sectionMarks = [
    {
      name: "Physics",
      marks: physics,
      correctCount: Number(subjectWise?.Physics?.correctCount) || 0,
      incorrectCount: Number(subjectWise?.Physics?.incorrectCount) || 0,
      unattemptedCount: Number(subjectWise?.Physics?.unattemptedCount) || 0,
    },
    {
      name: "Chemistry",
      marks: chemistry,
      correctCount: Number(subjectWise?.Chemistry?.correctCount) || 0,
      incorrectCount: Number(subjectWise?.Chemistry?.incorrectCount) || 0,
      unattemptedCount: Number(subjectWise?.Chemistry?.unattemptedCount) || 0,
    },
    {
      name: "Biology",
      marks: biology,
      correctCount: Number(subjectWise?.Biology?.correctCount) || 0,
      incorrectCount: Number(subjectWise?.Biology?.incorrectCount) || 0,
      unattemptedCount: Number(subjectWise?.Biology?.unattemptedCount) || 0,
    },
  ];

  return {
    physicsMarks: physics,
    chemistryMarks: chemistry,
    biologyMarks: biology,
    totalMarks: Number(parsed?.totalScore) || 0,
    totalPossibleMarks:
      parsed?.totalPossible != null ? Number(parsed.totalPossible) : undefined,
    correctCount: Number(parsed?.correctCount) || 0,
    incorrectCount: Number(parsed?.incorrectCount) || 0,
    unattemptedCount: Number(parsed?.unattemptedCount) || 0,
    wrongQuestions: Array.isArray(parsed?.wrongQuestions)
      ? parsed.wrongQuestions
      : [],
    sectionMarks,
    subjectWiseMarks: parsed?.subjectWiseMarks,
    sectionWiseMarks: parsed?.sectionWiseMarks,
  };
};

export const extractOmrJsonFromUrls = async ({
  answerKeyUrl,
  filledOmrUrl,
  submissionId,
  templateUrl,
  bubbleCenters,
  scoringConfig,
}) => {
  if (!answerKeyUrl) {
    throw new Error("Answer key is not uploaded yet");
  }
  if (!filledOmrUrl) {
    throw new Error("Filled OMR is not available");
  }

  const tmpDir = path.join(os.tmpdir(), "smartedu-omr");
  await fs.mkdir(tmpDir, { recursive: true });

  const answerPath = path.join(tmpDir, `${submissionId}-answer-key.jpg`);
  const studentPath = path.join(tmpDir, `${submissionId}-student.jpg`);
  const templatePath = templateUrl
    ? path.join(tmpDir, `${submissionId}-template.jpg`)
    : null;

  await downloadToFile(answerKeyUrl, answerPath);
  await downloadToFile(filledOmrUrl, studentPath);
  if (templateUrl && templatePath) {
    await downloadToFile(templateUrl, templatePath);
  }

  const scriptPath = path.resolve(
    __dirname,
    "..",
    "..",
    "omr",
    "omr_pipeline.py",
  );

  const newCliPath = path.resolve(__dirname, "..", "..", "omr", "main.py");

  const pythonCandidates = pickPythonCandidates();

  try {
    let keyRun;
    let studentRun;
    let bubbleCentersResult = null;
    let bubbleMapPath = null;
    let lastErr;
    for (const cmd of pythonCandidates) {
      try {
        const hasBubbleCenters =
          bubbleCenters &&
          typeof bubbleCenters === "object" &&
          !Array.isArray(bubbleCenters) &&
          Object.keys(bubbleCenters).length > 0;

        let bubbleCentersUsed = hasBubbleCenters ? bubbleCenters : null;

        if (!bubbleCentersUsed) {
          try {
            const templateSourcePath = templatePath || answerPath;
            const templateRun = await runPython(cmd, [
              scriptPath,
              "--mode",
              "template",
              "--image",
              templateSourcePath,
            ]);
            const parsed = JSON.parse(templateRun.stdout);
            if (
              parsed &&
              typeof parsed === "object" &&
              !Array.isArray(parsed) &&
              Object.keys(parsed).length > 0
            ) {
              bubbleCentersUsed = parsed;
            }
          } catch (e) {
            bubbleCentersUsed = null;
          }
        }

        if (!bubbleCentersUsed) {
          throw new Error(
            "Failed to detect bubble centers from the provided OMR template. Upload a clear blank OMR image.",
          );
        }

        const shouldUseNewCli =
          String(process.env.OMR_USE_PY_MAIN || "").trim() === "1";

        if (shouldUseNewCli) {
          const cfgPath = path.join(tmpDir, `${submissionId}-neet-config.json`);
          await fs.writeFile(
            cfgPath,
            JSON.stringify(
              {
                scoring: scoringConfig || undefined,
                bubbleCenters: bubbleCentersUsed,
                answerKeyImage: answerPath,
                templateImage: templatePath || undefined,
              },
              null,
              2,
            ),
          );

          const run = await runPython(cmd, [
            newCliPath,
            "--image",
            studentPath,
            "--config",
            cfgPath,
          ]);

          const parsed = JSON.parse(run.stdout);
          if (!parsed || typeof parsed !== "object") {
            throw new Error("Python OMR main.py returned invalid JSON");
          }

          const answerKey = parsed.answerKey;
          const studentAnswers = parsed.studentAnswers;
          const bubbleCentersOut = parsed.bubbleCenters || bubbleCentersUsed;

          if (!Array.isArray(answerKey) || answerKey.length === 0) {
            throw new Error(
              "Python OMR main.py returned empty answerKey. Ensure the scan is clear and the OMR template can be detected.",
            );
          }

          if (!Array.isArray(studentAnswers) || studentAnswers.length === 0) {
            throw new Error(
              "Python OMR main.py returned no detected marks for the student sheet. Ensure the scan is clear/aligned and matches the instructor template.",
            );
          }

          bubbleCentersResult = bubbleCentersOut;
          lastErr = null;
          return {
            answerKey,
            studentAnswers,
            bubbleCenters: bubbleCentersResult,
            evaluation: normalizePythonEvaluation(parsed),
          };
        }

        if (
          bubbleCentersUsed &&
          typeof bubbleCentersUsed === "object" &&
          !Array.isArray(bubbleCentersUsed) &&
          Object.keys(bubbleCentersUsed).length > 0
        ) {
          bubbleMapPath = path.join(tmpDir, `${submissionId}-bubble-map.json`);
          await fs.writeFile(
            bubbleMapPath,
            JSON.stringify({ bubbleCenters: bubbleCentersUsed }, null, 2),
          );
        }

        const bubbleMapArgs = bubbleMapPath
          ? ["--bubble-map", bubbleMapPath]
          : [];
        keyRun = await runPython(cmd, [
          scriptPath,
          "--mode",
          "answer_key",
          "--image",
          answerPath,
          ...bubbleMapArgs,
        ]);
        studentRun = await runPython(cmd, [
          scriptPath,
          "--mode",
          "student",
          "--image",
          studentPath,
          ...bubbleMapArgs,
        ]);

        bubbleCentersResult = bubbleCentersUsed;
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
      }
    }

    if (!keyRun || !studentRun) {
      throw lastErr || new Error("Unable to run Python for OMR evaluation");
    }

    const answerKey = JSON.parse(keyRun.stdout);
    const studentAnswers = JSON.parse(studentRun.stdout);

    if (!Array.isArray(answerKey) || answerKey.length === 0) {
      throw new Error(
        "OMR pipeline returned empty answerKey. Ensure the scan is clear and the OMR template can be detected.",
      );
    }

    if (!Array.isArray(studentAnswers) || studentAnswers.length === 0) {
      throw new Error(
        "OMR pipeline returned no detected marks for the student sheet. Ensure the scan is clear/aligned and matches the instructor template.",
      );
    }

    return { answerKey, studentAnswers, bubbleCenters: bubbleCentersResult };
  } finally {
    await Promise.allSettled([
      fs.rm(answerPath, { force: true }),
      fs.rm(studentPath, { force: true }),
      templatePath ? fs.rm(templatePath, { force: true }) : Promise.resolve(),
      fs.rm(path.join(tmpDir, `${submissionId}-bubble-map.json`), {
        force: true,
      }),
      fs.rm(path.join(tmpDir, `${submissionId}-neet-config.json`), {
        force: true,
      }),
    ]);
  }
};
