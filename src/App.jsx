import React, { useState, useEffect, useRef } from 'react';
import { Upload, FileText, Clock, CheckCircle, XCircle, AlertCircle, Play, Settings, RotateCcw, Award, ChevronRight, ChevronLeft, PenTool, CheckSquare, Eye, LayoutGrid, List } from 'lucide-react';

// External library loader for Mammoth.js
const useScript = (src) => {
  const [status, setStatus] = useState(src ? 'loading' : 'idle');
  useEffect(() => {
    if (!src) {
      setStatus('idle');
      return;
    }
    let script = document.querySelector(`script[src="${src}"]`);
    if (!script) {
      script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.setAttribute('data-status', 'loading');
      document.body.appendChild(script);
      const setAttributeFromEvent = (event) => {
        script.setAttribute('data-status', event.type === 'load' ? 'ready' : 'error');
        setStatus(event.type === 'load' ? 'ready' : 'error');
      };
      script.addEventListener('load', setAttributeFromEvent);
      script.addEventListener('error', setAttributeFromEvent);
    } else {
      setStatus(script.getAttribute('data-status'));
    }
  }, [src]);
  return status;
};

const App = () => {
  // Load Mammoth.js for docx parsing via CDN
  const mammothStatus = useScript('https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js');

  const [gameState, setGameState] = useState('upload'); // upload, config, playing, result
  const [questions, setQuestions] = useState([]);
  const [quizConfig, setQuizConfig] = useState({
    mcqTime: 60,
    mcqMarks: 2,
    subjectiveTime: 180,
    subjectiveMarks: 10,
    totalTime: 0,
  });
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [userAnswers, setUserAnswers] = useState({});
  const [selfGrading, setSelfGrading] = useState({}); 
  const [timeLeft, setTimeLeft] = useState(0);
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState(null);
  
  const timerRef = useRef(null);

  // --- Parsing Logic ---
  const parseDocxContent = (text) => {
    const lines = text.split(/\n/).map(line => line.trim()).filter(line => line.length > 0);
    const parsedQuestions = [];
    let currentQ = null;
    let state = 'NONE'; 

    // Regex patterns
    const questionPattern = /^(\d+)[\.)]\s+(.+)/;
    const optionPattern = /^([a-zA-Z])[\.)]\s+(.+)/;
    const answerPattern = /^Answer:\s*(.+)/i;

    const finalizeQuestion = (q) => {
      if (!q) return;
      if (q.options.length === 0) {
        q.type = 'subjective';
      } else {
        q.type = 'mcq';
      }
      parsedQuestions.push(q);
    };

    lines.forEach((line) => {
      // 1. Check for Answer line
      const answerMatch = line.match(answerPattern);
      if (answerMatch) {
        if (currentQ) {
          const ansText = answerMatch[1];
          currentQ.modelAnswer = ansText;
          
          if (ansText.length < 5) {
             const cleanAns = ansText.trim().toLowerCase().charAt(0);
             if (cleanAns >= 'a' && cleanAns <= 'z') {
               currentQ.correctOption = cleanAns;
             }
          }
          state = 'ANSWER';
        }
        return;
      }

      // 2. Check for Question Start
      const qMatch = line.match(questionPattern);
      if (qMatch) {
        finalizeQuestion(currentQ);
        currentQ = {
          id: parseInt(qMatch[1]),
          text: qMatch[2],
          options: [],
          correctOption: null,
          modelAnswer: null, 
          type: 'mcq' 
        };
        state = 'QUESTION';
        return;
      }

      // 3. Check for Option Start
      const optMatch = line.match(optionPattern);
      if (optMatch && currentQ) {
        let optLabel = optMatch[1].toLowerCase();
        let optText = optMatch[2];
        
        if (optText.startsWith('*')) {
          currentQ.correctOption = optLabel;
          optText = optText.substring(1).trim();
        }

        // We accept all options, but the UI will optimize for 4
        currentQ.options.push({ label: optLabel, text: optText });
        state = 'OPTION';
        return;
      }

      // 4. Handle multiline text
      if (currentQ) {
        if (state === 'QUESTION') {
          currentQ.text += ' ' + line;
        } else if (state === 'OPTION') {
          const lastOpt = currentQ.options[currentQ.options.length - 1];
          if (lastOpt) lastOpt.text += ' ' + line;
        } else if (state === 'ANSWER') {
          currentQ.modelAnswer += ' ' + line;
        }
      }
    });

    finalizeQuestion(currentQ);
    return parsedQuestions;
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    if (mammothStatus !== 'ready') {
      setParseError("Parser library loading... please try again in a moment.");
      return;
    }

    setIsParsing(true);
    setParseError(null);

    const reader = new FileReader();
    reader.onload = function(loadEvent) {
      const arrayBuffer = loadEvent.target.result;
      
      // Use window.mammoth from CDN
      window.mammoth.extractRawText({ arrayBuffer: arrayBuffer })
        .then(function(result) {
          const parsed = parseDocxContent(result.value);
          
          if (parsed.length === 0) {
            setParseError("No questions found. Check format: '1. Question text'");
          } else {
            setQuestions(parsed);
            let time = 0;
            parsed.forEach(q => {
               time += (q.type === 'mcq' ? quizConfig.mcqTime : quizConfig.subjectiveTime);
            });
            setQuizConfig(prev => ({ ...prev, totalTime: time }));
            setGameState('config');
          }
          setIsParsing(false);
        })
        .catch(function(err) {
          console.error(err);
          setParseError("Error reading DOCX file.");
          setIsParsing(false);
        });
    };
    reader.readAsArrayBuffer(file);
  };

  // --- Quiz Logic ---
  const recalculateTotalTime = (newConfig) => {
    let time = 0;
    questions.forEach(q => {
       time += (q.type === 'mcq' ? newConfig.mcqTime : newConfig.subjectiveTime);
    });
    return time;
  };

  const startQuiz = () => {
    setTimeLeft(quizConfig.totalTime);
    setGameState('playing');
  };

  useEffect(() => {
    if (gameState === 'playing') {
      timerRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            clearInterval(timerRef.current);
            setGameState('result');
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timerRef.current);
  }, [gameState]);

  const handleAnswerChange = (val) => {
    setUserAnswers(prev => ({
      ...prev,
      [questions[currentQuestionIndex].id]: val
    }));
  };

  const toggleSelfGrading = (qId, isCorrect) => {
    setSelfGrading(prev => ({
      ...prev,
      [qId]: isCorrect
    }));
  };

  const calculateScore = () => {
    let score = 0;
    let maxScore = 0;
    let correctCount = 0;

    questions.forEach(q => {
      const points = q.type === 'mcq' ? quizConfig.mcqMarks : quizConfig.subjectiveMarks;
      maxScore += points;

      if (q.type === 'mcq') {
        if (userAnswers[q.id] === q.correctOption) {
          score += points;
          correctCount++;
        }
      } else {
        if (selfGrading[q.id] === true) {
          score += points;
          correctCount++;
        }
      }
    });

    return { score, correctCount, maxScore };
  };

  // --- Views ---

  const UploadView = () => (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center animate-fade-in">
      <div className="bg-blue-50 p-6 rounded-full mb-6">
        <FileText size={64} className="text-blue-600" />
      </div>
      <h1 className="text-4xl font-bold text-gray-800 mb-4">Quiz Generator</h1>
      <p className="text-gray-600 mb-8 max-w-md">
        Upload a .docx file. Optimized for <strong>standard 4-option MCQs</strong> and Subjective questions.
      </p>

      <div className="w-full max-w-md">
        <label className="flex flex-col items-center justify-center w-full h-48 border-2 border-blue-300 border-dashed rounded-xl cursor-pointer bg-white hover:bg-blue-50 transition-colors relative">
          <div className="flex flex-col items-center justify-center pt-5 pb-6">
            <Upload className="w-10 h-10 mb-3 text-blue-500" />
            <p className="mb-2 text-sm text-gray-500"><span className="font-semibold">Click to upload</span> or drag and drop</p>
            <p className="text-xs text-gray-500">.DOCX files only</p>
          </div>
          <input 
            type="file" 
            className="hidden" 
            accept=".docx" 
            onChange={handleFileUpload}
            disabled={isParsing}
          />
          {isParsing && (
             <div className="absolute inset-0 bg-white/80 flex items-center justify-center rounded-xl">
               <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
             </div>
          )}
        </label>
        {parseError && (
          <div className="mt-4 p-3 bg-red-100 text-red-700 rounded-lg flex items-center text-sm text-left">
            <AlertCircle size={16} className="mr-2 flex-shrink-0" />
            {parseError}
          </div>
        )}
      </div>

      <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-lg text-left">
        <div className="bg-white p-4 rounded-xl border border-gray-200">
           <h3 className="font-bold text-xs text-gray-500 uppercase mb-2">Format: MCQ</h3>
           <div className="text-xs text-gray-600 font-mono space-y-1">
             <p>1. Capital of France?</p>
             <p>a) London</p>
             <p>*b) Paris</p>
             <p>c) Berlin</p>
             <p>d) Rome</p>
           </div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-gray-200">
           <h3 className="font-bold text-xs text-gray-500 uppercase mb-2">Format: Subjective</h3>
           <div className="text-xs text-gray-600 font-mono space-y-1">
             <p>2. Explain Gravity.</p>
             <p className="text-gray-400 italic">(No options provided)</p>
             <p>Answer: A force...</p>
           </div>
        </div>
      </div>
    </div>
  );

  const ConfigView = () => {
    const mcqCount = questions.filter(q => q.type === 'mcq').length;
    const subjCount = questions.filter(q => q.type === 'subjective').length;

    const updateConfig = (key, value) => {
      const newConfig = { ...quizConfig, [key]: value };
      newConfig.totalTime = recalculateTotalTime(newConfig);
      setQuizConfig(newConfig);
    };

    return (
      <div className="max-w-3xl mx-auto w-full p-6 animate-fade-in">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-3xl font-bold text-gray-800">Configuration</h2>
          <div className="flex gap-2">
            <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-xs font-bold">{mcqCount} MCQs</span>
            <span className="bg-purple-100 text-purple-800 px-3 py-1 rounded-full text-xs font-bold">{subjCount} Subjective</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          {/* MCQ Settings */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
            <h3 className="font-bold text-gray-700 mb-4 flex items-center gap-2">
              <CheckSquare size={18} className="text-blue-500"/> MCQ Settings
            </h3>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-gray-600">Marks per Question</label>
                <input type="number" value={quizConfig.mcqMarks} onChange={(e) => updateConfig('mcqMarks', parseInt(e.target.value)||0)} className="w-full mt-1 border p-2 rounded-lg" />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-600">Time (seconds)</label>
                <input type="number" value={quizConfig.mcqTime} onChange={(e) => updateConfig('mcqTime', parseInt(e.target.value)||0)} className="w-full mt-1 border p-2 rounded-lg" />
              </div>
            </div>
          </div>

          {/* Subjective Settings */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
            <h3 className="font-bold text-gray-700 mb-4 flex items-center gap-2">
              <PenTool size={18} className="text-purple-500"/> Subjective Settings
            </h3>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-gray-600">Marks per Question</label>
                <input type="number" value={quizConfig.subjectiveMarks} onChange={(e) => updateConfig('subjectiveMarks', parseInt(e.target.value)||0)} className="w-full mt-1 border p-2 rounded-lg" />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-600">Time (seconds)</label>
                <input type="number" value={quizConfig.subjectiveTime} onChange={(e) => updateConfig('subjectiveTime', parseInt(e.target.value)||0)} className="w-full mt-1 border p-2 rounded-lg" />
              </div>
            </div>
          </div>
        </div>

        <div className="bg-gray-50 p-4 rounded-xl flex justify-between items-center mb-8">
            <span className="font-medium text-gray-600">Total Duration:</span>
            <span className="font-bold text-xl text-gray-800">
               {Math.floor(quizConfig.totalTime / 60)}m {quizConfig.totalTime % 60}s
            </span>
        </div>

        <div className="flex justify-between items-center">
          <button 
            onClick={() => { setQuestions([]); setGameState('upload'); }}
            className="text-gray-500 hover:text-gray-700 font-medium px-4 py-2"
          >
            Back
          </button>
          <button 
            onClick={startQuiz}
            className="bg-gray-900 hover:bg-black text-white px-8 py-3 rounded-xl font-bold shadow-lg transition-all flex items-center gap-2"
          >
            <Play size={20} />
            Start Quiz
          </button>
        </div>
      </div>
    );
  };

  const QuizView = () => {
    const q = questions[currentQuestionIndex];
    const progress = ((currentQuestionIndex + 1) / questions.length) * 100;
    const isLastQuestion = currentQuestionIndex === questions.length - 1;
    const timerColor = timeLeft < 60 ? 'text-red-600' : 'text-blue-600';
    
    // Check if we should use grid layout (ideal for 4 options)
    const isGrid = q.type === 'mcq' && q.options.length >= 4;

    return (
      <div className="max-w-4xl mx-auto w-full p-4 md:p-8 animate-fade-in flex flex-col min-h-[80vh]">
        {/* Header */}
        <div className="flex justify-between items-center mb-6 bg-white p-4 rounded-xl shadow-sm border border-gray-100">
          <div>
             <div className="flex items-center gap-2 mb-1">
                <span className={`text-xs font-bold px-2 py-0.5 rounded uppercase ${q.type === 'mcq' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                    {q.type === 'mcq' ? 'Multiple Choice' : 'Subjective'}
                </span>
             </div>
             <div className="text-2xl font-bold text-gray-800">
              Q{currentQuestionIndex + 1}<span className="text-gray-300 text-lg mx-1">/</span>{questions.length}
            </div>
          </div>
          <div className="flex items-center gap-2 bg-gray-50 px-4 py-2 rounded-lg">
            <Clock size={20} className={timerColor} />
            <span className={`text-xl font-mono font-bold ${timerColor}`}>
                {Math.floor(timeLeft / 60)}:{timeLeft % 60 < 10 ? '0' : ''}{timeLeft % 60}
            </span>
          </div>
        </div>

        {/* Question Area */}
        <div className="bg-white rounded-3xl shadow-sm border border-gray-200 p-8 mb-8 flex-grow">
          <h3 className="text-xl font-medium text-gray-800 mb-8 leading-relaxed whitespace-pre-wrap">
            {q.text}
          </h3>

          {/* INPUT AREA */}
          {q.type === 'mcq' ? (
             <div className={isGrid ? "grid grid-cols-1 md:grid-cols-2 gap-4" : "flex flex-col gap-3"}>
               {q.options.map((opt, idx) => {
                 const isSelected = userAnswers[q.id] === opt.label;
                 return (
                   <button
                     key={idx}
                     onClick={() => handleAnswerChange(opt.label)}
                     className={`w-full text-left p-4 rounded-xl border-2 transition-all flex items-center gap-3 group
                       ${isSelected 
                         ? 'border-blue-500 bg-blue-50 text-blue-800 shadow-md' 
                         : 'border-gray-100 hover:border-blue-200 hover:bg-gray-50 text-gray-600 shadow-sm'
                       }`}
                   >
                     <div className={`w-8 h-8 flex-shrink-0 rounded-lg flex items-center justify-center border-2 font-bold text-sm
                       ${isSelected ? 'bg-blue-500 border-blue-500 text-white' : 'bg-white border-gray-200 text-gray-400 group-hover:border-blue-300'}`}>
                       {opt.label.toUpperCase()}
                     </div>
                     <span className="font-medium text-base leading-snug">{opt.text}</span>
                   </button>
                 );
               })}
             </div>
          ) : (
            <div className="animate-fade-in">
                <textarea 
                    value={userAnswers[q.id] || ''}
                    onChange={(e) => handleAnswerChange(e.target.value)}
                    placeholder="Type your answer here..."
                    className="w-full h-64 p-4 border-2 border-purple-100 rounded-xl focus:border-purple-500 focus:ring-0 outline-none resize-none text-gray-700 bg-purple-50/30 font-medium"
                />
                <p className="text-xs text-gray-400 mt-2 text-right">
                    {(userAnswers[q.id] || '').length} characters
                </p>
            </div>
          )}
        </div>

        {/* Navigation */}
        <div className="flex justify-between items-center mt-auto">
          <button 
            onClick={() => setCurrentQuestionIndex(prev => Math.max(0, prev - 1))}
            disabled={currentQuestionIndex === 0}
            className={`flex items-center gap-2 px-6 py-3 rounded-xl font-semibold transition-colors
              ${currentQuestionIndex === 0 ? 'text-gray-300 cursor-not-allowed' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            <ChevronLeft size={20} /> Previous
          </button>

          {isLastQuestion ? (
            <button 
              onClick={() => setGameState('result')}
              className="bg-green-600 hover:bg-green-700 text-white px-8 py-3 rounded-xl font-bold shadow-lg shadow-green-200 transition-all flex items-center gap-2"
            >
              Submit <CheckCircle size={20} />
            </button>
          ) : (
            <button 
              onClick={() => setCurrentQuestionIndex(prev => Math.min(questions.length - 1, prev + 1))}
              className="bg-gray-900 hover:bg-black text-white px-8 py-3 rounded-xl font-bold shadow-lg transition-all flex items-center gap-2"
            >
              Next <ChevronRight size={20} />
            </button>
          )}
        </div>
      </div>
    );
  };

  const ResultView = () => {
    const { score, correctCount, maxScore } = calculateScore();
    const percentage = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
    
    // Determine feedback
    let feedbackColor = "text-blue-600";
    if (percentage >= 80) feedbackColor = "text-green-600";
    else if (percentage < 50) feedbackColor = "text-orange-600";

    return (
      <div className="max-w-4xl mx-auto w-full p-6 animate-fade-in pb-20">
        <div className="bg-white rounded-3xl shadow-lg border border-gray-100 overflow-hidden mb-8">
          <div className="bg-slate-900 p-8 text-center text-white">
            <Award className="w-16 h-16 mx-auto mb-4 text-yellow-400" />
            <h2 className="text-3xl font-bold mb-2">Quiz Complete</h2>
            <p className="text-slate-400 text-sm">Review your subjective answers below to finalize your score.</p>
          </div>
          
          <div className="grid grid-cols-3 divide-x divide-gray-100 border-b border-gray-100">
            <div className="p-6 text-center">
              <div className="text-3xl font-bold text-gray-800 mb-1">{score} <span className="text-sm text-gray-400 font-normal">/ {maxScore}</span></div>
              <div className="text-xs font-bold text-gray-400 uppercase tracking-wider">Total Score</div>
            </div>
            <div className="p-6 text-center">
              <div className="text-3xl font-bold text-gray-800 mb-1">{correctCount}</div>
              <div className="text-xs font-bold text-gray-400 uppercase tracking-wider">Correct</div>
            </div>
            <div className="p-6 text-center">
              <div className={`text-3xl font-bold mb-1 ${feedbackColor}`}>{percentage}%</div>
              <div className="text-xs font-bold text-gray-400 uppercase tracking-wider">Accuracy</div>
            </div>
          </div>

          <div className="p-8 bg-gray-50">
            <h3 className="font-bold text-gray-800 mb-6">Detailed Analysis & Self-Grading</h3>
            <div className="space-y-6">
              {questions.map((q, idx) => {
                const userAnswer = userAnswers[q.id];
                let isCorrect = false;
                let statusColor = "gray";

                if (q.type === 'mcq') {
                  isCorrect = userAnswer === q.correctOption;
                  statusColor = isCorrect ? 'green' : 'red';
                } else {
                  isCorrect = selfGrading[q.id] === true;
                  statusColor = isCorrect ? 'green' : 'purple';
                }
                
                return (
                  <div key={idx} className={`bg-white p-5 rounded-xl border-l-4 shadow-sm ${statusColor === 'green' ? 'border-green-500' : statusColor === 'purple' ? 'border-purple-500' : 'border-red-500'}`}>
                    <div className="flex gap-4">
                        <div className="mt-1">
                            <span className="font-bold text-gray-400 mr-2">{idx + 1}.</span>
                        </div>
                        <div className="flex-grow">
                            <p className="font-medium text-gray-800 mb-3">{q.text}</p>
                            
                            {/* MCQ ANSWER DISPLAY */}
                            {q.type === 'mcq' && (
                                <div className="space-y-2 text-sm">
                                    <div className="flex justify-between p-2 bg-gray-50 rounded text-gray-600">
                                        <span>Your Answer: <span className="font-bold uppercase">{userAnswer || '-'}</span></span>
                                        {!isCorrect && <XCircle size={16} className="text-red-500"/>}
                                        {isCorrect && <CheckCircle size={16} className="text-green-500"/>}
                                    </div>
                                    {!isCorrect && (
                                        <div className="p-2 bg-green-50 text-green-700 rounded font-medium flex items-center gap-2">
                                            <CheckCircle size={14}/> Correct Answer: {q.correctOption?.toUpperCase()}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* SUBJECTIVE ANSWER DISPLAY & SELF GRADING */}
                            {q.type === 'subjective' && (
                                <div className="space-y-3">
                                    <div className="p-3 bg-purple-50 rounded-lg text-sm text-gray-700 whitespace-pre-wrap border border-purple-100">
                                        <span className="text-xs font-bold text-purple-400 uppercase block mb-1">Your Answer</span>
                                        {userAnswer || <span className="italic text-gray-400">No answer provided</span>}
                                    </div>
                                    
                                    <div className="p-3 bg-gray-100 rounded-lg text-sm text-gray-600 border border-gray-200">
                                         <span className="text-xs font-bold text-gray-400 uppercase block mb-1 flex items-center gap-1">
                                            <Eye size={12}/> Model Answer / Key
                                         </span>
                                         {q.modelAnswer ? q.modelAnswer : <span className="italic">No model answer provided in doc.</span>}
                                    </div>

                                    <div className="flex items-center gap-4 pt-2 border-t border-gray-100 mt-2">
                                        <span className="text-xs font-bold text-gray-500 uppercase">Self Evaluation:</span>
                                        <div className="flex gap-2">
                                            <button 
                                                onClick={() => toggleSelfGrading(q.id, true)}
                                                className={`px-3 py-1 rounded-full text-xs font-bold border transition-colors ${selfGrading[q.id] === true ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-400 border-gray-200 hover:border-green-300'}`}
                                            >
                                                Correct (+{quizConfig.subjectiveMarks})
                                            </button>
                                            <button 
                                                onClick={() => toggleSelfGrading(q.id, false)}
                                                className={`px-3 py-1 rounded-full text-xs font-bold border transition-colors ${selfGrading[q.id] === false || selfGrading[q.id] === undefined ? 'bg-red-500 text-white border-red-500' : 'bg-white text-gray-400 border-gray-200 hover:border-red-300'}`}
                                            >
                                                Incorrect (0)
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="text-center">
          <button 
            onClick={() => {
              setGameState('upload');
              setQuestions([]);
              setUserAnswers({});
              setSelfGrading({});
              setCurrentQuestionIndex(0);
              setParseError(null);
            }}
            className="bg-white hover:bg-gray-50 text-gray-700 px-8 py-3 rounded-xl font-bold shadow-sm border border-gray-200 transition-all flex items-center gap-2 mx-auto"
          >
            <RotateCcw size={20} />
            Create New Quiz
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 font-sans text-gray-900 flex flex-col">
      <nav className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="bg-slate-900 p-2 rounded-lg">
            <FileText size={20} className="text-white" />
          </div>
          <span className="font-bold text-xl tracking-tight text-slate-800">QuizMaker <span className="text-blue-600 text-sm font-normal ml-1">Pro</span></span>
        </div>
      </nav>
      <main className="flex-grow flex flex-col items-center justify-center p-4">
        {gameState === 'upload' && UploadView()}
        {gameState === 'config' && ConfigView()}
        {gameState === 'playing' && QuizView()}
        {gameState === 'result' && ResultView()}
      </main>
    </div>
  );
};

export default App;