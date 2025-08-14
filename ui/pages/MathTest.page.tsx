import { useState, useRef, useEffect, useCallback } from "react";
import styles from "./MathTest.page.module.css";
import { mulberry32, generateProblem, ProblemConfig, MathProblem } from "./mathTestUtils";

const DEFAULT_CONFIG: ProblemConfig = {
  easyUntil: 5,
  mediumUntil: 12,
  hardUntil: 20,
};

const GAME_DURATION = 10; // seconds
const NUMPAD = [
  [1, 2, 3],
  [4, 5, 6],
  [7, 8, 9],
  ["del", 0, "ok"],
];

function pad(n: number) {
  return n < 10 ? `0${n}` : n;
}

export default function MathTestPage() {
  const [roomCode, setRoomCode] = useState("");
  const [started, setStarted] = useState(false);
  const [timeLeft, setTimeLeft] = useState(GAME_DURATION);
  const [problems, setProblems] = useState<MathProblem[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [input, setInput] = useState("");
  const [answers, setAnswers] = useState<{ input: string; correct: boolean }[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const [showResults, setShowResults] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [playAgainDisabled, setPlayAgainDisabled] = useState(false);

  // Start game
  function handleStart() {
    let s = 0;
    for (let i = 0; i < roomCode.length; ++i) s += roomCode.charCodeAt(i) * (i + 1);
    // setSeed(s);
    setStarted(true);
    setTimeLeft(GAME_DURATION);
    setCurrentIdx(0);
    setInput("");
    setAnswers([]);
    setShowResults(false);
    // Pre-generate a large number of problems for the session
    const rng = mulberry32(s);
    const arr: MathProblem[] = [];
    for (let i = 0; i < 200; ++i) arr.push(generateProblem(i, rng, DEFAULT_CONFIG));
    setProblems(arr);
    console.log(arr);
  }

  // Timer effect
  useEffect(() => {
    if (!started || showResults) return;
    if (timeLeft <= 0) {
      setShowResults(true);
      return;
    }
    timerRef.current = setTimeout(() => setTimeLeft((t) => t - 1), 1000);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [started, timeLeft, showResults]);

  // Handle numpad
  function handleNumpad(val: number | string) {
    if (val === "del") setInput(input.slice(0, -1));
    else if (val === "ok") {
      if (input.trim() !== "") submitAnswer();
    } else setInput(input + String(val));
  }

  const submitAnswer = useCallback(() => {
    if (!started || showResults) return;
    if (input.trim() === "") return;
    const prob = problems[currentIdx];
    const correct = Number(input) === prob.answer;
    setAnswers((a) => [...a, { input, correct }]);
    setInput("");
    setCurrentIdx((idx) => idx + 1);
  }, [started, showResults, problems, currentIdx, input]);

  // If time runs out, show results
  useEffect(() => {
    if (showResults) return;
    if (started && timeLeft <= 0) setShowResults(true);
  }, [timeLeft, started, showResults]);

  // Focus input on mobile (optional, not using real input)

  // Keyboard input for desktop
  useEffect(() => {
    if (!started || showResults) return;
    const handleKey = (e: KeyboardEvent) => {
      if (document.activeElement && (document.activeElement as HTMLElement).tagName === "INPUT")
        return;
      if (e.key >= "0" && e.key <= "9") {
        setInput((prev) => prev + e.key);
      } else if (e.key === "Backspace") {
        setInput((prev) => prev.slice(0, -1));
      } else if (e.key === "Enter") {
        if (input.trim() !== "") submitAnswer();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [started, showResults, submitAnswer, input]);

  useEffect(() => {
    if (showResults) {
      setPlayAgainDisabled(true);
      const t = setTimeout(() => setPlayAgainDisabled(false), 10000);
      return () => clearTimeout(t);
    } else {
      setPlayAgainDisabled(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showResults]);

  // Render
  if (!started) {
    return (
      <div className={styles.container}>
        <h1>Math Test</h1>
        <input
          className={styles.roomCodeInput}
          placeholder="Enter Room Code"
          value={roomCode}
          onChange={(e) => setRoomCode(e.target.value.toUpperCase().trim())}
          maxLength={16}
        />
        <button className={styles.startBtn} onClick={handleStart} disabled={!roomCode.trim()}>
          Start Game
        </button>
        <p className={styles.roomCodeInfo}>
          Room code determines the sequence of problems. Share it to play the same test with
          friends!
        </p>
      </div>
    );
  }

  if (showResults) {
    const correctCount = answers.filter((a) => a.correct).length;
    return (
      <div className={styles.container}>
        <div className={styles.results}>
          <h2>Time's up!</h2>
          <div className={styles["score-row"]}>
            <span className={styles["score-big"]}>{correctCount}</span>
            <span className={styles["score-total"]}>/{answers.length}</span>
          </div>
          <div className={styles["results-list"]}>
            <ul>
              {answers.map((a, i) => {
                const prob = problems[i];
                return (
                  <li key={i}>
                    <span>
                      {prob.question} = {a.input}
                    </span>
                    {a.correct ? (
                      <span className={styles.correct}>✔</span>
                    ) : (
                      <span className={styles.wrong}>✘ ({prob.answer})</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
          <button
            className={styles.startBtn + " " + styles.playAgainBtn}
            onClick={() => {
              setStarted(false);
              setRoomCode("");
            }}
            disabled={playAgainDisabled}
          >
            Play Again
          </button>
        </div>
      </div>
    );
  }

  const prob = problems[currentIdx];
  return (
    <div className={styles.container}>
      <div className={styles.timer}>
        {pad(Math.floor(timeLeft / 60))}:{pad(timeLeft % 60)}
      </div>
      <div className={styles.problem}>{prob?.question}</div>
      {/* Hidden input for desktop typing, focusable for accessibility */}
      <input
        ref={inputRef}
        style={{ position: "absolute", left: "-9999px", width: 0, height: 0, opacity: 0 }}
        tabIndex={-1}
        value={input}
        onChange={() => {}}
        inputMode="numeric"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        aria-hidden="true"
      />
      <div
        className={styles.input}
        tabIndex={0}
        onFocus={() => inputRef.current?.focus()}
        style={{ outline: "none" }}
      >
        {input || "\u00A0"}
      </div>
      <div className={styles.numpad}>
        {NUMPAD.flat().map((val, i) => (
          <button
            key={i}
            onClick={() => handleNumpad(val)}
            aria-label={typeof val === "number" ? String(val) : val === "del" ? "Delete" : "OK"}
            style={
              val === "del"
                ? { background: "#fee2e2" }
                : val === "ok"
                  ? { background: "#bbf7d0" }
                  : {}
            }
          >
            {val === "del" ? "⌫" : val === "ok" ? "OK" : val}
          </button>
        ))}
      </div>
    </div>
  );
}
