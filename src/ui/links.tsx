import { Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import type { ResolvedLink } from '../core/links';
import { useDashTheme } from './theme';

/** Without an `onLink` handler, hand the URL to the OS. Relative URLs have nowhere to go, so they're skipped. */
export function openLinkDefault(link: ResolvedLink) {
  if (!/^[a-z][a-z0-9+.-]*:/i.test(link.href)) {
    console.warn(`modelform: can't open relative link "${link.href}" without an onLink handler`);
    return;
  }
  Linking.openURL(link.href).catch((e) => console.warn(`modelform: couldn't open ${link.href}: ${e}`));
}

/**
 * Links from several series in one tooltip, each once. Where series share a link title but
 * point at different places, the series name tells them apart.
 */
export function mergeLinks(groups: { name: string; links: ResolvedLink[] }[]): ResolvedLink[] {
  const seen = new Set<string>();
  const titles = new Map<string, Set<string>>();
  for (const g of groups) for (const l of g.links) (titles.get(l.title) ?? titles.set(l.title, new Set()).get(l.title)!).add(l.href);
  const out: ResolvedLink[] = [];
  for (const g of groups) {
    for (const l of g.links) {
      const key = `${l.title}\n${l.href}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(titles.get(l.title)!.size > 1 ? { ...l, title: `${g.name}: ${l.title}` } : l);
    }
  }
  return out;
}

export const LinkIcon = ({ color, size = 14 }: { color: string; size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <Path d="M10 14a4.5 4.5 0 0 0 6.4 0l3.2-3.2a4.5 4.5 0 0 0-6.4-6.4L12 5.6M14 10a4.5 4.5 0 0 0-6.4 0l-3.2 3.2a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2" />
  </Svg>
);

/** Link rows at the bottom of a pinned tooltip. */
export function TooltipLinks({ links, onOpen }: { links: ResolvedLink[]; onOpen(l: ResolvedLink): void }) {
  const theme = useDashTheme();
  if (!links.length) return null;
  return (
    <View style={[styles.tooltipLinks, { borderColor: theme.border }]}>
      {links.map((l) => (
        <Pressable
          key={`${l.title}\n${l.href}`}
          onPress={() => onOpen(l)}
          accessibilityRole="link"
          hitSlop={4}
          style={({ pressed }) => [styles.tooltipLink, pressed && { opacity: 0.6 }]}
        >
          <LinkIcon color={theme.accent} size={12} />
          <Text style={[styles.tooltipLinkText, { color: theme.accent }]} numberOfLines={1}>
            {l.title}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/** A bottom sheet to choose between several links. */
export function LinkMenu({
  links,
  title,
  visible,
  onOpen,
  onClose,
}: {
  links: ResolvedLink[];
  title?: string;
  visible: boolean;
  onOpen(l: ResolvedLink): void;
  onClose(): void;
}) {
  const theme = useDashTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" supportedOrientations={['portrait', 'landscape']} onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close links">
        <View
          // Taps on the sheet itself shouldn't close it.
          onStartShouldSetResponder={() => true}
          style={[styles.sheet, { backgroundColor: theme.surface, borderColor: theme.border, paddingBottom: Math.max(12, insets.bottom) }]}
        >
          {title ? (
            <Text style={[styles.sheetTitle, { color: theme.textSecondary }]} numberOfLines={2}>
              {title}
            </Text>
          ) : null}
          {links.map((l, i) => (
            <Pressable
              key={`${l.title}\n${l.href}`}
              onPress={() => onOpen(l)}
              accessibilityRole="link"
              style={({ pressed }) => [
                styles.sheetRow,
                (i > 0 || !!title) && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.border },
                pressed && { backgroundColor: theme.grid },
              ]}
            >
              <LinkIcon color={theme.accent} size={16} />
              <View style={styles.sheetLabels}>
                <Text style={[styles.sheetLink, { color: theme.text }]} numberOfLines={1}>
                  {l.title}
                </Text>
                <Text style={[styles.sheetHref, { color: theme.textMuted }]} numberOfLines={1}>
                  {l.href}
                </Text>
              </View>
            </Pressable>
          ))}
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            style={({ pressed }) => [styles.cancel, { borderColor: theme.border }, pressed && { backgroundColor: theme.grid }]}
          >
            <Text style={[styles.cancelText, { color: theme.accent }]}>Cancel</Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  tooltipLinks: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 5, paddingTop: 3 },
  tooltipLink: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4 },
  tooltipLinkText: { fontSize: 12, fontWeight: '600', flexShrink: 1 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingTop: 6,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  sheetTitle: { fontSize: 13, fontWeight: '600', paddingHorizontal: 16, paddingVertical: 10 },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  sheetLabels: { flex: 1, gap: 2 },
  sheetLink: { fontSize: 15, fontWeight: '500' },
  sheetHref: { fontSize: 11 },
  cancel: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 14, alignItems: 'center' },
  cancelText: { fontSize: 16, fontWeight: '600' },
});
