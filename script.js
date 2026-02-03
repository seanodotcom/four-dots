const ROWS = 8;
const COLS = 8;
const COLORS = ["#ff5c5c", "#ffbe3c", "#5fd38a", "#5ab3ff", "#b07cff"];
const LEVELS = [
  { target: 200, moves: 30 },
  { target: 260, moves: 28 },
  { target: 320, moves: 26 },
  { target: 400, moves: 24 },
  { target: 480, moves: 22 },
];

const gridEl = document.getElementById("grid");
const boardEl = document.getElementById("board");
const canvas = document.getElementById("pathCanvas");
const ctx = canvas.getContext("2d");
const scoreEl = document.getElementById("score");
const movesEl = document.getElementById("moves");
const targetEl = document.getElementById("target");
const levelEl = document.getElementById("level");
const bannerEl = document.getElementById("banner");
const nextLevelBtn = document.getElementById("nextLevel");
const soundToggleBtn = document.getElementById("soundToggle");
const cheatToggleBtn = document.getElementById("cheatToggle");

let grid = [];
let score = 0;
let moves = LEVELS[0].moves;
let levelIndex = 0;
let levelComplete = false;
let selectedPath = [];
let isDragging = false;
let selectedColor = null;
let looped = false;
let boardRect = null;
let fallStep = null;
let soundEnabled = true;
let audioCtx = null;
let isAnimating = false;
let fallEngine = null;
let fallAnimation = null;
let cheatEnabled = false;
const clickTracker = new Map();
let fallInProgress = false;
let fallResolvers = [];
let gridMetrics = null;

function makeCell(color, special = null, fall = 0) {
  return { color, special, fall };
}

function randomColor() {
  return Math.floor(Math.random() * COLORS.length);
}

function tintColor(hex, mix) {
  const value = hex.replace("#", "");
  const num = Number.parseInt(value, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  const to = 255;
  const rr = Math.round(r + (to - r) * mix);
  const gg = Math.round(g + (to - g) * mix);
  const bb = Math.round(b + (to - b) * mix);
  return `rgba(${rr}, ${gg}, ${bb}, 0.85)`;
}

function initGrid() {
  grid = Array.from({ length: ROWS }, () =>
    Array.from({ length: COLS }, () => makeCell(randomColor()))
  );
}

function renderGrid() {
  gridEl.innerHTML = "";
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const cell = grid[r][c];
      const dot = document.createElement("div");
      dot.className = "dot";
      dot.dataset.row = r;
      dot.dataset.col = c;
      dot.dataset.color = cell.color;
      dot.dataset.fall = cell.fall || 0;
      dot.style.background = COLORS[cell.color];
      if (cell.special) {
        dot.classList.add("special", cell.special);
        dot.dataset.special = cell.special;
      }
      if (cell.pendingBomb) {
        dot.classList.add("arming");
      }
      gridEl.appendChild(dot);
      cell.fall = 0;
    }
  }

  requestAnimationFrame(() => {
    computeGridMetrics();
    computeFallStep();
    applyFallAnimation();
  });
}

function computeFallStep() {
  const sample = gridEl.querySelector(".dot");
  if (!sample) return;
  const rect = sample.getBoundingClientRect();
  const style = getComputedStyle(gridEl);
  const gapValue = style.rowGap || style.gap || "0";
  const gap = Number.parseFloat(gapValue) || 0;
  fallStep = rect.height + gap;
}

