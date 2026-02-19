// ============================
// CONFIG
// ============================
const TOTAL_LEVELS = 10;
const COLS = 20; // 20x10 = 200
const ROWS = 10;
const TOTAL_PIECES = COLS * ROWS;
const SAVE_KEY = "lovePuzzleProgress_v1";

const IMAGE_EXT = "jpg"; // change to "png" if needed
const SNAP_TOLERANCE = 22; // a little bigger because tabs add overhang

// Tab size relative to piece (tweak for look)
const TAB_RATIO = 0.26; // ~26% of pieceW / pieceH

// ============================
// STATE
// ============================
let currentLevel = 1;
let img = new Image();

let boardEl, trayEl, doneBtn, levelBadge, progressBadge, shuffleBtn, resetBtn;

let boardW = 0, boardH = 0;
let cellW = 0, cellH = 0;
let tab = 0;               // overhang size
let pieceW = 0, pieceH = 0; // actual element size incl. tabs (cell + 2*tab)
let placedCount = 0;

let slotOccupied = new Array(TOTAL_PIECES).fill(false);

// Edge profile arrays ensure interlocking
let verticalEdges = [];
let horizontalEdges = [];

const drag = { el: null, pointerId: null, offsetX: 0, offsetY: 0 };

let ro; // ResizeObserver
let lastSizes = { boardW: 0, boardH: 0, trayW: 0, trayH: 0 };

// A deterministic seed for the current level's jigsaw shape
let levelSeed = null;

// ============================
// BOOT
// ============================
document.addEventListener("DOMContentLoaded", () => {
  boardEl = document.getElementById("board");
  trayEl = document.getElementById("tray");
  doneBtn = document.getElementById("doneBtn");
  levelBadge = document.getElementById("levelBadge");
  progressBadge = document.getElementById("progressBadge");
  shuffleBtn = document.getElementById("shuffleBtn");
  resetBtn = document.getElementById("resetBtn");

  shuffleBtn.addEventListener("click", shuffleUnplacedPieces);

  // Reset current level (and clear saved locked pieces for this level)
  resetBtn.addEventListener("click", () => {
    clearSavedLockedForCurrentLevel();
    loadLevel(currentLevel);
  });

  doneBtn.addEventListener("click", nextLevel);

  const intro = new bootstrap.Modal(document.getElementById("introModal"), { backdrop: "static" });
  intro.show();

  // ✅ START FROM SAVED PROGRESS (Option B)
  const saved = loadSavedProgress();
  const startLevel = saved?.level ? Number(saved.level) : 1;
  loadLevel(clamp(startLevel, 1, TOTAL_LEVELS));

  // Responsive: observe board+tray size changes and rescale
  ro = new ResizeObserver(() => {
    window.clearTimeout(ro._t);
    ro._t = window.setTimeout(handleResize, 120);
  });
  ro.observe(boardEl);
  ro.observe(trayEl);
});

// ============================
// LEVEL LOADING
// ============================
function loadLevel(level){
  currentLevel = level;

  placedCount = 0;
  slotOccupied = new Array(TOTAL_PIECES).fill(false);
  doneBtn.disabled = true;

  levelBadge.textContent = `Level ${currentLevel}`;
  progressBadge.textContent = `${placedCount} / ${TOTAL_PIECES}`;

  boardEl.innerHTML = "";
  trayEl.innerHTML = "";

  // ✅ Get or create a stable seed for this level (so jigsaw shapes don't change on reload)
  levelSeed = getOrCreateLevelSeed(currentLevel);

  // Build edge profiles (tabs/holes) deterministically using the seed
  buildEdgeProfiles(levelSeed);

  const src = `img${currentLevel}.${IMAGE_EXT}`;
  img = new Image();
  img.onload = () => {
    computeBoardSizing();
    buildPieces(src);
    scatterPieces();

    // ✅ Restore locked pieces if saved for this level
    const saved = loadSavedProgress();
    if(saved && Number(saved.level) === currentLevel && Array.isArray(saved.locked) && saved.locked.length){
      restoreLockedPieces(saved.locked);
    }

    cacheLastSizes();
  };
  img.onerror = () => {
    boardEl.innerHTML = `
      <div class="p-3 text-danger">
        Could not load <b>${src}</b>. Make sure it exists and IMAGE_EXT matches.
      </div>
    `;
  };
  img.src = src;
}

