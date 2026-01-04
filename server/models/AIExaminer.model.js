// import mongoose from "mongoose";

// const answerSchema = new mongoose.Schema({
//     questionNumber: {type: Number, required:true},
//     correctOption: {type:String, enum: ['A','B','C','D'], required:true}
// });

// export const ExaminerAnswer = mongoose.model("ExaminerAnswer",answerSchema);

import mongoose from "mongoose";

const omrTemplateSchema = new mongoose.Schema(
  {
    bubbleCenters: mongoose.Schema.Types.Mixed,
    questionCount: Number,
    optionsCount: Number,
    learnedAt: Date,
    templateSource: String,
  },
  { _id: false }
);

const scoringSectionSchema = new mongoose.Schema(
  {
    name: String,
    startQuestion: Number,
    endQuestion: Number,
  },
  { _id: false }
);

const scoringConfigSchema = new mongoose.Schema(
  {
    marksPerCorrect: { type: Number, default: 4 },
    marksPerWrong: { type: Number, default: -1 },
    marksPerUnattempted: { type: Number, default: 0 },
    totalQuestions: { type: Number, default: 180 },
    totalMarks: { type: Number, default: 720 },
    sections: {
      type: [scoringSectionSchema],
      default: [
        { name: "Physics", startQuestion: 1, endQuestion: 50 },
        { name: "Chemistry", startQuestion: 51, endQuestion: 100 },
        { name: "Biology", startQuestion: 101, endQuestion: 180 },
      ],
    },
  },
  { _id: false }
);

const examSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    instructor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    questionPaper: {
      url: String,
      publicId: String,
    },
    answerKey: {
      url: String,
      publicId: String,
    },
    omrSheet: {
      url: String,
      publicId: String,
    },
    omrTemplate: omrTemplateSchema,
    scoringConfig: scoringConfigSchema,
  },
  { timestamps: true }
);

const examSubmissionSchenma = new mongoose.Schema(
  {
    exam: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AIExam",
      required: true,
    },
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    filledOmr: {
      url: String,
      publicId: String,
    },
    detectedMarks: [
      {
        questionNumber: Number,
        selectedOption: String,
        centerX: Number,
        centerY: Number,
        confidence: Number,
      },
    ],
    evaluation: {
      physicsMarks: Number,
      chemistryMarks: Number,
      biologyMarks: Number,
      totalMarks: Number,
      totalPossibleMarks: Number,
      correctCount: Number,
      incorrectCount: Number,
      unattemptedCount: Number,
      wrongQuestions: [
        {
          questionNumber: Number,
          subject: String,
          selectedOption: String,
          correctOption: String,
        },
      ],
      sectionMarks: [
        {
          name: String,
          marks: Number,
          correctCount: Number,
          incorrectCount: Number,
          unattemptedCount: Number,
        },
      ],
    },
  },
  { timestamps: true }
);

// examSubmissionSchenma.index({ exam: 1, student: 1 }, { unique: true });

export const Exam = mongoose.model("AIExam", examSchema);
export const ExamSubmission = mongoose.model(
  "AIExamSubmission",
  examSubmissionSchenma
);