function applyFallAnimation() {
  if (!fallStep) return;
  if (typeof Matter === "undefined") return;
  const dots = Array.from(gridEl.querySelectorAll(".dot"));
  const falling = dots
    .map((dot) => ({ dot, fall: Number(dot.dataset.fall || 0) }))
    .filter((entry) => entry.fall > 0);
  if (!falling.length) {
    finishFall();
    return;
  }

  if (fallAnimation) cancelAnimationFrame(fallAnimation);
  fallInProgress = true;
  fallEngine = Matter.Engine.create();
  fallEngine.gravity.y = 1.4;
  fallEngine.gravity.scale = 0.0016;
  fallEngine.positionIterations = 6;
  fallEngine.velocityIterations = 4;

  const maxFall = Math.max(...falling.map((entry) => entry.fall));
  const maxDistance = maxFall * fallStep;
  const tracker = Matter.Bodies.circle(0, -maxDistance, 10, {
    frictionAir: 0.02,
    restitution: 0,
  });
  Matter.World.add(fallEngine.world, tracker);

  const delayMap = new Map();
  const grouped = new Map();
  falling.forEach(({ dot, fall }) => {
    const col = Number(dot.dataset.col);
    if (!grouped.has(col)) grouped.set(col, []);
    grouped.get(col).push({ dot, fall, row: Number(dot.dataset.row) });
  });
  grouped.forEach((items) => {
    items.sort((a, b) => b.row - a.row);
    items.forEach((item, index) => {
      delayMap.set(item.dot, index);
    });
  });
  const maxDelayIndex = Math.max(...Array.from(delayMap.values()));
  const maxDelay = Math.min(0.45, maxDelayIndex * 0.12);

  falling.forEach(({ dot, fall }) => {
    dot.style.transition = "none";
    dot.style.transform = `translateY(${-fall * fallStep}px)`;
  });

  const timeStep = 1000 / 60;
  let lastTime = performance.now();
  let accumulator = 0;
  let frames = 0;
  const step = (now) => {
    const delta = now - lastTime;
    lastTime = now;
    accumulator = Math.min(100, accumulator + delta);
    while (accumulator >= timeStep) {
      Matter.Engine.update(fallEngine, timeStep);
      accumulator -= timeStep;
    }
    const progress = Math.min(1, (tracker.position.y + maxDistance) / maxDistance);
    falling.forEach(({ dot, fall }) => {
      const delayIndex = delayMap.get(dot) || 0;
      const delay = Math.min(maxDelay, delayIndex * 0.12);
      const localProgress = Math.min(
        1,
        Math.max(0, (progress - delay) / (1 - maxDelay))
      );
      const offset = -fall * fallStep * (1 - localProgress);
      dot.style.transform = `translateY(${offset}px)`;
    });
    frames += 1;
    if (progress < 1 && frames < 240) {
      fallAnimation = requestAnimationFrame(step);
    } else {
      falling.forEach(({ dot }) => {
        dot.style.transition = "";
        dot.style.transform = "";
      });
      Matter.World.clear(fallEngine.world, false);
      fallEngine = null;
      fallAnimation = null;
      finishFall();
    }
  };
  fallAnimation = requestAnimationFrame(step);
}

function finishFall() {
  fallInProgress = false;
  const pending = fallResolvers;
  fallResolvers = [];
  pending.forEach((resolve) => resolve());
}

function waitForFallComplete() {
  if (!fallInProgress) return Promise.resolve();
  return new Promise((resolve) => fallResolvers.push(resolve));
}

function resizeCanvas() {
  boardRect = boardEl.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  if (boardRect.width === 0 || boardRect.height === 0) {
    requestAnimationFrame(resizeCanvas);
    return;
  }
  canvas.width = boardRect.width * dpr;
  canvas.height = boardRect.height * dpr;
  canvas.style.width = `${boardRect.width}px`;
  canvas.style.height = `${boardRect.height}px`;
  canvas.style.display = "block";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  computeGridMetrics();
  computeFallStep();
}

function ensureLayout() {
  if (!boardRect || canvas.width === 0 || canvas.height === 0) {
    resizeCanvas();
  }
  if (!gridMetrics) {
    computeGridMetrics();
  }
}

