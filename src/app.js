import { APPS_SCRIPT_URL, GAME_CONFIG } from "./config.js?v=6";
import { appendGlossaryText } from "./glossary.js?v=6";
import {
  calibrationBuckets,
  isCorrectOrder,
  scoreAnswer,
  summarizeAttempts,
} from "./scoring.js?v=6";

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
  questionPrompt: document.querySelector("#question-prompt"),
  serpBuilder: document.querySelector("#serp-builder"),
  builderStatus: document.querySelector("#builder-status"),
  answerForm: document.querySelector("#answer-form"),
  answerFieldset: document.querySelector("#answer-fieldset"),
  confidence: document.querySelector("#confidence"),
  confidenceOutput: document.querySelector("#confidence-output"),
  answerError: document.querySelector("#answer-error"),
  resultsSummary: document.querySelector("#results-summary"),
  accuracyMetric: document.querySelector("#accuracy-metric"),
  accuracyDetail: document.querySelector("#accuracy-detail"),
  brierMetric: document.querySelector("#brier-metric"),
  gapMetric: document.querySelector("#gap-metric"),
  calibrationChart: document.querySelector("#calibration-chart"),
  answerReview: document.querySelector("#answer-review"),
  restartButton: document.querySelector("#restart-button"),
  resetButton: document.querySelector("#reset-button"),
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
      results: validateResults(question.results, index),
    };
  });
}

