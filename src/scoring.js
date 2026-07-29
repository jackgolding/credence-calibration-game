/**
 * Convert a chosen answer and stated confidence to a probability that the
 * proposition is true.
 */
export function probabilityOfTrue(selectedAnswer, confidencePercent) {
  const confidence = Number(confidencePercent) / 100;

  if (typeof selectedAnswer !== "boolean") {
    throw new TypeError("selectedAnswer must be a boolean");
  }

  if (!Number.isFinite(confidence) || confidence < 0.5 || confidence > 1) {
    throw new RangeError("confidence must be between 50 and 100");
  }

  return selectedAnswer ? confidence : 1 - confidence;
}

/**
 * Binary Brier score. Zero is perfect and one is the worst possible score.
 */
export function brierScore(probability, outcome) {
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new RangeError("probability must be between 0 and 1");
  }

  if (typeof outcome !== "boolean") {
    throw new TypeError("outcome must be a boolean");
  }

  return (probability - Number(outcome)) ** 2;
}

export function scoreAnswer(selectedAnswer, confidencePercent, actualAnswer) {
  const probability = probabilityOfTrue(selectedAnswer, confidencePercent);
  const correct = selectedAnswer === actualAnswer;

  return {
    probability,
    correct,
    brier: brierScore(probability, actualAnswer),
  };
}

/**
 * Group attempts by confidence and compare mean confidence with accuracy.
 */
export function calibrationBuckets(attempts) {
  const grouped = new Map();

  for (const attempt of attempts) {
    const confidence = Number(attempt.confidence);
    if (!Number.isFinite(confidence)) continue;

    const bucket = grouped.get(confidence) ?? {
      confidence,
      correct: 0,
      count: 0,
    };

    bucket.count += 1;
    bucket.correct += attempt.correct ? 1 : 0;
    grouped.set(confidence, bucket);
  }

  return [...grouped.values()]
    .sort((a, b) => a.confidence - b.confidence)
    .map((bucket) => ({
      ...bucket,
      accuracy: bucket.correct / bucket.count,
      gap: bucket.correct / bucket.count - bucket.confidence / 100,
    }));
}

export function summarizeAttempts(attempts) {
  if (!Array.isArray(attempts) || attempts.length === 0) {
    return {
      accuracy: 0,
      meanBrier: 0,
      meanConfidence: 0,
      calibrationGap: 0,
      correct: 0,
      total: 0,
    };
  }

  const totals = attempts.reduce(
    (result, attempt) => {
      result.correct += attempt.correct ? 1 : 0;
      result.brier += attempt.brier;
      result.confidence += Number(attempt.confidence);
      return result;
    },
    { correct: 0, brier: 0, confidence: 0 },
  );

  const total = attempts.length;
  const accuracy = totals.correct / total;
  const meanConfidence = totals.confidence / total / 100;

  return {
    accuracy,
    meanBrier: totals.brier / total,
    meanConfidence,
    calibrationGap: meanConfidence - accuracy,
    correct: totals.correct,
    total,
  };
}