function computeGridMetrics() {
  if (!boardRect) return;
  const sample = gridEl.querySelector(".dot");
  if (!sample) return;
  const gridRect = gridEl.getBoundingClientRect();
  const style = getComputedStyle(gridEl);
  const gapValue = style.rowGap || style.gap || "0";
  const gap = Number.parseFloat(gapValue) || 0;
  const padX = Number.parseFloat(style.paddingLeft || "0") || 0;
  const padY = Number.parseFloat(style.paddingTop || "0") || 0;
  const dotSize = sample.getBoundingClientRect().width;
  gridMetrics = {
    dotSize,
    gap,
    padX,
    padY,
    left: gridRect.left - boardRect.left,
    top: gridRect.top - boardRect.top,
  };
}

function currentLevel() {
  return LEVELS[levelIndex];
}

function updateStats() {
  scoreEl.textContent = score;
  movesEl.textContent = moves;
  targetEl.textContent = currentLevel().target;
  levelEl.textContent = levelIndex + 1;
}

function clearBanner() {
  bannerEl.textContent = "";
  bannerEl.className = "banner";
}

function showBanner(text, type) {
  bannerEl.textContent = text;
  bannerEl.className = `banner ${type}`;
}

function dotFromEvent(target) {
  if (!target) return null;
  const dot = target.closest(".dot");
  return dot && gridEl.contains(dot) ? dot : null;
}

function coordsFromDot(dot) {
  return {
    row: Number(dot.dataset.row),
    col: Number(dot.dataset.col),
  };
}

function isAdjacent(a, b) {
  const dr = Math.abs(a.row - b.row);
  const dc = Math.abs(a.col - b.col);
  return dr + dc === 1;
}

function drawPath() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!selectedPath.length) return;

  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const drawLine = (color, width, alpha = 1) => {
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = width;
    ctx.beginPath();
    selectedPath.forEach((point, index) => {
      const center = getDotCenter(point);
      if (index === 0) ctx.moveTo(center.x, center.y);
      else ctx.lineTo(center.x, center.y);
    });
    if (looped && selectedPath.length > 2) {
      const first = getDotCenter(selectedPath[0]);
      ctx.lineTo(first.x, first.y);
    }
    ctx.stroke();
  };

  ctx.shadowColor = "rgba(0, 0, 0, 0.25)";
  ctx.shadowBlur = 6;
  drawLine("rgba(0, 0, 0, 0.35)", 14, 1);
  ctx.shadowBlur = 0;
  drawLine(COLORS[selectedColor], 10, 1);
  ctx.globalAlpha = 1;
}

function getDotCenter({ row, col }) {
  const dot = gridEl.querySelector(`.dot[data-row="${row}"][data-col="${col}"]`);
  const rect = dot.getBoundingClientRect();
  return {
    x: rect.left - boardRect.left + rect.width / 2,
    y: rect.top - boardRect.top + rect.height / 2,
  };
}

function highlightPath() {
  gridEl.querySelectorAll(".dot").forEach((dot) => dot.classList.remove("selected"));
  selectedPath.forEach((point) => {
    const dot = gridEl.querySelector(`.dot[data-row="${point.row}"][data-col="${point.col}"]`);
    if (dot) {
      dot.classList.add("selected");
      dot.style.setProperty("--flash-color", tintColor(COLORS[selectedColor], 0.35));
    }
  });
}

function updateLoopIndicators() {
  gridEl
    .querySelectorAll(".dot")
    .forEach((dot) => dot.classList.remove("bomb-potential", "pulse"));
  if (!looped) return;
  gridEl
    .querySelectorAll(`.dot[data-color="${selectedColor}"]`)
    .forEach((dot) => dot.classList.add("pulse"));
  const inside = getLoopInsideCoords();
  inside.forEach(({ row, col }) => {
    const dot = gridEl.querySelector(`.dot[data-row="${row}"][data-col="${col}"]`);
    if (dot) dot.classList.add("bomb-potential");
  });
}

function startSelection(dot) {
  if (!dot || moves <= 0 || levelComplete || isAnimating) return;
  clearBanner();
  ensureLayout();
  const { row, col } = coordsFromDot(dot);
  selectedColor = grid[row][col].color;
  selectedPath = [{ row, col }];
  looped = false;
  isDragging = true;
  highlightPath();
  updateLoopIndicators();
  requestAnimationFrame(drawPath);
  playSound("start");
}

