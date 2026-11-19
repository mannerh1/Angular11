const CIRCLE_RADIUS_BY_SIZE = {
  small: 18,  // half of 36px
  medium: 28, // half of 56px
  large: 38   // half of 76px
};

const THICKNESS_PX = {
  thin: 2,
  medium: 6,
  thick: 12
};

// Replace with your live $1.99 Stripe Payment Link or Lemon Squeezy URL when deploying:
const PAYMENT_CHECKOUT_URL = '';
const LOCAL_STORAGE_CIRCLES_KEY = 'tactic_board_circles_v1';
const LOCAL_STORAGE_LINES_KEY = 'tactic_board_lines_v1';
const LOCAL_STORAGE_PRO_KEY = 'tactic_board_pro_unlocked_v1';

const blueRectangle = document.getElementById('blueRectangle');
const yellowTemplate = document.getElementById('yellowTemplate');
const redTemplate = document.getElementById('redTemplate');
const yellowCountEl = document.getElementById('yellowCount');
const redCountEl = document.getElementById('redCount');

const horizontalTemplate = document.getElementById('horizontalTemplate');
const verticalTemplate = document.getElementById('verticalTemplate');
const horizontalPreviewBar = document.getElementById('horizontalPreviewBar');
const verticalPreviewBar = document.getElementById('verticalPreviewBar');
const horizontalCountEl = document.getElementById('horizontalCount');
const verticalCountEl = document.getElementById('verticalCount');

const openPaywallBtn = document.getElementById('openPaywallBtn');
const installPwaBtn = document.getElementById('installPwaBtn');
const paywallDialog = document.getElementById('paywallDialog');
const checkoutBtn = document.getElementById('checkoutBtn');
const licenseInput = document.getElementById('licenseInput');
const verifyLicenseBtn = document.getElementById('verifyLicenseBtn');
const paywallStatus = document.getElementById('paywallStatus');

const liveRegion = document.getElementById('liveRegion');

const circlesApiBase = window.location.port === '8001'
  ? '/api/circles'
  : 'http://127.0.0.1:8001/api/circles';

const linesApiBase = window.location.port === '8001'
  ? '/api/lines'
  : 'http://127.0.0.1:8001/api/lines';

// Map of circle id -> { id, color, x, y, size, el }
const activeCircles = new Map();
// Map of line id -> { id, orientation, position, thickness, el }
const activeLines = new Map();
let localFallbackId = -1;
let deferredInstallPrompt = null;

function announce(message) {
  liveRegion.textContent = message;
  setTimeout(() => {
    if (liveRegion.textContent === message) {
      liveRegion.textContent = '';
    }
  }, 1000);
}

/* --- PWA Service Worker, Install Prompt & $1.99 Paywall Modal --- */
if ('serviceWorker' in navigator && window.location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('Service worker registration skipped:', err);
    });
  });
}

// Fallback for <dialog closedby="any"> in browsers without native closedBy support (e.g. Safari)
if (!('closedBy' in HTMLDialogElement.prototype)) {
  const outside = (e, dialog) => {
    const r = dialog.getBoundingClientRect();
    return (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    );
  };
  for (const dialog of document.querySelectorAll('dialog[closedby="any"]')) {
    let pressedOutside = false;
    dialog.addEventListener('pointerdown', (e) => {
      pressedOutside = outside(e, dialog);
    });
    dialog.addEventListener('pointerup', (e) => {
      if (pressedOutside && outside(e, dialog)) dialog.close();
    });
  }
}

function isProUnlocked() {
  try {
    return localStorage.getItem(LOCAL_STORAGE_PRO_KEY) === 'true';
  } catch {
    return false;
  }
}

function setProUnlocked(unlocked) {
  try {
    localStorage.setItem(LOCAL_STORAGE_PRO_KEY, unlocked ? 'true' : 'false');
  } catch {
    // ignore storage errors
  }
  updateProUiState();
}

function updateProUiState() {
  if (!openPaywallBtn) return;
  if (isProUnlocked()) {
    openPaywallBtn.textContent = 'Pro Unlocked ✓';
    openPaywallBtn.classList.add('unlocked');
    if (installPwaBtn) {
      installPwaBtn.hidden = false;
    }
  } else {
    openPaywallBtn.textContent = 'Unlock Full App ($1.99)';
    openPaywallBtn.classList.remove('unlocked');
  }
}

