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

export const extractOmrJsonFromUrls = async ({
  answerKeyUrl,
  filledOmrUrl,
  submissionId,
  templateUrl,
  bubbleCenters,
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
    "omr_pipeline.py"
  );

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
            "Failed to detect bubble centers from the provided OMR template. Upload a clear blank OMR image."
          );
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
            JSON.stringify({ bubbleCenters: bubbleCentersUsed }, null, 2)
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
        "OMR pipeline returned empty answerKey. Ensure the scan is clear and the OMR template can be detected."
      );
    }

    if (!Array.isArray(studentAnswers) || studentAnswers.length === 0) {
      throw new Error(
        "OMR pipeline returned no detected marks for the student sheet. Ensure the scan is clear/aligned and matches the instructor template."
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
    ]);
  }
};
