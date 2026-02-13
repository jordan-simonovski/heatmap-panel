import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { PanelProps, getFieldDisplayName, FieldType } from '@grafana/data';
import { getAppEvents } from '@grafana/runtime';
import { useTheme2 } from '@grafana/ui';
import { css } from '@emotion/css';
import { TimeseriesSelectionOptions, TimeseriesSelection, TimeseriesSelectionEvent } from '../types';

interface Props extends PanelProps<TimeseriesSelectionOptions> {}

const MARGIN = { top: 10, right: 10, bottom: 40, left: 60 };

interface DataPoint {
  time: number;
  value: number;
}

interface DragState {
  startX: number;
  currentX: number;
}

interface ContextMenuState {
  x: number;
  y: number;
  payload: TimeseriesSelection;
}

export const TimeseriesPanel: React.FC<Props> = ({ options, data, width, height, onChangeTimeRange }) => {
  const theme = useTheme2();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [selection, setSelection] = useState<{ x1: number; x2: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // --- Extract data points from frames ---
  const points = useMemo<DataPoint[]>(() => {
    const pts: DataPoint[] = [];
    for (const frame of data.series) {
      let timeIdx = -1;
      let valueIdx = -1;

      for (let i = 0; i < frame.fields.length; i++) {
        const f = frame.fields[i];
        const name = getFieldDisplayName(f, frame).toLowerCase();
        if (f.type === FieldType.time || name === 'time' || name === 'timestamp') {
          timeIdx = i;
        } else if (f.type === FieldType.number && valueIdx < 0) {
          valueIdx = i;
        }
      }

      if (timeIdx < 0 || valueIdx < 0) {
        continue;
      }

      const timeField = frame.fields[timeIdx];
      const valueField = frame.fields[valueIdx];

      for (let i = 0; i < frame.length; i++) {
        let t = timeField.values[i];
        if (typeof t === 'string') {
          t = new Date(t).getTime();
        } else if (typeof t === 'number' && t > 1e15) {
          t = t / 1e6; // nanoseconds to ms
        }
        const v = valueField.values[i];
        if (typeof v === 'number' && !isNaN(v)) {
          pts.push({ time: t, value: v });
        }
      }
    }
    pts.sort((a, b) => a.time - b.time);
    return pts;
  }, [data.series]);

  // --- Compute axis ranges ---
  const { minTime, maxTime, minVal, maxVal } = useMemo(() => {
    if (points.length === 0) {
      return { minTime: 0, maxTime: 1, minVal: 0, maxVal: 1 };
    }
    let mnT = Infinity, mxT = -Infinity, mnV = Infinity, mxV = -Infinity;
    for (const p of points) {
      if (p.time < mnT) { mnT = p.time; }
      if (p.time > mxT) { mxT = p.time; }
      if (p.value < mnV) { mnV = p.value; }
      if (p.value > mxV) { mxV = p.value; }
    }
    // Add padding to Y
    const range = mxV - mnV || 1;
    mnV = Math.max(0, mnV - range * 0.05);
    mxV = mxV + range * 0.1;
    return { minTime: mnT, maxTime: mxT, minVal: mnV, maxVal: mxV };
  }, [points]);

  const plotW = width - MARGIN.left - MARGIN.right;
  const plotH = height - MARGIN.top - MARGIN.bottom;

  const timeToX = useCallback(
    (t: number) => MARGIN.left + ((t - minTime) / (maxTime - minTime || 1)) * plotW,
    [minTime, maxTime, plotW]
  );
  const valToY = useCallback(
    (v: number) => MARGIN.top + plotH - ((v - minVal) / (maxVal - minVal || 1)) * plotH,
    [minVal, maxVal, plotH]
  );
  const xToTime = useCallback(
    (x: number) => minTime + ((x - MARGIN.left) / plotW) * (maxTime - minTime),
    [minTime, maxTime, plotW]
  );

  // --- Render line chart ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) { return; }
    const ctx = canvas.getContext('2d');
    if (!ctx) { return; }

    canvas.width = width;
    canvas.height = height;
    ctx.clearRect(0, 0, width, height);

    if (points.length === 0) {
      ctx.fillStyle = theme.colors.text.secondary;
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No data', width / 2, height / 2);
      return;
    }

    // Grid lines
    ctx.strokeStyle = theme.colors.border.weak;
    ctx.lineWidth = 1;
    const yTicks = 5;
    for (let i = 0; i <= yTicks; i++) {
      const v = minVal + (i / yTicks) * (maxVal - minVal);
      const y = valToY(v);
      ctx.beginPath();
      ctx.moveTo(MARGIN.left, y);
      ctx.lineTo(MARGIN.left + plotW, y);
      ctx.stroke();
    }

    // Threshold line
    if (options.thresholdValue != null) {
      const ty = valToY(options.thresholdValue);
      if (ty >= MARGIN.top && ty <= MARGIN.top + plotH) {
        ctx.save();
        ctx.strokeStyle = options.thresholdColor || '#e53935';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(MARGIN.left, ty);
        ctx.lineTo(MARGIN.left + plotW, ty);
        ctx.stroke();
        ctx.restore();

        // Label
        ctx.fillStyle = options.thresholdColor || '#e53935';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(formatValue(options.thresholdValue), MARGIN.left - 6, ty + 3);
      }
    }

    // Area fill under line
    const opacity = (options.fillOpacity ?? 15) / 100;
    if (opacity > 0 && points.length > 1) {
      ctx.beginPath();
      ctx.moveTo(timeToX(points[0].time), valToY(points[0].value));
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(timeToX(points[i].time), valToY(points[i].value));
      }
      // Close path along baseline
      ctx.lineTo(timeToX(points[points.length - 1].time), MARGIN.top + plotH);
      ctx.lineTo(timeToX(points[0].time), MARGIN.top + plotH);
      ctx.closePath();

      const lineColor = options.lineColor || '#4285f4';
      ctx.fillStyle = hexToRgba(lineColor, opacity);
      ctx.fill();
    }

    // Line
    ctx.beginPath();
    ctx.strokeStyle = options.lineColor || '#4285f4';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    for (let i = 0; i < points.length; i++) {
      const x = timeToX(points[i].time);
      const y = valToY(points[i].value);
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    // Axes
    ctx.strokeStyle = theme.colors.text.secondary;
    ctx.lineWidth = 1;

    // X axis
    ctx.beginPath();
    ctx.moveTo(MARGIN.left, MARGIN.top + plotH);
    ctx.lineTo(MARGIN.left + plotW, MARGIN.top + plotH);
    ctx.stroke();

    // Y axis
    ctx.beginPath();
    ctx.moveTo(MARGIN.left, MARGIN.top);
    ctx.lineTo(MARGIN.left, MARGIN.top + plotH);
    ctx.stroke();

    // X tick labels
    ctx.fillStyle = theme.colors.text.secondary;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    const xTicks = 5;
    for (let i = 0; i <= xTicks; i++) {
      const t = minTime + (i / xTicks) * (maxTime - minTime);
      const x = timeToX(t);
      ctx.fillText(new Date(t).toLocaleTimeString(), x, MARGIN.top + plotH + 14);
      ctx.beginPath();
      ctx.moveTo(x, MARGIN.top + plotH);
      ctx.lineTo(x, MARGIN.top + plotH + 4);
      ctx.stroke();
    }

    // Y tick labels
    ctx.textAlign = 'right';
    for (let i = 0; i <= yTicks; i++) {
      const v = minVal + (i / yTicks) * (maxVal - minVal);
      const y = valToY(v);
      ctx.fillText(formatValue(v), MARGIN.left - 6, y + 3);
      ctx.beginPath();
      ctx.moveTo(MARGIN.left - 3, y);
      ctx.lineTo(MARGIN.left, y);
      ctx.stroke();
    }

    // Axis labels
    ctx.fillStyle = theme.colors.text.primary;
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Time', MARGIN.left + plotW / 2, height - 4);

    ctx.save();
    ctx.translate(14, MARGIN.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(options.yAxisLabel || 'Value', 0, 0);
    ctx.restore();
  }, [points, width, height, options, theme, plotW, plotH, minTime, maxTime, minVal, maxVal, timeToX, valToY]);

  // --- Draw selection overlay ---
  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas) { return; }
    const ctx = canvas.getContext('2d');
    if (!ctx) { return; }

    canvas.width = width;
    canvas.height = height;
    ctx.clearRect(0, 0, width, height);

    const rect = drag
      ? { x1: drag.startX, x2: drag.currentX }
      : selection;

    if (!rect) { return; }

    const x = Math.min(rect.x1, rect.x2);
    const w = Math.abs(rect.x2 - rect.x1);

    // Full-height vertical band
    ctx.fillStyle = 'rgba(255, 193, 7, 0.25)';
    ctx.fillRect(x, MARGIN.top, w, plotH);
    ctx.strokeStyle = 'rgba(255, 193, 7, 0.8)';
    ctx.lineWidth = 2;
    // Left edge
    ctx.beginPath();
    ctx.moveTo(x, MARGIN.top);
    ctx.lineTo(x, MARGIN.top + plotH);
    ctx.stroke();
    // Right edge
    ctx.beginPath();
    ctx.moveTo(x + w, MARGIN.top);
    ctx.lineTo(x + w, MARGIN.top + plotH);
    ctx.stroke();
  }, [drag, selection, width, height, plotH]);

  // --- Resolve selection ---
  const resolveSelection = useCallback(
    (x1: number, x2: number): TimeseriesSelection => {
      const fromTime = xToTime(Math.min(x1, x2));
      const toTime = xToTime(Math.max(x1, x2));
      return {
        timeRange: { from: fromTime, to: toTime },
      };
    },
    [xToTime]
  );

  // --- Mouse handlers (horizontal-only brush) ---
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      setContextMenu(null);

      const rect = overlayRef.current?.getBoundingClientRect();
      if (!rect) { return; }
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (x < MARGIN.left || x > MARGIN.left + plotW || y < MARGIN.top || y > MARGIN.top + plotH) {
        return;
      }
      setDrag({ startX: x, currentX: x });
      setSelection(null);
    },
    [plotW, plotH]
  );

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!drag) { return; }
      const rect = overlayRef.current?.getBoundingClientRect();
      if (!rect) { return; }
      const x = Math.max(MARGIN.left, Math.min(e.clientX - rect.left, MARGIN.left + plotW));
      setDrag((prev) => (prev ? { ...prev, currentX: x } : null));
    },
    [drag, plotW]
  );

  const onMouseUp = useCallback(() => {
    if (!drag) { return; }

    const x1 = Math.min(drag.startX, drag.currentX);
    const x2 = Math.max(drag.startX, drag.currentX);

    if (x2 - x1 < 5) {
      setDrag(null);
      setSelection(null);
      return;
    }

    setSelection({ x1, x2 });
    setDrag(null);

    const payload = resolveSelection(x1, x2);
    const menuX = Math.min(x2 + 4, width - 200);
    const menuY = MARGIN.top;
    setContextMenu({ x: menuX, y: menuY, payload });
  }, [drag, resolveSelection, width]);

  const onMouseLeave = useCallback(() => {
    if (drag) {
      onMouseUp();
    }
  }, [drag, onMouseUp]);

  // --- Context menu actions ---
  const handleAnalyse = useCallback(() => {
    if (!contextMenu) { return; }
    getAppEvents().publish(new TimeseriesSelectionEvent(contextMenu.payload));
    setContextMenu(null);
  }, [contextMenu]);

  const handleZoom = useCallback(() => {
    if (!contextMenu) { return; }
    const { from, to } = contextMenu.payload.timeRange;
    onChangeTimeRange({ from, to });
    setContextMenu(null);
    setSelection(null);
  }, [contextMenu, onChangeTimeRange]);

  const dismissMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  return (
    <div
      className={css`
        position: relative;
        width: ${width}px;
        height: ${height}px;
        cursor: crosshair;
      `}
    >
      <canvas
        ref={canvasRef}
        className={css`
          position: absolute;
          top: 0;
          left: 0;
        `}
      />
      <canvas
        ref={overlayRef}
        className={css`
          position: absolute;
          top: 0;
          left: 0;
        `}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave}
      />

      {/* Context menu */}
      {contextMenu && (
        <div
          className={css`
            position: absolute;
            top: ${contextMenu.y}px;
            left: ${contextMenu.x}px;
            z-index: 100;
            background: ${theme.colors.background.primary};
            border: 1px solid ${theme.colors.border.medium};
            border-radius: ${theme.shape.radius.default};
            box-shadow: ${theme.shadows.z3};
            min-width: 180px;
            padding: 4px 0;
            font-size: 13px;
          `}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div
            className={css`
              padding: 6px 12px;
              color: ${theme.colors.text.secondary};
              font-size: 11px;
              border-bottom: 1px solid ${theme.colors.border.weak};
              margin-bottom: 2px;
            `}
          >
            {formatTimeRange(contextMenu.payload.timeRange)}
          </div>

          <MenuItem
            icon="M3 3h18v2H3V3zm0 8h18v2H3v-2zm0 8h18v2H3v-2z"
            label="Analyse Selection"
            onClick={handleAnalyse}
            theme={theme}
          />
          <MenuItem
            icon="M15 3l6 6-6 6V3zM9 21l-6-6 6-6v12z"
            label="Zoom to time range"
            onClick={handleZoom}
            theme={theme}
          />
          <div
            className={css`
              border-top: 1px solid ${theme.colors.border.weak};
              margin-top: 2px;
            `}
          >
            <MenuItem
              icon="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"
              label="Dismiss"
              onClick={dismissMenu}
              theme={theme}
              subtle
            />
          </div>
        </div>
      )}
    </div>
  );
};

