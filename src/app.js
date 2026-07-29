import { APPS_SCRIPT_URL, GAME_CONFIG } from "./config.js";
import {
  calibrationBuckets,
  scoreAnswer,
  summarizeAttempts,
} from "./scoring.js";

const elements = {
  loading: document.querySelector("#loading-view"),
  start: document.querySelector("#start-view"),
  game: document.querySelector("#game-view"),
  results: document.querySelector("#results-view"),
  error: document.querySelector("#error-view"),
  startForm: document.querySelector("#start-form"),
  nickname: document.querySelector("#nickname"),
  questionCount: document.querySelector("#question-count"),
  progressLabel: document.querySelector("#progress-label"),
  progressBar: document.querySelector("#progress-bar"),
  progressTrack: document.querySelector(".progress-track"),
  runningScore: document.querySelector("#running-score"),
  questionPrompt: document.querySelector("#question-prompt"),
  answerForm: document.querySelector("#answer-form"),
  answerFieldset: document.querySelector("#answer-fieldset"),
  confidence: document.querySelector("#confidence"),
  confidenceOutput: document.querySelector("#confidence-output"),
  answerError: document.querySelector("#answer-error"),
  feedback: document.querySelector("#feedback"),
  feedbackVerdict: document.querySelector("#feedback-verdict"),
  feedbackTitle: document.querySelector("#feedback-title"),
  feedbackExplanation: document.querySelector("#feedback-explanation"),
  feedbackBrier: document.querySelector("#feedback-brier"),
  nextButton: document.querySelector("#next-button"),
  resultsSummary: document.querySelector("#results-summary"),
  accuracyMetric: document.querySelector("#accuracy-metric"),
  accuracyDetail: document.querySelector("#accuracy-detail"),
  brierMetric: document.querySelector("#brier-metric"),
  gapMetric: document.querySelector("#gap-metric"),
  calibrationChart: document.querySelector("#calibration-chart"),
  restartButton: document.querySelector("#restart-button"),
  loadError: document.querySelector("#load-error"),
  retryButton: document.querySelector("#retry-button"),
};

let questions = [];
let usingDemoQuestions = false;
let state = newState();

function newState() {
  return {
    sessionId: createSessionId(),
    nickname: "",
    currentIndex: 0,
    attempts: [],
    started: false,
  };
}

function createSessionId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function showView(view) {
  for (const candidate of [
    elements.loading,
    elements.start,
    elements.game,
    elements.results,
    elements.error,
  ]) {
    candidate.hidden = candidate !== view;
  }
}

function parseAnswer(answer) {
  if (typeof answer === "boolean") return answer;
  if (typeof answer === "string") {
    const normalized = answer.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  throw new Error("A question has an invalid answer.");
}

function validateQuestions(payload) {
  const rawQuestions = Array.isArray(payload) ? payload : payload?.questions;
  if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
    throw new Error("No active questions were found.");
  }

  return rawQuestions.map((question, index) => {
    if (!question.id || !question.prompt) {
      throw new Error(`Question ${index + 1} is missing an id or prompt.`);
    }

    return {
      id: String(question.id),
      prompt: String(question.prompt),
      answer: parseAnswer(question.answer),
      explanation: String(question.explanation || "No explanation provided."),
    };
  });
}

async function loadQuestions() {
  showView(elements.loading);

  try {
    if (APPS_SCRIPT_URL) {
      try {
        questions = validateQuestions(await loadJsonp(APPS_SCRIPT_URL));
        usingDemoQuestions = false;
      } catch (remoteError) {
        console.warn("Could not load Apps Script questions; using demo data.", remoteError);
        questions = await loadLocalQuestions();
        usingDemoQuestions = true;
      }
    } else {
      questions = await loadLocalQuestions();
      usingDemoQuestions = true;
    }

    restoreState();
    routeFromState();
  } catch (error) {
    elements.loadError.textContent =
      error instanceof Error ? error.message : "Please try again.";
    showView(elements.error);
  }
}

