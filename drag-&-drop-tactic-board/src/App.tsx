import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Download, Info, Lock, MoveRight, Pencil, RotateCcw, Trash2, WifiOff} from 'lucide-react';
import {registerSW} from 'virtual:pwa-register';
import {InfoTab, InfoTermsModal} from './components/InfoTermsModal';
import {PWAInstallButton} from './components/PWAInstallButton';
import {PaywallModal} from './components/PaywallModal';
import {useOnlineStatus} from './hooks/useOnlineStatus';
import {
  ARROW_STROKE_PX,
  BoardArrow,
  BoardCircle,
  BoardLine,
  CIRCLE_RADIUS_PX,
  CIRCLE_SIZE_PX,
  CircleColor,
  CircleSize,
  LINE_THICKNESS_PX,
  LineOrientation,
  LineThickness,
  TacticBoardSnapshot,
} from './types/tactics';
import {exportBoardAsPng} from './utils/exportBoardPng';
import {
  FREE_MAX_ARROWS,
  FREE_MAX_CIRCLES,
  FREE_MAX_LINES,
  loadStoredLicense,
  revalidateStoredLicenseInBackground,
  saveStoredLicense,
  StoredProLicense,
} from './utils/licensing';

const STORAGE_BOARD_KEY = 'tactic_board_state_v2';

interface DragPreviewState {
  kind: 'circle' | 'line' | 'arrow';
  clientX: number;
  clientY: number;
  color?: CircleColor;
  size?: CircleSize;
  orientation?: LineOrientation;
  thickness?: LineThickness;
}

