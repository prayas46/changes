import { Exam, ExamSubmission } from "../models/AIExaminer.model.js";
import { uploadMedia, deleteMediaFromCloudinary } from "../utils/cloudinary.js";
import { evaluateOmr as evaluateOmrUtil } from "../utils/neetOmrEvaluator.js";
import { extractOmrJsonFromUrls } from "../utils/omrAutoEvaluator.js";

export const uploadExam = async (req, res) => {
  try {
    const instructorId = req.id;
    const {
      name,
      scoringConfig,
      marksPerCorrect,
      marksPerWrong,
      marksPerUnattempted,
      totalQuestions,
      totalMarks,
      sections,
    } = req.body;
    const existingExam = await Exam.findOne();

    let newExamData = {};
    let oldPublicIds = [];

    if (name) {
      newExamData.name = name;
    }

    let scoringConfigObj = null;
    if (scoringConfig) {
      try {
        scoringConfigObj =
          typeof scoringConfig === "string"
            ? JSON.parse(scoringConfig)
            : scoringConfig;
      } catch (e) {
        scoringConfigObj = null;
      }
    }

    if (!scoringConfigObj) {
      const hasAnyScoringField =
        marksPerCorrect != null ||
        marksPerWrong != null ||
        marksPerUnattempted != null ||
        totalQuestions != null ||
        totalMarks != null ||
        sections != null;

      if (hasAnyScoringField) {
        let parsedSections = null;
        if (sections != null) {
          try {
            parsedSections =
              typeof sections === "string" ? JSON.parse(sections) : sections;
          } catch (e) {
            parsedSections = null;
          }
        }

        scoringConfigObj = {
          marksPerCorrect,
          marksPerWrong,
          marksPerUnattempted,
          totalQuestions,
          totalMarks,
          sections: parsedSections,
        };
      }
    }

    if (scoringConfigObj && typeof scoringConfigObj === "object") {
      newExamData.scoringConfig = scoringConfigObj;
    }

    if (req.files && req.files.questions) {
      const questionFile = req.files.questions[0];
      const questionResponse = await uploadMedia(questionFile, true);
      if (!questionResponse) {
        return res
          .status(400)
          .json({ message: "Error on uploading question file" });
      }
      newExamData.questionPaper = {
        url: questionResponse.secure_url,
        publicId: questionResponse.public_id,
      };
      if (existingExam && existingExam.questionPaper) {
        oldPublicIds.push(existingExam.questionPaper.publicId);
      }
    }

    if (req.files && req.files.answerKey) {
      const answerKeyFile = req.files.answerKey[0];
      const answerKeyResponse = await uploadMedia(answerKeyFile);
      if (!answerKeyResponse) {
        return res
          .status(400)
          .json({ message: "Error on uploading answerkey file" });
      }
      newExamData.answerKey = {
        url: answerKeyResponse.secure_url,
        publicId: answerKeyResponse.public_id,
      };
      if (existingExam && existingExam.answerKey) {
        oldPublicIds.push(existingExam.answerKey.publicId);
      }

      newExamData.omrTemplate = null;
    }

    if (req.files && req.files.omr) {
      const omrFile = req.files.omr[0];
      const omrResponse = await uploadMedia(omrFile);
      if (!omrResponse) {
        return res.status(400).json({ message: "Error on uploading omr file" });
      }
      newExamData.omrSheet = {
        url: omrResponse.secure_url,
        publicId: omrResponse.public_id,
      };
      if (existingExam && existingExam.omrSheet) {
        oldPublicIds.push(existingExam.omrSheet.publicId);
      }

      newExamData.omrTemplate = null;
    }

    if (existingExam) {
      existingExam.set(newExamData);
      const updatedExam = await existingExam.save();

      if (oldPublicIds.length > 0) {
        await Promise.all(
          oldPublicIds
            .filter((id) => id)
            .map((id) => deleteMediaFromCloudinary(id))
        );
      }

      return res.status(200).json({
        success: true,
        message: "Exam updated successfully",
        exam: updatedExam,
      });
    } else {
      if (!newExamData.name) {
        return res.status(400).json({ message: "exam name is required" });
      }

      if (
        !newExamData.questionPaper &&
        !newExamData.answerKey &&
        !newExamData.omrSheet
      ) {
        return res
          .status(400)
          .json({ message: "upload at least one exam file" });
      }

      newExamData.instructor = instructorId;
      const newExam = await Exam.create(newExamData);
      return res.status(200).json({
        success: true,
        message: "exam uploaded successfully",
        newExam,
      });
    }
  } catch (err) {
    return res.status(400).json({ message: "Server error on exam upload" });
  }
};

