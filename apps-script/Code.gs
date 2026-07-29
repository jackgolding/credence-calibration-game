const QUESTIONS_SHEET = "Questions";
const RESPONSES_SHEET = "Responses";

const QUESTION_HEADERS = [
  "id",
  "prompt",
  "answer",
  "explanation",
  "active",
];

const RESPONSE_HEADERS = [
  "timestamp",
  "sessionId",
  "nickname",
  "questionId",
  "selectedAnswer",
  "confidence",
  "actualAnswer",
  "correct",
  "probabilityOfTrue",
  "brierScore",
];

/**
 * Run once from the Apps Script editor after attaching the project to a Sheet.
 */
function setupSheets() {
  const spreadsheet = getSpreadsheet_();
  const questionsSheet = getOrCreateSheet_(
    spreadsheet,
    QUESTIONS_SHEET,
    QUESTION_HEADERS,
  );
  getOrCreateSheet_(spreadsheet, RESPONSES_SHEET, RESPONSE_HEADERS);

  if (questionsSheet.getLastRow() === 1) {
    questionsSheet
      .getRange(2, 1, SEED_QUESTIONS.length, QUESTION_HEADERS.length)
      .setValues(SEED_QUESTIONS);
    questionsSheet.autoResizeColumns(1, QUESTION_HEADERS.length);
  }
}

/**
 * JSONP endpoint used by the static GitHub Pages frontend.
 */
function doGet(event) {
  const callback = String(event && event.parameter && event.parameter.callback || "");
  if (!/^[A-Za-z_$][0-9A-Za-z_$]{0,127}$/.test(callback)) {
    return jsonOutput_({
      ok: false,
      error: "A valid JSONP callback is required.",
    });
  }

  try {
    const action = String(event.parameter.action || "questions");
    if (action !== "questions") throw new Error("Unknown action.");

    const payload = {
      ok: true,
      questions: getActiveQuestions_(),
    };

    return ContentService.createTextOutput(
      callback + "(" + JSON.stringify(payload) + ");",
    ).setMimeType(ContentService.MimeType.JAVASCRIPT);
  } catch (error) {
    return ContentService.createTextOutput(
      callback + "(" + JSON.stringify({
        ok: false,
        error: error.message || "Unable to load questions.",
      }) + ");",
    ).setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
}

/**
 * Append-only response endpoint. The frontend sends text/plain to avoid a CORS
 * preflight from GitHub Pages.
 */
function doPost(event) {
  try {
    const contents = event && event.postData && event.postData.contents;
    if (!contents) throw new Error("The request body is empty.");

    const payload = JSON.parse(contents);
    const result = recordResponse_(payload);
    return jsonOutput_({ ok: true, duplicate: result.duplicate });
  } catch (error) {
    return jsonOutput_({
      ok: false,
      error: error.message || "Unable to save the response.",
    });
  }
}

function getActiveQuestions_() {
  const sheet = requireSheet_(QUESTIONS_SHEET);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const headerMap = headerMap_(values[0], QUESTION_HEADERS);
  return values
    .slice(1)
    .filter(function (row) {
      return isActive_(row[headerMap.active]) && String(row[headerMap.id]).trim();
    })
    .map(function (row) {
      return {
        id: String(row[headerMap.id]).trim(),
        prompt: String(row[headerMap.prompt]).trim(),
        answer: parseSheetBoolean_(row[headerMap.answer], "answer"),
        explanation: String(row[headerMap.explanation]).trim(),
      };
    });
}

function recordResponse_(payload) {
  validateResponse_(payload);

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const question = findQuestion_(String(payload.questionId));
    if (!question) throw new Error("The question does not exist or is inactive.");

    const responseSheet = requireSheet_(RESPONSES_SHEET);
    const sessionId = cleanText_(payload.sessionId, 100);
    const questionId = cleanText_(payload.questionId, 100);

    if (hasResponse_(responseSheet, sessionId, questionId)) {
      return { duplicate: true };
    }

    const selectedAnswer = payload.selectedAnswer;
    const confidence = Number(payload.confidence);
    const probabilityOfTrue = selectedAnswer
      ? confidence / 100
      : 1 - confidence / 100;
    const correct = selectedAnswer === question.answer;
    const brier = Math.pow(
      probabilityOfTrue - (question.answer ? 1 : 0),
      2,
    );

    responseSheet.appendRow([
      new Date(),
      safeSheetText_(sessionId),
      safeSheetText_(cleanText_(payload.nickname || "", 40)),
      safeSheetText_(questionId),
      selectedAnswer,
      confidence,
      question.answer,
      correct,
      probabilityOfTrue,
      brier,
    ]);

    return { duplicate: false };
  } finally {
    lock.releaseLock();
  }
}

