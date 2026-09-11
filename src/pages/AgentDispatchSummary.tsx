import React, { useState, useEffect, useMemo, useRef } from 'react';
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
  Calendar,
  User,
  Database,
  RefreshCw,
  Loader2,
  ChevronRight,
  Phone,
  MapPin,
  CheckCheck,
  XCircle,
  X,
  ArrowUp,
  ArrowDown,
  Clock,
  Zap,
  Truck,
  RotateCcw,
  Banknote,
  QrCode,
  Flame,
  CheckCircle2,
  Filter,
  Layers,
  Sparkles,
  Edit2,
  Camera
} from 'lucide-react';
import toast from 'react-hot-toast';
import { LiveCameraScannerModal } from '../components/LiveCameraScannerModal';

export interface ItemEntry {
  consumer_id?: string;
  consumer_number: string;
  consumer_name: string;
  address?: string;
  mobile?: string;
  found: boolean;
  source?: 'local' | 'remote' | 'manual' | 'route';
  cylinder_type: '14.2KG_STD' | '10KG_LITE' | '19KG_COMM';
  payment_mode: 'CASH' | 'UPI' | 'DUE';
  empty_collected: boolean;
  dispatch_item_id?: string;
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
  }));
};

export const AgentDispatchSummary: React.FC = () => {
  const [agentName, setAgentName] = useState<string>('Delivery Agent');
  const [agentId, setAgentId] = useState<string>(() => localStorage.getItem('bgcls_agent_id') || 'agent_default');
  const [reportDate, setReportDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [rawInput, setRawInput] = useState<string>('');
  const [singleInput, setSingleInput] = useState<string>('');
  const [isLoaded, setIsLoaded] = useState<boolean>(false);

  // Supervisor Contact state
  const [supervisorPhone, setSupervisorPhone] = useState<string>(() => {
    return localStorage.getItem('bgcls_supervisor_phone') || '917337487571';
  });
  const [supervisorsList, setSupervisorsList] = useState<Supervisor[]>([]);
  const [isEditingSupervisor, setIsEditingSupervisor] = useState<boolean>(false);

  // Today Route state
  const [assignedRouteStops, setAssignedRouteStops] = useState<any[]>([]);
  const [isLoadingRouteStops, setIsLoadingRouteStops] = useState<boolean>(false);

  // Deliveries List Filter & Search
  const [listSearchQuery, setListSearchQuery] = useState<string>('');
  const [listFilterTab, setListFilterTab] = useState<'ALL' | '14KG' | '10KG' | 'UNVERIFIED'>('ALL');

  const [entries, setEntries] = useState<ItemEntry[]>(() => {
    try {
      const devId = getDeviceId();
      const currentAgent = localStorage.getItem('bgcls_agent_id') || 'agent_default';
      const today = new Date().toISOString().split('T')[0];
      
      // 1. Try date + device + agent specific key
      const scopedKey = `bgcls_day_end_entries_${devId}_${currentAgent}_${today}`;
      const savedScoped = localStorage.getItem(scopedKey);
      if (savedScoped) return normalizeStoredEntries(JSON.parse(savedScoped));

      // 2. Try latest device fallback
      const savedLatest = localStorage.getItem(`bgcls_day_end_latest_${devId}`);
      if (savedLatest) return normalizeStoredEntries(JSON.parse(savedLatest));

      // 3. Fallback to legacy global key
      const legacy = localStorage.getItem('bgcls_day_end_entries');
      if (legacy) return normalizeStoredEntries(JSON.parse(legacy));

      return [];
    } catch {
      return [];
    }
  });

  // Mark initial load as completed after first render
  useEffect(() => {
    setIsLoaded(true);
  }, []);

  // Auto-save entries to device-scoped localStorage ONLY after initial load
  useEffect(() => {
    if (!isLoaded) return;
    try {
      const key = getDeviceScopedKey(agentId, reportDate);
      const jsonStr = JSON.stringify(entries);
      localStorage.setItem(key, jsonStr);
      localStorage.setItem(`bgcls_day_end_latest_${getDeviceId()}`, jsonStr);
      localStorage.setItem('bgcls_day_end_entries', jsonStr);
    } catch (err) {
      console.error('Failed to save entries to local storage:', err);
    }
  }, [entries, agentId, reportDate, isLoaded]);

  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [copiedReport, setCopiedReport] = useState<boolean>(false);
  const [copiedCsv, setCopiedCsv] = useState<boolean>(false);

  // Search auto-complete state
  const [suggestions, setSuggestions] = useState<Consumer[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [showSuggestions, setShowSuggestions] = useState<boolean>(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  // Database metrics & sync state
  const [dbCount, setDbCount] = useState<number>(0);
  const [isSyncingDb, setIsSyncingDb] = useState<boolean>(false);
  const [syncProgress, setSyncProgress] = useState<number>(0);
  const [syncStatusText, setSyncStatusText] = useState<string>('');
  const [lastSyncedTime, setLastSyncedTime] = useState<string | null>(null);

  // Fetch initial data, supervisors, and today's assigned route
  useEffect(() => {
    const loadInitialData = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const name = user.user_metadata?.name || user.email?.split('@')[0] || 'Delivery Agent';
          setAgentName(name);
        }

        const localCount = await db.consumers.count();
        setDbCount(localCount);

        const savedTime = localStorage.getItem('bgcls_last_sync_time');
        if (savedTime) setLastSyncedTime(savedTime);

        // Fetch managers for supervisor selection
        const { data: managers } = await supabase
          .from('agents')
          .select('id, name, username')
          .eq('role', 'MANAGER')
          .order('name');
        
        if (managers) {
          setSupervisorsList(managers);
        }

        // Auto sync if local DB is empty
        if (localCount === 0 && navigator.onLine) {
          syncFullMasterDatabase();
        }
      } catch (err) {
        console.error('Failed to load initial data:', err);
      }
    };
    loadInitialData();
  }, []);

  // Fetch today's assigned route whenever agentId or reportDate changes
  useEffect(() => {
    const fetchTodayRoute = async () => {
      const activeAgentId = agentId || localStorage.getItem('bgcls_agent_id');
      if (!activeAgentId) return;

      setIsLoadingRouteStops(true);
      try {
        const { data: dispatches } = await supabase
          .from('daily_dispatch')
          .select('id, status')
          .eq('agent_id', activeAgentId)
          .eq('dispatch_date', reportDate)
          .order('created_at', { ascending: false })
          .limit(1);

        if (dispatches && dispatches.length > 0) {
          const dispatchId = dispatches[0].id;
          const { data: items } = await supabase
            .from('dispatch_items')
            .select(`
              id,
              dispatch_id,
              consumer_id,
              status,
              sequence_order,
              consumers (
                id,
                consumer_name,
                consumer_number,
                address,
                mobile,
                cylinder_type
              )
            `)
            .eq('dispatch_id', dispatchId)
            .order('sequence_order', { ascending: true });

          setAssignedRouteStops(items || []);
        } else {
          setAssignedRouteStops([]);
        }
      } catch (err) {
        console.error('Error fetching today route:', err);
      } finally {
        setIsLoadingRouteStops(false);
      }
    };

    fetchTodayRoute();
  }, [agentId, reportDate]);

  // Close search suggestions on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Hydrate local database with full consumers from Supabase (Fixed Step = 1000)
  const syncFullMasterDatabase = async () => {
    if (!navigator.onLine) {
      toast.error('Internet connection required to sync database');
      return;
    }

    setIsSyncingDb(true);
    setSyncProgress(0);
    setSyncStatusText('Connecting to server...');

    try {
      const { count: totalRemote, error: countErr } = await supabase
        .from('consumers')
        .select('*', { count: 'exact', head: true });

      if (countErr) throw countErr;

      const totalToFetch = totalRemote || 31359;
      let allFetched: any[] = [];
      let from = 0;
      const step = 1000;
      let fetchMore = true;

      setSyncStatusText(`Starting download of ${totalToFetch.toLocaleString()} records...`);

      while (fetchMore) {
        const { data, error } = await supabase
          .from('manager_consumer_summary')
          .select('id, consumer_number, consumer_name, mobile, address, verification_status, cylinder_type, area_code, created_at, has_location, has_photos')
          .range(from, from + step - 1);

        if (error) {
          console.error('Batch fetch error:', error);
          toast.error(`Sync interrupted at ${allFetched.length.toLocaleString()} items`);
          break;
        }

        if (data && data.length > 0) {
          allFetched = [...allFetched, ...data];
          from += step;

          const progressPct = Math.min(99, Math.round((allFetched.length / totalToFetch) * 100));
          setSyncProgress(progressPct);
          setSyncStatusText(
            `Downloaded ${allFetched.length.toLocaleString()} / ${totalToFetch.toLocaleString()} records`
          );
        }

        if (!data || data.length < step) {
          fetchMore = false;
        }
      }

      if (allFetched.length > 0) {
        setSyncStatusText(`Indexing ${allFetched.length.toLocaleString()} records locally...`);

        const formattedConsumers = allFetched.map((c) => {
          const searchWords = [
            ...(c.consumer_name ? c.consumer_name.toLowerCase().split(/\s+/) : []),
            ...(c.consumer_number ? [c.consumer_number.toLowerCase()] : []),
            ...(c.mobile ? [c.mobile.toLowerCase()] : []),
          ];
          return {
            ...c,
            has_location: !!c.has_location,
            has_photos: !!c.has_photos,
            searchWords,
          };
        });

        await db.consumers.clear();

        const chunkSize = 5000;
        for (let i = 0; i < formattedConsumers.length; i += chunkSize) {
          const chunk = formattedConsumers.slice(i, i + chunkSize);
          await db.consumers.bulkAdd(chunk);
        }

        const newCount = await db.consumers.count();
        setDbCount(newCount);
        setSyncProgress(100);

        const nowFormatted = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        setLastSyncedTime(nowFormatted);
        localStorage.setItem('bgcls_last_sync_time', nowFormatted);

        toast.success(`Database updated! ${newCount.toLocaleString()} master consumers active.`);
      }
    } catch (err) {
      console.error('Database sync failed:', err);
      toast.error('Failed to sync master database');
    } finally {
      setIsSyncingDb(false);
      setSyncStatusText('');
    }
  };

  // Helper relevance ranker for search results
  const rankSearchResults = (items: Consumer[], rawQuery: string): Consumer[] => {
    const q = rawQuery.trim().toLowerCase();
    if (!q) return [];

    const valid = items.filter((c) => {
      return (c.consumer_number || '').toLowerCase().includes(q);
    });

    return valid.sort((a, b) => {
      const numA = (a.consumer_number || '').toLowerCase();
      const numB = (b.consumer_number || '').toLowerCase();

      if (numA === q && numB !== q) return -1;
      if (numB === q && numA !== q) return 1;

      const numAStarts = numA.startsWith(q);
      const numBStarts = numB.startsWith(q);
      if (numAStarts && !numBStarts) return -1;
      if (numBStarts && !numAStarts) return 1;

      return numA.localeCompare(numB, undefined, { numeric: true });
    });
  };

  // Real-time search suggestions logic
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
        let combinedMap = new Map<string, Consumer>();

        const localMatches = await db.consumers
          .where('consumer_number')
          .startsWith(query)
          .limit(30)
          .toArray();

        localMatches.forEach((item) => combinedMap.set(item.consumer_number, item));

        if (combinedMap.size < 15) {
          const prefixQuery = query.length >= 3 ? query.slice(0, 3) : query.slice(0, 2);
          const candidates = await db.consumers
            .where('consumer_number')
            .startsWith(prefixQuery)
            .limit(150)
            .toArray();

          candidates.forEach((c) => {
            if (c.consumer_number && c.consumer_number.toLowerCase().includes(query)) {
              combinedMap.set(c.consumer_number, c);
            }
          });

          if (combinedMap.size < 5) {
            const allLocal = await db.consumers
              .filter((c) => !!(c.consumer_number && c.consumer_number.toLowerCase().includes(query)))
              .limit(30)
              .toArray();
            allLocal.forEach((item) => combinedMap.set(item.consumer_number, item));
          }
        }

        const ranked = rankSearchResults(Array.from(combinedMap.values()), query).slice(0, 15);
        setSuggestions(ranked);
        setShowSuggestions(ranked.length > 0);
      } catch (err) {
        console.error('Search error:', err);
      } finally {
        setIsSearching(false);
      }
    }, 40);

    return () => clearTimeout(timer);
  }, [singleInput]);

  // Select consumer from suggestion dropdown
  const handleSelectSuggestion = (consumer: Consumer) => {
    if (entries.some((e) => e.consumer_number.toLowerCase() === consumer.consumer_number.toLowerCase())) {
      toast.error(`Consumer #${consumer.consumer_number} is already added`);
      setShowSuggestions(false);
      return;
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
    };

    setEntries((prev) => [...prev, newEntry]);
    setSingleInput('');
    setShowSuggestions(false);
    toast.success(`Added ${consumer.consumer_name} (#${consumer.consumer_number})`);
  };

  // Add a single consumer number
  const handleAddSingle = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanNum = singleInput.trim();
    if (!cleanNum) return;

    if (entries.some((e) => e.consumer_number.toLowerCase() === cleanNum.toLowerCase())) {
      toast.error('Consumer number already added');
      return;
    }

    if (suggestions.length > 0) {
      const exactMatch = suggestions.find(
        (s) => s.consumer_number.toLowerCase() === cleanNum.toLowerCase()
      );
      if (exactMatch) {
        handleSelectSuggestion(exactMatch);
        return;
      }
    }

    // 1. Check local Dexie
    const match = await db.consumers
      .where('consumer_number')
      .equalsIgnoreCase(cleanNum)
      .first();

    if (match) {
      setEntries((prev) => [
        ...prev,
        {
          consumer_id: match.id,
          consumer_number: match.consumer_number,
          consumer_name: match.consumer_name,
          address: match.address,
          mobile: match.mobile,
          found: true,
          source: 'local',
          cylinder_type: match.cylinder_type === '10KG_LITE' ? '10KG_LITE' : (match.cylinder_type as string) === '19KG_COMM' ? '19KG_COMM' : '14.2KG_STD',
          payment_mode: 'CASH',
          empty_collected: true,
        },
      ]);
      setSingleInput('');
      setShowSuggestions(false);
      toast.success(`Added ${match.consumer_name}`);
      return;
    }

    // 2. Check remote Supabase
    if (navigator.onLine) {
      try {
        const { data: remoteData } = await supabase
          .from('consumers')
          .select('id, consumer_number, consumer_name, address, mobile, cylinder_type')
          .eq('consumer_number', cleanNum)
          .maybeSingle();

        if (remoteData) {
          setEntries((prev) => [
            ...prev,
            {
              consumer_id: remoteData.id,
              consumer_number: remoteData.consumer_number,
              consumer_name: remoteData.consumer_name,
              address: remoteData.address,
              mobile: remoteData.mobile,
              found: true,
              source: 'remote',
              cylinder_type: remoteData.cylinder_type === '10KG_LITE' ? '10KG_LITE' : remoteData.cylinder_type === '19KG_COMM' ? '19KG_COMM' : '14.2KG_STD',
              payment_mode: 'CASH',
              empty_collected: true,
            },
          ]);
          setSingleInput('');
          setShowSuggestions(false);
          toast.success(`Added ${remoteData.consumer_name}`);
          return;
        }
      } catch (remoteErr) {
        console.warn('Remote check failed:', remoteErr);
      }
    }

    // 3. Unmatched Number: Add safely as Unverified manual entry (no illegal DB insert)
    setEntries((prev) => [
      ...prev,
      {
        consumer_number: cleanNum,
        consumer_name: 'Unverified / Manual Entry',
        address: 'Not in master database',
        mobile: '',
        found: false,
        source: 'manual',
        cylinder_type: '14.2KG_STD',
        payment_mode: 'CASH',
        empty_collected: true,
      },
    ]);
    setSingleInput('');
    setShowSuggestions(false);
    toast(`Added #${cleanNum} as unverified entry`, { icon: 'ℹ️' });
  };

  // Process bulk raw input text
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
      const uniqueNewNumbers = Array.from(new Set(parsedNumbers)).filter(
        (num) => !existingSet.has(num.toLowerCase())
      );

      if (uniqueNewNumbers.length === 0) {
        toast.error('All entered consumer numbers are already in the list');
        setIsProcessing(false);
        return;
      }

      // Bulk Dexie lookup
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
          payment_mode: 'CASH',
          empty_collected: true,
        });
      });

      const missingNumbers = uniqueNewNumbers.filter((num) => !resolvedMap.has(num.toLowerCase()));

      // Remote Supabase lookup for missing numbers
      if (missingNumbers.length > 0 && navigator.onLine) {
        try {
          const { data: remoteResults } = await supabase
            .from('consumers')
            .select('id, consumer_number, consumer_name, address, mobile, cylinder_type')
            .in('consumer_number', missingNumbers);

          if (remoteResults && remoteResults.length > 0) {
            remoteResults.forEach((r: any) => {
              resolvedMap.set(r.consumer_number.toLowerCase(), {
                consumer_id: r.id,
                consumer_number: r.consumer_number,
                consumer_name: r.consumer_name,
                address: r.address,
                mobile: r.mobile,
                found: true,
                source: 'remote',
                cylinder_type: r.cylinder_type === '10KG_LITE' ? '10KG_LITE' : r.cylinder_type === '19KG_COMM' ? '19KG_COMM' : '14.2KG_STD',
                payment_mode: 'CASH',
                empty_collected: true,
              });
            });
          }
        } catch (remoteErr) {
          console.error('Remote lookup error:', remoteErr);
        }
      }

      // Maintain input order
      const finalResolvedEntries: ItemEntry[] = uniqueNewNumbers.map((num) => {
        const foundEntry = resolvedMap.get(num.toLowerCase());
        if (foundEntry) return foundEntry;

        return {
          consumer_number: num,
          consumer_name: 'Consumer Record Not Found',
          found: false,
          source: 'manual',
          cylinder_type: '14.2KG_STD',
          payment_mode: 'CASH',
          empty_collected: true,
        };
      });

      setEntries((prev) => [...prev, ...finalResolvedEntries]);
      setRawInput('');

      const verifiedCount = finalResolvedEntries.filter((e) => e.found).length;
      toast.success(`Added ${finalResolvedEntries.length} entries (${verifiedCount} verified)`);
    } catch (error) {
      console.error('Error processing numbers:', error);
      toast.error('Failed to process consumer numbers');
    } finally {
      setIsProcessing(false);
    }
  };

  // Import Today's Assigned Route
  const handleImportAssignedRoute = () => {
    if (assignedRouteStops.length === 0) {
      toast.error('No assigned route stops found for today');
      return;
    }

    const existingNumberSet = new Set(entries.map((e) => e.consumer_number.toLowerCase()));
    const newItems: ItemEntry[] = [];

    assignedRouteStops.forEach((stop) => {
      const cons = stop.consumers;
      if (cons && cons.consumer_number && !existingNumberSet.has(cons.consumer_number.toLowerCase())) {
        newItems.push({
          consumer_id: cons.id,
          consumer_number: cons.consumer_number,
          consumer_name: cons.consumer_name,
          address: cons.address,
          mobile: cons.mobile,
          found: true,
          source: 'route',
          cylinder_type: cons.cylinder_type === '10KG_LITE' ? '10KG_LITE' : (cons.cylinder_type as string) === '19KG_COMM' ? '19KG_COMM' : '14.2KG_STD',
          payment_mode: 'CASH',
          empty_collected: true,
          dispatch_item_id: stop.id,
        });
        existingNumberSet.add(cons.consumer_number.toLowerCase());
      }
    });

    if (newItems.length === 0) {
      toast.success('All assigned route stops are already in your list!');
      return;
    }

    setEntries((prev) => [...prev, ...newItems]);
    toast.success(`Imported ${newItems.length} stops from today's route!`);
  };

  // Item List Actions & Toggles
  const handleToggleCylinder = (index: number) => {
    setEntries((prev) => {
      const updated = [...prev];
      const cur = updated[index].cylinder_type;
      const types: ('14.2KG_STD' | '10KG_LITE' | '19KG_COMM')[] = ['14.2KG_STD', '10KG_LITE', '19KG_COMM'];
      const nextIdx = (types.indexOf(cur) + 1) % types.length;
      updated[index] = { ...updated[index], cylinder_type: types[nextIdx] };
      return updated;
    });
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
  };

  const handleToggleEmpty = (index: number) => {
    setEntries((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], empty_collected: !updated[index].empty_collected };
      return updated;
    });
  };

  const handleRemoveEntry = (index: number) => {
    const itemToRemove = entries[index];
    setEntries((prev) => prev.filter((_, i) => i !== index));

    toast((t) => (
      <div className="flex items-center justify-between gap-3 text-xs">
        <span>Removed #{itemToRemove.consumer_number}</span>
        <button
          onClick={() => {
            setEntries((prev) => {
              const restored = [...prev];
              restored.splice(index, 0, itemToRemove);
              return restored;
            });
            toast.dismiss(t.id);
            toast.success(`Restored #${itemToRemove.consumer_number}`);
          }}
          className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-2 py-1 rounded-md text-[11px]"
        >
          Undo
        </button>
      </div>
    ), { duration: 4000 });
  };

  const handleMoveEntry = (index: number, direction: 'up' | 'down') => {
    if (
      (direction === 'up' && index === 0) ||
      (direction === 'down' && index === entries.length - 1)
    ) {
      return;
    }

    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    const newEntries = [...entries];
    const temp = newEntries[index];
    newEntries[index] = newEntries[targetIndex];
    newEntries[targetIndex] = temp;
    setEntries(newEntries);
  };

  const handleClearAll = () => {
    if (entries.length === 0) return;
    if (confirm('Are you sure you want to clear all added consumer numbers?')) {
      const backup = [...entries];
      setEntries([]);
      try {
        const key = getDeviceScopedKey(agentId, reportDate);
        localStorage.removeItem(key);
        localStorage.removeItem(`bgcls_day_end_latest_${getDeviceId()}`);
        localStorage.removeItem('bgcls_day_end_entries');
      } catch (err) {
        console.error('Failed to clear local storage keys:', err);
      }
      toast((t) => (
        <div className="flex items-center justify-between gap-3 text-xs">
          <span>Cleared all deliveries</span>
          <button
            onClick={() => {
              setEntries(backup);
              toast.dismiss(t.id);
              toast.success('Restored all entries');
            }}
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-2.5 py-1 rounded-md text-[11px]"
          >
            Undo
          </button>
        </div>
      ), { duration: 5000 });
    }
  };

  // LPG Reconciliation KPIs
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

  // Format Date to DD/MM/YYYY
  const formattedDateString = useMemo(() => {
    if (!reportDate) return '';
    const [year, month, day] = reportDate.split('-');
    return `${day}/${month}/${year}`;
  }, [reportDate]);

  // Raw CSV numbers string
  const rawCsvString = useMemo(() => {
    return entries.map((item) => item.consumer_number).join(',');
  }, [entries]);

  // Construct Detailed WhatsApp report text
  const reportMessageText = useMemo(() => {
    if (entries.length === 0) return '';

    let text = `📦 *BHARAT GAS - DAY END DELIVERY REPORT*\n`;
    text += `👤 *Agent Name:* ${agentName.trim()}\n`;
    text += `📅 *Date:* ${formattedDateString}\n`;
    text += `📊 *Total Deliveries Completed:* ${entries.length}\n\n`;

    text += `🔥 *Cylinder Breakdown:*\n`;
    text += `• 14.2kg Domestic: ${kpis.count14kg}\n`;
    text += `• 10kg Composite: ${kpis.count10kg}\n`;
    if (kpis.count19kg > 0) {
      text += `• 19kg Commercial: ${kpis.count19kg}\n`;
    }
    text += `🔄 *Empties Received:* ${kpis.emptiesCollected} / ${entries.length}\n\n`;

    text += `💰 *Payment Summary:*\n`;
    text += `• Cash: ${kpis.cashCount}\n`;
    text += `• Online / UPI: ${kpis.upiCount}\n`;
    if (kpis.dueCount > 0) {
      text += `• Due / Pending: ${kpis.dueCount}\n`;
    }
    text += `\n`;

    text += `*Completed Deliveries List:*\n`;
    entries.forEach((item, index) => {
      const typeLabel = item.cylinder_type === '10KG_LITE' ? '10kg Lite' : item.cylinder_type === '19KG_COMM' ? '19kg Comm' : '14.2kg';
      const emptyLabel = item.empty_collected ? 'Empty: Yes' : 'Empty: NO';
      text += `${index + 1}. #${item.consumer_number} - ${item.consumer_name} [${typeLabel} | ${item.payment_mode} | ${emptyLabel}]\n`;
    });

    text += `\n*CSV Numbers:*\n${rawCsvString}`;

    return text;
  }, [entries, agentName, formattedDateString, kpis, rawCsvString]);

  const [inputMode, setInputMode] = useState<'single' | 'bulk'>('single');
  const [isLiveScannerOpen, setIsLiveScannerOpen] = useState<boolean>(false);

  // Handle consumer scanned from Live Camera (Gemini AI Vision)
  const handleConsumerAutoScanned = (scannedItem: {
    consumer_number: string;
    consumer_name: string;
    address?: string;
    mobile?: string;
    found: boolean;
  }) => {
    setEntries((prev) => {
      if (prev.some((e) => e.consumer_number.toLowerCase() === scannedItem.consumer_number.toLowerCase())) {
        return prev;
      }
      return [
        ...prev,
        {
          consumer_number: scannedItem.consumer_number,
          consumer_name: scannedItem.consumer_name,
          address: scannedItem.address,
          mobile: scannedItem.mobile,
          found: scannedItem.found,
          source: scannedItem.found ? 'local' : 'manual',
          cylinder_type: '14.2KG_STD',
          payment_mode: 'CASH',
          empty_collected: true,
        },
      ];
    });
  };

  // Sync route completions and save day end report snapshot to cloud
  const syncCompletionsToCloud = async () => {
    const dispatchItemIds = entries
      .map((e) => e.dispatch_item_id)
      .filter((id): id is string => Boolean(id));

    if (dispatchItemIds.length > 0 && navigator.onLine) {
      try {
        await supabase
          .from('dispatch_items')
          .update({ status: 'COMPLETED', completed_at: new Date().toISOString() })
          .in('id', dispatchItemIds);
      } catch (err) {
        console.warn('Route items completion sync notice:', err);
      }
    }

    // Attempt saving day_end_reports snapshot
    if (navigator.onLine && entries.length > 0) {
      try {
        await supabase.from('day_end_reports').insert([
          {
            agent_id: agentId !== 'agent_default' ? agentId : null,
            agent_name: agentName,
            report_date: reportDate,
            total_deliveries: entries.length,
            domestic_14kg: kpis.count14kg,
            composite_10kg: kpis.count10kg,
            commercial_19kg: kpis.count19kg,
            empties_collected: kpis.emptiesCollected,
            cash_count: kpis.cashCount,
            upi_count: kpis.upiCount,
            due_count: kpis.dueCount,
            entries: entries,
            raw_csv: rawCsvString,
            supervisor_phone: supervisorPhone,
          },
        ]);
      } catch (reportErr) {
        console.warn('Day end cloud sync notice (local copy preserved):', reportErr);
      }
    }
  };

  // Share via WhatsApp
  const handleShareWhatsApp = async () => {
    if (entries.length === 0) {
      toast.error('Please add at least one consumer to share');
      return;
    }

    const cleanPhone = supervisorPhone.replace(/[^0-9]/g, '');
    const encodedText = encodeURIComponent(reportMessageText);
    const whatsappUrl = `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodedText}`;

    // Sync completions in background
    syncCompletionsToCloud().catch(console.error);

    window.open(whatsappUrl, '_blank');
  };

  // Copy Full Report to Clipboard
  const handleCopyToClipboard = async () => {
    if (entries.length === 0) {
      toast.error('No summary to copy');
      return;
    }

    try {
      await navigator.clipboard.writeText(reportMessageText);
      setCopiedReport(true);
      toast.success('Full report copied to clipboard!');
      setTimeout(() => setCopiedReport(false), 2500);

      syncCompletionsToCloud().catch(console.error);
    } catch (err) {
      toast.error('Failed to copy to clipboard');
    }
  };

  // Copy CSV Numbers Only
  const handleCopyCsvNumbers = async () => {
    if (entries.length === 0) {
      toast.error('No numbers to copy');
      return;
    }

    try {
      await navigator.clipboard.writeText(rawCsvString);
      setCopiedCsv(true);
      toast.success('Comma-separated numbers copied!');
      setTimeout(() => setCopiedCsv(false), 2500);
    } catch (err) {
      toast.error('Failed to copy CSV numbers');
    }
  };

  // Save customized supervisor phone
  const handleSaveSupervisorPhone = (phone: string) => {
    const clean = phone.replace(/[^0-9+]/g, '');
    setSupervisorPhone(clean);
    localStorage.setItem('bgcls_supervisor_phone', clean);
    setIsEditingSupervisor(false);
    toast.success('Supervisor contact updated');
  };

  // Filtered deliveries for list view
  const displayedEntries = useMemo(() => {
    return entries.filter((item) => {
      // Tab filter
      if (listFilterTab === '14KG' && item.cylinder_type !== '14.2KG_STD') return false;
      if (listFilterTab === '10KG' && item.cylinder_type !== '10KG_LITE') return false;
      if (listFilterTab === 'UNVERIFIED' && item.found) return false;

      // In-list search query
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

  // Highlight matched query substring
  const highlightMatch = (text: string, query: string) => {
    if (!text || !query) return text;
    const q = query.trim();
    if (!q) return text;

    const parts = text.split(new RegExp(`(${q})`, 'gi'));
    return (
      <>
        {parts.map((part, i) =>
          part.toLowerCase() === q.toLowerCase() ? (
            <mark key={i} className="bg-amber-200 text-slate-900 rounded-sm px-0.5 font-bold">
              {part}
            </mark>
          ) : (
            part
          )
        )}
      </>
    );
  };

  return (
    <div className="min-h-screen bg-slate-100 pb-40 pt-3 px-3 max-w-xl mx-auto font-sans">
      {/* Sleek Mobile Compact Header */}
      <div className="bg-gradient-to-br from-slate-900 via-indigo-950 to-blue-950 text-white rounded-3xl p-4 shadow-xl border border-white/10 mb-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-amber-400/20 border border-amber-400/30 flex items-center justify-center text-amber-400 shrink-0">
              <ClipboardList className="w-4 h-4" />
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight leading-tight">Day End Report</h1>
              {/* Supervisor Info with quick edit */}
              <div className="flex items-center gap-1.5 text-[10px] text-blue-200">
                <span>Supervisor: {supervisorPhone}</span>
                <button
                  onClick={() => setIsEditingSupervisor(!isEditingSupervisor)}
                  className="text-amber-300 hover:text-amber-400 underline flex items-center gap-0.5"
                >
                  <Edit2 className="w-2.5 h-2.5" /> Change
                </button>
              </div>
            </div>
          </div>
          <span className="bg-amber-400 text-slate-950 text-xs font-black px-2.5 py-1 rounded-full shadow-sm">
            {entries.length} Deliveries
          </span>
        </div>

        {/* Supervisor Edit Drawer */}
        {isEditingSupervisor && (
          <div className="bg-white/15 backdrop-blur-md rounded-2xl p-2.5 mb-2.5 border border-amber-400/30 text-xs">
            <p className="font-bold text-amber-300 text-[11px] mb-1.5 flex items-center justify-between">
              <span>Select Supervisor or Enter WhatsApp Phone:</span>
              <button onClick={() => setIsEditingSupervisor(false)} className="text-white/70 hover:text-white">
                <X className="w-3.5 h-3.5" />
              </button>
            </p>
            {supervisorsList.length > 0 && (
              <div className="flex gap-1.5 flex-wrap mb-2">
                {supervisorsList.map((sup) => (
                  <button
                    key={sup.id}
                    onClick={() => handleSaveSupervisorPhone(sup.username || '917337487571')}
                    className="bg-white/10 hover:bg-white/25 px-2 py-1 rounded-lg text-[10px] font-medium transition-colors"
                  >
                    {sup.name}
                  </button>
                ))}
              </div>
            )}
            <div className="flex gap-1.5">
              <input
                type="text"
                defaultValue={supervisorPhone}
                id="supervisor-phone-input"
                placeholder="+91..."
                className="flex-1 bg-black/30 border border-white/20 rounded-xl px-2.5 py-1 text-xs text-white placeholder-blue-300 focus:outline-none focus:ring-1 focus:ring-amber-400"
              />
              <button
                onClick={() => {
                  const input = document.getElementById('supervisor-phone-input') as HTMLInputElement;
                  if (input) handleSaveSupervisorPhone(input.value);
                }}
                className="bg-amber-400 text-slate-950 font-bold px-3 py-1 rounded-xl text-xs hover:bg-amber-300 transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        )}

        {/* Database Status Strip */}
        <div className="bg-white/10 backdrop-blur-md rounded-2xl p-2.5 mb-3 border border-white/10 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <Database className="w-4 h-4 text-emerald-400 shrink-0" />
            <div className="min-w-0">
              <span className="font-semibold text-white text-xs block truncate">
                {dbCount > 0 ? `${dbCount.toLocaleString()} Master Consumers` : 'Unsynced'}
              </span>
              <span className="text-blue-200 text-[10px] flex items-center gap-1">
                {lastSyncedTime ? (
                  <>
                    <Clock className="w-3 h-3 text-blue-300" /> Synced: {lastSyncedTime}
                  </>
                ) : (
                  'Tap Re-Sync to refresh'
                )}
              </span>
            </div>
          </div>
          <button
            onClick={syncFullMasterDatabase}
            disabled={isSyncingDb}
            className="bg-amber-400 hover:bg-amber-500 text-slate-950 font-bold px-2.5 py-1.5 rounded-xl shadow-sm flex items-center gap-1 transition-all active:scale-95 text-[11px] disabled:opacity-50 shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncingDb ? 'animate-spin' : ''}`} />
            {isSyncingDb ? 'Syncing' : 'Re-Sync'}
          </button>
        </div>

        {/* Sync Progress Bar */}
        {isSyncingDb && (
          <div className="mb-3 pt-1">
            <div className="flex items-center justify-between text-[10px] text-amber-200 mb-1 font-medium">
              <span className="truncate">{syncStatusText}</span>
              <span className="font-bold">{syncProgress}%</span>
            </div>
            <div className="w-full bg-black/30 rounded-full h-1.5 overflow-hidden border border-white/10">
              <div
                className="bg-gradient-to-r from-amber-400 to-emerald-400 h-full rounded-full transition-all duration-300"
                style={{ width: `${syncProgress}%` }}
              />
            </div>
          </div>
        )}

        {/* Agent Metadata Fields */}
        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-white/10">
          <div>
            <label className="text-[10px] font-semibold text-blue-200 flex items-center gap-1 mb-1 uppercase tracking-wider">
              <User className="w-3 h-3 text-amber-400" /> Agent Name
            </label>
            <input
              type="text"
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
              className="w-full bg-white/10 border border-white/15 rounded-xl px-2.5 py-1.5 text-xs text-white placeholder-blue-300 focus:outline-none focus:ring-2 focus:ring-amber-400"
              placeholder="Your name"
            />
          </div>
          <div>
            <label className="text-[10px] font-semibold text-blue-200 flex items-center gap-1 mb-1 uppercase tracking-wider">
              <Calendar className="w-3 h-3 text-amber-400" /> Date
            </label>
            <input
              type="date"
              value={reportDate}
              onChange={(e) => setReportDate(e.target.value)}
              className="w-full bg-white/10 border border-white/15 rounded-xl px-2.5 py-1.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          </div>
        </div>
      </div>

      {/* 1-Tap Import Today's Route Banner (If route exists) */}
      {assignedRouteStops.length > 0 && (
        <div className="bg-gradient-to-r from-blue-700 via-indigo-700 to-blue-800 text-white p-3.5 rounded-2xl shadow-md border border-blue-400/30 mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
              <Truck className="w-5 h-5 text-amber-300" />
            </div>
            <div className="min-w-0">
              <h3 className="text-xs font-bold leading-tight truncate">Today's Assigned Route</h3>
              <p className="text-[10px] text-blue-200">
                {assignedRouteStops.length} stops scheduled for {formattedDateString}
              </p>
            </div>
          </div>
          <button
            onClick={handleImportAssignedRoute}
            className="bg-amber-400 hover:bg-amber-300 active:scale-95 text-slate-950 font-black px-3 py-1.5 rounded-xl text-xs flex items-center gap-1 shrink-0 shadow-sm transition-all"
          >
            <Plus className="w-3.5 h-3.5" /> Import Route
          </button>
        </div>
      )}

      {/* Gemini AI Receipt Scanner Launch Banner */}
      <button
        type="button"
        onClick={() => setIsLiveScannerOpen(true)}
        className="w-full mb-3 bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 hover:from-amber-600 hover:to-orange-600 text-slate-950 font-bold p-3.5 rounded-2xl shadow-lg shadow-orange-500/20 active:scale-98 transition-all flex items-center justify-between border border-amber-300/40"
      >
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-slate-950/20 flex items-center justify-center text-slate-950 shrink-0">
            <Camera className="w-5 h-5 text-slate-950" />
          </div>
          <div className="text-left">
            <h3 className="text-xs font-black tracking-tight uppercase text-slate-950">📸 Gemini AI Receipt Scanner</h3>
            <p className="text-[11px] font-bold text-slate-900/90">1-Tap Snap cash memos to extract Cons No & Name</p>
          </div>
        </div>
        <span className="bg-slate-950 text-amber-400 text-[10px] font-extrabold px-2.5 py-1 rounded-lg uppercase tracking-wider shrink-0 shadow-sm">
          OPEN SCANNER
        </span>
      </button>

      {/* Segmented Action Control (Search & Bulk Entry Modes) */}
      <div className="bg-slate-200/80 p-1 rounded-2xl grid grid-cols-2 gap-1 mb-3">
        <button
          onClick={() => setInputMode('single')}
          className={`py-2 px-1 rounded-xl text-[11px] font-bold transition-all flex items-center justify-center gap-1 ${
            inputMode === 'single'
              ? 'bg-white text-blue-900 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Search className="w-3.5 h-3.5" /> Search
        </button>
        <button
          onClick={() => setInputMode('bulk')}
          className={`py-2 px-1 rounded-xl text-[11px] font-bold transition-all flex items-center justify-center gap-1 ${
            inputMode === 'bulk'
              ? 'bg-white text-purple-900 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <FileText className="w-3.5 h-3.5" /> Bulk
        </button>
      </div>

      {/* Input Section Card */}
      <div className="bg-white rounded-3xl p-3.5 shadow-sm border border-slate-200 mb-3">
        {inputMode === 'single' ? (
          /* Single Search Mode */
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
                  placeholder="Search consumer number (31k+)..."
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

            {/* Auto-Complete Suggestion Dropdown */}
            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1.5 bg-white border border-blue-100 rounded-2xl shadow-2xl z-50 max-h-72 overflow-y-auto divide-y divide-slate-100 ring-1 ring-slate-900/5">
                <div className="px-3 py-1.5 bg-slate-50 text-[11px] font-semibold text-slate-500 flex items-center justify-between sticky top-0 border-b border-slate-100">
                  <span>Matches ({suggestions.length})</span>
                  <span className="text-[10px] text-blue-600 font-semibold">Tap to add</span>
                </div>
                {suggestions.map((item) => {
                  const isExact = item.consumer_number.toLowerCase() === singleInput.trim().toLowerCase();

                  return (
                    <div
                      key={item.consumer_number}
                      onClick={() => handleSelectSuggestion(item)}
                      className={`p-3 hover:bg-blue-50/80 cursor-pointer transition-colors flex items-center justify-between group ${
                        isExact ? 'bg-amber-50/70 border-l-4 border-l-amber-500' : ''
                      }`}
                    >
                      <div className="min-w-0 pr-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-sm text-blue-900 font-mono">
                            #{highlightMatch(item.consumer_number, singleInput)}
                          </span>
                          <span className="font-semibold text-xs text-slate-800">
                            {highlightMatch(item.consumer_name, singleInput)}
                          </span>
                          {item.cylinder_type === '10KG_LITE' && (
                            <span className="text-[9px] bg-purple-600 text-white font-bold px-1.5 py-0.5 rounded-md">
                              10kg Lite
                            </span>
                          )}
                          {isExact && (
                            <span className="text-[9px] bg-amber-500 text-white font-bold px-1.5 py-0.5 rounded-full uppercase">
                              Exact Match
                            </span>
                          )}
                        </div>
                        {item.mobile && item.mobile.includes(singleInput.trim()) && (
                          <p className="text-[11px] text-indigo-600 flex items-center gap-1 mt-0.5">
                            <Phone className="w-3 h-3 text-indigo-400 shrink-0" />
                            {highlightMatch(item.mobile, singleInput)}
                          </p>
                        )}
                        {item.address && (
                          <p className="text-[11px] text-slate-500 truncate max-w-xs flex items-center gap-1 mt-0.5">
                            <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                            {item.address}
                          </p>
                        )}
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-blue-600 transition-colors shrink-0" />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          /* Bulk Paste Mode */
          <div>
            <label className="text-xs text-slate-600 font-medium block mb-1">
              Paste Consumer Numbers (comma/space/newline separated):
            </label>
            <textarea
              value={rawInput}
              onChange={(e) => setRawInput(e.target.value)}
              rows={3}
              placeholder="Paste numbers e.g. 10293, 10294, 10295..."
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
                  <Loader2 className="w-4 h-4 animate-spin" /> Verifying against 31k Data...
                </>
              ) : (
                'Process Bulk Numbers'
              )}
            </button>
          </div>
        )}
      </div>

      {/* LPG Reconciliation KPI Strip */}
      {entries.length > 0 && (
        <div className="bg-white rounded-3xl p-3 shadow-sm border border-slate-200 mb-3">
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1">
              <Flame className="w-3.5 h-3.5 text-orange-500" /> LPG Stock & Cash Reconciliation
            </span>
            <span className="text-slate-400 font-normal">Tap chips in list to adjust</span>
          </div>

          <div className="grid grid-cols-4 gap-1.5 mb-2">
            <div className="bg-blue-50 border border-blue-100 rounded-2xl p-2 text-center">
              <span className="text-[10px] text-blue-600 font-semibold block">14.2kg Std</span>
              <span className="text-base font-black text-blue-900">{kpis.count14kg}</span>
            </div>
            <div className="bg-purple-50 border border-purple-100 rounded-2xl p-2 text-center">
              <span className="text-[10px] text-purple-600 font-semibold block">10kg Lite</span>
              <span className="text-base font-black text-purple-900">{kpis.count10kg}</span>
            </div>
            <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-2 text-center">
              <span className="text-[10px] text-emerald-600 font-semibold block">Empties</span>
              <span className="text-base font-black text-emerald-900">{kpis.emptiesCollected}</span>
            </div>
            <div className="bg-amber-50 border border-amber-100 rounded-2xl p-2 text-center">
              <span className="text-[10px] text-amber-700 font-semibold block">Total</span>
              <span className="text-base font-black text-amber-950">{kpis.totalDeliveries}</span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-1.5 text-center text-xs">
            <div className="bg-slate-50 border border-slate-100 rounded-xl p-1.5 flex items-center justify-center gap-1 font-semibold text-slate-700">
              <Banknote className="w-3.5 h-3.5 text-emerald-600" />
              <span>Cash: <strong className="text-slate-900">{kpis.cashCount}</strong></span>
            </div>
            <div className="bg-slate-50 border border-slate-100 rounded-xl p-1.5 flex items-center justify-center gap-1 font-semibold text-slate-700">
              <QrCode className="w-3.5 h-3.5 text-blue-600" />
              <span>UPI: <strong className="text-slate-900">{kpis.upiCount}</strong></span>
            </div>
            <div className="bg-slate-50 border border-slate-100 rounded-xl p-1.5 flex items-center justify-center gap-1 font-semibold text-slate-700">
              <Clock className="w-3.5 h-3.5 text-rose-500" />
              <span>Due: <strong className="text-slate-900">{kpis.dueCount}</strong></span>
            </div>
          </div>
        </div>
      )}

      {/* Deliveries List */}
      <div className="bg-white rounded-3xl p-3.5 shadow-sm border border-slate-200 mb-3">
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
                title="Copy comma-separated numbers"
              >
                {copiedCsv ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedCsv ? 'Copied CSV' : 'Copy CSV'}
              </button>
              <button
                onClick={handleClearAll}
                className="text-[11px] text-rose-600 hover:text-rose-700 font-semibold flex items-center gap-1 hover:bg-rose-50 px-2 py-1 rounded-lg transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" /> Clear
              </button>
            </div>
          )}
        </div>

        {/* Deliveries In-List Search & Filter Tabs */}
        {entries.length > 0 && (
          <div className="space-y-2 mb-3">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={listSearchQuery}
                onChange={(e) => setListSearchQuery(e.target.value)}
                placeholder="Search in added deliveries..."
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

            <div className="flex gap-1 overflow-x-auto pb-1">
              <button
                onClick={() => setListFilterTab('ALL')}
                className={`px-2.5 py-1 rounded-xl text-[10px] font-bold shrink-0 transition-all ${
                  listFilterTab === 'ALL'
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                All ({entries.length})
              </button>
              <button
                onClick={() => setListFilterTab('14KG')}
                className={`px-2.5 py-1 rounded-xl text-[10px] font-bold shrink-0 transition-all ${
                  listFilterTab === '14KG'
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                14.2kg ({kpis.count14kg})
              </button>
              <button
                onClick={() => setListFilterTab('10KG')}
                className={`px-2.5 py-1 rounded-xl text-[10px] font-bold shrink-0 transition-all ${
                  listFilterTab === '10KG'
                    ? 'bg-purple-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                10kg Lite ({kpis.count10kg})
              </button>
              <button
                onClick={() => setListFilterTab('UNVERIFIED')}
                className={`px-2.5 py-1 rounded-xl text-[10px] font-bold shrink-0 transition-all ${
                  listFilterTab === 'UNVERIFIED'
                    ? 'bg-amber-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                Unverified ({entries.filter((e) => !e.found).length})
              </button>
            </div>
          </div>
        )}

        {entries.length === 0 ? (
          <div className="text-center py-6 text-slate-400">
            <ClipboardList className="w-8 h-8 mx-auto mb-1 opacity-40 text-slate-400" />
            <p className="text-xs font-semibold text-slate-500">No deliveries added yet</p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Use Quick Search, Bulk Paste, or Camera Scanner above
            </p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
            {displayedEntries.map((item, index) => {
              const originalIndex = entries.findIndex((e) => e.consumer_number === item.consumer_number);

              return (
                <div
                  key={`${item.consumer_number}-${index}`}
                  className="p-2.5 rounded-2xl border border-slate-100 bg-slate-50/90 hover:bg-slate-100 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <span className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full text-[11px] font-black flex items-center justify-center mt-0.5">
                        {originalIndex + 1}
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-bold text-xs text-slate-900 font-mono">
                            #{item.consumer_number}
                          </span>
                          {item.found ? (
                            <span className="inline-flex items-center gap-0.5 text-[9px] bg-emerald-100 text-emerald-700 font-bold px-1.5 py-0.5 rounded-md">
                              <CheckCheck className="w-2.5 h-2.5" /> Verified
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-0.5 text-[9px] bg-amber-100 text-amber-700 font-bold px-1.5 py-0.5 rounded-md">
                              <XCircle className="w-2.5 h-2.5" /> Unverified
                            </span>
                          )}
                          {item.source === 'route' && (
                            <span className="inline-flex items-center gap-0.5 text-[9px] bg-blue-100 text-blue-700 font-bold px-1.5 py-0.5 rounded-md">
                              <Truck className="w-2.5 h-2.5" /> Route
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-700 font-semibold truncate">{item.consumer_name}</p>
                        {item.address && (
                          <p className="text-[10px] text-slate-400 truncate max-w-xs">{item.address}</p>
                        )}
                      </div>
                    </div>

                    {/* Move and Delete Buttons */}
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        onClick={() => handleMoveEntry(originalIndex, 'up')}
                        disabled={originalIndex === 0}
                        className="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-slate-800 disabled:opacity-20 rounded-xl"
                        title="Move Up"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleMoveEntry(originalIndex, 'down')}
                        disabled={originalIndex === entries.length - 1}
                        className="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-slate-800 disabled:opacity-20 rounded-xl"
                        title="Move Down"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleRemoveEntry(originalIndex)}
                        className="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors"
                        title="Remove"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Interactive Status Chips (Cylinder, Payment, Empty) */}
                  <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-slate-200/60">
                    {/* Cylinder Type Toggle Chip */}
                    <button
                      onClick={() => handleToggleCylinder(originalIndex)}
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-lg flex items-center gap-1 transition-all ${
                        item.cylinder_type === '10KG_LITE'
                          ? 'bg-purple-100 text-purple-800 border border-purple-200'
                          : item.cylinder_type === '19KG_COMM'
                          ? 'bg-amber-100 text-amber-800 border border-amber-200'
                          : 'bg-blue-100 text-blue-800 border border-blue-200'
                      }`}
                      title="Tap to change cylinder type"
                    >
                      <Flame className="w-3 h-3" />
                      {item.cylinder_type === '10KG_LITE' ? '10kg Lite' : item.cylinder_type === '19KG_COMM' ? '19kg Comm' : '14.2kg Std'}
                    </button>

                    {/* Payment Mode Toggle Chip */}
                    <button
                      onClick={() => handleTogglePayment(originalIndex)}
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-lg flex items-center gap-1 transition-all ${
                        item.payment_mode === 'CASH'
                          ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                          : item.payment_mode === 'UPI'
                          ? 'bg-indigo-100 text-indigo-800 border border-indigo-200'
                          : 'bg-rose-100 text-rose-800 border border-rose-200'
                      }`}
                      title="Tap to change payment mode"
                    >
                      {item.payment_mode === 'CASH' ? (
                        <Banknote className="w-3 h-3" />
                      ) : item.payment_mode === 'UPI' ? (
                        <QrCode className="w-3 h-3" />
                      ) : (
                        <Clock className="w-3 h-3" />
                      )}
                      {item.payment_mode}
                    </button>

                    {/* Empty Cylinder Collected Toggle */}
                    <button
                      onClick={() => handleToggleEmpty(originalIndex)}
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-lg flex items-center gap-1 transition-all ${
                        item.empty_collected
                          ? 'bg-teal-100 text-teal-800 border border-teal-200'
                          : 'bg-slate-200 text-slate-600 border border-slate-300'
                      }`}
                      title="Tap to toggle empty cylinder collected"
                    >
                      <RotateCcw className="w-3 h-3" />
                      {item.empty_collected ? 'Empty: Yes' : 'Empty: No'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Floating Mobile Bottom Action Dock */}
      <div className="fixed bottom-[68px] left-3 right-3 z-40 max-w-xl mx-auto">
        <div className="bg-slate-900/95 backdrop-blur-md border border-slate-700/70 p-2.5 rounded-2xl shadow-2xl flex gap-2 items-center">
          <button
            onClick={handleShareWhatsApp}
            disabled={entries.length === 0}
            className="flex-1 bg-emerald-600 hover:bg-emerald-500 active:scale-98 text-white py-3 px-4 rounded-xl font-black text-xs sm:text-sm disabled:opacity-40 transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/30"
          >
            <Send className="w-4 h-4" /> Share on WhatsApp ({entries.length})
          </button>
          <button
            onClick={handleCopyToClipboard}
            disabled={entries.length === 0}
            className="bg-white/10 hover:bg-white/20 active:scale-98 text-white p-3 rounded-xl disabled:opacity-40 transition-all flex items-center justify-center shrink-0 border border-white/10"
            title="Copy Full Report"
          >
            {copiedReport ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Live Camera Continuous Scanner Modal */}
      <LiveCameraScannerModal
        isOpen={isLiveScannerOpen}
        onClose={() => setIsLiveScannerOpen(false)}
        onConsumerScanned={handleConsumerAutoScanned}
        existingNumbers={entries.map((e) => e.consumer_number)}
      />

      <AgentBottomNav />
    </div>
  );
};

export default AgentDispatchSummary;
