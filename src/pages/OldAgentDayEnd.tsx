import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import db, { type Consumer } from '../lib/db';
import { supabase } from '../lib/supabase';
import { AgentBottomNav } from '../components/AgentBottomNav';
import { 
  Send, 
  Trash2, 
  Plus, 
  Copy, 
  ClipboardList, 
  Search, 
  User, 
  Loader2, 
  X, 
  ArrowLeft,
  Calendar,
  Save,
  CheckCircle2,
  Edit2,
  Camera,
  Layers,
  Database,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  Minus,
  CheckCheck,
  Users,
  ShieldAlert,
  AlertTriangle,
  Check,
  Lock,
  Sparkles,
  Clock,
  Globe
} from 'lucide-react';
import toast from 'react-hot-toast';
import { LiveCameraScannerModal } from '../components/LiveCameraScannerModal';
import { matchConsumerWithDatabase } from '../lib/consumerMatcher';
import { 
  getDayEndDeliveryBoys,
  fetchAllDayEndReportsForDate,
  fetchDayEndReportForAgent, 
  saveDayEndReportToDatabase, 
  type DayEndEntry,
  type DayEndReportSummary
} from '../lib/dayEndService';
import type { DeliveryBoy } from '../lib/agentService';
import { isCurrentStaffOrManager, refreshCurrentStaffPermission } from '../lib/staffAuth';
import { 
  getAgentAssignedDeliveryBoy, 
  fetchAgentDeliveryBoyAssignments,
  resolveCurrentAgentDeliveryBoy 
} from '../lib/agentAssignmentService';
import { 
  fetchBpclReport, 
  toggleBillsCheckedDone, 
  type BpclReportData, 
  type BpclBillItem 
} from '../lib/bpclReportService';
import { BpclReportModal } from '../components/BpclReportModal';
import { BpclBillsView } from '../components/BpclBillsView';

export interface ItemEntry {
  consumer_id?: string;
  consumer_number: string;
  consumer_name: string;
  address?: string;
  mobile?: string;
  found: boolean;
  source?: 'local' | 'remote' | 'manual' | 'route' | 'camera';
  cylinder_type: '14.2KG_STD' | '10KG_LITE' | '19KG_COMM';
  payment_mode: 'CASH' | 'UPI' | 'DUE';
  empty_collected: boolean;
  dispatch_item_id?: string;
  scanned_at?: string;
  duplicate_of_agent?: string;
}

interface Supervisor {
  id: string;
  name: string;
  username: string;
  phone?: string;
}

// Device ID helper for device-isolated storage
const getDeviceId = (): string => {
  try {
    let deviceId = localStorage.getItem('bgcls_device_id');
    if (!deviceId) {
      deviceId = 'dev_' + Math.random().toString(36).substring(2, 10) + '_' + Date.now().toString(36);
      localStorage.setItem('bgcls_device_id', deviceId);
    }
    return deviceId;
  } catch {
    return 'dev_default';
  }
};

const getDeviceScopedKey = (agentId?: string, dateStr?: string): string => {
  const devId = getDeviceId();
  const agent = agentId || localStorage.getItem('bgcls_agent_id') || 'agent_default';
  const date = dateStr || new Date().toISOString().split('T')[0];
  return `bgcls_day_end_entries_${devId}_${agent}_${date}`;
};

const getWorkingDraftKey = (dateStr: string, agentName: string): string => {
  const norm = (agentName || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '_');
  return `bgcls_day_end_working_draft_${dateStr}_${norm}`;
};

// Normalize backward compatible entries
const normalizeStoredEntries = (rawItems: any[]): ItemEntry[] => {
  if (!Array.isArray(rawItems)) return [];
  return rawItems.map((item) => ({
    consumer_id: item.consumer_id,
    consumer_number: String(item.consumer_number || ''),
    consumer_name: String(item.consumer_name || 'Consumer Record'),
    address: item.address,
    mobile: item.mobile,
    found: item.found !== undefined ? Boolean(item.found) : true,
    source: item.source || 'local',
    cylinder_type: item.cylinder_type === '10KG_LITE' ? '10KG_LITE' : item.cylinder_type === '19KG_COMM' ? '19KG_COMM' : '14.2KG_STD',
    payment_mode: item.payment_mode === 'UPI' ? 'UPI' : item.payment_mode === 'DUE' ? 'DUE' : 'CASH',
    empty_collected: item.empty_collected !== undefined ? Boolean(item.empty_collected) : true,
    dispatch_item_id: item.dispatch_item_id,
    scanned_at: item.scanned_at,
  }));
};

// Helper to safely load stored entries for a specific agent and date
const loadEntriesForDate = (agent: string, dateStr: string): ItemEntry[] => {
  try {
    const devId = getDeviceId();
    const currentAgent = agent || localStorage.getItem('bgcls_agent_id') || 'agent_default';
    const date = dateStr || new Date().toISOString().split('T')[0];

    const scopedKey = getDeviceScopedKey(currentAgent, date);
    const savedScoped = localStorage.getItem(scopedKey);
    if (savedScoped) {
      return normalizeStoredEntries(JSON.parse(savedScoped));
    }
  } catch (e) {
    console.error('Error loading scoped entries:', e);
  }
  return [];
};