interface ArrowDraft {
  startXRatio: number;
  startYRatio: number;
  endXRatio: number;
  endYRatio: number;
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `item-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function clamp01(val: number): number {
  return Math.max(0, Math.min(1, val));
}

function clampCircleRatios(
  rawX: number,
  rawY: number,
  size: CircleSize,
  boardWidth: number,
  boardHeight: number,
): {xRatio: number; yRatio: number} {
  const w = Math.max(1, boardWidth);
  const h = Math.max(1, boardHeight);
  const radius = CIRCLE_RADIUS_PX[size];
  const minX = Math.min(0.5, radius / w);
  const maxX = Math.max(0.5, 1 - radius / w);
  const minY = Math.min(0.5, radius / h);
  const maxY = Math.max(0.5, 1 - radius / h);

  return {
    xRatio: Math.max(minX, Math.min(rawX / w, maxX)),
    yRatio: Math.max(minY, Math.min(rawY / h, maxY)),
  };
}

function clampLineRatio(
  orientation: LineOrientation,
  rawAxisPos: number,
  thickness: LineThickness,
  boardWidth: number,
  boardHeight: number,
): number {
  const dim = Math.max(1, orientation === 'horizontal' ? boardHeight : boardWidth);
  const half = Math.ceil(LINE_THICKNESS_PX[thickness] / 2);
  const minRatio = Math.min(0.5, half / dim);
  const maxRatio = Math.max(0.5, 1 - half / dim);
  return Math.max(minRatio, Math.min(rawAxisPos / dim, maxRatio));
}

function isInsideRect(clientX: number, clientY: number, rect: DOMRect): boolean {
  return (
    clientX >= rect.left &&
    clientX <= rect.right &&
    clientY >= rect.top &&
    clientY <= rect.bottom
  );
}

function computeArrowGeometry(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  thickness: LineThickness,
) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const strokeW = ARROW_STROKE_PX[thickness];
  if (len < 2) {
    return {
      strokeW,
      shaftEndX: x2,
      shaftEndY: y2,
      headPoints: '',
    };
  }
  const angle = Math.atan2(dy, dx);
  const headLen = Math.max(strokeW * 3.1, 14);
  const shaftEndX = x2 - Math.cos(angle) * (headLen * 0.65);
  const shaftEndY = y2 - Math.sin(angle) * (headLen * 0.65);

  const leftX = x2 - headLen * Math.cos(angle - Math.PI / 6);
  const leftY = y2 - headLen * Math.sin(angle - Math.PI / 6);
  const rightX = x2 - headLen * Math.cos(angle + Math.PI / 6);
  const rightY = y2 - headLen * Math.sin(angle + Math.PI / 6);

  return {
    strokeW,
    shaftEndX,
    shaftEndY,
    headPoints: `${x2},${y2} ${leftX},${leftY} ${rightX},${rightY}`,
  };
}

function loadInitialSnapshot(): TacticBoardSnapshot {
  try {
    const saved = localStorage.getItem(STORAGE_BOARD_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<TacticBoardSnapshot>;
      return {
        circles: Array.isArray(parsed.circles) ? parsed.circles : [],
        lines: Array.isArray(parsed.lines) ? parsed.lines : [],
        arrows: Array.isArray(parsed.arrows) ? parsed.arrows : [],
      };
    }
  } catch {
    // ignore corrupted local storage
  }
  return {circles: [], lines: [], arrows: []};
}

function getInitialInfoRoute(): {open: boolean; tab: InfoTab} {
  if (typeof window === 'undefined') return {open: false, tab: 'about'};
  const path = window.location.pathname.toLowerCase().replace(/\/+$/, '');
  const hash = window.location.hash.toLowerCase();
  if (path === '/pricing' || hash === '#pricing') return {open: true, tab: 'pricing'};
  if (
    path === '/terms' ||
    path === '/privacy' ||
    path === '/refunds' ||
    hash === '#terms' ||
    hash === '#privacy' ||
    hash === '#refunds'
  ) {
    return {open: true, tab: 'terms'};
  }
  if (path === '/about' || hash === '#about') return {open: true, tab: 'about'};
  return {open: false, tab: 'about'};
}

export default function App() {
  const boardRef = useRef<HTMLDivElement | null>(null);
  const isOnline = useOnlineStatus();

  const [snapshot, setSnapshot] = useState<TacticBoardSnapshot>(() => loadInitialSnapshot());
  const [boardSize, setBoardSize] = useState<{width: number; height: number}>({
    width: 960,
    height: 720,
  });

  const [yellowSize, setYellowSize] = useState<CircleSize>('medium');
  const [redSize, setRedSize] = useState<CircleSize>('medium');
  const [horizontalThickness, setHorizontalThickness] = useState<LineThickness>('medium');
  const [verticalThickness, setVerticalThickness] = useState<LineThickness>('medium');
  const [arrowThickness, setArrowThickness] = useState<LineThickness>('medium');
  const [isDrawingArrow, setIsDrawingArrow] = useState(false);
  const [arrowDraft, setArrowDraft] = useState<ArrowDraft | null>(null);

  const [mobilePaletteTab, setMobilePaletteTab] = useState<'circles' | 'lines' | 'arrows'>(
    'circles',
  );
  const [dragPreview, setDragPreview] = useState<DragPreviewState | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [draggingOutside, setDraggingOutside] = useState(false);

  const [proLicense, setProLicense] = useState<StoredProLicense | null>(() =>
    loadStoredLicense(),
  );
  const isProUnlocked = !!proLicense?.unlocked;

  const [paywallOpen, setPaywallOpen] = useState(false);
  const [paywallReason, setPaywallReason] = useState<string | null>(null);
  const [initialInfoRoute] = useState(() => getInitialInfoRoute());
  const [infoModalOpen, setInfoModalOpen] = useState(initialInfoRoute.open);
  const [infoModalTab, setInfoModalTab] = useState<InfoTab>(initialInfoRoute.tab);

  const [undoSnapshot, setUndoSnapshot] = useState<TacticBoardSnapshot | null>(null);
  const [exportStatus, setExportStatus] = useState<'idle' | 'done'>('idle');
  const [liveAnnouncement, setLiveAnnouncement] = useState('');

  const openInfoModal = useCallback((tab: InfoTab = 'about') => {
    setInfoModalTab(tab);
    setInfoModalOpen(true);
  }, []);

  const closeInfoModal = useCallback(() => {
    setInfoModalOpen(false);
    if (
      typeof window !== 'undefined' &&
      (window.location.pathname !== '/' || window.location.hash)
    ) {
      window.history.replaceState(null, '', '/');
    }
  }, []);

  const announce = useCallback((message: string) => {
    setLiveAnnouncement(message);
  }, []);

  const openPaywallWithReason = useCallback((reason: string | null) => {
    setPaywallReason(reason);
    setPaywallOpen(true);
  }, []);

  // Register VitePWA Service Worker for offline caching
  useEffect(() => {
    registerSW({immediate: true});
  }, []);

  // Exit Draw Arrow mode on Escape
  useEffect(() => {
    if (!isDrawingArrow) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsDrawingArrow(false);
        setArrowDraft(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isDrawingArrow]);

  // Re-validate live Lemon Squeezy license silently in background when online
  useEffect(() => {
    if (!proLicense || proLicense.mode !== 'live') return;
    let active = true;
    revalidateStoredLicenseInBackground(proLicense).then((stillValid) => {
      if (active && !stillValid) {
        setProLicense(null);
      }
    });
    return () => {
      active = false;
    };
  }, [proLicense]);

  // Persist board state privately on-device in localStorage (zero shared-DB collision)
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_BOARD_KEY, JSON.stringify(snapshot));
    } catch {
      // ignore storage quota errors
    }
  }, [snapshot]);

  // Measure board container cleanly on mount and resize
  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;

    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setBoardSize({width: rect.width, height: rect.height});
      }
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(el);
    window.addEventListener('resize', updateSize);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateSize);
    };
  }, []);

  // Clear undo banner automatically after 6 seconds
  useEffect(() => {
    if (!undoSnapshot) return;
    const timer = window.setTimeout(() => setUndoSnapshot(null), 6000);
    return () => window.clearTimeout(timer);
  }, [undoSnapshot]);

  const handlePreviewUnlock = () => {
    const previewLicense: StoredProLicense = {
      unlocked: true,
      mode: 'preview',
      activatedAt: new Date().toISOString(),
    };
    saveStoredLicense(previewLicense);
    setProLicense(previewLicense);
    setPaywallReason(null);
    announce('Drag and Drop Tactic Board Pro unlocked');
  };

  const handleLicenseActivated = (license: StoredProLicense) => {
    setProLicense(license);
    setPaywallReason(null);
    announce('License activated');
  };

  const handleResetToFree = () => {
    saveStoredLicense(null);
    setProLicense(null);
    setSnapshot((prev) => ({
      circles: prev.circles.slice(0, FREE_MAX_CIRCLES),
      lines: prev.lines.slice(0, FREE_MAX_LINES),
      arrows: prev.arrows.slice(0, FREE_MAX_ARROWS),
    }));
    announce('Switched to free sandbox mode');
  };

  // Clear Board stays FREE so users can freely reset their sandbox anytime
  const handleClearBoard = () => {
    if (
      snapshot.circles.length === 0 &&
      snapshot.lines.length === 0 &&
      snapshot.arrows.length === 0
    ) {
      return;
    }
    setUndoSnapshot(snapshot);
    setSnapshot({circles: [], lines: [], arrows: []});
    announce('Board cleared');
  };

  const handleUndoClear = () => {
    if (!undoSnapshot) return;
    setSnapshot(undoSnapshot);
    setUndoSnapshot(null);
    announce('Cleared board restored');
  };

  // Export PNG is gated behind $1.99 Pro
  const handleExportPng = async () => {
    if (!isProUnlocked) {
      openPaywallWithReason(
        'High-resolution PNG export is included in Pro ($1.99 one-time).',
      );
      return;
    }
    const rect = boardRef.current?.getBoundingClientRect();
    await exportBoardAsPng({
      circles: snapshot.circles,
      lines: snapshot.lines,
      arrows: snapshot.arrows,
      boardWidth: rect?.width ?? boardSize.width,
      boardHeight: rect?.height ?? boardSize.height,
    });
    setExportStatus('done');
    announce('Tactical board exported as PNG');
    window.setTimeout(() => setExportStatus('idle'), 1800);
  };

  const toggleDrawArrowMode = () => {
    if (!isDrawingArrow && !isProUnlocked && snapshot.arrows.length >= FREE_MAX_ARROWS) {
      openPaywallWithReason(
        `Free sandbox allows up to ${FREE_MAX_ARROWS} tactical arrows. Unlock unlimited arrows, PNG export & offline install for $1.99 once.`,
      );
      return;
    }
    setIsDrawingArrow((prev) => {
      const next = !prev;
      announce(next ? 'Draw arrow mode active' : 'Draw arrow mode off');
      return next;
    });
  };

  // Drag directly on the board to draw a tactical arrow (when Draw Arrow mode is active)
  const handleBoardDrawPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (!isDrawingArrow || e.button !== 0) return;
    e.preventDefault();

    if (!isProUnlocked && snapshot.arrows.length >= FREE_MAX_ARROWS) {
      setIsDrawingArrow(false);
      openPaywallWithReason(
        `Free sandbox allows up to ${FREE_MAX_ARROWS} tactical arrows. Unlock unlimited arrows, PNG export & offline install for $1.99 once.`,
      );
      return;
    }

    const boardRect = boardRef.current?.getBoundingClientRect();
    if (!boardRect) return;

    const startXRatio = clamp01((e.clientX - boardRect.left) / Math.max(1, boardRect.width));
    const startYRatio = clamp01((e.clientY - boardRect.top) / Math.max(1, boardRect.height));

    setArrowDraft({
      startXRatio,
      startYRatio,
      endXRatio: startXRatio,
      endYRatio: startYRatio,
    });

    const onMove = (moveEvent: PointerEvent) => {
      const rect = boardRef.current?.getBoundingClientRect();
      if (!rect) return;
      const endXRatio = clamp01((moveEvent.clientX - rect.left) / Math.max(1, rect.width));
      const endYRatio = clamp01((moveEvent.clientY - rect.top) / Math.max(1, rect.height));
      setArrowDraft({
        startXRatio,
        startYRatio,
        endXRatio,
        endYRatio,
      });
    };

    const onEnd = (endEvent: PointerEvent) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onEnd);
      document.removeEventListener('pointercancel', onEnd);
      setArrowDraft(null);

      const rect = boardRef.current?.getBoundingClientRect();
      if (!rect) return;

      const endXRatio = clamp01((endEvent.clientX - rect.left) / Math.max(1, rect.width));
      const endYRatio = clamp01((endEvent.clientY - rect.top) / Math.max(1, rect.height));
      const pixelLen = Math.hypot(
        (endXRatio - startXRatio) * rect.width,
        (endYRatio - startYRatio) * rect.height,
      );

      if (pixelLen < 14) {
        return;
      }

      const newArrow: BoardArrow = {
        id: generateId(),
        startXRatio,
        startYRatio,
        endXRatio,
        endYRatio,
        thickness: arrowThickness,
      };

      let blockedByCap = false;
      setSnapshot((prev) => {
        if (!isProUnlocked && prev.arrows.length >= FREE_MAX_ARROWS) {
          blockedByCap = true;
          return prev;
        }
        return {
          ...prev,
          arrows: [...prev.arrows, newArrow],
        };
      });

      if (blockedByCap) {
        setIsDrawingArrow(false);
        openPaywallWithReason(
          `Free sandbox allows up to ${FREE_MAX_ARROWS} tactical arrows. Unlock unlimited arrows, PNG export & offline install for $1.99 once.`,
        );
      } else {
        announce('Tactical arrow drawn on board');
      }
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onEnd);
    document.addEventListener('pointercancel', onEnd);
  };

  // Drag new circle from palette template onto the board
  const startCircleTemplateDrag = (
    e: React.PointerEvent<HTMLButtonElement>,
    color: CircleColor,
  ) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setIsDrawingArrow(false);

    if (!isProUnlocked && snapshot.circles.length >= FREE_MAX_CIRCLES) {
      openPaywallWithReason(
        `Free sandbox allows up to ${FREE_MAX_CIRCLES} circles. Unlock unlimited circles, PNG export & offline install for $1.99 once.`,
      );
      return;
    }

    const size = color === 'yellow' ? yellowSize : redSize;
    const rect = e.currentTarget.getBoundingClientRect();
    const startCenterX = rect.left + rect.width / 2;
    const startCenterY = rect.top + rect.height / 2;
    const offsetX = e.clientX - startCenterX;
    const offsetY = e.clientY - startCenterY;

    setDragPreview({
      kind: 'circle',
      color,
      size,
      clientX: startCenterX,
      clientY: startCenterY,
    });

    const onMove = (moveEvent: PointerEvent) => {
      setDragPreview({
        kind: 'circle',
        color,
        size,
        clientX: moveEvent.clientX - offsetX,
        clientY: moveEvent.clientY - offsetY,
      });
    };

    const onEnd = (endEvent: PointerEvent) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onEnd);
      document.removeEventListener('pointercancel', onEnd);
      setDragPreview(null);

      const boardRect = boardRef.current?.getBoundingClientRect();
      if (!boardRect) return;

      const finalX = endEvent.clientX - offsetX;
      const finalY = endEvent.clientY - offsetY;

      if (isInsideRect(finalX, finalY, boardRect)) {
        const clamped = clampCircleRatios(
          finalX - boardRect.left,
          finalY - boardRect.top,
          size,
          boardRect.width,
          boardRect.height,
        );
        const newCircle: BoardCircle = {
          id: generateId(),
          color,
          size,
          xRatio: clamped.xRatio,
          yRatio: clamped.yRatio,
        };

        let blockedByCap = false;
        setSnapshot((prev) => {
          if (!isProUnlocked && prev.circles.length >= FREE_MAX_CIRCLES) {
            blockedByCap = true;
            return prev;
          }
          return {
            ...prev,
            circles: [...prev.circles, newCircle],
          };
        });

        if (blockedByCap) {
          openPaywallWithReason(
            `Free sandbox allows up to ${FREE_MAX_CIRCLES} circles. Unlock unlimited circles, PNG export & offline install for $1.99 once.`,
          );
        } else {
          announce(`${size} ${color} circle added to board`);
        }
      }
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onEnd);
    document.addEventListener('pointercancel', onEnd);
  };

  // Drag new line from palette template onto the board
  const startLineTemplateDrag = (
    e: React.PointerEvent<HTMLButtonElement>,
    orientation: LineOrientation,
  ) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setIsDrawingArrow(false);

    if (!isProUnlocked && snapshot.lines.length >= FREE_MAX_LINES) {
      openPaywallWithReason(
        `Free sandbox allows up to ${FREE_MAX_LINES} divider lines. Unlock unlimited lines, PNG export & offline install for $1.99 once.`,
      );
      return;
    }

    const thickness =
      orientation === 'horizontal' ? horizontalThickness : verticalThickness;
    const rect = e.currentTarget.getBoundingClientRect();
    const startCenterX = rect.left + rect.width / 2;
    const startCenterY = rect.top + rect.height / 2;
    const offsetX = e.clientX - startCenterX;
    const offsetY = e.clientY - startCenterY;

    setDragPreview({
      kind: 'line',
      orientation,
      thickness,
      clientX: startCenterX,
      clientY: startCenterY,
    });

    const onMove = (moveEvent: PointerEvent) => {
      setDragPreview({
        kind: 'line',
        orientation,
        thickness,
        clientX: moveEvent.clientX - offsetX,
        clientY: moveEvent.clientY - offsetY,
      });
    };

    const onEnd = (endEvent: PointerEvent) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onEnd);
      document.removeEventListener('pointercancel', onEnd);
      setDragPreview(null);

      const boardRect = boardRef.current?.getBoundingClientRect();
      if (!boardRect) return;

      const finalX = endEvent.clientX - offsetX;
      const finalY = endEvent.clientY - offsetY;

      if (isInsideRect(finalX, finalY, boardRect)) {
        const rawAxisPos =
          orientation === 'horizontal'
            ? finalY - boardRect.top
            : finalX - boardRect.left;
        const posRatio = clampLineRatio(
          orientation,
          rawAxisPos,
          thickness,
          boardRect.width,
          boardRect.height,
        );
        const newLine: BoardLine = {
          id: generateId(),
          orientation,
          thickness,
          posRatio,
        };

        let blockedByCap = false;
        setSnapshot((prev) => {
          if (!isProUnlocked && prev.lines.length >= FREE_MAX_LINES) {
            blockedByCap = true;
            return prev;
          }
          return {
            ...prev,
            lines: [...prev.lines, newLine],
          };
        });

        if (blockedByCap) {
          openPaywallWithReason(
            `Free sandbox allows up to ${FREE_MAX_LINES} divider lines. Unlock unlimited lines, PNG export & offline install for $1.99 once.`,
          );
        } else {
          announce(`${thickness} ${orientation} line added to board`);
        }
      }
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onEnd);
    document.addEventListener('pointercancel', onEnd);
  };

  // Drag new arrow template from palette onto the board
  const startArrowTemplateDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setIsDrawingArrow(false);

    if (!isProUnlocked && snapshot.arrows.length >= FREE_MAX_ARROWS) {
      openPaywallWithReason(
        `Free sandbox allows up to ${FREE_MAX_ARROWS} tactical arrows. Unlock unlimited arrows, PNG export & offline install for $1.99 once.`,
      );
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const startCenterX = rect.left + rect.width / 2;
    const startCenterY = rect.top + rect.height / 2;
    const offsetX = e.clientX - startCenterX;
    const offsetY = e.clientY - startCenterY;

    setDragPreview({
      kind: 'arrow',
      thickness: arrowThickness,
      clientX: startCenterX,
      clientY: startCenterY,
    });

    const onMove = (moveEvent: PointerEvent) => {
      setDragPreview({
        kind: 'arrow',
        thickness: arrowThickness,
        clientX: moveEvent.clientX - offsetX,
        clientY: moveEvent.clientY - offsetY,
      });
    };

    const onEnd = (endEvent: PointerEvent) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onEnd);
      document.removeEventListener('pointercancel', onEnd);
      setDragPreview(null);

      const boardRect = boardRef.current?.getBoundingClientRect();
      if (!boardRect) return;

      const finalX = endEvent.clientX - offsetX;
      const finalY = endEvent.clientY - offsetY;

      if (isInsideRect(finalX, finalY, boardRect)) {
        const cxRatio = clamp01((finalX - boardRect.left) / Math.max(1, boardRect.width));
        const cyRatio = clamp01((finalY - boardRect.top) / Math.max(1, boardRect.height));
        const halfSpanX = 65 / Math.max(1, boardRect.width);
        const startXRatio = clamp01(cxRatio - halfSpanX);
        const endXRatio = clamp01(cxRatio + halfSpanX);

        const newArrow: BoardArrow = {
          id: generateId(),
          startXRatio,
          startYRatio: cyRatio,
          endXRatio,
          endYRatio: cyRatio,
          thickness: arrowThickness,
        };

        let blockedByCap = false;
        setSnapshot((prev) => {
          if (!isProUnlocked && prev.arrows.length >= FREE_MAX_ARROWS) {
            blockedByCap = true;
            return prev;
          }
          return {
            ...prev,
            arrows: [...prev.arrows, newArrow],
          };
        });

        if (blockedByCap) {
          openPaywallWithReason(
            `Free sandbox allows up to ${FREE_MAX_ARROWS} tactical arrows. Unlock unlimited arrows, PNG export & offline install for $1.99 once.`,
          );
        } else {
          announce('Tactical arrow added to board');
        }
      }
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onEnd);
    document.addEventListener('pointercancel', onEnd);
  };

  // Drag existing circle on the board (drag outside board to delete)
  const startBoardCircleDrag = (
    e: React.PointerEvent<HTMLButtonElement>,
    circle: BoardCircle,
  ) => {
    if (e.button !== 0 || isDrawingArrow) return;
    e.preventDefault();

    const btnRect = e.currentTarget.getBoundingClientRect();
    const startCenterX = btnRect.left + btnRect.width / 2;
    const startCenterY = btnRect.top + btnRect.height / 2;
    const offsetX = e.clientX - startCenterX;
    const offsetY = e.clientY - startCenterY;

    setDraggingId(circle.id);
    setDraggingOutside(false);

    const onMove = (moveEvent: PointerEvent) => {
      const boardRect = boardRef.current?.getBoundingClientRect();
      if (!boardRect) return;

      const targetX = moveEvent.clientX - offsetX;
      const targetY = moveEvent.clientY - offsetY;
      const inside = isInsideRect(targetX, targetY, boardRect);
      setDraggingOutside(!inside);

      const nextXRatio = (targetX - boardRect.left) / Math.max(1, boardRect.width);
      const nextYRatio = (targetY - boardRect.top) / Math.max(1, boardRect.height);

      setSnapshot((prev) => ({
        ...prev,
        circles: prev.circles.map((item) =>
          item.id === circle.id
            ? {...item, xRatio: nextXRatio, yRatio: nextYRatio}
            : item,
        ),
      }));
    };

    const onEnd = (endEvent: PointerEvent) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onEnd);
      document.removeEventListener('pointercancel', onEnd);
      setDraggingId(null);
      setDraggingOutside(false);

      const boardRect = boardRef.current?.getBoundingClientRect();
      if (!boardRect) return;

      const finalX = endEvent.clientX - offsetX;
      const finalY = endEvent.clientY - offsetY;

      if (isInsideRect(finalX, finalY, boardRect)) {
        const clamped = clampCircleRatios(
          finalX - boardRect.left,
          finalY - boardRect.top,
          circle.size,
          boardRect.width,
          boardRect.height,
        );
        setSnapshot((prev) => ({
          ...prev,
          circles: prev.circles.map((item) =>
            item.id === circle.id
              ? {...item, xRatio: clamped.xRatio, yRatio: clamped.yRatio}
              : item,
          ),
        }));
        announce(`${circle.color} circle repositioned`);
      } else {
        setSnapshot((prev) => ({
          ...prev,
          circles: prev.circles.filter((item) => item.id !== circle.id),
        }));
        announce(`${circle.color} circle removed`);
      }
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onEnd);
    document.addEventListener('pointercancel', onEnd);
  };

  // Drag existing line on the board (drag outside board to delete)
  const startBoardLineDrag = (
    e: React.PointerEvent<HTMLButtonElement>,
    line: BoardLine,
  ) => {
    if (e.button !== 0 || isDrawingArrow) return;
    e.preventDefault();

    const boardRectOnStart = boardRef.current?.getBoundingClientRect();
    if (!boardRectOnStart) return;

    const currentAxisScreen =
      line.orientation === 'horizontal'
        ? boardRectOnStart.top + line.posRatio * boardRectOnStart.height
        : boardRectOnStart.left + line.posRatio * boardRectOnStart.width;
    const pointerAxis = line.orientation === 'horizontal' ? e.clientY : e.clientX;
    const axisOffset = pointerAxis - currentAxisScreen;

    setDraggingId(line.id);
    setDraggingOutside(false);

    const onMove = (moveEvent: PointerEvent) => {
      const boardRect = boardRef.current?.getBoundingClientRect();
      if (!boardRect) return;

      const inside = isInsideRect(moveEvent.clientX, moveEvent.clientY, boardRect);
      setDraggingOutside(!inside);

      const rawAxisPos =
        line.orientation === 'horizontal'
          ? moveEvent.clientY - axisOffset - boardRect.top
          : moveEvent.clientX - axisOffset - boardRect.left;
      const clampedRatio = clampLineRatio(
        line.orientation,
        rawAxisPos,
        line.thickness,
        boardRect.width,
        boardRect.height,
      );

      setSnapshot((prev) => ({
        ...prev,
        lines: prev.lines.map((item) =>
          item.id === line.id ? {...item, posRatio: clampedRatio} : item,
        ),
      }));
    };

    const onEnd = (endEvent: PointerEvent) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onEnd);
      document.removeEventListener('pointercancel', onEnd);
      setDraggingId(null);
      setDraggingOutside(false);

      const boardRect = boardRef.current?.getBoundingClientRect();
      if (!boardRect) return;

      if (isInsideRect(endEvent.clientX, endEvent.clientY, boardRect)) {
        const rawAxisPos =
          line.orientation === 'horizontal'
            ? endEvent.clientY - axisOffset - boardRect.top
            : endEvent.clientX - axisOffset - boardRect.left;
        const clampedRatio = clampLineRatio(
          line.orientation,
          rawAxisPos,
          line.thickness,
          boardRect.width,
          boardRect.height,
        );
        setSnapshot((prev) => ({
          ...prev,
          lines: prev.lines.map((item) =>
            item.id === line.id ? {...item, posRatio: clampedRatio} : item,
          ),
        }));
        announce(`${line.orientation} line repositioned`);
      } else {
        setSnapshot((prev) => ({
          ...prev,
          lines: prev.lines.filter((item) => item.id !== line.id),
        }));
        announce(`${line.orientation} line removed`);
      }
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onEnd);
    document.addEventListener('pointercancel', onEnd);
  };

  // Drag arrow endpoint ('start' or 'end') OR whole arrow ('move')
  const startBoardArrowDrag = (
    e: React.PointerEvent<SVGElement>,
    arrow: BoardArrow,
    mode: 'start' | 'end' | 'move',
  ) => {
    if (e.button !== 0 || isDrawingArrow) return;
    e.preventDefault();
    e.stopPropagation();

    const boardRectOnStart = boardRef.current?.getBoundingClientRect();
    if (!boardRectOnStart) return;

    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const origStartX = arrow.startXRatio;
    const origStartY = arrow.startYRatio;
    const origEndX = arrow.endXRatio;
    const origEndY = arrow.endYRatio;

    setDraggingId(arrow.id);
    setDraggingOutside(false);

    const onMove = (moveEvent: PointerEvent) => {
      const boardRect = boardRef.current?.getBoundingClientRect();
      if (!boardRect) return;

      const inside = isInsideRect(moveEvent.clientX, moveEvent.clientY, boardRect);
      setDraggingOutside(mode === 'move' && !inside);

      const dxRatio =
        (moveEvent.clientX - startClientX) / Math.max(1, boardRect.width);
      const dyRatio =
        (moveEvent.clientY - startClientY) / Math.max(1, boardRect.height);

      setSnapshot((prev) => ({
        ...prev,
        arrows: prev.arrows.map((item) => {
          if (item.id !== arrow.id) return item;
          if (mode === 'start') {
            return {
              ...item,
              startXRatio: clamp01(origStartX + dxRatio),
              startYRatio: clamp01(origStartY + dyRatio),
            };
          }
          if (mode === 'end') {
            return {
              ...item,
              endXRatio: clamp01(origEndX + dxRatio),
              endYRatio: clamp01(origEndY + dyRatio),
            };
          }
          return {
            ...item,
            startXRatio: origStartX + dxRatio,
            startYRatio: origStartY + dyRatio,
            endXRatio: origEndX + dxRatio,
            endYRatio: origEndY + dyRatio,
          };
        }),
      }));
    };

    const onEnd = (endEvent: PointerEvent) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onEnd);
      document.removeEventListener('pointercancel', onEnd);
      setDraggingId(null);
      setDraggingOutside(false);

      const boardRect = boardRef.current?.getBoundingClientRect();
      if (!boardRect) return;

      if (mode === 'move' && !isInsideRect(endEvent.clientX, endEvent.clientY, boardRect)) {
        setSnapshot((prev) => ({
          ...prev,
          arrows: prev.arrows.filter((item) => item.id !== arrow.id),
        }));
        announce('Tactical arrow removed');
        return;
      }

      // Clamp endpoints inside board bounds
      setSnapshot((prev) => ({
        ...prev,
        arrows: prev.arrows.map((item) =>
          item.id === arrow.id
            ? {
                ...item,
                startXRatio: clamp01(item.startXRatio),
                startYRatio: clamp01(item.startYRatio),
                endXRatio: clamp01(item.endXRatio),
                endYRatio: clamp01(item.endYRatio),
              }
            : item,
        ),
      }));
      announce('Tactical arrow updated');
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onEnd);
    document.addEventListener('pointercancel', onEnd);
  };

  // Keyboard movement / deletion for circles
  const handleCircleKeyDown = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    circle: BoardCircle,
  ) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      setSnapshot((prev) => ({
        ...prev,
        circles: prev.circles.filter((item) => item.id !== circle.id),
      }));
      announce(`${circle.color} circle deleted`);
      return;
    }

    const stepPx = 15;
    let dx = 0;
    let dy = 0;
    if (e.key === 'ArrowLeft') dx = -stepPx;
    else if (e.key === 'ArrowRight') dx = stepPx;
    else if (e.key === 'ArrowUp') dy = -stepPx;
    else if (e.key === 'ArrowDown') dy = stepPx;
    else return;

    e.preventDefault();
    const boardRect = boardRef.current?.getBoundingClientRect();
    const w = boardRect?.width ?? boardSize.width;
    const h = boardRect?.height ?? boardSize.height;
    const nextX = circle.xRatio * w + dx;
    const nextY = circle.yRatio * h + dy;

    if (nextX < 0 || nextX > w || nextY < 0 || nextY > h) {
      setSnapshot((prev) => ({
        ...prev,
        circles: prev.circles.filter((item) => item.id !== circle.id),
      }));
      announce(`${circle.color} circle moved outside board and deleted`);
      return;
    }

    const clamped = clampCircleRatios(nextX, nextY, circle.size, w, h);
    setSnapshot((prev) => ({
      ...prev,
      circles: prev.circles.map((item) =>
        item.id === circle.id
          ? {...item, xRatio: clamped.xRatio, yRatio: clamped.yRatio}
          : item,
      ),
    }));
  };

  // Keyboard movement / deletion for lines
  const handleLineKeyDown = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    line: BoardLine,
  ) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      setSnapshot((prev) => ({
        ...prev,
        lines: prev.lines.filter((item) => item.id !== line.id),
      }));
      announce(`${line.orientation} line deleted`);
      return;
    }

    const stepPx = 15;
    let delta = 0;
    if (line.orientation === 'horizontal') {
      if (e.key === 'ArrowUp') delta = -stepPx;
      else if (e.key === 'ArrowDown') delta = stepPx;
      else return;
    } else {
      if (e.key === 'ArrowLeft') delta = -stepPx;
      else if (e.key === 'ArrowRight') delta = stepPx;
      else return;
    }

    e.preventDefault();
    const boardRect = boardRef.current?.getBoundingClientRect();
    const w = boardRect?.width ?? boardSize.width;
    const h = boardRect?.height ?? boardSize.height;
    const dim = line.orientation === 'horizontal' ? h : w;
    const nextPos = line.posRatio * dim + delta;

    if (nextPos < 0 || nextPos > dim) {
      setSnapshot((prev) => ({
        ...prev,
        lines: prev.lines.filter((item) => item.id !== line.id),
      }));
      announce(`${line.orientation} line moved outside board and deleted`);
      return;
    }

    const clampedRatio = clampLineRatio(line.orientation, nextPos, line.thickness, w, h);
    setSnapshot((prev) => ({
      ...prev,
      lines: prev.lines.map((item) =>
        item.id === line.id ? {...item, posRatio: clampedRatio} : item,
      ),
    }));
  };

  // Keyboard movement / deletion for arrows
  const handleArrowKeyDown = (
    e: React.KeyboardEvent<SVGGElement>,
    arrow: BoardArrow,
  ) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      setSnapshot((prev) => ({
        ...prev,
        arrows: prev.arrows.filter((item) => item.id !== arrow.id),
      }));
      announce('Tactical arrow deleted');
      return;
    }

    const stepPx = 15;
    let dx = 0;
    let dy = 0;
    if (e.key === 'ArrowLeft') dx = -stepPx;
    else if (e.key === 'ArrowRight') dx = stepPx;
    else if (e.key === 'ArrowUp') dy = -stepPx;
    else if (e.key === 'ArrowDown') dy = stepPx;
    else return;

    e.preventDefault();
    const w = Math.max(1, boardSize.width);
    const h = Math.max(1, boardSize.height);
    const dxRatio = dx / w;
    const dyRatio = dy / h;

    setSnapshot((prev) => ({
      ...prev,
      arrows: prev.arrows.map((item) =>
        item.id === arrow.id
          ? {
              ...item,
              startXRatio: clamp01(item.startXRatio + dxRatio),
              startYRatio: clamp01(item.startYRatio + dyRatio),
              endXRatio: clamp01(item.endXRatio + dxRatio),
              endYRatio: clamp01(item.endYRatio + dyRatio),
            }
          : item,
      ),
    }));
  };

  const yellowCount = snapshot.circles.filter((c) => c.color === 'yellow').length;
  const redCount = snapshot.circles.filter((c) => c.color === 'red').length;
  const horizontalCount = snapshot.lines.filter((l) => l.orientation === 'horizontal').length;
  const verticalCount = snapshot.lines.filter((l) => l.orientation === 'vertical').length;
  const arrowCount = snapshot.arrows.length;
  const totalCircles = snapshot.circles.length;
  const totalLines = snapshot.lines.length;
  const totalItems = totalCircles + totalLines + arrowCount;

  const draftGeo = arrowDraft
    ? computeArrowGeometry(
        arrowDraft.startXRatio * boardSize.width,
        arrowDraft.startYRatio * boardSize.height,
        arrowDraft.endXRatio * boardSize.width,
        arrowDraft.endYRatio * boardSize.height,
        arrowThickness,
      )
    : null;

  return (
    <div className="flex h-dvh w-screen flex-col overflow-hidden bg-slate-50 md:flex-row">
      {/* Mobile Compact Header (< md) */}
      <header className="flex h-13 shrink-0 items-center justify-between gap-2 border-b border-slate-900 bg-white px-3 md:hidden">
        <div className="flex min-w-0 items-center gap-1">
          <h1 className="truncate text-sm font-bold tracking-tight text-slate-900">
            Tactic Board
          </h1>
          <button
            type="button"
            onClick={() => openInfoModal('about')}
            aria-label="About, pricing, and terms"
            className="inline-flex min-h-[34px] min-w-[34px] shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
          >
            <Info className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={handleExportPng}
            aria-label={isProUnlocked ? 'Export PNG' : 'Unlock Export PNG ($1.99)'}
            className="inline-flex min-h-[38px] items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-100 whitespace-nowrap shrink-0"
          >
            {isProUnlocked ? (
              <Download className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            ) : (
              <Lock className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden="true" />
            )}
            <span>{exportStatus === 'done' ? 'Saved' : 'PNG'}</span>
          </button>

          <button
            type="button"
            onClick={handleClearBoard}
            disabled={totalItems === 0}
            aria-label="Clear board"
            className="inline-flex min-h-[38px] items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-40 whitespace-nowrap shrink-0"
          >
            <Trash2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>Clear</span>
          </button>

          <button
            type="button"
            onClick={() => openPaywallWithReason(null)}
            className={`inline-flex min-h-[38px] items-center rounded-lg px-2.5 py-1.5 text-xs font-semibold text-white transition-colors whitespace-nowrap shrink-0 ${
              isProUnlocked
                ? 'bg-emerald-700 hover:bg-emerald-800'
                : 'bg-[#1565c0] hover:bg-[#0d47a1]'
            }`}
          >
            {isProUnlocked ? 'Pro ✓' : '$1.99'}
          </button>
        </div>
      </header>

      {/* Desktop Left Sidebar (3-Layer Palette) */}
      <aside
        aria-label="Tactical palette outside board"
        className="hidden h-full w-[310px] shrink-0 flex-col overflow-x-auto overflow-y-auto border-r border-slate-900 bg-white select-none md:flex lg:w-[25vw] lg:min-w-[304px] lg:max-w-[370px]"
      >
        {/* Layer 1 (Top): Title + Sandbox Quota + Export/Clear + Unlock/Install */}
        <section className="flex min-w-[280px] shrink-0 flex-col items-center gap-2.5 border-b border-slate-900 px-4 py-4">
          <h1 className="text-center text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap">
            Drag &amp; Drop Tactic Board
          </h1>

          {!isProUnlocked && (
            <p className="text-xs font-medium tracking-tight tabular-nums text-slate-500 whitespace-nowrap">
              Free · {totalCircles}/{FREE_MAX_CIRCLES} circles · {totalLines}/{FREE_MAX_LINES}{' '}
              lines · {arrowCount}/{FREE_MAX_ARROWS} arrows
            </p>
          )}

          <div className="flex w-full items-center justify-center gap-2">
            <button
              type="button"
              onClick={handleExportPng}
              className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-100 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1565c0]"
            >
              {isProUnlocked ? (
                <Download className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              ) : (
                <Lock className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden="true" />
              )}
              <span>{exportStatus === 'done' ? 'Exported ✓' : 'Export PNG'}</span>
            </button>

            <button
              type="button"
              onClick={handleClearBoard}
              disabled={totalItems === 0}
              className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1565c0]"
            >
              <Trash2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>Clear</span>
            </button>
          </div>

          <div className="flex w-full flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => openPaywallWithReason(null)}
              className={`inline-flex min-h-[40px] items-center justify-center rounded-lg px-3.5 py-2 text-xs font-semibold text-white transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1565c0] ${
                isProUnlocked
                  ? 'bg-emerald-700 hover:bg-emerald-800'
                  : 'bg-[#1565c0] hover:bg-[#0d47a1]'
              }`}
            >
              {isProUnlocked ? 'Pro Unlocked ✓' : 'Unlock Full App ($1.99)'}
            </button>

            {isProUnlocked ? (
              <PWAInstallButton />
            ) : (
              <button
                type="button"
                onClick={() =>
                  openPaywallWithReason(
                    'Offline home-screen installation is included in Pro ($1.99 one-time).',
                  )
                }
                className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 whitespace-nowrap shrink-0"
              >
                <Lock className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden="true" />
                <span>Install App</span>
              </button>
            )}
          </div>
        </section>

        {/* Layer 2 (Middle): Yellow & Red Circle Templates + Size Selectors */}
        <section
          aria-label="Circles"
          className="flex min-w-[280px] shrink-0 flex-col items-center justify-center gap-5 border-b border-slate-900 px-4 py-5"
        >
          {/* Yellow Circle Palette */}
          <div className="flex flex-col items-center gap-2">
            <div className="flex min-h-[76px] items-center justify-center gap-5">
              <button
                type="button"
                onPointerDown={(e) => startCircleTemplateDrag(e, 'yellow')}
                aria-label="Yellow circle template. Drag onto the blue tactical board to add."
                style={{
                  width: CIRCLE_SIZE_PX[yellowSize],
                  height: CIRCLE_SIZE_PX[yellowSize],
                }}
                className="cursor-grab touch-none rounded-full border-[3px] border-black/25 bg-[#ffd600] shadow-md transition-[width,height] duration-150 active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
              />
              <span className="min-w-[2.25rem] font-mono text-3xl font-bold tabular-nums text-slate-900">
                {yellowCount}
              </span>
            </div>

            <div role="radiogroup" aria-label="Yellow circle size" className="flex items-center gap-3">
              {(['small', 'medium', 'large'] as const).map((sz) => (
                <label
                  key={sz}
                  className="inline-flex min-h-[30px] cursor-pointer items-center gap-1.5 text-sm font-medium capitalize text-slate-700"
                >
                  <input
                    type="radio"
                    name="desktopYellowSize"
                    value={sz}
                    checked={yellowSize === sz}
                    onChange={() => setYellowSize(sz)}
                    className="h-4 w-4 cursor-pointer accent-slate-700"
                  />
                  <span>{sz}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Red Circle Palette */}
          <div className="flex flex-col items-center gap-2">
            <div className="flex min-h-[76px] items-center justify-center gap-5">
              <button
                type="button"
                onPointerDown={(e) => startCircleTemplateDrag(e, 'red')}
                aria-label="Red circle template. Drag onto the blue tactical board to add."
                style={{
                  width: CIRCLE_SIZE_PX[redSize],
                  height: CIRCLE_SIZE_PX[redSize],
                }}
                className="cursor-grab touch-none rounded-full border-[3px] border-black/25 bg-[#e53935] shadow-md transition-[width,height] duration-150 active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
              />
              <span className="min-w-[2.25rem] font-mono text-3xl font-bold tabular-nums text-slate-900">
                {redCount}
              </span>
            </div>

            <div role="radiogroup" aria-label="Red circle size" className="flex items-center gap-3">
              {(['small', 'medium', 'large'] as const).map((sz) => (
                <label
                  key={sz}
                  className="inline-flex min-h-[30px] cursor-pointer items-center gap-1.5 text-sm font-medium capitalize text-slate-700"
                >
                  <input
                    type="radio"
                    name="desktopRedSize"
                    value={sz}
                    checked={redSize === sz}
                    onChange={() => setRedSize(sz)}
                    className="h-4 w-4 cursor-pointer accent-slate-700"
                  />
                  <span>{sz}</span>
                </label>
              ))}
            </div>
          </div>
        </section>

        {/* Layer 3 (Bottom): Horizontal & Vertical Lines + Tactical Arrows */}
        <section
          aria-label="Lines and Arrows"
          className="flex min-w-[280px] flex-1 shrink-0 flex-col items-center justify-center gap-5 px-4 py-5"
        >
          {/* Horizontal Line Palette */}
          <div className="flex flex-col items-center gap-2">
            <div className="flex min-h-[44px] items-center justify-center gap-5">
              <button
                type="button"
                onPointerDown={(e) => startLineTemplateDrag(e, 'horizontal')}
                aria-label="Horizontal gray line template. Drag onto the blue tactical board to add."
                className="flex h-10 w-20 cursor-grab touch-none items-center justify-center active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
              >
                <span
                  style={{height: LINE_THICKNESS_PX[horizontalThickness]}}
                  className="block w-full rounded-xs bg-[#9e9e9e] shadow-xs pointer-events-none"
                />
              </button>
              <span className="min-w-[2.25rem] font-mono text-3xl font-bold tabular-nums text-slate-900">
                {horizontalCount}
              </span>
            </div>

            <div
              role="radiogroup"
              aria-label="Horizontal line thickness"
              className="flex items-center gap-3"
            >
              {(['thin', 'medium', 'thick'] as const).map((th) => (
                <label
                  key={th}
                  className="inline-flex min-h-[30px] cursor-pointer items-center gap-1.5 text-sm font-medium capitalize text-slate-700"
                >
                  <input
                    type="radio"
                    name="desktopHorizontalThickness"
                    value={th}
                    checked={horizontalThickness === th}
                    onChange={() => setHorizontalThickness(th)}
                    className="h-4 w-4 cursor-pointer accent-slate-700"
                  />
                  <span>{th}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Vertical Line Palette */}
          <div className="flex flex-col items-center gap-2">
            <div className="flex min-h-[64px] items-center justify-center gap-5">
              <button
                type="button"
                onPointerDown={(e) => startLineTemplateDrag(e, 'vertical')}
                aria-label="Vertical gray line template. Drag onto the blue tactical board to add."
                className="flex h-16 w-14 cursor-grab touch-none items-center justify-center active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
              >
                <span
                  style={{width: LINE_THICKNESS_PX[verticalThickness]}}
                  className="block h-full rounded-xs bg-[#9e9e9e] shadow-xs pointer-events-none"
                />
              </button>
              <span className="min-w-[2.25rem] font-mono text-3xl font-bold tabular-nums text-slate-900">
                {verticalCount}
              </span>
            </div>

            <div
              role="radiogroup"
              aria-label="Vertical line thickness"
              className="flex items-center gap-3"
            >
              {(['thin', 'medium', 'thick'] as const).map((th) => (
                <label
                  key={th}
                  className="inline-flex min-h-[30px] cursor-pointer items-center gap-1.5 text-sm font-medium capitalize text-slate-700"
                >
                  <input
                    type="radio"
                    name="desktopVerticalThickness"
                    value={th}
                    checked={verticalThickness === th}
                    onChange={() => setVerticalThickness(th)}
                    className="h-4 w-4 cursor-pointer accent-slate-700"
                  />
                  <span>{th}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Tactical Arrow Palette & Draw Mode */}
          <div className="flex w-full flex-col items-center gap-2 border-t border-slate-200 pt-4">
            <div className="flex min-h-[44px] items-center justify-center gap-4">
              <button
                type="button"
                onPointerDown={startArrowTemplateDrag}
                aria-label="Tactical arrow template. Drag onto the blue board to add."
                className="flex h-10 w-20 cursor-grab touch-none items-center justify-center rounded-lg bg-[#1565c0] px-2 shadow-xs active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
              >
                <MoveRight
                  className="h-6 w-12 text-white pointer-events-none"
                  strokeWidth={arrowThickness === 'thin' ? 1.8 : arrowThickness === 'medium' ? 2.5 : 3.4}
                  aria-hidden="true"
                />
              </button>
              <span className="min-w-[2.25rem] font-mono text-3xl font-bold tabular-nums text-slate-900">
                {arrowCount}
              </span>
            </div>

            <button
              type="button"
              onClick={toggleDrawArrowMode}
              className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                isDrawingArrow
                  ? 'border-[#1565c0] bg-[#1565c0] text-white shadow-xs'
                  : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-100'
              }`}
            >
              <Pencil className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{isDrawingArrow ? 'Drawing Arrows ✓' : 'Draw Arrow on Board'}</span>
            </button>

            <div
              role="radiogroup"
              aria-label="Tactical arrow thickness"
              className="flex items-center gap-3"
            >
              {(['thin', 'medium', 'thick'] as const).map((th) => (
                <label
                  key={th}
                  className="inline-flex min-h-[30px] cursor-pointer items-center gap-1.5 text-sm font-medium capitalize text-slate-700"
                >
                  <input
                    type="radio"
                    name="desktopArrowThickness"
                    value={th}
                    checked={arrowThickness === th}
                    onChange={() => setArrowThickness(th)}
                    className="h-4 w-4 cursor-pointer accent-slate-700"
                  />
                  <span>{th}</span>
                </label>
              ))}
            </div>
          </div>
        </section>

        {/* Compact Info / Pricing / Terms Footer for Public Deployment & Merchant Review */}
        <footer className="flex min-w-[280px] shrink-0 items-center justify-center gap-2 border-t border-slate-200 px-4 py-2.5 text-[11px] font-medium text-slate-500">
          <button
            type="button"
            onClick={() => openInfoModal('about')}
            className="hover:text-slate-900 hover:underline"
          >
            About
          </button>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            onClick={() => openInfoModal('pricing')}
            className="hover:text-slate-900 hover:underline"
          >
            Pricing
          </button>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            onClick={() => openInfoModal('terms')}
            className="hover:text-slate-900 hover:underline"
          >
            Refunds &amp; Terms
          </button>
        </footer>
      </aside>

      {/* Main Blue Tactical Board Canvas */}
      <main
        ref={boardRef}
        aria-label="Blue tactical board"
        onPointerDown={handleBoardDrawPointerDown}
        className={`relative min-h-0 flex-1 overflow-hidden bg-[#1565c0] ${
          isDrawingArrow ? 'cursor-crosshair touch-none' : ''
        }`}
      >
        {totalItems === 0 && !isDrawingArrow && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 text-center">
            <p className="max-w-xs text-sm font-medium text-white/65">
              Drag circles, divider lines, or arrows onto the board—or tap Draw Arrow to
              sketch player movement vectors.
            </p>
          </div>
        )}

        {/* Active Draw Arrow Mode Banner */}
        {isDrawingArrow && (
          <div
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute top-3 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-slate-200 bg-white/95 px-3.5 py-2 text-xs font-medium text-slate-800 shadow-lg backdrop-blur-xs"
          >
            <span className="whitespace-nowrap">
              Drag from any circle or spot to draw an arrow
            </span>
            <button
              type="button"
              onClick={() => {
                setIsDrawingArrow(false);
                setArrowDraft(null);
              }}
              className="min-h-[30px] rounded-md bg-[#1565c0] px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-[#0d47a1] whitespace-nowrap shrink-0"
            >
              Done
            </button>
          </div>
        )}

        {/* Board Divider Lines (z-10) */}
        {snapshot.lines.map((line) => {
          const isDragging = draggingId === line.id;
          const isHorizontal = line.orientation === 'horizontal';
          return (
            <button
              key={line.id}
              type="button"
              onPointerDown={(e) => startBoardLineDrag(e, line)}
              onKeyDown={(e) => handleLineKeyDown(e, line)}
              aria-label={`${line.thickness} ${line.orientation} gray line. Drag or use arrow keys to move, Delete to remove.`}
              style={
                isHorizontal
                  ? {top: `${line.posRatio * 100}%`}
                  : {left: `${line.posRatio * 100}%`}
              }
              className={`absolute z-10 flex cursor-grab touch-none items-center justify-center bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-dashed focus-visible:outline-white ${
                isHorizontal
                  ? 'left-0 h-[24px] w-full -translate-y-1/2'
                  : 'top-0 h-full w-[24px] -translate-x-1/2'
              } ${isDragging ? 'z-15 cursor-grabbing' : ''} ${
                isDrawingArrow ? 'pointer-events-none' : ''
              }`}
            >
              <span
                style={
                  isHorizontal
                    ? {height: LINE_THICKNESS_PX[line.thickness]}
                    : {width: LINE_THICKNESS_PX[line.thickness]}
                }
                className={`pointer-events-none block rounded-xs bg-[#9e9e9e] shadow-sm transition-opacity ${
                  isHorizontal ? 'w-full' : 'h-full'
                } ${isDragging && draggingOutside ? 'opacity-40' : 'opacity-100'}`}
              />
            </button>
          );
        })}

        {/* Tactical Arrows SVG Layer (z-15: above divider lines, below circle centers) */}
        <svg
          width={boardSize.width}
          height={boardSize.height}
          viewBox={`0 0 ${Math.max(1, boardSize.width)} ${Math.max(1, boardSize.height)}`}
          className={`absolute inset-0 z-15 h-full w-full overflow-visible ${
            isDrawingArrow ? 'pointer-events-none' : ''
          }`}
        >
          {snapshot.arrows.map((arrow) => {
            const x1 = arrow.startXRatio * boardSize.width;
            const y1 = arrow.startYRatio * boardSize.height;
            const x2 = arrow.endXRatio * boardSize.width;
            const y2 = arrow.endYRatio * boardSize.height;
            const geo = computeArrowGeometry(x1, y1, x2, y2, arrow.thickness);
            const isDragging = draggingId === arrow.id;

            return (
              <g
                key={arrow.id}
                tabIndex={isDrawingArrow ? -1 : 0}
                role="button"
                aria-label={`${arrow.thickness} tactical arrow. Drag shaft to move, drag ends to aim, Delete to remove.`}
                onKeyDown={(e) => handleArrowKeyDown(e, arrow)}
                className={`group outline-none ${
                  isDragging && draggingOutside ? 'opacity-40' : 'opacity-100'
                }`}
              >
                {/* Wide invisible hit target for dragging the whole arrow */}
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="transparent"
                  strokeWidth={22}
                  strokeLinecap="round"
                  onPointerDown={(e) => startBoardArrowDrag(e, arrow, 'move')}
                  className={`${isDrawingArrow ? 'pointer-events-none' : 'pointer-events-auto cursor-grab active:cursor-grabbing'}`}
                />

                {/* Visible Arrow Shaft */}
                <line
                  x1={x1}
                  y1={y1}
                  x2={geo.shaftEndX}
                  y2={geo.shaftEndY}
                  stroke="#ffffff"
                  strokeWidth={geo.strokeW}
                  strokeLinecap="round"
                  style={{filter: 'drop-shadow(0 1px 2px rgba(0, 0, 0, 0.32))'}}
                  className="pointer-events-none"
                />

                {/* Visible Arrowhead */}
                {geo.headPoints && (
                  <polygon
                    points={geo.headPoints}
                    fill="#ffffff"
                    style={{filter: 'drop-shadow(0 1px 2px rgba(0, 0, 0, 0.32))'}}
                    className="pointer-events-none"
                  />
                )}

                {/* Endpoint Drag Handles (shown on hover/focus/drag in Move mode) */}
                {!isDrawingArrow && (
                  <>
                    <circle
                      cx={x1}
                      cy={y1}
                      r={9}
                      fill="rgba(255, 255, 255, 0.35)"
                      stroke="#ffffff"
                      strokeWidth={2}
                      onPointerDown={(e) => startBoardArrowDrag(e, arrow, 'start')}
                      className="pointer-events-auto cursor-crosshair opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                    />
                    <circle
                      cx={x2}
                      cy={y2}
                      r={10}
                      fill="rgba(255, 255, 255, 0.35)"
                      stroke="#ffffff"
                      strokeWidth={2}
                      onPointerDown={(e) => startBoardArrowDrag(e, arrow, 'end')}
                      className="pointer-events-auto cursor-crosshair opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                    />
                  </>
                )}
              </g>
            );
          })}

          {/* Live Arrow Preview While Drawing */}
          {arrowDraft && draftGeo && (
            <g className="pointer-events-none">
              <line
                x1={arrowDraft.startXRatio * boardSize.width}
                y1={arrowDraft.startYRatio * boardSize.height}
                x2={draftGeo.shaftEndX}
                y2={draftGeo.shaftEndY}
                stroke="#ffffff"
                strokeWidth={draftGeo.strokeW}
                strokeLinecap="round"
                strokeDasharray="6 4"
              />
              {draftGeo.headPoints && (
                <polygon points={draftGeo.headPoints} fill="#ffffff" />
              )}
            </g>
          )}
        </svg>

        {/* Board Circles (z-20, above lines and arrow tails) */}
        {snapshot.circles.map((circle) => {
          const isDragging = draggingId === circle.id;
          const px = CIRCLE_SIZE_PX[circle.size];
          return (
            <button
              key={circle.id}
              type="button"
              onPointerDown={(e) => startBoardCircleDrag(e, circle)}
              onKeyDown={(e) => handleCircleKeyDown(e, circle)}
              aria-label={`${circle.size} ${circle.color} circle. Drag or use arrow keys to move, Delete to remove.`}
              style={{
                left: `${circle.xRatio * 100}%`,
                top: `${circle.yRatio * 100}%`,
                width: px,
                height: px,
              }}
              className={`absolute z-20 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none rounded-full border-[3px] border-black/25 shadow-md focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-white ${
                circle.color === 'yellow' ? 'bg-[#ffd600]' : 'bg-[#e53935]'
              } ${isDragging ? 'z-30 cursor-grabbing shadow-xl' : ''} ${
                isDragging && draggingOutside ? 'scale-90 opacity-45' : ''
              } ${isDrawingArrow ? 'pointer-events-none' : ''}`}
            />
          );
        })}

        {/* Offline Connectivity Indicator */}
        {!isOnline && (
          <div className="pointer-events-none absolute bottom-3 left-3 z-30 inline-flex items-center gap-1.5 rounded-lg bg-amber-600/95 px-2.5 py-1.5 text-xs font-semibold text-white shadow-md">
            <WifiOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>Offline Mode — Saved on device</span>
          </div>
        )}

        {/* Instant Undo Clear Toast */}
        {undoSnapshot && (
          <div className="absolute bottom-3 right-3 z-30 flex items-center gap-3 rounded-lg bg-slate-900/95 px-3.5 py-2 text-xs font-medium text-white shadow-lg">
            <span>Board cleared</span>
            <button
              type="button"
              onClick={handleUndoClear}
              className="inline-flex min-h-[32px] items-center gap-1 rounded-md bg-white/15 px-2.5 py-1 font-semibold text-white transition-colors hover:bg-white/25"
            >
              <RotateCcw className="h-3 w-3" aria-hidden="true" />
              <span>Undo</span>
            </button>
          </div>
        )}
      </main>

      {/* Mobile Bottom Thumb-Zone Palette Dock (< md) */}
      <section
        aria-label="Mobile tactical palette"
        className="shrink-0 border-t border-slate-900 bg-white px-3 pt-2 pb-[max(0.6rem,env(safe-area-inset-bottom))] select-none md:hidden"
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
            <button
              type="button"
              onClick={() => setMobilePaletteTab('circles')}
              className={`min-h-[36px] rounded-md px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                mobilePaletteTab === 'circles'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600'
              }`}
            >
              Circles ({isProUnlocked ? totalCircles : `${totalCircles}/${FREE_MAX_CIRCLES}`})
            </button>
            <button
              type="button"
              onClick={() => setMobilePaletteTab('lines')}
              className={`min-h-[36px] rounded-md px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                mobilePaletteTab === 'lines'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600'
              }`}
            >
              Lines ({isProUnlocked ? totalLines : `${totalLines}/${FREE_MAX_LINES}`})
            </button>
            <button
              type="button"
              onClick={() => setMobilePaletteTab('arrows')}
              className={`min-h-[36px] rounded-md px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                mobilePaletteTab === 'arrows'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600'
              }`}
            >
              Arrows ({isProUnlocked ? arrowCount : `${arrowCount}/${FREE_MAX_ARROWS}`})
            </button>
          </div>

          {isProUnlocked ? (
            <PWAInstallButton compact />
          ) : (
            <button
              type="button"
              onClick={() =>
                openPaywallWithReason(
                  'Offline home-screen installation is included in Pro ($1.99 one-time).',
                )
              }
              className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-slate-300 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700 whitespace-nowrap shrink-0"
            >
              <Lock className="h-3 w-3 text-slate-500" aria-hidden="true" />
              <span>Install</span>
            </button>
          )}
        </div>

        {mobilePaletteTab === 'circles' && (
          <div className="grid grid-cols-2 gap-3">
            {/* Mobile Yellow Circle Control */}
            <div className="flex flex-col items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50/70 p-2">
              <div className="flex min-h-[56px] items-center gap-3">
                <button
                  type="button"
                  onPointerDown={(e) => startCircleTemplateDrag(e, 'yellow')}
                  aria-label="Yellow circle template. Drag up onto the tactical board."
                  style={{
                    width: Math.min(48, CIRCLE_SIZE_PX[yellowSize]),
                    height: Math.min(48, CIRCLE_SIZE_PX[yellowSize]),
                  }}
                  className="cursor-grab touch-none rounded-full border-[3px] border-black/25 bg-[#ffd600] shadow-sm active:cursor-grabbing"
                />
                <span className="font-mono text-xl font-bold tabular-nums text-slate-900">
                  {yellowCount}
                </span>
              </div>
              <div className="flex w-full justify-center gap-1">
                {(['small', 'medium', 'large'] as const).map((sz) => (
                  <button
                    key={sz}
                    type="button"
                    onClick={() => setYellowSize(sz)}
                    className={`min-h-[32px] flex-1 rounded-md px-1.5 text-[11px] font-semibold uppercase transition-colors ${
                      yellowSize === sz
                        ? 'bg-slate-900 text-white'
                        : 'bg-white text-slate-600 border border-slate-200'
                    }`}
                  >
                    {sz === 'small' ? 'S' : sz === 'medium' ? 'M' : 'L'}
                  </button>
                ))}
              </div>
            </div>

            {/* Mobile Red Circle Control */}
            <div className="flex flex-col items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50/70 p-2">
              <div className="flex min-h-[56px] items-center gap-3">
                <button
                  type="button"
                  onPointerDown={(e) => startCircleTemplateDrag(e, 'red')}
                  aria-label="Red circle template. Drag up onto the tactical board."
                  style={{
                    width: Math.min(48, CIRCLE_SIZE_PX[redSize]),
                    height: Math.min(48, CIRCLE_SIZE_PX[redSize]),
                  }}
                  className="cursor-grab touch-none rounded-full border-[3px] border-black/25 bg-[#e53935] shadow-sm active:cursor-grabbing"
                />
                <span className="font-mono text-xl font-bold tabular-nums text-slate-900">
                  {redCount}
                </span>
              </div>
              <div className="flex w-full justify-center gap-1">
                {(['small', 'medium', 'large'] as const).map((sz) => (
                  <button
                    key={sz}
                    type="button"
                    onClick={() => setRedSize(sz)}
                    className={`min-h-[32px] flex-1 rounded-md px-1.5 text-[11px] font-semibold uppercase transition-colors ${
                      redSize === sz
                        ? 'bg-slate-900 text-white'
                        : 'bg-white text-slate-600 border border-slate-200'
                    }`}
                  >
                    {sz === 'small' ? 'S' : sz === 'medium' ? 'M' : 'L'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {mobilePaletteTab === 'lines' && (
          <div className="grid grid-cols-2 gap-3">
            {/* Mobile Horizontal Line Control */}
            <div className="flex flex-col items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50/70 p-2">
              <div className="flex min-h-[56px] items-center gap-3">
                <button
                  type="button"
                  onPointerDown={(e) => startLineTemplateDrag(e, 'horizontal')}
                  aria-label="Horizontal line template. Drag up onto the tactical board."
                  className="flex h-10 w-16 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
                >
                  <span
                    style={{height: LINE_THICKNESS_PX[horizontalThickness]}}
                    className="block w-full rounded-xs bg-[#9e9e9e] pointer-events-none"
                  />
                </button>
                <span className="font-mono text-xl font-bold tabular-nums text-slate-900">
                  {horizontalCount}
                </span>
              </div>
              <div className="flex w-full justify-center gap-1">
                {(['thin', 'medium', 'thick'] as const).map((th) => (
                  <button
                    key={th}
                    type="button"
                    onClick={() => setHorizontalThickness(th)}
                    className={`min-h-[32px] flex-1 rounded-md px-1 text-[11px] font-semibold capitalize transition-colors ${
                      horizontalThickness === th
                        ? 'bg-slate-900 text-white'
                        : 'bg-white text-slate-600 border border-slate-200'
                    }`}
                  >
                    {th === 'medium' ? 'Med' : th}
                  </button>
                ))}
              </div>
            </div>

            {/* Mobile Vertical Line Control */}
            <div className="flex flex-col items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50/70 p-2">
              <div className="flex min-h-[56px] items-center gap-3">
                <button
                  type="button"
                  onPointerDown={(e) => startLineTemplateDrag(e, 'vertical')}
                  aria-label="Vertical line template. Drag up onto the tactical board."
                  className="flex h-12 w-10 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
                >
                  <span
                    style={{width: LINE_THICKNESS_PX[verticalThickness]}}
                    className="block h-full rounded-xs bg-[#9e9e9e] pointer-events-none"
                  />
                </button>
                <span className="font-mono text-xl font-bold tabular-nums text-slate-900">
                  {verticalCount}
                </span>
              </div>
              <div className="flex w-full justify-center gap-1">
                {(['thin', 'medium', 'thick'] as const).map((th) => (
                  <button
                    key={th}
                    type="button"
                    onClick={() => setVerticalThickness(th)}
                    className={`min-h-[32px] flex-1 rounded-md px-1 text-[11px] font-semibold capitalize transition-colors ${
                      verticalThickness === th
                        ? 'bg-slate-900 text-white'
                        : 'bg-white text-slate-600 border border-slate-200'
                    }`}
                  >
                    {th === 'medium' ? 'Med' : th}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {mobilePaletteTab === 'arrows' && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-2.5">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onPointerDown={startArrowTemplateDrag}
                aria-label="Tactical arrow template. Drag up onto the tactical board."
                className="flex h-11 w-16 cursor-grab touch-none items-center justify-center rounded-lg bg-[#1565c0] active:cursor-grabbing"
              >
                <MoveRight className="h-5 w-10 text-white pointer-events-none" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={toggleDrawArrowMode}
                className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  isDrawingArrow
                    ? 'border-[#1565c0] bg-[#1565c0] text-white'
                    : 'border-slate-300 bg-white text-slate-800'
                }`}
              >
                <Pencil className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{isDrawingArrow ? 'Drawing ✓' : 'Draw'}</span>
              </button>
            </div>

            <div className="flex gap-1">
              {(['thin', 'medium', 'thick'] as const).map((th) => (
                <button
                  key={th}
                  type="button"
                  onClick={() => setArrowThickness(th)}
                  className={`min-h-[36px] rounded-md px-2 text-[11px] font-semibold capitalize transition-colors ${
                    arrowThickness === th
                      ? 'bg-slate-900 text-white'
                      : 'bg-white text-slate-600 border border-slate-200'
                  }`}
                >
                  {th === 'medium' ? 'Med' : th}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Floating Ghost Preview while dragging new item from Palette */}
      {dragPreview && dragPreview.kind === 'circle' && dragPreview.color && dragPreview.size && (
        <div
          aria-hidden="true"
          style={{
            left: dragPreview.clientX,
            top: dragPreview.clientY,
            width: CIRCLE_SIZE_PX[dragPreview.size],
            height: CIRCLE_SIZE_PX[dragPreview.size],
          }}
          className={`pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-black/25 shadow-xl ${
            dragPreview.color === 'yellow' ? 'bg-[#ffd600]' : 'bg-[#e53935]'
          }`}
        />
      )}

      {dragPreview &&
        dragPreview.kind === 'line' &&
        dragPreview.orientation &&
        dragPreview.thickness && (
          <div
            aria-hidden="true"
            style={{
              left: dragPreview.clientX,
              top: dragPreview.clientY,
              width: dragPreview.orientation === 'horizontal' ? 120 : 24,
              height: dragPreview.orientation === 'horizontal' ? 24 : 120,
            }}
            className="pointer-events-none fixed z-50 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center"
          >
            <span
              style={
                dragPreview.orientation === 'horizontal'
                  ? {height: LINE_THICKNESS_PX[dragPreview.thickness]}
                  : {width: LINE_THICKNESS_PX[dragPreview.thickness]}
              }
              className={`block rounded-xs bg-[#9e9e9e] shadow-md ${
                dragPreview.orientation === 'horizontal' ? 'w-full' : 'h-full'
              }`}
            />
          </div>
        )}

      {dragPreview && dragPreview.kind === 'arrow' && dragPreview.thickness && (
        <div
          aria-hidden="true"
          style={{
            left: dragPreview.clientX,
            top: dragPreview.clientY,
          }}
          className="pointer-events-none fixed z-50 flex h-10 w-24 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-lg bg-[#1565c0]/85 px-2 shadow-lg"
        >
          <MoveRight
            className="h-6 w-14 text-white"
            strokeWidth={
              dragPreview.thickness === 'thin'
                ? 1.8
                : dragPreview.thickness === 'medium'
                  ? 2.5
                  : 3.4
            }
          />
        </div>
      )}

      <PaywallModal
        isOpen={paywallOpen}
        isProUnlocked={isProUnlocked}
        proMode={proLicense?.mode ?? null}
        triggerReason={paywallReason}
        onClose={() => {
          setPaywallOpen(false);
          setPaywallReason(null);
        }}
        onLicenseActivated={handleLicenseActivated}
        onPreviewUnlock={handlePreviewUnlock}
        onResetToFree={handleResetToFree}
        onOpenTerms={() => openInfoModal('terms')}
      />

      <InfoTermsModal
        isOpen={infoModalOpen}
        initialTab={infoModalTab}
        onClose={closeInfoModal}
        onOpenUpgrade={() => openPaywallWithReason(null)}
      />

      <div className="sr-only" aria-live="polite">
        {liveAnnouncement}
      </div>
    </div>
  );
}
