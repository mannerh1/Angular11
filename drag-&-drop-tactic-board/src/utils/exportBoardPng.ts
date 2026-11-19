import {
  ARROW_STROKE_PX,
  BoardArrow,
  BoardCircle,
  BoardLine,
  CIRCLE_RADIUS_PX,
  LINE_THICKNESS_PX,
} from '../types/tactics';

export interface ExportBoardOptions {
  circles: BoardCircle[];
  lines: BoardLine[];
  arrows: BoardArrow[];
  boardWidth: number;
  boardHeight: number;
}

export async function exportBoardAsPng({
  circles,
  lines,
  arrows,
  boardWidth,
  boardHeight,
}: ExportBoardOptions): Promise<void> {
  const safeW = Math.max(320, boardWidth);
  const safeH = Math.max(240, boardHeight);

  // Render at high-DPI width (minimum 1440px wide) so exported tactics look crisp in chats & slides
  const targetWidth = Math.max(1440, Math.round(safeW * 2));
  const scale = targetWidth / safeW;
  const targetHeight = Math.round(safeH * scale);

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not initialize 2D canvas context for PNG export.');
  }

  // 1. Tactical Blue Board Background (#1565c0)
  ctx.fillStyle = '#1565c0';
  ctx.fillRect(0, 0, targetWidth, targetHeight);

  // 2. Draw Divider Lines (z-index 10, below arrows and circles)
  for (const line of lines) {
    const thicknessPx = LINE_THICKNESS_PX[line.thickness] * scale;
    ctx.save();
    ctx.fillStyle = '#9e9e9e';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
    ctx.shadowBlur = 4 * scale;
    ctx.shadowOffsetY = 1 * scale;

    if (line.orientation === 'horizontal') {
      const yCenter = line.posRatio * targetHeight;
      ctx.fillRect(0, yCenter - thicknessPx / 2, targetWidth, thicknessPx);
    } else {
      const xCenter = line.posRatio * targetWidth;
      ctx.fillRect(xCenter - thicknessPx / 2, 0, thicknessPx, targetHeight);
    }
    ctx.restore();
  }

  // 3. Draw Tactical Arrows (z-index 15, between divider lines and circles)
  for (const arrow of arrows) {
    const x1 = arrow.startXRatio * targetWidth;
    const y1 = arrow.startYRatio * targetHeight;
    const x2 = arrow.endXRatio * targetWidth;
    const y2 = arrow.endYRatio * targetHeight;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 4) continue;

    const angle = Math.atan2(dy, dx);
    const strokeW = ARROW_STROKE_PX[arrow.thickness] * scale;
    const headLen = Math.max(strokeW * 3.1, 14 * scale);
    const shaftEndX = x2 - Math.cos(angle) * (headLen * 0.65);
    const shaftEndY = y2 - Math.sin(angle) * (headLen * 0.65);

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.28)';
    ctx.shadowBlur = 4 * scale;
    ctx.shadowOffsetY = 1 * scale;

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = strokeW;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(shaftEndX, shaftEndY);
    ctx.stroke();

    // Arrowhead triangle
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(
      x2 - headLen * Math.cos(angle - Math.PI / 6),
      y2 - headLen * Math.sin(angle - Math.PI / 6),
    );
    ctx.lineTo(
      x2 - headLen * Math.cos(angle + Math.PI / 6),
      y2 - headLen * Math.sin(angle + Math.PI / 6),
    );
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // 4. Draw Circles (z-index 20, above lines and arrow tails)
  for (const circle of circles) {
    const cx = circle.xRatio * targetWidth;
    const cy = circle.yRatio * targetHeight;
    const radius = CIRCLE_RADIUS_PX[circle.size] * scale;
    const strokeWidth = 3 * scale;

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.24)';
    ctx.shadowBlur = 10 * scale;
    ctx.shadowOffsetY = 4 * scale;

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = circle.color === 'yellow' ? '#ffd600' : '#e53935';
    ctx.fill();

    // Remove shadow before drawing border stroke
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = strokeWidth;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.28)';
    ctx.stroke();
    ctx.restore();
  }

  // 5. Subtle Corner Attribution Mark for Shared Play Diagrams
  ctx.save();
  const fontSize = Math.round(14 * scale);
  ctx.font = `600 ${fontSize}px "Plus Jakarta Sans", system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText('TacticBoard', targetWidth - 18 * scale, targetHeight - 14 * scale);
  ctx.restore();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((result) => resolve(result), 'image/png'),
  );
  if (!blob) {
    throw new Error('Failed to generate PNG image.');
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const dateStamp = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `tactic-board-${dateStamp}.png`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
