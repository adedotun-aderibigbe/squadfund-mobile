import React, { useState } from 'react';
import { 
  StyleSheet, 
  Text, 
  TextInput, 
  TouchableOpacity, 
  View, 
  ActivityIndicator, 
  TouchableWithoutFeedback, 
  Keyboard, 
  Alert 
} from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../lib/supabase';

export default function SignUp() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  async function handleSignUp() {
    if (!displayName || !email || !password) {
      setErrorMsg('Please fill in all fields.');
      return;
    }
    setLoading(true);
    setErrorMsg('');

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName },
      },
    });

    setLoading(false);

    if (error) {
      const errorMessage = error?.message || "An unexpected error occurred during signup.";
      Alert.alert("Signup Failed", errorMessage);
    } else if (data.session) {
      router.replace('/'); // Redirect to Home dashboard
    }
  }

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <View style={styles.container}>
        <Text style={styles.title}>Create SquadFund Account</Text>
        
        {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}

        <TextInput
          style={styles.input}
          placeholder="Display Name"
          placeholderTextColor="#6B7280"
          value={displayName}
          onChangeText={setDisplayName}
          autoCapitalize="words"
        />

        <TextInput
          style={styles.input}
          placeholder="Email Address"
          placeholderTextColor="#6B7280"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />

        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor="#6B7280"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
        />

        <TouchableOpacity 
          style={[styles.button, loading && styles.disabledBtn]} 
          onPress={handleSignUp} 
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <Text style={styles.buttonText}>Sign Up</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => router.push('/sign-in')} style={styles.linkContainer}>
          <Text style={styles.linkText}>Already have an account? <Text style={styles.linkHighlight}>Sign In</Text></Text>
        </TouchableOpacity>
      </View>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    justifyContent: 'center', 
    padding: 20, 
    backgroundColor: '#121218' 
  },
  title: { 
    fontSize: 24, 
    fontWeight: '800', 
    marginBottom: 20, 
    textAlign: 'center', 
    color: '#FFFFFF' 
  },
  input: { 
    backgroundColor: '#1E1E24', 
    padding: 14, 
    borderRadius: 12, 
    marginBottom: 12, 
    borderWidth: 1, 
    borderColor: '#2A2A36',
    color: '#FFFFFF',
    fontSize: 14,
  },
  button: { 
    backgroundColor: '#8B5CF6', 
    paddingVertical: 14, 
    borderRadius: 20, 
    alignItems: 'center', 
    marginTop: 6,
    shadowColor: '#8B5CF6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  disabledBtn: {
    opacity: 0.6,
  },
  buttonText: { 
    color: '#FFFFFF', 
    fontSize: 15, 
    fontWeight: '700' 
  },
  linkContainer: {
    marginTop: 18,
    alignItems: 'center',
  },
  linkText: { 
    color: '#9CA3AF', 
    fontSize: 14, 
    fontWeight: '500',
    textAlign: 'center' 
  },
  linkHighlight: {
    color: '#8B5CF6',
    fontWeight: '700',
  },
  errorText: { 
    color: '#EF4444', 
    marginBottom: 12, 
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '600'
  },
});