function validateResponse_(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("The response payload is invalid.");
  }
  if (!String(payload.sessionId || "").trim()) {
    throw new Error("sessionId is required.");
  }
  if (!String(payload.questionId || "").trim()) {
    throw new Error("questionId is required.");
  }
  if (typeof payload.selectedAnswer !== "boolean") {
    throw new Error("selectedAnswer must be true or false.");
  }

  const confidence = Number(payload.confidence);
  if (
    !Number.isInteger(confidence) ||
    confidence < 50 ||
    confidence > 100 ||
    confidence % 5 !== 0
  ) {
    throw new Error("confidence must be a 5-point increment from 50 to 100.");
  }
}

function findQuestion_(questionId) {
  const questions = getActiveQuestions_();
  for (let index = 0; index < questions.length; index += 1) {
    if (questions[index].id === questionId) return questions[index];
  }
  return null;
}

function hasResponse_(sheet, sessionId, questionId) {
  if (sheet.getLastRow() < 2) return false;

  const values = sheet
    .getRange(2, 1, sheet.getLastRow() - 1, RESPONSE_HEADERS.length)
    .getDisplayValues();
  const sessionIndex = RESPONSE_HEADERS.indexOf("sessionId");
  const questionIndex = RESPONSE_HEADERS.indexOf("questionId");

  return values.some(function (row) {
    return (
      String(row[sessionIndex]) === sessionId &&
      String(row[questionIndex]) === questionId
    );
  });
}

function getSpreadsheet_() {
  const configuredId =
    PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  if (configuredId) return SpreadsheetApp.openById(configuredId);

  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) {
    throw new Error(
      "No spreadsheet is available. Bind this script to a Google Sheet or set SPREADSHEET_ID.",
    );
  }
  return active;
}

function getOrCreateSheet_(spreadsheet, name, headers) {
  const sheet = spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
  } else {
    headerMap_(sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0], headers);
  }
  return sheet;
}

function requireSheet_(name) {
  const sheet = getSpreadsheet_().getSheetByName(name);
  if (!sheet) {
    throw new Error(
      'Missing "' + name + '" sheet. Run setupSheets() from the editor first.',
    );
  }
  return sheet;
}

function headerMap_(headerRow, requiredHeaders) {
  const map = {};
  headerRow.forEach(function (header, index) {
    map[String(header).trim()] = index;
  });

  requiredHeaders.forEach(function (header) {
    if (map[header] === undefined) {
      throw new Error('Missing required column "' + header + '".');
    }
  });
  return map;
}

function parseSheetBoolean_(value, fieldName) {
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error(fieldName + " must be TRUE or FALSE.");
}

function isActive_(value) {
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  return normalized === "true" || normalized === "yes" || normalized === "1";
}

function cleanText_(value, maxLength) {
  return String(value).trim().slice(0, maxLength);
}

function safeSheetText_(value) {
  return /^[=+\-@]/.test(value) ? "'" + value : value;
}

function jsonOutput_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

const SEED_QUESTIONS = [
  [
    "q-001",
    "Venus is the hottest planet in our solar system.",
    true,
    "Venus is hotter than Mercury because its dense atmosphere traps heat.",
    true,
  ],
  [
    "q-002",
    "The Great Wall of China is visible from the Moon with the naked eye.",
    false,
    "The wall is too narrow to distinguish from the Moon without magnification.",
    true,
  ],
  [
    "q-003",
    "An octopus has three hearts.",
    true,
    "Two pump blood through the gills and one circulates it through the body.",
    true,
  ],
  [
    "q-004",
    "Lightning never strikes the same place twice.",
    false,
    "Tall and isolated structures can be struck repeatedly.",
    true,
  ],
  [
    "q-005",
    "A day on Venus is longer than a year on Venus.",
    true,
    "Venus rotates in about 243 Earth days and orbits in about 225.",
    true,
  ],
];
