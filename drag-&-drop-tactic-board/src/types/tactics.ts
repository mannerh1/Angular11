export type CircleColor = 'yellow' | 'red';
export type CircleSize = 'small' | 'medium' | 'large';

export type LineOrientation = 'horizontal' | 'vertical';
export type LineThickness = 'thin' | 'medium' | 'thick';

export interface BoardCircle {
  id: string;
  color: CircleColor;
  /** Normalized X coordinate within [0, 1] relative to board width */
  xRatio: number;
  /** Normalized Y coordinate within [0, 1] relative to board height */
  yRatio: number;
  size: CircleSize;
}

export interface BoardLine {
  id: string;
  orientation: LineOrientation;
  /** Normalized axis coordinate within [0, 1] (Y ratio for horizontal, X ratio for vertical) */
  posRatio: number;
  thickness: LineThickness;
}

export interface BoardArrow {
  id: string;
  startXRatio: number;
  startYRatio: number;
  endXRatio: number;
  endYRatio: number;
  thickness: LineThickness;
}

export interface TacticBoardSnapshot {
  circles: BoardCircle[];
  lines: BoardLine[];
  arrows: BoardArrow[];
}

export const CIRCLE_SIZE_PX: Record<CircleSize, number> = {
  small: 36,
  medium: 56,
  large: 76,
};

export const CIRCLE_RADIUS_PX: Record<CircleSize, number> = {
  small: 18,
  medium: 28,
  large: 38,
};

export const LINE_THICKNESS_PX: Record<LineThickness, number> = {
  thin: 2,
  medium: 6,
  thick: 12,
};

export const ARROW_STROKE_PX: Record<LineThickness, number> = {
  thin: 3,
  medium: 5,
  thick: 8,
};