function extendSelection(dot) {
  if (!dot || !isDragging) return;
  ensureLayout();
  const { row, col } = coordsFromDot(dot);
  const last = selectedPath[selectedPath.length - 1];
  const current = { row, col };

  if (grid[row][col].color !== selectedColor) return;
  if (selectedPath.length === 1 && (row === last.row && col === last.col)) return;

  const existingIndex = selectedPath.findIndex((p) => p.row === row && p.col === col);

  if (existingIndex === 0 && selectedPath.length >= 4 && isAdjacent(last, current)) {
    looped = true;
    highlightPath();
    updateLoopIndicators();
    requestAnimationFrame(drawPath);
    return;
  }

  if (existingIndex > -1) {
    if (existingIndex === selectedPath.length - 2) {
      selectedPath.pop();
      looped = false;
      highlightPath();
      updateLoopIndicators();
      requestAnimationFrame(drawPath);
    }
    return;
  }

  if (!isAdjacent(last, current)) return;
  selectedPath.push(current);
  looped = false;
  highlightPath();
  updateLoopIndicators();
  requestAnimationFrame(drawPath);
}

function endSelection() {
  if (!isDragging) return;
  isDragging = false;
  if (selectedPath.length < 2) {
    selectedPath = [];
    drawPath();
    highlightPath();
    updateLoopIndicators();
    return;
  }

  const insideCoords = looped ? getLoopInsideCoords() : [];
  const containsInside = insideCoords.length > 0;
  let spawnSpecial = null;
  const last = selectedPath[selectedPath.length - 1];
  // Special dots on hold for now (except bombs from loops).

  const toClear = looped ? collectColor(selectedColor) : selectedPath.map((p) => ({ row: p.row, col: p.col }));
  const pendingBombs = [];
  if (looped && containsInside) {
    const insideSet = new Set(insideCoords.map((p) => `${p.row},${p.col}`));
    insideCoords.forEach(({ row, col }) => {
      const cell = grid[row][col];
      if (!cell) return;
      cell.special = "bomb";
      cell.pendingBomb = true;
    });
    for (let i = toClear.length - 1; i >= 0; i -= 1) {
      const key = `${toClear[i].row},${toClear[i].col}`;
      if (insideSet.has(key)) toClear.splice(i, 1);
    }
    pendingBombs.push(...insideCoords);
  }

  applyClear(toClear, spawnSpecial, looped, pendingBombs);
  moves = Math.max(0, moves - 1);
  updateStats();
  selectedPath = [];
  looped = false;
  drawPath();
  highlightPath();
  updateLoopIndicators();

  if (score >= currentLevel().target) {
    levelComplete = true;
    updateBoardState();
    if (levelIndex < LEVELS.length - 1) {
      showBanner(`Level ${levelIndex + 1} complete!`, "win");
      nextLevelBtn.hidden = false;
      nextLevelBtn.classList.add("pulse");
    } else {
      showBanner("All levels cleared!", "win");
    }
  } else if (moves === 0) {
    showBanner("Out of moves. Try again!", "lose");
  }
}

function collectColor(colorIndex) {
  const coords = [];
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      if (grid[r][c].color === colorIndex) coords.push({ row: r, col: c });
    }
  }
  return coords;
}

