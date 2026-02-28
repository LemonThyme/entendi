// ECharts tree-shaken import for analytics charts
// Only import the chart types and components we need

import { BarChart, GraphChart, HeatmapChart, LineChart, RadarChart } from "echarts/charts";
import {
  CalendarComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  RadarComponent,
  TitleComponent,
  ToolboxComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  LineChart, BarChart, RadarChart, HeatmapChart, GraphChart,
  TitleComponent, TooltipComponent, GridComponent, LegendComponent,
  CalendarComponent, VisualMapComponent, DataZoomComponent,
  ToolboxComponent, RadarComponent,
  CanvasRenderer,
]);

// Make echarts available globally for the non-module dashboard.js
window.echarts = echarts;

export { echarts };