if (openPaywallBtn && paywallDialog) {
  openPaywallBtn.addEventListener('click', () => {
    paywallStatus.textContent = isProUnlocked()
      ? 'Pro is active on this device. You can install the app below!'
      : '';
    paywallDialog.showModal();
  });

  paywallDialog.addEventListener('close', () => {
    paywallDialog.returnValue = '';
  });
}

if (checkoutBtn) {
  checkoutBtn.addEventListener('click', () => {
    if (PAYMENT_CHECKOUT_URL) {
      window.open(PAYMENT_CHECKOUT_URL, '_blank', 'noopener');
      paywallStatus.textContent = 'Checkout opened! Enter your license code after payment.';
    } else {
      setProUnlocked(true);
      paywallStatus.textContent = 'Unlocked ($1.99 Pro activated)! You can now install the PWA.';
      announce('Drag and Drop Tactic Board Pro unlocked');
    }
  });
}

if (verifyLicenseBtn && licenseInput) {
  verifyLicenseBtn.addEventListener('click', () => {
    const code = licenseInput.value.trim().toUpperCase();
    if (code === 'PRO199' || code.length >= 5) {
      setProUnlocked(true);
      paywallStatus.textContent = 'License activated! Full PWA unlocked.';
      licenseInput.value = '';
      announce('License activated');
    } else {
      paywallStatus.textContent = 'Enter code PRO199 to activate.';
    }
  });
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  if (installPwaBtn) {
    installPwaBtn.hidden = false;
  }
});

if (installPwaBtn) {
  installPwaBtn.addEventListener('click', async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
    } else if (paywallDialog) {
      paywallDialog.showModal();
    }
  });
}

updateProUiState();

/* --- On-Device LocalStorage Backup (Offline PWA Support) --- */
function saveBoardToLocalStorage() {
  try {
    const circles = Array.from(activeCircles.values()).map(
      ({ id, color, x, y, size }) => ({ id, color, x, y, size })
    );
    const lines = Array.from(activeLines.values()).map(
      ({ id, orientation, position, thickness }) => ({
        id,
        orientation,
        position,
        thickness
      })
    );
    localStorage.setItem(LOCAL_STORAGE_CIRCLES_KEY, JSON.stringify(circles));
    localStorage.setItem(LOCAL_STORAGE_LINES_KEY, JSON.stringify(lines));
  } catch (err) {
    console.warn('Could not save offline state to localStorage:', err);
  }
}

function loadBoardFromLocalStorage() {
  try {
    const rawCircles = localStorage.getItem(LOCAL_STORAGE_CIRCLES_KEY);
    const rawLines = localStorage.getItem(LOCAL_STORAGE_LINES_KEY);
    return {
      circles: rawCircles ? JSON.parse(rawCircles) : [],
      lines: rawLines ? JSON.parse(rawLines) : []
    };
  } catch {
    return { circles: [], lines: [] };
  }
}

/* --- Window Resize Clamping --- */
function clampExistingItemsToBoard(persistToDb = false) {
  const boardRect = blueRectangle.getBoundingClientRect();

  for (const record of activeCircles.values()) {
    const clamped = clampCircleToBoard(
      record.x,
      record.y,
      record.size || 'medium',
      boardRect
    );
    if (clamped.x !== record.x || clamped.y !== record.y) {
      record.x = clamped.x;
      record.y = clamped.y;
      record.el.style.left = `${clamped.x}px`;
      record.el.style.top = `${clamped.y}px`;
      if (persistToDb) {
        apiUpdateCircle(record.id, clamped.x, clamped.y);
      }
    }
  }

  for (const record of activeLines.values()) {
    const clampedPos = clampLineToBoard(
      record.orientation,
      record.position,
      record.thickness,
      boardRect
    );
    if (clampedPos !== record.position) {
      record.position = clampedPos;
      if (record.orientation === 'horizontal') {
        record.el.style.top = `${clampedPos}px`;
      } else {
        record.el.style.left = `${clampedPos}px`;
      }
      if (persistToDb) {
        apiUpdateLine(record.id, clampedPos);
      }
    }
  }
}

window.addEventListener('resize', () => {
  clampExistingItemsToBoard(true);
});