function applyClear(coords, spawnSpecial, wasLoop, pendingBombs = []) {
  if (!coords.length) {
    if (pendingBombs.length) {
      isAnimating = true;
      renderGrid();
      waitForFallComplete().then(() => {
        setTimeout(() => {
          explodePendingBombs();
        }, 1000);
      });
    }
    return;
  }
  isAnimating = true;
  const clearSet = new Set();
  let bombTriggered = false;

  function addCoord(row, col) {
    if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return;
    clearSet.add(`${row},${col}`);
  }

  coords.forEach(({ row, col }) => addCoord(row, col));

  coords.forEach(({ row, col }) => {
    const cell = grid[row][col];
    if (!cell) return;
    if (cell.special === "bomb") {
      for (let dr = -1; dr <= 1; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          addCoord(row + dr, col + dc);
        }
      }
      bombTriggered = true;
    }
    if (cell.special === "row") {
      for (let c = 0; c < COLS; c += 1) addCoord(row, c);
      playSound("row");
    }
  });

  const finalCoords = Array.from(clearSet).map((entry) => {
    const [row, col] = entry.split(",").map(Number);
    return { row, col };
  });

  finalCoords.forEach(({ row, col }) => {
    grid[row][col] = null;
  });

  const multiplier = wasLoop ? 2 : 1;
  score += finalCoords.length * multiplier;
  if (bombTriggered) playSound("bomb");
  else if (wasLoop) playSound("loop");
  else playSound("clear");

  animateClear(finalCoords, () => {
    dropDots();
    refillDots();
    if (spawnSpecial) {
      grid[spawnSpecial.row][spawnSpecial.col] = makeCell(
        spawnSpecial.color,
        spawnSpecial.type,
        0
      );
    }
    renderGrid();
    if (pendingBombs.length) {
      waitForFallComplete().then(() => {
        setTimeout(() => {
          explodePendingBombs();
        }, 1000);
      });
    } else {
      isAnimating = false;
    }
  });
}

function removeDotCheat(row, col) {
  if (isAnimating || levelComplete) return;
  const cell = grid[row][col];
  if (!cell) return;
  grid[row][col] = null;
  isAnimating = true;
  animateClear([{ row, col }], () => {
    dropDots();
    refillDots();
    renderGrid();
    isAnimating = false;
  });
}

function animateClear(coords, onComplete) {
  coords.forEach(({ row, col }) => {
    const dot = gridEl.querySelector(`.dot[data-row="${row}"][data-col="${col}"]`);
    if (dot) dot.classList.add("clearing");
  });
  setTimeout(() => {
    onComplete();
  }, 260);
}

function explodePendingBombs() {
  const bombs = [];
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const cell = grid[r][c];
      if (cell && cell.pendingBomb) {
        cell.pendingBomb = false;
        bombs.push({ row: r, col: c });
      }
    }
  }
  if (!bombs.length) {
    isAnimating = false;
    return;
  }
  const clearSet = new Set();
  bombs.forEach(({ row, col }) => {
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        const rr = row + dr;
        const cc = col + dc;
        if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) continue;
        clearSet.add(`${rr},${cc}`);
      }
    }
  });
  const coords = Array.from(clearSet).map((entry) => {
    const [row, col] = entry.split(",").map(Number);
    return { row, col };
  });
  coords.forEach(({ row, col }) => {
    grid[row][col] = null;
  });
  score += coords.length;
  playSound("bomb");
  animateClear(coords, () => {
    dropDots();
    refillDots();
    renderGrid();
    isAnimating = false;
  });
}

function dropDots() {
  for (let c = 0; c < COLS; c += 1) {
    const column = [];
    for (let r = ROWS - 1; r >= 0; r -= 1) {
      if (grid[r][c] !== null) column.push({ cell: grid[r][c], row: r });
    }
    for (let r = ROWS - 1; r >= 0; r -= 1) {
      const entry = column[ROWS - 1 - r];
      if (entry) {
        const fall = r - entry.row;
        entry.cell.fall = fall;
        grid[r][c] = entry.cell;
      } else {
        grid[r][c] = null;
      }
    }
  }
}

function refillDots() {
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      if (grid[r][c] === null) {
        const cell = makeCell(randomColor());
        cell.fall = r + 1;
        grid[r][c] = cell;
      }
    }
  }
}

