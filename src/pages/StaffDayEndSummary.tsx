import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import db, { type Consumer } from '../lib/db';
import { supabase } from '../lib/supabase';
import { AgentBottomNav } from '../components/AgentBottomNav';
import { 
  Send, 
  Trash2, 
  Plus, 
  Copy, 
  Check, 
  ClipboardList, 
  Search, 
  FileText,
  Loader2, 
  ChevronRight, 
  MapPin, 
  CheckCheck, 
  XCircle, 
  X, 
  Camera, 
  Users, 
  Save, 
  ChevronDown, 
  ChevronUp,
  Minus,
  RefreshCw,
  ArrowLeft,
  AlertTriangle,
  ShieldAlert,
  RotateCcw,
  CheckCircle2,
  Sparkles,
  Clock,
  Globe,
  Printer
} from 'lucide-react';
import toast from 'react-hot-toast';
import { LiveCameraScannerModal } from '../components/LiveCameraScannerModal';
import { matchConsumerWithDatabase } from '../lib/consumerMatcher';
import { isCurrentStaffOrManager, refreshCurrentStaffPermission } from '../lib/staffAuth';
import { 
  getDayEndDeliveryBoys, 
  fetchAllDayEndReportsForDate, 
  fetchDayEndReportForAgent, 
  saveDayEndReportToDatabase, 
  type DayEndEntry, 
  type DayEndReportSummary 
} from '../lib/dayEndService';
import type { DeliveryBoy } from '../lib/agentService';
import { 
  fetchBpclReport, 
  fetchAllBpclReportsForDate, 
  toggleBillsCheckedDone, 
  type BpclReportData, 
  type BpclBillItem 
} from '../lib/bpclReportService';
import { BpclReportModal } from '../components/BpclReportModal';
import { BpclBillsView } from '../components/BpclBillsView';
import { ExportOnlineBillsModal } from '../components/ExportOnlineBillsModal';

export type ItemEntry = DayEndEntry;

const getWorkingDraftKey = (dateStr: string, agentName: string): string => {
  const norm = (agentName || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '_');
  return `bgcls_day_end_working_draft_${dateStr}_${norm}`;
};

