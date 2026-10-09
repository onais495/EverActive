import { ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { styles } from '@/screens/styles';

export default function LoadingScreen() {
  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={[styles.safeArea, styles.center]}>
        <ActivityIndicator size="large" />
        <ThemedText type="title">Building your week...</ThemedText>
        <ThemedText type="small">Matching your interests to real events</ThemedText>
      </SafeAreaView>
    </ThemedView>
  );
}