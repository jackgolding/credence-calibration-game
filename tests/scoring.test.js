import test from "node:test";
import assert from "node:assert/strict";

import {
  brierScore,
  calibrationBuckets,
  isCorrectOrder,
  probabilityOfTrue,
  scoreAnswer,
  summarizeAttempts,
} from "../src/scoring.js";

test("converts answer confidence to probability of true", () => {
  assert.equal(probabilityOfTrue(true, 80), 0.8);
  assert.ok(Math.abs(probabilityOfTrue(false, 80) - 0.2) < 1e-12);
});

test("calculates binary Brier scores", () => {
  assert.equal(brierScore(1, true), 0);
  assert.equal(brierScore(0, true), 1);
  assert.ok(Math.abs(brierScore(0.8, false) - 0.64) < 1e-12);
});

test("scores a selected answer against the outcome", () => {
  const result = scoreAnswer(false, 70, false);

  assert.equal(result.correct, true);
  assert.ok(Math.abs(result.probability - 0.3) < 1e-12);
  assert.ok(Math.abs(result.brier - 0.09) < 1e-12);
});

test("checks whether a submitted result order is exact", () => {
  const correct = ["result-1", "result-2", "result-3"];

  assert.equal(isCorrectOrder([...correct], correct), true);
  assert.equal(
    isCorrectOrder(["result-2", "result-1", "result-3"], correct),
    false,
  );
  assert.equal(isCorrectOrder(["result-1", "result-2"], correct), false);
});

test("summarizes a run", () => {
  const summary = summarizeAttempts([
    { correct: true, confidence: 80, brier: 0.04 },
    { correct: false, confidence: 60, brier: 0.36 },
  ]);

  assert.equal(summary.correct, 1);
  assert.equal(summary.total, 2);
  assert.equal(summary.accuracy, 0.5);
  assert.ok(Math.abs(summary.meanBrier - 0.2) < 1e-12);
  assert.ok(Math.abs(summary.meanConfidence - 0.7) < 1e-12);
  assert.ok(Math.abs(summary.calibrationGap - 0.2) < 1e-12);
});

test("groups calibration by stated confidence", () => {
  const buckets = calibrationBuckets([
    { correct: true, confidence: 70 },
    { correct: false, confidence: 70 },
    { correct: true, confidence: 90 },
  ]);

  assert.deepEqual(
    buckets.map(({ confidence, count, accuracy }) => ({
      confidence,
      count,
      accuracy,
    })),
    [
      { confidence: 70, count: 2, accuracy: 0.5 },
      { confidence: 90, count: 1, accuracy: 1 },
    ],
  );
});

test("rejects confidence outside the game range", () => {
  assert.throws(() => probabilityOfTrue(true, 49), RangeError);
  assert.throws(() => probabilityOfTrue(false, 101), RangeError);
});
