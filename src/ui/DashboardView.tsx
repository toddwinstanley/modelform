import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
/** Shortest a panel gets when capped to the viewport. */
const MIN_PANEL_H = 160;

export interface DashboardViewProps {
  /** "auto" uses the phone layout below 700pt of usable width (e.g. phones in portrait) and the original grid above. */
  mode?: LayoutMode | 'auto';
  header?: ReactNode;
  footer?: ReactNode;
  /** Shows pull-to-refresh. Defaults to true when any panel has queries. */
  refreshable?: boolean;
}

/** Renders the dashboard from the nearest <DashboardProvider>. */
export function DashboardView({ mode = 'auto', header, footer, refreshable }: DashboardViewProps) {
  const theme = useDashTheme();
  const { dashboard, refresh, variables, variableInfo } = useDashboard();
  // Prefer the measured container width (correct in split view and embedded screens);
  // the window width covers the first frame before layout has run.
  const [measured, onLayout] = useLayout();
  const window = useWindowDimensions();
  // Landscape phones put the notch and home indicator on the sides.
  const insets = useSafeAreaInsets();
  const width = (measured.width || window.width) - insets.left - insets.right;
  const layoutMode: LayoutMode = mode === 'auto' ? (width >= TABLET_WIDTH ? 'grid' : 'phone') : mode;
  const sections = useMemo(
    () => layoutDashboard(dashboard, layoutMode, { values: variables, info: variableInfo }),
    [dashboard, layoutMode, variables, variableInfo],
  );
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const { seen, viewportH, onScroll, onViewportLayout, onSectionLayout } = useSeenSections(window.height);
  // Keep every panel within one screen so a chart is never taller than the viewport (landscape phones).
  const maxPanelH = Math.max(MIN_PANEL_H, viewportH - SIDE * 2);
  const contentW = width - SIDE * 2;
  const canRefresh = refreshable ?? dashboard.panels.some((p) => panelHasQueries(p) || p.panels?.some(panelHasQueries));

  return (
    <View style={[styles.fill, { backgroundColor: theme.background }]} onLayout={onLayout}>
      {width > 0 && (
        <ScrollView
          onScroll={onScroll}
          onLayout={onViewportLayout}
          scrollEventThrottle={100}
          contentContainerStyle={[styles.content, { paddingLeft: SIDE + insets.left, paddingRight: SIDE + insets.right }]}
          keyboardShouldPersistTaps="handled"
          refreshControl={canRefresh ? <RefreshControl refreshing={false} onRefresh={refresh} /> : undefined}
        >
          {header}
          {sections.map((section) => {
            const collapsed = toggled[section.key] ?? section.collapsed;
            return (
              <View key={section.key} style={styles.section} onLayout={(e) => onSectionLayout(section.key, e)}>
                {section.row && (
                  <Pressable
                    onPress={() => setToggled((t) => ({ ...t, [section.key]: !collapsed }))}
                    style={styles.rowHeader}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: !collapsed }}
                  >
                    <Text style={[styles.chevron, { color: theme.textMuted }]}>{collapsed ? '▸' : '▾'}</Text>
                    <Text style={[styles.rowTitle, { color: theme.text }]} numberOfLines={2}>
                      {interpolate(section.row.title ?? '', { values: variables, info: variableInfo, scoped: section.row.scopedVars, timezone: dashboard.timezone })}
                    </Text>
                  </Pressable>
                )}
                {!collapsed &&
                  section.rows.map((row, ri) => (
                    <View key={ri} style={styles.row}>
                      {row.cells.map((cell) => {
                        const w = (contentW + GAP) * (cell.span / GRID_COLUMNS) - GAP;
                        return (
                          <PanelCard key={cell.key} panel={cell.panel} width={w} height={Math.min(gridUnitsToPx(row.h), maxPanelH)} deferred={!seen.has(section.key)} />
                        );
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

/**
 * Tracks which sections have come within a screen of the viewport. Their panels query from then
 * on; the rest render as empty cards, so a dashboard with dozens of repeated rows doesn't send
 * every query at once.
 */
function useSeenSections(viewportHeight: number) {
  const [seen, setSeen] = useState<ReadonlySet<string>>(new Set());
  const view = useRef({ y: 0, h: viewportHeight });
  const [viewportH, setViewportH] = useState(viewportHeight);
  const positions = useRef(new Map<string, { y: number; h: number }>());

  const reveal = useCallback(() => {
    const { y, h } = view.current;
    setSeen((prev) => {
      let next: Set<string> | null = null;
      for (const [key, p] of positions.current) {
        if (!prev.has(key) && p.y < y + 2 * h && p.y + p.h > y - h) (next ??= new Set(prev)).add(key);
      }
      return next ?? prev;
    });
  }, []);

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      view.current = { y: e.nativeEvent.contentOffset.y, h: e.nativeEvent.layoutMeasurement.height };
      reveal();
    },
    [reveal],
  );

  // Rotation changes the viewport without a scroll event.
  const onViewportLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const h = e.nativeEvent.layout.height;
      view.current = { ...view.current, h };
      setViewportH(h);
      reveal();
    },
    [reveal],
  );

  const onSectionLayout = useCallback(
    (key: string, e: LayoutChangeEvent) => {
      const { y, height } = e.nativeEvent.layout;
      positions.current.set(key, { y, h: height });
      reveal();
    },
    [reveal],
  );

  return { seen, viewportH, onScroll, onViewportLayout, onSectionLayout };
}

export function PanelCard({ panel, width, height, deferred }: { panel: Panel; width: number; height: number; deferred?: boolean }) {
  const theme = useDashTheme();
  const { dashboard, variables, variableInfo } = useDashboard();
  const input = isInputPanel(panel);
  const hasTitle = !!panel.title;
  const title = hasTitle ? interpolate(panel.title!, { values: variables, info: variableInfo, scoped: panel.scopedVars, timezone: dashboard.timezone }) : '';
  return (
    <View style={[styles.card, { width, height, backgroundColor: theme.surface, borderColor: theme.border }]}>
      {hasTitle && (
        <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
          {title}
        </Text>
      )}
      <View style={styles.body}>
        {deferred && !input ? null : input ? (
          <InputPanelBody panel={panel} />
        ) : (
          <DataPanelBody panel={panel} width={width - 24} height={height - (hasTitle ? TITLE_H : 0) - 16} />
        )}
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
