import { StyleSheet } from 'react-native';

export const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  scroll: {
    padding: 20,
    gap: 16,
  },
  card: {
    padding: 16,
    borderRadius: 16,
    gap: 6,
  },
  input: {
    backgroundColor: '#fff',
    color: '#000',
    padding: 14,
    borderRadius: 12,
    fontSize: 16,
  },
  error: {
    color: '#EF4444',
  },
  button: {
    backgroundColor: '#3B82F6',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
  removeButton: {
    borderWidth: 1,
    borderColor: '#EF4444',
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  removeText: {
    color: '#EF4444',
    fontWeight: '600',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  chip: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#888',
  },
  chipActive: {
    backgroundColor: '#3B82F6',
    borderColor: '#3B82F6',
  },
  chipTextActive: {
    color: '#fff',
  },
});