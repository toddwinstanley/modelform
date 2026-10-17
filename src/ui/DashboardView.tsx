import { useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { isInputPanel } from '../core/inputs';
import { gridUnitsToPx, layoutDashboard, GRID_COLUMNS, type LayoutMode } from '../core/layout';
import { panelHasQueries } from '../core/datasource';
import type { Panel } from '../core/schema';
import { interpolate } from '../core/variables';
import { useDashboard, usePanelData } from './context';
import { InputPanelBody } from './inputs/InputPanels';
import { panelComponent } from './panels/registry';
import { useLayout } from './panels/common';
import { useDashTheme } from './theme';

const GAP = 8;
const SIDE = 12;
const TITLE_H = 28;
const TABLET_WIDTH = 700;

export interface DashboardViewProps {
  /** "auto" uses the phone layout below 700pt and the original grid above. */
  mode?: LayoutMode | 'auto';
  header?: ReactNode;
  footer?: ReactNode;
  /** Shows pull-to-refresh. Defaults to true when any panel has queries. */
  refreshable?: boolean;
}

/** Renders the dashboard from the nearest <DashboardProvider>. */
export function DashboardView({ mode = 'auto', header, footer, refreshable }: DashboardViewProps) {
  const theme = useDashTheme();
  const { dashboard, refresh } = useDashboard();
  // Prefer the measured container width (correct in split view and embedded screens);
  // the window width covers the first frame before layout has run.
  const [measured, onLayout] = useLayout();
  const window = useWindowDimensions();
  const width = measured.width || window.width;
  const layoutMode: LayoutMode = mode === 'auto' ? (width >= TABLET_WIDTH ? 'grid' : 'phone') : mode;
  const sections = useMemo(() => layoutDashboard(dashboard, layoutMode), [dashboard, layoutMode]);
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const contentW = width - SIDE * 2;
  const canRefresh = refreshable ?? dashboard.panels.some((p) => panelHasQueries(p) || p.panels?.some(panelHasQueries));

  return (
    <View style={[styles.fill, { backgroundColor: theme.background }]} onLayout={onLayout}>
      {width > 0 && (
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={canRefresh ? <RefreshControl refreshing={false} onRefresh={refresh} /> : undefined}
        >
          {header}
          {sections.map((section) => {
            const collapsed = toggled[section.key] ?? section.collapsed;
            return (
              <View key={section.key} style={styles.section}>
                {section.row && (
                  <Pressable
                    onPress={() => setToggled((t) => ({ ...t, [section.key]: !collapsed }))}
                    style={styles.rowHeader}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: !collapsed }}
                  >
                    <Text style={[styles.chevron, { color: theme.textMuted }]}>{collapsed ? '▸' : '▾'}</Text>
                    <Text style={[styles.rowTitle, { color: theme.text }]}>{section.row.title}</Text>
                  </Pressable>
                )}
                {!collapsed &&
                  section.rows.map((row, ri) => (
                    <View key={ri} style={styles.row}>
                      {row.cells.map((cell) => {
                        const w = (contentW + GAP) * (cell.span / GRID_COLUMNS) - GAP;
                        return <PanelCard key={cell.panel.id ?? cell.panel.title} panel={cell.panel} width={w} height={gridUnitsToPx(row.h)} />;
                      })}
                    </View>
                  ))}
              </View>
            );
          })}
        </ScrollView>
      )}
      {footer}
    </View>
  );
}

export function PanelCard({ panel, width, height }: { panel: Panel; width: number; height: number }) {
  const theme = useDashTheme();
  const { variables } = useDashboard();
  const input = isInputPanel(panel);
  const hasTitle = !!panel.title;
  const title = hasTitle ? interpolate(panel.title!, { values: variables }) : '';
  return (
    <View style={[styles.card, { width, height, backgroundColor: theme.surface, borderColor: theme.border }]}>
      {hasTitle && (
        <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
          {title}
        </Text>
      )}
      <View style={styles.body}>
        {input ? <InputPanelBody panel={panel} /> : <DataPanelBody panel={panel} width={width - 24} height={height - (hasTitle ? TITLE_H : 0) - 16} />}
      </View>
    </View>
  );
}

function DataPanelBody({ panel, width, height }: { panel: Panel; width: number; height: number }) {
  const theme = useDashTheme();
  const needsData = panelHasQueries(panel);
  const data = usePanelData(panel, width, needsData);
  const Component = panelComponent(panel.type);

  if (needsData && data.error) {
    return (
      <View style={styles.center}>
        <Text style={[styles.error, { color: theme.danger }]} numberOfLines={4}>
          {data.error}
        </Text>
      </View>
    );
  }
  if (needsData && data.loading && !data.frames.length) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.textMuted} />
      </View>
    );
  }
  return <Component panel={panel} frames={data.frames} width={width} height={height} />;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: SIDE, paddingBottom: 32, gap: GAP },
  section: { gap: GAP },
  rowHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 },
  chevron: { fontSize: 14, width: 14 },
  rowTitle: { fontSize: 15, fontWeight: '600' },
  row: { flexDirection: 'row', gap: GAP },
  card: { borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingVertical: 8, overflow: 'hidden' },
  title: { fontSize: 13, fontWeight: '600', height: TITLE_H - 8, marginBottom: 8 },
  body: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 8 },
  error: { fontSize: 12, textAlign: 'center' },
});
