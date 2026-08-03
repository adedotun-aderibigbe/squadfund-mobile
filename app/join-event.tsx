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

export default function JoinEvent() {
  const router = useRouter();
  const [inviteCode, setInviteCode] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleJoinEvent() {
    if (!inviteCode.trim()) return;
    setLoading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const cleanCode = inviteCode.trim().toUpperCase();

      // 1. Find the event
      const { data: eventData, error: eventError } = await supabase
        .from('events')
        .select('id, name')
        .eq('invite_code', cleanCode)
        .single();

      if (eventError || !eventData) {
        throw new Error("Event not found. Double check your code!");
      }

      // 2. Add user to the event roster
      const { error: joinError } = await supabase
        .from('event_members')
        .insert({ event_id: eventData.id, user_id: user.id });

      if (joinError) {
        if (joinError.code === '23505') {
          throw new Error("You are already a member of this event!");
        }
        throw joinError;
      }

      // --- RECALCULATE HISTORICAL SPLITS START ---
      console.log("Recalculating event splits for new member...");

      // A. Get all current members (including the one who just joined)
      const { data: members, error: membersError } = await supabase
        .from('event_members')
        .select('user_id')
        .eq('event_id', eventData.id);

      if (membersError) throw membersError;
      const memberCount = members.length;

      // B. Get all existing expenses for this event
      const { data: expenses, error: expensesError } = await supabase
        .from('expenses')
        .select('id, amount_cents')
        .eq('event_id', eventData.id);

      if (expensesError) throw expensesError;

      if (expenses && expenses.length > 0) {
        for (const expense of expenses) {
          const baseShare = Math.floor(expense.amount_cents / memberCount);
          const remainder = expense.amount_cents % memberCount;

          // Delete old shares for this expense
          await supabase
            .from('expense_shares')
            .delete()
            .eq('expense_id', expense.id);

          // Prepare new shares
          const newShares = members.map((member, index) => ({
            expense_id: expense.id,
            user_id: member.user_id,
            share_cents: baseShare + (index < remainder ? 1 : 0)
          }));

          // Insert fresh equal splits
          const { error: insertShareErr } = await supabase
            .from('expense_shares')
            .insert(newShares);

          if (insertShareErr) throw insertShareErr;
        }
      }
      console.log("Splits successfully recalculated!");
      // --- RECALCULATE HISTORICAL SPLITS END ---

      Alert.alert("Success", `You joined ${eventData.name}!`);
      router.replace(`/event/${eventData.id}`);

    } catch (error: any) {
      Alert.alert("Error", error.message || "Something went wrong joining the event");
    } finally {
      setLoading(false);
    }
  }

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <View style={styles.container}>
        <Text style={styles.title}>Join an Event</Text>
        <Text style={styles.subtitle}>
          Enter the 6-character invite code provided by your event organizer.
        </Text>

        <TextInput
          style={styles.input}
          placeholder="E.G. TSA427"
          placeholderTextColor="#6B7280"
          value={inviteCode}
          onChangeText={setInviteCode}
          autoCapitalize="characters"
          maxLength={6}
        />

        <TouchableOpacity 
          style={styles.button} 
          onPress={handleJoinEvent} 
          disabled={loading || !inviteCode.trim()}
        >
          {loading ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.buttonText}>Join Event</Text>
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
    backgroundColor: '#0F0F13', // Matches dark dashboard theme
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
  input: { 
    backgroundColor: '#17171E', 
    color: '#8B5CF6', // Purple text for entering code
    padding: 16, 
    borderRadius: 12, 
    marginBottom: 20, 
    borderWidth: 1, 
    borderColor: '#262630', 
    fontSize: 22, 
    fontWeight: '700',
    textAlign: 'center', 
    letterSpacing: 4, // Clean code input spacing
  },
  button: { 
    backgroundColor: '#8B5CF6', 
    paddingVertical: 15, 
    borderRadius: 14, 
    alignItems: 'center',
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