function buildEdgeProfiles(seed){
  const rng = mulberry32(seed);

  verticalEdges = Array.from({ length: ROWS }, () => Array(COLS + 1).fill(0));
  horizontalEdges = Array.from({ length: ROWS + 1 }, () => Array(COLS).fill(0));

  // Internal boundaries: deterministically assign +1 or -1 based on seeded RNG
  for(let r=0;r<ROWS;r++){
    for(let c=1;c<COLS;c++){
      verticalEdges[r][c] = rng() < 0.5 ? 1 : -1;
    }
  }
  for(let r=1;r<ROWS;r++){
    for(let c=0;c<COLS;c++){
      horizontalEdges[r][c] = rng() < 0.5 ? 1 : -1;
    }
  }
}

function computeBoardSizing(){
  const ratio = img.naturalWidth / img.naturalHeight;

  boardW = boardEl.clientWidth;
  boardH = Math.round(boardW / ratio);

  boardEl.style.height = `${boardH}px`;

  cellW = boardW / COLS;
  cellH = boardH / ROWS;

  tab = Math.round(Math.min(cellW, cellH) * TAB_RATIO);

  pieceW = cellW + tab * 2;
  pieceH = cellH + tab * 2;
}

function cacheLastSizes(){
  lastSizes.boardW = boardW;
  lastSizes.boardH = boardH;
  lastSizes.trayW = trayEl.clientWidth;
  lastSizes.trayH = trayEl.clientHeight;
}

// ============================
// PIECES
// ============================
function buildPieces(imageSrc){
  for(let r=0;r<ROWS;r++){
    for(let c=0;c<COLS;c++){
      const idx = r*COLS + c;

      const el = document.createElement("div");
      el.className = "piece";
      el.dataset.slot = String(idx);
      el.dataset.r = String(r);
      el.dataset.c = String(c);
      el.dataset.locked = "0";

      el.style.width = `${pieceW}px`;
      el.style.height = `${pieceH}px`;

      el.style.backgroundImage = `url('${imageSrc}')`;
      el.style.backgroundSize = `${boardW}px ${boardH}px`;

      const bgX = -(c*cellW - tab);
      const bgY = -(r*cellH - tab);
      el.style.backgroundPosition = `${bgX}px ${bgY}px`;

      const maskSvg = makePieceMaskSvg(r, c);
      const dataUrl = svgToDataUrl(maskSvg);
      el.style.webkitMaskImage = `url("${dataUrl}")`;
      el.style.maskImage = `url("${dataUrl}")`;
      el.style.webkitMaskRepeat = "no-repeat";
      el.style.maskRepeat = "no-repeat";
      el.style.webkitMaskSize = "100% 100%";
      el.style.maskSize = "100% 100%";

      el.addEventListener("pointerdown", onPieceDown);

      trayEl.appendChild(el);
    }
  }
}

function scatterPieces(){
  const pieces = [...trayEl.querySelectorAll(".piece")];
  for(const p of pieces){
    const x = rand(8, Math.max(8, trayEl.clientWidth - pieceW - 8));
    const y = rand(8, Math.max(8, trayEl.clientHeight - pieceH - 8));
    setPos(p, x, y);
    p.style.zIndex = String(1 + Math.floor(Math.random()*50));
  }
}

function shuffleUnplacedPieces(){
  const pieces = [...document.querySelectorAll(".piece")]
    .filter(p => p.dataset.locked !== "1" && p.parentElement === trayEl);

  for(const p of pieces){
    const x = rand(8, Math.max(8, trayEl.clientWidth - pieceW - 8));
    const y = rand(8, Math.max(8, trayEl.clientHeight - pieceH - 8));
    setPos(p, x, y);
    p.style.zIndex = String(1 + Math.floor(Math.random()*50));
  }
}

// ============================
// DRAG
// ============================
function onPieceDown(e){
  const el = e.currentTarget;
  if(el.dataset.locked === "1") return;

  drag.el = el;
  drag.pointerId = e.pointerId;
  el.setPointerCapture(e.pointerId);

  el.style.zIndex = "999";

  const rect = el.getBoundingClientRect();
  drag.offsetX = e.clientX - rect.left;
  drag.offsetY = e.clientY - rect.top;

  el.addEventListener("pointermove", onPieceMove);
  el.addEventListener("pointerup", onPieceUp);
  el.addEventListener("pointercancel", onPieceUp);
}

