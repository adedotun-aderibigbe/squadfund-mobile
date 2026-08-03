import React, { useState } from 'react';
import { 
  StyleSheet, 
  Text, 
  TextInput, 
  TouchableOpacity, 
  View, 
  ActivityIndicator, 
  Alert, 
  TouchableWithoutFeedback, 
  Keyboard 
} from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../lib/supabase';

// Helper function to generate a random 6-character alphanumeric code
function generateJoinCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export default function CreateEvent() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [budgetDollars, setBudgetDollars] = useState('');
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]); // Default to today (YYYY-MM-DD)
  const [loading, setLoading] = useState(false);

  async function handleCreateEvent() {
    if (!name.trim()) {
      Alert.alert('Error', 'Please enter an event name.');
      return;
    }

    setLoading(true);

    try {
      // 1. Get current authenticated user
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) throw new Error('User not authenticated.');

      // Convert budget to cents (e.g. $150.50 -> 15050 cents)
      const budgetCents = Math.round((parseFloat(budgetDollars) || 0) * 100);
      const inviteCode = generateJoinCode();

      // 2. Insert Event Row
      const { data: eventData, error: eventError } = await supabase
        .from('events')
        .insert({
          owner_id: user.id,
          name: name.trim(),
          description: description.trim(),
          event_type: 'other',
          currency: 'USD',
          planned_budget_cents: budgetCents,
          start_date: startDate,
          status: 'active',
          invite_code: inviteCode,
        })
        .select()
        .single();

      if (eventError || !eventData) {
        throw new Error(eventError?.message || 'Failed to create event.');
      }

      // 3. Add Creator as Owner in event_members
      const { error: memberError } = await supabase
        .from('event_members')
        .insert({
          event_id: eventData.id,
          user_id: user.id,
          role: 'owner',
          relay_preference: 'ask',
        });

      if (memberError) {
        throw new Error(memberError.message);
      }

      Alert.alert('Success', `Event created! Join code: ${inviteCode}`);
      // Redirect to home dashboard
      router.replace('/');
      
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <View style={styles.container}>
        <Text style={styles.title}>Plan a New Event</Text>
        <Text style={styles.subtitle}>Set up details to start pooling funds with your squad.</Text>

        <View style={styles.formGroup}>
          <Text style={styles.label}>Event Name</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g., TSA Nationals 2027"
            placeholderTextColor="#6B7280"
            value={name}
            onChangeText={setName}
          />

          <Text style={styles.label}>Description</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="What's this event for?"
            placeholderTextColor="#6B7280"
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={3}
          />

          <Text style={styles.label}>Estimated Budget ($)</Text>
          <TextInput
            style={styles.input}
            placeholder="0.00"
            placeholderTextColor="#6B7280"
            value={budgetDollars}
            onChangeText={setBudgetDollars}
            keyboardType="numeric"
          />

          <Text style={styles.label}>Start Date</Text>
          <TextInput
            style={styles.input}
            placeholder="YYYY-MM-DD"
            placeholderTextColor="#6B7280"
            value={startDate}
            onChangeText={setStartDate}
          />
        </View>

        <TouchableOpacity 
          style={styles.button} 
          onPress={handleCreateEvent} 
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.buttonText}>+ Create Event</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => router.replace('/')} style={styles.cancelBtn}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    justifyContent: 'center', 
    paddingHorizontal: 24, 
    backgroundColor: '#0F0F13', // Deep dark theme background
  },
  title: { 
    fontSize: 26, 
    fontWeight: '800', 
    color: '#FFFFFF', 
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#9CA3AF',
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 28,
  },
  formGroup: {
    marginBottom: 10,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9CA3AF',
    marginBottom: 6,
    marginLeft: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: { 
    backgroundColor: '#17171E', // Dark card fill
    color: '#FFFFFF',
    padding: 14, 
    borderRadius: 12, 
    marginBottom: 16, 
    borderWidth: 1, 
    borderColor: '#262630', // Subtle border matching home screen
    fontSize: 15,
  },
  textArea: { 
    height: 80, 
    textAlignVertical: 'top' 
  },
  button: { 
    backgroundColor: '#8B5CF6', // Purple glowing primary button
    paddingVertical: 15, 
    borderRadius: 14, 
    alignItems: 'center', 
    marginTop: 10,
    shadowColor: '#8B5CF6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  buttonText: { 
    color: '#FFFFFF', 
    fontSize: 16, 
    fontWeight: '700' 
  },
  cancelBtn: {
    paddingVertical: 12,
    marginTop: 8,
  },
  cancelText: { 
    color: '#6B7280', 
    textAlign: 'center', 
    fontSize: 15,
    fontWeight: '600',
  },
});