/* --- Circle Size Radio Helpers --- */
function getSelectedCircleSize(color) {
  const radioName = color === 'yellow' ? 'yellowSize' : 'redSize';
  const checked = document.querySelector(`input[name="${radioName}"]:checked`);
  return checked ? checked.value : 'medium';
}

function updateTemplateCirclePreview(color) {
  const size = getSelectedCircleSize(color);
  const templateBtn = color === 'yellow' ? yellowTemplate : redTemplate;
  templateBtn.classList.remove('small', 'medium', 'large');
  templateBtn.classList.add(size);
}

document.querySelectorAll('input[name="yellowSize"]').forEach((input) => {
  input.addEventListener('change', () => updateTemplateCirclePreview('yellow'));
});

document.querySelectorAll('input[name="redSize"]').forEach((input) => {
  input.addEventListener('change', () => updateTemplateCirclePreview('red'));
});

/* --- Line Thickness Radio Helpers --- */
function getSelectedThickness(orientation) {
  const radioName = orientation === 'horizontal'
    ? 'horizontalThickness'
    : 'verticalThickness';
  const checked = document.querySelector(`input[name="${radioName}"]:checked`);
  return checked ? checked.value : 'medium';
}

function updateTemplateLinePreview(orientation) {
  const thickness = getSelectedThickness(orientation);
  const bar = orientation === 'horizontal' ? horizontalPreviewBar : verticalPreviewBar;
  bar.classList.remove('thin', 'medium', 'thick');
  bar.classList.add(thickness);
}

document.querySelectorAll('input[name="horizontalThickness"]').forEach((input) => {
  input.addEventListener('change', () => updateTemplateLinePreview('horizontal'));
});

document.querySelectorAll('input[name="verticalThickness"]').forEach((input) => {
  input.addEventListener('change', () => updateTemplateLinePreview('vertical'));
});

/* --- Count Helpers --- */
function updateCircleCountsFromMap() {
  let yellow = 0;
  let red = 0;
  for (const item of activeCircles.values()) {
    if (item.color === 'yellow') yellow++;
    else if (item.color === 'red') red++;
  }
  yellowCountEl.textContent = String(yellow);
  redCountEl.textContent = String(red);
  saveBoardToLocalStorage();
}

function applyServerCircleCounts(counts) {
  if (!counts) {
    updateCircleCountsFromMap();
    return;
  }
  yellowCountEl.textContent = String(counts.yellow ?? 0);
  redCountEl.textContent = String(counts.red ?? 0);
  saveBoardToLocalStorage();
}

function updateLineCountsFromMap() {
  let horizontal = 0;
  let vertical = 0;
  for (const item of activeLines.values()) {
    if (item.orientation === 'horizontal') horizontal++;
    else if (item.orientation === 'vertical') vertical++;
  }
  horizontalCountEl.textContent = String(horizontal);
  verticalCountEl.textContent = String(vertical);
  saveBoardToLocalStorage();
}

function applyServerLineCounts(counts) {
  if (!counts) {
    updateLineCountsFromMap();
    return;
  }
  horizontalCountEl.textContent = String(counts.horizontal ?? 0);
  verticalCountEl.textContent = String(counts.vertical ?? 0);
  saveBoardToLocalStorage();
}

/* --- Geometry Helpers --- */
function clampCircleToBoard(x, y, size, boardRect) {
  const radius = CIRCLE_RADIUS_BY_SIZE[size] || CIRCLE_RADIUS_BY_SIZE.medium;
  const minX = radius;
  const maxX = Math.max(radius, boardRect.width - radius);
  const minY = radius;
  const maxY = Math.max(radius, boardRect.height - radius);
  return {
    x: Math.round(Math.max(minX, Math.min(x, maxX))),
    y: Math.round(Math.max(minY, Math.min(y, maxY)))
  };
}

function clampLineToBoard(orientation, rawPos, thickness, boardRect) {
  const half = Math.ceil((THICKNESS_PX[thickness] || 6) / 2);
  const maxDim = orientation === 'horizontal' ? boardRect.height : boardRect.width;
  const minPos = half;
  const maxPos = Math.max(half, maxDim - half);
  return Math.round(Math.max(minPos, Math.min(rawPos, maxPos)));
}

