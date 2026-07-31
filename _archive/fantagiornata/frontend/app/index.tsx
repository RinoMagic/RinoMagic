import { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuth } from '@/src/context/AuthContext';
import { theme } from '@/src/theme';

export default function Index() {
  const { user, ready } = useAuth();

  if (!ready) {
    return (
      <View style={styles.container} testID="splash-loader">
        <ActivityIndicator color={theme.colors.brand} size="large" />
      </View>
    );
  }
  if (!user) return <Redirect href="/(auth)/login" />;
  return <Redirect href="/(tabs)/home" />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
