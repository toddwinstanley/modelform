import { Pressable, StyleSheet, Text } from 'react-native';
import { useDashTheme } from './theme';

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress(): void }) {
  const theme = useDashTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.chip,
        { borderColor: selected ? theme.accent : theme.border, backgroundColor: selected ? theme.accent : theme.surface },
        pressed && { opacity: 0.7 },
      ]}
    >
      <Text style={[styles.chipText, { color: selected ? '#fff' : theme.text }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: 1, maxWidth: 240 },
  chipText: { fontSize: 13, fontWeight: '500' },
});
