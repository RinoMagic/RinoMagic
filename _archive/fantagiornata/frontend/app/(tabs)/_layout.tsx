import { Tabs, Redirect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/src/theme';
import { useAuth } from '@/src/context/AuthContext';
import { View, ActivityIndicator } from 'react-native';

export default function TabsLayout() {
  const { user, ready } = useAuth();
  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.surface, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.colors.brand} />
      </View>
    );
  }
  if (!user) return <Redirect href="/(auth)/login" />;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.brand,
        tabBarInactiveTintColor: theme.colors.muted,
        tabBarStyle: {
          backgroundColor: theme.colors.surfaceSecondary,
          borderTopColor: theme.colors.border,
          borderTopWidth: 1,
          height: 68,
          paddingTop: 8,
          paddingBottom: 12,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => <Ionicons name="home" size={size} color={color} />,
          tabBarButtonTestID: 'tab-home',
        }}
      />
      <Tabs.Screen
        name="leagues"
        options={{
          title: 'Leghe',
          tabBarIcon: ({ color, size }) => <Ionicons name="trophy" size={size} color={color} />,
          tabBarButtonTestID: 'tab-leagues',
        }}
      />
      <Tabs.Screen
        name="players"
        options={{
          title: 'Rosa',
          tabBarIcon: ({ color, size }) => <Ionicons name="football" size={size} color={color} />,
          tabBarButtonTestID: 'tab-players',
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profilo',
          tabBarIcon: ({ color, size }) => <Ionicons name="person" size={size} color={color} />,
          tabBarButtonTestID: 'tab-profile',
        }}
      />
    </Tabs>
  );
}