// --- Helpers ---

function formatValue(v: number): string {
  if (v >= 1) {
    return v.toFixed(v === Math.floor(v) ? 0 : 1);
  }
  if (v >= 0.01) {
    return (v * 100).toFixed(1) + '%';
  }
  if (v >= 0.001) {
    return (v * 100).toFixed(2) + '%';
  }
  return v.toExponential(1);
}

function formatTimeRange(tr: { from: number; to: number }): string {
  const from = new Date(tr.from).toLocaleTimeString();
  const to = new Date(tr.to).toLocaleTimeString();
  return `${from} \u2013 ${to}`;
}

function hexToRgba(hex: string, alpha: number): string {
  // Handle common formats
  const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (m) {
    return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${alpha})`;
  }
  // Already rgb/rgba or named color -- fall back
  return hex;
}

// --- Menu item component (same as heatmap panel) ---
function MenuItem({
  icon,
  label,
  onClick,
  theme,
  subtle,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  theme: ReturnType<typeof useTheme2>;
  subtle?: boolean;
}) {
  return (
    <div
      className={css`
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 12px;
        cursor: pointer;
        color: ${subtle ? theme.colors.text.secondary : theme.colors.text.primary};
        &:hover {
          background: ${theme.colors.action.hover};
        }
      `}
      onClick={onClick}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d={icon} />
      </svg>
      <span>{label}</span>
    </div>
  );
}
