import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';

import * as Clipboard from 'expo-clipboard';

interface EventDetails {
  id: string;
  name: string;
  description: string;
  planned_budget_cents: number;
}

interface ExpenseItem {
  id: string;
  paid_by: string;
  description: string;
  amount_cents: number;
  created_at: string;
  profiles: {
    display_name: string;
  };
}

interface MemberBalance {
  userId: string;
  displayName: string;
  paid: number;
  basePaid: number;          // Expenses paid out-of-pocket
  settlementPaid: number;    // Completed settlements sent
  settlementReceived: number;// Completed settlements received
  share: number;
  net: number;
  passport?: {
    venmo_handle: string | null;
    cashapp_handle: string | null;
    zelle_email_or_phone: string | null;
    accepts_cash: boolean;
  };
}

interface SettleInstruction {
  fromUser: string;
  toUser: string;
  amountCents: number;
  recommendedMethod: string;
  handleDetail: string;
}

interface SettlementStep {
  id: string;
  plan_id: string;
  from_user_id: string;
  to_user_id: string;
  amount_cents: number;
  payment_method: string;
  payment_handle: string | null;
  status: 'pending' | 'sent' | 'completed' | 'disputed';
  from_profile?: { display_name: string };
  to_profile?: { display_name: string };
}

interface HistoricalPlan {
  id: string;
  created_at: string;
  is_active: boolean;
  steps: SettlementStep[];
}

interface BudgetItem {
  id: string;
  title: string;
  category: string;
  planned_amount_cents: number;
  assigned_user_id: string | null;
  status: 'planned' | 'accepted' | 'purchased' | 'cancelled';
  assigned_profile?: { display_name: string };
}

interface ActivityItem {
  id: string;
  action_type: string;
  description: string;
  created_at: string;
  profiles?: { display_name: string };
}

interface PaymentParams {
  method: 'venmo' | 'cashapp' | 'cash app' | 'zelle' | string;
  handle: string | null | undefined;
  amountCents: number;
  note?: string;
}

export async function handleDirectPayment({
  method,
  handle,
  amountCents,
  note = 'SquadFund Settlement',
}: PaymentParams) {
  if (!handle) {
    Alert.alert('Missing Payment Handle', `No handle provided for this member.`);
    return;
  }

  const amountDollars = (amountCents / 100).toFixed(2);
  // Strip prefixes like "to ", "@", or "$"
  const cleanHandle = handle.replace(/^to\s*[@$]?|[@$]/gi, '').trim();
  const cleanMethod = method.toLowerCase().trim();

  let appUrl = '';
  let webUrl = '';

  switch (cleanMethod) {
    case 'cashapp':
    case 'cash app':
      appUrl = `cashapp://pay/$${cleanHandle}?amount=${amountDollars}&note=${encodeURIComponent(note)}`;
      webUrl = `https://cash.app/$${cleanHandle}/${amountDollars}`;
      break;

    case 'venmo':
      appUrl = `venmo://paycharge?txn=pay&recipients=${cleanHandle}&amount=${amountDollars}&note=${encodeURIComponent(note)}`;
      webUrl = `https://venmo.com/${cleanHandle}`;
      break;

    case 'zelle':
      await Clipboard.setStringAsync(cleanHandle);
      Alert.alert(
        'Zelle Handle Copied! 📋',
        `Copied "${cleanHandle}" to your clipboard. Open your banking app to complete the $${amountDollars} transfer.`
      );
      return;

    case 'cash':
      Alert.alert('Cash Settlement', `Pay $${amountDollars} in-person to complete this settlement.`);
      return;

    default:
      Alert.alert('Unsupported Method', `Automatic linking is not supported for ${method}.`);
      return;
  }

  try {
    const canOpen = await Linking.canOpenURL(appUrl);
    if (canOpen) {
      await Linking.openURL(appUrl);
    } else if (webUrl) {
      await Linking.openURL(webUrl);
    } else {
      Alert.alert('Error', 'Could not open payment app.');
    }
  } catch (error) {
    if (webUrl) {
      await Linking.openURL(webUrl);
    } else {
      Alert.alert('Error', 'Could not launch payment application.');
    }
  }
}

function calculateSmartSettleRoutes(balances: MemberBalance[]): SettleInstruction[] {
  let debtors = balances
    .filter((b) => b.net < -1)
    .map((b) => ({
      userId: b.userId,
      name: b.displayName,
      balance: Math.abs(b.net),
      passport: b.passport,
    }));

  let creditors = balances
    .filter((b) => b.net > 1)
    .map((b) => ({
      userId: b.userId,
      name: b.displayName,
      balance: b.net,
      passport: b.passport,
    }));

  const instructions: SettleInstruction[] = [];

  debtors.sort((a, b) => b.balance - a.balance);
  creditors.sort((a, b) => b.balance - a.balance);

  let dIdx = 0;
  let cIdx = 0;

  while (dIdx < debtors.length && cIdx < creditors.length) {
    const debtor = debtors[dIdx];
    const creditor = creditors[cIdx];
    const settleAmount = Math.min(debtor.balance, creditor.balance);

    if (settleAmount > 0) {
      let recommendedMethod = 'Manual (Ask)';
      let handleDetail = '';

      const cPass = creditor.passport;

      // Check what the recipient (creditor) accepts, regardless of debtor passport
      if (cPass) {
        if (cPass.venmo_handle) {
          recommendedMethod = 'Venmo';
          handleDetail = cPass.venmo_handle;
        } else if (cPass.cashapp_handle) {
          recommendedMethod = 'Cash App';
          handleDetail = cPass.cashapp_handle;
        } else if (cPass.zelle_email_or_phone) {
          recommendedMethod = 'Zelle';
          handleDetail = cPass.zelle_email_or_phone;
        } else if (cPass.accepts_cash) {
          recommendedMethod = 'Cash';
          handleDetail = 'In-person';
        }
      }

      instructions.push({
        fromUser: debtor.name,
        toUser: creditor.name,
        amountCents: settleAmount,
        recommendedMethod,
        handleDetail,
      });

      debtor.balance -= settleAmount;
      creditor.balance -= settleAmount;
    }

    if (debtor.balance === 0) dIdx++;
    if (creditor.balance === 0) cIdx++;
  }

  return instructions;
}