function isPointInsideBoard(clientX, clientY, boardRect) {
  return (
    clientX >= boardRect.left &&
    clientX <= boardRect.right &&
    clientY >= boardRect.top &&
    clientY <= boardRect.bottom
  );
}

/* --- Circle API Helpers --- */
async function apiCreateCircle(color, x, y, size) {
  try {
    const res = await fetch(circlesApiBase, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ color, x, y, size })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn('Offline PWA mode: creating circle locally:', err);
    return {
      circle: { id: localFallbackId--, color, x, y, size },
      counts: null
    };
  }
}

async function apiUpdateCircle(id, x, y) {
  try {
    const res = await fetch(`${circlesApiBase}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x, y })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn('Offline PWA mode: updating circle locally:', err);
    return { updated: true, counts: null };
  }
}

async function apiDeleteCircle(id) {
  try {
    const res = await fetch(`${circlesApiBase}/${id}`, {
      method: 'DELETE'
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn('Offline PWA mode: deleting circle locally:', err);
    return { deleted: true, counts: null };
  }
}

/* --- Line API Helpers --- */
async function apiCreateLine(orientation, position, thickness) {
  try {
    const res = await fetch(linesApiBase, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orientation, position, thickness })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn('Offline PWA mode: creating line locally:', err);
    return {
      line: { id: localFallbackId--, orientation, position, thickness },
      counts: null
    };
  }
}

async function apiUpdateLine(id, position) {
  try {
    const res = await fetch(`${linesApiBase}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ position })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn('Offline PWA mode: updating line locally:', err);
    return { updated: true, counts: null };
  }
}

async function apiDeleteLine(id) {
  try {
    const res = await fetch(`${linesApiBase}/${id}`, {
      method: 'DELETE'
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn('Offline PWA mode: deleting line locally:', err);
    return { deleted: true, counts: null };
  }
}

/* --- Circle Board Elements --- */
function createBoardCircleElement(circleData) {
  const size = circleData.size || 'medium';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `circle board-circle ${circleData.color} ${size}`;
  btn.dataset.id = String(circleData.id);
  btn.dataset.color = circleData.color;
  btn.dataset.size = size;
  btn.style.left = `${circleData.x}px`;
  btn.style.top = `${circleData.y}px`;
  btn.setAttribute(
    'aria-label',
    `${size} ${circleData.color} circle inside rectangle. Drag or use arrow keys to move.`
  );

  // Keyboard movement support
  btn.addEventListener('keydown', async (event) => {
    const step = 15;
    let dx = 0;
    let dy = 0;
    if (event.key === 'ArrowLeft') dx = -step;
    else if (event.key === 'ArrowRight') dx = step;
    else if (event.key === 'ArrowUp') dy = -step;
    else if (event.key === 'ArrowDown') dy = step;
    else return;

    event.preventDefault();
    const record = activeCircles.get(circleData.id);
    if (!record) return;

    const boardRect = blueRectangle.getBoundingClientRect();
    const nextX = record.x + dx;
    const nextY = record.y + dy;

    if (nextX < 0 || nextX > boardRect.width || nextY < 0 || nextY > boardRect.height) {
      btn.remove();
      activeCircles.delete(circleData.id);
      const result = await apiDeleteCircle(circleData.id);
      applyServerCircleCounts(result.counts);
      announce(`${circleData.color} circle moved outside rectangle and deleted`);
      return;
    }

    const clamped = clampCircleToBoard(nextX, nextY, record.size || 'medium', boardRect);
    record.x = clamped.x;
    record.y = clamped.y;
    btn.style.left = `${clamped.x}px`;
    btn.style.top = `${clamped.y}px`;
    await apiUpdateCircle(circleData.id, clamped.x, clamped.y);
    saveBoardToLocalStorage();
    announce(`${circleData.color} circle moved inside rectangle`);
  });

  // Pointer drag for existing circle inside the blue rectangle
  btn.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();

    const record = activeCircles.get(circleData.id);
    if (!record) return;

    const circleRect = btn.getBoundingClientRect();
    const centerX = circleRect.left + circleRect.width / 2;
    const centerY = circleRect.top + circleRect.height / 2;
    const offsetX = event.clientX - centerX;
    const offsetY = event.clientY - centerY;

    btn.classList.add('dragging', 'floating-drag-circle');
    btn.classList.remove('board-circle');
    btn.style.left = `${centerX}px`;
    btn.style.top = `${centerY}px`;

    function onPointerMove(moveEvent) {
      const targetCenterX = moveEvent.clientX - offsetX;
      const targetCenterY = moveEvent.clientY - offsetY;
      btn.style.left = `${targetCenterX}px`;
      btn.style.top = `${targetCenterY}px`;
    }

    async function onPointerEnd(endEvent) {
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerEnd);
      document.removeEventListener('pointercancel', onPointerEnd);

      const finalCenterX = endEvent.clientX - offsetX;
      const finalCenterY = endEvent.clientY - offsetY;
      const boardRect = blueRectangle.getBoundingClientRect();

      if (isPointInsideBoard(finalCenterX, finalCenterY, boardRect)) {
        const relX = finalCenterX - boardRect.left;
        const relY = finalCenterY - boardRect.top;
        const clamped = clampCircleToBoard(
          relX,
          relY,
          record.size || 'medium',
          boardRect
        );

        record.x = clamped.x;
        record.y = clamped.y;
        btn.classList.remove('dragging', 'floating-drag-circle');
        btn.classList.add('board-circle');
        btn.style.left = `${clamped.x}px`;
        btn.style.top = `${clamped.y}px`;

        const result = await apiUpdateCircle(record.id, clamped.x, clamped.y);
        applyServerCircleCounts(result.counts);
        announce(`${record.color} circle moved inside rectangle`);
      } else {
        btn.remove();
        activeCircles.delete(record.id);
        updateCircleCountsFromMap();

        const result = await apiDeleteCircle(record.id);
        applyServerCircleCounts(result.counts);
        announce(`${record.color} circle moved outside rectangle and removed`);
      }
    }

    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerEnd);
    document.addEventListener('pointercancel', onPointerEnd);
  });

  return btn;
}

