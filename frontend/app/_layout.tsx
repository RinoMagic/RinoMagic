import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { LogBox, ImageBackground, View, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, DarkTheme } from '@react-navigation/native';
import { useIconFonts } from '@/src/hooks/use-icon-fonts';
import { theme } from '@/src/theme';

LogBox.ignoreAllLogs(true);
SplashScreen.preventAutoHideAsync();

// Custom navigation theme that keeps every scene / card background transparent
// so the app-wide stadium ImageBackground (see below) is visible on every screen.
const TransparentNavTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: 'transparent',
    card: 'transparent',
  },
};

export default function RootLayout() {
  const [loaded, error] = useIconFonts();
  useEffect(() => {
    if (loaded || error) SplashScreen.hideAsync();
  }, [loaded, error]);
  if (!loaded && !error) return null;
  return (
    <GestureHandlerRootView style={styles.root}>
      <ImageBackground
        source={require('../assets/images/stadium-bg.webp')}
        style={styles.bg}
        resizeMode="cover"
      >
        {/* Dark overlay for readability on internal pages (~80%).
            Login (index.tsx) provides its own ImageBackground with a lighter overlay,
            which covers this layer entirely on that route. */}
        <View style={styles.overlay} pointerEvents="none" />
        <SafeAreaProvider style={{ backgroundColor: 'transparent' }}>
          <ThemeProvider value={TransparentNavTheme}>
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: 'transparent' },
                animation: 'fade',
                navigationBarColor: 'transparent',
              }}
            />
          </ThemeProvider>
        </SafeAreaProvider>
      </ImageBackground>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.surface },
  bg: { flex: 1, width: '100%', height: '100%' },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10, 15, 25, 0.80)',
  },
});