function getLoopInsideCoords() {
  const pathSet = new Set(selectedPath.map((p) => `${p.row},${p.col}`));
  const polygon = selectedPath.map((p) => ({ x: p.col + 0.5, y: p.row + 0.5 }));
  const inside = [];
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      if (pathSet.has(`${r},${c}`)) continue;
      if (pointInPolygon({ x: c + 0.5, y: r + 0.5 }, polygon)) {
        inside.push({ row: r, col: c });
      }
    }
  }
  return inside;
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi + 0.00001) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function startLevel(index) {
  levelIndex = index;
  score = 0;
  moves = currentLevel().moves;
  levelComplete = false;
  nextLevelBtn.hidden = true;
  nextLevelBtn.classList.remove("pulse");
  selectedPath = [];
  looped = false;
  selectedColor = null;
  clearClickTracker();
  updateBoardState();
  setupBoard();
}

function setupBoard() {
  initGrid();
  resizeCanvas();
  renderGrid();
  updateStats();
  clearBanner();
}

function restartGame() {
  startLevel(levelIndex);
}

function nextLevel() {
  if (levelIndex < LEVELS.length - 1) {
    startLevel(levelIndex + 1);
  }
}

function updateBoardState() {
  boardEl.classList.toggle("complete", levelComplete);
}

function ensureAudio() {
  if (!soundEnabled) return;
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === "suspended") audioCtx.resume();
}

function playSound(type) {
  if (!soundEnabled) return;
  ensureAudio();
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  const frequencies = {
    start: 520,
    clear: 620,
    loop: 760,
    bomb: 180,
    row: 480,
  };
  osc.type = type === "bomb" ? "square" : "triangle";
  osc.frequency.setValueAtTime(frequencies[type] || 600, now);
  if (type === "bomb") {
    osc.frequency.exponentialRampToValueAtTime(90, now + 0.2);
  } else if (type === "loop") {
    osc.frequency.exponentialRampToValueAtTime(920, now + 0.08);
  }
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + 0.22);
}

function toggleSound() {
  soundEnabled = !soundEnabled;
  soundToggleBtn.textContent = `Sound: ${soundEnabled ? "On" : "Off"}`;
  if (!soundEnabled && audioCtx) audioCtx.suspend();
}

function toggleCheatMode() {
  cheatEnabled = !cheatEnabled;
  cheatToggleBtn.textContent = `Cheat Mode: ${cheatEnabled ? "On" : "Off"}`;
  clearClickTracker();
}

function clearClickTracker() {
  clickTracker.clear();
}

function handleCheatClick(dot) {
  if (!cheatEnabled) return;
  const row = Number(dot.dataset.row);
  const col = Number(dot.dataset.col);
  const key = `${row},${col}`;
  const now = performance.now();
  const data = clickTracker.get(key) || { count: 0, time: 0 };
  const isFresh = now - data.time < 500;
  const count = isFresh ? data.count + 1 : 1;
  clickTracker.set(key, { count, time: now });
  if (count >= 3) {
    clickTracker.delete(key);
    removeDotCheat(row, col);
  }
}

boardEl.addEventListener("pointerdown", (event) => {
  const dot = dotFromEvent(event.target);
  if (!dot) return;
  boardEl.setPointerCapture(event.pointerId);
  ensureAudio();
  handleCheatClick(dot);
  startSelection(dot);
});

boardEl.addEventListener("pointermove", (event) => {
  if (!isDragging) return;
  const dot = dotFromEvent(document.elementFromPoint(event.clientX, event.clientY));
  extendSelection(dot);
});

boardEl.addEventListener("pointerup", () => endSelection());
boardEl.addEventListener("pointercancel", () => endSelection());

window.addEventListener("resize", () => {
  resizeCanvas();
  if (selectedPath.length) drawPath();
});

window.addEventListener("load", () => {
  resizeCanvas();
  if (selectedPath.length) drawPath();
});

nextLevelBtn.addEventListener("click", nextLevel);
soundToggleBtn.addEventListener("click", toggleSound);
cheatToggleBtn.addEventListener("click", toggleCheatMode);

setupBoard();
