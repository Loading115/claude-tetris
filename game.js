'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#7986cb', // J - indigo
  '#ffb74d', // L - orange
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
];

const LINE_SCORES = [0, 100, 300, 500, 800];

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const nameEntry = document.getElementById('name-entry');
const nameInput = document.getElementById('name-input');
const saveScoreBtn = document.getElementById('save-score-btn');
const gameoverScores = document.getElementById('gameover-scores');
const startOverlay = document.getElementById('start-overlay');
const startScores = document.getElementById('start-scores');
const playBtn = document.getElementById('play-btn');
const resetRecordsBtn = document.getElementById('reset-records-btn');

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId, started;

const THEME_KEY = 'tetris-theme';
const themeToggleBtn = document.getElementById('theme-toggle');
let gridColor;

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  themeToggleBtn.textContent = theme === 'light' ? '☀️' : '🌙';
  gridColor = getComputedStyle(document.documentElement).getPropertyValue('--grid-color').trim();
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  applyTheme(saved === 'light' ? 'light' : 'dark');
}

themeToggleBtn.addEventListener('click', () => {
  const currentTheme = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  const nextTheme = currentTheme === 'light' ? 'dark' : 'light';
  applyTheme(nextTheme);
  localStorage.setItem(THEME_KEY, nextTheme);
});

initTheme();

/* ---- High scores / records store ---- */
const HIGHSCORES_KEY = 'tetris-highscores';
const BEST_COMBO_KEY = 'tetris-best-combo';
const BEST_LINES_KEY = 'tetris-best-lines';

function loadHighScores() {
  try {
    const raw = localStorage.getItem(HIGHSCORES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(e => e && typeof e === 'object'
      && typeof e.name === 'string'
      && typeof e.score === 'number');
  } catch (e) {
    return [];
  }
}

function saveHighScores(list) {
  try {
    localStorage.setItem(HIGHSCORES_KEY, JSON.stringify(list));
  } catch (e) {
    // ignore write errors (e.g. storage disabled/full)
  }
}

function loadBestNumber(key) {
  try {
    const n = Number(localStorage.getItem(key));
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch (e) {
    return 0;
  }
}

function saveBestNumber(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch (e) {
    // ignore write errors
  }
}

function clearAllRecords() {
  try {
    localStorage.removeItem(HIGHSCORES_KEY);
    localStorage.removeItem(BEST_COMBO_KEY);
    localStorage.removeItem(BEST_LINES_KEY);
  } catch (e) {
    // ignore
  }
}

function qualifiesForTopScores(candidateScore, list) {
  if (list.length < 5) return true;
  return candidateScore > list[list.length - 1].score;
}

function renderScores(container, highlightIndex) {
  while (container.firstChild) container.removeChild(container.firstChild);

  const list = loadHighScores();
  const table = document.createElement('table');
  table.className = 'score-table';

  const headerRow = document.createElement('tr');
  ['#', 'Nombre', 'Puntos', 'Líneas', 'Nivel'].forEach(text => {
    const th = document.createElement('th');
    th.textContent = text;
    headerRow.appendChild(th);
  });
  table.appendChild(headerRow);

  if (list.length === 0) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 5;
    cell.textContent = 'Sin puntuaciones todavía';
    row.appendChild(cell);
    table.appendChild(row);
  } else {
    list.forEach((entry, i) => {
      const row = document.createElement('tr');
      if (i === highlightIndex) row.classList.add('score-highlight');
      [String(i + 1), entry.name, entry.score.toLocaleString(), String(entry.lines), String(entry.level)]
        .forEach(text => {
          const td = document.createElement('td');
          td.textContent = text;
          row.appendChild(td);
        });
      table.appendChild(row);
    });
  }

  container.appendChild(table);

  const records = document.createElement('p');
  records.className = 'score-records';
  records.textContent = `Mejor combo: ${loadBestNumber(BEST_COMBO_KEY)}  |  Máx. líneas: ${loadBestNumber(BEST_LINES_KEY)}`;
  container.appendChild(records);
}

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const type = Math.floor(Math.random() * 7) + 1;
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    updateHUD();
  }
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  merge();
  clearLines();
  spawn();
}

function spawn() {
  current = next;
  next = randomPiece();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

let currentSaveHandler = null;
let currentSaveKeydownHandler = null;

function detachSaveHandlers() {
  if (currentSaveHandler) {
    saveScoreBtn.removeEventListener('click', currentSaveHandler);
    currentSaveHandler = null;
  }
  if (currentSaveKeydownHandler) {
    nameInput.removeEventListener('keydown', currentSaveKeydownHandler);
    currentSaveKeydownHandler = null;
  }
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;

  detachSaveHandlers();

  const finalCombo = (typeof bestCombo !== 'undefined' ? bestCombo : 0);

  if (finalCombo > loadBestNumber(BEST_COMBO_KEY)) saveBestNumber(BEST_COMBO_KEY, finalCombo);
  if (lines > loadBestNumber(BEST_LINES_KEY)) saveBestNumber(BEST_LINES_KEY, lines);

  const existingList = loadHighScores();
  const qualifies = qualifiesForTopScores(score, existingList);

  if (qualifies) {
    nameEntry.classList.remove('hidden');
    nameInput.value = 'JUGADOR';
    renderScores(gameoverScores);
    setTimeout(() => { nameInput.focus(); nameInput.select(); }, 0);

    const save = () => {
      const name = (nameInput.value || '').trim().slice(0, 12) || 'JUGADOR';
      const entry = {
        name,
        score,
        lines,
        level,
        combo: finalCombo,
        date: new Date().toISOString(),
      };
      const updated = loadHighScores();
      updated.push(entry);
      updated.sort((a, b) => b.score - a.score);
      updated.length = Math.min(updated.length, 5);
      saveHighScores(updated);
      const idx = updated.indexOf(entry);
      nameEntry.classList.add('hidden');
      renderScores(gameoverScores, idx);
      renderScores(startScores);
      detachSaveHandlers();
    };
    currentSaveHandler = save;
    currentSaveKeydownHandler = (e) => { if (e.key === 'Enter') save(); };
    saveScoreBtn.addEventListener('click', currentSaveHandler);
    nameInput.addEventListener('keydown', currentSaveKeydownHandler);
  } else {
    nameEntry.classList.add('hidden');
    renderScores(gameoverScores);
  }

  overlay.classList.remove('hidden');
}

function togglePause() {
  if (!started || gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
    }
  }
  draw();
  animId = requestAnimationFrame(loop);
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  started = true;
  dropInterval = 1000;
  dropAccum = 0;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  detachSaveHandlers();
  nameEntry.classList.add('hidden');
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (e.code === 'KeyP') { togglePause(); return; }
  if (!started || paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);

playBtn.addEventListener('click', () => {
  startOverlay.classList.add('hidden');
  init();
});

resetRecordsBtn.addEventListener('click', () => {
  const ok = confirm('¿Seguro que quieres borrar todos los récords?');
  if (!ok) return;
  clearAllRecords();
  renderScores(startScores);
  renderScores(gameoverScores);
});

renderScores(startScores);
startOverlay.classList.remove('hidden');