async function loadLocalQuestions() {
  const response = await fetch(GAME_CONFIG.localQuestionsUrl, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error("The demo questions could not be loaded.");
  return validateQuestions(await response.json());
}

function loadJsonp(endpoint) {
  return new Promise((resolve, reject) => {
    const callbackName = `credenceCallback_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2)}`;
    const script = document.createElement("script");
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("The question service timed out."));
    }, GAME_CONFIG.requestTimeoutMs);

    function cleanup() {
      window.clearTimeout(timeout);
      script.remove();
      delete window[callbackName];
    }

    window[callbackName] = (payload) => {
      cleanup();
      if (payload?.ok === false) {
        reject(new Error(payload.error || "The question service returned an error."));
        return;
      }
      resolve(payload);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error("The question service could not be reached."));
    };

    const url = new URL(endpoint);
    url.searchParams.set("action", "questions");
    url.searchParams.set("callback", callbackName);
    script.src = url.toString();
    document.head.append(script);
  });
}

function restoreState() {
  try {
    const saved = JSON.parse(localStorage.getItem(GAME_CONFIG.storageKey));
    if (!saved?.sessionId || !Array.isArray(saved.attempts)) return;

    const validQuestionIds = new Set(questions.map((question) => question.id));
    const attemptsAreValid = saved.attempts.every((attempt) =>
      validQuestionIds.has(attempt.questionId),
    );
    if (!attemptsAreValid) return;

    state = {
      sessionId: String(saved.sessionId),
      nickname: String(saved.nickname || "").slice(0, 40),
      currentIndex: Math.min(
        Math.max(Number(saved.currentIndex) || 0, 0),
        questions.length,
      ),
      attempts: saved.attempts,
      started: Boolean(saved.started),
    };
  } catch {
    localStorage.removeItem(GAME_CONFIG.storageKey);
  }
}

function saveState() {
  localStorage.setItem(GAME_CONFIG.storageKey, JSON.stringify(state));
}

function routeFromState() {
  if (!state.started) {
    elements.nickname.value = state.nickname;
    const sourceNote = usingDemoQuestions ? " · demo mode" : "";
    elements.questionCount.textContent = `${questions.length} questions${sourceNote}`;
    showView(elements.start);
    return;
  }

  if (state.currentIndex >= questions.length) {
    renderResults();
    return;
  }

  renderQuestion();
}

function updateConfidence() {
  const value = Number(elements.confidence.value);
  elements.confidenceOutput.value = `${value}%`;
  elements.confidence.style.setProperty(
    "--range-progress",
    `${((value - 50) / 50) * 100}%`,
  );
}

function renderQuestion() {
  const question = questions[state.currentIndex];
  const previousAttempt = state.attempts.find(
    (attempt) => attempt.questionId === question.id,
  );
  const completed = state.attempts.length;
  const total = questions.length;
  const progress = (completed / total) * 100;

  elements.progressLabel.textContent = `Question ${state.currentIndex + 1} of ${total}`;
  elements.progressBar.style.width = `${progress}%`;
  elements.progressTrack.setAttribute("aria-valuenow", String(Math.round(progress)));
  elements.questionPrompt.textContent = question.prompt;
  elements.answerError.textContent = "";

  const summary = summarizeAttempts(state.attempts);
  elements.runningScore.textContent = summary.total
    ? `${Math.round(summary.accuracy * 100)}% correct · ${summary.meanBrier.toFixed(3)} Brier`
    : "No score yet";

  if (previousAttempt) {
    showFeedback(question, previousAttempt, false);
  } else {
    elements.answerForm.hidden = false;
    elements.feedback.hidden = true;
    elements.answerFieldset.disabled = false;
    elements.answerForm.reset();
    elements.confidence.value = "70";
    updateConfidence();
  }

  showView(elements.game);
}

function handleStart(event) {
  event.preventDefault();
  state.nickname = elements.nickname.value.trim().slice(0, 40);
  state.started = true;
  saveState();
  renderQuestion();
}

