import { Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import type { Activity, Category } from '@/data/activities';
import { FILTERS } from '@/data/activities';
import { styles } from '@/screens/styles';

type Props = {
  plan: Activity[];
  chosen: string[];
  filter: 'All' | Category;
  onFilter: (f: 'All' | Category) => void;
  onOpen: (activity: Activity) => void;
  onRemove: (id: string) => void;
  onEditInterests: () => void;
};

export default function PlanScreen({
  plan,
  chosen,
  filter,
  onFilter,
  onOpen,
  onRemove,
  onEditInterests,
}: Props) {
  const visiblePlan = plan.filter((a) => filter === 'All' || a.category === filter);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <ThemedText type="title">Your Week</ThemedText>
          <ThemedText type="small">{plan.length} activities picked for you</ThemedText>

          <ThemedView style={styles.chipRow}>
            {FILTERS.map((f) => {
              const active = filter === f;
              return (
                <Pressable
                  key={f}
                  onPress={() => onFilter(f)}
                  style={[styles.chip, active && styles.chipActive]}>
                  <ThemedText style={active ? styles.chipTextActive : undefined}>{f}</ThemedText>
                </Pressable>
              );
            })}
          </ThemedView>

          {visiblePlan.length === 0 && (
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText>Nothing to show here.</ThemedText>
              <ThemedText type="small">
                Try a different filter or edit your interests to see more activities.
              </ThemedText>
            </ThemedView>
          )}

          {visiblePlan.map((activity) => {
            const matched = activity.interests.filter((i) => chosen.includes(i));
            return (
              <Pressable key={activity.id} onPress={() => onOpen(activity)}>
                <ThemedView type="backgroundElement" style={styles.card}>
                  <ThemedText type="code">{activity.category}</ThemedText>
                  <ThemedText>{activity.title}</ThemedText>
                  <ThemedText type="small">
                    {activity.day} at {activity.time}
                  </ThemedText>
                  <ThemedText type="small">{activity.location}</ThemedText>
                  {matched.length > 0 && (
                    <ThemedText type="small">Because you like {matched.join(', ')}</ThemedText>
                  )}
                  <Pressable onPress={() => onRemove(activity.id)}>
                    <ThemedText style={styles.removeText}>Remove</ThemedText>
                  </Pressable>
                </ThemedView>
              </Pressable>
            );
          })}

          <Pressable onPress={onEditInterests}>
            <ThemedText type="small">Edit my interests</ThemedText>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}