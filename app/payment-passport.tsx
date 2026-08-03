import React, { useEffect, useState } from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  TextInput, 
  Switch, 
  TouchableOpacity, 
  ActivityIndicator, 
  Alert, 
  ScrollView, 
  KeyboardAvoidingView, 
  Platform 
} from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../lib/supabase';

export default function PaymentPassport() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // States for toggles and handles
  const [venmoEnabled, setVenmoEnabled] = useState(false);
  const [venmoHandle, setVenmoHandle] = useState('');

  const [cashappEnabled, setCashappEnabled] = useState(false);
  const [cashappHandle, setCashappHandle] = useState('');

  const [zelleEnabled, setZelleEnabled] = useState(false);
  const [zelleHandle, setZelleHandle] = useState('');

  const [acceptsCash, setAcceptsCash] = useState(true);

  // Preferred payment method state ('venmo' | 'cashapp' | 'zelle' | 'cash')
  const [preferredMethod, setPreferredMethod] = useState<string>('venmo');

  const [deleting, setDeleting] = useState(false);

  async function handleDeleteAccount() {
    Alert.alert(
      "⚠️ Delete Account?",
      "This action is permanent and cannot be undone. All of your payment configurations and group profiles will be wiped.",
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Yes, Delete", 
          style: "destructive",
          onPress: async () => {
            setDeleting(true);
            try {
              const { error } = await supabase.rpc('safely_delete_my_account');
              
              if (error) {
                Alert.alert("Cannot Delete Account", error.message);
                return;
              }

              await supabase.auth.signOut();
              
              Alert.alert("Account Deleted", "Your account and data have been successfully deleted.", [
                { text: "OK", onPress: () => router.replace('/sign-in') }
              ]);
            } catch (err: any) {
              Alert.alert("Deletion Blocked", err.message || "An error occurred.");
            } finally {
              setDeleting(false);
            }
          }
        }
      ]
    );
  }

  // Fetch existing passport data on load
  async function loadPassport() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from('payment_passports')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        if (data.venmo_handle) {
          setVenmoEnabled(true);
          setVenmoHandle(data.venmo_handle);
        }
        if (data.cashapp_handle) {
          setCashappEnabled(true);
          setCashappHandle(data.cashapp_handle);
        }
        if (data.zelle_email_or_phone) {
          setZelleEnabled(true);
          setZelleHandle(data.zelle_email_or_phone);
        }
        setAcceptsCash(data.accepts_cash ?? true);
        
        if (data.preferred_method) {
          setPreferredMethod(data.preferred_method);
        }
      }
    } catch (err: any) {
      Alert.alert("Error loading payment settings", err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPassport();
  }, []);

  // Clean handle formatting before saving
  const cleanHandle = (text: string) => text.replace(/^[@$]/, '').trim();

  // Save changes to Supabase
  async function handleSave() {
    setSaving(true);
    try {
      const { data: { user }, error: userErr } = await supabase.auth.getUser();
      if (userErr || !user) throw new Error("No authenticated user found.");

      // Ensure profile row exists
      const { error: profileError } = await supabase
        .from('profiles')
        .upsert(
          { 
            id: user.id, 
            email: user.email,
            display_name: user.user_metadata?.display_name || user.email?.split('@')[0] || 'User'
          },
          { onConflict: 'id' }
        );

      if (profileError) throw profileError;

      // Clean handles
      const finalVenmo = venmoEnabled ? cleanHandle(venmoHandle) : null;
      const finalCashapp = cashappEnabled ? cleanHandle(cashappHandle) : null;
      const finalZelle = zelleEnabled ? zelleHandle.trim() : null;

      // Upsert payment passport with preferred_method
      const { error: passportError } = await supabase
        .from('payment_passports')
        .upsert({
          user_id: user.id,
          venmo_handle: finalVenmo,
          cashapp_handle: finalCashapp,
          zelle_email_or_phone: finalZelle,
          accepts_cash: acceptsCash,
          preferred_method: preferredMethod,
        }, { onConflict: 'user_id' });

      if (passportError) throw passportError;

      Alert.alert("Success", "Payment passport saved successfully!", [
        { text: "OK", onPress: () => router.back() }
      ]);
    } catch (err: any) {
      Alert.alert("Save Failed", err.message);
    } finally {
      setSaving(false);
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
    <KeyboardAvoidingView 
      style={{ flex: 1, backgroundColor: '#121218' }} 
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>💳 Payment Passport</Text>
        <Text style={styles.subtitle}>
          Select how you prefer to pay or receive money. Other squad members will use this to settle up with you!
        </Text>

        {/* --- PREFERRED METHOD SELECTOR --- */}
        <Text style={styles.sectionHeader}>Preferred Payment Method</Text>
        <View style={styles.preferredContainer}>
          {[
            { id: 'venmo', label: 'Venmo', enabled: venmoEnabled },
            { id: 'cashapp', label: 'Cash App', enabled: cashappEnabled },
            { id: 'zelle', label: 'Zelle', enabled: zelleEnabled },
            { id: 'cash', label: 'Cash', enabled: acceptsCash },
          ].map((item) => (
            <TouchableOpacity
              key={item.id}
              style={[
                styles.preferredChip,
                preferredMethod === item.id && styles.preferredChipActive,
                !item.enabled && styles.preferredChipDisabled
              ]}
              onPress={() => item.enabled && setPreferredMethod(item.id)}
              disabled={!item.enabled}
            >
              <Text style={[
                styles.preferredChipText,
                preferredMethod === item.id && styles.preferredChipTextActive
              ]}>
                {item.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* --- SINGLE GROUPED CONTAINER FOR ALL PAYMENT OPTIONS --- */}
        <View style={styles.singleGroupCard}>
          
          {/* VENMO */}
          <View style={styles.optionRowGroup}>
            <View style={styles.row}>
              <Text style={styles.appTitle}>Venmo</Text>
              <Switch 
                value={venmoEnabled} 
                onValueChange={(val) => {
                  setVenmoEnabled(val);
                  if (!val) {
                    setVenmoHandle('');
                    if (preferredMethod === 'venmo') setPreferredMethod('cash');
                  }
                }} 
                trackColor={{ false: '#2A2A36', true: '#8B5CF6' }}
                thumbColor="#FFFFFF"
              />
            </View>
            {venmoEnabled && (
              <TextInput
                style={styles.input}
                placeholder="your-venmo-username"
                placeholderTextColor="#6B7280"
                value={venmoHandle}
                onChangeText={setVenmoHandle}
                autoCapitalize="none"
                autoCorrect={false}
              />
            )}
          </View>

          {/* CASH APP */}
          <View style={[styles.optionRowGroup, styles.borderTop]}>
            <View style={styles.row}>
              <Text style={styles.appTitle}>Cash App</Text>
              <Switch 
                value={cashappEnabled} 
                onValueChange={(val) => {
                  setCashappEnabled(val);
                  if (!val) {
                    setCashappHandle('');
                    if (preferredMethod === 'cashapp') setPreferredMethod('cash');
                  }
                }} 
                trackColor={{ false: '#2A2A36', true: '#8B5CF6' }}
                thumbColor="#FFFFFF"
              />
            </View>
            {cashappEnabled && (
              <TextInput
                style={styles.input}
                placeholder="your-cashtag"
                placeholderTextColor="#6B7280"
                value={cashappHandle}
                onChangeText={setCashappHandle}
                autoCapitalize="none"
                autoCorrect={false}
              />
            )}
          </View>

          {/* ZELLE */}
          <View style={[styles.optionRowGroup, styles.borderTop]}>
            <View style={styles.row}>
              <Text style={styles.appTitle}>Zelle</Text>
              <Switch 
                value={zelleEnabled} 
                onValueChange={(val) => {
                  setZelleEnabled(val);
                  if (!val) {
                    setZelleHandle('');
                    if (preferredMethod === 'zelle') setPreferredMethod('cash');
                  }
                }} 
                trackColor={{ false: '#2A2A36', true: '#8B5CF6' }}
                thumbColor="#FFFFFF"
              />
            </View>
            {zelleEnabled && (
              <TextInput
                style={styles.input}
                placeholder="Email or phone number"
                placeholderTextColor="#6B7280"
                value={zelleHandle}
                onChangeText={setZelleHandle}
                autoCapitalize="none"
                autoCorrect={false}
              />
            )}
          </View>

          {/* PHYSICAL CASH */}
          <View style={[styles.optionRowGroup, styles.borderTop]}>
            <View style={styles.row}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={styles.appTitle}>Physical Cash</Text>
                <Text style={styles.cardSub}>In-person cash handoffs</Text>
              </View>
              <Switch 
                value={acceptsCash} 
                onValueChange={(val) => {
                  setAcceptsCash(val);
                  if (!val && preferredMethod === 'cash') setPreferredMethod('venmo');
                }} 
                trackColor={{ false: '#2A2A36', true: '#8B5CF6' }}
                thumbColor="#FFFFFF"
              />
            </View>
          </View>

        </View>

        {/* --- ACTIONS --- */}
        <TouchableOpacity 
          style={[styles.saveBtn, saving && styles.disabledBtn]} 
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.saveBtnText}>Save Passport</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity 
          style={styles.skipBtn} 
          onPress={() => router.back()}
        >
          <Text style={styles.skipBtnText}>Done / Go Back</Text>
        </TouchableOpacity>

        {/* --- DANGER ZONE --- */}
        <View style={styles.dangerZone}>
          <Text style={styles.dangerTitle}>Danger Zone</Text>
          <TouchableOpacity 
            style={[styles.deleteBtn, deleting && styles.disabledBtn]} 
            onPress={handleDeleteAccount}
            disabled={deleting}
          >
            {deleting ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.deleteBtnText}>Permanently Delete Account</Text>
            )}
          </TouchableOpacity>
        </View>

      </ScrollView>
    </KeyboardAvoidingView>
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
    paddingTop: 50,
    paddingBottom: 40,
  },
  title: { 
    fontSize: 24, 
    fontWeight: '800', 
    color: '#FFFFFF', 
    marginBottom: 6 
  },
  subtitle: { 
    fontSize: 13, 
    color: '#9CA3AF', 
    lineHeight: 18, 
    marginBottom: 16 
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '700',
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  preferredContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 20,
  },
  preferredChip: {
    backgroundColor: '#1E1E24',
    borderWidth: 1,
    borderColor: '#2A2A36',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  preferredChipActive: {
    backgroundColor: '#8B5CF6',
    borderColor: '#8B5CF6',
  },
  preferredChipDisabled: {
    opacity: 0.3,
  },
  preferredChipText: {
    color: '#9CA3AF',
    fontSize: 13,
    fontWeight: '600',
  },
  preferredChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },

  // Single card container style
  singleGroupCard: { 
    backgroundColor: '#1E1E24', 
    borderRadius: 18, 
    paddingHorizontal: 16, 
    marginBottom: 20, 
    borderWidth: 1, 
    borderColor: '#2A2A36' 
  },
  optionRowGroup: {
    paddingVertical: 14,
  },
  borderTop: {
    borderTopWidth: 1,
    borderTopColor: '#2A2A36',
  },
  row: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center' 
  },
  appTitle: { 
    fontSize: 16, 
    fontWeight: '700', 
    color: '#FFFFFF' 
  },
  cardSub: { 
    fontSize: 12, 
    color: '#9CA3AF', 
    marginTop: 2 
  },
  input: { 
    borderColor: '#2A2A36', 
    borderWidth: 1, 
    borderRadius: 12, 
    paddingHorizontal: 14, 
    paddingVertical: 10,
    marginTop: 12, 
    fontSize: 14, 
    color: '#FFFFFF',
    backgroundColor: '#121218' 
  },

  // Primary Actions
  saveBtn: { 
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
    opacity: 0.6 
  },
  saveBtnText: { 
    color: '#FFFFFF', 
    fontSize: 15, 
    fontWeight: '700' 
  },
  skipBtn: { 
    paddingVertical: 14, 
    alignItems: 'center', 
    marginTop: 4 
  },
  skipBtnText: { 
    color: '#9CA3AF', 
    fontSize: 14, 
    fontWeight: '600' 
  },

  // Danger Zone
  dangerZone: { 
    marginTop: 30, 
    borderTopWidth: 1, 
    borderTopColor: '#2A2A36', 
    paddingTop: 20 
  },
  dangerTitle: { 
    fontSize: 14, 
    fontWeight: '800', 
    color: '#EF4444', 
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  deleteBtn: { 
    backgroundColor: 'rgba(239, 68, 68, 0.15)', 
    borderWidth: 1,
    borderColor: '#EF4444',
    paddingVertical: 14, 
    borderRadius: 20, 
    alignItems: 'center' 
  },
  deleteBtnText: { 
    color: '#EF4444', 
    fontSize: 14, 
    fontWeight: '700' 
  },
});