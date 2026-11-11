import { createContext, useContext, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

export interface DashTheme {
  scheme: 'light' | 'dark';
  background: string;
  surface: string;
  border: string;
  grid: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  danger: string;
}

export const lightTheme: DashTheme = {
  scheme: 'light',
  background: '#f4f4f2',
  surface: '#fcfcfb',
  border: '#e4e3df',
  grid: '#ecebe7',
  text: '#0b0b0b',
  textSecondary: '#52514e',
  textMuted: '#85847f',
  accent: '#2a78d6',
  danger: '#d03b3b',
};

export const darkTheme: DashTheme = {
  scheme: 'dark',
  background: '#111110',
  surface: '#1a1a19',
  border: '#2c2c2a',
  grid: '#262624',
  text: '#ffffff',
  textSecondary: '#c3c2b7',
  textMuted: '#8d8c84',
  accent: '#3987e5',
  danger: '#e66767',
};

const ThemeContext = createContext<DashTheme | null>(null);

/** Optional: wrap to force or customize a theme. Without it, modelform follows the system color scheme. */
export function DashThemeProvider({ theme, children }: { theme: DashTheme; children: ReactNode }) {
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useDashTheme(): DashTheme {
  const explicit = useContext(ThemeContext);
  const scheme = useColorScheme();
  return explicit ?? (scheme === 'dark' ? darkTheme : lightTheme);
}
