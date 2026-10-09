import { useState } from 'react';
import { Pressable, ScrollView, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { styles } from '@/screens/styles';

type Props = {
  onLogin: () => void;
  onGoRegister: () => void;
};

export default function LoginScreen({ onLogin, onGoRegister }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleLogin = () => {
    if (!email.includes('@') || password.length === 0) {
      setError('Please enter your email and password.');
      return;
    }
    setError('');
    onLogin();
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <ThemedText type="title">EverActive</ThemedText>
          <ThemedText type="small">Design your next chapter.</ThemedText>

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
            placeholder="Password"
            placeholderTextColor="#888"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />

          {error !== '' && <ThemedText style={styles.error}>{error}</ThemedText>}

          <Pressable style={styles.button} onPress={handleLogin}>
            <ThemedText style={styles.buttonText}>Sign in</ThemedText>
          </Pressable>
          <Pressable onPress={onGoRegister}>
            <ThemedText type="small">New here? Create an account</ThemedText>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}