function onPieceMove(e){
  if(!drag.el || e.pointerId !== drag.pointerId) return;

  const el = drag.el;
  const parentRect = el.parentElement.getBoundingClientRect();

  const x = e.clientX - parentRect.left - drag.offsetX;
  const y = e.clientY - parentRect.top - drag.offsetY;

  setPos(el, x, y);
}

function onPieceUp(e){
  if(!drag.el || e.pointerId !== drag.pointerId) return;

  const el = drag.el;
  el.removeEventListener("pointermove", onPieceMove);
  el.removeEventListener("pointerup", onPieceUp);
  el.removeEventListener("pointercancel", onPieceUp);

  const dropX = e.clientX;
  const dropY = e.clientY;

  const boardRect = boardEl.getBoundingClientRect();
  const overBoard =
    dropX >= boardRect.left && dropX <= boardRect.right &&
    dropY >= boardRect.top  && dropY <= boardRect.bottom;

  if(overBoard){
    moveElKeepingScreenPos(el, boardEl);
    trySnap(el);
    if(el.dataset.locked !== "1") clampToParent(el, boardEl);
  }else{
    if(el.parentElement === boardEl){
      moveElKeepingScreenPos(el, trayEl);
    }
    clampToParent(el, trayEl);
  }

  if(el.dataset.locked !== "1") el.style.zIndex = String(10 + Math.floor(Math.random()*50));

  drag.el = null;
  drag.pointerId = null;
}

function moveElKeepingScreenPos(el, newParent){
  const oldParent = el.parentElement;
  const oldRect = oldParent.getBoundingClientRect();
  const curX = parseFloat(el.style.left || "0");
  const curY = parseFloat(el.style.top || "0");
  const absLeft = oldRect.left + curX;
  const absTop  = oldRect.top + curY;

  newParent.appendChild(el);

  const newRect = newParent.getBoundingClientRect();
  setPos(el, absLeft - newRect.left, absTop - newRect.top);
}

// ============================
// SNAP + LOCK
// ============================
function trySnap(el){
  const slot = parseInt(el.dataset.slot, 10);
  const r = Math.floor(slot / COLS);
  const c = slot % COLS;

  const targetX = c*cellW - tab;
  const targetY = r*cellH - tab;

  const x = parseFloat(el.style.left || "0");
  const y = parseFloat(el.style.top || "0");

  if(Math.abs(x-targetX) <= SNAP_TOLERANCE &&
     Math.abs(y-targetY) <= SNAP_TOLERANCE &&
     slotOccupied[slot] === false){

    setPos(el, targetX, targetY);
    lockPiece(el, slot);
  }
}

function lockPiece(el, slot){
  el.dataset.locked = "1";
  el.classList.add("locked");
  el.style.zIndex = "5";

  slotOccupied[slot] = true;
  placedCount += 1;

  progressBadge.textContent = `${placedCount} / ${TOTAL_PIECES}`;

  // ✅ SAVE after every correct placement (Option B)
  saveProgress();

  if(placedCount === TOTAL_PIECES){
    doneBtn.disabled = false;
    popHearts();
  }
}

// ============================
// LEVELS
// ============================
function nextLevel(){
  if(placedCount !== TOTAL_PIECES) return;

  const next = currentLevel + 1;

  if(next > TOTAL_LEVELS){
    // optional: clear progress after finishing everything
    localStorage.removeItem(SAVE_KEY);

    const finish = new bootstrap.Modal(document.getElementById("finishModal"));
    finish.show();
    return;
  }

  // ✅ Initialize progress for next level (new seed + empty locked list)
  const nextSeed = makeSeed();
  localStorage.setItem(SAVE_KEY, JSON.stringify({ level: next, locked: [], seed: nextSeed }));

  loadLevel(next);
}