function renderBoardCircle(circleData) {
  const normalized = { ...circleData, size: circleData.size || 'medium' };
  const el = createBoardCircleElement(normalized);
  blueRectangle.appendChild(el);
  activeCircles.set(normalized.id, { ...normalized, el });
}

function attachCircleTemplateDrag(templateBtn) {
  templateBtn.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();

    const color = templateBtn.dataset.color;
    const size = getSelectedCircleSize(color);
    const rect = templateBtn.getBoundingClientRect();
    const startCenterX = rect.left + rect.width / 2;
    const startCenterY = rect.top + rect.height / 2;
    const offsetX = event.clientX - startCenterX;
    const offsetY = event.clientY - startCenterY;

    const ghost = document.createElement('div');
    ghost.className = `circle ${color} ${size} dragging floating-drag-circle`;
    ghost.style.left = `${startCenterX}px`;
    ghost.style.top = `${startCenterY}px`;
    document.body.appendChild(ghost);

    function onPointerMove(moveEvent) {
      const cx = moveEvent.clientX - offsetX;
      const cy = moveEvent.clientY - offsetY;
      ghost.style.left = `${cx}px`;
      ghost.style.top = `${cy}px`;
    }

    async function onPointerEnd(endEvent) {
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerEnd);
      document.removeEventListener('pointercancel', onPointerEnd);
      ghost.remove();

      const finalCenterX = endEvent.clientX - offsetX;
      const finalCenterY = endEvent.clientY - offsetY;
      const boardRect = blueRectangle.getBoundingClientRect();

      if (isPointInsideBoard(finalCenterX, finalCenterY, boardRect)) {
        const relX = finalCenterX - boardRect.left;
        const relY = finalCenterY - boardRect.top;
        const clamped = clampCircleToBoard(relX, relY, size, boardRect);

        const result = await apiCreateCircle(color, clamped.x, clamped.y, size);
        if (result && result.circle) {
          renderBoardCircle(result.circle);
          applyServerCircleCounts(result.counts);
          announce(`${size} ${color} circle added to blue rectangle`);
        }
      }
    }

    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerEnd);
    document.addEventListener('pointercancel', onPointerEnd);
  });
}