export const StaffDayEndSummary: React.FC = () => {
  const navigate = useNavigate();
  const isStaffOrManager = useMemo(() => isCurrentStaffOrManager(), []);

  // Strict Protection: Non-staff users must not access the delivery boys centralized page!
  useEffect(() => {
    let isMounted = true;
    if (!isCurrentStaffOrManager()) {
      toast.error('Restricted: Staff permission required.');
      navigate('/agent/dispatch', { replace: true });
      return;
    }

    refreshCurrentStaffPermission().then((liveStaff) => {
      if (!isMounted) return;
      if (!liveStaff) {
        toast.error('Restricted: Staff permission required.');
        navigate('/agent/dispatch', { replace: true });
      }
    });

    return () => {
      isMounted = false;
    };
  }, [navigate]);
  
  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      const isManager = localStorage.getItem('bgcls_role') === 'MANAGER';
      navigate(isManager ? '/manager/dashboard' : '/agent/search');
    }
  };
  
  // Date State
  const todayIso = useMemo(() => new Date().toISOString().split('T')[0], []);
  const [reportDate, setReportDate] = useState<string>(todayIso);
  const activeDateRef = useRef<string>(todayIso);

  // Delivery Boys Roster State
  const [deliveryBoys, setDeliveryBoys] = useState<DeliveryBoy[]>([]);
  const [selectedBoy, setSelectedBoy] = useState<DeliveryBoy | null>(null);
  const [isBoyDropdownOpen, setIsBoyDropdownOpen] = useState<boolean>(false);
  const [boySearchQuery, setBoySearchQuery] = useState<string>('');

  // View Mode: 'ROSTER' (All delivery boys overview) vs 'SCAN' (Individual bill scanner for selected boy)
  const [activeTab, setActiveTab] = useState<'ROSTER' | 'SCAN'>('ROSTER');

  // Multi-Agent Roster Cache for selected date
  const [rosterSummaries, setRosterSummaries] = useState<Record<string, DayEndReportSummary>>({});
  const [isLoadingRoster, setIsLoadingRoster] = useState<boolean>(true);

  // Active Delivery Boy's Bills state
  const [entries, setEntries] = useState<ItemEntry[]>([]);
  const [isSavingDb, setIsSavingDb] = useState<boolean>(false);
  const [lastSavedTime, setLastSavedTime] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState<boolean>(false);

  // BPCL AI Status Report & "Bills Checked Done" state
  const [bpclReportsMap, setBpclReportsMap] = useState<Record<string, BpclReportData>>({});
  const [activeBpclReport, setActiveBpclReport] = useState<BpclReportData | null>(null);
  const [isBpclModalOpen, setIsBpclModalOpen] = useState<boolean>(false);
  const [isExportOnlineModalOpen, setIsExportOnlineModalOpen] = useState<boolean>(false);

  // Total online bills count across all delivery boys for this date
  const totalRosterOnlineCount = useMemo(() => {
    return Object.values(bpclReportsMap).reduce((acc, rep) => {
      return acc + (rep?.online_bills?.length || 0);
    }, 0);
  }, [bpclReportsMap]);

  // Floating Action Dock Minimized state
  const [isFloatingDockMinimized, setIsFloatingDockMinimized] = useState<boolean>(false);

  // Serial Number (#1..#17) for active selected delivery boy
  const selectedBoyIndex = useMemo(() => {
    if (!selectedBoy) return null;
    const idx = deliveryBoys.findIndex((b) => b.name === selectedBoy.name || b.id === selectedBoy.id);
    return idx !== -1 ? idx + 1 : null;
  }, [selectedBoy, deliveryBoys]);

  // Synchronous State Refs for Lifecycle Flush (survives app switching & tab kill)
  const entriesRef = useRef<ItemEntry[]>(entries);
  entriesRef.current = entries;
  const selectedBoyRef = useRef<DeliveryBoy | null>(selectedBoy);
  selectedBoyRef.current = selectedBoy;
  const reportDateRef = useRef<string>(reportDate);
  reportDateRef.current = reportDate;
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeBoyIdentityRef = useRef<string | null>(selectedBoy ? selectedBoy.name.trim().toUpperCase() : null);

  // Anti-Fraud / Double-Bill Scam Detection:
  // Map of consumer_number -> { agentName, date, consumerName } for all bills already submitted by OTHER delivery boys
  const crossAgentClaimedMap = useMemo(() => {
    const map: Record<string, { agentName: string; date: string; consumerName?: string }> = {};
    if (!rosterSummaries) return map;

    const currentAgentName = selectedBoy ? selectedBoy.name.trim().toUpperCase() : '';
    const currentAgentId = selectedBoy ? selectedBoy.id : '';

    Object.values(rosterSummaries).forEach((report) => {
      const reportAgentName = (report.agent_name || '').trim().toUpperCase();
      const reportAgentId = report.agent_id || '';

      // Skip current active delivery boy so we don't flag self
      if (reportAgentName === currentAgentName || (currentAgentId && reportAgentId === currentAgentId)) {
        return;
      }

      if (Array.isArray(report.entries)) {
        report.entries.forEach((entry) => {
          if (entry.consumer_number) {
            const clean = entry.consumer_number.trim().toLowerCase();
            map[clean] = {
              agentName: report.agent_name,
              date: report.report_date,
              consumerName: entry.consumer_name,
            };
          }
        });
      }
    });

    return map;
  }, [rosterSummaries, selectedBoy]);

  // Count how many bills in the current list are double-bills from other delivery boys
  const duplicateScamCount = useMemo(() => {
    return entries.filter((e) => {
      const claimant = e.duplicate_of_agent 
        ? { agentName: e.duplicate_of_agent }
        : crossAgentClaimedMap[e.consumer_number.toLowerCase()];
      return !!claimant;
    }).length;
  }, [entries, crossAgentClaimedMap]);

  // Global duplicate scam map across ALL delivery boys for the active date
  // consumer_number -> list of { agentName: string, reportDate: string, scannedAt?: string, duplicateOfAgent?: string, reportUpdatedAt?: string }
  const globalDuplicateBillsMap = useMemo(() => {
    const billOccurrences: Record<
      string,
      { agentName: string; reportDate: string; scannedAt?: string; duplicateOfAgent?: string; reportUpdatedAt?: string }[]
    > = {};

    Object.values(rosterSummaries).forEach((report) => {
      const agentName = report.agent_name || '';
      if (Array.isArray(report.entries)) {
        report.entries.forEach((entry) => {
          if (entry.consumer_number) {
            const clean = entry.consumer_number.trim().toLowerCase();
            if (!billOccurrences[clean]) {
              billOccurrences[clean] = [];
            }
            if (!billOccurrences[clean].some((o) => o.agentName.trim().toUpperCase() === agentName.trim().toUpperCase())) {
              billOccurrences[clean].push({
                agentName,
                reportDate: report.report_date,
                scannedAt: entry.scanned_at,
                duplicateOfAgent: entry.duplicate_of_agent,
                reportUpdatedAt: report.updated_at,
              });
            }
          }
        });
      }
    });

    return billOccurrences;
  }, [rosterSummaries]);

  // Compute duplicate scam statistics per delivery boy for the roster view
  // Correctly attributes scam count ONLY to the secondary / duplicate submitters (not the original legitimate boy)
  const boyScamStats = useMemo(() => {
    const stats: Record<string, { scamCount: number; duplicateWith: string[] }> = {};

    deliveryBoys.forEach((boy) => {
      const normName = boy.name.trim().toUpperCase();
      const summary = rosterSummaries[normName];
      let count = 0;
      const dupWithSet = new Set<string>();

      if (summary && Array.isArray(summary.entries)) {
        summary.entries.forEach((entry) => {
          const clean = (entry.consumer_number || '').trim().toLowerCase();
          const occurrences = globalDuplicateBillsMap[clean] || [];
          const otherOccurrences = occurrences.filter(
            (o) => o.agentName.trim().toUpperCase() !== normName
          );

          if (otherOccurrences.length > 0 || entry.duplicate_of_agent) {
            // 1. If entry explicitly has duplicate_of_agent, this entry is definitely a scam duplicate!
            if (entry.duplicate_of_agent) {
              count++;
              dupWithSet.add(entry.duplicate_of_agent);
              return;
            }

            // 2. If another delivery boy explicitly marked this bill as duplicate of THIS boy,
            // then THIS boy is the original legitimate submitter!
            const isVictimOfDuplicate = otherOccurrences.some(
              (o) => o.duplicateOfAgent && o.duplicateOfAgent.trim().toUpperCase() === normName
            );
            if (isVictimOfDuplicate) {
              return;
            }

            // 3. Fallback: Check who submitted it first chronologically
            const sorted = [...occurrences].sort((a, b) => {
              const tA = a.scannedAt ? new Date(a.scannedAt).getTime() : (a.reportUpdatedAt ? new Date(a.reportUpdatedAt).getTime() : 0);
              const tB = b.scannedAt ? new Date(b.scannedAt).getTime() : (b.reportUpdatedAt ? new Date(b.reportUpdatedAt).getTime() : 0);
              return tA - tB;
            });

            // The earliest occurrence is the original submitter!
            const original = sorted[0];
            if (original && original.agentName.trim().toUpperCase() !== normName) {
              // This boy is NOT the original submitter, so this is a duplicate scam submission!
              count++;
              dupWithSet.add(original.agentName);
            }
          }
        });
      }

      stats[normName] = {
        scamCount: count,
        duplicateWith: Array.from(dupWithSet),
      };
    });

    return stats;
  }, [deliveryBoys, rosterSummaries, globalDuplicateBillsMap]);

  // Total scam bills detected across all delivery boys on this date
  const totalRosterScamsCount = useMemo(() => {
    return Object.values(boyScamStats).reduce((acc, curr) => acc + curr.scamCount, 0);
  }, [boyScamStats]);

  // Input states
  const [rawInput, setRawInput] = useState<string>('');
  const [singleInput, setSingleInput] = useState<string>('');
  const [inputMode, setInputMode] = useState<'single' | 'bulk'>('single');
  const [isLiveScannerOpen, setIsLiveScannerOpen] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  // In-List Search & Filter
  const [listSearchQuery, setListSearchQuery] = useState<string>('');
  const [listFilterTab, setListFilterTab] = useState<'ALL' | 'UNVERIFIED'>('ALL');

  // Search auto-complete
  const [suggestions, setSuggestions] = useState<Consumer[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [showSuggestions, setShowSuggestions] = useState<boolean>(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  // Supervisor Contact (Optional WhatsApp share)
  const [supervisorPhone] = useState<string>(() => localStorage.getItem('bgcls_supervisor_phone') || '917337487571');
  const [copiedCsv, setCopiedCsv] = useState<boolean>(false);

  // 1. Initial Load: Fetch Delivery Boys and Managers
  useEffect(() => {
    const initialize = async () => {
      try {
        const boys = await getDayEndDeliveryBoys();
        setDeliveryBoys(boys);

        // Determine initially selected delivery boy
        const currentAgentId = localStorage.getItem('bgcls_agent_id');
        const currentAgentName = localStorage.getItem('bgcls_remember_username') || '';

        let defaultBoy: DeliveryBoy | undefined;
        if (currentAgentId) {
          defaultBoy = boys.find((b) => b.id === currentAgentId);
        }
        if (!defaultBoy && currentAgentName) {
          defaultBoy = boys.find((b) => b.name.toLowerCase() === currentAgentName.toLowerCase() || b.username.toLowerCase() === currentAgentName.toLowerCase());
        }
        if (!defaultBoy && boys.length > 0) {
          defaultBoy = boys[0];
        }

        if (defaultBoy) {
          setSelectedBoy(defaultBoy);
        }

        // If user is a delivery boy (not staff/manager), open directly into Scan mode
        if (!isStaffOrManager) {
          setActiveTab('SCAN');
        }
      } catch (err) {
        console.error('Initialization error:', err);
      }
    };

    initialize();
  }, [isStaffOrManager]);

  // 2. Fetch Roster Summaries & BPCL AI Reports for active date
  const loadRosterData = useCallback(async (dateStr: string) => {
    setIsLoadingRoster(true);
    try {
      const [summaries, bpclMap] = await Promise.all([
        fetchAllDayEndReportsForDate(dateStr),
        fetchAllBpclReportsForDate(dateStr),
      ]);
      setRosterSummaries(summaries);
      setBpclReportsMap(bpclMap);
      if (selectedBoyRef.current) {
        const norm = selectedBoyRef.current.name.trim().toUpperCase();
        setActiveBpclReport(bpclMap[norm] || null);
      }
    } catch (err) {
      console.warn('Failed to load roster summaries:', err);
    } finally {
      setIsLoadingRoster(false);
    }
  }, []);

  useEffect(() => {
    loadRosterData(reportDate);
  }, [reportDate, loadRosterData]);

  // Write-Ahead Engine: Immediately writes to local storage (0ms) and auto-saves to database (debounced 800ms)
  const triggerAutoSave = useCallback((updatedEntries: ItemEntry[], boy: DeliveryBoy, dateStr: string) => {
    const normName = boy.name.trim().toUpperCase();
    const draftKey = getWorkingDraftKey(dateStr, normName);

    // 1. Synchronously persist to localStorage draft immediately (survives app switches)
    try {
      localStorage.setItem(draftKey, JSON.stringify({
        entries: updatedEntries,
        timestamp: Date.now(),
      }));
    } catch (_) {}

    // 2. Debounced background auto-save to database
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    autoSaveTimerRef.current = setTimeout(async () => {
      try {
        await saveDayEndReportToDatabase({
          report_date: dateStr,
          agent_id: boy.id,
          agent_name: boy.name,
          entries: updatedEntries as any,
          supervisor_phone: supervisorPhone,
        });
        setLastSavedTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
        setHasUnsavedChanges(false);
      } catch (err) {
        console.warn('Auto-save error:', err);
      }
    }, 800);
  }, [supervisorPhone]);

  // 3. Load Bills for Selected Delivery Boy (with resilient Local Working Draft protection)
  const loadBillsForSelectedBoy = useCallback(async (boy: DeliveryBoy, dateStr: string) => {
    try {
      const normName = boy.name.trim().toUpperCase();

      // 1. Fetch cloud summary first
      const summary = await fetchDayEndReportForAgent(dateStr, boy.name, boy.id);
      const cloudEntries: ItemEntry[] = (summary && Array.isArray(summary.entries)) ? summary.entries : [];

      // Guard against race conditions when user switches boys quickly
      if (selectedBoyRef.current?.name.trim().toUpperCase() !== normName) {
        return;
      }

      // 2. Check local working draft
      const draftKey = getWorkingDraftKey(dateStr, normName);
      let draftEntries: ItemEntry[] = [];
      try {
        const rawDraft = localStorage.getItem(draftKey);
        if (rawDraft) {
          const parsed = JSON.parse(rawDraft);
          if (Array.isArray(parsed.entries)) {
            draftEntries = parsed.entries;
          }
        }
      } catch (_) {}

      // 3. Resolution:
      if (cloudEntries.length > 0) {
        setEntries(cloudEntries);
        if (summary?.updated_at) {
          setLastSavedTime(new Date(summary.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
        }
        setHasUnsavedChanges(false);
        try {
          localStorage.setItem(draftKey, JSON.stringify({ entries: cloudEntries, timestamp: Date.now() }));
        } catch (_) {}
      } else if (summary && summary.total_deliveries === 0) {
        // Cloud officially confirms 0 deliveries for this boy:
        // Never load stale/leaked drafts for boys with 0 bills!
        setEntries([]);
        setLastSavedTime(null);
        setHasUnsavedChanges(false);
        try {
          localStorage.removeItem(draftKey);
        } catch (_) {}
      } else if (draftEntries.length > 0) {
        // Cross-contamination safeguard: if every entry in draft belongs to another delivery boy, purge it!
        const allClaimedByOther = draftEntries.every(
          (e) => crossAgentClaimedMap[e.consumer_number.toLowerCase()]
        );
        if (allClaimedByOther && draftEntries.length > 3) {
          setEntries([]);
          setHasUnsavedChanges(false);
          try {
            localStorage.removeItem(draftKey);
          } catch (_) {}
        } else {
          setEntries(draftEntries);
          setHasUnsavedChanges(true);
        }
      } else {
        setEntries([]);
        setLastSavedTime(null);
        setHasUnsavedChanges(false);
      }

      activeBoyIdentityRef.current = normName;
    } catch (err) {
      console.warn('Failed to load bills for boy:', err);
    }
  }, [crossAgentClaimedMap]);

  // 3b. Switch or Select Active Delivery Boy cleanly with ZERO cross-contamination
  const handleSelectBoy = useCallback(async (targetBoy: DeliveryBoy) => {
    const targetNorm = targetBoy.name.trim().toUpperCase();

    // If clicking the boy that is already active and loaded, just ensure tab is SCAN and BPCL report is synced
    if (
      selectedBoy?.name.trim().toUpperCase() === targetNorm &&
      activeBoyIdentityRef.current === targetNorm
    ) {
      setActiveTab('SCAN');
      setIsBoyDropdownOpen(false);
      setBoySearchQuery('');
      setActiveBpclReport(bpclReportsMap[targetNorm] || null);
      return;
    }

    // 1. Cancel any pending auto-saves immediately
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }

    // 2. If the current outgoing boy has unsaved changes, flush them for the OUTGOING boy
    const outgoingBoy = selectedBoyRef.current;
    if (outgoingBoy && hasUnsavedChanges && entriesRef.current.length > 0) {
      const outgoingNorm = outgoingBoy.name.trim().toUpperCase();
      const outgoingDraftKey = getWorkingDraftKey(reportDate, outgoingNorm);
      try {
        localStorage.setItem(outgoingDraftKey, JSON.stringify({
          entries: entriesRef.current,
          timestamp: Date.now(),
        }));
      } catch (_) {}
    }

    // 3. Clear all temporary form inputs and filters
    setRawInput('');
    setSingleInput('');
    setListSearchQuery('');
    setShowSuggestions(false);
    setHasUnsavedChanges(false);

    // 4. CRITICAL: Immediately clear entries in React state so the previous boy's numbers NEVER bleed into the new boy!
    activeBoyIdentityRef.current = targetNorm;
    setEntries([]); // Reset immediately!

    // 5. Update selected boy state
    setSelectedBoy(targetBoy);
    selectedBoyRef.current = targetBoy;
    setIsBoyDropdownOpen(false);
    setBoySearchQuery('');
    setActiveTab('SCAN');

    // 6. Fetch authoritative bills for the target boy
    await loadBillsForSelectedBoy(targetBoy, reportDate);

    // 7. Load BPCL AI Report for the target boy
    setActiveBpclReport(bpclReportsMap[targetNorm] || null);
    fetchBpclReport(reportDate, targetBoy.name, targetBoy.id).then((rep) => {
      if (rep) {
        setActiveBpclReport(rep);
        setBpclReportsMap((prev) => ({ ...prev, [targetNorm]: rep }));
      }
    });
  }, [selectedBoy, hasUnsavedChanges, reportDate, loadBillsForSelectedBoy, bpclReportsMap]);

  // Toggle "Bills Checked Done" for active selected delivery boy
  const handleToggleActiveCheckedDone = async () => {
    if (!selectedBoy) return;
    const norm = selectedBoy.name.trim().toUpperCase();
    const currentStatus = activeBpclReport?.checked_done ?? false;
    const nextStatus = !currentStatus;

    await toggleBillsCheckedDone(reportDate, selectedBoy.name, selectedBoy.id, nextStatus);
    const updated = await fetchBpclReport(reportDate, selectedBoy.name, selectedBoy.id);
    if (updated) {
      setActiveBpclReport(updated);
      setBpclReportsMap((prev) => ({ ...prev, [norm]: updated }));
    }
    toast.success(
      nextStatus
        ? `Marked ${selectedBoy.name}'s bills as Checked Done!`
        : `Unmarked Checked Done for ${selectedBoy.name}`
    );
  };

  // 1-click Add a Pending BPCL Bill into Completed Deliveries
  const handleAddPendingBillToScanned = async (bill: BpclBillItem) => {
    if (entries.some((e) => e.consumer_number.toLowerCase() === bill.consumer_number.toLowerCase())) {
      toast('This consumer is already in Completed Deliveries', { icon: 'ℹ️' });
      return;
    }

    const match = await matchConsumerWithDatabase(bill.consumer_number, bill.consumer_name);
    const newEntry: ItemEntry = {
      consumer_id: match.consumer_id,
      consumer_number: match.consumer_number || bill.consumer_number,
      consumer_name: match.consumer_name || bill.consumer_name || 'Consumer',
      address: match.address || '',
      mobile: match.mobile || '',
      found: match.found,
      source: 'manual',
      cylinder_type: '14.2KG_STD',
      payment_mode: 'CASH',
      empty_collected: true,
      scanned_at: new Date().toISOString(),
    };

    const next = [newEntry, ...entries];
    setEntries(next);
    setHasUnsavedChanges(true);
    if (selectedBoy) {
      triggerAutoSave(next, selectedBoy, reportDate);
    }
    toast.success(`Added #${bill.consumer_number} (${bill.consumer_name}) to Completed Deliveries!`);
  };

  // Helper to check if a consumer number is registered in BPCL online_bills for the active boy
  const isBpclOnlineBill = useCallback((consumerNo: string): boolean => {
    if (!activeBpclReport?.online_bills) return false;
    const norm = consumerNo.trim().toLowerCase();
    return activeBpclReport.online_bills.some((b) => b.consumer_number.trim().toLowerCase() === norm);
  }, [activeBpclReport]);

  // Auto-convert any scanned bills that are confirmed as BPCL Online (PayNBook) from CASH to UPI
  const autoConvertOnlineBills = useCallback((
    currentEntries: ItemEntry[],
    report: BpclReportData | null
  ): { updatedEntries: ItemEntry[]; convertedCount: number } => {
    if (!report || !report.online_bills || report.online_bills.length === 0) {
      return { updatedEntries: currentEntries, convertedCount: 0 };
    }

    const onlineConsSet = new Set(
      report.online_bills.map((b) => b.consumer_number.trim().toLowerCase())
    );

    let convertedCount = 0;
    const updatedEntries = currentEntries.map((entry) => {
      const norm = entry.consumer_number.trim().toLowerCase();
      if (onlineConsSet.has(norm) && entry.payment_mode === 'CASH') {
        convertedCount++;
        return {
          ...entry,
          payment_mode: 'UPI' as const,
        };
      }
      return entry;
    });

    return { updatedEntries, convertedCount };
  }, []);

  // Handler to manually or automatically convert a single bill to Online (UPI)
  const handleConvertBillToOnline = useCallback((consumerNo: string) => {
    const norm = consumerNo.trim().toLowerCase();
    setEntries((prev) => {
      const idx = prev.findIndex((e) => e.consumer_number.trim().toLowerCase() === norm);
      if (idx === -1) return prev;
      const updated = [...prev];
      updated[idx] = { ...updated[idx], payment_mode: 'UPI' };
      if (selectedBoy) {
        triggerAutoSave(updated, selectedBoy, reportDate);
      }
      return updated;
    });
    setHasUnsavedChanges(true);
    toast.success(`⚡ Converted #${consumerNo} to Online (UPI)!`);
  }, [selectedBoy, reportDate, triggerAutoSave]);

  // Handler to convert ALL online conflicts to Online (UPI)
  const handleConvertAllOnlineConflicts = useCallback(() => {
    if (!activeBpclReport || !selectedBoy) return;
    const { updatedEntries, convertedCount } = autoConvertOnlineBills(entries, activeBpclReport);
    if (convertedCount > 0) {
      setEntries(updatedEntries);
      setHasUnsavedChanges(true);
      triggerAutoSave(updatedEntries, selectedBoy, reportDate);
      toast.success(`⚡ Converted ${convertedCount} bill${convertedCount > 1 ? 's' : ''} to Online (UPI)!`);
    } else {
      toast('All online bills are already marked as Online (UPI)', { icon: 'ℹ️' });
    }
  }, [activeBpclReport, entries, selectedBoy, reportDate, triggerAutoSave, autoConvertOnlineBills]);

  // Effect: Automatically convert any CASH bill to Online (UPI) whenever BPCL online_bills or entries change
  useEffect(() => {
    if (!activeBpclReport?.online_bills || activeBpclReport.online_bills.length === 0) return;
    if (entries.length === 0 || !selectedBoy) return;

    const { updatedEntries, convertedCount } = autoConvertOnlineBills(entries, activeBpclReport);
    if (convertedCount > 0) {
      setEntries(updatedEntries);
      setHasUnsavedChanges(true);
      triggerAutoSave(updatedEntries, selectedBoy, reportDate);
      toast.success(
        `⚡ Automatically converted ${convertedCount} online bill${convertedCount > 1 ? 's' : ''} to Online (UPI)!`,
        { id: 'auto-convert-online-toast' }
      );
    }
  }, [activeBpclReport, entries, selectedBoy, reportDate, triggerAutoSave, autoConvertOnlineBills]);

  // App Switch / Background / Pagehide Emergency Flush:
  // Ensures bills are immediately persisted when the user switches to WhatsApp or another app!
  useEffect(() => {
    const handleAppSwitchOrUnload = () => {
      const boy = selectedBoyRef.current;
      const currentEntries = entriesRef.current;
      const currentDate = reportDateRef.current;

      if (boy && currentEntries.length > 0) {
        const normName = boy.name.trim().toUpperCase();
        if (activeBoyIdentityRef.current !== normName) return;

        const draftKey = getWorkingDraftKey(currentDate, normName);
        try {
          localStorage.setItem(draftKey, JSON.stringify({
            entries: currentEntries,
            timestamp: Date.now(),
          }));
        } catch (_) {}

        saveDayEndReportToDatabase({
          report_date: currentDate,
          agent_id: boy.id,
          agent_name: boy.name,
          entries: currentEntries as any,
          supervisor_phone: supervisorPhone,
        }).catch(() => {});
      }
    };

    document.addEventListener('visibilitychange', handleAppSwitchOrUnload);
    window.addEventListener('pagehide', handleAppSwitchOrUnload);
    window.addEventListener('beforeunload', handleAppSwitchOrUnload);

    return () => {
      document.removeEventListener('visibilitychange', handleAppSwitchOrUnload);
      window.removeEventListener('pagehide', handleAppSwitchOrUnload);
      window.removeEventListener('beforeunload', handleAppSwitchOrUnload);
    };
  }, [supervisorPhone]);

  // Synchronous write-ahead to localStorage on ANY change to entries
  useEffect(() => {
    if (!selectedBoy) return;
    const normName = selectedBoy.name.trim().toUpperCase();
    // SAFETY GUARD: Never write entries to disk if they belong to another boy or are mid-switch!
    if (activeBoyIdentityRef.current !== normName) return;

    const draftKey = getWorkingDraftKey(reportDate, normName);
    try {
      localStorage.setItem(draftKey, JSON.stringify({
        entries,
        timestamp: Date.now(),
      }));
    } catch (_) {}
  }, [entries, selectedBoy, reportDate]);

  // Debounced background auto-save to cloud database whenever entries change with unsaved edits
  useEffect(() => {
    if (!selectedBoy || !hasUnsavedChanges || entries.length === 0) return;
    const normName = selectedBoy.name.trim().toUpperCase();
    // SAFETY GUARD: Do not auto-save if entries belong to another boy!
    if (activeBoyIdentityRef.current !== normName) return;

    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    autoSaveTimerRef.current = setTimeout(async () => {
      try {
        await saveDayEndReportToDatabase({
          report_date: reportDate,
          agent_id: selectedBoy.id,
          agent_name: selectedBoy.name,
          entries: entries as any,
          supervisor_phone: supervisorPhone,
        });
        setLastSavedTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
        setHasUnsavedChanges(false);
      } catch (err) {
        console.warn('Auto-save error:', err);
      }
    }, 1000);

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [entries, hasUnsavedChanges, selectedBoy, reportDate, supervisorPhone]);

  useEffect(() => {
    if (selectedBoy) {
      loadBillsForSelectedBoy(selectedBoy, reportDate);
    }
  }, [reportDate, loadBillsForSelectedBoy]);

  // 4. Real-time Multi-Staff Sync Listener
  useEffect(() => {
    const channel = supabase.channel('bgcls_cash_memo_live_sync');
    channel
      .on('broadcast', { event: 'cash_memos_updated' }, (payload) => {
        if (payload?.payload?.report_date === reportDate) {
          loadRosterData(reportDate);

          if (selectedBoy && payload.payload.agent_name?.trim().toUpperCase() === selectedBoy.name.trim().toUpperCase()) {
            loadBillsForSelectedBoy(selectedBoy, reportDate);
            toast(`Bills for ${selectedBoy.name} were updated by another staff member`, { icon: '🔄' });
          }
        }
      })
      .subscribe();

    // Listen to realtime BPCL AI Status Report updates from other devices
    const bpclChannel = supabase.channel('bgcls_bpcl_channel');
    bpclChannel
      .on('broadcast', { event: 'bpcl_report_updated' }, (payload) => {
        if (payload?.payload?.dateStr === reportDate) {
          fetchAllBpclReportsForDate(reportDate).then((updatedMap) => {
            setBpclReportsMap(updatedMap);
            if (selectedBoyRef.current) {
              const norm = selectedBoyRef.current.name.trim().toUpperCase();
              if (updatedMap[norm]) {
                setActiveBpclReport(updatedMap[norm]);
              }
            }
          });
        }
      })
      .subscribe();

    const handleLocalUpdate = (e: any) => {
      if (e?.detail?.report_date === reportDate) {
        loadRosterData(reportDate);
      }
    };
    window.addEventListener('bgcls-day-end-updated', handleLocalUpdate);

    const handleBpclLocalUpdate = (e: any) => {
      if (e?.detail?.dateStr === reportDate) {
        fetchAllBpclReportsForDate(reportDate).then((updatedMap) => {
          setBpclReportsMap(updatedMap);
          if (selectedBoyRef.current) {
            const norm = selectedBoyRef.current.name.trim().toUpperCase();
            if (updatedMap[norm]) {
              setActiveBpclReport(updatedMap[norm]);
            }
          }
        });
      }
    };
    window.addEventListener('bgcls-bpcl-updated', handleBpclLocalUpdate);

    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(bpclChannel);
      window.removeEventListener('bgcls-day-end-updated', handleLocalUpdate);
      window.removeEventListener('bgcls-bpcl-updated', handleBpclLocalUpdate);
    };
  }, [reportDate, selectedBoy, loadRosterData, loadBillsForSelectedBoy]);

  // 5. KPIs & Statistics Calculation
  const kpis = useMemo(() => {
    const totalDeliveries = entries.length;
    const count14kg = entries.filter((e) => e.cylinder_type === '14.2KG_STD').length;
    const count10kg = entries.filter((e) => e.cylinder_type === '10KG_LITE').length;
    const count19kg = entries.filter((e) => e.cylinder_type === '19KG_COMM').length;
    const emptiesCollected = entries.filter((e) => e.empty_collected).length;
    const cashCount = entries.filter((e) => e.payment_mode === 'CASH').length;
    const upiCount = entries.filter((e) => e.payment_mode === 'UPI').length;
    const dueCount = entries.filter((e) => e.payment_mode === 'DUE').length;

    return {
      totalDeliveries,
      count14kg,
      count10kg,
      count19kg,
      emptiesCollected,
      cashCount,
      upiCount,
      dueCount,
    };
  }, [entries]);

  // 6. Save Bills Directly to Database
  const handleSaveToDatabase = async () => {
    if (!selectedBoy) {
      toast.error('Please select a delivery boy');
      return;
    }

    // Anti-Fraud Warning Guard: Check if there are duplicate bills claimed by another delivery boy
    const duplicateList = entries.filter((e) => {
      return e.duplicate_of_agent || crossAgentClaimedMap[e.consumer_number.toLowerCase()];
    });

    if (duplicateList.length > 0) {
      const firstDup = duplicateList[0];
      const claimantName = firstDup.duplicate_of_agent || crossAgentClaimedMap[firstDup.consumer_number.toLowerCase()]?.agentName || 'another delivery boy';
      const proceed = window.confirm(
        `🚨 DOUBLE BILL SCAM ALERT!\n\n${duplicateList.length} bill(s) in this list were ALREADY SUBMITTED by other delivery boys!\n\nExample: Bill #${firstDup.consumer_number} (${firstDup.consumer_name}) was already given by ${claimantName.toUpperCase()}.\n\nAre you sure staff wants to save duplicate bills for ${selectedBoy.name}?`
      );
      if (!proceed) {
        toast.error('Save cancelled to prevent double-crediting duplicate bills.');
        return;
      }
    }

    setIsSavingDb(true);
    const toastId = toast.loading(`Saving ${entries.length} bills for ${selectedBoy.name} to database...`);

    try {
      const userMeta = await supabase.auth.getUser();
      const staffName = userMeta?.data?.user?.user_metadata?.name || userMeta?.data?.user?.email?.split('@')[0] || 'Staff';

      await saveDayEndReportToDatabase({
        report_date: reportDate,
        agent_id: selectedBoy.id,
        agent_name: selectedBoy.name,
        entries,
        scanned_by_staff: staffName,
        supervisor_phone: supervisorPhone,
      });

      const nowFormatted = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setLastSavedTime(nowFormatted);
      setHasUnsavedChanges(false);

      // Instantly update local roster state so scam alerts and bills refresh immediately!
      const normName = selectedBoy.name.trim().toUpperCase();
      setRosterSummaries((prev) => ({
        ...prev,
        [normName]: {
          ...prev[normName],
          report_date: reportDate,
          agent_id: selectedBoy.id,
          agent_name: selectedBoy.name,
          total_deliveries: entries.length,
          domestic_14kg: entries.filter((e) => e.cylinder_type === '14.2KG_STD').length,
          composite_10kg: entries.filter((e) => e.cylinder_type === '10KG_LITE').length,
          commercial_19kg: entries.filter((e) => e.cylinder_type === '19KG_COMM').length,
          empties_collected: entries.filter((e) => e.empty_collected).length,
          cash_count: entries.filter((e) => e.payment_mode === 'CASH').length,
          upi_count: entries.filter((e) => e.payment_mode === 'UPI').length,
          due_count: entries.filter((e) => e.payment_mode === 'DUE').length,
          entries: [...entries],
          updated_at: new Date().toISOString(),
        },
      }));

      await loadRosterData(reportDate);

      toast.success(
        entries.length === 0
          ? `✅ Cleared bills for ${selectedBoy.name} in database!`
          : `✅ Saved ${entries.length} bills for ${selectedBoy.name} in database!`,
        { id: toastId }
      );
    } catch (err: any) {
      console.error('Failed to save bills to database:', err);
      toast.error('Failed to save to database. Preserved in local storage.', { id: toastId });
    } finally {
      setIsSavingDb(false);
    }
  };

  // 7. Handle Date Switching
  const handleDateChange = (newDate: string) => {
    if (!newDate || newDate === reportDate) return;
    activeDateRef.current = newDate;
    setReportDate(newDate);
    setListSearchQuery('');
    toast(`Viewing Date: ${newDate}`, { icon: '📅' });
  };

  // 8. Search Auto-complete against Dexie (33k+ consumers)
  useEffect(() => {
    const query = singleInput.trim().toLowerCase();
    if (!query || query.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const combinedMap = new Map<string, Consumer>();
        const isNumeric = /^\d+$/.test(query);

        if (isNumeric) {
          const localMatches = await db.consumers
            .where('consumer_number')
            .startsWith(query)
            .limit(25)
            .toArray();
          localMatches.forEach((item) => combinedMap.set(item.consumer_number, item));
        } else {
          const nameTokens = query.split(/\s+/).filter((w) => w.length >= 2);
          if (nameTokens.length > 0) {
            const nameMatches = await db.consumers
              .where('searchWords')
              .anyOfIgnoreCase(nameTokens)
              .limit(30)
              .toArray();
            nameMatches.forEach((item) => combinedMap.set(item.consumer_number, item));
          }
        }

        const valid = Array.from(combinedMap.values());
        setSuggestions(valid.slice(0, 15));
        setShowSuggestions(valid.length > 0);
      } catch (err) {
        console.error('Search error:', err);
      } finally {
        setIsSearching(false);
      }
    }, 40);

    return () => clearTimeout(timer);
  }, [singleInput]);

  // 9. Select Consumer from Suggestion
  const handleSelectSuggestion = (consumer: Consumer) => {
    if (entries.some((e) => e.consumer_number.toLowerCase() === consumer.consumer_number.toLowerCase())) {
      toast.error(`Consumer #${consumer.consumer_number} is already added`);
      setShowSuggestions(false);
      return;
    }

    const otherClaimant = crossAgentClaimedMap[consumer.consumer_number.toLowerCase()];
    if (otherClaimant) {
      toast.error(
        `🚨 DOUBLE BILL SCAM ALERT! #${consumer.consumer_number} was ALREADY GIVEN BY ${otherClaimant.agentName.toUpperCase()}!`,
        { duration: 8000, id: 'duplicate-alert' }
      );
    }

    const newEntry: ItemEntry = {
      consumer_id: consumer.id,
      consumer_number: consumer.consumer_number,
      consumer_name: consumer.consumer_name,
      address: consumer.address,
      mobile: consumer.mobile,
      found: true,
      source: 'local',
      cylinder_type: consumer.cylinder_type === '10KG_LITE' ? '10KG_LITE' : (consumer.cylinder_type as string) === '19KG_COMM' ? '19KG_COMM' : '14.2KG_STD',
      payment_mode: isBpclOnlineBill(consumer.consumer_number) ? 'UPI' : 'CASH',
      empty_collected: true,
      scanned_at: new Date().toISOString(),
      duplicate_of_agent: otherClaimant ? otherClaimant.agentName : undefined,
      duplicate_claimed_date: otherClaimant ? otherClaimant.date : undefined,
    };

    setEntries((prev) => [...prev, newEntry]);
    setHasUnsavedChanges(true);
    setSingleInput('');
    setShowSuggestions(false);
    toast.success(`Added ${consumer.consumer_name} (#${consumer.consumer_number})`);
  };

  // 10. Add Single Consumer (via input or Enter)
  const handleAddSingle = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanInput = singleInput.trim();
    if (!cleanInput) return;

    if (entries.some((e) => e.consumer_number.toLowerCase() === cleanInput.toLowerCase())) {
      toast.error('Consumer number already added');
      return;
    }

    if (suggestions.length > 0) {
      const exactMatch = suggestions.find((s) => s.consumer_number.toLowerCase() === cleanInput.toLowerCase());
      if (exactMatch) {
        handleSelectSuggestion(exactMatch);
        return;
      }
    }

    const match = await matchConsumerWithDatabase(cleanInput, cleanInput);
    if (match.found) {
      if (entries.some((e) => e.consumer_number.toLowerCase() === match.consumer_number.toLowerCase())) {
        toast.error(`Consumer #${match.consumer_number} is already added`);
        return;
      }

      const otherClaimant = crossAgentClaimedMap[match.consumer_number.toLowerCase()] || crossAgentClaimedMap[cleanInput.toLowerCase()];
      if (otherClaimant) {
        toast.error(
          `🚨 DOUBLE BILL SCAM ALERT! #${match.consumer_number} was ALREADY GIVEN BY ${otherClaimant.agentName.toUpperCase()}!`,
          { duration: 8000, id: 'duplicate-alert' }
        );
      }

      setEntries((prev) => [
        ...prev,
        {
          consumer_id: match.consumer_id,
          consumer_number: match.consumer_number,
          consumer_name: match.consumer_name,
          address: match.address,
          mobile: match.mobile,
          found: true,
          source: 'local',
          cylinder_type: '14.2KG_STD',
          payment_mode: isBpclOnlineBill(match.consumer_number) ? 'UPI' : 'CASH',
          empty_collected: true,
          scanned_at: new Date().toISOString(),
          duplicate_of_agent: otherClaimant ? otherClaimant.agentName : undefined,
          duplicate_claimed_date: otherClaimant ? otherClaimant.date : undefined,
        },
      ]);
      setHasUnsavedChanges(true);
      setSingleInput('');
      setShowSuggestions(false);
      toast.success(`Added #${match.consumer_number} (${match.consumer_name})`);
      return;
    }

    const otherClaimantUnverified = crossAgentClaimedMap[cleanInput.toLowerCase()];
    if (otherClaimantUnverified) {
      toast.error(
        `🚨 DOUBLE BILL SCAM ALERT! #${cleanInput} was ALREADY GIVEN BY ${otherClaimantUnverified.agentName.toUpperCase()}!`,
        { duration: 8000, id: 'duplicate-alert' }
      );
    }

    // Unmatched: Add as unverified manual entry
    setEntries((prev) => [
      ...prev,
      {
        consumer_number: cleanInput,
        consumer_name: 'Unverified / Manual Entry',
        address: 'Not in master database',
        mobile: '',
        found: false,
        source: 'manual',
        cylinder_type: '14.2KG_STD',
        payment_mode: isBpclOnlineBill(cleanInput) ? 'UPI' : 'CASH',
        empty_collected: true,
        scanned_at: new Date().toISOString(),
        duplicate_of_agent: otherClaimantUnverified ? otherClaimantUnverified.agentName : undefined,
        duplicate_claimed_date: otherClaimantUnverified ? otherClaimantUnverified.date : undefined,
      },
    ]);
    setHasUnsavedChanges(true);
    setSingleInput('');
    setShowSuggestions(false);
    toast(`Added #${cleanInput} as unverified entry`, { icon: 'ℹ️' });
  };

  // 11. Bulk Process Numbers
  const handleProcessBulkInput = async () => {
    if (!rawInput.trim()) {
      toast.error('Please enter consumer numbers');
      return;
    }

    setIsProcessing(true);
    try {
      const parsedNumbers = rawInput
        .split(/[\s,\n;]+/)
        .map((num) => num.replace(/[^a-zA-Z0-9]/g, '').trim())
        .filter((num) => num.length > 0);

      if (parsedNumbers.length === 0) {
        toast.error('No valid consumer numbers found');
        setIsProcessing(false);
        return;
      }

      const existingSet = new Set(entries.map((e) => e.consumer_number.toLowerCase()));
      const uniqueNewNumbers = Array.from(new Set(parsedNumbers)).filter((num) => !existingSet.has(num.toLowerCase()));

      if (uniqueNewNumbers.length === 0) {
        toast.error('All entered consumer numbers are already in the list');
        setIsProcessing(false);
        return;
      }

      const localMatches = await db.consumers
        .where('consumer_number')
        .anyOfIgnoreCase(uniqueNewNumbers)
        .toArray();

      const resolvedMap = new Map<string, ItemEntry>();
      localMatches.forEach((match) => {
        resolvedMap.set(match.consumer_number.toLowerCase(), {
          consumer_id: match.id,
          consumer_number: match.consumer_number,
          consumer_name: match.consumer_name,
          address: match.address,
          mobile: match.mobile,
          found: true,
          source: 'local',
          cylinder_type: match.cylinder_type === '10KG_LITE' ? '10KG_LITE' : (match.cylinder_type as string) === '19KG_COMM' ? '19KG_COMM' : '14.2KG_STD',
          payment_mode: isBpclOnlineBill(match.consumer_number) ? 'UPI' : 'CASH',
          empty_collected: true,
          scanned_at: new Date().toISOString(),
        });
      });

      const finalResolved: ItemEntry[] = uniqueNewNumbers.map((num) => {
        const found = resolvedMap.get(num.toLowerCase());
        const otherClaimant = crossAgentClaimedMap[num.toLowerCase()];
        if (found) {
          return {
            ...found,
            duplicate_of_agent: otherClaimant ? otherClaimant.agentName : undefined,
            duplicate_claimed_date: otherClaimant ? otherClaimant.date : undefined,
          };
        }

        return {
          consumer_number: num,
          consumer_name: 'Consumer Record Not Found',
          found: false,
          source: 'manual',
          cylinder_type: '14.2KG_STD',
          payment_mode: isBpclOnlineBill(num) ? 'UPI' : 'CASH',
          empty_collected: true,
          scanned_at: new Date().toISOString(),
          duplicate_of_agent: otherClaimant ? otherClaimant.agentName : undefined,
          duplicate_claimed_date: otherClaimant ? otherClaimant.date : undefined,
        };
      });

      const duplicatesInBulk = finalResolved.filter((e) => e.duplicate_of_agent);
      if (duplicatesInBulk.length > 0) {
        toast.error(
          `🚨 SCAM ALERT: ${duplicatesInBulk.length} bill(s) in this bulk list were ALREADY GIVEN by other delivery boys (e.g. #${duplicatesInBulk[0].consumer_number} by ${duplicatesInBulk[0].duplicate_of_agent})!`,
          { duration: 9000, id: 'bulk-duplicate-scam' }
        );
      }

      setEntries((prev) => [...prev, ...finalResolved]);
      setHasUnsavedChanges(true);
      setRawInput('');

      const verifiedCount = finalResolved.filter((e) => e.found).length;
      toast.success(`Added ${finalResolved.length} entries (${verifiedCount} verified)`);
    } catch (err) {
      console.error('Error processing bulk numbers:', err);
      toast.error('Failed to process numbers');
    } finally {
      setIsProcessing(false);
    }
  };

  // 12. Camera Scanner Auto-Scanned Callback
  const handleConsumerAutoScanned = (scannedItem: {
    consumer_id?: string;
    consumer_number: string;
    consumer_name: string;
    address?: string;
    mobile?: string;
    found: boolean;
    duplicate_of_agent?: string;
    duplicate_claimed_date?: string;
  }) => {
    const otherClaimant = scannedItem.duplicate_of_agent
      ? { agentName: scannedItem.duplicate_of_agent, date: scannedItem.duplicate_claimed_date }
      : crossAgentClaimedMap[scannedItem.consumer_number.toLowerCase()];

    setEntries((prev) => {
      const existingIdx = prev.findIndex((e) => e.consumer_number.toLowerCase() === scannedItem.consumer_number.toLowerCase());
      if (existingIdx !== -1) {
        if (!prev[existingIdx].found && scannedItem.found) {
          const updated = [...prev];
          updated[existingIdx] = {
            ...updated[existingIdx],
            consumer_id: scannedItem.consumer_id || updated[existingIdx].consumer_id,
            consumer_name: scannedItem.consumer_name,
            address: scannedItem.address || updated[existingIdx].address,
            mobile: scannedItem.mobile || updated[existingIdx].mobile,
            found: true,
            source: 'local',
            duplicate_of_agent: otherClaimant ? otherClaimant.agentName : updated[existingIdx].duplicate_of_agent,
            duplicate_claimed_date: otherClaimant ? otherClaimant.date : updated[existingIdx].duplicate_claimed_date,
          };
          return updated;
        }
        return prev;
      }

      return [
        ...prev,
        {
          consumer_id: scannedItem.consumer_id,
          consumer_number: scannedItem.consumer_number,
          consumer_name: scannedItem.consumer_name,
          address: scannedItem.address,
          mobile: scannedItem.mobile,
          found: scannedItem.found,
          source: 'camera',
          cylinder_type: '14.2KG_STD',
          payment_mode: isBpclOnlineBill(scannedItem.consumer_number) ? 'UPI' : 'CASH',
          empty_collected: true,
          scanned_at: new Date().toISOString(),
          duplicate_of_agent: otherClaimant ? otherClaimant.agentName : undefined,
          duplicate_claimed_date: otherClaimant ? otherClaimant.date : undefined,
        },
      ];
    });

    setHasUnsavedChanges(true);
  };

  // 13. Item Actions (Interactive Toggles Directly on Cards)
  const handleToggleCylinder = (index: number) => {
    setEntries((prev) => {
      const updated = [...prev];
      const cur = updated[index].cylinder_type;
      const types: ('14.2KG_STD' | '10KG_LITE' | '19KG_COMM')[] = ['14.2KG_STD', '10KG_LITE', '19KG_COMM'];
      const nextIdx = (types.indexOf(cur) + 1) % types.length;
      updated[index] = { ...updated[index], cylinder_type: types[nextIdx] };
      return updated;
    });
    setHasUnsavedChanges(true);
  };

  const handleTogglePayment = (index: number) => {
    setEntries((prev) => {
      const updated = [...prev];
      const cur = updated[index].payment_mode;
      const modes: ('CASH' | 'UPI' | 'DUE')[] = ['CASH', 'UPI', 'DUE'];
      const nextIdx = (modes.indexOf(cur) + 1) % modes.length;
      updated[index] = { ...updated[index], payment_mode: modes[nextIdx] };
      return updated;
    });
    setHasUnsavedChanges(true);
  };

  const handleToggleEmpty = (index: number) => {
    setEntries((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], empty_collected: !updated[index].empty_collected };
      return updated;
    });
    setHasUnsavedChanges(true);
  };

  const handleRemoveEntry = async (index: number) => {
    const itemToRemove = entries[index];
    const updated = entries.filter((_, i) => i !== index);
    setEntries(updated);
    setHasUnsavedChanges(true);

    // Auto-save deletion to database immediately so user never has stuck unsaved changes
    if (selectedBoy) {
      try {
        const userMeta = await supabase.auth.getUser();
        const staffName = userMeta?.data?.user?.user_metadata?.name || 'Staff';
        await saveDayEndReportToDatabase({
          report_date: reportDate,
          agent_id: selectedBoy.id,
          agent_name: selectedBoy.name,
          entries: updated,
          scanned_by_staff: staffName,
          supervisor_phone: supervisorPhone,
        });
        const nowFormatted = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        setLastSavedTime(nowFormatted);
        setHasUnsavedChanges(false);

        // Update roster summaries immediately in React state
        const normName = selectedBoy.name.trim().toUpperCase();
        setRosterSummaries((prev) => ({
          ...prev,
          [normName]: {
            ...prev[normName],
            report_date: reportDate,
            agent_id: selectedBoy.id,
            agent_name: selectedBoy.name,
            total_deliveries: updated.length,
            domestic_14kg: updated.filter((e) => e.cylinder_type === '14.2KG_STD').length,
            composite_10kg: updated.filter((e) => e.cylinder_type === '10KG_LITE').length,
            commercial_19kg: updated.filter((e) => e.cylinder_type === '19KG_COMM').length,
            empties_collected: updated.filter((e) => e.empty_collected).length,
            cash_count: updated.filter((e) => e.payment_mode === 'CASH').length,
            upi_count: updated.filter((e) => e.payment_mode === 'UPI').length,
            due_count: updated.filter((e) => e.payment_mode === 'DUE').length,
            entries: [...updated],
            updated_at: new Date().toISOString(),
          },
        }));

        await loadRosterData(reportDate);
      } catch (err) {
        console.warn('Auto-save removal notice:', err);
      }
    }

    toast.success(`Removed #${itemToRemove.consumer_number} & synced to database!`);
  };

  // 14. Optional WhatsApp Sharing (Secondary)
  const handleShareWhatsApp = () => {
    if (entries.length === 0 || !selectedBoy) {
      toast.error('No bills to share');
      return;
    }

    const [year, month, day] = reportDate.split('-');
    const dateFormatted = `${day}/${month}/${year}`;

    let text = `📦 *BHARAT GAS - DELIVERY BILLS REPORT*\n`;
    text += `👤 *Delivery Boy:* ${selectedBoy.name}\n`;
    text += `📅 *Date:* ${dateFormatted}\n`;
    text += `📊 *Total Bills Scanned:* ${entries.length}\n`;
    text += `🔹 Domestic 14.2kg: ${kpis.count14kg} | 10kg Lite: ${kpis.count10kg} | 19kg Comm: ${kpis.count19kg}\n`;
    text += `💵 Cash: ${kpis.cashCount} | 📲 UPI: ${kpis.upiCount} | ⏳ Due: ${kpis.dueCount} | 🔄 Empties: ${kpis.emptiesCollected}\n\n`;

    text += `*Bills List:*\n`;
    entries.forEach((item, index) => {
      const typeLabel = item.cylinder_type === '10KG_LITE' ? '[10kg]' : item.cylinder_type === '19KG_COMM' ? '[19kg]' : '[14.2kg]';
      text += `${index + 1}. #${item.consumer_number} - ${item.consumer_name} ${typeLabel} (${item.payment_mode})\n`;
    });

    const cleanPhone = supervisorPhone.replace(/[^0-9]/g, '');
    const encoded = encodeURIComponent(text);
    window.open(`https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encoded}`, '_blank');
  };

  // 15. Copy Raw CSV Numbers
  const handleCopyCsvNumbers = async () => {
    if (entries.length === 0) {
      toast.error('No numbers to copy');
      return;
    }
    const csv = entries.map((e) => e.consumer_number).join(',');
    await navigator.clipboard.writeText(csv);
    setCopiedCsv(true);
    toast.success('Copied CSV numbers!');
    setTimeout(() => setCopiedCsv(false), 2000);
  };

  // Filtered deliveries for list view
  const displayedEntries = useMemo(() => {
    return entries.filter((item) => {
      if (listFilterTab === 'UNVERIFIED' && item.found) return false;
      if (!listSearchQuery.trim()) return true;
      const q = listSearchQuery.trim().toLowerCase();
      return (
        item.consumer_number.toLowerCase().includes(q) ||
        item.consumer_name.toLowerCase().includes(q) ||
        (item.mobile && item.mobile.toLowerCase().includes(q)) ||
        (item.address && item.address.toLowerCase().includes(q))
      );
    });
  }, [entries, listFilterTab, listSearchQuery]);

  // Filtered delivery boys for dropdown
  const filteredBoys = useMemo(() => {
    if (!boySearchQuery.trim()) return deliveryBoys;
    const q = boySearchQuery.trim().toLowerCase();
    return deliveryBoys.filter((b) => b.name.toLowerCase().includes(q) || b.username.toLowerCase().includes(q));
  }, [deliveryBoys, boySearchQuery]);

  return (
    <div className="min-h-screen bg-slate-100 pb-56 pt-3 px-3 max-w-2xl mx-auto font-sans print:p-0 print:m-0 print:bg-white print:max-w-none print:pb-0 print:min-h-0">
      {/* Day End Page Main Content - Strictly Hidden on Print */}
      <div className="day-end-main-page print:hidden">
        {/* Top Header Card */}
        <div className="bg-gradient-to-br from-slate-900 via-indigo-950 to-blue-950 text-white rounded-3xl p-4 shadow-xl border border-white/10 mb-3">
        {/* Header Title & Date Picker */}
        <div className="flex items-center justify-between mb-3 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={handleBack}
              className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 active:scale-95 border border-white/20 flex items-center justify-center text-white transition-all shrink-0 shadow-sm"
              title="Go Back"
              aria-label="Go Back"
            >
              <ArrowLeft className="w-5 h-5 text-white" />
            </button>
            <div className="w-9 h-9 rounded-xl bg-amber-400/20 border border-amber-400/30 flex items-center justify-center text-amber-400 shrink-0">
              <ClipboardList className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base font-black tracking-tight leading-tight truncate">Daily Cash Memos</h1>
              <p className="text-[11px] text-blue-200 truncate">Centralized database for all delivery boys</p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <input
              type="date"
              value={reportDate}
              onChange={(e) => handleDateChange(e.target.value)}
              className="bg-white/10 border border-white/20 rounded-xl px-2.5 py-1 text-xs text-white focus:outline-none focus:ring-2 focus:ring-amber-400 font-bold"
            />
          </div>
        </div>

        {/* Tab Navigation: All Delivery Boys Overview vs Scan Bills */}
        <div className="grid grid-cols-2 gap-1.5 p-1 bg-black/30 rounded-2xl border border-white/10 mb-3">
          <button
            onClick={() => setActiveTab('ROSTER')}
            className={`py-2 px-2 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'ROSTER'
                ? 'bg-amber-400 text-slate-950 shadow-md'
                : 'text-slate-300 hover:text-white hover:bg-white/5'
            }`}
          >
            <Users className="w-3.5 h-3.5" /> All Delivery Boys ({deliveryBoys.length})
            {totalRosterScamsCount > 0 && (
              <span className="bg-rose-600 text-white text-[9px] font-black px-1.5 py-0.5 rounded-full shadow-sm animate-pulse flex items-center gap-0.5 ml-0.5">
                <ShieldAlert className="w-2.5 h-2.5" /> {totalRosterScamsCount} SCAM
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('SCAN')}
            className={`py-2 px-2 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'SCAN'
                ? 'bg-amber-400 text-slate-950 shadow-md'
                : 'text-slate-300 hover:text-white hover:bg-white/5'
            }`}
          >
            <Camera className="w-3.5 h-3.5" /> {selectedBoy ? selectedBoy.name : 'Scan Bills'}
            {entries.length > 0 && (
              <span className="bg-slate-950 text-amber-300 text-[10px] font-black px-1.5 py-0.2 rounded-full ml-0.5">
                {entries.length}
              </span>
            )}
            {duplicateScamCount > 0 && (
              <span className="bg-rose-600 text-white text-[9px] font-black px-1.5 py-0.5 rounded-full shadow-sm animate-pulse ml-0.5">
                🚨 {duplicateScamCount}
              </span>
            )}
          </button>
        </div>

        {/* Delivery Boy Selector Banner (When in Scan mode or selecting) */}
        <div className="relative">
          <div className="bg-white/10 backdrop-blur-md rounded-2xl p-2.5 border border-white/15 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-amber-400/30 flex items-center justify-center text-amber-300 font-black text-xs shrink-0">
                {selectedBoyIndex ? `#${selectedBoyIndex}` : '?'}
              </div>
              <div className="min-w-0">
                <span className="text-[10px] text-blue-200 block">Active Delivery Boy</span>
                <span className="font-black text-white text-sm truncate block">
                  {selectedBoy ? selectedBoy.name : 'Select Delivery Boy'}
                </span>
              </div>
            </div>

            <button
              onClick={() => setIsBoyDropdownOpen(!isBoyDropdownOpen)}
              className="bg-white/20 hover:bg-white/30 text-white font-bold px-3 py-1.5 rounded-xl text-xs flex items-center gap-1 transition-all active:scale-95 shrink-0"
            >
              Switch Boy <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isBoyDropdownOpen ? 'rotate-180' : ''}`} />
            </button>
          </div>

          {/* Delivery Boy Selection Dropdown Modal */}
          {isBoyDropdownOpen && (
            <div className="absolute left-0 right-0 top-full mt-2 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl z-50 p-2.5 max-h-72 overflow-y-auto">
              <div className="relative mb-2">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={boySearchQuery}
                  onChange={(e) => setBoySearchQuery(e.target.value)}
                  placeholder="Filter delivery boy name..."
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl pl-8 pr-2.5 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-amber-400"
                />
              </div>

              <div className="space-y-1">
                {filteredBoys.map((boy, idx) => {
                  const normName = boy.name.trim().toUpperCase();
                  const summary = rosterSummaries[normName];
                  const billCount = summary?.total_deliveries || 0;
                  const isSelected = selectedBoy?.name === boy.name;
                  const scamInfo = boyScamStats[normName];
                  const hasScams = scamInfo && scamInfo.scamCount > 0;

                  return (
                    <div
                      key={boy.id || boy.name}
                      onClick={() => handleSelectBoy(boy)}
                      className={`p-2 rounded-xl cursor-pointer flex items-center justify-between text-xs transition-colors ${
                        isSelected ? 'bg-amber-400 text-slate-950 font-bold' : 'hover:bg-slate-800 text-slate-200'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className={`min-w-[24px] h-6 px-1 rounded-md flex items-center justify-center font-black text-[10px] ${
                          hasScams ? 'bg-rose-600 text-white' : isSelected ? 'bg-slate-950 text-amber-300' : 'bg-white/15 text-amber-300'
                        }`}>
                          #{idx + 1}
                        </span>
                        <span className="font-bold">{boy.name}</span>
                        {hasScams && (
                          <span className="text-[9px] bg-rose-600 text-white font-black px-1.5 py-0.2 rounded-full animate-pulse">
                            🚨 {scamInfo.scamCount} SCAM
                          </span>
                        )}
                      </div>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                        hasScams
                          ? 'bg-rose-600 text-white shadow-xs font-black'
                          : billCount > 0
                          ? (isSelected ? 'bg-slate-950 text-amber-300' : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30')
                          : 'text-slate-500'
                      }`}>
                        {billCount > 0 ? `${billCount} bills` : '0 bills'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: ALL DELIVERY BOYS OVERVIEW (STAFF MASTER VIEW)                      */}
      {/* ========================================================================= */}
      {activeTab === 'ROSTER' && (
        <div className="space-y-3">
          <div className="bg-white rounded-3xl p-4 shadow-sm border border-slate-200">
            <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-100">
              <div>
                <h2 className="text-xs font-black uppercase tracking-wider text-slate-800">
                  Delivery Boys Roster — {reportDate}
                </h2>
                <p className="text-[11px] text-slate-500">Every staff member sees live scanned bills here</p>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setIsExportOnlineModalOpen(true)}
                  className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-xs font-bold px-2.5 py-1 rounded-xl flex items-center gap-1 transition-all"
                  title="Print or Export All Online Bills"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Online Bills ({totalRosterOnlineCount})</span>
                </button>
                <button
                  onClick={() => loadRosterData(reportDate)}
                  disabled={isLoadingRoster}
                  className="text-slate-600 hover:text-indigo-800 text-xs font-bold flex items-center gap-1 px-2 py-1"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoadingRoster ? 'animate-spin' : ''}`} /> Refresh
                </button>
              </div>
            </div>

            {/* Export All Online Bills Big Xerox Banner */}
            <button
              type="button"
              onClick={() => setIsExportOnlineModalOpen(true)}
              className="w-full mb-3 bg-gradient-to-r from-indigo-700 via-blue-700 to-indigo-800 hover:from-indigo-600 hover:to-blue-600 active:scale-[0.99] text-white p-3 rounded-2xl shadow-md shadow-indigo-700/20 border-2 border-indigo-400/40 flex items-center justify-between gap-2.5 transition-all"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-slate-950 text-indigo-300 flex items-center justify-center font-black shrink-0 shadow-md border border-indigo-400/30">
                  <Printer className="w-5 h-5 text-indigo-300 animate-pulse" />
                </div>
                <div className="min-w-0 text-left">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[9px] font-black uppercase bg-slate-950 text-amber-300 px-1.5 py-0.2 rounded font-mono">
                      XEROX PRINT
                    </span>
                    <h3 className="text-xs font-black uppercase text-white truncate">
                      Export All Online Bills
                    </h3>
                  </div>
                  <p className="text-[11px] text-indigo-100 font-medium truncate mt-0.5">
                    Print single submission sheet for all delivery boys ({deliveryBoys.length} boys)
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="bg-amber-400 text-slate-950 text-xs font-black px-2.5 py-1 rounded-xl shadow-sm">
                  {totalRosterOnlineCount} Online Bills
                </span>
                <span className="text-indigo-200 text-sm">&rarr;</span>
              </div>
            </button>

            {/* Total Scams Alert Banner in Roster */}
            {totalRosterScamsCount > 0 && (
              <div className="mb-3 p-3.5 rounded-2xl bg-gradient-to-r from-rose-600 via-rose-700 to-red-800 text-white flex items-center justify-between gap-3 shadow-lg shadow-rose-600/30 border-2 border-rose-300 animate-pulse">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-white text-rose-600 flex items-center justify-center font-black shrink-0 shadow-md">
                    <ShieldAlert className="w-5 h-5 text-rose-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-black uppercase tracking-tight">
                      🚨 {totalRosterScamsCount} DOUBLE BILL SCAM{totalRosterScamsCount > 1 ? 'S' : ''} DETECTED IN ROSTER!
                    </p>
                    <p className="text-[11px] text-rose-100 font-medium truncate mt-0.5">
                      Identical cash memo numbers were submitted by multiple delivery boys today.
                    </p>
                  </div>
                </div>
                <span className="text-[10px] bg-white text-rose-700 font-black px-2.5 py-1 rounded-xl shrink-0 shadow-sm uppercase">
                  Audit Alert
                </span>
              </div>
            )}

            {isLoadingRoster ? (
              <div className="py-12 text-center text-slate-400">
                <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2 text-indigo-600" />
                <p className="text-xs font-semibold">Loading daily delivery boy bills...</p>
              </div>
            ) : (
              <div className="space-y-2">
                {deliveryBoys.map((boy, index) => {
                  const normName = boy.name.trim().toUpperCase();
                  const summary = rosterSummaries[normName];
                  const hasBills = summary && summary.total_deliveries > 0;
                  const scamInfo = boyScamStats[normName] || { scamCount: 0, duplicateWith: [] };
                  const hasScams = scamInfo.scamCount > 0;

                  const bpcl = bpclReportsMap[normName];
                  const isCheckedDone = bpcl?.checked_done ?? false;
                  const pendingCount = bpcl?.pending_bills?.length || 0;
                  const onlineCount = bpcl?.online_bills?.length || 0;

                  // 1. Scanned bills of delivery boys should be green as before!
                  // 2. Checked done with pending bills -> amber warning with big alert banner
                  // 3. Checked done with 0 pending bills -> verified emerald/teal
                  // 4. Zero bills recorded -> clean neutral slate
                  const cardStyle = hasScams
                    ? 'bg-rose-50/95 border-2 border-rose-400 hover:bg-rose-100/90 shadow-sm shadow-rose-500/10'
                    : isCheckedDone && pendingCount > 0
                    ? 'bg-gradient-to-r from-amber-50/95 via-orange-50/80 to-amber-50/95 border-2 border-amber-400 shadow-md shadow-amber-500/15 ring-1 ring-amber-300 hover:bg-amber-100/90'
                    : isCheckedDone && pendingCount === 0
                    ? 'bg-gradient-to-r from-emerald-50/90 via-teal-50/80 to-emerald-50/90 border-2 border-emerald-500 shadow-sm shadow-emerald-500/10 hover:border-emerald-600 hover:bg-emerald-100/90'
                    : hasBills
                    ? 'bg-emerald-50/60 border-2 border-emerald-300 hover:bg-emerald-50 hover:border-emerald-400 shadow-xs'
                    : 'bg-slate-50/70 border border-slate-200 hover:bg-slate-100';

                  const avatarStyle = hasScams
                    ? 'bg-gradient-to-br from-rose-600 to-red-700 text-white shadow-md'
                    : isCheckedDone && pendingCount > 0
                    ? 'bg-gradient-to-br from-amber-500 to-amber-600 text-slate-950 font-black shadow-md'
                    : hasBills
                    ? 'bg-emerald-600 text-white font-black shadow-sm'
                    : 'bg-slate-200 text-slate-600 font-bold';

                  return (
                    <div
                      key={boy.id || boy.name}
                      onClick={() => handleSelectBoy(boy)}
                      className={`p-3 sm:p-3.5 rounded-2xl border transition-all cursor-pointer flex flex-col gap-2 ${cardStyle}`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 flex items-center gap-3">
                          {/* Serial Number in Place of A, E, H */}
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-black text-sm shrink-0 shadow-sm ${avatarStyle}`}>
                            {index + 1}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <h3 className="font-bold text-sm text-slate-900">{boy.name}</h3>
                              {hasBills ? (
                                <span className={`text-[10px] font-black px-2 py-0.5 rounded-full shadow-xs ${
                                  hasScams ? 'bg-slate-800 text-white' : 'bg-emerald-600 text-white'
                                }`}>
                                  {summary.total_deliveries} Bills Scanned
                                </span>
                              ) : (
                                <span className="text-[10px] font-bold bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full">
                                  0 Bills
                                </span>
                              )}

                              {/* Bills Checked Done Badge on Roster */}
                              {isCheckedDone ? (
                                <span className="text-[10px] font-black bg-emerald-600 text-white px-2 py-0.5 rounded-full flex items-center gap-1 shadow-xs">
                                  <CheckCircle2 className="w-3 h-3 text-white" /> Bills Checked Done
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    await toggleBillsCheckedDone(reportDate, boy.name, boy.id, true);
                                    const updated = await fetchAllBpclReportsForDate(reportDate);
                                    setBpclReportsMap(updated);
                                    if (selectedBoyRef.current?.name.trim().toUpperCase() === normName) {
                                      setActiveBpclReport(updated[normName] || null);
                                    }
                                    toast.success(`Marked bills checked done for ${boy.name}`);
                                  }}
                                  className="text-[10px] font-bold bg-white text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 border border-slate-300 hover:border-emerald-400 px-2 py-0.5 rounded-full transition-all shadow-2xs"
                                  title="Click to mark bills checked done"
                                >
                                  ⚪ Mark Checked
                                </button>
                              )}

                              {/* Pending Bills Counter Badge */}
                              {pendingCount > 0 && (
                                <span className="text-[10px] font-black bg-amber-500 text-slate-950 px-2 py-0.5 rounded-full flex items-center gap-0.5 shadow-xs">
                                  ⚠️ {pendingCount} Pending
                                </span>
                              )}

                              {/* Online Bills Counter Badge */}
                              {onlineCount > 0 && (
                                <span className="text-[10px] font-black bg-indigo-100 text-indigo-800 border border-indigo-300 px-2 py-0.5 rounded-full flex items-center gap-0.5">
                                  🌐 {onlineCount} Online
                                </span>
                              )}

                              {hasScams && (
                                <span className="text-[10px] font-black bg-rose-600 text-white px-2 py-0.5 rounded-full shadow-xs animate-pulse flex items-center gap-1">
                                  <ShieldAlert className="w-3 h-3" /> {scamInfo.scamCount} SCAM BILL{scamInfo.scamCount > 1 ? 'S' : ''}
                                </span>
                              )}
                            </div>

                            {hasBills ? (
                              <div>
                                <div className="flex items-center gap-2 mt-1 flex-wrap text-[11px] font-medium text-slate-600">
                                  <span>Std: <b>{summary.domestic_14kg}</b></span>
                                  {summary.composite_10kg > 0 && <span className="text-purple-700 font-bold">10kg: {summary.composite_10kg}</span>}
                                  <span className="text-emerald-700 font-bold">Cash: {summary.cash_count}</span>
                                  <span className="text-blue-700 font-bold">UPI: {summary.upi_count}</span>
                                  {summary.due_count > 0 && <span className="text-rose-600 font-bold">Due: {summary.due_count}</span>}
                                </div>
                                {hasScams && (
                                  <div className="mt-1.5 flex items-center gap-1 text-[11px] font-bold text-rose-700 bg-rose-100/90 px-2 py-0.5 rounded-lg border border-rose-300 w-fit">
                                    <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0 animate-bounce" />
                                    <span>
                                      🚨 {scamInfo.scamCount} duplicate bill already given by{' '}
                                      <span className="font-black underline uppercase text-rose-950">
                                        {scamInfo.duplicateWith.join(', ') || 'another agent'}
                                      </span>!
                                    </span>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <p className="text-[11px] text-slate-400 mt-0.5">No bills recorded yet for this date</p>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedBoy(boy);
                              selectedBoyRef.current = boy;
                              const norm = boy.name.trim().toUpperCase();
                              setActiveBpclReport(bpclReportsMap[norm] || null);
                              setIsBpclModalOpen(true);
                            }}
                            className={`px-2 py-1.5 rounded-xl border transition-all active:scale-95 flex items-center gap-1 shadow-xs ${
                              isCheckedDone
                                ? 'bg-purple-100 hover:bg-purple-200 text-purple-800 border-purple-300'
                                : 'bg-purple-50 hover:bg-purple-100 text-purple-700 border-purple-200'
                            }`}
                            title="Add / Paste BPCL AI Status Report"
                          >
                            <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                            <span className="text-[10px] font-bold hidden sm:inline">AI Check</span>
                          </button>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSelectBoy(boy);
                            }}
                            className={`font-bold px-3 py-1.5 rounded-xl text-xs border shadow-xs flex items-center gap-1 transition-all ${
                              hasScams
                                ? 'bg-rose-600 hover:bg-rose-700 text-white border-rose-600 shadow-sm shadow-rose-600/30'
                                : 'bg-white hover:bg-blue-50 text-blue-700 border-blue-200'
                            }`}
                          >
                            {hasScams ? 'Inspect Scam' : hasBills ? 'View / Edit' : 'Scan Bills'}
                            <ChevronRight className={`w-3.5 h-3.5 ${hasScams ? 'text-white' : 'text-blue-500'}`} />
                          </button>
                        </div>
                      </div>

                      {/* BIG HIGH-VISIBILITY ALERT FOR PENDING BILLS */}
                      {pendingCount > 0 && (
                        <div className="mt-1 p-2 sm:p-2.5 bg-gradient-to-r from-amber-500 via-amber-600 to-orange-500 text-slate-950 font-black text-xs rounded-xl flex items-center justify-between shadow-md shadow-amber-500/25 border border-amber-300 animate-pulse">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-base leading-none">🚨</span>
                            <div className="min-w-0 text-left">
                              <div className="text-[11px] font-black uppercase tracking-tight truncate">
                                {pendingCount} PENDING BILL{pendingCount > 1 ? 'S' : ''} DETECTED!
                              </div>
                              <div className="text-[9px] font-bold text-amber-950/85 -mt-0.5 truncate">
                                Action required: deliver or clear pending bills
                              </div>
                            </div>
                          </div>
                          <span className="bg-slate-950 text-amber-300 px-2.5 py-1 rounded-lg text-[10px] font-black uppercase shrink-0 flex items-center gap-1 shadow-sm">
                            <span>View</span> &rarr;
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: ACTIVE DELIVERY BOY BILL SCANNER & EDIT VIEW                         */}
      {/* ========================================================================= */}
      {activeTab === 'SCAN' && selectedBoy && (
        <div className="space-y-3">
          {/* Active Boy Status Banner */}
          <div className="bg-white rounded-2xl p-3 border border-slate-200 shadow-sm flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-8 h-8 rounded-xl bg-blue-100 text-blue-700 font-black flex items-center justify-center text-xs">
                #{selectedBoyIndex || 1}
              </span>
              <div>
                <h2 className="text-xs font-black text-slate-900 leading-tight">
                  {selectedBoy.name}'s Delivery Bills
                </h2>
                <p className="text-[10px] text-slate-500 flex items-center gap-1">
                  {lastSavedTime ? (
                    <>
                      <CheckCheck className="w-3 h-3 text-emerald-600" /> Last saved to database: {lastSavedTime}
                    </>
                  ) : (
                    'Not saved to database yet'
                  )}
                  {hasUnsavedChanges && (
                    <span className="text-amber-600 font-bold flex items-center gap-0.5">
                      • Unsaved Changes
                    </span>
                  )}
                </p>
              </div>
            </div>

            <button
              onClick={handleSaveToDatabase}
              disabled={isSavingDb}
              className={`active:scale-95 font-black px-3.5 py-1.5 rounded-xl text-xs flex items-center gap-1.5 shadow-md transition-all shrink-0 ${
                hasUnsavedChanges
                  ? 'bg-amber-400 hover:bg-amber-300 text-slate-950 ring-2 ring-amber-300 shadow-amber-500/30 animate-pulse'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/20 disabled:opacity-50'
              }`}
            >
              {isSavingDb ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {isSavingDb ? 'Saving...' : hasUnsavedChanges ? 'Save Changes' : 'Saved'}
            </button>
          </div>

          {/* Gemini AI Receipt Scanner Launch Banner */}
          <button
            type="button"
            onClick={() => setIsLiveScannerOpen(true)}
            className="w-full bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 hover:from-amber-600 hover:to-orange-600 text-white font-bold p-3.5 rounded-3xl shadow-xl shadow-orange-500/25 active:scale-[0.99] transition-all flex items-center justify-between border-2 border-amber-300"
          >
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-slate-950 flex items-center justify-center text-amber-400 shrink-0 shadow-lg border border-amber-400/40">
                <Camera className="w-6 h-6 animate-pulse text-amber-400" />
              </div>
              <div className="text-left">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-black uppercase bg-slate-950 text-amber-300 px-2 py-0.5 rounded-md font-mono">CAMERA AI</span>
                  <h3 className="text-sm font-black tracking-tight uppercase text-white">RECEIPT SCANNER</h3>
                </div>
                <p className="text-[11px] font-semibold text-amber-100 mt-0.5">Snap cash memos to auto-extract Cons No & Name</p>
              </div>
            </div>
            <span className="bg-slate-950 text-amber-300 border-2 border-amber-400 text-xs font-black px-3.5 py-2 rounded-2xl uppercase tracking-wider shrink-0 shadow-xl flex items-center gap-1.5">
              <Camera className="w-4 h-4 text-amber-400" />
              <span>SCAN BILLS</span>
            </span>
          </button>

          {/* Real-time KPI Metric Summary Strip */}
          <div className="bg-white rounded-2xl p-3 shadow-sm border border-slate-200">
            <div className="grid grid-cols-4 gap-2 text-center">
              <div className="bg-blue-50/80 rounded-xl p-2 border border-blue-100">
                <span className="text-[10px] font-bold text-blue-600 block uppercase">Total Bills</span>
                <span className="text-base font-black text-blue-950">{kpis.totalDeliveries}</span>
              </div>
              <div className="bg-purple-50/80 rounded-xl p-2 border border-purple-100">
                <span className="text-[10px] font-bold text-purple-600 block uppercase">10kg Lite</span>
                <span className="text-base font-black text-purple-950">{kpis.count10kg}</span>
              </div>
              <div className="bg-emerald-50/80 rounded-xl p-2 border border-emerald-100">
                <span className="text-[10px] font-bold text-emerald-600 block uppercase">Cash</span>
                <span className="text-base font-black text-emerald-950">{kpis.cashCount}</span>
              </div>
              <div className="bg-indigo-50/80 rounded-xl p-2 border border-indigo-100">
                <span className="text-[10px] font-bold text-indigo-600 block uppercase">UPI</span>
                <span className="text-base font-black text-indigo-950">{kpis.upiCount}</span>
              </div>
            </div>
          </div>

          {/* Double-Bill Scam Alert Banner */}
          {duplicateScamCount > 0 && (
            <div className="bg-gradient-to-r from-rose-600 via-rose-700 to-red-800 text-white p-3.5 rounded-2xl shadow-xl shadow-rose-600/30 flex items-center justify-between gap-3 border-2 border-rose-300 animate-pulse">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-white text-rose-600 flex items-center justify-center font-black shrink-0 shadow-md">
                  <ShieldAlert className="w-5 h-5 text-rose-600" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-xs font-black tracking-tight leading-tight uppercase flex items-center gap-1.5">
                    <span>🚨 {duplicateScamCount} Double Bill Scam{duplicateScamCount > 1 ? 's' : ''} Detected!</span>
                  </h3>
                  <p className="text-[11px] text-rose-100 font-medium truncate mt-0.5">
                    {duplicateScamCount === 1 ? 'This bill was' : 'These bills were'} already claimed by another delivery boy today!
                  </p>
                </div>
              </div>
              <span className="text-[10px] font-black uppercase bg-white text-rose-700 px-2.5 py-1 rounded-xl shrink-0 shadow-sm">
                Scam Alert
              </span>
            </div>
          )}

          {/* BPCL AI Verification: Pending & Online Bills Viewer */}
          <BpclBillsView
            report={activeBpclReport}
            agentName={selectedBoy.name}
            reportDate={reportDate}
            scannedEntries={entries}
            onOpenPasteModal={() => setIsBpclModalOpen(true)}
            onToggleCheckedDone={handleToggleActiveCheckedDone}
            onAddBillToScanned={handleAddPendingBillToScanned}
            onOpenExportAllOnline={() => setIsExportOnlineModalOpen(true)}
            onConvertBillToOnline={handleConvertBillToOnline}
            onConvertAllOnlineConflicts={handleConvertAllOnlineConflicts}
            onReportUpdated={(newRep) => {
              setActiveBpclReport(newRep);
              const norm = (newRep.agent_name || '').trim().toUpperCase();
              setBpclReportsMap((prev) => ({ ...prev, [norm]: newRep }));
            }}
          />

          {/* Quick Search & Bulk Paste Tabs */}
          <div className="bg-slate-200/80 p-1 rounded-2xl grid grid-cols-2 gap-1">
            <button
              onClick={() => setInputMode('single')}
              className={`py-2 px-1 rounded-xl text-[11px] font-bold transition-all flex items-center justify-center gap-1 ${
                inputMode === 'single' ? 'bg-white text-blue-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Search className="w-3.5 h-3.5" /> Search (33k+ Database)
            </button>
            <button
              onClick={() => setInputMode('bulk')}
              className={`py-2 px-1 rounded-xl text-[11px] font-bold transition-all flex items-center justify-center gap-1 ${
                inputMode === 'bulk' ? 'bg-white text-purple-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <FileText className="w-3.5 h-3.5" /> Bulk Paste Numbers
            </button>
          </div>

          {/* Input Section Card */}
          <div className="bg-white rounded-3xl p-3.5 shadow-sm border border-slate-200">
            {inputMode === 'single' ? (
              <div className="relative" ref={searchContainerRef}>
                <form onSubmit={handleAddSingle} className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={singleInput}
                      onChange={(e) => setSingleInput(e.target.value)}
                      onFocus={() => {
                        if (suggestions.length > 0) setShowSuggestions(true);
                      }}
                      placeholder="Search consumer number or customer name..."
                      className="w-full pl-9 pr-8 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-600 font-medium text-slate-800"
                    />
                    {singleInput && (
                      <button
                        type="button"
                        onClick={() => {
                          setSingleInput('');
                          setSuggestions([]);
                          setShowSuggestions(false);
                        }}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                    {isSearching && (
                      <Loader2 className="w-4 h-4 text-blue-600 animate-spin absolute right-8 top-1/2 -translate-y-1/2" />
                    )}
                  </div>
                  <button
                    type="submit"
                    className="bg-blue-600 text-white px-4 py-2.5 rounded-2xl text-sm font-bold hover:bg-blue-700 active:scale-95 transition-all flex items-center gap-1 shrink-0 shadow-md shadow-blue-600/20"
                  >
                    <Plus className="w-4 h-4" /> Add
                  </button>
                </form>

                {/* Suggestions Dropdown */}
                {showSuggestions && suggestions.length > 0 && (
                  <div className="absolute left-0 right-0 top-full mt-1.5 bg-white border border-blue-100 rounded-2xl shadow-2xl z-50 max-h-72 overflow-y-auto divide-y divide-slate-100 ring-1 ring-slate-900/5">
                    <div className="px-3 py-1.5 bg-slate-50 text-[11px] font-semibold text-slate-500 flex items-center justify-between sticky top-0 border-b border-slate-100">
                      <span>Matches ({suggestions.length})</span>
                      <span className="text-[10px] text-blue-600 font-semibold">Tap to add</span>
                    </div>
                    {suggestions.map((item) => (
                      <div
                        key={item.consumer_number}
                        onClick={() => handleSelectSuggestion(item)}
                        className="p-3 hover:bg-blue-50/80 cursor-pointer transition-colors flex items-center justify-between group"
                      >
                        <div className="min-w-0 pr-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-sm text-blue-900 font-mono">
                              #{item.consumer_number}
                            </span>
                            <span className="font-semibold text-xs text-slate-800">
                              {item.consumer_name}
                            </span>
                            {item.cylinder_type === '10KG_LITE' && (
                              <span className="text-[9px] bg-purple-600 text-white font-bold px-1.5 py-0.5 rounded-md">
                                10kg Lite
                              </span>
                            )}
                          </div>
                          {item.address && (
                            <p className="text-[11px] text-slate-500 truncate max-w-xs flex items-center gap-1 mt-0.5">
                              <MapPin className="w-3 h-3 text-slate-400 shrink-0" /> {item.address}
                            </p>
                          )}
                        </div>
                        <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-blue-600 transition-colors shrink-0" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div>
                <label className="text-xs text-slate-600 font-medium block mb-1">
                  Paste Consumer Numbers (comma/space/newline separated):
                </label>
                <textarea
                  value={rawInput}
                  onChange={(e) => setRawInput(e.target.value)}
                  rows={3}
                  placeholder="Paste numbers e.g. 20365944, 20409893, 20486077..."
                  className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-slate-800"
                />
                <button
                  type="button"
                  onClick={handleProcessBulkInput}
                  disabled={isProcessing || !rawInput.trim()}
                  className="w-full mt-2 bg-indigo-600 text-white py-2.5 rounded-2xl text-xs font-bold hover:bg-indigo-700 disabled:opacity-50 active:scale-98 transition-all flex items-center justify-center gap-2 shadow-md shadow-indigo-600/20"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Verifying against 33k Database...
                    </>
                  ) : (
                    'Process Bulk Numbers'
                  )}
                </button>
              </div>
            )}
          </div>

          {/* Deliveries List */}
          <div className="bg-white rounded-3xl p-3.5 shadow-sm border border-slate-200">
            <div className="flex items-center justify-between mb-2.5 pb-2 border-b border-slate-100">
              <h2 className="text-xs font-bold text-slate-800 flex items-center gap-2 uppercase tracking-wider">
                <span>Completed Deliveries</span>
                <span className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full font-black">
                  {entries.length}
                </span>
              </h2>
              {entries.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={handleCopyCsvNumbers}
                    className="text-[11px] text-indigo-600 hover:text-indigo-700 font-semibold flex items-center gap-1 hover:bg-indigo-50 px-2 py-1 rounded-lg transition-colors"
                  >
                    {copiedCsv ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedCsv ? 'Copied CSV' : 'Copy CSV'}
                  </button>
                  <button
                    onClick={async () => {
                      if (confirm(`Clear all bills for ${selectedBoy.name}?`)) {
                        setEntries([]);
                        setHasUnsavedChanges(true);

                        if (selectedBoy) {
                          try {
                            const userMeta = await supabase.auth.getUser();
                            const staffName = userMeta?.data?.user?.user_metadata?.name || 'Staff';
                            await saveDayEndReportToDatabase({
                              report_date: reportDate,
                              agent_id: selectedBoy.id,
                              agent_name: selectedBoy.name,
                              entries: [],
                              scanned_by_staff: staffName,
                              supervisor_phone: supervisorPhone,
                            });
                            const nowFormatted = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                            setLastSavedTime(nowFormatted);
                            setHasUnsavedChanges(false);

                            const normName = selectedBoy.name.trim().toUpperCase();
                            setRosterSummaries((prev) => ({
                              ...prev,
                              [normName]: {
                                ...prev[normName],
                                report_date: reportDate,
                                agent_id: selectedBoy.id,
                                agent_name: selectedBoy.name,
                                total_deliveries: 0,
                                domestic_14kg: 0,
                                composite_10kg: 0,
                                commercial_19kg: 0,
                                empties_collected: 0,
                                cash_count: 0,
                                upi_count: 0,
                                due_count: 0,
                                entries: [],
                                updated_at: new Date().toISOString(),
                              },
                            }));

                            await loadRosterData(reportDate);
                            toast.success(`Cleared all bills for ${selectedBoy.name} & updated database!`);
                          } catch (err) {
                            console.warn('Clear auto-sync notice:', err);
                          }
                        }
                      }
                    }}
                    className="text-[11px] text-rose-600 hover:text-rose-700 font-semibold flex items-center gap-1 hover:bg-rose-50 px-2 py-1 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Clear
                  </button>
                </div>
              )}
            </div>

            {/* In-List Search */}
            {entries.length > 0 && (
              <div className="relative mb-3">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={listSearchQuery}
                  onChange={(e) => setListSearchQuery(e.target.value)}
                  placeholder="Filter bills by number, name or address..."
                  className="w-full pl-8 pr-7 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-blue-600 text-slate-800"
                />
                {listSearchQuery && (
                  <button
                    onClick={() => setListSearchQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}

            {entries.length === 0 ? (
              <div className="text-center py-8 text-slate-400">
                <ClipboardList className="w-9 h-9 mx-auto mb-1.5 opacity-40 text-slate-400" />
                <p className="text-xs font-bold text-slate-600">No bills added for {selectedBoy.name} yet</p>
                <p className="text-[11px] text-slate-400 mt-0.5">Use the Camera Scanner or Quick Search above</p>
              </div>
            ) : (
              <div className="space-y-2 pr-0.5">
                {displayedEntries.map((item, index) => {
                  const originalIndex = entries.findIndex((e) => e.consumer_number === item.consumer_number);
                  const otherClaimant = item.duplicate_of_agent
                    ? { agentName: item.duplicate_of_agent, date: item.duplicate_claimed_date }
                    : crossAgentClaimedMap[item.consumer_number.toLowerCase()];

                  return (
                    <div
                      key={`${item.consumer_number}-${index}`}
                      className={`p-3 rounded-2xl border transition-colors ${
                        otherClaimant
                          ? 'border-2 border-rose-400 bg-rose-50/70 shadow-sm'
                          : 'border border-slate-100 bg-slate-50/90 hover:bg-slate-100'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2.5 min-w-0">
                          <span className={`flex-shrink-0 w-6 h-6 rounded-full text-[11px] font-black flex items-center justify-center mt-0.5 ${
                            otherClaimant ? 'bg-rose-600 text-white' : 'bg-blue-600 text-white'
                          }`}>
                            {originalIndex + 1}
                          </span>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-bold text-xs text-slate-900 font-mono">
                                #{item.consumer_number}
                              </span>
                              {otherClaimant ? (
                                <span className="inline-flex items-center gap-1 text-[9px] bg-rose-600 text-white font-black px-2 py-0.5 rounded-md shadow-xs animate-pulse">
                                  <ShieldAlert className="w-2.5 h-2.5" /> GIVEN BY {otherClaimant.agentName.toUpperCase()}
                                </span>
                              ) : item.found ? (
                                <span className="inline-flex items-center gap-0.5 text-[9px] bg-emerald-100 text-emerald-700 font-bold px-1.5 py-0.5 rounded-md">
                                  <CheckCheck className="w-2.5 h-2.5" /> Verified
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-0.5 text-[9px] bg-amber-100 text-amber-700 font-bold px-1.5 py-0.5 rounded-md">
                                  <XCircle className="w-2.5 h-2.5" /> Unverified
                                </span>
                              )}
                              {item.source === 'camera' && (
                                <span className="inline-flex items-center gap-0.5 text-[9px] bg-orange-100 text-orange-700 font-bold px-1.5 py-0.5 rounded-md">
                                  <Camera className="w-2.5 h-2.5" /> AI Scan
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-slate-800 font-bold truncate mt-0.5">{item.consumer_name}</p>
                            {item.address && (
                              <p className="text-[10px] text-slate-500 truncate max-w-xs">{item.address}</p>
                            )}

                            {/* Double-Bill Scam Warning Box */}
                            {otherClaimant && (
                              <div className="mt-2 p-2 rounded-xl bg-rose-100/90 border border-rose-300 text-rose-950 flex items-start gap-2 text-xs">
                                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5 animate-bounce" />
                                <div className="min-w-0">
                                  <p className="font-black text-rose-700 leading-tight">
                                    🚨 DOUBLE BILL SCAM DETECTED!
                                  </p>
                                  <p className="text-[11px] font-semibold text-rose-900 mt-0.5 leading-snug">
                                    This cash memo was already submitted by{' '}
                                    <span className="font-black underline uppercase text-rose-950">
                                      {otherClaimant.agentName}
                                    </span>{' '}
                                    on {otherClaimant.date || reportDate}! Another delivery boy cannot submit the same bill.
                                  </p>
                                </div>
                              </div>
                            )}

                            {/* Interactive Toggle Pills directly on the card */}
                            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                              {/* Cylinder Type Toggle */}
                              <button
                                type="button"
                                onClick={() => handleToggleCylinder(originalIndex)}
                                className={`text-[10px] font-bold px-2 py-0.5 rounded-lg border transition-all ${
                                  item.cylinder_type === '10KG_LITE'
                                    ? 'bg-purple-100 text-purple-700 border-purple-300'
                                    : item.cylinder_type === '19KG_COMM'
                                    ? 'bg-amber-100 text-amber-800 border-amber-300'
                                    : 'bg-slate-200 text-slate-700 border-slate-300'
                                }`}
                                title="Tap to change cylinder type"
                              >
                                {item.cylinder_type === '10KG_LITE' ? '10kg Lite' : item.cylinder_type === '19KG_COMM' ? '19kg Comm' : '14.2kg Std'}
                              </button>

                              {/* Payment Mode Toggle */}
                              <button
                                type="button"
                                onClick={() => handleTogglePayment(originalIndex)}
                                className={`text-[10px] font-bold px-2 py-0.5 rounded-lg border transition-all ${
                                  item.payment_mode === 'CASH'
                                    ? 'bg-emerald-100 text-emerald-700 border-emerald-300'
                                    : item.payment_mode === 'UPI'
                                    ? 'bg-blue-100 text-blue-700 border-blue-300'
                                    : 'bg-rose-100 text-rose-700 border-rose-300'
                                }`}
                                title="Tap to change payment mode"
                              >
                                {item.payment_mode}
                              </button>

                              {/* Empty Cylinder Toggle */}
                              <button
                                type="button"
                                onClick={() => handleToggleEmpty(originalIndex)}
                                className={`text-[10px] font-bold px-2 py-0.5 rounded-lg border transition-all ${
                                  item.empty_collected
                                    ? 'bg-teal-100 text-teal-800 border-teal-300'
                                    : 'bg-slate-100 text-slate-400 border-slate-200 line-through'
                                }`}
                                title="Tap to toggle empty collected"
                              >
                                {item.empty_collected ? 'Empty: Yes' : 'Empty: No'}
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* Delete Button */}
                        <button
                          onClick={() => handleRemoveEntry(originalIndex)}
                          className="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors shrink-0"
                          title="Remove"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* FLOATING ACTION DOCK: DIRECT DATABASE SAVE (PRIMARY)                       */}
      {/* ========================================================================= */}
      {activeTab === 'SCAN' && selectedBoy && (
        isFloatingDockMinimized ? (
          <button
            type="button"
            onClick={() => setIsFloatingDockMinimized(false)}
            className={`fixed bottom-[74px] right-3 z-40 px-3.5 py-2 rounded-2xl shadow-2xl flex items-center gap-2 font-black text-xs backdrop-blur-md border transition-all active:scale-95 ${
              hasUnsavedChanges
                ? 'bg-amber-400 text-slate-950 border-amber-300 ring-2 ring-amber-300 animate-pulse shadow-amber-500/30'
                : 'bg-slate-900/95 text-emerald-400 border-slate-700 shadow-slate-950/40'
            }`}
            title="Expand Save Dock"
          >
            {hasUnsavedChanges ? (
              <>
                <Save className="w-3.5 h-3.5 text-slate-950" />
                <span>Save ({entries.length})</span>
              </>
            ) : (
              <>
                <CheckCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>{entries.length} Saved</span>
              </>
            )}
            <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
          </button>
        ) : (
          <div className="fixed bottom-[68px] left-3 right-3 z-40 max-w-2xl mx-auto animate-in fade-in slide-in-from-bottom-2 duration-150">
            <div className="bg-slate-900/95 backdrop-blur-md border border-slate-700/80 p-2 sm:p-2.5 rounded-2xl shadow-2xl flex gap-1.5 sm:gap-2 items-center">
              {/* Primary Action: Save to Database */}
              <button
                onClick={handleSaveToDatabase}
                disabled={isSavingDb || (entries.length === 0 && !hasUnsavedChanges)}
                className={`flex-1 active:scale-98 text-white py-2.5 sm:py-3 px-3 sm:px-4 rounded-xl font-black text-xs sm:text-sm disabled:opacity-50 transition-all flex items-center justify-center gap-2 shadow-lg ${
                  hasUnsavedChanges
                    ? 'bg-amber-400 hover:bg-amber-300 text-slate-950 shadow-amber-500/30 animate-pulse'
                    : 'bg-emerald-700/90 hover:bg-emerald-600 text-white shadow-emerald-700/20'
                }`}
              >
                {isSavingDb ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Saving to Database...
                  </>
                ) : hasUnsavedChanges ? (
                  <>
                    <Save className="w-4 h-4" /> Save Changes ({entries.length} Bills)
                  </>
                ) : (
                  <>
                    <CheckCheck className="w-4 h-4 text-emerald-300" /> Saved ({entries.length} Bills in Database)
                  </>
                )}
              </button>

              {/* Quick Camera Scanner Button in Floating Dock */}
              <button
                type="button"
                onClick={() => setIsLiveScannerOpen(true)}
                className="bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 active:scale-95 text-slate-950 p-2.5 sm:p-3 rounded-xl transition-all flex items-center justify-center shrink-0 font-black shadow-md shadow-amber-400/30"
                title="Open Gemini AI Camera Scanner"
              >
                <Camera className="w-4 h-4 text-slate-950" />
              </button>

              {/* Secondary Option: WhatsApp Share (Optional) */}
              <button
                onClick={handleShareWhatsApp}
                disabled={entries.length === 0}
                className="bg-white/10 hover:bg-white/20 active:scale-98 text-white p-2.5 sm:p-3 rounded-xl disabled:opacity-40 transition-all flex items-center justify-center shrink-0 border border-white/10"
                title="Share WhatsApp copy (Optional)"
              >
                <Send className="w-4 h-4 text-emerald-400" />
              </button>

              {/* Secondary Option: Copy CSV */}
              <button
                onClick={handleCopyCsvNumbers}
                disabled={entries.length === 0}
                className="bg-white/10 hover:bg-white/20 active:scale-98 text-white p-2.5 sm:p-3 rounded-xl disabled:opacity-40 transition-all flex items-center justify-center shrink-0 border border-white/10"
                title="Copy CSV Numbers"
              >
                {copiedCsv ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-slate-300" />}
              </button>

              {/* Minimize Dock Button */}
              <button
                type="button"
                onClick={() => setIsFloatingDockMinimized(true)}
                className="bg-white/5 hover:bg-white/15 text-slate-400 hover:text-white p-2 sm:p-2.5 rounded-xl transition-all flex items-center justify-center shrink-0 border border-white/5"
                title="Minimize save dock to view bills"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )
      )}
      </div>

      {/* Live Camera Scanner Modal */}
      <div className="print:hidden">
        <LiveCameraScannerModal
          isOpen={isLiveScannerOpen}
          onClose={() => setIsLiveScannerOpen(false)}
          onConsumerScanned={handleConsumerAutoScanned}
          existingNumbers={entries.map((e) => e.consumer_number)}
          claimedByOtherAgents={crossAgentClaimedMap}
          agentName={selectedBoy?.name}
          agentId={selectedBoy?.id}
        />
      </div>

      {/* BPCL AI Status Report Paste & Parse Modal */}
      {isBpclModalOpen && (
        <div className="print:hidden">
          <BpclReportModal
            isOpen={isBpclModalOpen}
            onClose={() => setIsBpclModalOpen(false)}
            agentName={selectedBoy ? selectedBoy.name : 'Delivery Boy'}
            agentId={selectedBoy?.id}
            reportDate={reportDate}
            existingReport={activeBpclReport}
            onSaved={(newRep) => {
              setActiveBpclReport(newRep);
              const norm = (newRep.agent_name || '').trim().toUpperCase();
              setBpclReportsMap((prev) => ({ ...prev, [norm]: newRep }));
            }}
          />
        </div>
      )}

      {/* Export All Online Bills Sheet Modal */}
      {isExportOnlineModalOpen && (
        <ExportOnlineBillsModal
          isOpen={isExportOnlineModalOpen}
          onClose={() => setIsExportOnlineModalOpen(false)}
          reportDate={reportDate}
          deliveryBoys={deliveryBoys}
          bpclReportsMap={bpclReportsMap}
        />
      )}

      <div className="print:hidden">
        <AgentBottomNav />
      </div>
    </div>
  );
};

export default StaffDayEndSummary;
