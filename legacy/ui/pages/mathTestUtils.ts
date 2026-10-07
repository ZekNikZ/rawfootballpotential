// Simple deterministic PRNG using Mulberry32
export function mulberry32(seed: number) {
  let t = seed;
  return function () {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export type MathProblem = {
  question: string;
  answer: number;
  type: "easy" | "medium" | "hard" | "veryhard";
};

export type ProblemConfig = {
  easyUntil: number;
  mediumUntil: number;
  hardUntil: number;
};

export function generateProblem(
  idx: number,
  rng: () => number,
  config: ProblemConfig
): MathProblem {
  // All types possible at any index, but harder types become more likely as idx increases
  // We'll use weighted probabilities that shift as idx increases
  // Weights: easy, medium, hard, veryhard
  const total = config.hardUntil;
  const progress = Math.min(idx / total, 1);
  // Start: [0.7, 0.2, 0.08, 0.02], End: [0.1, 0.2, 0.3, 0.4]
  const easyW = 0.7 - 0.6 * progress;
  const mediumW = 0.2;
  const hardW = 0.08 + 0.22 * progress;
  const veryhardW = 0.02 + 0.38 * progress;
  const weights = [easyW, mediumW, hardW, veryhardW];
  const types: MathProblem["type"][] = ["easy", "medium", "hard", "veryhard"];
  const roll = rng();
  let acc = 0;
  let type: MathProblem["type"] = "easy";
  for (let i = 0; i < weights.length; ++i) {
    acc += weights[i];
    if (roll < acc) {
      type = types[i];
      break;
    }
  }

  switch (type) {
    case "easy": {
      // single digit add/sub
      let a = Math.floor(rng() * 10);
      let b = Math.floor(rng() * 10);
      const op = rng() > 0.5 ? "+" : "-";
      if (op === "-" && b > a) {
        [a, b] = [b, a];
      }
      return {
        question: `${a} ${op} ${b}`,
        answer: op === "+" ? a + b : a - b,
        type,
      };
    }
    case "medium": {
      // multiplication up to 12x12
      const a = Math.floor(rng() * 12) + 1;
      const b = Math.floor(rng() * 12) + 1;
      return {
        question: `${a} × ${b}`,
        answer: a * b,
        type,
      };
    }
    case "hard": {
      // double digit add/sub
      let a = Math.floor(rng() * 40) + 10;
      let b = Math.floor(rng() * 40) + 10;
      const op = rng() > 0.5 ? "+" : "-";
      if (op === "-" && b > a) {
        [a, b] = [b, a];
      }
      return {
        question: `${a} ${op} ${b}`,
        answer: op === "+" ? a + b : a - b,
        type,
      };
    }
    case "veryhard": {
      // whole number division: dividend up to 144, divisor up to 12, quotient is whole number
      const divisor = Math.floor(rng() * 12) + 1;
      const quotient = Math.floor(rng() * 12) + 1;
      const dividend = divisor * quotient;
      return {
        question: `${dividend} ÷ ${divisor}`,
        answer: quotient,
        type,
      };
    }
  }
}
