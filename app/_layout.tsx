import { useEffect, useState } from 'react';
import { Slot, useRouter, useSegments } from 'expo-router';
import { View, ActivityIndicator } from 'react-native';
import { supabase } from '../lib/supabase';
import { Session } from '@supabase/supabase-js';

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  
  const segments = useSegments();
  const router = useRouter();

  // 1. Listen for Auth State Changes
  useEffect(() => {
    // Check current session immediately on load
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setIsInitializing(false);
    });

    // Listen to active auth state changes (Sign In, Sign Out, Token Refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setIsInitializing(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // 2. Handle Auto-Routing based on authentication state
  useEffect(() => {
    if (isInitializing) return;

    // Check if the user is currently trying to access an auth page (sign-in or sign-up)
    const inAuthGroup = segments[0] === 'sign-in' || segments[0] === 'sign-up';

    if (!session && !inAuthGroup) {
      // If NOT logged in and NOT on an auth screen, force redirect to sign-in
      router.replace('/sign-in');
    } else if (session && inAuthGroup) {
      // If logged in but trying to access sign-in/sign-up, redirect to home dashboard
      router.replace('/');
    }
  }, [session, segments, isInitializing]);

  // Show a clean loading indicator while determining auth state
  if (isInitializing) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' }}>
        <ActivityIndicator size="large" color="#6200ee" />
      </View>
    );
  }

  // Render child route screens
  return <Slot />;
}