// ============================
// RESPONSIVE RESIZE
// ============================
function handleResize(){
  if(!img || !img.naturalWidth) return;

  const prev = { ...lastSizes };

  computeBoardSizing();

  const newTrayW = trayEl.clientWidth;
  const newTrayH = trayEl.clientHeight;
  const sx = prev.trayW ? (newTrayW / prev.trayW) : 1;
  const sy = prev.trayH ? (newTrayH / prev.trayH) : 1;

  const pieces = [...document.querySelectorAll(".piece")];
  for(const el of pieces){
    const r = parseInt(el.dataset.r, 10);
    const c = parseInt(el.dataset.c, 10);
    const locked = el.dataset.locked === "1";

    el.style.width = `${pieceW}px`;
    el.style.height = `${pieceH}px`;
    el.style.backgroundSize = `${boardW}px ${boardH}px`;

    const bgX = -(c*cellW - tab);
    const bgY = -(r*cellH - tab);
    el.style.backgroundPosition = `${bgX}px ${bgY}px`;

    const maskSvg = makePieceMaskSvg(r, c);
    const dataUrl = svgToDataUrl(maskSvg);
    el.style.webkitMaskImage = `url("${dataUrl}")`;
    el.style.maskImage = `url("${dataUrl}")`;

    if(locked && el.parentElement === boardEl){
      setPos(el, c*cellW - tab, r*cellH - tab);
    }else if(el.parentElement === trayEl){
      const x = parseFloat(el.style.left || "0") * sx;
      const y = parseFloat(el.style.top || "0") * sy;
      setPos(el, x, y);
      clampToParent(el, trayEl);
    }else if(el.parentElement === boardEl){
      clampToParent(el, boardEl);
    }
  }

  cacheLastSizes();
}

// ============================
// RESTORE PROGRESS (Option B)
// ============================
function restoreLockedPieces(lockedSlots){
  const set = new Set(lockedSlots.map(Number));

  document.querySelectorAll(".piece").forEach(el => {
    const slot = Number(el.dataset.slot);
    if(!set.has(slot)) return;

    if(el.parentElement !== boardEl) boardEl.appendChild(el);

    const r = Math.floor(slot / COLS);
    const c = slot % COLS;

    setPos(el, c*cellW - tab, r*cellH - tab);

    el.dataset.locked = "1";
    el.classList.add("locked");
    el.style.zIndex = "5";

    slotOccupied[slot] = true;
  });

  placedCount = lockedSlots.length;
  progressBadge.textContent = `${placedCount} / ${TOTAL_PIECES}`;
  doneBtn.disabled = placedCount !== TOTAL_PIECES;
}

// ============================
// JIGSAW MASK GENERATION
// ============================
function sideType(r, c, side){
  if(side === "top"){
    if(r === 0) return 0;
    return horizontalEdges[r][c] === 1 ? -1 : +1;
  }
  if(side === "bottom"){
    if(r === ROWS-1) return 0;
    return horizontalEdges[r+1][c] === 1 ? +1 : -1;
  }
  if(side === "left"){
    if(c === 0) return 0;
    return verticalEdges[r][c] === 1 ? -1 : +1;
  }
  if(side === "right"){
    if(c === COLS-1) return 0;
    return verticalEdges[r][c+1] === 1 ? +1 : -1;
  }
  return 0;
}

