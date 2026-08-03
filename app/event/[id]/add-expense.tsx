import React, { useEffect, useState } from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  TextInput, 
  TouchableOpacity, 
  ActivityIndicator, 
  Alert,
  TouchableWithoutFeedback,
  Keyboard,
  ScrollView
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../../lib/supabase';

interface Member {
  user_id: string;
  profiles: {
    display_name: string;
  };
}

export default function AddExpense() {
  const { id } = useLocalSearchParams(); // event_id
  const router = useRouter();
  
  const [description, setDescription] = useState('');
  const [amountDollars, setAmountDollars] = useState('');
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedPayerId, setSelectedPayerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    async function fetchEventMembers() {
      try {
        const { data, error } = await supabase
          .from('event_members')
          .select(`
            user_id,
            profiles:user_id ( display_name )
          `)
          .eq('event_id', id);

        if (error) throw error;
        
        const typedMembers = (data || []).map((m: any) => ({
          user_id: m.user_id,
          profiles: {
            display_name: m.profiles?.display_name || 'Unknown Member'
          }
        }));

        setMembers(typedMembers);
        
        // Auto-select current authenticated user as primary payer if match is found
        const { data: { user } } = await supabase.auth.getUser();
        if (user && typedMembers.some(m => m.user_id === user.id)) {
          setSelectedPayerId(user.id);
        } else if (typedMembers.length > 0) {
          setSelectedPayerId(typedMembers[0].user_id);
        }

      } catch (error: any) {
        Alert.alert('Error', error.message || 'Failed to load event participants');
      } finally {
        setLoading(false);
      }
    }

    if (id) fetchEventMembers();
  }, [id]);

  async function handleAddExpense() {
    if (!description.trim()) {
      Alert.alert('Error', 'Please enter a description.');
      return;
    }
    const amountCents = Math.round((parseFloat(amountDollars) || 0) * 100);
    if (amountCents <= 0) {
      Alert.alert('Error', 'Please enter a valid amount.');
      return;
    }
    if (!selectedPayerId) {
      Alert.alert('Error', 'Please choose who paid.');
      return;
    }

    setSubmitting(true);

    try {
      // 1. Log the core expense row
      const { data: expenseData, error: expenseError } = await supabase
        .from('expenses')
        .insert({
          event_id: id,
          paid_by: selectedPayerId,
          description: description.trim(),
          amount_cents: amountCents,
        })
        .select()
        .single();

      if (expenseError || !expenseData) {
        throw new Error(expenseError?.message || 'Failed to record expense.');
      }

      // 2. Calculate splits equally across all members
      const memberCount = members.length;
      const baseShare = Math.floor(amountCents / memberCount);
      let remainder = amountCents % memberCount;

      const shareRecords = members.map((member, index) => {
        const extraCent = index < remainder ? 1 : 0;
        return {
          expense_id: expenseData.id,
          user_id: member.user_id,
          share_cents: baseShare + extraCent,
        };
      });

      // 3. Write individual shares to DB
      const { error: sharesError } = await supabase
        .from('expense_shares')
        .insert(shareRecords);

      if (sharesError) throw sharesError;

      Alert.alert('Success', 'Expense logged successfully!');
      router.replace(`/event/${id}`);

    } catch (error: any) {
      Alert.alert('Error', error.message || 'Something went wrong while logging expense');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#8B5CF6" />
      </View>
    );
  }

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          
          <Text style={styles.title}>➕ Log an Expense</Text>

          {/* SINGLE GROUPED FORM CARD */}
          <View style={styles.singleGroupCard}>
            
            {/* Description Input */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>WHAT WAS PURCHASED?</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Target Snacks, Dinner"
                placeholderTextColor="#6B7280"
                value={description}
                onChangeText={setDescription}
              />
            </View>

            {/* Amount Input */}
            <View style={[styles.inputGroup, styles.inputBorderTop]}>
              <Text style={styles.inputLabel}>TOTAL AMOUNT ($)</Text>
              <TextInput
                style={styles.input}
                placeholder="0.00"
                placeholderTextColor="#6B7280"
                value={amountDollars}
                onChangeText={setAmountDollars}
                keyboardType="decimal-pad"
              />
            </View>

            {/* Who Paid Selection */}
            <View style={[styles.inputGroup, styles.inputBorderTop]}>
              <Text style={styles.inputLabel}>WHO PAID?</Text>
              <View style={styles.payerList}>
                {members.map((m) => {
                  const isSelected = selectedPayerId === m.user_id;
                  const initials = m.profiles.display_name
                    .split(' ')
                    .map((n) => n[0])
                    .join('')
                    .toUpperCase()
                    .slice(0, 2);

                  return (
                    <TouchableOpacity
                      key={m.user_id}
                      style={[
                        styles.payerChip,
                        isSelected && styles.activePayerChip,
                      ]}
                      onPress={() => setSelectedPayerId(m.user_id)}
                    >
                      <View style={[styles.avatarDot, isSelected && styles.activeAvatarDot]}>
                        <Text style={[styles.avatarDotText, isSelected && styles.activeAvatarDotText]}>
                          {initials}
                        </Text>
                      </View>
                      <Text style={[
                        styles.payerChipText,
                        isSelected && styles.activePayerChipText,
                      ]}>
                        {m.profiles.display_name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

          </View>

          {/* EQUAL SPLIT INFO BANNER */}
          <View style={styles.infoBanner}>
            <Text style={styles.infoText}>
              💡 This expense will automatically be split equally across all <Text style={styles.boldInfo}>{members.length} members</Text>.
            </Text>
          </View>

          {/* ACTION BUTTONS */}
          <TouchableOpacity 
            style={[styles.submitBtn, submitting && { opacity: 0.6 }]} 
            onPress={handleAddExpense} 
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.submitBtnText}>Save Expense</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => router.back()} style={styles.cancelBtn}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>

        </ScrollView>
      </View>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: '#121218', 
  },
  centerContainer: { 
    flex: 1, 
    justifyContent: 'center', 
    alignItems: 'center',
    backgroundColor: '#121218',
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 40,
  },
  title: { 
    fontSize: 22, 
    fontWeight: '800', 
    marginBottom: 20, 
    color: '#FFFFFF',
  },

  // Single card container style
  singleGroupCard: {
    backgroundColor: '#1E1E24',
    borderRadius: 18,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#2A2A36',
    marginBottom: 16,
  },
  inputGroup: {
    paddingVertical: 14,
  },
  inputBorderTop: {
    borderTopWidth: 1,
    borderTopColor: '#2A2A36',
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9CA3AF',
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  input: { 
    fontSize: 16,
    color: '#FFFFFF',
    fontWeight: '600',
    paddingVertical: 4,
  },

  // Payer Chips
  payerList: { 
    flexDirection: 'row', 
    flexWrap: 'wrap', 
    gap: 8,
    marginTop: 4,
  },
  payerChip: { 
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2A2A36', 
    paddingHorizontal: 10, 
    paddingVertical: 7, 
    borderRadius: 20, 
    gap: 6,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  activePayerChip: { 
    backgroundColor: 'rgba(139, 92, 246, 0.2)', 
    borderColor: '#8B5CF6',
  },
  avatarDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#3F3F4E',
    justifyContent: 'center',
    alignItems: 'center',
  },
  activeAvatarDot: {
    backgroundColor: '#8B5CF6',
  },
  avatarDotText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#9CA3AF',
  },
  activeAvatarDotText: {
    color: '#FFFFFF',
  },
  payerChipText: { 
    color: '#9CA3AF', 
    fontSize: 13,
    fontWeight: '600',
  },
  activePayerChipText: { 
    color: '#FFFFFF', 
    fontWeight: '700',
  },

  // Info Banner
  infoBanner: { 
    backgroundColor: 'rgba(139, 92, 246, 0.1)', 
    padding: 14, 
    borderRadius: 14, 
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.25)',
  },
  infoText: { 
    color: '#C4B5FD', 
    fontSize: 13, 
    lineHeight: 18,
  },
  boldInfo: {
    fontWeight: '800',
    color: '#FFFFFF',
  },

  // Buttons
  submitBtn: { 
    backgroundColor: '#8B5CF6', 
    paddingVertical: 14, 
    borderRadius: 20, 
    alignItems: 'center',
    shadowColor: '#8B5CF6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  submitBtnText: { 
    color: '#FFFFFF', 
    fontSize: 15, 
    fontWeight: '700',
  },
  cancelBtn: {
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  cancelText: { 
    color: '#9CA3AF', 
    fontSize: 14, 
    fontWeight: '600',
  },
});