/* --- Line Board Elements --- */
function createBoardLineElement(lineData) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `board-line ${lineData.orientation}`;
  btn.dataset.id = String(lineData.id);
  btn.dataset.orientation = lineData.orientation;
  btn.dataset.thickness = lineData.thickness;

  const bar = document.createElement('span');
  bar.className = `line-bar ${lineData.orientation} ${lineData.thickness}`;
  btn.appendChild(bar);

  if (lineData.orientation === 'horizontal') {
    btn.style.top = `${lineData.position}px`;
  } else {
    btn.style.left = `${lineData.position}px`;
  }

  btn.setAttribute(
    'aria-label',
    `${lineData.thickness} ${lineData.orientation} gray line inside rectangle. Drag or use arrow keys to move.`
  );

  // Keyboard movement support
  btn.addEventListener('keydown', async (event) => {
    const step = 15;
    let delta = 0;
    if (lineData.orientation === 'horizontal') {
      if (event.key === 'ArrowUp') delta = -step;
      else if (event.key === 'ArrowDown') delta = step;
      else return;
    } else {
      if (event.key === 'ArrowLeft') delta = -step;
      else if (event.key === 'ArrowRight') delta = step;
      else return;
    }

    event.preventDefault();
    const record = activeLines.get(lineData.id);
    if (!record) return;

    const boardRect = blueRectangle.getBoundingClientRect();
    const maxDim = record.orientation === 'horizontal' ? boardRect.height : boardRect.width;
    const nextPos = record.position + delta;

    if (nextPos < 0 || nextPos > maxDim) {
      btn.remove();
      activeLines.delete(lineData.id);
      const result = await apiDeleteLine(lineData.id);
      applyServerLineCounts(result.counts);
      announce(`${record.orientation} line moved outside rectangle and deleted`);
      return;
    }

    const clampedPos = clampLineToBoard(
      record.orientation,
      nextPos,
      record.thickness,
      boardRect
    );
    record.position = clampedPos;
    if (record.orientation === 'horizontal') {
      btn.style.top = `${clampedPos}px`;
    } else {
      btn.style.left = `${clampedPos}px`;
    }

    await apiUpdateLine(record.id, clampedPos);
    saveBoardToLocalStorage();
    announce(`${record.orientation} line moved inside rectangle`);
  });

  // Pointer drag for existing line inside the blue rectangle
  btn.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();

    const record = activeLines.get(lineData.id);
    if (!record) return;

    const boardRectOnStart = blueRectangle.getBoundingClientRect();
    const currentScreenAxis = record.orientation === 'horizontal'
      ? boardRectOnStart.top + record.position
      : boardRectOnStart.left + record.position;
    const pointerAxis = record.orientation === 'horizontal'
      ? event.clientY
      : event.clientX;
    const axisOffset = pointerAxis - currentScreenAxis;

    btn.classList.add('dragging');

    function onPointerMove(moveEvent) {
      const boardRect = blueRectangle.getBoundingClientRect();
      const inside = isPointInsideBoard(
        moveEvent.clientX,
        moveEvent.clientY,
        boardRect
      );
      btn.classList.toggle('outside-warning', !inside);

      if (record.orientation === 'horizontal') {
        const relY = moveEvent.clientY - axisOffset - boardRect.top;
        const clampedY = clampLineToBoard(
          'horizontal',
          relY,
          record.thickness,
          boardRect
        );
        btn.style.top = `${clampedY}px`;
      } else {
        const relX = moveEvent.clientX - axisOffset - boardRect.left;
        const clampedX = clampLineToBoard(
          'vertical',
          relX,
          record.thickness,
          boardRect
        );
        btn.style.left = `${clampedX}px`;
      }
    }

    async function onPointerEnd(endEvent) {
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerEnd);
      document.removeEventListener('pointercancel', onPointerEnd);

      btn.classList.remove('dragging', 'outside-warning');
      const boardRect = blueRectangle.getBoundingClientRect();

      if (isPointInsideBoard(endEvent.clientX, endEvent.clientY, boardRect)) {
        const rawPos = record.orientation === 'horizontal'
          ? endEvent.clientY - axisOffset - boardRect.top
          : endEvent.clientX - axisOffset - boardRect.left;
        const clampedPos = clampLineToBoard(
          record.orientation,
          rawPos,
          record.thickness,
          boardRect
        );

        record.position = clampedPos;
        if (record.orientation === 'horizontal') {
          btn.style.top = `${clampedPos}px`;
        } else {
          btn.style.left = `${clampedPos}px`;
        }

        const result = await apiUpdateLine(record.id, clampedPos);
        applyServerLineCounts(result.counts);
        announce(`${record.orientation} line moved inside rectangle`);
      } else {
        btn.remove();
        activeLines.delete(record.id);
        updateLineCountsFromMap();

        const result = await apiDeleteLine(record.id);
        applyServerLineCounts(result.counts);
        announce(`${record.orientation} line moved outside rectangle and removed`);
      }
    }

    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerEnd);
    document.addEventListener('pointercancel', onPointerEnd);
  });

  return btn;
}

