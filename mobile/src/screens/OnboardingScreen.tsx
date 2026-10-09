import { Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { INTERESTS } from '@/data/activities';
import { styles } from '@/screens/styles';

type Props = {
  chosen: string[];
  onToggle: (interest: string) => void;
  onBuild: () => void;
};

export default function OnboardingScreen({ chosen, onToggle, onBuild }: Props) {
  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <ThemedText type="title">What do you enjoy?</ThemedText>
          <ThemedText type="small">Pick as many as you like.</ThemedText>

          <ThemedView style={styles.chipRow}>
            {INTERESTS.map((interest) => {
              const active = chosen.includes(interest);
              return (
                <Pressable
                  key={interest}
                  onPress={() => onToggle(interest)}
                  style={[styles.chip, active && styles.chipActive]}>
                  <ThemedText style={active ? styles.chipTextActive : undefined}>
                    {interest}
                  </ThemedText>
                </Pressable>
              );
            })}
          </ThemedView>

          <Pressable style={styles.button} onPress={onBuild}>
            <ThemedText style={styles.buttonText}>Build my week</ThemedText>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}