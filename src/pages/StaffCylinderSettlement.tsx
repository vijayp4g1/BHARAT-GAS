import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import db, { type StaffCylinderSettlement as SettlementRecord } from '../lib/db';
import { 
  ArrowLeft, 
  Plus, 
  Calendar, 
  DollarSign, 
  Flame, 
  Truck, 
  QrCode, 
  Globe, 
  Banknote, 
  RotateCcw, 
  CheckCircle2, 
  AlertTriangle, 
  Trash2, 
  Edit3, 
  Share2, 
  FileSpreadsheet, 
  Save, 
  X, 
  LogOut, 
  ChevronLeft, 
  ChevronRight, 
  RefreshCw, 
  Search,
  MoreVertical,
  MessageCircle,
  Check,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Sparkles,
  Phone,
  SlidersHorizontal,
  Layers
} from 'lucide-react';
import toast from 'react-hot-toast';
import * as XLSX from 'xlsx';
import { performLogout } from '../lib/auth';
import { isCurrentStaffOrManager } from '../lib/staffAuth';

export const StaffCylinderSettlement: React.FC = () => {
  const navigate = useNavigate();

  // Date selection (default today)
  const todayIso = useMemo(() => new Date().toISOString().split('T')[0], []);
  const [selectedDate, setSelectedDate] = useState<string>(todayIso);

  // Cylinder Rate (default 994)
  const [cylinderRate, setCylinderRate] = useState<number>(() => {
    const saved = localStorage.getItem('bgcls_cylinder_rate');
    return saved ? Number(saved) : 994;
  });
  const [isRateModalOpen, setIsRateModalOpen] = useState<boolean>(false);
  const [tempRate, setTempRate] = useState<number>(cylinderRate);

  // Quick Action Menu state
  const [isMenuOpen, setIsMenuOpen] = useState<boolean>(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Available Agents list (delivery boys)
  const [agents, setAgents] = useState<any[]>([]);
  const [isLoadingAgents, setIsLoadingAgents] = useState<boolean>(true);

  // Settlements for the selected date
  const [settlements, setSettlements] = useState<SettlementRecord[]>([]);
  const [isLoadingSettlements, setIsLoadingSettlements] = useState<boolean>(true);

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'BALANCED' | 'SHORTAGE'>('ALL');
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});

  // Speed Entry Modal / Form state
  const [isFormOpen, setIsFormOpen] = useState<boolean>(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form Fields for Fast Single-Page Modal
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const [agentSearchQuery, setAgentSearchQuery] = useState<string>('');
  const [suppliedCylinders, setSuppliedCylinders] = useState<number | ''>(40);
  const [cashCylinders, setCashCylinders] = useState<number | ''>(20);
  const [onlineCylinders, setOnlineCylinders] = useState<number | ''>(10);
  const [upiCylinders, setUpiCylinders] = useState<number | ''>(10);
  const [dueCylinders, setDueCylinders] = useState<number | ''>(0);
  const [returnedFullCylinders, setReturnedFullCylinders] = useState<number | ''>(0);
  const [emptyCylinders, setEmptyCylinders] = useState<number | ''>(40);
  const [actualCashInput, setActualCashInput] = useState<number | ''>('');
  const [notes, setNotes] = useState<string>('');
  const [showAdvancedFields, setShowAdvancedFields] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Staff User profile & role
  const currentUserRole = localStorage.getItem('bgcls_user_role') || 'AGENT';
  const staffUserName = useMemo(() => {
    const raw = localStorage.getItem('bgcls_remember_username') || '';
    if (raw) return raw.replace('@', '');
    return 'John';
  }, []);

  // Close 3-dot menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Verify staff or manager authorization
  useEffect(() => {
    if (!isCurrentStaffOrManager()) {
      toast.error('Restricted: Staff permission required.');
      navigate('/agent/search', { replace: true });
    }
  }, [navigate]);

  // Fetch Delivery Boys (role = AGENT) with phone numbers
  useEffect(() => {
    const fetchDeliveryBoys = async () => {
      setIsLoadingAgents(true);
      try {
        const { data, error } = await supabase
          .from('agents')
          .select('id, name, username, phone, status, role')
          .neq('status', 'DELETED')
          .order('name');

        if (!error && data) {
          const deliveryAgents = data.filter((a) => a.role === 'AGENT');
          setAgents(deliveryAgents.length > 0 ? deliveryAgents : data);
        }
      } catch (err) {
        console.warn('Failed to load agents from cloud, trying local cache:', err);
      } finally {
        setIsLoadingAgents(false);
      }
    };

    fetchDeliveryBoys();
  }, []);

  // Fetch settlements for the selected date (Dexie + Supabase sync)
  const fetchSettlements = async (date: string) => {
    setIsLoadingSettlements(true);
    try {
      // 1. Load from local Dexie database
      const localRecords = await db.staff_cylinder_settlements
        .where('settlement_date')
        .equals(date)
        .toArray();

      setSettlements(localRecords);

      // 2. Fetch from Supabase if online
      if (navigator.onLine) {
        try {
          const { data: remoteData, error } = await supabase
            .from('staff_cylinder_settlements')
            .select('*')
            .eq('settlement_date', date);

          if (!error && remoteData && remoteData.length > 0) {
            await db.staff_cylinder_settlements.bulkPut(
              remoteData.map((r: any) => ({
                id: r.id,
                settlement_date: r.settlement_date,
                agent_id: r.agent_id,
                agent_name: r.agent_name,
                cylinder_price: Number(r.cylinder_price || cylinderRate),
                supplied_cylinders: Number(r.supplied_cylinders || 0),
                cash_cylinders: Number(r.cash_cylinders || 0),
                online_cylinders: Number(r.online_cylinders || 0),
                upi_cylinders: Number(r.upi_cylinders || 0),
                due_cylinders: Number(r.due_cylinders || 0),
                returned_full_cylinders: Number(r.returned_full_cylinders || 0),
                empty_cylinders: Number(r.empty_cylinders || 0),
                expected_cash: Number(r.expected_cash || 0),
                actual_cash: Number(r.actual_cash || 0),
                cash_difference: Number(r.cash_difference || 0),
                online_amount: Number(r.online_amount || 0),
                upi_amount: Number(r.upi_amount || 0),
                total_amount: Number(r.total_amount || 0),
                status: r.status,
                notes: r.notes || '',
                created_at: r.created_at,
                synced: true,
              }))
            );

            const merged = await db.staff_cylinder_settlements
              .where('settlement_date')
              .equals(date)
              .toArray();
            setSettlements(merged);
          }
        } catch (_) {}
      }
    } catch (err) {
      console.error('Error fetching settlements:', err);
    } finally {
      setIsLoadingSettlements(false);
    }
  };

  useEffect(() => {
    fetchSettlements(selectedDate);
  }, [selectedDate]);

  // Save cylinder rate
  const handleSaveRate = (newRate: number) => {
    if (newRate <= 0) {
      toast.error('Invalid rate amount');
      return;
    }
    setCylinderRate(newRate);
    localStorage.setItem('bgcls_cylinder_rate', String(newRate));
    setIsRateModalOpen(false);
    toast.success(`Rate updated to ₹${newRate} / cyl`);
  };

  // Calculations for Current Modal Form
  const numSupplied = Number(suppliedCylinders) || 0;
  const numCash = Number(cashCylinders) || 0;
  const numOnline = Number(onlineCylinders) || 0;
  const numUpi = Number(upiCylinders) || 0;
  const numDue = Number(dueCylinders) || 0;
  const numReturnedFull = Number(returnedFullCylinders) || 0;
  const numEmpty = Number(emptyCylinders) || 0;

  // Accounted cylinders
  const totalAccountedCylinders = numCash + numOnline + numUpi + numDue + numReturnedFull;
  const cylinderDifference = numSupplied - totalAccountedCylinders;

  // Expected Cash = Cash cylinders * cylinderRate
  const expectedCashAmount = numCash * cylinderRate;
  const onlineAmount = numOnline * cylinderRate;
  const upiAmount = numUpi * cylinderRate;
  const dueAmount = numDue * cylinderRate;
  const totalCylinderSalesValue = (numCash + numOnline + numUpi + numDue) * cylinderRate;

  // Actual Cash & Difference
  const numActualCash = actualCashInput === '' ? expectedCashAmount : Number(actualCashInput) || 0;
  const cashDifference = numActualCash - expectedCashAmount;

  // Empty cylinders balance check
  const expectedEmpties = Math.max(0, numSupplied - numReturnedFull);
  const emptyDifference = numEmpty - expectedEmpties;

  // Settlement Status
  const calculatedStatus: 'BALANCED' | 'SHORTAGE' | 'EXCESS' = useMemo(() => {
    if (cylinderDifference === 0 && cashDifference === 0 && emptyDifference >= 0) return 'BALANCED';
    if (cylinderDifference > 0 || cashDifference < 0 || emptyDifference < 0) return 'SHORTAGE';
    return 'EXCESS';
  }, [cylinderDifference, cashDifference, emptyDifference]);

  // Aggregate Daily KPIs for the entire agency
  const dailyKpis = useMemo(() => {
    const totalSupplied = settlements.reduce((acc, s) => acc + s.supplied_cylinders, 0);
    const totalCashQty = settlements.reduce((acc, s) => acc + s.cash_cylinders, 0);
    const totalOnlineQty = settlements.reduce((acc, s) => acc + s.online_cylinders, 0);
    const totalUpiQty = settlements.reduce((acc, s) => acc + s.upi_cylinders, 0);
    const totalDueQty = settlements.reduce((acc, s) => acc + s.due_cylinders, 0);
    const totalReturnedFull = settlements.reduce((acc, s) => acc + s.returned_full_cylinders, 0);
    const totalEmpties = settlements.reduce((acc, s) => acc + s.empty_cylinders, 0);

    const totalCashExpected = settlements.reduce((acc, s) => acc + s.expected_cash, 0);
    const totalCashReceived = settlements.reduce((acc, s) => acc + s.actual_cash, 0);
    const totalOnlineAmount = settlements.reduce((acc, s) => acc + s.online_amount, 0);
    const totalUpiAmount = settlements.reduce((acc, s) => acc + s.upi_amount, 0);
    const totalDueAmount = settlements.reduce((acc, s) => acc + (s.due_cylinders * s.cylinder_price), 0);
    const totalNetRevenue = settlements.reduce((acc, s) => acc + s.total_amount, 0);
    const netCashDifference = totalCashReceived - totalCashExpected;

    // Godown inventory calculation:
    // Empties should equal Total Supplied - Full Returned
    const netExpectedEmpties = totalSupplied - totalReturnedFull;
    const godownEmptyDiff = totalEmpties - netExpectedEmpties;

    // Delivery boy with shortage if any
    const boysWithShortage = settlements.filter(
      (s) => s.cash_difference < 0 || s.supplied_cylinders > (s.cash_cylinders + s.online_cylinders + s.upi_cylinders + s.due_cylinders + s.returned_full_cylinders)
    );

    return {
      totalSupplied,
      totalCashQty,
      totalOnlineQty,
      totalUpiQty,
      totalDueQty,
      totalReturnedFull,
      totalEmpties,
      totalCashExpected,
      totalCashReceived,
      totalOnlineAmount,
      totalUpiAmount,
      totalDueAmount,
      totalNetRevenue,
      netCashDifference,
      godownEmptyDiff,
      boyCount: settlements.length,
      boysWithShortage,
      firstShortageBoy: boysWithShortage[0]?.agent_name || null,
    };
  }, [settlements]);

  // Date Navigation
  const changeDateBy = (days: number) => {
    const cur = new Date(selectedDate);
    cur.setDate(cur.getDate() + days);
    setSelectedDate(cur.toISOString().split('T')[0]);
  };

  // Formatted Date String for display
  const formattedDisplayDate = useMemo(() => {
    const [y, m, d] = selectedDate.split('-');
    const dateObj = new Date(Number(y), Number(m) - 1, Number(d));
    const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'short' });
    const monthName = dateObj.toLocaleDateString('en-US', { month: 'short' });

    if (selectedDate === todayIso) {
      return `Today, ${d} ${monthName} ${y}`;
    }
    return `${dayName}, ${d} ${monthName} ${y}`;
  }, [selectedDate, todayIso]);

  // Filtered settlements list
  const filteredSettlements = useMemo(() => {
    return settlements.filter((item) => {
      const matchesSearch = 
        !searchQuery || 
        item.agent_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (item.notes && item.notes.toLowerCase().includes(searchQuery.toLowerCase()));

      if (!matchesSearch) return false;

      if (statusFilter === 'BALANCED') {
        return item.cash_difference === 0 && item.status === 'BALANCED';
      }
      if (statusFilter === 'SHORTAGE') {
        return item.cash_difference < 0 || item.status === 'SHORTAGE';
      }
      return true;
    });
  }, [settlements, searchQuery, statusFilter]);

  // Open Speed Entry Modal
  const handleOpenNewForm = (preselectedAgentId?: string) => {
    setEditingId(null);
    setSelectedAgentId(preselectedAgentId || agents[0]?.id || '');
    setAgentSearchQuery('');
    setSuppliedCylinders(40);
    setCashCylinders(20);
    setOnlineCylinders(10);
    setUpiCylinders(10);
    setDueCylinders(0);
    setReturnedFullCylinders(0);
    setEmptyCylinders(40);
    setActualCashInput(20 * cylinderRate);
    setNotes('');
    setShowAdvancedFields(false);
    setIsFormOpen(true);
  };

  // Open Form to Edit
  const handleEdit = (item: SettlementRecord) => {
    setEditingId(item.id);
    setSelectedAgentId(item.agent_id);
    setAgentSearchQuery('');
    setSuppliedCylinders(item.supplied_cylinders);
    setCashCylinders(item.cash_cylinders);
    setOnlineCylinders(item.online_cylinders);
    setUpiCylinders(item.upi_cylinders);
    setDueCylinders(item.due_cylinders);
    setReturnedFullCylinders(item.returned_full_cylinders);
    setEmptyCylinders(item.empty_cylinders);
    setActualCashInput(item.actual_cash);
    setNotes(item.notes || '');
    setShowAdvancedFields(Boolean(item.due_cylinders || item.returned_full_cylinders));
    setIsFormOpen(true);
  };

  // Delete Settlement
  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to remove the settlement record for ${name}?`)) return;

    try {
      await db.staff_cylinder_settlements.delete(id);
      if (navigator.onLine) {
        try {
          await supabase.from('staff_cylinder_settlements').delete().eq('id', id);
        } catch (_) {}
      }
      setSettlements((prev) => prev.filter((s) => s.id !== id));
      toast.success(`Removed settlement for ${name}`);
    } catch (err) {
      toast.error('Failed to delete settlement');
    }
  };

  // Save Settlement (Dexie + Supabase)
  const handleSaveSettlement = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedAgentId) {
      toast.error('Please select a Delivery Boy');
      return;
    }

    const selectedAgent = agents.find((a) => a.id === selectedAgentId);
    const agentName = selectedAgent?.name || 'Delivery Boy';

    setIsSaving(true);
    const recordId = editingId || crypto.randomUUID();
    const nowIso = new Date().toISOString();

    const record: SettlementRecord = {
      id: recordId,
      settlement_date: selectedDate,
      agent_id: selectedAgentId,
      agent_name: agentName,
      cylinder_price: cylinderRate,
      supplied_cylinders: numSupplied,
      cash_cylinders: numCash,
      online_cylinders: numOnline,
      upi_cylinders: numUpi,
      due_cylinders: numDue,
      returned_full_cylinders: numReturnedFull,
      empty_cylinders: numEmpty,
      expected_cash: expectedCashAmount,
      actual_cash: numActualCash,
      cash_difference: cashDifference,
      online_amount: onlineAmount,
      upi_amount: upiAmount,
      total_amount: totalCylinderSalesValue,
      status: calculatedStatus,
      notes: notes.trim(),
      created_at: nowIso,
      updated_at: nowIso,
      synced: false,
    };

    try {
      // 1. Save in local Dexie IndexedDB
      await db.staff_cylinder_settlements.put(record);

      // 2. Sync to Supabase
      if (navigator.onLine) {
        try {
          const { error } = await supabase.from('staff_cylinder_settlements').upsert({
            id: record.id,
            settlement_date: record.settlement_date,
            agent_id: record.agent_id,
            agent_name: record.agent_name,
            cylinder_price: record.cylinder_price,
            supplied_cylinders: record.supplied_cylinders,
            cash_cylinders: record.cash_cylinders,
            online_cylinders: record.online_cylinders,
            upi_cylinders: record.upi_cylinders,
            due_cylinders: record.due_cylinders,
            returned_full_cylinders: record.returned_full_cylinders,
            empty_cylinders: record.empty_cylinders,
            expected_cash: record.expected_cash,
            actual_cash: record.actual_cash,
            cash_difference: record.cash_difference,
            online_amount: record.online_amount,
            upi_amount: record.upi_amount,
            total_amount: record.total_amount,
            status: record.status,
            notes: record.notes,
            updated_at: nowIso,
          });

          if (!error) {
            record.synced = true;
            await db.staff_cylinder_settlements.update(record.id, { synced: true });
          }
        } catch (_) {}
      }

      await fetchSettlements(selectedDate);
      setIsFormOpen(false);
      toast.success(`Settlement saved for ${agentName}!`);
    } catch (err: any) {
      console.error('Save error:', err);
      toast.error('Failed to save settlement');
    } finally {
      setIsSaving(false);
    }
  };

  // WhatsApp Agency Summary for Owner
  const handleShareDailyWhatsApp = () => {
    if (settlements.length === 0) {
      toast.error('No settlements recorded for this date yet');
      return;
    }

    const [y, m, d] = selectedDate.split('-');
    const formattedDate = `${d}/${m}/${y}`;

    let msg = `🔥 *SIDDHARTHA BHARAT GAS - DAILY GODOWN REGISTER*\n`;
    msg += `📅 *Date:* ${formattedDate}\n`;
    msg += `⛽ *14.2kg Rate:* ₹${cylinderRate} / cyl\n\n`;

    msg += `📊 *GODOWN STOCK BALANCE:*\n`;
    msg += `• Total Load Supplied: *${dailyKpis.totalSupplied} Cyl*\n`;
    msg += `• Empties Returned: *${dailyKpis.totalEmpties} Cyl*\n`;
    if (dailyKpis.godownEmptyDiff === 0) {
      msg += `• Empties Status: *✅ 100% Balanced*\n`;
    } else if (dailyKpis.godownEmptyDiff < 0) {
      msg += `• Empties Status: *⚠️ ${Math.abs(dailyKpis.godownEmptyDiff)} Empties Pending*\n`;
    } else {
      msg += `• Empties Status: *ℹ️ +${dailyKpis.godownEmptyDiff} Surplus Empties*\n`;
    }

    msg += `\n💰 *PAYMENT STREAM MATRIX:*\n`;
    msg += `• Cash: *₹${dailyKpis.totalCashExpected.toLocaleString('en-IN')}* (${dailyKpis.totalCashQty} cyl)\n`;
    msg += `• BPCL Online: *₹${dailyKpis.totalOnlineAmount.toLocaleString('en-IN')}* (${dailyKpis.totalOnlineQty} cyl)\n`;
    msg += `• UPI / QR: *₹${dailyKpis.totalUpiAmount.toLocaleString('en-IN')}* (${dailyKpis.totalUpiQty} cyl)\n`;
    if (dailyKpis.totalDueQty > 0) {
      msg += `• Due (Pending): *₹${dailyKpis.totalDueAmount.toLocaleString('en-IN')}* (${dailyKpis.totalDueQty} cyl)\n`;
    }
    msg += `• Total Sales Value: *₹${dailyKpis.totalNetRevenue.toLocaleString('en-IN')}*\n\n`;

    msg += `💵 *CASH RECONCILIATION:*\n`;
    msg += `• Expected: ₹${dailyKpis.totalCashExpected.toLocaleString('en-IN')}\n`;
    msg += `• Physical Received: ₹${dailyKpis.totalCashReceived.toLocaleString('en-IN')}\n`;
    if (dailyKpis.netCashDifference === 0) {
      msg += `• Net Status: *✅ 100% Cash Balanced*\n`;
    } else if (dailyKpis.netCashDifference < 0) {
      msg += `• Net Status: *❌ Shortage: -₹${Math.abs(dailyKpis.netCashDifference).toLocaleString('en-IN')}*\n`;
    } else {
      msg += `• Net Status: *⚠️ Excess: +₹${dailyKpis.netCashDifference.toLocaleString('en-IN')}*\n`;
    }

    msg += `\n🚚 *DELIVERY BOYS BREAKDOWN (${settlements.length}):*\n`;
    settlements.forEach((s, idx) => {
      const statusIcon = s.cash_difference === 0 ? '✅' : s.cash_difference < 0 ? `❌ (Short -₹${Math.abs(s.cash_difference)})` : `⚠️ (+₹${s.cash_difference})`;
      msg += `${idx + 1}. *${s.agent_name}*: ${s.supplied_cylinders} Load | ${s.cash_cylinders} Cash (₹${s.expected_cash.toLocaleString('en-IN')}) | ${s.online_cylinders} Online | ${s.upi_cylinders} UPI | ${s.empty_cylinders} Empties | Cash: ₹${s.actual_cash.toLocaleString('en-IN')} ${statusIcon}\n`;
    });

    const encoded = encodeURIComponent(msg);
    window.open(`https://wa.me/?text=${encoded}`, '_blank');
  };

  // WhatsApp Individual Receipt for Delivery Boy
  const handleShareIndividualWhatsApp = (s: SettlementRecord) => {
    const [y, m, d] = selectedDate.split('-');
    const formattedDate = `${d}/${m}/${y}`;
    const matchedAgent = agents.find((a) => a.id === s.agent_id || a.name === s.agent_name);
    const agentPhone = matchedAgent?.phone || '';

    let msg = `⛽ *BHARAT GAS - DELIVERY SETTLEMENT RECEIPT*\n`;
    msg += `👤 *Delivery Boy:* ${s.agent_name}\n`;
    msg += `📅 *Date:* ${formattedDate}\n`;
    msg += `⛽ *Rate:* ₹${s.cylinder_price} / cylinder\n`;
    msg += `--------------------------------\n`;
    msg += `📦 *Morning Load Supplied:* ${s.supplied_cylinders} Cylinders\n`;
    msg += `💵 *Cash Delivered:* ${s.cash_cylinders} Cylinders (₹${s.expected_cash.toLocaleString('en-IN')})\n`;
    msg += `🌐 *BPCL Online Paid:* ${s.online_cylinders} Cylinders (₹${s.online_amount.toLocaleString('en-IN')})\n`;
    msg += `📱 *UPI / QR Scanned:* ${s.upi_cylinders} Cylinders (₹${s.upi_amount.toLocaleString('en-IN')})\n`;
    if (s.due_cylinders > 0) {
      msg += `⏳ *Due / Pending:* ${s.due_cylinders} Cylinders\n`;
    }
    if (s.returned_full_cylinders > 0) {
      msg += `🔄 *Full Cylinders Returned:* ${s.returned_full_cylinders} Cylinders\n`;
    }
    msg += `🔄 *Empties Returned:* ${s.empty_cylinders} Cylinders\n`;
    msg += `--------------------------------\n`;
    msg += `💰 *Expected Cash Handover:* ₹${s.expected_cash.toLocaleString('en-IN')}\n`;
    msg += `💵 *Cash Counted & Received:* ₹${s.actual_cash.toLocaleString('en-IN')}\n`;
    if (s.cash_difference === 0) {
      msg += `✅ *Cash Status: EXACT 100% BALANCED*\n`;
    } else if (s.cash_difference < 0) {
      msg += `❌ *Cash Status: SHORTAGE -₹${Math.abs(s.cash_difference).toLocaleString('en-IN')}*\n`;
    } else {
      msg += `⚠️ *Cash Status: EXCESS +₹${s.cash_difference.toLocaleString('en-IN')}*\n`;
    }
    if (s.notes) {
      msg += `📝 *Remarks:* ${s.notes}\n`;
    }
    msg += `--------------------------------\n`;
    msg += `Verified by Agency Godown Staff.`;

    const encoded = encodeURIComponent(msg);
    const cleanPhone = agentPhone.replace(/\D/g, '');
    const targetPhone = cleanPhone ? (cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone) : '';

    if (targetPhone) {
      window.open(`https://wa.me/${targetPhone}?text=${encoded}`, '_blank');
    } else {
      window.open(`https://wa.me/?text=${encoded}`, '_blank');
    }
  };

  // Export to Excel
  const handleExportExcel = () => {
    if (settlements.length === 0) {
      toast.error('No data to export');
      return;
    }

    const exportRows = settlements.map((s) => ({
      'Delivery Boy': s.agent_name,
      'Date': s.settlement_date,
      'Supplied Cylinders': s.supplied_cylinders,
      'Cash Cylinders': s.cash_cylinders,
      'Expected Cash (₹)': s.expected_cash,
      'Actual Cash Received (₹)': s.actual_cash,
      'Cash Difference (₹)': s.cash_difference,
      'Online Cylinders (BPCL)': s.online_cylinders,
      'Online Amount (₹)': s.online_amount,
      'UPI Cylinders': s.upi_cylinders,
      'UPI Amount (₹)': s.upi_amount,
      'Due Cylinders': s.due_cylinders,
      'Full Returned': s.returned_full_cylinders,
      'Empty Cylinders Returned': s.empty_cylinders,
      'Total Value (₹)': s.total_amount,
      'Status': s.status,
      'Staff Notes': s.notes || '',
    }));

    exportRows.push({
      'Delivery Boy': 'TOTAL AGENCY SUMMARY',
      'Date': selectedDate,
      'Supplied Cylinders': dailyKpis.totalSupplied,
      'Cash Cylinders': dailyKpis.totalCashQty,
      'Expected Cash (₹)': dailyKpis.totalCashExpected,
      'Actual Cash Received (₹)': dailyKpis.totalCashReceived,
      'Cash Difference (₹)': dailyKpis.netCashDifference,
      'Online Cylinders (BPCL)': dailyKpis.totalOnlineQty,
      'Online Amount (₹)': dailyKpis.totalOnlineAmount,
      'UPI Cylinders': dailyKpis.totalUpiQty,
      'UPI Amount (₹)': dailyKpis.totalUpiAmount,
      'Due Cylinders': dailyKpis.totalDueQty,
      'Full Returned': dailyKpis.totalReturnedFull,
      'Empty Cylinders Returned': dailyKpis.totalEmpties,
      'Total Value (₹)': dailyKpis.totalNetRevenue,
      'Status': dailyKpis.netCashDifference === 0 ? 'BALANCED' : dailyKpis.netCashDifference < 0 ? 'SHORTAGE' : 'EXCESS',
      'Staff Notes': 'Agency Grand Totals',
    });

    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Cylinder Settlement');
    XLSX.writeFile(workbook, `BharatGas_Settlement_${selectedDate}.xlsx`);
    toast.success('Downloaded Excel settlement report!');
  };

  const handleLogout = async () => {
    await performLogout();
    navigate('/', { replace: true });
  };

  const toggleCardExpand = (id: string) => {
    setExpandedCards((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-amber-500 selection:text-slate-950">
      
      {/* 1. UNIFIED MOBILE HEADER (ANTI-CLUTTER) */}
      <header className="sticky top-0 z-30 bg-slate-950/90 backdrop-blur-xl border-b border-slate-800/80 px-3.5 sm:px-5 py-3 flex items-center justify-between gap-3 shadow-2xl">
        {/* Left: Back Arrow + Clean Title + User Pill */}
        <div className="flex items-center gap-2.5 min-w-0">
          <Link
            to={currentUserRole === 'MANAGER' ? '/manager/dashboard' : '/agent/search'}
            className="w-10 h-10 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 flex items-center justify-center text-slate-300 hover:text-white transition-all active:scale-95 shrink-0"
            title="Back to Navigation"
          >
            <ArrowLeft size={19} />
          </Link>

          <div className="flex items-center gap-2 min-w-0">
            <div className="flex flex-col">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
                <h1 className="text-base sm:text-lg font-black tracking-tight text-white flex items-center gap-1.5 truncate">
                  Staff Book
                </h1>
              </div>
              <span className="text-[10px] text-slate-400 font-semibold tracking-wide uppercase hidden sm:block">
                Godown Cylinder Register
              </span>
            </div>

            {/* Compact Staff Pill */}
            <span className="inline-flex items-center gap-1 bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[11px] font-bold px-2 py-0.5 rounded-full shrink-0">
              <Sparkles size={11} className="text-amber-400" />
              <span>{staffUserName}</span>
            </span>
          </div>
        </div>

        {/* Right: Rate Badge + Quick Action Menu */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Prominent Tap-to-Edit Rate Badge */}
          <button
            onClick={() => {
              setTempRate(cylinderRate);
              setIsRateModalOpen(true);
            }}
            className="bg-slate-900/90 hover:bg-slate-850 active:scale-95 border border-amber-500/40 hover:border-amber-400/70 text-slate-200 px-2.5 sm:px-3 py-1.5 rounded-xl flex items-center gap-1.5 transition-all text-xs font-bold shadow-md shadow-amber-950/20"
            title="Tap to change cylinder selling rate"
          >
            <Flame size={14} className="text-amber-400 fill-amber-400" />
            <span className="text-amber-300 font-black tabular-nums tracking-tight">
              ₹{cylinderRate}
            </span>
            <span className="text-[10px] text-slate-400 hidden sm:inline">/ cyl</span>
            <Edit3 size={11} className="text-slate-400 ml-0.5" />
          </button>

          {/* Quick Action 3-Dots Menu */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="w-10 h-10 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 flex items-center justify-center text-slate-300 hover:text-white transition-all active:scale-95"
              title="More Actions"
            >
              <MoreVertical size={18} />
            </button>

            {/* Menu Popover */}
            {isMenuOpen && (
              <div className="absolute right-0 top-12 w-56 bg-slate-900 border border-slate-750 rounded-2xl shadow-2xl p-1.5 z-50 animate-in fade-in zoom-in-95 duration-100">
                <button
                  onClick={() => {
                    setIsMenuOpen(false);
                    handleShareDailyWhatsApp();
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs font-bold text-slate-200 hover:text-white hover:bg-emerald-500/20 rounded-xl transition-colors text-left"
                >
                  <Share2 size={15} className="text-emerald-400" />
                  <span>WhatsApp Day Report</span>
                </button>

                <button
                  onClick={() => {
                    setIsMenuOpen(false);
                    handleExportExcel();
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs font-bold text-slate-200 hover:text-white hover:bg-slate-800 rounded-xl transition-colors text-left"
                >
                  <FileSpreadsheet size={15} className="text-emerald-400" />
                  <span>Download Excel (.xlsx)</span>
                </button>

                <button
                  onClick={() => {
                    setIsMenuOpen(false);
                    fetchSettlements(selectedDate);
                    toast.success('Syncing with database...');
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs font-bold text-slate-200 hover:text-white hover:bg-slate-800 rounded-xl transition-colors text-left"
                >
                  <RefreshCw size={15} className="text-cyan-400" />
                  <span>Refresh & Re-sync</span>
                </button>

                <button
                  onClick={() => {
                    setIsMenuOpen(false);
                    setTempRate(cylinderRate);
                    setIsRateModalOpen(true);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs font-bold text-slate-200 hover:text-white hover:bg-slate-800 rounded-xl transition-colors text-left"
                >
                  <SlidersHorizontal size={15} className="text-amber-400" />
                  <span>Adjust Cylinder Price</span>
                </button>

                <div className="my-1 border-t border-slate-800"></div>

                <button
                  onClick={() => {
                    setIsMenuOpen(false);
                    handleLogout();
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs font-bold text-rose-400 hover:bg-rose-500/10 rounded-xl transition-colors text-left"
                >
                  <LogOut size={15} />
                  <span>Logout</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* 2. ERGONOMIC DATE NAVIGATOR STRIP */}
      <section className="bg-slate-900/60 border-b border-slate-800/80 px-3.5 sm:px-5 py-2.5">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2.5">
          {/* Stepper Navigator */}
          <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-start">
            <button
              onClick={() => changeDateBy(-1)}
              className="w-10 h-10 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 flex items-center justify-center transition-all active:scale-95 shrink-0"
              title="Previous Day"
            >
              <ChevronLeft size={18} />
            </button>

            {/* Date Pill with Integrated Picker */}
            <label className="flex items-center gap-2 bg-slate-900 border border-slate-800 hover:border-slate-700 px-3.5 py-2 rounded-xl text-xs font-bold text-slate-100 cursor-pointer shadow-inner transition-colors flex-1 sm:flex-none justify-center">
              <Calendar size={15} className="text-amber-400 shrink-0" />
              <span className="tabular-nums tracking-wide">{formattedDisplayDate}</span>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="sr-only"
              />
            </label>

            <button
              onClick={() => changeDateBy(1)}
              className="w-10 h-10 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 flex items-center justify-center transition-all active:scale-95 shrink-0"
              title="Next Day"
            >
              <ChevronRight size={18} />
            </button>

            {/* "Today" snap chip */}
            {selectedDate !== todayIso && (
              <button
                onClick={() => setSelectedDate(todayIso)}
                className="bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 font-bold text-xs px-2.5 py-2 rounded-xl transition-all active:scale-95 shrink-0"
              >
                Today
              </button>
            )}
          </div>

          {/* Mini Summary Subtext */}
          <div className="text-[11px] sm:text-xs text-slate-400 font-medium flex items-center gap-2 truncate">
            <span className="text-slate-200 font-bold tabular-nums">
              {dailyKpis.boyCount} {dailyKpis.boyCount === 1 ? 'Boy' : 'Boys'} Settled
            </span>
            <span className="text-slate-600">•</span>
            <span className="text-amber-400 font-black tabular-nums">
              {dailyKpis.totalSupplied} Cylinders
            </span>
            <span className="text-slate-600 hidden md:inline">•</span>
            <span className="text-emerald-400 font-black tabular-nums hidden md:inline">
              ₹{dailyKpis.totalNetRevenue.toLocaleString('en-IN')} Total
            </span>
          </div>
        </div>
      </section>

      {/* MAIN CONTAINER */}
      <main className="max-w-7xl w-full mx-auto p-3.5 sm:p-5 md:p-6 space-y-4 sm:space-y-5 flex-1 pb-28 md:pb-8">

        {/* 3. GODOWN BALANCE DECK (GLANCEABLE 2-TIER CARDS) */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-3 sm:gap-4">
          
          {/* DECK A: Physical Cylinder Inventory (Godown Stock) (5 Cols on Large) */}
          <div className="lg:col-span-5 bg-gradient-to-br from-slate-900 via-slate-900/90 to-slate-950 border border-slate-800 rounded-2xl p-4 shadow-xl flex flex-col justify-between">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                  <Flame size={15} className="text-amber-400" />
                </div>
                <span className="text-xs font-black uppercase tracking-wider text-slate-300">
                  Godown Inventory Stock
                </span>
              </div>
              <span className="text-[10px] text-slate-400 font-mono">14.2 KG</span>
            </div>

            {/* Horizontal Dual-Split Pill Card */}
            <div className="grid grid-cols-2 gap-2.5 bg-slate-950/70 border border-slate-800/80 rounded-xl p-2.5 mb-3">
              {/* Filled Load Taken */}
              <div className="flex flex-col">
                <span className="text-[10px] font-bold text-amber-400/90 uppercase tracking-wide flex items-center gap-1">
                  <Truck size={11} /> Filled Load
                </span>
                <div className="flex items-baseline gap-1 mt-0.5">
                  <span className="text-2xl font-black text-amber-400 tabular-nums">
                    {dailyKpis.totalSupplied}
                  </span>
                  <span className="text-[10px] text-slate-400 font-bold">Cyl</span>
                </div>
              </div>

              {/* Empties Returned */}
              <div className="flex flex-col border-l border-slate-800 pl-3">
                <span className="text-[10px] font-bold text-emerald-400/90 uppercase tracking-wide flex items-center gap-1">
                  <RotateCcw size={11} /> Empties In
                </span>
                <div className="flex items-baseline gap-1 mt-0.5">
                  <span className="text-2xl font-black text-emerald-400 tabular-nums">
                    {dailyKpis.totalEmpties}
                  </span>
                  <span className="text-[10px] text-slate-400 font-bold">Cyl</span>
                </div>
              </div>
            </div>

            {/* Godown Difference Status Badge */}
            <div className="flex items-center justify-between pt-1 text-xs">
              <span className="text-[11px] text-slate-400 font-semibold">Godown Empty Balance:</span>
              {dailyKpis.godownEmptyDiff === 0 ? (
                <span className="inline-flex items-center gap-1 bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-bold text-[11px] px-2.5 py-1 rounded-full">
                  <CheckCircle2 size={13} className="text-emerald-400" />
                  100% Balanced ({dailyKpis.totalEmpties}/{dailyKpis.totalSupplied})
                </span>
              ) : dailyKpis.godownEmptyDiff < 0 ? (
                <span className="inline-flex items-center gap-1 bg-rose-500/15 border border-rose-500/30 text-rose-300 font-black text-[11px] px-2.5 py-1 rounded-full animate-pulse">
                  <AlertTriangle size={13} className="text-rose-400" />
                  {Math.abs(dailyKpis.godownEmptyDiff)} Empties Pending
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 font-bold text-[11px] px-2.5 py-1 rounded-full">
                  <CheckCircle2 size={13} className="text-cyan-400" />
                  +{dailyKpis.godownEmptyDiff} Surplus Empties
                </span>
              )}
            </div>
          </div>

          {/* DECK B: Payment Stream Breakdown (Money Matrix) (7 Cols on Large) */}
          <div className="lg:col-span-7 bg-gradient-to-br from-slate-900 via-slate-900/90 to-slate-950 border border-slate-800 rounded-2xl p-4 shadow-xl flex flex-col justify-between">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                  <Banknote size={15} className="text-emerald-400" />
                </div>
                <span className="text-xs font-black uppercase tracking-wider text-slate-300">
                  Payment Stream Matrix
                </span>
              </div>
              <span className="text-[10px] text-slate-400 font-mono">
                Total ₹{dailyKpis.totalNetRevenue.toLocaleString('en-IN')}
              </span>
            </div>

            {/* 3-Column Financial Ribbon */}
            <div className="grid grid-cols-3 gap-2 sm:gap-3 bg-slate-950/70 border border-slate-800/80 rounded-xl p-2.5 mb-3">
              {/* 1. Cash */}
              <div className="flex flex-col">
                <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wide flex items-center gap-1 truncate">
                  <Banknote size={11} /> Cash
                </span>
                <span className="text-sm sm:text-lg font-black text-emerald-400 tabular-nums mt-0.5 truncate">
                  ₹{dailyKpis.totalCashExpected.toLocaleString('en-IN')}
                </span>
                <span className="text-[10px] text-slate-400 font-semibold tabular-nums">
                  {dailyKpis.totalCashQty} cyl
                </span>
              </div>

              {/* 2. BPCL Online */}
              <div className="flex flex-col border-l border-slate-800 pl-2 sm:pl-3">
                <span className="text-[10px] font-bold text-cyan-400 uppercase tracking-wide flex items-center gap-1 truncate">
                  <Globe size={11} /> BPCL Paid
                </span>
                <span className="text-sm sm:text-lg font-black text-cyan-400 tabular-nums mt-0.5 truncate">
                  ₹{dailyKpis.totalOnlineAmount.toLocaleString('en-IN')}
                </span>
                <span className="text-[10px] text-slate-400 font-semibold tabular-nums">
                  {dailyKpis.totalOnlineQty} cyl
                </span>
              </div>

              {/* 3. UPI / QR */}
              <div className="flex flex-col border-l border-slate-800 pl-2 sm:pl-3">
                <span className="text-[10px] font-bold text-purple-400 uppercase tracking-wide flex items-center gap-1 truncate">
                  <QrCode size={11} /> UPI / QR
                </span>
                <span className="text-sm sm:text-lg font-black text-purple-400 tabular-nums mt-0.5 truncate">
                  ₹{dailyKpis.totalUpiAmount.toLocaleString('en-IN')}
                </span>
                <span className="text-[10px] text-slate-400 font-semibold tabular-nums">
                  {dailyKpis.totalUpiQty} cyl
                </span>
              </div>
            </div>

            {/* Net Cash Handover Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-slate-400 text-[11px] font-semibold">Handed:</span>
                <span className="font-black text-white tabular-nums">
                  ₹{dailyKpis.totalCashReceived.toLocaleString('en-IN')}
                </span>
                <span className="text-slate-500 text-[10px]">(Exp: ₹{dailyKpis.totalCashExpected.toLocaleString('en-IN')})</span>
              </div>

              {dailyKpis.netCashDifference === 0 ? (
                <span className="inline-flex items-center gap-1 bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-bold text-[11px] px-2.5 py-1 rounded-full">
                  <CheckCircle2 size={13} className="text-emerald-400" />
                  Cash 100% Balanced
                </span>
              ) : dailyKpis.netCashDifference < 0 ? (
                <span className="inline-flex items-center gap-1 bg-rose-500/15 border border-rose-500/30 text-rose-300 font-black text-[11px] px-2.5 py-1 rounded-full animate-pulse">
                  <AlertTriangle size={13} className="text-rose-400" />
                  Shortage: -₹{Math.abs(dailyKpis.netCashDifference).toLocaleString('en-IN')}
                  {dailyKpis.firstShortageBoy && ` (${dailyKpis.firstShortageBoy})`}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 bg-amber-500/15 border border-amber-500/30 text-amber-300 font-bold text-[11px] px-2.5 py-1 rounded-full">
                  <AlertCircle size={13} className="text-amber-400" />
                  Excess: +₹{dailyKpis.netCashDifference.toLocaleString('en-IN')}
                </span>
              )}
            </div>
          </div>
        </section>

        {/* 4. DELIVERY BOY SETTLEMENT SECTION */}
        <section className="space-y-3">
          
          {/* Search, Filter Tabs & Desktop CTA */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3 sm:p-4 flex flex-col md:flex-row items-center justify-between gap-3 shadow-lg">
            
            {/* Search Input */}
            <div className="relative w-full md:w-72">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search delivery boy (e.g. Ramesh)..."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-8 py-2 text-xs font-semibold text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-500/80 transition-colors"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 p-1"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Filter Chips & Desktop Add Button */}
            <div className="flex items-center justify-between w-full md:w-auto gap-2">
              {/* Filter Chips */}
              <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs font-bold">
                <button
                  onClick={() => setStatusFilter('ALL')}
                  className={`px-3 py-1.5 rounded-lg transition-all ${
                    statusFilter === 'ALL'
                      ? 'bg-slate-800 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  All ({settlements.length})
                </button>
                <button
                  onClick={() => setStatusFilter('BALANCED')}
                  className={`px-3 py-1.5 rounded-lg transition-all ${
                    statusFilter === 'BALANCED'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : 'text-slate-400 hover:text-emerald-400'
                  }`}
                >
                  Balanced
                </button>
                <button
                  onClick={() => setStatusFilter('SHORTAGE')}
                  className={`px-3 py-1.5 rounded-lg transition-all ${
                    statusFilter === 'SHORTAGE'
                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                      : 'text-slate-400 hover:text-rose-400'
                  }`}
                >
                  Shortage
                </button>
              </div>

              {/* Desktop Add Settlement Button (Hidden on Mobile, handled by Thumb Bar) */}
              <button
                onClick={() => handleOpenNewForm()}
                className="hidden md:flex items-center gap-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 active:scale-95 text-slate-950 font-black text-xs px-4 py-2.5 rounded-xl transition-all shadow-lg shadow-amber-500/20"
              >
                <Plus size={16} />
                <span>Add Delivery Boy</span>
              </button>
            </div>
          </div>

          {/* LOADING STATE */}
          {isLoadingSettlements ? (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl py-16 text-center text-slate-400 shadow-xl">
              <RefreshCw className="animate-spin mx-auto mb-3 text-amber-500" size={32} />
              <p className="text-xs font-bold">Loading settlements for {formattedDisplayDate}...</p>
            </div>
          ) : settlements.length === 0 ? (
            /* EMPTY STATE */
            <div className="bg-slate-900 border border-slate-800 rounded-2xl py-16 px-4 text-center shadow-xl">
              <div className="w-16 h-16 rounded-3xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-3 text-amber-400">
                <Truck size={32} />
              </div>
              <h3 className="text-base font-bold text-white mb-1">
                No Delivery Settlements for this date
              </h3>
              <p className="text-xs text-slate-400 max-w-sm mx-auto mb-5">
                Record morning loads and settle delivery boys in 15 seconds as they return to the godown.
              </p>
              <button
                onClick={() => handleOpenNewForm()}
                className="bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 active:scale-95 text-slate-950 font-black text-xs sm:text-sm px-5 py-3 rounded-xl inline-flex items-center gap-2 shadow-xl shadow-amber-500/20"
              >
                <Plus size={18} /> Record First Delivery Boy
              </button>
            </div>
          ) : filteredSettlements.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl py-12 text-center text-slate-400">
              <Search size={28} className="mx-auto mb-2 text-slate-500" />
              <p className="text-xs font-bold">No settlements match your current filter.</p>
              <button
                onClick={() => {
                  setSearchQuery('');
                  setStatusFilter('ALL');
                }}
                className="mt-3 text-xs text-amber-400 underline font-bold"
              >
                Reset filters
              </button>
            </div>
          ) : (
            <>
              {/* MOBILE CARD-FIRST VIEW (< 768px / md:hidden) */}
              <div className="md:hidden space-y-3">
                {filteredSettlements.map((item) => {
                  const isExpanded = expandedCards[item.id] || false;
                  const matchedAgent = agents.find((a) => a.id === item.agent_id);
                  const isBalanced = item.cash_difference === 0 && item.status === 'BALANCED';
                  const isShortage = item.cash_difference < 0 || item.status === 'SHORTAGE';
                  const emptyMismatch = item.empty_cylinders < (item.supplied_cylinders - item.returned_full_cylinders);

                  return (
                    <div
                      key={item.id}
                      className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl transition-all"
                    >
                      {/* Card Header: Name + Username/Phone + Status Pill */}
                      <div className="p-3.5 border-b border-slate-800/80 flex items-center justify-between gap-2 bg-slate-900/60">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-8 h-8 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center font-black text-amber-400 text-xs shrink-0">
                            {item.agent_name.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <h4 className="text-sm font-black text-white truncate">
                              {item.agent_name}
                            </h4>
                            <span className="text-[10px] text-slate-400 font-mono block truncate">
                              @{matchedAgent?.username || 'agent'}
                              {matchedAgent?.phone ? ` • ${matchedAgent.phone}` : ''}
                            </span>
                          </div>
                        </div>

                        {/* Status Pill */}
                        <div className="shrink-0">
                          {isBalanced ? (
                            <span className="inline-flex items-center gap-1 bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-bold text-[10px] px-2.5 py-1 rounded-full">
                              <CheckCircle2 size={11} className="text-emerald-400" /> Balanced
                            </span>
                          ) : isShortage ? (
                            <span className="inline-flex items-center gap-1 bg-rose-500/15 border border-rose-500/30 text-rose-300 font-black text-[10px] px-2.5 py-1 rounded-full">
                              <AlertTriangle size={11} className="text-rose-400" />
                              {item.cash_difference < 0
                                ? `-₹${Math.abs(item.cash_difference)}`
                                : 'Pending'}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 bg-amber-500/15 border border-amber-500/30 text-amber-300 font-bold text-[10px] px-2.5 py-1 rounded-full">
                              +₹{item.cash_difference}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Core 2x2 Grid */}
                      <div className="p-3.5 space-y-3">
                        <div className="grid grid-cols-2 gap-2.5">
                          {/* Load Supplied */}
                          <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-2.5">
                            <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wide flex items-center gap-1">
                              <Flame size={11} /> Load Supplied
                            </span>
                            <div className="text-xl font-black text-white tabular-nums mt-0.5">
                              {item.supplied_cylinders} <span className="text-[10px] text-slate-400 font-bold">Cyl</span>
                            </div>
                          </div>

                          {/* Empties Returned */}
                          <div className={`border rounded-xl p-2.5 ${
                            emptyMismatch
                              ? 'bg-rose-950/30 border-rose-800/50'
                              : 'bg-slate-950/70 border-slate-800/80'
                          }`}>
                            <span className={`text-[10px] font-bold uppercase tracking-wide flex items-center gap-1 ${
                              emptyMismatch ? 'text-rose-400' : 'text-emerald-400'
                            }`}>
                              <RotateCcw size={11} /> Empties In
                            </span>
                            <div className={`text-xl font-black tabular-nums mt-0.5 ${
                              emptyMismatch ? 'text-rose-300' : 'text-emerald-400'
                            }`}>
                              {item.empty_cylinders} <span className="text-[10px] text-slate-400 font-bold">Cyl</span>
                            </div>
                          </div>
                        </div>

                        {/* Payment Split Ribbon */}
                        <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-2.5 flex items-center justify-between text-xs">
                          <div className="flex items-center gap-1 text-emerald-400 font-bold">
                            <Banknote size={13} />
                            <span>{item.cash_cylinders} Cash</span>
                          </div>
                          <span className="text-slate-700">•</span>
                          <div className="flex items-center gap-1 text-cyan-400 font-bold">
                            <Globe size={13} />
                            <span>{item.online_cylinders} BPCL</span>
                          </div>
                          <span className="text-slate-700">•</span>
                          <div className="flex items-center gap-1 text-purple-400 font-bold">
                            <QrCode size={13} />
                            <span>{item.upi_cylinders} UPI</span>
                          </div>
                        </div>

                        {/* Cash Collected Comparison */}
                        <div className="flex items-center justify-between bg-slate-850 px-3 py-2 rounded-xl text-xs">
                          <span className="text-slate-400 text-[11px] font-semibold">
                            Exp: ₹{item.expected_cash.toLocaleString('en-IN')}
                          </span>
                          <div className="flex items-center gap-1.5 font-bold">
                            <span className="text-slate-400 text-[11px]">Handed:</span>
                            <span className="text-emerald-400 font-black tabular-nums text-sm">
                              ₹{item.actual_cash.toLocaleString('en-IN')}
                            </span>
                          </div>
                        </div>

                        {/* Expandable Breakdown Drawer */}
                        {isExpanded && (
                          <div className="pt-2 border-t border-slate-800/80 space-y-2 text-xs text-slate-300">
                            <div className="grid grid-cols-2 gap-2 text-[11px] bg-slate-950/80 p-2.5 rounded-xl border border-slate-800">
                              <div>
                                <span className="text-slate-500">Due / Credit Cylinders:</span>
                                <div className="font-bold text-white">{item.due_cylinders || 0} Cyl</div>
                              </div>
                              <div>
                                <span className="text-slate-500">Defective / Full Returned:</span>
                                <div className="font-bold text-white">{item.returned_full_cylinders || 0} Cyl</div>
                              </div>
                            </div>

                            {item.notes && (
                              <div className="bg-slate-950/80 p-2.5 rounded-xl border border-slate-800 text-[11px]">
                                <span className="text-slate-500 font-semibold block mb-0.5">Staff Remarks:</span>
                                <p className="text-slate-200">{item.notes}</p>
                              </div>
                            )}

                            {/* Exact Math String */}
                            <div className="text-[10px] text-slate-500 font-mono">
                              Sales Value: ({item.cash_cylinders} Cash + {item.online_cylinders} Online + {item.upi_cylinders} UPI) × ₹{item.cylinder_price} = ₹{item.total_amount.toLocaleString('en-IN')}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Card Footer Actions */}
                      <div className="px-3.5 py-2.5 bg-slate-950/50 border-t border-slate-800 flex items-center justify-between gap-2">
                        {/* Toggle Expand */}
                        <button
                          onClick={() => toggleCardExpand(item.id)}
                          className="text-[11px] font-bold text-slate-400 hover:text-slate-200 flex items-center gap-1 py-1"
                        >
                          {isExpanded ? (
                            <>Less Details <ChevronUp size={13} /></>
                          ) : (
                            <>Full Breakdown <ChevronDown size={13} /></>
                          )}
                        </button>

                        {/* Action Buttons: WhatsApp, Edit, Delete */}
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => handleShareIndividualWhatsApp(item)}
                            className="bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 p-2 rounded-xl transition-all active:scale-95"
                            title="Send WhatsApp Receipt to Delivery Boy"
                          >
                            <MessageCircle size={15} />
                          </button>

                          <button
                            onClick={() => handleEdit(item)}
                            className="bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white p-2 rounded-xl border border-slate-700 transition-all active:scale-95"
                            title="Edit Settlement"
                          >
                            <Edit3 size={15} />
                          </button>

                          <button
                            onClick={() => handleDelete(item.id, item.agent_name)}
                            className="bg-slate-800 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 p-2 rounded-xl border border-slate-700 transition-all active:scale-95"
                            title="Delete Settlement"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* DESKTOP TABLE VIEW (≥ 768px / hidden md:block) */}
              <div className="hidden md:block bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-slate-300">
                    <thead className="bg-slate-950 text-slate-400 font-bold uppercase tracking-wider text-[10px] border-b border-slate-800">
                      <tr>
                        <th className="py-3.5 px-4">Delivery Boy</th>
                        <th className="py-3.5 px-3 text-center">Load</th>
                        <th className="py-3.5 px-3 text-center">Cash Deliveries</th>
                        <th className="py-3.5 px-3 text-center">BPCL Online</th>
                        <th className="py-3.5 px-3 text-center">UPI / QR</th>
                        <th className="py-3.5 px-3 text-center">Empties</th>
                        <th className="py-3.5 px-4 text-right">Physical Handover</th>
                        <th className="py-3.5 px-3 text-center">Status</th>
                        <th className="py-3.5 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70 font-medium">
                      {filteredSettlements.map((item) => {
                        const isBalanced = item.cash_difference === 0 && item.status === 'BALANCED';
                        const isShortage = item.cash_difference < 0 || item.status === 'SHORTAGE';
                        const emptyMismatch = item.empty_cylinders < (item.supplied_cylinders - item.returned_full_cylinders);

                        return (
                          <tr key={item.id} className="hover:bg-slate-850/60 transition-colors">
                            {/* Delivery Boy */}
                            <td className="py-3 px-4">
                              <div className="font-black text-white text-sm">{item.agent_name}</div>
                              {item.notes && (
                                <div className="text-[10px] text-slate-400 truncate max-w-xs">{item.notes}</div>
                              )}
                            </td>

                            {/* Load */}
                            <td className="py-3 px-3 text-center">
                              <span className="font-mono font-black text-sm text-amber-400">
                                {item.supplied_cylinders}
                              </span>
                            </td>

                            {/* Cash */}
                            <td className="py-3 px-3 text-center">
                              <div className="font-bold text-emerald-400">
                                {item.cash_cylinders} <span className="text-[10px] text-slate-500">cyl</span>
                              </div>
                              <div className="text-[10px] text-slate-400 font-mono">
                                ₹{item.expected_cash.toLocaleString('en-IN')}
                              </div>
                            </td>

                            {/* Online */}
                            <td className="py-3 px-3 text-center">
                              <div className="font-bold text-cyan-400">
                                {item.online_cylinders} <span className="text-[10px] text-slate-500">cyl</span>
                              </div>
                              <div className="text-[10px] text-slate-400 font-mono">
                                ₹{item.online_amount.toLocaleString('en-IN')}
                              </div>
                            </td>

                            {/* UPI */}
                            <td className="py-3 px-3 text-center">
                              <div className="font-bold text-purple-400">
                                {item.upi_cylinders} <span className="text-[10px] text-slate-500">cyl</span>
                              </div>
                              <div className="text-[10px] text-slate-400 font-mono">
                                ₹{item.upi_amount.toLocaleString('en-IN')}
                              </div>
                            </td>

                            {/* Empties */}
                            <td className="py-3 px-3 text-center">
                              <span className={`font-mono font-black text-sm ${
                                emptyMismatch ? 'text-rose-400 underline decoration-rose-500' : 'text-emerald-400'
                              }`}>
                                {item.empty_cylinders}
                              </span>
                            </td>

                            {/* Cash Handover */}
                            <td className="py-3 px-4 text-right">
                              <div className="font-black text-sm text-white">
                                ₹{item.actual_cash.toLocaleString('en-IN')}
                              </div>
                              <div className="text-[10px] text-slate-400">
                                Exp: ₹{item.expected_cash.toLocaleString('en-IN')}
                              </div>
                            </td>

                            {/* Status */}
                            <td className="py-3 px-3 text-center">
                              {isBalanced ? (
                                <span className="inline-flex items-center gap-1 bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-bold text-[10px] px-2.5 py-0.5 rounded-full">
                                  <CheckCircle2 size={11} /> Balanced
                                </span>
                              ) : isShortage ? (
                                <span className="inline-flex items-center gap-1 bg-rose-500/15 text-rose-400 border border-rose-500/30 font-bold text-[10px] px-2.5 py-0.5 rounded-full">
                                  -₹{Math.abs(item.cash_difference)}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 bg-amber-500/15 text-amber-400 border border-amber-500/30 font-bold text-[10px] px-2.5 py-0.5 rounded-full">
                                  +₹{item.cash_difference}
                                </span>
                              )}
                            </td>

                            {/* Actions */}
                            <td className="py-3 px-4 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  onClick={() => handleShareIndividualWhatsApp(item)}
                                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-emerald-600/30 text-emerald-400 border border-slate-700 hover:border-emerald-500/40 transition-colors"
                                  title="WhatsApp Receipt"
                                >
                                  <MessageCircle size={14} />
                                </button>
                                <button
                                  onClick={() => handleEdit(item)}
                                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-colors"
                                  title="Edit"
                                >
                                  <Edit3 size={14} />
                                </button>
                                <button
                                  onClick={() => handleDelete(item.id, item.agent_name)}
                                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 border border-slate-700 transition-colors"
                                  title="Delete"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>

                    {/* Desktop Totals Summary Row */}
                    <tfoot className="bg-slate-950 font-black text-white text-xs border-t-2 border-slate-800">
                      <tr>
                        <td className="py-4 px-4 uppercase tracking-wider text-amber-400">
                          Total Agency Summary
                        </td>
                        <td className="py-4 px-3 text-center text-amber-400 text-sm">
                          {dailyKpis.totalSupplied}
                        </td>
                        <td className="py-4 px-3 text-center text-emerald-400">
                          <div>{dailyKpis.totalCashQty} cyl</div>
                          <div className="text-[10px] text-slate-400 font-mono">
                            ₹{dailyKpis.totalCashExpected.toLocaleString('en-IN')}
                          </div>
                        </td>
                        <td className="py-4 px-3 text-center text-cyan-400">
                          <div>{dailyKpis.totalOnlineQty} cyl</div>
                          <div className="text-[10px] text-slate-400 font-mono">
                            ₹{dailyKpis.totalOnlineAmount.toLocaleString('en-IN')}
                          </div>
                        </td>
                        <td className="py-4 px-3 text-center text-purple-400">
                          <div>{dailyKpis.totalUpiQty} cyl</div>
                          <div className="text-[10px] text-slate-400 font-mono">
                            ₹{dailyKpis.totalUpiAmount.toLocaleString('en-IN')}
                          </div>
                        </td>
                        <td className="py-4 px-3 text-center text-emerald-400 text-sm">
                          {dailyKpis.totalEmpties}
                        </td>
                        <td className="py-4 px-4 text-right">
                          <div className="text-sm font-black text-emerald-400">
                            ₹{dailyKpis.totalCashReceived.toLocaleString('en-IN')}
                          </div>
                          <div className="text-[10px] text-slate-400">
                            Exp: ₹{dailyKpis.totalCashExpected.toLocaleString('en-IN')}
                          </div>
                        </td>
                        <td className="py-4 px-3 text-center">
                          {dailyKpis.netCashDifference === 0 ? (
                            <span className="text-emerald-400 font-bold">✅ Balanced</span>
                          ) : dailyKpis.netCashDifference < 0 ? (
                            <span className="text-rose-400 font-bold">
                              -₹{Math.abs(dailyKpis.netCashDifference).toLocaleString('en-IN')}
                            </span>
                          ) : (
                            <span className="text-amber-400 font-bold">
                              +₹{dailyKpis.netCashDifference.toLocaleString('en-IN')}
                            </span>
                          )}
                        </td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </>
          )}
        </section>
      </main>

      {/* 5. FLOATING THUMB ACTION BAR (MOBILE GODOWN ERGONOMICS) */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-slate-950/95 backdrop-blur-xl border-t border-slate-800 p-3 md:hidden shadow-[0_-8px_30px_rgba(0,0,0,0.6)]">
        <div className="flex items-center gap-2.5 max-w-lg mx-auto">
          {/* Quick WhatsApp Summary Button */}
          <button
            onClick={handleShareDailyWhatsApp}
            className="h-12 w-12 rounded-2xl bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white flex items-center justify-center shrink-0 shadow-lg shadow-emerald-950/40 transition-transform"
            title="Share Godown Summary via WhatsApp"
          >
            <Share2 size={20} />
          </button>

          {/* Primary CTA: + New Settlement */}
          <button
            onClick={() => handleOpenNewForm()}
            className="flex-1 h-12 rounded-2xl bg-gradient-to-r from-amber-500 via-amber-400 to-amber-500 hover:brightness-110 active:scale-98 text-slate-950 font-black text-sm flex items-center justify-center gap-2 shadow-xl shadow-amber-500/25 transition-all"
          >
            <Flame size={20} className="fill-slate-950" />
            <span>+ New Settlement</span>
          </button>
        </div>
      </nav>

      {/* 6. FAST SINGLE-PAGE SETTLEMENT MODAL ("SPEED ENTRY") */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-slate-750 w-full max-w-lg rounded-t-3xl sm:rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[92vh] sm:max-h-[90vh]">
            
            {/* Modal Header */}
            <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/95 sticky top-0 z-10">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center">
                  <Flame size={17} className="text-amber-400 fill-amber-400" />
                </div>
                <div>
                  <h3 className="font-black text-white text-base">
                    {editingId ? 'Edit Settlement' : 'Speed Settlement Entry'}
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    {formattedDisplayDate} • Rate ₹{cylinderRate}/cyl
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsFormOpen(false)}
                className="w-9 h-9 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body / 15-Second Entry Form */}
            <form onSubmit={handleSaveSettlement} className="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1">
              
              {/* Step 1: Select Delivery Boy */}
              <div className="space-y-1.5">
                <label className="block text-xs font-black text-slate-300 uppercase tracking-wider">
                  1. Select Delivery Boy <span className="text-amber-400">*</span>
                </label>
                
                {/* Auto-suggest Chips of Active Agents (Quick 1-Tap Select) */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                  {agents.slice(0, 6).map((agent) => (
                    <button
                      key={agent.id}
                      type="button"
                      onClick={() => setSelectedAgentId(agent.id)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold shrink-0 transition-all border ${
                        selectedAgentId === agent.id
                          ? 'bg-amber-500 text-slate-950 border-amber-400 font-black shadow-md'
                          : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-750'
                      }`}
                    >
                      {agent.name.split(' ')[0]}
                    </button>
                  ))}
                </div>

                {/* Dropdown for All Agents */}
                <select
                  value={selectedAgentId}
                  onChange={(e) => setSelectedAgentId(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white font-bold text-sm focus:border-amber-500 focus:outline-none"
                  required
                >
                  <option value="" disabled>-- Choose Delivery Boy --</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name} {agent.phone ? `(${agent.phone})` : `@${agent.username}`}
                    </option>
                  ))}
                </select>
              </div>

              {/* Step 2: Cylinders Supplied (Load) */}
              <div className="bg-slate-950/60 border border-slate-800 p-3.5 rounded-2xl space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-black text-amber-400 uppercase tracking-wide flex items-center gap-1.5">
                    <Truck size={14} /> 2. Total Cylinders Supplied (Load)
                  </label>
                  <span className="text-[11px] text-slate-400">Morning Count</span>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    value={suppliedCylinders}
                    onChange={(e) => setSuppliedCylinders(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-white font-black text-xl tabular-nums focus:border-amber-500 focus:outline-none"
                    placeholder="40"
                    required
                  />

                  {/* Preset Load Chips */}
                  {[35, 40, 45, 50].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => {
                        setSuppliedCylinders(preset);
                        setEmptyCylinders(preset);
                      }}
                      className={`h-11 px-3 rounded-xl border text-xs font-black transition-all ${
                        suppliedCylinders === preset
                          ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-md'
                          : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>

              {/* Step 3: Payment Modes (Live Real-Time Validator) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-black text-slate-300 uppercase tracking-wider">
                    3. Payment Breakdown (Quantities)
                  </label>
                  
                  {/* Real-Time Live Validation Badge */}
                  <span className={`text-[11px] font-black px-2 py-0.5 rounded-full border ${
                    cylinderDifference === 0
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                      : cylinderDifference > 0
                      ? 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                      : 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                  }`}>
                    {cylinderDifference === 0
                      ? `Entered: ${totalAccountedCylinders}/${numSupplied} ✅`
                      : cylinderDifference > 0
                      ? `Missing ${cylinderDifference} Cyl (${totalAccountedCylinders}/${numSupplied})`
                      : `+${Math.abs(cylinderDifference)} Surplus`}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {/* Cash Cylinders */}
                  <div className="bg-emerald-950/30 border border-emerald-800/40 p-2.5 rounded-2xl">
                    <span className="text-[10px] font-black text-emerald-400 uppercase tracking-wide flex items-center gap-1 mb-1">
                      <Banknote size={11} /> Cash Cyl
                    </span>
                    <input
                      type="number"
                      min="0"
                      value={cashCylinders}
                      onChange={(e) => {
                        const val = e.target.value === '' ? '' : Number(e.target.value);
                        setCashCylinders(val);
                        if (val !== '') {
                          setActualCashInput(val * cylinderRate);
                        }
                      }}
                      className="w-full bg-slate-900 border border-emerald-700/60 rounded-xl px-2.5 py-1.5 text-white font-black text-base tabular-nums focus:outline-none"
                      placeholder="20"
                    />
                    <div className="text-[10px] font-mono font-bold text-emerald-400 mt-1 truncate">
                      ₹{expectedCashAmount.toLocaleString('en-IN')}
                    </div>
                  </div>

                  {/* BPCL Online Cylinders */}
                  <div className="bg-cyan-950/30 border border-cyan-800/40 p-2.5 rounded-2xl">
                    <span className="text-[10px] font-black text-cyan-400 uppercase tracking-wide flex items-center gap-1 mb-1">
                      <Globe size={11} /> BPCL Paid
                    </span>
                    <input
                      type="number"
                      min="0"
                      value={onlineCylinders}
                      onChange={(e) => setOnlineCylinders(e.target.value === '' ? '' : Number(e.target.value))}
                      className="w-full bg-slate-900 border border-cyan-700/60 rounded-xl px-2.5 py-1.5 text-white font-black text-base tabular-nums focus:outline-none"
                      placeholder="10"
                    />
                    <div className="text-[10px] font-mono font-bold text-cyan-400 mt-1 truncate">
                      ₹{onlineAmount.toLocaleString('en-IN')}
                    </div>
                  </div>

                  {/* UPI / QR Cylinders */}
                  <div className="bg-purple-950/30 border border-purple-800/40 p-2.5 rounded-2xl">
                    <span className="text-[10px] font-black text-purple-400 uppercase tracking-wide flex items-center gap-1 mb-1">
                      <QrCode size={11} /> UPI / QR
                    </span>
                    <input
                      type="number"
                      min="0"
                      value={upiCylinders}
                      onChange={(e) => setUpiCylinders(e.target.value === '' ? '' : Number(e.target.value))}
                      className="w-full bg-slate-900 border border-purple-700/60 rounded-xl px-2.5 py-1.5 text-white font-black text-base tabular-nums focus:outline-none"
                      placeholder="10"
                    />
                    <div className="text-[10px] font-mono font-bold text-purple-400 mt-1 truncate">
                      ₹{upiAmount.toLocaleString('en-IN')}
                    </div>
                  </div>
                </div>

                {/* Advanced Disclosure Toggle for Due & Defective */}
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => setShowAdvancedFields(!showAdvancedFields)}
                    className="text-[11px] font-bold text-slate-400 hover:text-slate-200 flex items-center gap-1"
                  >
                    {showAdvancedFields ? (
                      <>Hide Due & Full Returned <ChevronUp size={12} /></>
                    ) : (
                      <>+ Add Due Pending or Full Returned Cylinders <ChevronDown size={12} /></>
                    )}
                  </button>

                  {showAdvancedFields && (
                    <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-slate-800">
                      <div>
                        <label className="text-[10px] font-bold text-slate-400 block mb-1">
                          Due / Credit Cylinders
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={dueCylinders}
                          onChange={(e) => setDueCylinders(e.target.value === '' ? '' : Number(e.target.value))}
                          className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-1.5 text-white font-bold text-sm"
                          placeholder="0"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-400 block mb-1">
                          Full Returned (Defective)
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={returnedFullCylinders}
                          onChange={(e) => setReturnedFullCylinders(e.target.value === '' ? '' : Number(e.target.value))}
                          className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-1.5 text-white font-bold text-sm"
                          placeholder="0"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Step 4: Empties Returned */}
              <div className="bg-slate-950/60 border border-slate-800 p-3.5 rounded-2xl space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-black text-emerald-400 uppercase tracking-wide flex items-center gap-1.5">
                    <RotateCcw size={14} /> 4. Empty Cylinders Returned
                  </label>
                  <button
                    type="button"
                    onClick={() => setEmptyCylinders(expectedEmpties)}
                    className="text-[10px] font-black text-amber-400 hover:text-amber-300 underline"
                  >
                    Match Full ({expectedEmpties})
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    value={emptyCylinders}
                    onChange={(e) => setEmptyCylinders(e.target.value === '' ? '' : Number(e.target.value))}
                    className={`w-full bg-slate-900 border rounded-xl px-3.5 py-2 font-black text-xl tabular-nums focus:outline-none ${
                      emptyDifference < 0
                        ? 'border-rose-500 text-rose-300'
                        : 'border-slate-700 text-white focus:border-emerald-500'
                    }`}
                    placeholder="40"
                    required
                  />

                  <div className="shrink-0 text-xs font-bold text-slate-400">
                    {emptyDifference === 0 ? (
                      <span className="text-emerald-400 font-black">All Empties In ✅</span>
                    ) : emptyDifference < 0 ? (
                      <span className="text-rose-400 font-black">{Math.abs(emptyDifference)} Missing ⚠️</span>
                    ) : (
                      <span className="text-cyan-400 font-black">+{emptyDifference} Extra</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Step 5: Actual Cash Handed Over */}
              <div className="bg-slate-950/90 border border-slate-800 p-3.5 rounded-2xl space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400 font-semibold">5. Physical Cash Handed Over:</span>
                  <span className="font-mono font-black text-emerald-400">
                    Expected: ₹{expectedCashAmount.toLocaleString('en-IN')}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">₹</span>
                    <input
                      type="number"
                      value={actualCashInput}
                      onChange={(e) => setActualCashInput(e.target.value === '' ? '' : Number(e.target.value))}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-7 pr-3 py-2 text-white font-black text-lg tabular-nums focus:border-emerald-500 focus:outline-none"
                      placeholder={String(expectedCashAmount)}
                    />
                  </div>

                  {/* 1-Tap Quick Adjust Chips */}
                  <button
                    type="button"
                    onClick={() => setActualCashInput(expectedCashAmount)}
                    className="h-11 px-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-xs font-bold text-slate-200 shrink-0"
                  >
                    Exact
                  </button>

                  <button
                    type="button"
                    onClick={() => setActualCashInput(Math.max(0, expectedCashAmount - cylinderRate))}
                    className="h-11 px-2.5 bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 rounded-xl text-[11px] font-bold text-rose-300 shrink-0"
                    title="1 Cylinder Short"
                  >
                    -₹{cylinderRate}
                  </button>
                </div>

                {/* Instant Live Cash Difference Indicator */}
                <div className="flex items-center justify-between pt-1 text-xs">
                  <span className="text-slate-400">Cash Discrepancy:</span>
                  {cashDifference === 0 ? (
                    <span className="text-emerald-400 font-black">✅ Exact ₹0 Difference (Balanced)</span>
                  ) : cashDifference < 0 ? (
                    <span className="text-rose-400 font-black">❌ Shortage: -₹{Math.abs(cashDifference).toLocaleString('en-IN')} (Owed)</span>
                  ) : (
                    <span className="text-amber-400 font-black">⚠️ Excess: +₹{cashDifference.toLocaleString('en-IN')}</span>
                  )}
                </div>
              </div>

              {/* Step 6: Notes / Remarks */}
              <div>
                <label className="block text-[11px] font-bold text-slate-400 mb-1">
                  6. Notes / Remarks (Optional)
                </label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. 2 commercial customers paid online, empties verified"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2 text-white text-xs placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
                />
              </div>

              {/* Submit Action Buttons */}
              <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                  className="px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={isSaving}
                  className="flex-1 sm:flex-none px-6 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 active:scale-95 text-slate-950 font-black text-sm flex items-center justify-center gap-2 shadow-xl shadow-amber-500/20 disabled:opacity-50"
                >
                  <Save size={16} />
                  <span>{isSaving ? 'Saving...' : editingId ? 'Update Settlement' : 'Save Settlement'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 7. QUICK RATE ADJUSTMENT MODAL */}
      {isRateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-100">
          <div className="bg-slate-900 border border-slate-750 w-full max-w-sm rounded-3xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Flame size={18} className="text-amber-400 fill-amber-400" />
                <h3 className="font-black text-white text-base">Cylinder Selling Rate</h3>
              </div>
              <button
                onClick={() => setIsRateModalOpen(false)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X size={18} />
              </button>
            </div>

            <p className="text-xs text-slate-400">
              Set the standard agency rate for 14.2kg domestic cylinders. All cash expectations update automatically.
            </p>

            <div className="space-y-2">
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-amber-400 font-black text-lg">₹</span>
                <input
                  type="number"
                  value={tempRate}
                  onChange={(e) => setTempRate(Number(e.target.value) || 0)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-2xl pl-9 pr-4 py-3 text-white font-black text-2xl tabular-nums focus:border-amber-500 focus:outline-none"
                  autoFocus
                />
              </div>

              {/* Rate Presets */}
              <div className="flex items-center gap-2 pt-1">
                {[950, 994, 1000, 1050].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setTempRate(preset)}
                    className={`flex-1 py-1.5 rounded-xl border text-xs font-black transition-all ${
                      tempRate === preset
                        ? 'bg-amber-500 text-slate-950 border-amber-400'
                        : 'bg-slate-800 text-slate-300 border-slate-700'
                    }`}
                  >
                    ₹{preset}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={() => setIsRateModalOpen(false)}
                className="flex-1 py-2.5 rounded-xl bg-slate-800 text-slate-300 font-bold text-xs"
              >
                Cancel
              </button>
              <button
                onClick={() => handleSaveRate(tempRate)}
                className="flex-1 py-2.5 rounded-xl bg-amber-500 text-slate-950 font-black text-xs shadow-lg shadow-amber-500/20 active:scale-95"
              >
                Apply Rate
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
