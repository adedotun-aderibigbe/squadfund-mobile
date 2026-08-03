import React, { useEffect, useState } from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  TouchableOpacity, 
  FlatList, 
  ActivityIndicator, 
  Alert 
} from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../lib/supabase';

interface EventItem {
  id: string;
  name: string;
  description: string;
  invite_code: string;
  start_date: string;
  settledCents?: number;
  totalSettleCents?: number;
}

export default function Home() {
  const router = useRouter();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch current user, active events, and settlement progress
  async function loadData() {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setUserEmail(user.email ?? 'Unknown User');

        // 1. Fetch events where the user is an event member
        const { data: membershipRecords, error: memberError } = await supabase
          .from('event_members')
          .select('event_id')
          .eq('user_id', user.id);

        if (memberError) throw memberError;

        if (membershipRecords && membershipRecords.length > 0) {
          const eventIds = membershipRecords.map((r) => r.event_id);
          
          // 2. Fetch event details
          const { data: eventRecords, error: eventError } = await supabase
            .from('events')
            .select('id, name, description, invite_code, start_date')
            .in('id', eventIds)
            .order('start_date', { ascending: false });

          if (eventError) throw eventError;

          // 3. Fetch active settlement plans for these events
          const { data: planRecords, error: planError } = await supabase
            .from('settlement_plans')
            .select('id, event_id')
            .in('event_id', eventIds)
            .eq('is_active', true);

          if (planError) {
            console.warn('Could not fetch active settlement plans:', planError.message);
          }

          const activePlanIds = (planRecords || []).map((p) => p.id);
          const planToEventMap: Record<string, string> = {};
          (planRecords || []).forEach((p) => {
            planToEventMap[p.id] = p.event_id;
          });

          // Build a map of event_id -> { settled, total }
          const progressMap: Record<string, { settled: number; total: number }> = {};

          if (activePlanIds.length > 0) {
            // Fetch steps for active settlement plans
            const { data: stepRecords, error: stepError } = await supabase
              .from('settlement_steps')
              .select('plan_id, amount_cents, status')
              .in('plan_id', activePlanIds);

            if (stepError) {
              console.warn('Could not fetch settlement steps:', stepError.message);
            }

            (stepRecords || []).forEach((step) => {
              const eventId = planToEventMap[step.plan_id];
              if (eventId) {
                if (!progressMap[eventId]) {
                  progressMap[eventId] = { settled: 0, total: 0 };
                }
                const amt = step.amount_cents || 0;
                progressMap[eventId].total += amt;
                if (step.status === 'completed') {
                  progressMap[eventId].settled += amt;
                }
              }
            });
          }

          // Attach calculated progress to event items
          const enrichedEvents: EventItem[] = (eventRecords || []).map((evt) => ({
            ...evt,
            settledCents: progressMap[evt.id]?.settled || 0,
            totalSettleCents: progressMap[evt.id]?.total || 0,
          }));

          setEvents(enrichedEvents);
        } else {
          setEvents([]);
        }
      }
    } catch (error) {
      console.error('Error fetching dashboard details:', error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();

    async function checkPaymentPassport() {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data } = await supabase
          .from('payment_passports')
          .select('user_id')
          .eq('user_id', user.id)
          .maybeSingle();

        if (!data) {
          router.replace('/payment-passport');
        }
      }
    }
    checkPaymentPassport();
  }, []);

  async function handleSignOut() {
    await supabase.auth.signOut();
  }

  function handleNewPress() {
    Alert.alert(
      'New Event',
      'Choose an option to get started:',
      [
        { 
          text: '+ Create Event', 
          onPress: () => router.push('/create-event') 
        },
        { 
          text: '🔑 Join Event', 
          onPress: () => router.push('/join-event') 
        },
        { 
          text: 'Cancel', 
          style: 'cancel' 
        },
      ]
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.welcomeText}>SquadFund Dashboard</Text>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#8B5CF6" style={{ marginTop: 20 }} />
      ) : (
        <View style={styles.events}>
          {/* Header Row inside the card box */}
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionTitle}>My squads</Text>
              <Text style={styles.sectionSubtitle}>{events.length} open tabs</Text>
            </View>

            <TouchableOpacity style={styles.newButton} onPress={handleNewPress}>
              <Text style={styles.newButtonText}>+ New</Text>
            </TouchableOpacity>
          </View>

          {events.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>You haven't joined any events yet!</Text>
              <Text style={styles.emptySubtext}>Tap + New above to create or join one.</Text>
            </View>
          ) : (
            <FlatList
              data={events}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.listContainer}
              renderItem={({ item }) => {
                const settledCents = item.settledCents || 0;
                const totalSettleCents = item.totalSettleCents || 0;
                
                // Calculate settlement percentage
                const percentage = totalSettleCents > 0 
                  ? Math.min(Math.round((settledCents / totalSettleCents) * 100), 100) 
                  : 0;

                return (
                  <TouchableOpacity 
                    style={styles.eventCard} 
                    onPress={() => router.push(`/event/${item.id}`)}
                  >
                    {/* Event Info Header */}
                    <View style={styles.cardHeaderRow}>
                      <View style={styles.cardLeft}>
                        <Text style={styles.cardIcon}>📩</Text> 
                        <View style={styles.cardInfo}>
                          <Text style={styles.eventName}>{item.name}</Text>
                          <Text style={styles.eventSubtext}>
                            {item.description ? `${item.description} · ` : ''}starts {item.start_date}
                          </Text>
                        </View>
                      </View>

                      <View style={styles.codeBadge}>
                        <Text style={styles.codeText}>{item.invite_code}</Text>
                      </View>
                    </View>

                    {/* Progress Bar Section */}
                    <View style={styles.progressContainer}>
                      <View style={styles.progressLabelRow}>
                        <Text style={styles.progressLabel}>Settlement Progress</Text>
                        <Text style={styles.progressPercent}>{percentage}%</Text>
                      </View>
                      <View style={styles.progressBarTrack}>
                        <View 
                          style={[
                            styles.progressBarFill, 
                            { width: `${percentage}%` }
                          ]} 
                        />
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              }}
            />
          )}
        </View>
      )}

      {/* Footer Navigation */}
      <View style={styles.footerRow}>
        <TouchableOpacity 
          style={styles.passportBtn}
          onPress={() => router.push('/payment-passport')}
        >
          <Text style={styles.passportBtnText}>💳 Payment Passport</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F0F13',
    paddingHorizontal: 20,
    paddingTop: 60,
  },
  header: {
    marginBottom: 20,
  },
  welcomeText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  
  // Outer Container Box
  events: {
    backgroundColor: '#232323',
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  sectionSubtitle: {
    fontSize: 13,
    color: '#9CA3AF',
    marginTop: 2,
  },
  newButton: {
    backgroundColor: '#333333',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#444444',
  },
  newButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },

  // FlatList Content
  listContainer: {
    gap: 12,
  },
  eventCard: {
    backgroundColor: '#2A2A2A', 
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#3D3D3D',
    flexDirection: 'column',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  cardIcon: {
    fontSize: 18,
  },
  cardInfo: {
    flexDirection: 'column',
  },
  eventName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  eventSubtext: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 2,
  },

  // Code Badge
  codeBadge: {
    backgroundColor: 'rgba(13, 71, 161, 0.4)',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 6,
  },
  codeText: {
    fontSize: 13,
    color: '#64B5F6',
    fontWeight: '700',
    letterSpacing: 0.8,
  },

  // Settlement Progress Bar Styles
  progressContainer: {
    marginTop: 2,
  },
  progressLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  progressLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#9CA3AF',
  },
  progressPercent: {
    fontSize: 11,
    fontWeight: '700',
    color: '#10B981', // Clean green percentage text
  },
  progressBarTrack: {
    height: 6,
    backgroundColor: '#1E1E24',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#10B981', // Green progress fill
    borderRadius: 3,
  },

  // Empty State
  emptyContainer: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 15,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  emptySubtext: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 4,
  },

  // Footer Actions
  footerRow: {
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  passportBtn: {
    backgroundColor: '#1C1C24',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#262630',
  },
  passportBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8B5CF6',
  },
  signOutButton: {
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.25)',
  },
  signOutText: {
    color: '#EF4444',
    fontSize: 14,
    fontWeight: '700',
  },
});