import type { ComponentType } from 'react';
import type { PanelProps } from './common';
import { BarGaugePanel, GaugePanel } from './GaugePanels';
import { BarChartPanel, PieChartPanel, TablePanel, TextPanel, UnsupportedPanel } from './OtherPanels';
import { StatPanel } from './StatPanel';
import { TimeSeriesPanel } from './TimeSeriesPanel';
import { XYChartPanel } from './XYChartPanel';

const registry: Record<string, ComponentType<PanelProps>> = {
  timeseries: TimeSeriesPanel,
  graph: TimeSeriesPanel,
  trend: TimeSeriesPanel,
  xychart: XYChartPanel,
  stat: StatPanel,
  singlestat: StatPanel,
  gauge: GaugePanel,
  bargauge: BarGaugePanel,
  piechart: PieChartPanel,
  barchart: BarChartPanel,
  table: TablePanel,
  text: TextPanel,
};

/** Add or replace a panel type, e.g. registerPanel('my-heatmap', HeatmapPanel). */
export function registerPanel(type: string, component: ComponentType<PanelProps>) {
  registry[type] = component;
}

export function panelComponent(type: string): ComponentType<PanelProps> {
  return registry[type] ?? UnsupportedPanel;
}
