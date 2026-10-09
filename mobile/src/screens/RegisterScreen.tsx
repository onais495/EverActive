import { useState } from 'react';
import { Pressable, ScrollView, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { styles } from '@/screens/styles';

type Props = {
  onRegister: () => void;
  onGoLogin: () => void;
};

export default function RegisterScreen({ onRegister, onGoLogin }: Props) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');

  const handleRegister = () => {
    if (name.trim().length === 0) {
      setError('Please enter your name.');
      return;
    }
    if (!email.includes('@')) {
      setError('Please enter a valid email address.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setError('');
    onRegister();
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <ThemedText type="title">Create your account</ThemedText>
          <ThemedText type="small">It only takes a minute.</ThemedText>

          <TextInput
            style={styles.input}
            placeholder="Full name"
            placeholderTextColor="#888"
            value={name}
            onChangeText={setName}
          />
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor="#888"
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            style={styles.input}
            placeholder="Password (8+ characters)"
            placeholderTextColor="#888"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />
          <TextInput
            style={styles.input}
            placeholder="Confirm password"
            placeholderTextColor="#888"
            secureTextEntry
            value={confirm}
            onChangeText={setConfirm}
          />

          {error !== '' && <ThemedText style={styles.error}>{error}</ThemedText>}

          <Pressable style={styles.button} onPress={handleRegister}>
            <ThemedText style={styles.buttonText}>Create account</ThemedText>
          </Pressable>
          <Pressable onPress={onGoLogin}>
            <ThemedText type="small">Already have an account? Sign in</ThemedText>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}