function validateResults(rawResults, questionIndex) {
  if (!Array.isArray(rawResults) || rawResults.length !== 3) {
    throw new Error(`Question ${questionIndex + 1} must have three results.`);
  }

  return rawResults.map((result, resultIndex) => {
    if (!result?.id || !result?.title || !result?.link) {
      throw new Error(
        `Result ${resultIndex + 1} in question ${questionIndex + 1} is incomplete.`,
      );
    }

    return {
      id: String(result.id),
      rank: Number(result.rank) || resultIndex + 1,
      site: String(result.site || "Search result"),
      title: String(result.title),
      link: String(result.link),
      displayUrl: String(result.displayUrl || result.link),
      snippet: String(result.snippet || ""),
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

    try {
      restoreState();
      routeFromState();
    } catch (routeError) {
      console.warn("Saved progress could not be restored.", routeError);
      localStorage.removeItem(GAME_CONFIG.storageKey);
      state = newState();
      routeFromState();
    }
  } catch (error) {
    elements.loadError.textContent =
      error instanceof Error ? error.message : "Please try again.";
    showView(elements.error);
  }
}

async function loadLocalQuestions() {
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    GAME_CONFIG.requestTimeoutMs,
  );

  try {
    const response = await fetch(GAME_CONFIG.localQuestionsUrl, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("The demo questions could not be loaded.");
    return validateQuestions(await response.json());
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Loading questions timed out. Please try again.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
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
    const attemptsAreValid = saved.attempts.every(
      (attempt) =>
        validQuestionIds.has(attempt.questionId) &&
        Array.isArray(attempt.selectedOrder) &&
        attempt.selectedOrder.length === 3,
    );
    if (!attemptsAreValid) {
      localStorage.removeItem(GAME_CONFIG.storageKey);
      return;
    }

    state = {
      sessionId: String(saved.sessionId),
      nickname: String(saved.nickname || "").slice(0, 40),
      currentIndex: Math.min(
        Math.max(Number(saved.currentIndex) || 0, saved.attempts.length, 0),
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
  if (!questions.length) {
    showView(elements.loading);
    return;
  }

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

  try {
    renderQuestion();
  } catch (error) {
    console.warn("Could not render the current question.", error);
    localStorage.removeItem(GAME_CONFIG.storageKey);
    state = newState();
    elements.nickname.value = "";
    const sourceNote = usingDemoQuestions ? " · demo mode" : "";
    elements.questionCount.textContent = `${questions.length} questions${sourceNote}`;
    showView(elements.start);
  }
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
  const completed = state.attempts.length;
  const total = questions.length;
  const progress = (completed / total) * 100;

  elements.progressLabel.textContent = `Question ${state.currentIndex + 1} of ${total}`;
  elements.progressBar.style.width = `${progress}%`;
  elements.progressTrack.setAttribute("aria-valuenow", String(Math.round(progress)));
  elements.questionPrompt.replaceChildren();
  appendGlossaryText(elements.questionPrompt, question.prompt);
  renderSerpBuilder(shuffleResults(question.results, state.currentIndex));
  elements.answerError.textContent = "";
  elements.answerFieldset.disabled = false;
  elements.answerForm.reset();
  elements.confidence.value = "70";
  updateConfidence();

  showView(elements.game);
}

function shuffleResults(results, questionIndex) {
  const permutations = [
    [1, 0, 2],
    [2, 0, 1],
    [1, 2, 0],
    [2, 1, 0],
    [0, 2, 1],
  ];
  const order = permutations[questionIndex % permutations.length];
  return order.map((index) => results[index]);
}

function renderSerpBuilder(results) {
  elements.serpBuilder.replaceChildren(
    ...results.map((result, index) => createSerpResult(result, index, true)),
  );
  elements.builderStatus.textContent = "";
  updateBuilderPositions();
}

function createSerpResult(result, index, movable = false) {
  const item = document.createElement("li");
  item.className = "serp-result";
  item.dataset.resultId = result.id;
  item.draggable = movable;

  const position = document.createElement("span");
  position.className = "serp-position";
  position.textContent = String(index + 1);

  const content = document.createElement("div");
  content.className = "serp-result-content";

  const source = document.createElement("div");
  source.className = "serp-source";
  const favicon = document.createElement("span");
  favicon.className = "serp-favicon";
  favicon.textContent = result.site.charAt(0).toUpperCase();
  const sourceText = document.createElement("span");
  const site = document.createElement("strong");
  appendGlossaryText(site, result.site);
  const url = document.createElement("small");
  url.textContent = result.displayUrl;
  sourceText.append(site, url);
  source.append(favicon, sourceText);

  const title = document.createElement("h3");
  title.textContent = result.title;
  const snippet = document.createElement("p");
  snippet.textContent = result.snippet;
  content.append(source, title, snippet);

  item.append(position, content);

  if (movable) {
    const controls = document.createElement("div");
    controls.className = "serp-move-controls";
    controls.append(
      createMoveButton("up", "↑"),
      createMoveButton("down", "↓"),
    );
    item.append(controls);
  }

  return item;
}

function createMoveButton(direction, symbol) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "serp-move-button";
  button.dataset.move = direction;
  button.textContent = symbol;
  return button;
}

function updateBuilderPositions() {
  const items = [...elements.serpBuilder.children];
  items.forEach((item, index) => {
    item.querySelector(".serp-position").textContent = String(index + 1);
    item.setAttribute(
      "aria-label",
      `Position ${index + 1}: ${item.querySelector(".serp-source strong").textContent}`,
    );

    const up = item.querySelector('[data-move="up"]');
    const down = item.querySelector('[data-move="down"]');
    up.disabled = index === 0;
    down.disabled = index === items.length - 1;
    up.setAttribute("aria-label", `Move result at position ${index + 1} up`);
    down.setAttribute("aria-label", `Move result at position ${index + 1} down`);
  });
}

function handleResultMove(event) {
  const button = event.target.closest("[data-move]");
  if (!button) return;

  const item = button.closest(".serp-result");
  const direction = button.dataset.move;
  const sibling =
    direction === "up" ? item.previousElementSibling : item.nextElementSibling;
  if (!sibling) return;

  if (direction === "up") {
    elements.serpBuilder.insertBefore(item, sibling);
  } else {
    elements.serpBuilder.insertBefore(sibling, item);
  }

  updateBuilderPositions();
  const position = [...elements.serpBuilder.children].indexOf(item) + 1;
  elements.builderStatus.textContent = `Moved ${item.querySelector(".serp-source strong").textContent} to position ${position}.`;
  const requestedButton = item.querySelector(`[data-move="${direction}"]`);
  const fallbackButton = item.querySelector(
    `[data-move="${direction === "up" ? "down" : "up"}"]`,
  );
  (requestedButton.disabled ? fallbackButton : requestedButton).focus();
}

function handleResultDragStart(event) {
  const item = event.target.closest(".serp-result");
  if (!item) return;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", item.dataset.resultId);
  item.classList.add("dragging");
}

function handleResultDragOver(event) {
  event.preventDefault();
  const dragged = elements.serpBuilder.querySelector(".dragging");
  const target = event.target.closest(".serp-result");
  if (!dragged || !target || dragged === target) return;

  const targetBounds = target.getBoundingClientRect();
  const placeAfter = event.clientY > targetBounds.top + targetBounds.height / 2;
  elements.serpBuilder.insertBefore(
    dragged,
    placeAfter ? target.nextElementSibling : target,
  );
  updateBuilderPositions();
}

function handleResultDragEnd(event) {
  const item = event.target.closest(".serp-result");
  if (!item) return;
  item.classList.remove("dragging");
  const position = [...elements.serpBuilder.children].indexOf(item) + 1;
  elements.builderStatus.textContent = `Moved ${item.querySelector(".serp-source strong").textContent} to position ${position}.`;
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
  const question = questions[state.currentIndex];
  const selectedOrder = [...elements.serpBuilder.children].map(
    (result) => result.dataset.resultId,
  );
  const correctOrder = question.results.map((result) => result.id);
  const orderIsCorrect = isCorrectOrder(selectedOrder, correctOrder);
  const confidence = Number(elements.confidence.value);
  const score = scoreAnswer(true, confidence, orderIsCorrect);
  const attempt = {
    questionId: question.id,
    selectedAnswer: orderIsCorrect,
    selectedOrder,
    confidence,
    probability: score.probability,
    correct: score.correct,
    brier: score.brier,
  };

  state.attempts.push(attempt);
  state.currentIndex += 1;
  saveState();
  void sendResponse(attempt);
  routeFromState();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function sendResponse(attempt) {
  if (!APPS_SCRIPT_URL || usingDemoQuestions) return;

  const payload = {
    sessionId: state.sessionId,
    nickname: state.nickname,
    questionId: attempt.questionId,
    selectedAnswer: attempt.selectedAnswer,
    selectedOrder: attempt.selectedOrder,
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

  renderAnswerReview();
  showView(elements.results);
}

function renderAnswerReview() {
  const attemptsByQuestion = new Map(
    state.attempts.map((attempt) => [attempt.questionId, attempt]),
  );
  elements.answerReview.replaceChildren();

  questions.forEach((question, index) => {
    const attempt = attemptsByQuestion.get(question.id);
    if (!attempt) return;

    const item = document.createElement("section");
    item.className = `answer-review-item ${attempt.correct ? "correct" : "incorrect"}`;

    const heading = document.createElement("div");
    heading.className = "answer-review-heading";

    const number = document.createElement("span");
    number.className = "answer-review-number";
    number.textContent = `Question ${index + 1}`;

    const verdict = document.createElement("span");
    verdict.className = "answer-review-verdict";
    verdict.textContent = attempt.correct ? "Correct" : "Incorrect";

    const prompt = document.createElement("h3");
    appendGlossaryText(prompt, question.prompt);

    const answers = document.createElement("dl");
    answers.className = "answer-review-answers";
    appendReviewDetail(
      answers,
      "Your confidence",
      `${attempt.confidence}%`,
    );
    appendReviewDetail(
      answers,
      "Brier score",
      Number(attempt.brier).toFixed(3),
    );

    const orderComparison = document.createElement("div");
    orderComparison.className = "answer-order-comparison";
    const resultsById = new Map(
      question.results.map((result) => [result.id, result]),
    );
    const selectedResults = attempt.selectedOrder
      .map((id) => resultsById.get(id))
      .filter(Boolean);
    orderComparison.append(
      renderReviewOrder("Your order", selectedResults),
      renderReviewOrder("Correct order", question.results),
    );

    const explanation = document.createElement("p");
    explanation.className = "answer-review-explanation";
    appendGlossaryText(explanation, question.explanation);

    heading.append(number, verdict);
    item.append(heading, prompt, answers, orderComparison, explanation);
    elements.answerReview.append(item);
  });
}

function renderReviewOrder(label, results) {
  const section = document.createElement("section");
  section.className = "answer-order";
  const heading = document.createElement("h4");
  heading.textContent = label;
  const list = document.createElement("ol");
  list.className = "serp-builder serp-builder-compact";
  list.append(
    ...results.map((result, index) => createSerpResult(result, index)),
  );
  section.append(heading, list);
  return section;
}

function appendReviewDetail(list, label, value) {
  const group = document.createElement("div");
  const term = document.createElement("dt");
  term.textContent = label;
  const detail = document.createElement("dd");
  detail.textContent = value;
  group.append(term, detail);
  list.append(group);
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

function hasProgress() {
  return Boolean(state.started || state.attempts.length || state.nickname);
}

function resetGame({ confirm = false } = {}) {
  if (
    confirm &&
    hasProgress() &&
    !window.confirm(
      "Clear your current game and start over? Submitted answers already sent to Sheets stay saved.",
    )
  ) {
    return;
  }

  state = newState();
  if (elements.nickname) elements.nickname.value = "";
  localStorage.removeItem(GAME_CONFIG.storageKey);

  if (!questions.length) {
    window.location.reload();
    return;
  }

  routeFromState();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function restartGame() {
  resetGame({ confirm: false });
}

function handleResetClick() {
  resetGame({ confirm: true });
}

elements.startForm.addEventListener("submit", handleStart);
elements.answerForm.addEventListener("submit", handleAnswer);
elements.confidence.addEventListener("input", updateConfidence);
elements.serpBuilder.addEventListener("click", handleResultMove);
elements.serpBuilder.addEventListener("dragstart", handleResultDragStart);
elements.serpBuilder.addEventListener("dragover", handleResultDragOver);
elements.serpBuilder.addEventListener("dragend", handleResultDragEnd);
elements.restartButton.addEventListener("click", restartGame);
elements.resetButton.addEventListener("click", handleResetClick);
elements.retryButton.addEventListener("click", loadQuestions);

updateConfidence();
void loadQuestions();
