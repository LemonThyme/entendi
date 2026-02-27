// ECharts tree-shaken import for analytics charts
// Only import the chart types and components we need
import * as echarts from "echarts/core";
import { LineChart, BarChart, RadarChart, HeatmapChart, GraphChart } from "echarts/charts";
import {
  TitleComponent,
  TooltipComponent,
  GridComponent,
  LegendComponent,
  CalendarComponent,
  VisualMapComponent,
  DataZoomComponent,
  ToolboxComponent,
  RadarComponent,
} from "echarts/components";
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
