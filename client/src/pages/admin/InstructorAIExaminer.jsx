import React, { useState } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Loader } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/axios";

const InstructorAIExaminer = () => {
  const [neetQuestions, setNeetQuestions]=useState(null);
  const [uploaded, setUploaded]=useState(false);
  const [answerKeyFile, setAnswerKeyFile]= useState(null);
  const [blankOmr, setBlankOmr]=useState(null);
  const [name, setName]=useState("NEET");
  const [loading, setLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [marksPerCorrect, setMarksPerCorrect] = useState("");
  const [marksPerWrong, setMarksPerWrong] = useState("");
  const [marksPerUnattempted, setMarksPerUnattempted] = useState("");
  const [totalQuestions, setTotalQuestions] = useState("");
  const [totalMarks, setTotalMarks] = useState("");
  const [sectionsJson, setSectionsJson] = useState("");
  const handleAnswerKeyUpload = (e)=>{
    if(e.target.files && e.target.files.length>0){
      setAnswerKeyFile(e.target.files[0]);
    }
  }
  
  const handleQuestionUpload=(e)=>{
    if(e.target.files && e.target.files.length>0){
      setNeetQuestions(e.target.files[0]);
    }
  }

  const handleBlankOmrUpload=(e)=>{
    if(e.target.files && e.target.files.length>0){
      setBlankOmr(e.target.files[0]);
    }
  }

  const handleSubmit = async()=>{
    try{

      setLoading(true);
      setUploadProgress(0);

      if(!answerKeyFile && !blankOmr && !neetQuestions){
        return toast.error("Please upload something");
      }

      const scoringConfig = {};
      if (marksPerCorrect !== "") scoringConfig.marksPerCorrect = Number(marksPerCorrect);
      if (marksPerWrong !== "") scoringConfig.marksPerWrong = Number(marksPerWrong);
      if (marksPerUnattempted !== "")
        scoringConfig.marksPerUnattempted = Number(marksPerUnattempted);
      if (totalQuestions !== "") scoringConfig.totalQuestions = Number(totalQuestions);
      if (totalMarks !== "") scoringConfig.totalMarks = Number(totalMarks);
      if (sectionsJson !== "") {
        try {
          const parsed = JSON.parse(sectionsJson);
          scoringConfig.sections = parsed;
        } catch (e) {
          return toast.error("Sections must be valid JSON");
        }
      }

      const formData = new FormData();
      
      formData.append("name",name);
      if (Object.keys(scoringConfig).length > 0) {
        formData.append("scoringConfig", JSON.stringify(scoringConfig));
      }
      if(neetQuestions) formData.append("questions", neetQuestions);
      if(answerKeyFile) formData.append("answerKey", answerKeyFile);
      if(blankOmr) formData.append("omr", blankOmr);

      const response = await apiClient.post("/examiner/exam/upload", formData, {
        onUploadProgress: ({ loaded, total }) => {
          if (!total) return;
          setUploadProgress(Math.round((loaded * 100) / total));
        },
      });

      if(response.data.success){
        toast.success(response.data.message);
      }

    }catch(err){
      toast.error(err.response?.data?.message || "Failed to upload")
    } finally {
      setLoading(false);
    }
  }


  return (
    <div className="max-w-3xl mx-auto px-4 my-10">


      {/* Upload Card (always visible) */}
      <div className="my-8">
        <Card>
          <CardHeader>
            <CardTitle>NEET Question</CardTitle>
            <CardDescription>
              Upload the Neet question paper
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="exam-name">Exam Name</Label>
              <Input
                id="exam-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={uploaded || loading}
              />
            </div>

            <div className="space-y-1">
              <Label>Scoring Config (optional)</Label>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="number"
                  placeholder="Marks per correct"
                  value={marksPerCorrect}
                  onChange={(e) => setMarksPerCorrect(e.target.value)}
                  disabled={uploaded || loading}
                />
                <Input
                  type="number"
                  placeholder="Marks per wrong"
                  value={marksPerWrong}
                  onChange={(e) => setMarksPerWrong(e.target.value)}
                  disabled={uploaded || loading}
                />
                <Input
                  type="number"
                  placeholder="Marks per unattempted"
                  value={marksPerUnattempted}
                  onChange={(e) => setMarksPerUnattempted(e.target.value)}
                  disabled={uploaded || loading}
                />
                <Input
                  type="number"
                  placeholder="Total questions"
                  value={totalQuestions}
                  onChange={(e) => setTotalQuestions(e.target.value)}
                  disabled={uploaded || loading}
                />
                <Input
                  type="number"
                  placeholder="Total marks"
                  value={totalMarks}
                  onChange={(e) => setTotalMarks(e.target.value)}
                  disabled={uploaded || loading}
                />
                <Input
                  type="text"
                  placeholder='Sections JSON (e.g. [{"name":"Part A","startQuestion":1,"endQuestion":50}])'
                  value={sectionsJson}
                  onChange={(e) => setSectionsJson(e.target.value)}
                  disabled={uploaded || loading}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="neetQuestions">Upload NEET Questions</Label>
              <Input
                id="neetQuestions"
                type="file"
                accept="application/pdf"
                onChange={handleQuestionUpload}
                disabled={uploaded || loading}
              />
              {neetQuestions && (
                <p className="text-sm text-muted-foreground">
                  Selected: {neetQuestions.name}
                </p>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor="answer-key">Upload Your Answer Key</Label>
              <Input id="answer-key" type="file" accept="image/*" onChange={handleAnswerKeyUpload} disabled={uploaded || loading} />
              {answerKeyFile && (
                <p className="text-sm text-muted-foreground">
                  Selected: {answerKeyFile.name}
                </p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="blank-omr">Upload Blank OMR</Label>
              <Input id="blank-omr" type="file" accept="image/*" onChange={handleBlankOmrUpload} disabled={uploaded || loading} />
            </div>

            {loading && (
              <div className="space-y-2">
                <Progress value={uploadProgress} />
                <p className="text-xs text-muted-foreground">
                  {uploadProgress < 100
                    ? `Uploading... ${uploadProgress}%`
                    : "Processing..."}
                </p>
              </div>
            )}
            <div className="flex justify-center mt-4">
              <Button variant="outline" onClick={handleSubmit} disabled={loading}>
                {loading ? (
                  <>
                    <Loader className="mr-2 h-4 w-4 animate-spin" />
                    {uploadProgress < 100
                      ? `Uploading... ${uploadProgress}%`
                      : "Processing..."}
                  </>
                ) : (
                  "Upload"
                )}
              </Button>
            </div>

          </CardContent>
        </Card>
      </div>

    </div>
  );
};

export default InstructorAIExaminer;