function makePieceMaskSvg(r, c){
  const w = pieceW, h = pieceH;
  const x0 = tab, y0 = tab;
  const x1 = tab + cellW, y1 = tab + cellH;

  const t = tab;
  const bumpW = Math.min(cellW, cellH) * 0.52;
  const bumpH = t * 0.95;

  const top = sideType(r,c,"top");
  const right = sideType(r,c,"right");
  const bottom = sideType(r,c,"bottom");
  const left = sideType(r,c,"left");

  let d = `M ${x0} ${y0}`;
  d += edgeH(x0, y0, x1, y0, top, bumpW, bumpH, -1);
  d += edgeV(x1, y0, x1, y1, right, bumpW, bumpH, +1);
  d += edgeH(x1, y1, x0, y1, bottom, bumpW, bumpH, +1);
  d += edgeV(x0, y1, x0, y0, left, bumpW, bumpH, -1);
  d += " Z";

  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <path d="${d}" fill="white"/>
  </svg>`.trim();
}

function edgeH(xA, yA, xB, yB, type, bumpW, bumpH, dirSign){
  if(type === 0) return ` L ${xB} ${yB}`;

  const len = Math.abs(xB - xA);
  const mid = (xA + xB) / 2;

  const bw = Math.min(bumpW, len * 0.6);
  const xL = mid - bw/2;
  const xR = mid + bw/2;

  const outward = dirSign * (type === 1 ? +1 : -1) * bumpH;
  const c1 = bw * 0.22;
  const c2 = bw * 0.28;

  return [
    ` L ${xL} ${yA}`,
    ` C ${xL + c1} ${yA} ${mid - c2} ${yA + outward} ${mid} ${yA + outward}`,
    ` C ${mid + c2} ${yA + outward} ${xR - c1} ${yA} ${xR} ${yA}`,
    ` L ${xB} ${yB}`
  ].join("");
}

function edgeV(xA, yA, xB, yB, type, bumpW, bumpH, dirSign){
  if(type === 0) return ` L ${xB} ${yB}`;

  const len = Math.abs(yB - yA);
  const mid = (yA + yB) / 2;

  const bw = Math.min(bumpW, len * 0.6);
  const yT = mid - bw/2;
  const yBtm = mid + bw/2;

  const outward = dirSign * (type === 1 ? +1 : -1) * bumpH;
  const c1 = bw * 0.22;
  const c2 = bw * 0.28;

  return [
    ` L ${xA} ${yT}`,
    ` C ${xA} ${yT + c1} ${xA + outward} ${mid - c2} ${xA + outward} ${mid}`,
    ` C ${xA + outward} ${mid + c2} ${xA} ${yBtm - c1} ${xA} ${yBtm}`,
    ` L ${xB} ${yB}`
  ].join("");
}

function svgToDataUrl(svg){
  const encoded = encodeURIComponent(svg)
    .replace(/'/g, "%27")
    .replace(/"/g, "%22");
  return `data:image/svg+xml,${encoded}`;
}

// ============================
// HELPERS + STORAGE
// ============================
function setPos(el, x, y){
  el.style.left = `${x}px`;
  el.style.top  = `${y}px`;
}

function clampToParent(el, parent){
  const maxX = parent.clientWidth - pieceW;
  const maxY = parent.clientHeight - pieceH;

  let x = parseFloat(el.style.left || "0");
  let y = parseFloat(el.style.top || "0");

  x = Math.max(0, Math.min(maxX, x));
  y = Math.max(0, Math.min(maxY, y));

  setPos(el, x, y);
}

function rand(min, max){
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function clamp(v, min, max){
  return Math.max(min, Math.min(max, v));
}

function loadSavedProgress(){
  try{
    return JSON.parse(localStorage.getItem(SAVE_KEY) || "null");
  }catch{
    return null;
  }
}

function saveProgress(){
  const lockedSlots = [];
  document.querySelectorAll(".piece.locked").forEach(p => {
    lockedSlots.push(Number(p.dataset.slot));
  });

  const payload = {
    level: currentLevel,
    locked: lockedSlots,
    seed: levelSeed
  };

  localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
}

function clearSavedLockedForCurrentLevel(){
  const saved = loadSavedProgress();
  if(saved && Number(saved.level) === currentLevel){
    // keep the same seed so the puzzle shape stays consistent
    localStorage.setItem(SAVE_KEY, JSON.stringify({ level: currentLevel, locked: [], seed: saved.seed ?? levelSeed ?? makeSeed() }));
  }
}

// seed management (so puzzle stays identical after refresh/return)
function getOrCreateLevelSeed(level){
  const saved = loadSavedProgress();
  if(saved && Number(saved.level) === level && Number.isFinite(saved.seed)){
    return Number(saved.seed);
  }
  const seed = makeSeed();
  // initialize storage if missing or moving to a fresh level without saved state
  localStorage.setItem(SAVE_KEY, JSON.stringify({ level, locked: [], seed }));
  return seed;
}

function makeSeed(){
  // stable enough seed for local play
  return (Date.now() ^ (Math.random() * 0xFFFFFFFF)) >>> 0;
}

// seeded RNG
function mulberry32(a){
  return function() {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

// ============================
// LOVE CELEBRATION
// ============================
function popHearts(){
  const count = 24;
  for(let i=0;i<count;i++){
    const s = document.createElement("span");
    s.textContent = ["💗","💖","💞","💘","💕"][Math.floor(Math.random()*5)];
    s.style.position = "fixed";
    s.style.left = `${Math.random()*100}vw`;
    s.style.top = `110vh`;
    s.style.fontSize = `${16 + Math.random()*18}px`;
    s.style.zIndex = "2000";
    s.style.filter = "drop-shadow(0 10px 18px rgba(0,0,0,0.35))";
    s.style.transition = "transform 1200ms ease, opacity 1200ms ease";
    document.body.appendChild(s);

    requestAnimationFrame(() => {
      s.style.opacity = "0";
      s.style.transform = `translateY(-130vh) translateX(${(Math.random()*80-40)}px) rotate(${Math.random()*60-30}deg)`;
    });

    setTimeout(() => s.remove(), 1300);
  }
}