export const getExam = async (req, res) => {
  try {
    const exam = await Exam.findOne().select("-answerKey");
    if (!exam) {
      return res.status(404).json({ message: "no exam has been uploaded yet" });
    }
    if (!exam.questionPaper || !exam.omrSheet) {
      return res.status(400).json({
        message:
          "exam is incomplete; please upload question paper and blank OMR",
      });
    }

    const examDetail = {
      _id: exam._id,
      name: exam.name,
      questionPaperUrl: exam.questionPaper.url,
      omrSheetUrl: exam.omrSheet.url,
    };

    return res.status(200).json({
      success: true,
      message: "Exam details",
      examDetail,
    });
  } catch (err) {
    return res.status(400).json({
      message: "error on hiting getExam controller",
      error: err,
    });
  }
};

export const submitOmr = async (req, res) => {
  try {
    const studentId = req.id;

    const exam = await Exam.findOne();
    if (!exam) {
      return res.status(404).json({ message: "exam not found" });
    }

    const examId = exam._id;

    if (!req.file) {
      return res.status(400).json({ message: "please upload filled OMR" });
    }
    // const existingSubmission = await ExamSubmission.findOne();
    // // if(existingSubmission){
    // //     return res.status(400).json({message:"you have already submitted the project"});
    // // }

    const omrFile = req.file;
    const omrResponse = await uploadMedia(omrFile);
    if (!omrResponse) {
      return res.status(400).json({
        success: false,
        message: "failed to upload filled Omr on the cloud",
      });
    }
    const newSubmission = await ExamSubmission.create({
      exam: examId,
      student: studentId,
      filledOmr: {
        url: omrResponse.secure_url,
        publicId: omrResponse.public_id,
      },
    });

    const answerKeyUrl = exam?.answerKey?.url;
    if (answerKeyUrl) {
      try {
        const { answerKey, studentAnswers, bubbleCenters } =
          await extractOmrJsonFromUrls({
            answerKeyUrl,
            filledOmrUrl: newSubmission.filledOmr?.url,
            submissionId: String(newSubmission._id),
            templateUrl: exam?.omrSheet?.url,
            bubbleCenters: exam?.omrTemplate?.bubbleCenters,
          });

        const evaluation = evaluateOmrUtil({
          answerKey,
          studentAnswers,
          scoringConfig: exam?.scoringConfig,
        });
        newSubmission.detectedMarks = studentAnswers;
        newSubmission.evaluation = evaluation;
        await newSubmission.save();

        if (
          bubbleCenters &&
          typeof bubbleCenters === "object" &&
          !Array.isArray(bubbleCenters) &&
          Object.keys(bubbleCenters).length > 0 &&
          (!exam?.omrTemplate || !exam?.omrTemplate?.bubbleCenters)
        ) {
          const questionCount = Object.keys(bubbleCenters).length;
          const firstKey = Object.keys(bubbleCenters)[0];
          const optionsCount =
            firstKey && bubbleCenters[firstKey]
              ? Object.keys(bubbleCenters[firstKey]).length
              : undefined;

          exam.omrTemplate = {
            bubbleCenters,
            questionCount,
            optionsCount,
            learnedAt: new Date(),
            templateSource: exam?.omrSheet?.url ? "omrSheet" : "answerKey",
          };
          await exam.save();
        }
      } catch (error) {}
    }

    return res.status(200).json({
      success: true,
      message: "Your Filled Omr Submitted Successfully",
      submission: newSubmission,
    });
  } catch (err) {
    return res.status(400).json({
      message: "error on hitting submitOmr controller",
      error: err,
    });
  }
};

