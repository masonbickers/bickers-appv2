import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { auth, db } from '../firebaseConfig'; // make sure this is correctly set up
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const router = useRouter();

  const handleLoginOrSignup = async () => {
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;
      console.log('Logged in:', user.email);

      await ensureUserInFirestore(user);

      Alert.alert('Welcome back!', `Logged in as ${user.email}`);
      router.replace('/');
    } catch (signInError) {
      if (signInError.code === 'auth/user-not-found') {
        try {
          const userCredential = await createUserWithEmailAndPassword(auth, email, password);
          const user = userCredential.user;
          console.log('Account created:', user.email);

          await ensureUserInFirestore(user);

          Alert.alert('Account created!', `Welcome, ${user.email}`);
          router.replace('/homescreen');  // ✅ Navigate to homescreen after signup
        } catch (signupError) {
          console.error('Signup error:', signupError);
          Alert.alert('Signup failed', signupError.message);
        }
      } else {
        console.error('Login error:', signInError);
        Alert.alert('Login failed', signInError.message);
      }
    }
  };

  const ensureUserInFirestore = async (user) => {
    const userRef = doc(db, 'users', user.uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      await setDoc(userRef, {
        uid: user.uid,
        email: user.email,
        name: user.displayName || '',
        createdAt: new Date().toISOString(),
      });
      console.log('User saved to Firestore');
    } else {
      console.log('User already exists in Firestore');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Bickers Action Login</Text>

      <TextInput
        style={styles.input}
        placeholder="Email"
        placeholderTextColor="#888"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />

      <TextInput
        style={styles.input}
        placeholder="Password"
        placeholderTextColor="#888"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />

      <TouchableOpacity style={styles.button} onPress={handleLoginOrSignup}>
        <Text style={styles.buttonText}>Log In / Sign Up</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 30,
  },
  title: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 30,
  },
  input: {
    width: '100%',
    height: 50,
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    paddingHorizontal: 16,
    color: '#fff',
    marginBottom: 16,
  },
  button: {
    width: '100%',
    height: 50,
    backgroundColor: '#C8102E',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 10,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 16,
  },
});