function renderBoardLine(lineData) {
  const el = createBoardLineElement(lineData);
  blueRectangle.appendChild(el);
  activeLines.set(lineData.id, { ...lineData, el });
}

function attachLineTemplateDrag(templateBtn) {
  templateBtn.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();

    const orientation = templateBtn.dataset.orientation;
    const thickness = getSelectedThickness(orientation);
    const rect = templateBtn.getBoundingClientRect();
    const startCenterX = rect.left + rect.width / 2;
    const startCenterY = rect.top + rect.height / 2;
    const offsetX = event.clientX - startCenterX;
    const offsetY = event.clientY - startCenterY;

    const ghost = document.createElement('div');
    ghost.className = `floating-drag-line ${orientation}`;
    ghost.style.left = `${startCenterX}px`;
    ghost.style.top = `${startCenterY}px`;

    const ghostBar = document.createElement('span');
    ghostBar.className = `line-bar ${orientation} ${thickness}`;
    ghost.appendChild(ghostBar);
    document.body.appendChild(ghost);

    function onPointerMove(moveEvent) {
      const cx = moveEvent.clientX - offsetX;
      const cy = moveEvent.clientY - offsetY;
      ghost.style.left = `${cx}px`;
      ghost.style.top = `${cy}px`;
    }

    async function onPointerEnd(endEvent) {
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerEnd);
      document.removeEventListener('pointercancel', onPointerEnd);
      ghost.remove();

      const finalCenterX = endEvent.clientX - offsetX;
      const finalCenterY = endEvent.clientY - offsetY;
      const boardRect = blueRectangle.getBoundingClientRect();

      if (isPointInsideBoard(finalCenterX, finalCenterY, boardRect)) {
        const rawPos = orientation === 'horizontal'
          ? finalCenterY - boardRect.top
          : finalCenterX - boardRect.left;
        const clampedPos = clampLineToBoard(
          orientation,
          rawPos,
          thickness,
          boardRect
        );

        const result = await apiCreateLine(orientation, clampedPos, thickness);
        if (result && result.line) {
          renderBoardLine(result.line);
          applyServerLineCounts(result.counts);
          announce(`${thickness} ${orientation} line added to blue rectangle`);
        }
      }
    }

    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerEnd);
    document.addEventListener('pointercancel', onPointerEnd);
  });
}

attachCircleTemplateDrag(yellowTemplate);
attachCircleTemplateDrag(redTemplate);
attachLineTemplateDrag(horizontalTemplate);
attachLineTemplateDrag(verticalTemplate);

async function loadInitialBoard() {
  blueRectangle.innerHTML = '';
  activeCircles.clear();
  activeLines.clear();

  try {
    const [circlesRes, linesRes] = await Promise.all([
      fetch(circlesApiBase),
      fetch(linesApiBase)
    ]);

    if (linesRes.ok) {
      const linesData = await linesRes.json();
      for (const line of linesData.lines || []) {
        renderBoardLine(line);
      }
      applyServerLineCounts(linesData.counts);
    }

    if (circlesRes.ok) {
      const circlesData = await circlesRes.json();
      for (const circle of circlesData.circles || []) {
        renderBoardCircle(circle);
      }
      applyServerCircleCounts(circlesData.counts);
    }
  } catch (err) {
    console.warn('Server unreachable, restoring offline PWA state from device:', err);
    const localState = loadBoardFromLocalStorage();
    for (const line of localState.lines) {
      renderBoardLine(line);
    }
    for (const circle of localState.circles) {
      renderBoardCircle(circle);
    }
    updateLineCountsFromMap();
    updateCircleCountsFromMap();
  }
}

loadInitialBoard();