function handleAnswer(event) {
  event.preventDefault();
  const formData = new FormData(elements.answerForm);
  const rawAnswer = formData.get("answer");

  if (rawAnswer !== "true" && rawAnswer !== "false") {
    elements.answerError.textContent = "Choose true or false before continuing.";
    return;
  }

  const question = questions[state.currentIndex];
  const selectedAnswer = rawAnswer === "true";
  const confidence = Number(elements.confidence.value);
  const score = scoreAnswer(selectedAnswer, confidence, question.answer);
  const attempt = {
    questionId: question.id,
    selectedAnswer,
    confidence,
    probability: score.probability,
    correct: score.correct,
    brier: score.brier,
  };

  state.attempts.push(attempt);
  saveState();
  showFeedback(question, attempt, true);
  void sendResponse(attempt);
}

function showFeedback(question, attempt, shouldFocus) {
  elements.answerForm.hidden = true;
  elements.feedback.hidden = false;
  elements.feedback.className = `feedback ${attempt.correct ? "correct" : "incorrect"}`;
  elements.feedbackVerdict.textContent = attempt.correct ? "Correct" : "Not quite";
  elements.feedbackTitle.textContent = `The answer is ${question.answer ? "true" : "false"}.`;
  elements.feedbackExplanation.textContent = question.explanation;
  elements.feedbackBrier.textContent = Number(attempt.brier).toFixed(3);
  elements.nextButton.textContent =
    state.currentIndex === questions.length - 1
      ? "See calibration report"
      : "Next question";

  if (shouldFocus) elements.feedback.focus();
}

async function sendResponse(attempt) {
  if (!APPS_SCRIPT_URL || usingDemoQuestions) return;

  const payload = {
    sessionId: state.sessionId,
    nickname: state.nickname,
    questionId: attempt.questionId,
    selectedAnswer: attempt.selectedAnswer,
    confidence: attempt.confidence,
  };

  try {
    await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch (error) {
    console.warn("The response could not be saved to Google Sheets.", error);
  }
}

function handleNext() {
  state.currentIndex += 1;
  saveState();
  routeFromState();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderResults() {
  const summary = summarizeAttempts(state.attempts);
  const accuracyPercent = Math.round(summary.accuracy * 100);
  const gapPoints = Math.round(summary.calibrationGap * 100);

  elements.resultsSummary.textContent = calibrationMessage(summary);
  elements.accuracyMetric.textContent = `${accuracyPercent}%`;
  elements.accuracyDetail.textContent = `${summary.correct} of ${summary.total} correct`;
  elements.brierMetric.textContent = summary.meanBrier.toFixed(3);
  elements.gapMetric.textContent =
    gapPoints === 0 ? "0 pts" : `${gapPoints > 0 ? "+" : ""}${gapPoints} pts`;

  elements.calibrationChart.replaceChildren();
  for (const bucket of calibrationBuckets(state.attempts)) {
    const row = document.createElement("div");
    row.className = "chart-row";

    const label = document.createElement("strong");
    label.textContent = `${bucket.confidence}%`;

    const track = document.createElement("div");
    track.className = "chart-track";
    const bar = document.createElement("span");
    bar.style.width = `${bucket.accuracy * 100}%`;
    track.append(bar);

    const result = document.createElement("span");
    result.className = "chart-result";
    result.textContent = `${Math.round(bucket.accuracy * 100)}% right (${bucket.count})`;

    row.append(label, track, result);
    elements.calibrationChart.append(row);
  }

  showView(elements.results);
}

function calibrationMessage(summary) {
  const gap = summary.calibrationGap;
  if (Math.abs(gap) <= 0.05) {
    return "Your confidence closely matched your accuracy. That is the heart of good calibration.";
  }
  if (gap > 0) {
    return "You were more confident than your results support. Try leaving a little more room for doubt.";
  }
  return "You knew more than you gave yourself credit for. Your answers support a little more confidence.";
}

function restartGame() {
  state = newState();
  localStorage.removeItem(GAME_CONFIG.storageKey);
  routeFromState();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

elements.startForm.addEventListener("submit", handleStart);
elements.answerForm.addEventListener("submit", handleAnswer);
elements.confidence.addEventListener("input", updateConfidence);
elements.nextButton.addEventListener("click", handleNext);
elements.restartButton.addEventListener("click", restartGame);
elements.retryButton.addEventListener("click", loadQuestions);

updateConfidence();
void loadQuestions();
