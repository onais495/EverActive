import { Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import type { Activity } from '@/data/activities';
import { styles } from '@/screens/styles';

type Props = {
  activity: Activity;
  onBack: () => void;
  onRemove: () => void;
};

export default function DetailScreen({ activity, onBack, onRemove }: Props) {
  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Pressable onPress={onBack}>
            <ThemedText type="code">← Back</ThemedText>
          </Pressable>

          <ThemedText type="title">{activity.title}</ThemedText>

          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="code">{activity.category}</ThemedText>
            <ThemedText>
              {activity.day} at {activity.time}
            </ThemedText>
            <ThemedText>{activity.location}</ThemedText>
            {activity.attendees > 0 && (
              <ThemedText type="small">{activity.attendees} attending</ThemedText>
            )}
          </ThemedView>

          <ThemedText>{activity.description}</ThemedText>

          <Pressable style={styles.removeButton} onPress={onRemove}>
            <ThemedText style={styles.removeText}>Remove from my week</ThemedText>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}