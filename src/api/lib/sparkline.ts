/**
 * Inline SVG sparkline generator for mastery summary emails.
 * Produces self-contained SVG strings that render in email clients.
 */

export interface SparklineOptions {
  width?: number;
  height?: number;
  lineColor?: string;
  fillColor?: string;
  pointRadius?: number;
  strokeWidth?: number;
  showPoints?: boolean;
  showYLabels?: boolean;
  yMin?: number;
  yMax?: number;
}

const DEFAULTS: Required<SparklineOptions> = {
  width: 200,
  height: 50,
  lineColor: '#4f46e5',
  fillColor: 'rgba(79, 70, 229, 0.1)',
  pointRadius: 2,
  strokeWidth: 1.5,
  showPoints: true,
  showYLabels: false,
  yMin: 0,
  yMax: 1,
};

export function generateSparklineSvg(data: number[], opts: SparklineOptions = {}): string {
  const o = { ...DEFAULTS, ...opts };

  if (data.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${o.width}" height="${o.height}" viewBox="0 0 ${o.width} ${o.height}"></svg>`;
  }

  const padding = o.showYLabels ? 30 : 4;
  const top = 4;
  const bottom = 4;
  const plotW = o.width - padding - 4;
  const plotH = o.height - top - bottom;

  const yMin = o.yMin;
  const yMax = o.yMax;
  const yRange = yMax - yMin || 1;

  function toX(i: number): number {
    if (data.length === 1) return padding + plotW / 2;
    return padding + (i / (data.length - 1)) * plotW;
  }

  function toY(v: number): number {
    const clamped = Math.max(yMin, Math.min(yMax, v));
    return top + plotH - ((clamped - yMin) / yRange) * plotH;
  }

  const points = data.map((v, i) => `${toX(i).toFixed(1)},${toY(v).toFixed(1)}`);
  const polylineStr = points.join(' ');

  // Fill polygon: line path + close along bottom
  const fillPoints = [
    `${toX(0).toFixed(1)},${(top + plotH).toFixed(1)}`,
    ...points,
    `${toX(data.length - 1).toFixed(1)},${(top + plotH).toFixed(1)}`,
  ].join(' ');

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${o.width}" height="${o.height}" viewBox="0 0 ${o.width} ${o.height}">`;

  // Fill area
  svg += `<polygon points="${fillPoints}" fill="${o.fillColor}" />`;

  // Line
  svg += `<polyline points="${polylineStr}" fill="none" stroke="${o.lineColor}" stroke-width="${o.strokeWidth}" stroke-linecap="round" stroke-linejoin="round" />`;

  // Data points
  if (o.showPoints) {
    for (let i = 0; i < data.length; i++) {
      svg += `<circle cx="${toX(i).toFixed(1)}" cy="${toY(data[i]).toFixed(1)}" r="${o.pointRadius}" fill="${o.lineColor}" />`;
    }
  }

  // Y-axis labels
  if (o.showYLabels) {
    svg += `<text x="2" y="${(top + 4).toFixed(1)}" font-size="9" fill="#666" font-family="sans-serif">${yMax}</text>`;
    svg += `<text x="2" y="${(top + plotH).toFixed(1)}" font-size="9" fill="#666" font-family="sans-serif">${yMin}</text>`;
  }

  svg += '</svg>';
  return svg;
}