export default function EventDashboard() {
  const { id } = useLocalSearchParams();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<
    'overview' | 'expenses' | 'balances' | 'plan' | 'activity' | 'members'
  >('overview');

  const [event, setEvent] = useState<EventDetails | null>(null);
  const [expenses, setExpenses] = useState<ExpenseItem[]>([]);
  const [balances, setBalances] = useState<MemberBalance[]>([]);
  const [settleRoutes, setSettleRoutes] = useState<SettleInstruction[]>([]);
  const [totalSpentCents, setTotalSpentCents] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const [settlementSteps, setSettlementSteps] = useState<SettlementStep[]>([]);
  const [pastChecklists, setPastChecklists] = useState<HistoricalPlan[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [budgetItems, setBudgetItems] = useState<BudgetItem[]>([]);
  const [showAddBudgetModal, setShowAddBudgetModal] = useState(false);
  const [newBudgetTitle, setNewBudgetTitle] = useState('');
  const [newBudgetAmount, setNewBudgetAmount] = useState('');
  const [newBudgetCategory, setNewBudgetCategory] = useState('Food');
  const [newBudgetAssignee, setNewBudgetAssignee] = useState('');
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<'owner' | 'admin' | 'member'>('member');
  const [members, setMembers] = useState<any[]>([]);

  const isOwnerOrAdmin = userRole === 'owner' || userRole === 'admin';

  // Calculate total expenses and equal share per member
  const totalExpensesCents = expenses.reduce((sum, item) => sum + item.amount_cents, 0);
  const memberCount = members.length || 1; // Avoid divide-by-zero
  const equalShareCents = Math.round(totalExpensesCents / memberCount);

  const getInitials = (name: string) => {
    if (!name) return '?';
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  async function loadEventData() {
    setLoading(true);
    try {
      const { data: eventData, error: eventError } = await supabase
        .from('events')
        .select('id, name, description, planned_budget_cents')
        .eq('id', id)
        .single();

      if (eventError) throw eventError;
      setEvent(eventData);

      const { data: expenseData, error: expenseError } = await supabase
        .from('expenses')
        .select('id, description, amount_cents, created_at, paid_by, profiles:paid_by (display_name)')
        .eq('event_id', id)
        .order('created_at', { ascending: false });

      if (expenseError) throw expenseError;

      const { data: completedSteps, error: stepsErr } = await supabase
        .from('settlement_steps')
        .select('from_user_id, to_user_id, amount_cents')
        .eq('event_id', id)
        .eq('status', 'completed');

      if (stepsErr) throw stepsErr;

      const typedExpenses = (expenseData || []).map((exp: any) => ({
        id: exp.id,
        description: exp.description,
        amount_cents: exp.amount_cents,
        created_at: exp.created_at,
        paid_by: exp.paid_by,
        profiles: {
          display_name: exp.profiles?.display_name || 'Unknown Member',
        },
      }));

      setExpenses(typedExpenses);

      const { data: rawExpenses } = await supabase
        .from('expenses')
        .select('paid_by, amount_cents')
        .eq('event_id', id);

      const total = typedExpenses.reduce((sum, item) => sum + item.amount_cents, 0);
      setTotalSpentCents(total);

      const { data: membersData, error: membersError } = await supabase
        .from('event_members')
        .select('user_id, role, profiles:user_id (display_name, email)')
        .eq('event_id', id);

      if (membersError) throw membersError;

      setMembers(
        (membersData || []).map((m: any) => ({
          user_id: m.user_id,
          role: m.role || 'member',
          display_name: m.profiles?.display_name || m.profiles?.email || 'Unknown User',
        }))
      );

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) throw new Error('Not authenticated');
      setCurrentUserId(user.id);

      const myMemberRecord = (membersData || []).find((m: any) => m.user_id === user.id);
      if (myMemberRecord?.role) {
        setUserRole(myMemberRecord.role);
      }

      const memberIds = (membersData || []).map((m: any) => m.user_id);

      const { data: passportsData, error: passportsError } = await supabase
        .from('payment_passports')
        .select('*')
        .in('user_id', memberIds);

      if (passportsError && memberIds.length > 0) throw passportsError;

      const { data: sharesData, error: sharesError } = await supabase
        .from('expense_shares')
        .select('user_id, share_cents')
        .in('expense_id', typedExpenses.map((e) => e.id));

      if (sharesError && typedExpenses.length > 0) throw sharesError;

      const { data: allPlans, error: plansErr } = await supabase
        .from('settlement_plans')
        .select(`
          id, created_at, is_active,
          settlement_steps (
            id, plan_id, from_user_id, to_user_id, amount_cents, payment_method, payment_handle, status,
            from_profile:from_user_id (display_name),
            to_profile:to_user_id (display_name)
          )
        `)
        .eq('event_id', id)
        .order('created_at', { ascending: false });

      if (plansErr) throw plansErr;

      const activePlan = (allPlans || []).find((p) => p.is_active === true);
      if (activePlan) {
        setActivePlanId(activePlan.id);
        const typedSteps = (activePlan.settlement_steps || []).map((step: any) => ({
          ...step,
          from_profile: { display_name: step.from_profile?.display_name || 'Unknown' },
          to_profile: { display_name: step.to_profile?.display_name || 'Unknown' },
        }));
        setSettlementSteps(typedSteps);
      } else {
        setActivePlanId(null);
        setSettlementSteps([]);
      }

      const formattedPast: HistoricalPlan[] = (allPlans || [])
        .filter((p) => !p.is_active)
        .map((p) => ({
          id: p.id,
          created_at: p.created_at,
          is_active: p.is_active,
          steps: (p.settlement_steps || []).map((step: any) => ({
            ...step,
            from_profile: { display_name: step.from_profile?.display_name || 'Unknown' },
            to_profile: { display_name: step.to_profile?.display_name || 'Unknown' },
          })),
        }));

      setPastChecklists(formattedPast);

      const calculatedBalances: MemberBalance[] = (membersData || []).map((m: any) => {
        const userId = m.user_id;
        const displayName = m.profiles?.display_name || 'Unknown';
        const userPassport = (passportsData || []).find((p) => p.user_id === userId);

        const basePaid = (rawExpenses || [])
          .filter((e) => e.paid_by === userId)
          .reduce((sum, e) => sum + e.amount_cents, 0);

        const settlementPaid = (completedSteps || [])
          .filter((s) => s.from_user_id === userId)
          .reduce((sum, s) => sum + s.amount_cents, 0);

        const settlementReceived = (completedSteps || [])
          .filter((s) => s.to_user_id === userId)
          .reduce((sum, s) => sum + s.amount_cents, 0);

        const effectivePaid = basePaid + settlementPaid;
        const totalShare = (sharesData || [])
          .filter((s) => s.user_id === userId)
          .reduce((sum, s) => sum + s.share_cents, 0);

        const netCalibrated = effectivePaid - (totalShare + settlementReceived);

        return {
          userId,
          displayName,
          paid: effectivePaid,
          basePaid,
          settlementPaid,
          settlementReceived,
          share: totalShare,
          net: netCalibrated,
          passport: userPassport ? {
            venmo_handle: userPassport.venmo_handle,
            cashapp_handle: userPassport.cashapp_handle,
            zelle_email_or_phone: userPassport.zelle_email_or_phone,
            accepts_cash: userPassport.accepts_cash,
          } : undefined
        };
      });

      setBalances(calculatedBalances);
      const routes = calculateSmartSettleRoutes(calculatedBalances);
      setSettleRoutes(routes);

      const { data: budgetData, error: budgetError } = await supabase
        .from('budget_items')
        .select(`
          id, title, category, planned_amount_cents, assigned_user_id, status,
          assigned_profile:assigned_user_id (display_name)
        `)
        .eq('event_id', id);

      if (budgetError) throw budgetError;

      const typedBudget = (budgetData || []).map((item: any) => ({
        ...item,
        assigned_profile: {
          display_name: item.assigned_profile?.display_name || 'Unassigned',
        },
      }));
      setBudgetItems(typedBudget);

      const { data: activityData, error: activityError } = await supabase
        .from('activity_log')
        .select(`
          id, action_type, description, created_at, profiles:user_id (display_name)
        `)
        .eq('event_id', id)
        .order('created_at', { ascending: false });

      if (activityError) throw activityError;

      const typedActivities = (activityData || []).map((act: any) => {
        const profileObj = Array.isArray(act.profiles) ? act.profiles[0] : act.profiles;
        return {
          id: act.id,
          action_type: act.action_type,
          description: act.description,
          created_at: act.created_at,
          profiles: {
            display_name: profileObj?.display_name || 'Someone',
          },
        };
      });
      setActivities(typedActivities);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Could not load dashboard data');
    } finally {
      setLoading(false);
    }
  }

  async function forceRecalculateSplits() {
    setSyncing(true);
    try {
      if (activePlanId) {
        await supabase
          .from('settlement_plans')
          .update({ is_active: false })
          .eq('id', activePlanId);
        setActivePlanId(null);
      }

      const { data: eventMembers, error: mErr } = await supabase
        .from('event_members')
        .select('user_id')
        .eq('event_id', id);

      if (mErr) throw mErr;
      const memberCount = eventMembers.length;
      if (memberCount === 0) {
        throw new Error('No members found in this event to split with!');
      }

      const { data: targetExpenses, error: eErr } = await supabase
        .from('expenses')
        .select('id, amount_cents')
        .eq('event_id', id);

      if (eErr) throw eErr;

      if (!targetExpenses || targetExpenses.length === 0) {
        Alert.alert('Notice', 'No expenses exist to recalculate yet.');
        setSyncing(false);
        return;
      }

      for (const expense of targetExpenses) {
        const baseShare = Math.floor(expense.amount_cents / memberCount);
        const remainder = expense.amount_cents % memberCount;

        const freshShares = eventMembers.map((member, index) => ({
          expense_id: expense.id,
          user_id: member.user_id,
          share_cents: baseShare + (index < remainder ? 1 : 0),
        }));

        const { error: upsertErr } = await supabase
          .from('expense_shares')
          .upsert(freshShares, { onConflict: 'expense_id,user_id' });

        if (upsertErr) throw upsertErr;
      }

      Alert.alert(
        'Success',
        'All historical ledger splits have been dynamically recalibrated!'
      );
      await loadEventData();
    } catch (err: any) {
      Alert.alert(
        'Recalibration Failed',
        err.message || 'An unexpected database synchronization error occurred.'
      );
    } finally {
      setSyncing(false);
    }
  }

  async function handleDeleteExpense(expenseId: string, description: string) {
    Alert.alert(
      'Delete Expense',
      `Are you sure you want to permanently delete "${description}"? This will recalibrate all group balances.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            try {
              const { error: sharesErr } = await supabase
                .from('expense_shares')
                .delete()
                .eq('expense_id', expenseId);

              if (sharesErr) throw sharesErr;

              const { error: expErr } = await supabase
                .from('expenses')
                .delete()
                .eq('id', expenseId);

              if (expErr) throw expErr;

              Alert.alert('Success', 'Expense deleted and balances recalibrated!');
              await loadEventData();
            } catch (err: any) {
              Alert.alert('Deletion Failed', err.message || 'An error occurred while deleting.');
              setLoading(false);
            }
          },
        },
      ]
    );
  }

  async function publishSettlementPlan() {
    if (settleRoutes.length === 0) {
      Alert.alert('Notice', 'Everyone is already settled up!');
      return;
    }

    setPublishing(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) throw new Error('Not authenticated');

      await supabase
        .from('settlement_plans')
        .update({ is_active: false })
        .eq('event_id', id)
        .eq('is_active', true);

      const { data: newPlan, error: planErr } = await supabase
        .from('settlement_plans')
        .insert({
          event_id: id,
          created_by: user.id,
          is_active: true,
        })
        .select()
        .single();

      if (planErr) throw planErr;

      const stepsToInsert = settleRoutes.map((route) => {
        const debtorId = balances.find((b) => b.displayName === route.fromUser)?.userId;
        const creditorId = balances.find((b) => b.displayName === route.toUser)?.userId;

        if (!debtorId || !creditorId)
          throw new Error('Could not map user IDs for repayment routes.');

        return {
          plan_id: newPlan.id,
          event_id: id,
          from_user_id: debtorId,
          to_user_id: creditorId,
          amount_cents: route.amountCents,
          payment_method: route.recommendedMethod,
          payment_handle: route.handleDetail,
          status: 'pending',
        };
      });

      const { error: stepsErr } = await supabase
        .from('settlement_steps')
        .insert(stepsToInsert);

      if (stepsErr) throw stepsErr;

      Alert.alert(
        'Success 🎉',
        'A new live repayment checklist has been published! Previous steps overridden.'
      );
      await loadEventData();
    } catch (err: any) {
      Alert.alert('Publishing Failed', err.message || 'Could not publish settlement plan.');
    } finally {
      setPublishing(false);
    }
  }

  async function handleMarkAsSent(stepId: string) {
    try {
      const { error } = await supabase
        .from('settlement_steps')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', stepId);

      await logManualActivity('mark_sent', `marked their payment as sent`);
      if (error) throw error;
      await loadEventData();
    } catch (err: any) {
      Alert.alert('Error updating status', err.message);
    }
  }

  async function handleConfirmReceipt(stepId: string) {
    try {
      const { error } = await supabase
        .from('settlement_steps')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', stepId);

      await logManualActivity('confirm_received', `confirmed they received payment`);

      if (error) throw error;
      await loadEventData();
    } catch (err: any) {
      Alert.alert('Error completing transaction', err.message);
    }
  }

  async function handleAddBudgetItem() {
    if (!newBudgetTitle.trim() || !newBudgetAmount) {
      Alert.alert('Missing Fields', 'Please enter a title and a planned amount.');
      return;
    }

    try {
      const amountCents = Math.round(parseFloat(newBudgetAmount) * 100);
      if (isNaN(amountCents) || amountCents <= 0) {
        throw new Error('Please enter a valid amount.');
      }

      const { error } = await supabase.from('budget_items').insert({
        event_id: id,
        title: newBudgetTitle.trim(),
        category: newBudgetCategory,
        planned_amount_cents: amountCents,
        assigned_user_id: newBudgetAssignee || null,
        status: 'planned',
      });

      if (error) throw error;

      Alert.alert('Success', 'Budget item added!');
      setNewBudgetTitle('');
      setNewBudgetAmount('');
      setNewBudgetAssignee('');
      setShowAddBudgetModal(false);
      await loadEventData();
    } catch (err: any) {
      Alert.alert('Error adding budget item', err.message);
    }
  }

  async function logManualActivity(actionType: string, description: string) {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) return;

      await supabase.from('activity_log').insert({
        event_id: id,
        user_id: user.id,
        action_type: actionType,
        description: description,
      });
    } catch (err) {
      console.error('Failed to write to activity log', err);
    }
  }

  async function handleChangeRole(
    targetUserId: string,
    targetName: string,
    newRole: 'admin' | 'member'
  ) {
    try {
      const { error } = await supabase
        .from('event_members')
        .update({ role: newRole })
        .eq('event_id', id)
        .eq('user_id', targetUserId);

      if (error) throw error;

      Alert.alert('Success', `${targetName} is now an ${newRole.toUpperCase()}.`);
      await loadEventData();
    } catch (err: any) {
      Alert.alert('Failed to update role', err.message);
    }
  }

  async function handleTransferOwnership(targetUserId: string, targetName: string) {
    Alert.alert(
      'Transfer Ownership',
      `Are you sure you want to make ${targetName} the new Owner of this event? You will become an Admin.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Transfer',
          style: 'destructive',
          onPress: async () => {
            try {
              const { error: demoteErr } = await supabase
                .from('event_members')
                .update({ role: 'admin' })
                .eq('event_id', id)
                .eq('user_id', currentUserId);

              if (demoteErr) throw demoteErr;

              const { error: promoteErr } = await supabase
                .from('event_members')
                .update({ role: 'owner' })
                .eq('event_id', id)
                .eq('user_id', targetUserId);

              if (promoteErr) throw promoteErr;

              await supabase
                .from('events')
                .update({ created_by: targetUserId })
                .eq('id', id);

              Alert.alert('Ownership Transferred', `${targetName} is now the Owner.`);
              await loadEventData();
            } catch (err: any) {
              Alert.alert('Transfer Failed', err.message);
            }
          },
        },
      ]
    );
  }

  useEffect(() => {
    if (id) loadEventData();
  }, [id, activeTab]);

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#8B5CF6" />
      </View>
    );
  }

  if (!event) {
    return (
      <View style={styles.centerContainer}>
        <Text style={{ color: '#FFFFFF' }}>Event not found.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.replace('/')} style={styles.backBtn}>
          <Text style={styles.backBtnText}>⬅ Dashboard</Text>
        </TouchableOpacity>
        <Text style={styles.eventName}>{event.name}</Text>
        {event.description ? (
          <Text style={styles.eventDesc}>{event.description}</Text>
        ) : null}
      </View>

      {/* Navigation Tabs */}
      <View style={styles.tabBarWrapper}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.tabBarContainer}
          contentContainerStyle={styles.tabBarScroll}
        >
          {(['overview', 'expenses', 'balances', 'plan', 'activity', 'members'] as const).map((tab) => (
            <TouchableOpacity
              key={tab}
              style={[styles.tab, activeTab === tab && styles.activeTab]}
              onPress={() => setActiveTab(tab)}
            >
              <Text style={[styles.tabText, activeTab === tab && styles.activeTabText]}>
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {activeTab === 'overview' && (
      <View style={styles.content}>
        <View style={styles.statsCard}>
          <Text style={styles.statsLabel}>Total Planned Budget</Text>
          <Text style={styles.statsValue}>
            ${(event.planned_budget_cents / 100).toFixed(2)}
          </Text>
        </View>

        <View style={styles.statsCard}>
          <Text style={styles.statsLabel}>Total Spent to Date</Text>
          <Text style={[styles.statsValue, { color: '#85BB65' }]}>
            ${(totalSpentCents / 100).toFixed(2)}
          </Text>
        </View>

        {/* Dynamic Ledger Overview / Personal Balance */}
        {balances.length > 0 && (
          <View style={styles.statsCard}>
            <Text style={styles.statsLabel}>Your Balance Status</Text>
            {(() => {
              const myBalance = balances.find((b) => b.userId === currentUserId);
              if (!myBalance) return <Text style={{ color: '#fff' }}>No balance record yet</Text>;
              const isOwed = myBalance.net >= 0;
              return (
                <Text style={[styles.statsValue, { color: isOwed ? '#85BB65' : '#ff7675' }]}>
                  {isOwed ? `+$${(myBalance.net / 100).toFixed(2)} (gets back)` : `-$${(Math.abs(myBalance.net) / 100).toFixed(2)} (owes)`}
                </Text>
              );
            })()}
          </View>
        )}
      </View>
    )}

      {/* Expenses Tab */}
      {activeTab === 'expenses' && (
        <View style={styles.content}>
          <TouchableOpacity
            style={styles.primaryActionBtn}
            onPress={() => router.push(`/event/${id}/add-expense`)}
          >
            <Text style={styles.primaryActionBtnText}>+ Add New Expense</Text>
          </TouchableOpacity>

          {expenses.length === 0 ? (
            <Text style={styles.emptyText}>No expenses logged yet.</Text>
          ) : (
            <View style={styles.singleGroupCard}>
              {expenses.map((item, index) => {
                const isLast = index === expenses.length - 1;
                const userInitials = item.profiles.display_name
                  .split(' ')
                  .map((n) => n[0])
                  .join('')
                  .toUpperCase()
                  .slice(0, 2);

                return (
                  <View
                    key={item.id}
                    style={[styles.memberRow, !isLast && styles.memberRowBorder]}
                  >
                    <View style={styles.avatarCircleNeutral}>
                      <Text style={styles.avatarTextNeutral}>{userInitials}</Text>
                    </View>

                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={styles.memberName}>{item.description}</Text>
                      <Text style={styles.memberSub}>
                        Paid by {item.profiles.display_name}
                      </Text>
                    </View>

                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                      <Text style={styles.cleanNetValue}>
                        ${(item.amount_cents / 100).toFixed(2)}
                      </Text>
                      {(isOwnerOrAdmin || currentUserId === item.paid_by) && (
                        <TouchableOpacity
                          onPress={() => handleDeleteExpense(item.id, item.description)}
                          style={styles.deleteIconBtn}
                        >
                          <Text style={{ fontSize: 14 }}>🗑️</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      )}

      {/* Balances Tab */}
        {activeTab === 'balances' && (
          <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: 40 }}>
            <View style={styles.recalibrateHeaderRow}>
              <Text style={styles.sectionTitle}>⚖️ Event Ledger Balances</Text>
              {isOwnerOrAdmin && (
                <TouchableOpacity
                  style={[styles.recalibrateBtnInline, syncing && { opacity: 0.6 }]}
                  onPress={forceRecalculateSplits}
                  disabled={syncing}
                >
                  <Text style={styles.recalibrateBtnInlineText}>
                    {syncing ? '⏳ Syncing...' : '🔄 Recalibrate'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
            
            {/* EQUAL SHARE SUMMARY CARD */}
            <View style={styles.equalShareCard}>
              <View style={styles.equalShareRow}>
                <View>
                  <Text style={styles.equalShareLabel}>EQUAL SHARE PER PERSON</Text>
                  <Text style={styles.equalShareSubtext}>
                    Total ${ (totalExpensesCents / 100).toFixed(2) } split across {memberCount} members
                  </Text>
                </View>
                <Text style={styles.equalShareAmount}>
                  ${ (equalShareCents / 100).toFixed(2) }
                </Text>
              </View>
            </View>

            {/* MEMBER BALANCE LEDGER - UNIFIED CONTAINER WITH DYNAMIC AVATAR BUBBLES */}
            <View style={styles.unifiedContainer}>
              {balances.map((item, idx) => {
                const isOwed = item.net >= 0;
                const hasSettlementActivity = (item.settlementPaid || 0) > 0 || (item.settlementReceived || 0) > 0;
                const isLast = idx === balances.length - 1;

                // Dynamic avatar styling based on balance status
                const avatarBgColor = isOwed ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)';
                const avatarTextColor = isOwed ? '#10B981' : '#EF4444';
                const avatarBorderColor = isOwed ? 'rgba(16, 185, 129, 0.4)' : 'rgba(239, 68, 68, 0.4)';

                return (
                  <View 
                    key={item.userId} 
                    style={[styles.unifiedRow, !isLast && styles.rowDivider]}
                  >
                    {/* Dynamic Avatar Bubble */}
                    <View 
                      style={[
                        styles.avatarBubble, 
                        { 
                          backgroundColor: avatarBgColor, 
                          borderColor: avatarBorderColor 
                        }
                      ]}
                    >
                      <Text style={[styles.avatarText, { color: avatarTextColor }]}>
                        {getInitials(item.displayName)}
                      </Text>
                    </View>

                    {/* Member Details */}
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={styles.memberName}>{item.displayName}</Text>
                      
                      <Text style={styles.memberSub}>
                        Spent: ${(item.basePaid / 100).toFixed(2)} | Share: ${(item.share / 100).toFixed(2)}
                      </Text>

                      {/* Past Settlement Breakdown */}
                      {hasSettlementActivity ? (
                        <Text style={styles.settlementSubText}>
                          💳 History: {item.settlementPaid > 0 ? `Sent $${(item.settlementPaid / 100).toFixed(2)}` : ''}
                          {item.settlementPaid > 0 && item.settlementReceived > 0 ? ' · ' : ''}
                          {item.settlementReceived > 0 ? `Received $${(item.settlementReceived / 100).toFixed(2)}` : ''}
                        </Text>
                      ) : (
                        <Text style={styles.settlementSubText}>💳 History : $0.00</Text>
                      )}
                    </View>

                    {/* Net Value Badge */}
                    <View style={styles.netValueContainer}>
                      <Text style={[styles.netValue, { color: isOwed ? '#10B981' : '#EF4444' }]}>
                        {isOwed ? '+' : ''}${(item.net / 100).toFixed(2)}
                      </Text>
                      <Text style={styles.netLabel}>{isOwed ? 'gets back' : 'owes'}</Text>
                    </View>
                  </View>
                );
              })}
            </View>

            {/* 2. REPAYMENT CHECKLIST */}
            <View style={{ marginTop: 25, marginBottom: 12 }}>
              <Text style={styles.sectionTitle}>📋 Live Repayment Checklist</Text>
              {isOwnerOrAdmin && settleRoutes.length > 0 && (
                <TouchableOpacity
                  style={[styles.publishPlanBtn, publishing && { opacity: 0.6 }]}
                  onPress={publishSettlementPlan}
                  disabled={publishing}
                >
                  <Text style={styles.publishPlanBtnText}>
                    {publishing ? '🔒 Publishing...' : '🔒 Publish & Override Checklist'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            {!activePlanId ? (
              <View style={{ gap: 10 }}>
                {settleRoutes.length === 0 ? (
                  <View style={styles.settleCard}>
                    <Text style={styles.perfectSettleText}>
                      🎉 Everyone is completely settled! No transactions needed.
                    </Text>
                  </View>
                ) : (
                  settleRoutes.map((route, idx) => (
                    <View key={idx} style={styles.settleItemCard}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.settleItemTitle}>
                          <Text style={styles.boldText}>{route.fromUser}</Text> ➔{' '}
                          <Text style={styles.boldText}>{route.toUser}</Text>
                        </Text>
                        <Text style={styles.settleItemSub}>
                          {route.recommendedMethod.toLowerCase()} {route.handleDetail.toLowerCase()}
                        </Text>
                      </View>
                      <Text style={styles.settleItemPrice}>
                        ${(route.amountCents / 100).toFixed(2)}
                      </Text>
                    </View>
                  ))
                )}
              </View>
            ) : (
              <View style={{ gap: 10 }}>
                {/* PUBLISHED ACTIVE CHECKLIST ITEM */}
                {settlementSteps.map((step, idx) => {
                  const isSent = step.status === 'sent';
                  const isCompleted = step.status === 'completed';
                  const isLast = idx === settlementSteps.length - 1;

                  return (
                    <View
                      key={step.id}
                      style={[
                        styles.unifiedRowColumn,
                        !isLast && styles.rowDivider,
                        isCompleted && styles.completedRowBg,
                      ]}
                    >
                      {/* TOP ROW: Sender ➡️ Receiver & Amount */}
                      <View style={styles.stepTopRow}>
                        <View style={{ flex: 1, paddingRight: 8 }}>
                          <Text style={styles.stepTitle}>
                            <Text style={styles.boldText}>{step.from_profile?.display_name}</Text>{' '}
                            ➡️ <Text style={styles.boldText}>{step.to_profile?.display_name}</Text>
                          </Text>
                          <Text style={styles.methodText}>
                            📱 via {step.payment_method} {step.payment_handle ?? ''}
                          </Text>
                        </View>

                        <Text style={styles.settleAmount}>
                          ${(step.amount_cents / 100).toFixed(2)}
                        </Text>
                      </View>

                      {/* BOTTOM ROW: Action Buttons / Status Badge */}
                      <View style={styles.stepActionRow}>
                        {step.status === 'pending' && (
                          currentUserId === step.from_user_id ? (
                            <View style={styles.actionButtonGroup}>
                              {step.payment_method !== 'cash' && 
                               step.payment_method !== 'No common app (Ask!)' && 
                               step.payment_method !== 'Manual (Ask)' && (
                                <TouchableOpacity
                                  style={styles.payNowBtn}
                                  onPress={() =>
                                    handleDirectPayment({
                                      method: step.payment_method,
                                      handle: step.payment_handle ?? '',
                                      amountCents: step.amount_cents,
                                      note: `SquadFund Settlement: ${event?.name ?? 'Squad'}`
                                    })
                                  }
                                >
                                  <Text style={styles.payNowBtnText}>
                                    ⚡ Pay via {step.payment_method}
                                  </Text>
                                </TouchableOpacity>
                              )}

                              <TouchableOpacity
                                style={styles.stepActionBtn}
                                onPress={() => handleMarkAsSent(step.id)}
                              >
                                <Text style={styles.stepActionBtnText}>Mark Sent</Text>
                              </TouchableOpacity>
                            </View>
                          ) : (
                            <Text style={styles.waitingLabel}>⏳ Waiting on sender to pay...</Text>
                          )
                        )}

                        {isSent && (
                          currentUserId === step.to_user_id ? (
                            <TouchableOpacity
                              style={[styles.stepActionBtn, { backgroundColor: '#10B981', width: '100%' }]}
                              onPress={() => handleConfirmReceipt(step.id)}
                            >
                              <Text style={styles.stepActionBtnText}>Confirm Receipt ✓</Text>
                            </TouchableOpacity>
                          ) : (
                            <Text style={styles.waitingLabel}>🕒 Awaiting recipient confirmation...</Text>
                          )
                        )}

                        {isCompleted && (
                          <Text style={styles.completedLabel}>Paid & Settled ✓</Text>
                        )}
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </ScrollView>
        )}

      {/* Budget / Plan Tab */}
      {activeTab === 'plan' && (
        <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: 40 }}>
          <View style={styles.singleGroupCard}>
            <Text style={styles.groupCardHeader}>📊 Budget vs. Actual Costs</Text>
            {(() => {
              const totalPlanned = budgetItems.reduce((sum, item) => sum + item.planned_amount_cents, 0);
              const totalSpent = expenses.reduce((sum, exp) => sum + exp.amount_cents, 0);
              const overUnder = totalPlanned - totalSpent;
              const percentUsed = totalPlanned > 0 ? (totalSpent / totalPlanned) * 100 : 0;
              return (
                <View style={{ paddingVertical: 10 }}>
                  <View style={styles.progressMetricsRow}>
                    <View>
                      <Text style={styles.metricLabel}>Expected Budget</Text>
                      <Text style={styles.plannedAmtText}>${(totalPlanned / 100).toFixed(2)}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={styles.metricLabel}>Spent to Date</Text>
                      <Text
                        style={[
                          styles.spentAmtText,
                          { color: totalSpent > totalPlanned ? '#EF4444' : '#10B981' },
                        ]}
                      >
                        ${(totalSpent / 100).toFixed(2)}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.progressBarBg}>
                    <View
                      style={[
                        styles.progressBarFill,
                        {
                          width: `${Math.min(percentUsed, 100)}%`,
                          backgroundColor: percentUsed > 100 ? '#EF4444' : '#8B5CF6',
                        },
                      ]}
                    />
                  </View>
                  <Text style={styles.overUnderSub}>
                    {overUnder >= 0
                      ? `🟢 Under budget by $${(overUnder / 100).toFixed(2)}`
                      : `🔴 Exceeded budget by $${(Math.abs(overUnder) / 100).toFixed(2)}`}
                  </Text>
                </View>
              );
            })()}
          </View>

          <TouchableOpacity
            style={styles.secondaryActionBtn}
            onPress={() => setShowAddBudgetModal(!showAddBudgetModal)}
          >
            <Text style={styles.secondaryActionBtnText}>
              {showAddBudgetModal ? '✕ Close Form' : '➕ Plan a New Expense'}
            </Text>
          </TouchableOpacity>

          {showAddBudgetModal && (
            <View style={styles.formCard}>
              <TextInput
                placeholder="Expense Name"
                placeholderTextColor="#6B7280"
                style={styles.formInput}
                value={newBudgetTitle}
                onChangeText={setNewBudgetTitle}
              />
              <TextInput
                placeholder="Planned Cost ($)"
                placeholderTextColor="#6B7280"
                keyboardType="numeric"
                style={styles.formInput}
                value={newBudgetAmount}
                onChangeText={setNewBudgetAmount}
              />
              <View style={styles.pickerContainer}>
                {balances.map((member) => (
                  <TouchableOpacity
                    key={member.userId}
                    style={[
                      styles.assignChip,
                      newBudgetAssignee === member.userId && styles.assignChipSelected,
                    ]}
                    onPress={() => setNewBudgetAssignee(member.userId)}
                  >
                    <Text
                      style={[
                        styles.assignChipText,
                        newBudgetAssignee === member.userId && styles.assignChipTextSelected,
                      ]}
                    >
                      {member.displayName}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity style={styles.primaryActionBtn} onPress={handleAddBudgetItem}>
                <Text style={styles.primaryActionBtnText}>Save Planned Expense</Text>
              </TouchableOpacity>
            </View>
          )}

          <Text style={styles.sectionTitle}>📋 Planned Spending Checklist</Text>
          {budgetItems.length > 0 && (
            <View style={styles.singleGroupCard}>
              {budgetItems.map((item, index) => {
                const isLast = index === budgetItems.length - 1;
                return (
                  <View key={item.id} style={[styles.memberRow, !isLast && styles.memberRowBorder]}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.memberName}>{item.title}</Text>
                      <Text style={styles.memberSub}>
                        Assigned to {item.assigned_profile?.display_name}
                      </Text>
                    </View>
                    <Text style={[styles.cleanNetValue, { color: '#8B5CF6' }]}>
                      ${(item.planned_amount_cents / 100).toFixed(2)}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>
      )}

      {/* Activity Feed Tab */}
      {activeTab === 'activity' && (
        <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: 40 }}>
          <Text style={styles.sectionTitle}>⏳ Activity Log</Text>
          <View style={styles.singleGroupCard}>
            {activities.map((act, index) => {
              const isLast = index === activities.length - 1;
              const displayName = act.profiles?.display_name || 'Someone';
              const formattedDate = new Date(act.created_at).toLocaleDateString([], {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              });
              return (
                <View key={act.id} style={[styles.memberRow, !isLast && styles.memberRowBorder]}>
                  <View style={styles.activityDot} />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={styles.activityText}>
                      <Text style={styles.memberName}>{displayName}</Text> {act.description}
                    </Text>
                    <Text style={styles.memberSub}>{formattedDate}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        </ScrollView>
      )}

      {/* Members Tab */}
      {activeTab === 'members' && (
        <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: 40 }}>
          <Text style={styles.sectionTitle}>Event Roster ({members.length})</Text>
          <View style={styles.singleGroupCard}>
            {members.map((m, index) => {
              const isLast = index === members.length - 1;
              const isMe = m.user_id === currentUserId;
              const isOwner = userRole === 'owner';
              const initials = m.display_name
                .split(' ')
                .map((n: string) => n[0])
                .join('')
                .toUpperCase()
                .slice(0, 2);

              return (
                <View key={m.user_id} style={[styles.memberRow, !isLast && styles.memberRowBorder]}>
                  <View style={styles.avatarCircleNeutral}>
                    <Text style={styles.avatarTextNeutral}>{initials}</Text>
                  </View>

                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={styles.memberName}>
                      {m.display_name} {isMe ? '(You)' : ''}
                    </Text>
                    <View style={styles.badgeWrapper}>
                      <Text style={styles.badgeText}>{m.role.toUpperCase()}</Text>
                    </View>
                  </View>

                  {isOwner && !isMe && (
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      {m.role !== 'owner' && (
                        <TouchableOpacity
                          style={styles.smallChipBtn}
                          onPress={() =>
                            handleChangeRole(
                              m.user_id,
                              m.display_name,
                              m.role === 'admin' ? 'member' : 'admin'
                            )
                          }
                        >
                          <Text style={styles.smallChipText}>
                            {m.role === 'admin' ? 'Demote' : 'Admin'}
                          </Text>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity
                        style={[styles.smallChipBtn, styles.dangerChipBtn]}
                        onPress={() => handleTransferOwnership(m.user_id, m.display_name)}
                      >
                        <Text style={styles.dangerChipText}>Owner</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F0F13', // Main sleek dark background
    paddingTop: 50,
  },
  centerContainer: {
    flex: 1,
    backgroundColor: '#0F0F13',
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  backBtn: {
    backgroundColor: '#1C1C24',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#262630',
    alignSelf: 'flex-start',
    marginBottom: 12,
  },
  backBtnText: {
    color: '#8B5CF6',
    fontWeight: '700',
    fontSize: 13,
  },
  eventName: {
    fontSize: 28,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  eventDesc: {
    fontSize: 14,
    color: '#9CA3AF',
    marginTop: 4,
  },
  tabBarWrapper: {
    borderBottomWidth: 1,
    borderBottomColor: '#262630',
    backgroundColor: '#17171E',
  },
  tabBarContainer: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  tabBarScroll: {
    alignItems: 'center',
  },
  tab: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    marginRight: 8,
  },
  activeTab: {
    backgroundColor: '#8B5CF6',
  },
  tabText: {
    color: '#9CA3AF',
    fontSize: 14,
    fontWeight: '600',
  },
  activeTabText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 12,
  },

  // Stats / Overview
  statsCard: {
    backgroundColor: '#1C1C24',
    borderRadius: 16,
    padding: 18,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#262630',
  },
  statsLabel: {
    fontSize: 13,
    color: '#9CA3AF',
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  statsValue: {
    fontSize: 30,
    fontWeight: '800',
    color: '#8B5CF6',
    marginTop: 4,
  },
  recalcBtn: {
    backgroundColor: '#8B5CF6',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  recalcBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
  disabledBtn: {
    opacity: 0.6,
  },

  // Expenses Tab
  addExpenseBtn: {
    backgroundColor: '#8B5CF6',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    marginBottom: 16,
  },
  addExpenseBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
  expenseCard: {
    backgroundColor: '#1C1C24',
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#262630',
  },
  expenseDescription: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  expenseMeta: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 4,
  },
  expenseAmount: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  deleteActionBtn: {
    padding: 6,
  },
  deleteActionBtnText: {
    fontSize: 16,
  },
  emptyText: {
    color: '#9CA3AF',
    textAlign: 'center',
    marginTop: 30,
    fontSize: 14,
  },

  // Balances Tab
  recalibrateHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  recalibrateBtnInline: {
    backgroundColor: '#8B5CF6',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 25, // Full pill shape
    shadowColor: '#8B5CF6',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
  },
  recalibrateBtnInlineText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  balanceCard: {
    backgroundColor: '#181820',
    borderRadius: 18, // Increase radius for soft, rounded corners
    padding: 18,      // Extra padding so text isn't cramped
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#282834',
  },
  memberName: {
    fontSize: 17,
    fontWeight: '800', // Extra bold text for names
    color: '#FFFFFF',
    marginBottom: 4,
  },
  memberSub: {
    fontSize: 13,
    fontWeight: '500',
    color: '#8E8E9A', // Softer grey for secondary text
  },
  netValueContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
  },
  netValue: {
    fontSize: 16,
    fontWeight: '700',
  },
  netLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#6B7280',
    textTransform: 'uppercase',
    marginTop: 2,
  },
  publishPlanBtn: {
    backgroundColor: '#8B5CF6',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    alignSelf: 'flex-start',
    marginTop: 6,
  },
  publishPlanBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  settleCard: {
    backgroundColor: '#1C1C24',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#262630',
  },
  perfectSettleText: {
    color: '#10B981',
    fontWeight: '600',
    textAlign: 'center',
  },
  settleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#262630',
  },
  settleText: {
    color: '#E5E7EB',
    fontSize: 14,
  },
  boldText: {
    fontWeight: '700',
    color: '#FFFFFF',
  },
  methodText: {
    color: '#9CA3AF',
    fontSize: 12,
    marginTop: 2,
  },
  settleAmount: {
    fontSize: 16,
    fontWeight: '700',
    color: '#10B981',
  },
  stepCard: {
    backgroundColor: '#181820',
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#282834',
  },
  stepCompleted: {
    opacity: 0.6,
  },
  stepTitle: {
    fontSize: 14,
    color: '#E5E7EB',
  },
  stepPrice: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    marginTop: 2,
  },
  stepActionBtn: {
    backgroundColor: '#8B5CF6',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20, // Pill style for step actions
  },
  stepActionBtnText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 13,
  },
  waitingLabel: {
    color: '#9CA3AF',
    fontSize: 12,
    fontStyle: 'italic',
  },
  completedLabel: {
    color: '#10B981',
    fontWeight: '700',
    fontSize: 14,
  },

  // Archive
  archiveSection: {
    marginTop: 30,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#262630',
  },
  archiveCard: {
    backgroundColor: '#17171E',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#262630',
  },
  archiveDateHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: '#8B5CF6',
    marginBottom: 8,
  },
  archiveStepRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  archiveStepText: {
    fontSize: 13,
    color: '#9CA3AF',
  },
  archiveStepAmount: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  archiveStatusLabel: {
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginTop: 2,
  },

  // Budget / Plan Tab
  progressSummaryCard: {
    backgroundColor: '#1C1C24',
    borderRadius: 16,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#262630',
  },
  progressSummaryTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  progressMetricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  metricLabel: {
    fontSize: 11,
    color: '#9CA3AF',
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  plannedAmtText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    marginTop: 2,
  },
  spentAmtText: {
    fontSize: 18,
    fontWeight: '700',
    marginTop: 2,
  },
  progressBarBg: {
    height: 8,
    backgroundColor: '#262630',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 10,
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  overUnderSub: {
    fontSize: 12,
    color: '#9CA3AF',
    fontWeight: '600',
  },
  addBudgetOpenBtn: {
    backgroundColor: '#1C1C24',
    borderWidth: 1,
    borderColor: '#8B5CF6',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 16,
  },
  addBudgetOpenBtnText: {
    color: '#8B5CF6',
    fontWeight: '700',
    fontSize: 14,
  },
  formCard: {
    backgroundColor: '#17171E',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#262630',
  },
  formInput: {
    backgroundColor: '#1C1C24',
    color: '#FFFFFF',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#262630',
    marginBottom: 10,
    fontSize: 14,
  },
  pickerContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 12,
  },
  assignChip: {
    backgroundColor: '#1C1C24',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#262630',
  },
  assignChipSelected: {
    backgroundColor: '#8B5CF6',
    borderColor: '#8B5CF6',
  },
  assignChipText: {
    color: '#9CA3AF',
    fontSize: 12,
  },
  assignChipTextSelected: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  submitPlanBtn: {
    backgroundColor: '#8B5CF6',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  submitPlanBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  budgetRowCard: {
    backgroundColor: '#1C1C24',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#262630',
  },
  budgetRowTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  budgetRowMeta: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 2,
  },
  budgetRowAmount: {
    fontSize: 16,
    fontWeight: '700',
    color: '#8B5CF6',
  },

  // Activity Tab
  activityFeedCard: {
    backgroundColor: '#1C1C24',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: '#262630',
  },
  activityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#8B5CF6',
  },
  activityText: {
    fontSize: 13,
    color: '#E5E7EB',
  },
  activityUser: {
    fontWeight: '700',
    color: '#FFFFFF',
  },
  activityTime: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 2,
  },

  // Members Tab
  memberCard: {
    backgroundColor: '#1C1C24',
    padding: 16,
    borderRadius: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#262630',
  },
  memberDisplayName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  roleBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginTop: 6,
  },
  badgeOwner: {
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
  },
  badgeAdmin: {
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
  },
  badgeMember: {
    backgroundColor: 'rgba(156, 163, 175, 0.2)',
  },
  roleBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  actionRow: {
    flexDirection: 'column',
    gap: 6,
  },
  roleActionBtn: {
    backgroundColor: '#262630',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  roleActionBtnText: {
    color: '#9CA3AF',
    fontSize: 11,
    fontWeight: '600',
  },
  transferBtn: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  transferBtnText: {
    color: '#EF4444',
    fontSize: 11,
    fontWeight: '700',
  },
  // --- SINGLE CARD GROUP STYLES ---
  singleGroupCard: {
    backgroundColor: '#1E1E24',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 6,
    borderWidth: 1,
    borderColor: '#2A2A36',
    marginBottom: 16,
  },
  groupCardHeader: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 16,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
  },
  memberRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#2A2A36',
  },
  avatarCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  cleanNetValue: {
    fontSize: 17,
    fontWeight: '700',
    color: '#10B981',
  },

  // --- REPAYMENT CARD STYLES ---
  settleItemCard: {
    backgroundColor: '#1C1C24',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#2A2A36',
  },
  settleItemTitle: {
    fontSize: 15,
    color: '#FFFFFF',
  },
  settleItemSub: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 3,
  },
  settleItemPrice: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  checkBtn: {
    backgroundColor: '#2A2A36',
    width: 34,
    height: 34,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#3F3F4E',
  },
  checkBtnDone: {
    backgroundColor: '#10B981',
    borderColor: '#10B981',
  },
  checkBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 15,
  },
  // Action buttons
  primaryActionBtn: {
    backgroundColor: '#8B5CF6',
    paddingVertical: 14,
    borderRadius: 20,
    alignItems: 'center',
    marginBottom: 16,
  },
  primaryActionBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  secondaryActionBtn: {
    backgroundColor: '#1E1E24',
    borderWidth: 1,
    borderColor: '#8B5CF6',
    paddingVertical: 12,
    borderRadius: 20,
    alignItems: 'center',
    marginBottom: 16,
  },
  secondaryActionBtnText: {
    color: '#8B5CF6',
    fontWeight: '700',
    fontSize: 14,
  },

  // Stats
  statLabel: {
    fontSize: 12,
    color: '#9CA3AF',
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  statValue: {
    fontSize: 24,
    fontWeight: '800',
    color: '#FFFFFF',
    marginTop: 4,
  },

  // Avatars & Neutral Icons
  avatarCircleNeutral: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#2A2A36',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarTextNeutral: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  deleteIconBtn: {
    backgroundColor: '#2A2A36',
    padding: 8,
    borderRadius: 10,
  },

  // Member Badges & Small Controls
  badgeWrapper: {
    alignSelf: 'flex-start',
    backgroundColor: '#2A2A36',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    marginTop: 4,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#9CA3AF',
  },
  smallChipBtn: {
    backgroundColor: '#2A2A36',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
  },
  smallChipText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
  },
  dangerChipBtn: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
  },
  dangerChipText: {
    color: '#EF4444',
    fontSize: 11,
    fontWeight: '700',
  },

  // Equal Share Banner
  equalShareCard: {
    backgroundColor: '#1E1E24',
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#2A2A36',
  },
  equalShareRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  equalShareLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#9CA3AF',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  equalShareSubtext: {
    fontSize: 12,
    color: '#6B7280',
  },
  equalShareAmount: {
    fontSize: 20,
    fontWeight: '800',
    color: '#8B5CF6', // Accent purple
  },

  // Settle Up Button
  settleUpBtn: {
    backgroundColor: '#8B5CF6',
    paddingVertical: 14,
    borderRadius: 20,
    alignItems: 'center',
    marginBottom: 16,
    shadowColor: '#8B5CF6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  settleUpBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  settlementSubText: {
    fontSize: 11,
    color: '#0288d1',
    fontWeight: '600',
    marginTop: 3,
  },
  // Unified Container Styles
  unifiedContainer: {
    backgroundColor: '#1E1E24',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2A2A36',
    overflow: 'hidden',
    marginBottom: 20,
  },
  unifiedRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
  },
  rowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: '#2A2A36',
  },
  // Avatar Bubble Styles
  avatarBubble: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Pay Now Direct Button
  payNowBtn: {
    backgroundColor: '#8B5CF6', // Accent purple or #10B981 green
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  payNowBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  unifiedRowColumn: {
    flexDirection: 'column',
    padding: 16,
  },
  stepTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  stepActionRow: {
    marginTop: 4,
    alignItems: 'flex-start',
  },
  actionButtonGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    width: '100%',
  },
  // Row highlight style for completed steps
  completedRowBg: {
    backgroundColor: 'rgba(16, 185, 129, 0.08)', // Soft green tint for dark mode
  },
});