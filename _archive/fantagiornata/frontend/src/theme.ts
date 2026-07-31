export const theme = {
  colors: {
    surface: '#0D1114',
    onSurface: '#F8FAFC',
    surfaceSecondary: '#151A1E',
    onSurfaceSecondary: '#E2E8F0',
    surfaceTertiary: '#1F262B',
    onSurfaceTertiary: '#CBD5E1',
    brand: '#00D95F',
    onBrand: '#021A0A',
    brandSecondary: '#FFB300',
    onBrandSecondary: '#2A1D00',
    brandTertiary: '#00D95F1A',
    success: '#10B981',
    warning: '#F59E0B',
    error: '#EF4444',
    info: '#A1A1AA',
    border: '#273038',
    borderStrong: '#3B4754',
    divider: '#192026',
    muted: '#94A3B8',
  },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 },
  radius: { sm: 6, md: 12, lg: 20, pill: 999 },
  typography: {
    display: {
      fontFamily: 'System',
      fontWeight: '800' as const,
      letterSpacing: 0.4,
    },
    body: {
      fontFamily: 'System',
      fontWeight: '500' as const,
    },
  },
  roleColors: {
    P: '#FFB300', // portiere - gold
    D: '#3B82F6', // banned per design but we use success/brand variants... use custom
    C: '#10B981',
    A: '#EF4444',
  },
};

// Design bans blue/indigo/purple. Adjust defender to a neutral role tone.
theme.roleColors.D = '#94A3B8'; // slate