export const OldAgentDayEnd: React.FC = () => {
  const navigate = useNavigate();

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/agent/search');
    }
  };

  // Delivery Boys Roster & Selection State
  const [deliveryBoys, setDeliveryBoys] = useState<DeliveryBoy[]>([]);
  const [selectedBoy, setSelectedBoy] = useState<DeliveryBoy | null>(null);
  const [isBoyDropdownOpen, setIsBoyDropdownOpen] = useState<boolean>(false);
  const [boySearchQuery, setBoySearchQuery] = useState<string>('');
  const [rosterSummaries, setRosterSummaries] = useState<Record<string, DayEndReportSummary>>({});

  // Route Access Control (Staff vs Non-Staff assigned to specific boy)
  const [isStaffOrManager, setIsStaffOrManager] = useState<boolean>(() => isCurrentStaffOrManager());
  const [assignedRoute, setAssignedRoute] = useState<string | null>(() => getAgentAssignedDeliveryBoy());
  const [isAccessChecking, setIsAccessChecking] = useState<boolean>(true);

  // BPCL AI Status Report & "Bills Checked Done" state
  const [bpclReport, setBpclReport] = useState<BpclReportData | null>(null);
  const [isBpclModalOpen, setIsBpclModalOpen] = useState<boolean>(false);

  // Agent State (can be switched to any delivery boy from the list)
  const [agentName, setAgentName] = useState<string>(() => {
    if (!isCurrentStaffOrManager()) {
      const assigned = localStorage.getItem('bgcls_assigned_delivery_boy');
      if (assigned) return assigned.trim().toUpperCase();
    }
    const lastSelected = localStorage.getItem('bgcls_day_end_selected_boy_name');
    if (lastSelected) return lastSelected;
    const savedName = localStorage.getItem('bgcls_agent_name');
    if (savedName) return savedName;
    const username = localStorage.getItem('bgcls_logged_username') || localStorage.getItem('bgcls_remember_username');
    if (username) return username.toUpperCase();
    return 'Delivery Agent';
  });
  const [agentId, setAgentId] = useState<string>(() => localStorage.getItem('bgcls_agent_id') || 'agent_default');

  // Date State
  const [reportDate, setReportDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const activeDateRef = useRef<string>(reportDate);

  // Bill Entries State
  const [entries, setEntries] = useState<ItemEntry[]>(() => {
    const currentAgent = localStorage.getItem('bgcls_agent_id') || 'agent_default';
    const today = new Date().toISOString().split('T')[0];
    return loadEntriesForDate(currentAgent, today);
  });

  const [isLoaded, setIsLoaded] = useState<boolean>(false);
  const [isLoadingDb, setIsLoadingDb] = useState<boolean>(false);
  const [isSavingDb, setIsSavingDb] = useState<boolean>(false);
  const [lastSavedTime, setLastSavedTime] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState<boolean>(false);
  const [isFloatingDockMinimized, setIsFloatingDockMinimized] = useState<boolean>(false);

  // Serial Number (#1..#17) for active selected delivery boy
  const selectedBoyIndex = useMemo(() => {
    if (!selectedBoy && !agentName) return null;
    const nameToMatch = (selectedBoy ? selectedBoy.name : agentName).trim().toUpperCase();
    const idx = deliveryBoys.findIndex((b) => b.name.trim().toUpperCase() === nameToMatch);
    return idx !== -1 ? idx + 1 : null;
  }, [selectedBoy, agentName, deliveryBoys]);

  // Synchronous State Refs for Lifecycle Flush (survives app switching & tab kill)
  const entriesRef = useRef<ItemEntry[]>(entries);
  entriesRef.current = entries;
  const agentNameRef = useRef<string>(agentName);
  agentNameRef.current = agentName;
  const agentIdRef = useRef<string>(agentId);
  agentIdRef.current = agentId;
  const reportDateRef = useRef<string>(reportDate);
  reportDateRef.current = reportDate;
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Anti-fraud cross-agent claimed map for detecting duplicate bills
  const crossAgentClaimedMap = useMemo(() => {
    const map: Record<string, { agentName: string; date: string; consumerName?: string }> = {};
    if (!rosterSummaries) return map;

    const currentAgentName = (selectedBoy?.name || agentName || '').trim().toUpperCase();
    const currentAgentId = selectedBoy?.id || agentId || '';

    Object.values(rosterSummaries).forEach((report) => {
      const reportAgentName = (report.agent_name || '').trim().toUpperCase();
      const reportAgentId = report.agent_id || '';

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
  }, [rosterSummaries, selectedBoy, agentName, agentId]);

  // Count how many bills in the current list are double-bills from other delivery boys
  const duplicateScamCount = useMemo(() => {
    return entries.filter((e) => {
      const claimant = e.duplicate_of_agent
        ? { agentName: e.duplicate_of_agent }
        : crossAgentClaimedMap[e.consumer_number.toLowerCase()];
      return !!claimant;
    }).length;
  }, [entries, crossAgentClaimedMap]);

  // Supervisor Contact (Optional WhatsApp share)
  const [supervisorPhone, setSupervisorPhone] = useState<string>(() => {
    return localStorage.getItem('bgcls_supervisor_phone') || '917337487571';
  });
  const [supervisorsList, setSupervisorsList] = useState<Supervisor[]>([]);
  const [isEditingSupervisor, setIsEditingSupervisor] = useState<boolean>(false);

  // Inputs & Scanning
  const [singleInput, setSingleInput] = useState<string>('');
  const [rawInput, setRawInput] = useState<string>('');
  const [inputMode, setInputMode] = useState<'single' | 'bulk'>('single');
  const [isLiveScannerOpen, setIsLiveScannerOpen] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [copiedCsv, setCopiedCsv] = useState<boolean>(false);

  // In-List Search & Filter
  const [listSearchQuery, setListSearchQuery] = useState<string>('');
  const [listFilterTab, setListFilterTab] = useState<'ALL' | 'UNVERIFIED'>('ALL');

  // Search auto-complete state
  const [suggestions, setSuggestions] = useState<Consumer[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [showSuggestions, setShowSuggestions] = useState<boolean>(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  // Verify authoritatively if current agent is staff or has an assigned route
  useEffect(() => {
    let isMounted = true;

    const verifyAccess = async () => {
      try {
        const { isStaffOrManager: isStaff, assignedBoy } = await resolveCurrentAgentDeliveryBoy();
        if (!isMounted) return;
        setIsStaffOrManager(isStaff);
        setAssignedRoute(assignedBoy);
      } catch (err) {
        console.warn('Error verifying route access:', err);
      } finally {
        if (isMounted) setIsAccessChecking(false);
      }
    };

    verifyAccess();

    // Listen for realtime route assignment updates from Manager Dashboard
    const channel = supabase.channel('bgcls_old_day_end_perm_channel');
    channel.on('broadcast', { event: 'delivery_boy_assignment_changed' }, (payload) => {
      const currentId = localStorage.getItem('bgcls_agent_id');
      const currentUser = (
        localStorage.getItem('bgcls_logged_username') ||
        localStorage.getItem('bgcls_remember_username') ||
        ''
      ).toLowerCase().trim();
      const p = payload?.payload;
      if (p && (p.agentId === currentId || p.username === currentUser)) {
        const newRoute = p.assigned_delivery_boy ? p.assigned_delivery_boy.toUpperCase() : null;
        setAssignedRoute(newRoute);
        if (newRoute) {
          toast.success(`Your assigned delivery route is ${newRoute}`);
        } else {
          toast.error('Your delivery route assignment was removed by manager');
        }
      }
    });
    channel.subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, []);

  // 1. Load Delivery Boys and initial selection
  useEffect(() => {
    let isMounted = true;
    const initBoys = async () => {
      try {
        // Wait until route and staff permissions have been verified
        if (isAccessChecking) return;

        const boys = await getDayEndDeliveryBoys();
        if (!isMounted || !boys || boys.length === 0) return;

        // Non-staff guard: Strictly lock to manager-assigned delivery boy only
        if (!isStaffOrManager) {
          if (assignedRoute && assignedRoute !== 'ALL') {
            const normRoute = assignedRoute.trim().toUpperCase();
            const matched = boys.find((b) => b.name.toUpperCase() === normRoute);
            const routeBoy: DeliveryBoy = matched || {
              id: `boy_${normRoute.toLowerCase()}`,
              name: normRoute,
              username: normRoute.toLowerCase(),
              role: 'AGENT' as const,
              status: 'ACTIVE' as const,
            };
            setDeliveryBoys([routeBoy]);
            setSelectedBoy(routeBoy);
            setAgentName(routeBoy.name);
            setAgentId(routeBoy.id);
            localStorage.setItem('bgcls_day_end_selected_boy_name', routeBoy.name);
          } else {
            // Unassigned non-staff user: STRICTLY EMPTY LIST
            setDeliveryBoys([]);
            setSelectedBoy(null);
            setAgentName('');
          }
          return;
        }

        // Staff & Managers get the full roster of all delivery boys
        setDeliveryBoys(boys);

        const lastSelected = localStorage.getItem('bgcls_day_end_selected_boy_name');
        const currentAgentId = localStorage.getItem('bgcls_agent_id');
        const currentName = localStorage.getItem('bgcls_agent_name');
        const currentUsername =
          localStorage.getItem('bgcls_remember_username') ||
          localStorage.getItem('bgcls_logged_username');

        let matched = boys.find((b) => lastSelected && b.name.toUpperCase() === lastSelected.toUpperCase());
        if (!matched && currentName) {
          matched = boys.find((b) => b.name.toUpperCase() === currentName.toUpperCase());
        }
        if (!matched && currentUsername) {
          matched = boys.find((b) => b.username.toLowerCase() === currentUsername.toLowerCase());
        }
        if (!matched && currentAgentId && currentAgentId !== 'agent_default') {
          matched = boys.find((b) => b.id === currentAgentId);
        }

        const chosen = matched || boys[0];
        if (chosen) {
          setSelectedBoy(chosen);
          setAgentName(chosen.name);
          setAgentId(chosen.id);
        }

        // Fetch supervisors list for optional WhatsApp share
        const { data: managers } = await supabase
          .from('agents')
          .select('id, name, username, phone')
          .eq('role', 'MANAGER');
        if (managers && managers.length > 0 && isMounted) {
          setSupervisorsList(managers);
        }
      } catch (err) {
        console.warn('Agent resolution notice:', err);
      }
    };

    initBoys();
    return () => {
      isMounted = false;
    };
  }, [isStaffOrManager, assignedRoute, isAccessChecking]);

  // 1b. Fetch all delivery boy reports for cross-agent double-bill scam detection
  useEffect(() => {
    let isMounted = true;
    const loadRoster = async () => {
      try {
        const reports = await fetchAllDayEndReportsForDate(reportDate);
        if (isMounted) {
          setRosterSummaries(reports || {});
        }
      } catch (e) {
        console.warn('Error loading roster reports:', e);
      }
    };
    loadRoster();
    return () => {
      isMounted = false;
    };
  }, [reportDate]);

  // 1c. Fetch BPCL AI Status Report for the active delivery boy
  useEffect(() => {
    let isMounted = true;
    const name = selectedBoy ? selectedBoy.name : agentName;
    if (!name || name === 'Delivery Agent') return;

    fetchBpclReport(reportDate, name, selectedBoy?.id || agentId).then((rep) => {
      if (isMounted) setBpclReport(rep);
    });

    return () => {
      isMounted = false;
    };
  }, [reportDate, selectedBoy, agentName, agentId]);

  // Toggle "Bills Checked Done"
  const handleToggleCheckedDone = async () => {
    const name = selectedBoy ? selectedBoy.name : agentName;
    if (!name || name === 'Delivery Agent') return;

    const currentStatus = bpclReport?.checked_done ?? false;
    const nextStatus = !currentStatus;

    await toggleBillsCheckedDone(reportDate, name, selectedBoy?.id || agentId, nextStatus);
    const updated = await fetchBpclReport(reportDate, name, selectedBoy?.id || agentId);
    setBpclReport(updated);
    toast.success(nextStatus ? `Marked bills as Checked Done!` : `Unmarked Checked Done`);
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
    toast.success(`Added #${bill.consumer_number} (${bill.consumer_name}) to Completed Deliveries!`);
  };

  // Switch Active Delivery Boy
  const handleSwitchBoy = async (boy: DeliveryBoy) => {
    // Non-staff guard: Cannot switch to other delivery boys
    if (!isStaffOrManager) {
      toast.error('Only Staff and Managers can switch delivery boys.');
      setIsBoyDropdownOpen(false);
      return;
    }

    if (selectedBoy?.name.toUpperCase() === boy.name.toUpperCase()) {
      setIsBoyDropdownOpen(false);
      return;
    }

    // Auto-save any unsaved changes for the outgoing delivery boy
    if (hasUnsavedChanges && entries.length > 0) {
      try {
        await saveDayEndReportToDatabase({
          report_date: reportDate,
          agent_id: agentId !== 'agent_default' ? agentId : undefined,
          agent_name: agentName,
          entries: entries as any,
          supervisor_phone: supervisorPhone,
        });
      } catch (e) {
        console.warn('Auto-save before switch notice:', e);
      }
    }

    setSelectedBoy(boy);
    setAgentName(boy.name);
    setAgentId(boy.id);
    localStorage.setItem('bgcls_day_end_selected_boy_name', boy.name);
    setIsBoyDropdownOpen(false);
    setBoySearchQuery('');
    setListSearchQuery('');
    setRawInput('');
    setSingleInput('');
    setShowSuggestions(false);
    setHasUnsavedChanges(false);
    setEntries([]); // Reset entries immediately to prevent cross-boy bleeding

    // Instant local draft check for snappy UX
    const norm = boy.name.trim().toUpperCase();
    const draftKey = getWorkingDraftKey(reportDate, norm);
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.entries)) {
          setEntries(normalizeStoredEntries(parsed.entries));
        } else {
          setEntries([]);
        }
      } else {
        setEntries([]);
      }
    } catch {
      setEntries([]);
    }

    toast.success(`Active boy: ${boy.name}`);
  };

  // 2. Fetch Saved Bills from Database for active date & agent (with resilient Local Working Draft protection)
  useEffect(() => {
    let isMounted = true;

    const loadBillsFromDatabase = async () => {
      if (!agentName) return;
      setIsLoadingDb(true);

      try {
        const normName = agentName.trim().toUpperCase();
        const draftKey = getWorkingDraftKey(reportDate, normName);

        // 1. Check local working draft first
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

        // 2. Fetch cloud summary
        const cloudReport = await fetchDayEndReportForAgent(reportDate, agentName, agentId);
        if (!isMounted) return;

        const cloudEntries: ItemEntry[] = (cloudReport && Array.isArray(cloudReport.entries))
          ? cloudReport.entries.map((e: any) => ({
              consumer_id: e.consumer_id,
              consumer_number: String(e.consumer_number || ''),
              consumer_name: String(e.consumer_name || 'Consumer Record'),
              address: e.address,
              mobile: e.mobile,
              found: e.found !== undefined ? Boolean(e.found) : true,
              source: e.source || 'remote',
              cylinder_type: e.cylinder_type || '14.2KG_STD',
              payment_mode: e.payment_mode || 'CASH',
              empty_collected: e.empty_collected !== undefined ? Boolean(e.empty_collected) : true,
              dispatch_item_id: e.dispatch_item_id,
              scanned_at: e.scanned_at,
            }))
          : [];

        // 3. Intelligent merge: never wipe out locally scanned bills if cloud is empty or older!
        if (cloudEntries.length > 0) {
          const mergedMap = new Map<string, ItemEntry>();
          cloudEntries.forEach((e) => mergedMap.set(e.consumer_number.toLowerCase(), e));
          draftEntries.forEach((e) => mergedMap.set(e.consumer_number.toLowerCase(), e));

          const finalEntries = Array.from(mergedMap.values());
          setEntries(finalEntries);
          if (cloudReport?.updated_at) {
            setLastSavedTime(
              new Date(cloudReport.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            );
          }
          setHasUnsavedChanges(draftEntries.length > cloudEntries.length);
          setIsLoaded(true);
          return;
        }

        if (cloudReport && cloudReport.total_deliveries === 0) {
          // Cloud confirmed 0 bills for this delivery boy
          setEntries([]);
          setLastSavedTime(null);
          setHasUnsavedChanges(false);
          setIsLoaded(true);
          try {
            localStorage.removeItem(draftKey);
          } catch (_) {}
          return;
        }

        if (draftEntries.length > 0) {
          setEntries(draftEntries);
          setHasUnsavedChanges(true);
          setIsLoaded(true);
          return;
        }

        // Fallback to local device cache
        const localItems = loadEntriesForDate(agentId, reportDate);
        if (!isMounted) return;
        setEntries(localItems);
        setIsLoaded(true);
      } catch (err) {
        console.warn('Error loading bills:', err);
      } finally {
        if (isMounted) setIsLoadingDb(false);
      }
    };

    loadBillsFromDatabase();

    return () => {
      isMounted = false;
    };
  }, [reportDate, agentName, agentId]);

  // 3. Synchronous write-ahead to localStorage on ANY change to entries
  useEffect(() => {
    if (!agentName) return;
    const normName = agentName.trim().toUpperCase();
    const draftKey = getWorkingDraftKey(reportDate, normName);
    try {
      localStorage.setItem(draftKey, JSON.stringify({
        entries,
        timestamp: Date.now(),
      }));
    } catch (_) {}
  }, [entries, agentName, reportDate]);

  // 4. Debounced background auto-save to cloud database whenever entries change with unsaved edits
  useEffect(() => {
    if (!agentName || !hasUnsavedChanges || entries.length === 0) return;

    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    autoSaveTimerRef.current = setTimeout(async () => {
      try {
        await saveDayEndReportToDatabase({
          report_date: reportDate,
          agent_id: agentId !== 'agent_default' ? agentId : undefined,
          agent_name: agentName,
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
  }, [entries, hasUnsavedChanges, agentName, agentId, reportDate, supervisorPhone]);

  // 5. App Switch / Background / Pagehide Emergency Flush:
  // Ensures bills are immediately persisted when the user switches to WhatsApp or another app!
  useEffect(() => {
    const handleAppSwitchOrUnload = () => {
      const currentName = agentNameRef.current;
      const currentId = agentIdRef.current;
      const currentEntries = entriesRef.current;
      const currentDate = reportDateRef.current;

      if (currentName && currentEntries.length > 0) {
        const normName = currentName.trim().toUpperCase();
        const draftKey = getWorkingDraftKey(currentDate, normName);
        try {
          localStorage.setItem(draftKey, JSON.stringify({
            entries: currentEntries,
            timestamp: Date.now(),
          }));
        } catch (_) {}

        saveDayEndReportToDatabase({
          report_date: currentDate,
          agent_id: currentId !== 'agent_default' ? currentId : undefined,
          agent_name: currentName,
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

  // 4. Save Bills to Database
  const handleSaveToDatabase = async () => {
    if (!agentName) {
      toast.error('Agent identification missing');
      return;
    }

    setIsSavingDb(true);
    try {
      const dayEndEntries: DayEndEntry[] = entries.map((e) => ({
        consumer_id: e.consumer_id,
        consumer_number: e.consumer_number,
        consumer_name: e.consumer_name,
        address: e.address,
        mobile: e.mobile,
        cylinder_type: e.cylinder_type,
        payment_mode: e.payment_mode,
        empty_collected: e.empty_collected,
        found: e.found,
        source: e.source,
        scanned_at: e.scanned_at || new Date().toISOString(),
      }));

      const res = await saveDayEndReportToDatabase({
        report_date: reportDate,
        agent_id: agentId !== 'agent_default' ? agentId : undefined,
        agent_name: agentName,
        entries: dayEndEntries,
        supervisor_phone: supervisorPhone,
      });

      if (res.success) {
        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        setLastSavedTime(timeStr);
        setHasUnsavedChanges(false);
        toast.success(`Saved ${entries.length} bills to database!`);
      } else {
        toast.error(res.error || 'Failed to save to database');
      }
    } catch (err: any) {
      toast.error('Database save error: ' + (err.message || 'Check network connection'));
    } finally {
      setIsSavingDb(false);
    }
  };

  // 5. Date Switcher
  const handleDateChange = async (newDate: string) => {
    if (newDate === reportDate) return;

    // Persist current date before switching
    if (hasUnsavedChanges && entries.length > 0) {
      try {
        await saveDayEndReportToDatabase({
          report_date: reportDate,
          agent_id: agentId !== 'agent_default' ? agentId : undefined,
          agent_name: agentName,
          entries: entries as any,
          supervisor_phone: supervisorPhone,
        });
      } catch (_) {}
    }

    activeDateRef.current = newDate;
    setReportDate(newDate);
    setHasUnsavedChanges(false);
    setListSearchQuery('');
    toast(`Viewing Date: ${newDate}`, { icon: '📅' });
  };

  // 6. Search Auto-complete against Dexie (33k+ consumers)
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

  // 7. Add Consumer from Suggestion
  const handleSelectSuggestion = (consumer: Consumer) => {
    if (entries.some((e) => e.consumer_number.toLowerCase() === consumer.consumer_number.toLowerCase())) {
      toast.error(`Consumer #${consumer.consumer_number} is already added`);
      setShowSuggestions(false);
      return;
    }

    const claimant = crossAgentClaimedMap[consumer.consumer_number.toLowerCase()];
    if (claimant) {
      toast.error(`🚨 SCAM ALERT: #${consumer.consumer_number} was already claimed by ${claimant.agentName} today!`);
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
      payment_mode: 'CASH',
      empty_collected: true,
      scanned_at: new Date().toISOString(),
      duplicate_of_agent: claimant ? claimant.agentName : undefined,
    };

    setEntries((prev) => [newEntry, ...prev]);
    setHasUnsavedChanges(true);
    setSingleInput('');
    setShowSuggestions(false);
    toast.success(`Added ${consumer.consumer_name} (#${consumer.consumer_number})`);
  };

  // 8. Add Single Consumer (by Number or Name)
  const handleAddSingle = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanInput = singleInput.trim();
    if (!cleanInput) return;

    if (entries.some((e) => e.consumer_number.toLowerCase() === cleanInput.toLowerCase())) {
      toast.error('Consumer number already added');
      return;
    }

    if (suggestions.length > 0) {
      const exactMatch = suggestions.find(
        (s) => s.consumer_number.toLowerCase() === cleanInput.toLowerCase()
      );
      if (exactMatch) {
        handleSelectSuggestion(exactMatch);
        return;
      }
    }

    const claimant = crossAgentClaimedMap[cleanInput.toLowerCase()];
    if (claimant) {
      toast.error(`🚨 SCAM ALERT: #${cleanInput} was already claimed by ${claimant.agentName} today!`);
    }

    const match = await matchConsumerWithDatabase(cleanInput, cleanInput);

    if (match.found) {
      if (entries.some((e) => e.consumer_number.toLowerCase() === match.consumer_number.toLowerCase())) {
        toast.error(`Consumer #${match.consumer_number} is already added`);
        return;
      }

      const newEntry: ItemEntry = {
        consumer_id: match.consumer_id,
        consumer_number: match.consumer_number,
        consumer_name: match.consumer_name,
        address: match.address,
        mobile: match.mobile,
        found: true,
        source: 'local',
        cylinder_type: '14.2KG_STD',
        payment_mode: 'CASH',
        empty_collected: true,
        scanned_at: new Date().toISOString(),
        duplicate_of_agent: claimant ? claimant.agentName : undefined,
      };

      setEntries((prev) => [newEntry, ...prev]);
      setHasUnsavedChanges(true);
      setSingleInput('');
      setShowSuggestions(false);
      toast.success(`Added ${match.consumer_name} (#${match.consumer_number})`);
    } else {
      const isNum = /^\d+$/.test(cleanInput);
      const newEntry: ItemEntry = {
        consumer_number: cleanInput,
        consumer_name: isNum ? 'Unverified / Manual Entry' : cleanInput,
        found: false,
        source: 'manual',
        cylinder_type: '14.2KG_STD',
        payment_mode: 'CASH',
        empty_collected: true,
        scanned_at: new Date().toISOString(),
        duplicate_of_agent: claimant ? claimant.agentName : undefined,
      };

      setEntries((prev) => [newEntry, ...prev]);
      setHasUnsavedChanges(true);
      setSingleInput('');
      setShowSuggestions(false);
      toast(`Added unverified entry: ${cleanInput}`, { icon: '⚠️' });
    }
  };

  // 9. Bulk Paste Numbers
  const handleBulkProcess = async () => {
    if (!rawInput.trim()) return;
    setIsProcessing(true);

    try {
      const tokens = rawInput
        .split(/[\n,;\s]+/)
        .map((t) => t.trim())
        .filter((t) => t.length > 0);

      const existingSet = new Set(entries.map((e) => e.consumer_number.toLowerCase()));
      const toAdd: ItemEntry[] = [];
      let skipped = 0;

      for (const token of tokens) {
        if (existingSet.has(token.toLowerCase())) {
          skipped++;
          continue;
        }

        const claimant = crossAgentClaimedMap[token.toLowerCase()];
        const match = await matchConsumerWithDatabase(token, token);
        if (match.found) {
          toAdd.push({
            consumer_id: match.consumer_id,
            consumer_number: match.consumer_number,
            consumer_name: match.consumer_name,
            address: match.address,
            mobile: match.mobile,
            found: true,
            source: 'local',
            cylinder_type: '14.2KG_STD',
            payment_mode: 'CASH',
            empty_collected: true,
            scanned_at: new Date().toISOString(),
            duplicate_of_agent: claimant ? claimant.agentName : undefined,
          });
          existingSet.add(match.consumer_number.toLowerCase());
        } else {
          toAdd.push({
            consumer_number: token,
            consumer_name: 'Unverified / Manual Entry',
            found: false,
            source: 'manual',
            cylinder_type: '14.2KG_STD',
            payment_mode: 'CASH',
            empty_collected: true,
            scanned_at: new Date().toISOString(),
            duplicate_of_agent: claimant ? claimant.agentName : undefined,
          });
          existingSet.add(token.toLowerCase());
        }
      }

      if (toAdd.length > 0) {
        setEntries((prev) => [...toAdd, ...prev]);
        setHasUnsavedChanges(true);
        setRawInput('');
        setInputMode('single');
        toast.success(`Added ${toAdd.length} bills${skipped > 0 ? ` (${skipped} duplicates skipped)` : ''}!`);
      } else {
        toast('No new numbers to add', { icon: 'ℹ️' });
      }
    } finally {
      setIsProcessing(false);
    }
  };

  // 10. Gemini Live Camera Scanner Callback
  const handleConsumerAutoScanned = (scannedItem: {
    consumer_id?: string;
    consumer_number: string;
    consumer_name: string;
    address?: string;
    mobile?: string;
    found: boolean;
    cylinder_type?: '14.2KG_STD' | '10KG_LITE' | '19KG_COMM';
  }) => {
    const claimant = crossAgentClaimedMap[scannedItem.consumer_number.toLowerCase()];
    if (claimant) {
      toast.error(`🚨 SCAM ALERT: #${scannedItem.consumer_number} was already claimed by ${claimant.agentName} today!`);
    }

    setEntries((prev) => {
      const existingIdx = prev.findIndex(
        (e) => e.consumer_number.toLowerCase() === scannedItem.consumer_number.toLowerCase()
      );

      if (existingIdx >= 0) {
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
          };
          return updated;
        }
        return prev;
      }

      return [
        {
          consumer_id: scannedItem.consumer_id,
          consumer_number: scannedItem.consumer_number,
          consumer_name: scannedItem.consumer_name,
          address: scannedItem.address,
          mobile: scannedItem.mobile,
          found: scannedItem.found,
          source: 'camera',
          cylinder_type: scannedItem.cylinder_type || '14.2KG_STD',
          payment_mode: 'CASH',
          empty_collected: true,
          scanned_at: new Date().toISOString(),
          duplicate_of_agent: claimant ? claimant.agentName : undefined,
        },
        ...prev,
      ];
    });

    setHasUnsavedChanges(true);
  };

  // 11. Delete Entry (with immediate database update)
  const handleDeleteEntry = async (index: number) => {
    const updated = entries.filter((_, idx) => idx !== index);
    setEntries(updated);
    setHasUnsavedChanges(false);

    try {
      await saveDayEndReportToDatabase({
        report_date: reportDate,
        agent_id: agentId !== 'agent_default' ? agentId : undefined,
        agent_name: agentName,
        entries: updated as any,
        supervisor_phone: supervisorPhone,
      });
      setLastSavedTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      toast.success('Bill deleted & database updated');
    } catch (_) {}
  };

  // 12. Clear All Entries
  const handleClearAll = async () => {
    if (entries.length === 0) return;
    if (!window.confirm(`Are you sure you want to clear all ${entries.length} deliveries for ${reportDate}?`)) return;

    setEntries([]);
    setHasUnsavedChanges(false);

    try {
      await saveDayEndReportToDatabase({
        report_date: reportDate,
        agent_id: agentId !== 'agent_default' ? agentId : undefined,
        agent_name: agentName,
        entries: [],
        supervisor_phone: supervisorPhone,
      });
      setLastSavedTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      toast.success('All bills cleared and database updated');
    } catch (_) {}
  };

  // 13. Copy CSV Numbers
  const handleCopyCsv = () => {
    if (entries.length === 0) {
      toast.error('No deliveries to copy');
      return;
    }
    const csvStr = entries.map((e) => e.consumer_number).join(',');
    navigator.clipboard.writeText(csvStr);
    setCopiedCsv(true);
    toast.success('CSV numbers copied!');
    setTimeout(() => setCopiedCsv(false), 2000);
  };

  // 14. Send WhatsApp Report (Optional)
  const handleSendWhatsApp = () => {
    if (entries.length === 0) {
      toast.error('No deliveries recorded yet');
      return;
    }

    const [y, m, d] = reportDate.split('-');
    const formattedDate = `${d}/${m}/${y}`;
    const rawCsv = entries.map((e) => e.consumer_number).join(',');

    let text = `📦 *BHARAT GAS - DAY END DELIVERY REPORT*\n`;
    text += `👤 *Agent Name:* ${agentName.trim()}\n`;
    text += `📅 *Date:* ${formattedDate}\n`;
    text += `📊 *Total Deliveries Completed:* ${entries.length}\n\n`;
    text += `*Completed Deliveries List:*\n`;

    entries.forEach((item, idx) => {
      text += `${idx + 1}. #${item.consumer_number} - ${item.consumer_name}\n`;
    });

    text += `\n*CSV Numbers:*\n${rawCsv}`;

    const cleanPhone = supervisorPhone.replace(/[^0-9]/g, '');
    const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  };

  // Filtered & Searched entries
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

  // KPIs
  const kpis = useMemo(() => {
    return {
      total: entries.length,
      lite10kg: entries.filter((e) => e.cylinder_type === '10KG_LITE').length,
      cash: entries.filter((e) => e.payment_mode === 'CASH').length,
      upi: entries.filter((e) => e.payment_mode === 'UPI').length,
      unverified: entries.filter((e) => !e.found).length,
    };
  }, [entries]);

  // Filtered delivery boys for dropdown/modal
  const filteredDeliveryBoys = useMemo(() => {
    if (!boySearchQuery.trim()) return deliveryBoys;
    const q = boySearchQuery.trim().toLowerCase();
    return deliveryBoys.filter(
      (b) => b.name.toLowerCase().includes(q) || (b.username && b.username.toLowerCase().includes(q))
    );
  }, [deliveryBoys, boySearchQuery]);

  return (
    <div className="min-h-screen bg-slate-100 pb-56 pt-3 px-3 max-w-xl mx-auto font-sans">
      {/* Sleek Mobile Compact Header */}
      <div className="bg-gradient-to-br from-slate-900 via-indigo-950 to-blue-950 text-white rounded-3xl p-4 shadow-xl border border-white/10 mb-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={handleBack}
              className="w-8 h-8 rounded-xl bg-white/10 hover:bg-white/20 active:scale-95 flex items-center justify-center text-white transition-all border border-white/15"
              title="Go Back"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="w-8 h-8 rounded-xl bg-amber-400/20 border border-amber-400/30 flex items-center justify-center text-amber-400 shrink-0">
              <ClipboardList className="w-4 h-4" />
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight leading-tight">Day End Report</h1>
              {isStaffOrManager ? (
                <button
                  type="button"
                  onClick={() => setIsBoyDropdownOpen(true)}
                  className="mt-0.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-amber-400/20 hover:bg-amber-400/30 border border-amber-400/40 text-[11px] font-bold text-amber-300 transition-all active:scale-95"
                  title="Tap to switch Delivery Boy"
                >
                  <span className="text-blue-200 font-normal">👤 Boy:</span>
                  <span className="text-white font-black uppercase tracking-wide truncate max-w-[120px]">
                    {selectedBoy ? selectedBoy.name : agentName}
                  </span>
                  <ChevronDown className="w-3 h-3 text-amber-400 shrink-0" />
                </button>
              ) : (
                <div className="mt-0.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-500/20 border border-emerald-400/40 text-[11px] font-bold text-emerald-300">
                  <Lock className="w-2.5 h-2.5 text-emerald-400 shrink-0" />
                  <span className="text-emerald-200 font-normal">Assigned:</span>
                  <span className="text-white font-black uppercase tracking-wide truncate max-w-[120px]">
                    {selectedBoy ? selectedBoy.name : (assignedRoute || agentName)}
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="bg-amber-400 text-slate-950 text-xs font-black px-2.5 py-1 rounded-full shadow-sm">
              {entries.length} Deliveries
            </span>
          </div>
        </div>

        {/* Delivery Boy Selector Row */}
        <div className="bg-white/10 rounded-2xl p-2.5 flex items-center justify-between gap-2 border border-white/10 mb-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-amber-400 text-slate-950 font-black text-xs flex items-center justify-center shrink-0 shadow-sm">
              {selectedBoyIndex ? `#${selectedBoyIndex}` : (agentName ? agentName.charAt(0) : '👤')}
            </div>
            <div className="min-w-0">
              <span className="text-[10px] text-blue-200 uppercase font-semibold tracking-wider block leading-tight">
                {isStaffOrManager ? 'Delivery Boy' : 'Assigned Route'}
              </span>
              <span className="font-black text-white text-xs uppercase truncate block">
                {selectedBoy ? selectedBoy.name : (assignedRoute || agentName)}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {isStaffOrManager ? (
              <>
                {/* Quick Dropdown select for 1-tap picking on mobile */}
                <select
                  value={selectedBoy?.name || agentName}
                  onChange={(e) => {
                    const found = deliveryBoys.find((b) => b.name === e.target.value);
                    if (found) handleSwitchBoy(found);
                  }}
                  className="bg-slate-900 text-amber-300 border border-amber-400/50 text-xs font-black px-2 py-1.5 rounded-xl focus:outline-none cursor-pointer max-w-[130px] uppercase shadow-sm"
                >
                  {deliveryBoys.map((boy) => (
                    <option key={boy.id || boy.name} value={boy.name} className="bg-slate-900 text-white font-bold py-1">
                      {boy.name}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={() => setIsBoyDropdownOpen(true)}
                  className="bg-amber-400 hover:bg-amber-300 active:scale-95 text-slate-950 font-black px-2.5 py-1.5 rounded-xl text-xs flex items-center gap-1 shadow-sm transition-all"
                >
                  <Users className="w-3.5 h-3.5" />
                  <span>List</span>
                </button>
              </>
            ) : (
              <span className="px-2.5 py-1.5 bg-emerald-500/20 text-emerald-300 border border-emerald-400/40 rounded-xl text-[11px] font-black flex items-center gap-1">
                <Lock className="w-3 h-3 text-emerald-400" />
                <span>Locked Route</span>
              </span>
            )}
          </div>
        </div>

        {/* Date Selector & Sync Bar */}
        <div className="bg-white/10 rounded-2xl p-2.5 flex items-center justify-between gap-2 border border-white/10">
          <div className="flex items-center gap-1.5 min-w-0">
            <Calendar className="w-3.5 h-3.5 text-amber-300 shrink-0" />
            <input
              type="date"
              value={reportDate}
              onChange={(e) => handleDateChange(e.target.value)}
              className="bg-transparent text-white text-xs font-bold focus:outline-none cursor-pointer"
            />
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {isLoadingDb ? (
              <span className="text-[10px] text-blue-200 flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin text-amber-400" /> Syncing...
              </span>
            ) : lastSavedTime ? (
              <span className="text-[10px] text-emerald-300 font-semibold flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Saved {lastSavedTime}
              </span>
            ) : (
              <span className="text-[10px] text-amber-200 font-medium">Not saved yet</span>
            )}

            <button
              onClick={handleSaveToDatabase}
              disabled={isSavingDb}
              className="bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white text-[11px] font-black px-2.5 py-1 rounded-lg flex items-center gap-1 shadow-sm transition-all active:scale-95"
            >
              {isSavingDb ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
              Save Now
            </button>
          </div>
        </div>

        {/* Supervisor Info with quick edit */}
        <div className="mt-2.5 pt-2 border-t border-white/10 flex items-center justify-between text-[11px] text-blue-200">
          <span>Supervisor WhatsApp: <strong className="text-white font-semibold">{supervisorPhone}</strong></span>
          <button
            onClick={() => setIsEditingSupervisor(!isEditingSupervisor)}
            className="text-amber-300 hover:text-amber-400 underline flex items-center gap-0.5 text-[10px]"
          >
            <Edit2 className="w-2.5 h-2.5" /> Change
          </button>
        </div>

        {/* Supervisor Edit Drawer */}
        {isEditingSupervisor && (
          <div className="bg-white/15 backdrop-blur-md rounded-2xl p-2.5 mt-2 border border-amber-400/30 text-xs">
            <p className="font-bold text-amber-300 text-[11px] mb-1.5 flex items-center justify-between">
              <span>Select Supervisor WhatsApp Phone:</span>
              <button onClick={() => setIsEditingSupervisor(false)} className="text-white/70 hover:text-white">
                <X className="w-3.5 h-3.5" />
              </button>
            </p>
            {supervisorsList.length > 0 && (
              <div className="flex gap-1.5 flex-wrap mb-2">
                {supervisorsList.map((sup) => (
                  <button
                    key={sup.id}
                    onClick={() => {
                      const ph = sup.phone || sup.username || '917337487571';
                      setSupervisorPhone(ph);
                      localStorage.setItem('bgcls_supervisor_phone', ph);
                      setIsEditingSupervisor(false);
                      toast.success(`Supervisor set to ${sup.name}`);
                    }}
                    className="bg-white/10 hover:bg-white/25 px-2 py-1 rounded-lg text-[10px] font-medium transition-colors"
                  >
                    {sup.name}
                  </button>
                ))}
              </div>
            )}
            <div className="flex gap-1.5">
              <input
                type="tel"
                value={supervisorPhone}
                onChange={(e) => setSupervisorPhone(e.target.value)}
                placeholder="e.g. 917337487571"
                className="flex-1 bg-black/40 text-white px-2.5 py-1 rounded-xl text-xs border border-white/20 focus:outline-none focus:border-amber-400"
              />
              <button
                onClick={() => {
                  localStorage.setItem('bgcls_supervisor_phone', supervisorPhone);
                  setIsEditingSupervisor(false);
                  toast.success('Supervisor phone updated');
                }}
                className="bg-amber-400 text-slate-950 px-3 py-1 rounded-xl font-bold text-xs"
              >
                Save
              </button>
            </div>
          </div>
        )}
      </div>

      {isAccessChecking ? (
        <div className="bg-white rounded-3xl p-8 shadow-sm border border-slate-200 text-center my-6 space-y-3">
          <Loader2 className="w-8 h-8 animate-spin text-amber-500 mx-auto" />
          <p className="text-xs text-slate-500 font-bold">Verifying route access...</p>
        </div>
      ) : !isStaffOrManager && !assignedRoute ? (
        <div className="bg-white rounded-3xl p-6 shadow-xl border border-slate-200 text-center my-6 space-y-4">
          <div className="w-16 h-16 bg-rose-50 border border-rose-200 text-rose-600 rounded-3xl flex items-center justify-center mx-auto shadow-sm">
            <ShieldAlert size={32} />
          </div>
          <div>
            <h2 className="text-xl font-black text-slate-800">Delivery Boy Route Not Assigned</h2>
            <p className="text-xs text-slate-500 mt-1.5 max-w-sm mx-auto leading-relaxed">
              Your account has not been assigned a delivery boy route yet. Only assigned delivery boys or authorized staff members can enter Day End bills.
            </p>
          </div>

          <div className="p-3 bg-amber-50 rounded-2xl border border-amber-200 text-left max-w-sm mx-auto text-xs text-amber-900 space-y-1">
            <p className="font-bold flex items-center gap-1">
              <Lock size={12} className="text-amber-700" /> Manager Action Required:
            </p>
            <p className="text-[11px] text-amber-800 leading-normal">
              Please contact your manager. In the <b>Manager Dashboard &rarr; Team Members</b>, the manager must select your assigned delivery route (e.g. NAGARAJU, ANAND, etc.).
            </p>
          </div>

          <div className="pt-2 flex justify-center">
            <button
              type="button"
              onClick={handleBack}
              className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs px-5 py-3 rounded-xl transition-all shadow-md active:scale-95 flex items-center gap-2"
            >
              <ArrowLeft size={16} /> Back to Search / Home
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Anti-Fraud Double Bill Scam Alert Banner */}
          {duplicateScamCount > 0 && (
            <div className="mb-3 p-3 rounded-2xl bg-gradient-to-r from-rose-600 via-red-600 to-rose-700 text-white shadow-lg border border-rose-300/30 animate-pulse">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                    <ShieldAlert className="w-5 h-5 text-amber-300 animate-bounce" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-xs font-black uppercase tracking-wide truncate">
                      {duplicateScamCount} Double Bill Scam{duplicateScamCount > 1 ? 's' : ''} Detected!
                    </h3>
                    <p className="text-[10px] text-rose-100 truncate">
                      This bill was already claimed by another delivery boy today!
                    </p>
                  </div>
                </div>
                <span className="bg-white/20 text-white text-[10px] font-black px-2 py-0.5 rounded-full border border-white/20 shrink-0">
                  SCAM ALERT
                </span>
              </div>
            </div>
          )}

      {/* Gemini AI Receipt Scanner Banner */}
      <div className="mb-3 bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 rounded-3xl p-3.5 shadow-xl shadow-orange-500/25 text-white flex items-center justify-between gap-2 border-2 border-amber-300">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 rounded-2xl bg-slate-950 flex items-center justify-center shrink-0 shadow-lg border border-amber-400/40">
            <Camera className="w-6 h-6 text-amber-400 animate-pulse" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-black uppercase bg-slate-950 text-amber-300 px-2 py-0.5 rounded-md font-mono">CAMERA AI</span>
              <h3 className="text-sm font-black tracking-tight uppercase text-white truncate">RECEIPT SCANNER</h3>
            </div>
            <p className="text-[11px] text-amber-100 font-semibold truncate mt-0.5">
              Snap cash memos to auto-extract Cons No & Name
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setIsLiveScannerOpen(true)}
          className="bg-slate-950 hover:bg-slate-900 active:scale-95 text-amber-300 border-2 border-amber-400 text-xs font-black px-3.5 py-2.5 rounded-2xl shrink-0 transition-all shadow-xl flex items-center gap-1.5"
        >
          <Camera className="w-4 h-4 text-amber-400" />
          <span>SCAN BILLS</span>
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-2 mb-3">
        <div className="bg-white rounded-2xl p-2.5 text-center shadow-sm border border-slate-200/80">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tight block">TOTAL BILLS</span>
          <span className="text-lg font-black text-blue-600 leading-tight">{kpis.total}</span>
        </div>
        <div className="bg-white rounded-2xl p-2.5 text-center shadow-sm border border-slate-200/80">
          <span className="text-[10px] font-bold text-purple-400 uppercase tracking-tight block">10KG LITE</span>
          <span className="text-lg font-black text-purple-600 leading-tight">{kpis.lite10kg}</span>
        </div>
        <div className="bg-white rounded-2xl p-2.5 text-center shadow-sm border border-slate-200/80">
          <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-tight block">CASH</span>
          <span className="text-lg font-black text-emerald-600 leading-tight">{kpis.cash}</span>
        </div>
        <div className="bg-white rounded-2xl p-2.5 text-center shadow-sm border border-slate-200/80">
          <span className="text-[10px] font-bold text-blue-400 uppercase tracking-tight block">UPI</span>
          <span className="text-lg font-black text-blue-600 leading-tight">{kpis.upi}</span>
        </div>
      </div>

      {/* BPCL AI Verification: Pending & Online Bills Viewer */}
      <div className="mb-3">
        <BpclBillsView
          report={bpclReport}
          agentName={selectedBoy ? selectedBoy.name : agentName}
          reportDate={reportDate}
          scannedEntries={entries}
          onOpenPasteModal={() => setIsBpclModalOpen(true)}
          onToggleCheckedDone={handleToggleCheckedDone}
          onAddBillToScanned={handleAddPendingBillToScanned}
          onReportUpdated={(newRep) => setBpclReport(newRep)}
        />
      </div>

      {/* Input Mode Selector */}
      <div className="bg-slate-200/80 p-1 rounded-2xl mb-2.5 flex text-xs font-bold text-slate-600">
        <button
          onClick={() => setInputMode('single')}
          className={`flex-1 py-1.5 rounded-xl flex items-center justify-center gap-1.5 transition-all ${
            inputMode === 'single' ? 'bg-white text-blue-700 shadow-sm font-black' : 'hover:text-slate-900'
          }`}
        >
          <Search className="w-3.5 h-3.5" /> Search (33k+ Database)
        </button>
        <button
          onClick={() => setInputMode('bulk')}
          className={`flex-1 py-1.5 rounded-xl flex items-center justify-center gap-1.5 transition-all ${
            inputMode === 'bulk' ? 'bg-white text-blue-700 shadow-sm font-black' : 'hover:text-slate-900'
          }`}
        >
          <Layers className="w-3.5 h-3.5" /> Bulk Paste Numbers
        </button>
      </div>

      {/* Single Input / Quick Search Mode */}
      {inputMode === 'single' && (
        <div className="relative mb-3" ref={searchContainerRef}>
          <form onSubmit={handleAddSingle} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
              <input
                type="text"
                value={singleInput}
                onChange={(e) => setSingleInput(e.target.value)}
                onFocus={() => {
                  if (suggestions.length > 0) setShowSuggestions(true);
                }}
                placeholder="Search consumer number or customer name..."
                className="w-full pl-9 pr-3 py-2.5 bg-white border border-slate-200 rounded-2xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
              />
              {isSearching && (
                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-blue-500 animate-spin" />
              )}
            </div>
            <button
              type="submit"
              disabled={!singleInput.trim()}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-2xl font-bold text-xs flex items-center gap-1 shadow-sm transition-all active:scale-95 shrink-0"
            >
              <Plus className="w-4 h-4" /> Add
            </button>
          </form>

          {/* Autocomplete Suggestions Dropdown */}
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-1 bg-white rounded-2xl shadow-xl border border-slate-200 z-50 overflow-hidden max-h-60 overflow-y-auto">
              <div className="p-2 bg-slate-50 border-b border-slate-100 flex items-center justify-between text-[10px] font-bold text-slate-500 uppercase">
                <span>Matching Consumers ({suggestions.length})</span>
                <span className="text-blue-600">Tap to add</span>
              </div>
              {suggestions.map((item) => (
                <div
                  key={item.id || item.consumer_number}
                  onClick={() => handleSelectSuggestion(item)}
                  className="p-2.5 hover:bg-blue-50 cursor-pointer border-b border-slate-50 last:border-b-0 flex items-center justify-between transition-colors"
                >
                  <div className="min-w-0 pr-2">
                    <p className="text-xs font-bold text-slate-900 truncate">
                      #{item.consumer_number} - {item.consumer_name}
                    </p>
                    <p className="text-[10px] text-slate-500 truncate">{item.address || 'No address'}</p>
                  </div>
                  <span className="text-[10px] bg-blue-100 text-blue-700 font-bold px-2 py-0.5 rounded-md shrink-0">
                    + Add
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Bulk Input Mode */}
      {inputMode === 'bulk' && (
        <div className="bg-white rounded-2xl p-3 border border-slate-200 mb-3 shadow-sm">
          <p className="text-[11px] font-semibold text-slate-500 mb-1.5">
            Paste multiple consumer numbers (separated by comma, spaces, or lines):
          </p>
          <textarea
            rows={3}
            value={rawInput}
            onChange={(e) => setRawInput(e.target.value)}
            placeholder="e.g. 101334568, 80761318, 4664, 30285685..."
            className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-2"
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setRawInput('')}
              className="text-xs text-slate-500 hover:text-slate-800 px-3 py-1.5"
            >
              Clear
            </button>
            <button
              onClick={handleBulkProcess}
              disabled={isProcessing || !rawInput.trim()}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold px-4 py-1.5 rounded-xl flex items-center gap-1.5 shadow-sm active:scale-95 transition-all"
            >
              {isProcessing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Process Numbers
            </button>
          </div>
        </div>
      )}

      {/* Completed Deliveries List Section */}
      <div className="bg-white rounded-3xl p-3.5 shadow-sm border border-slate-200/80 mb-4">
        <div className="flex items-center justify-between mb-2.5 pb-2 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <h2 className="text-xs font-black uppercase tracking-tight text-slate-800">
              COMPLETED DELIVERIES
            </h2>
            <span className="bg-blue-100 text-blue-700 text-[11px] font-black px-2 py-0.5 rounded-full">
              {entries.length}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopyCsv}
              className="text-slate-500 hover:text-blue-600 text-[11px] font-bold flex items-center gap-1 transition-colors"
            >
              <Copy className="w-3 h-3" /> {copiedCsv ? 'Copied!' : 'Copy CSV'}
            </button>
            {entries.length > 0 && (
              <button
                onClick={handleClearAll}
                className="text-rose-500 hover:text-rose-700 text-[11px] font-bold flex items-center gap-1 transition-colors ml-1"
              >
                <Trash2 className="w-3 h-3" /> Clear
              </button>
            )}
          </div>
        </div>

        {/* In-List Search & Filter Bar */}
        {entries.length > 5 && (
          <div className="mb-2.5 flex gap-1.5">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input
                type="text"
                value={listSearchQuery}
                onChange={(e) => setListSearchQuery(e.target.value)}
                placeholder="Filter in list..."
                className="w-full pl-8 pr-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-[11px] text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            {kpis.unverified > 0 && (
              <button
                onClick={() => setListFilterTab(listFilterTab === 'ALL' ? 'UNVERIFIED' : 'ALL')}
                className={`text-[10px] font-bold px-2 py-1 rounded-xl border transition-all ${
                  listFilterTab === 'UNVERIFIED'
                    ? 'bg-amber-100 border-amber-300 text-amber-800'
                    : 'bg-slate-50 border-slate-200 text-slate-600'
                }`}
              >
                Unverified ({kpis.unverified})
              </button>
            )}
          </div>
        )}

        {/* Items List */}
        {entries.length === 0 ? (
          <div className="py-12 text-center text-slate-400">
            <ClipboardList className="w-12 h-12 mx-auto mb-2 text-slate-300 stroke-1" />
            <p className="text-xs font-semibold text-slate-600">No bills added yet for {agentName}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Use the Camera Scanner or Quick Search above to add deliveries.
            </p>
          </div>
        ) : (
          <div className="space-y-2 pr-0.5">
            {displayedEntries.map((item, index) => {
              const origIndex = entries.findIndex((e) => e.consumer_number === item.consumer_number);
              const claimantAgent = item.duplicate_of_agent || crossAgentClaimedMap[item.consumer_number.toLowerCase()]?.agentName;

              return (
                <div
                  key={`${item.consumer_number}-${index}`}
                  className={`p-2.5 rounded-2xl transition-colors ${
                    claimantAgent
                      ? 'bg-rose-50/90 border border-rose-300 shadow-sm'
                      : 'bg-slate-50/80 border border-slate-200/80 hover:bg-slate-100/80'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-black text-slate-900">
                          #{item.consumer_number}
                        </span>
                        <span className="text-xs font-bold text-slate-700 truncate">
                          {item.consumer_name}
                        </span>
                        {!item.found && (
                          <span className="bg-amber-100 text-amber-800 text-[9px] font-bold px-1.5 py-0.2 rounded">
                            Unverified
                          </span>
                        )}
                        {claimantAgent && (
                          <span className="bg-rose-600 text-white text-[9px] font-black px-1.5 py-0.2 rounded flex items-center gap-0.5 shadow-sm">
                            <ShieldAlert className="w-2.5 h-2.5" /> SCAM DUPLICATE
                          </span>
                        )}
                      </div>
                      {item.address && (
                        <p className="text-[10px] text-slate-500 truncate mt-0.5">{item.address}</p>
                      )}
                      {claimantAgent && (
                        <div className="mt-1.5 p-1.5 bg-rose-100/90 border border-rose-300 rounded-xl flex items-center gap-1.5 text-[10px] text-rose-900 font-bold">
                          <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                          <span>
                            🚨 Duplicate bill already given by <strong className="uppercase underline text-rose-950 font-black">{claimantAgent}</strong>!
                          </span>
                        </div>
                      )}
                    </div>

                    <button
                      onClick={() => handleDeleteEntry(origIndex >= 0 ? origIndex : index)}
                      className="text-slate-400 hover:text-rose-600 p-1 transition-colors"
                      title="Delete Entry"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Payment & Cylinder Controls */}
                  <div className="flex items-center justify-between gap-1 pt-1 border-t border-slate-200/60 text-[10px]">
                    {/* Cylinder Type Toggle */}
                    <div className="flex bg-white rounded-lg p-0.5 border border-slate-200">
                      <button
                        onClick={() => {
                          const updated = [...entries];
                          updated[origIndex].cylinder_type = '14.2KG_STD';
                          setEntries(updated);
                          setHasUnsavedChanges(true);
                        }}
                        className={`px-1.5 py-0.5 rounded font-bold ${
                          item.cylinder_type === '14.2KG_STD' ? 'bg-blue-600 text-white' : 'text-slate-600'
                        }`}
                      >
                        14.2KG
                      </button>
                      <button
                        onClick={() => {
                          const updated = [...entries];
                          updated[origIndex].cylinder_type = '10KG_LITE';
                          setEntries(updated);
                          setHasUnsavedChanges(true);
                        }}
                        className={`px-1.5 py-0.5 rounded font-bold ${
                          item.cylinder_type === '10KG_LITE' ? 'bg-purple-600 text-white' : 'text-slate-600'
                        }`}
                      >
                        10KG
                      </button>
                    </div>

                    {/* Payment Mode Toggle */}
                    <div className="flex bg-white rounded-lg p-0.5 border border-slate-200">
                      <button
                        onClick={() => {
                          const updated = [...entries];
                          updated[origIndex].payment_mode = 'CASH';
                          setEntries(updated);
                          setHasUnsavedChanges(true);
                        }}
                        className={`px-1.5 py-0.5 rounded font-bold ${
                          item.payment_mode === 'CASH' ? 'bg-emerald-600 text-white' : 'text-slate-600'
                        }`}
                      >
                        CASH
                      </button>
                      <button
                        onClick={() => {
                          const updated = [...entries];
                          updated[origIndex].payment_mode = 'UPI';
                          setEntries(updated);
                          setHasUnsavedChanges(true);
                        }}
                        className={`px-1.5 py-0.5 rounded font-bold ${
                          item.payment_mode === 'UPI' ? 'bg-blue-600 text-white' : 'text-slate-600'
                        }`}
                      >
                        UPI
                      </button>
                      <button
                        onClick={() => {
                          const updated = [...entries];
                          updated[origIndex].payment_mode = 'DUE';
                          setEntries(updated);
                          setHasUnsavedChanges(true);
                        }}
                        className={`px-1.5 py-0.5 rounded font-bold ${
                          item.payment_mode === 'DUE' ? 'bg-amber-600 text-white' : 'text-slate-600'
                        }`}
                      >
                        DUE
                      </button>
                    </div>

                    {/* Empty Collected Toggle */}
                    <button
                      onClick={() => {
                        const updated = [...entries];
                        updated[origIndex].empty_collected = !updated[origIndex].empty_collected;
                        setEntries(updated);
                        setHasUnsavedChanges(true);
                      }}
                      className={`px-2 py-0.5 rounded-lg font-bold border transition-colors ${
                        item.empty_collected
                          ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                          : 'bg-rose-50 border-rose-300 text-rose-700'
                      }`}
                    >
                      {item.empty_collected ? '✓ Empty Recv' : '✕ No Empty'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Floating Bottom Sticky Action Bar */}
      {isFloatingDockMinimized ? (
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
        <div className="fixed bottom-[68px] left-0 right-0 max-w-xl mx-auto px-3 pointer-events-none z-40 animate-in fade-in slide-in-from-bottom-2 duration-150">
          <div className="bg-slate-900/95 backdrop-blur-md rounded-2xl p-2 sm:p-2.5 shadow-2xl border border-white/10 pointer-events-auto flex items-center justify-between gap-1.5 sm:gap-2">
            {/* Primary Save to Database Button */}
            <button
              onClick={handleSaveToDatabase}
              disabled={isSavingDb || (entries.length === 0 && !hasUnsavedChanges)}
              className={`flex-1 disabled:opacity-50 text-white font-black py-2.5 px-3 sm:px-4 rounded-xl flex items-center justify-center gap-2 shadow-lg text-xs active:scale-[0.98] transition-all ${
                hasUnsavedChanges
                  ? 'bg-amber-400 hover:bg-amber-300 text-slate-950 shadow-amber-500/30 animate-pulse'
                  : 'bg-emerald-700/90 hover:bg-emerald-600 text-white shadow-emerald-700/20'
              }`}
            >
              {isSavingDb ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                  <span>Saving to Database...</span>
                </>
              ) : hasUnsavedChanges ? (
                <>
                  <Save className="w-4 h-4" />
                  <span>Save Changes ({entries.length} Bills)</span>
                </>
              ) : (
                <>
                  <CheckCheck className="w-4 h-4 text-emerald-300" />
                  <span>Saved ({entries.length} Bills in Database)</span>
                </>
              )}
            </button>

            {/* Quick Camera Scanner Button in Floating Dock */}
            <button
              type="button"
              onClick={() => setIsLiveScannerOpen(true)}
              className="bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 active:scale-95 text-slate-950 p-2.5 px-3 rounded-xl transition-all flex items-center justify-center gap-1 shrink-0 font-black shadow-md shadow-amber-400/30"
              title="Open Gemini Camera Scanner"
            >
              <Camera className="w-4 h-4 text-slate-950" />
              <span className="text-[11px] font-black hidden sm:inline">Scan</span>
            </button>

            {/* Optional WhatsApp Button */}
            <button
              onClick={handleSendWhatsApp}
              disabled={entries.length === 0}
              className="bg-white/10 hover:bg-white/20 disabled:opacity-40 text-white p-2.5 rounded-xl border border-white/10 active:scale-95 transition-all"
              title="Send WhatsApp Report to Supervisor"
            >
              <Send className="w-4 h-4 text-emerald-400" />
            </button>

            {/* Copy CSV Button */}
            <button
              onClick={handleCopyCsv}
              disabled={entries.length === 0}
              className="bg-white/10 hover:bg-white/20 disabled:opacity-40 text-white p-2.5 rounded-xl border border-white/10 active:scale-95 transition-all"
              title="Copy CSV Numbers"
            >
              {copiedCsv ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-slate-300" />}
            </button>

            {/* Minimize Dock Button */}
            <button
              type="button"
              onClick={() => setIsFloatingDockMinimized(true)}
              className="bg-white/5 hover:bg-white/15 text-slate-400 hover:text-white p-2 sm:p-2.5 rounded-xl transition-all flex items-center justify-center shrink-0 border border-white/5"
              title="Minimize dock to view bills"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
      </>
      )}

      {/* Delivery Boy Selection Modal (Staff & Managers Only) */}
      {isBoyDropdownOpen && isStaffOrManager && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            {/* Modal Header */}
            <div className="p-3.5 border-b border-slate-800 flex items-center justify-between bg-slate-950/80">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-amber-400/20 text-amber-300 flex items-center justify-center font-bold text-xs border border-amber-400/30">
                  <Users className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-white">Select Delivery Boy</h3>
                  <p className="text-[10px] text-slate-400">Choose who to scan or save bills for</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsBoyDropdownOpen(false);
                  setBoySearchQuery('');
                }}
                className="w-7 h-7 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Search Input */}
            <div className="p-2.5 border-b border-slate-800 bg-slate-900">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={boySearchQuery}
                  onChange={(e) => setBoySearchQuery(e.target.value)}
                  placeholder="Filter delivery boy name..."
                  autoFocus
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-amber-400"
                />
              </div>
            </div>

            {/* Delivery Boys List */}
            <div className="p-2.5 overflow-y-auto space-y-1.5 flex-1 divide-y divide-slate-800/40">
              {filteredDeliveryBoys.map((boy) => {
                const isSelected =
                  (selectedBoy?.name.toUpperCase() === boy.name.toUpperCase()) ||
                  (agentName.toUpperCase() === boy.name.toUpperCase());
                const boySummary = rosterSummaries[boy.name.trim().toUpperCase()];
                const count = boySummary?.total_deliveries || 0;

                return (
                  <button
                    key={boy.id || boy.name}
                    type="button"
                    onClick={() => handleSwitchBoy(boy)}
                    className={`w-full p-2.5 rounded-2xl flex items-center justify-between text-left transition-all active:scale-[0.99] ${
                      isSelected
                        ? 'bg-amber-400 text-slate-950 font-bold shadow-md'
                        : 'hover:bg-slate-800 text-slate-200'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-black shrink-0 ${
                          isSelected ? 'bg-slate-950 text-amber-300' : 'bg-white/10 text-white'
                        }`}
                      >
                        #{deliveryBoys.findIndex((b) => b.name === boy.name) + 1}
                      </div>
                      <div className="min-w-0">
                        <span className="text-xs font-black block uppercase truncate">{boy.name}</span>
                        <span className={`text-[10px] block ${isSelected ? 'text-slate-800' : 'text-slate-400'}`}>
                          {boy.username ? `@${boy.username}` : 'Delivery Agent'}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {count > 0 && (
                        <span
                          className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                            isSelected ? 'bg-slate-950 text-amber-300' : 'bg-slate-800 text-slate-300'
                          }`}
                        >
                          {count} bills
                        </span>
                      )}
                      {isSelected ? (
                        <span className="bg-slate-950 text-amber-400 p-1 rounded-full">
                          <Check className="w-3.5 h-3.5" />
                        </span>
                      ) : (
                        <span className="text-slate-500 text-xs">Select &rarr;</span>
                      )}
                    </div>
                  </button>
                );
              })}
              {filteredDeliveryBoys.length === 0 && (
                <div className="py-8 text-center text-slate-400 text-xs">
                  No delivery boy matches "{boySearchQuery}"
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Gemini AI Live Scanner Modal */}
      <LiveCameraScannerModal
        isOpen={isLiveScannerOpen}
        onClose={() => setIsLiveScannerOpen(false)}
        onConsumerScanned={handleConsumerAutoScanned}
        existingNumbers={entries.map((e) => e.consumer_number)}
        claimedByOtherAgents={crossAgentClaimedMap}
        agentName={agentName}
        agentId={agentId}
      />

      {/* BPCL AI Status Report Modal */}
      {isBpclModalOpen && (
        <BpclReportModal
          isOpen={isBpclModalOpen}
          onClose={() => setIsBpclModalOpen(false)}
          agentName={selectedBoy ? selectedBoy.name : agentName}
          agentId={selectedBoy?.id || agentId}
          reportDate={reportDate}
          existingReport={bpclReport}
          onSaved={(newRep) => {
            setBpclReport(newRep);
          }}
        />
      )}

      <AgentBottomNav />
    </div>
  );
};

export default OldAgentDayEnd;