export const evaluateOmr = async (req, res) => {
  try {
    const { submissionId } = req.params;
    const { answerKey, studentAnswers } = req.body;

    if (!submissionId) {
      return res.status(400).json({ message: "submissionId is required" });
    }

    if (!Array.isArray(answerKey) || !Array.isArray(studentAnswers)) {
      return res
        .status(400)
        .json({ message: "answerKey and studentAnswers must be arrays" });
    }

    const submission = await ExamSubmission.findById(submissionId);

    if (!submission) {
      return res.status(404).json({ message: "submission not found" });
    }

    const exam = await Exam.findById(submission.exam);
    const evaluation = evaluateOmrUtil({
      answerKey,
      studentAnswers,
      scoringConfig: exam?.scoringConfig,
    });

    submission.detectedMarks = studentAnswers;
    submission.evaluation = evaluation;
    await submission.save();

    return res.status(200).json({
      success: true,
      message: "OMR evaluated successfully",
      detectedMarks: submission.detectedMarks,
      evaluation: submission.evaluation,
    });
  } catch (err) {
    return res.status(500).json({
      message: "error on evaluating OMR",
      error: err,
    });
  }
};

export const getExamResult = async (req, res) => {
  try {
    const { submissionId } = req.params;

    if (!submissionId) {
      return res.status(400).json({ message: "submissionId is required" });
    }

    const submission = await ExamSubmission.findById(submissionId);

    if (!submission) {
      return res.status(404).json({ message: "submission not found" });
    }

    const shouldAutoEvaluate =
      !submission.evaluation ||
      !Array.isArray(submission.detectedMarks) ||
      submission.detectedMarks.length === 0;

    if (shouldAutoEvaluate) {
      const exam = await Exam.findById(submission.exam);
      if (!exam) {
        return res.status(404).json({ message: "exam not found" });
      }

      const answerKeyUrl = exam?.answerKey?.url;
      const filledOmrUrl = submission.filledOmr?.url;

      try {
        const { answerKey, studentAnswers, bubbleCenters } =
          await extractOmrJsonFromUrls({
            answerKeyUrl,
            filledOmrUrl,
            submissionId,
            templateUrl: exam?.omrSheet?.url,
            bubbleCenters: exam?.omrTemplate?.bubbleCenters,
          });

        const evaluation = evaluateOmrUtil({
          answerKey,
          studentAnswers,
          scoringConfig: exam?.scoringConfig,
        });

        submission.detectedMarks = studentAnswers;
        submission.evaluation = evaluation;
        await submission.save();

        if (
          bubbleCenters &&
          typeof bubbleCenters === "object" &&
          !Array.isArray(bubbleCenters) &&
          Object.keys(bubbleCenters).length > 0 &&
          (!exam?.omrTemplate || !exam?.omrTemplate?.bubbleCenters)
        ) {
          const questionCount = Object.keys(bubbleCenters).length;
          const firstKey = Object.keys(bubbleCenters)[0];
          const optionsCount =
            firstKey && bubbleCenters[firstKey]
              ? Object.keys(bubbleCenters[firstKey]).length
              : undefined;

          exam.omrTemplate = {
            bubbleCenters,
            questionCount,
            optionsCount,
            learnedAt: new Date(),
            templateSource: exam?.omrSheet?.url ? "omrSheet" : "answerKey",
          };
          await exam.save();
        }
      } catch (error) {
        return res.status(400).json({
          message:
            error?.message ||
            "Failed to auto-evaluate OMR. Check Python/OpenCV setup and ensure the template can be detected.",
        });
      }
    }

    if (!submission.evaluation) {
      return res
        .status(400)
        .json({ message: "evaluation not available for this submission yet" });
    }

    return res.status(200).json({
      success: true,
      message: "Exam evaluation fetched successfully",
      detectedMarks: submission.detectedMarks || [],
      evaluation: submission.evaluation,
    });
  } catch (err) {
    return res.status(500).json({
      message: "error on fetching exam evaluation",
      error: err,
    });
  }
};
