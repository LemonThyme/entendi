import { describe, it, expect } from 'vitest';
import { generateSparklineSvg } from '../../src/api/lib/sparkline.js';

describe('generateSparklineSvg', () => {
  it('returns valid SVG with data points', () => {
    const svg = generateSparklineSvg([0.2, 0.5, 0.8, 0.6, 0.9]);
    expect(svg).toContain('<svg');
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('</svg>');
    expect(svg).toContain('<polyline');
    expect(svg).toContain('<polygon');
  });

  it('renders circles for data points when showPoints is true', () => {
    const svg = generateSparklineSvg([0.3, 0.7, 0.5], { showPoints: true });
    const circleCount = (svg.match(/<circle/g) || []).length;
    expect(circleCount).toBe(3);
  });

  it('omits circles when showPoints is false', () => {
    const svg = generateSparklineSvg([0.3, 0.7, 0.5], { showPoints: false });
    expect(svg).not.toContain('<circle');
  });

  it('handles a single data point', () => {
    const svg = generateSparklineSvg([0.5]);
    expect(svg).toContain('<svg');
    expect(svg).toContain('<polyline');
    expect(svg).toContain('<circle');
    expect(svg).toContain('</svg>');
  });

  it('handles empty data array', () => {
    const svg = generateSparklineSvg([]);
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    expect(svg).not.toContain('<polyline');
    expect(svg).not.toContain('<circle');
  });

  it('respects custom dimensions', () => {
    const svg = generateSparklineSvg([0.1, 0.9], { width: 300, height: 80 });
    expect(svg).toContain('width="300"');
    expect(svg).toContain('height="80"');
  });

  it('respects custom colors', () => {
    const svg = generateSparklineSvg([0.5, 0.8], {
      lineColor: '#ff0000',
      fillColor: 'rgba(255,0,0,0.2)',
    });
    expect(svg).toContain('stroke="#ff0000"');
    expect(svg).toContain('fill="rgba(255,0,0,0.2)"');
  });

  it('shows Y-axis labels when enabled', () => {
    const svg = generateSparklineSvg([0.2, 0.8], { showYLabels: true });
    expect(svg).toContain('<text');
    expect(svg).toContain('0');
    expect(svg).toContain('1');
  });

  it('does not show Y-axis labels by default', () => {
    const svg = generateSparklineSvg([0.2, 0.8]);
    expect(svg).not.toContain('<text');
  });

  it('clamps values to yMin/yMax range', () => {
    // Values outside range should still produce valid SVG coordinates
    const svg = generateSparklineSvg([-0.5, 1.5, 0.5], { yMin: 0, yMax: 1 });
    expect(svg).toContain('<svg');
    expect(svg).toContain('<polyline');
  });

  it('supports custom yMin/yMax', () => {
    const svg = generateSparklineSvg([50, 75, 100], { yMin: 0, yMax: 100, showYLabels: true });
    expect(svg).toContain('100');
    expect(svg).toContain('0');
  });
});
