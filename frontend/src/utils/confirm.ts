import { Platform, Alert } from 'react-native';

/**
 * Show a confirmation dialog on both web (PWA) and native. Resolves to true
 * when the user confirms, false when they cancel. Never rejects.
 *
 *  - Web: uses window.confirm (cross-browser, blocking, respects PWA)
 *  - Native: uses Alert.alert with OK/Cancel buttons
 */
export function confirmDialog(
  title: string,
  message: string,
  opts: { confirmLabel?: string; cancelLabel?: string; destructive?: boolean } = {}
): Promise<boolean> {
  const confirmLabel = opts.confirmLabel ?? 'Conferma';
  const cancelLabel = opts.cancelLabel ?? 'Annulla';

  if (Platform.OS === 'web') {
    if (typeof window === 'undefined') return Promise.resolve(true);
    return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: cancelLabel, style: 'cancel', onPress: () => resolve(false) },
      {
        text: confirmLabel,
        style: opts.destructive ? 'destructive' : 'default',
        onPress: () => resolve(true),
      },
    ]);
  });
}
