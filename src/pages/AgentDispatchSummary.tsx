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
  Share2, 
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
  Camera,
  Mic,
  Image as ImageIcon
} from 'lucide-react';
import toast from 'react-hot-toast';
import { scanBillReceipt } from '../lib/billScanner';

interface ItemEntry {
  consumer_number: string;
  consumer_name: string;
  address?: string;
  mobile?: string;
  found: boolean;
  source?: 'local' | 'remote' | 'manual';
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

export const AgentDispatchSummary: React.FC = () => {
  const [agentName, setAgentName] = useState<string>('Delivery Agent');
  const [agentId, setAgentId] = useState<string>(() => localStorage.getItem('bgcls_agent_id') || 'agent_default');
  const [reportDate, setReportDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [rawInput, setRawInput] = useState<string>('');
  const [singleInput, setSingleInput] = useState<string>('');
  const [isLoaded, setIsLoaded] = useState<boolean>(false);

  const [entries, setEntries] = useState<ItemEntry[]>(() => {
    try {
      const devId = getDeviceId();
      const currentAgent = localStorage.getItem('bgcls_agent_id') || 'agent_default';
      const today = new Date().toISOString().split('T')[0];
      
      // 1. Try date + device + agent specific key
      const scopedKey = `bgcls_day_end_entries_${devId}_${currentAgent}_${today}`;
      const savedScoped = localStorage.getItem(scopedKey);
      if (savedScoped) return JSON.parse(savedScoped);

      // 2. Try latest device fallback
      const savedLatest = localStorage.getItem(`bgcls_day_end_latest_${devId}`);
      if (savedLatest) return JSON.parse(savedLatest);

      // 3. Fallback to legacy global key
      const legacy = localStorage.getItem('bgcls_day_end_entries');
      if (legacy) return JSON.parse(legacy);

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

  // Fetch agent details and total DB count on mount
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

  // Hydrate local database with full 31k+ consumers from Supabase (Fixed Step = 1000)
  const syncFullMasterDatabase = async () => {
    if (!navigator.onLine) {
      toast.error('Internet connection required to sync database');
      return;
    }

    setIsSyncingDb(true);
    setSyncProgress(0);
    setSyncStatusText('Connecting to server...');

    try {
      // 1. Get exact remote count from Supabase
      const { count: totalRemote, error: countErr } = await supabase
        .from('consumers')
        .select('*', { count: 'exact', head: true });

      if (countErr) throw countErr;

      const totalToFetch = totalRemote || 31359;
      let allFetched: any[] = [];
      let from = 0;
      const step = 1000; // Exact Supabase REST limit per query (no row skipped!)
      let fetchMore = true;

      setSyncStatusText(`Starting download of ${totalToFetch.toLocaleString()} records...`);

      // 2. Fetch all batches in step = 1000 from manager_consumer_summary (includes has_location & has_photos)
      while (fetchMore) {
        const { data, error } = await supabase
          .from('manager_consumer_summary')
          .select('id, consumer_number, consumer_name, mobile, address, verification_status, area_code, created_at, has_location, has_photos')
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

      // 3. Populate Dexie IndexedDB in chunks
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

        // Clear existing local data and bulk insert
        await db.consumers.clear();

        // Bulk insert in chunks of 5000 for smooth UI responsiveness
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

  // Helper relevance ranker for search results (Consumer Number MUST match)
  const rankSearchResults = (items: Consumer[], rawQuery: string): Consumer[] => {
    const q = rawQuery.trim().toLowerCase();
    if (!q) return [];

    // Mandatory: Consumer Number MUST contain the query
    const valid = items.filter((c) => {
      return (c.consumer_number || '').toLowerCase().includes(q);
    });

    return valid.sort((a, b) => {
      const numA = (a.consumer_number || '').toLowerCase();
      const numB = (b.consumer_number || '').toLowerCase();

      // 1. Exact Consumer Number match
      if (numA === q && numB !== q) return -1;
      if (numB === q && numA !== q) return 1;

      // 2. Consumer Number starts with query
      const numAStarts = numA.startsWith(q);
      const numBStarts = numB.startsWith(q);
      if (numAStarts && !numBStarts) return -1;
      if (numBStarts && !numAStarts) return 1;

      // 3. Numerical sort on consumer_number
      return numA.localeCompare(numB, undefined, { numeric: true });
    });
  };

  // Real-time search suggestions logic (Strictly Consumer Number - Instant local search)
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

        // 1. IndexedDB fast prefix match using consumer_number index (0ms)
        const localMatches = await db.consumers
          .where('consumer_number')
          .startsWith(query)
          .limit(30)
          .toArray();

        localMatches.forEach((item) => combinedMap.set(item.consumer_number, item));

        // 2. Fast indexed sub-prefix search if prefix matches are few (scans index candidate pool in <5ms)
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

          // Fallback scan across local DB if candidate pool returned few items
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
      consumer_number: consumer.consumer_number,
      consumer_name: consumer.consumer_name,
      address: consumer.address,
      mobile: consumer.mobile,
      found: true,
      source: 'local',
    };

    setEntries((prev) => [...prev, newEntry]);
    setSingleInput('');
    setShowSuggestions(false);
    toast.success(`Added ${consumer.consumer_name} (#${consumer.consumer_number})`);
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

      // Bulk Dexie lookup using fast anyOf query
      const localMatches = await db.consumers
        .where('consumer_number')
        .anyOfIgnoreCase(uniqueNewNumbers)
        .toArray();

      const resolvedMap = new Map<string, ItemEntry>();
      localMatches.forEach((match) => {
        resolvedMap.set(match.consumer_number.toLowerCase(), {
          consumer_number: match.consumer_number,
          consumer_name: match.consumer_name,
          address: match.address,
          mobile: match.mobile,
          found: true,
          source: 'local',
        });
      });

      const missingNumbers = uniqueNewNumbers.filter((num) => !resolvedMap.has(num.toLowerCase()));

      // Remote Supabase lookup for missing numbers
      if (missingNumbers.length > 0 && navigator.onLine) {
        try {
          const { data: remoteResults } = await supabase
            .from('consumers')
            .select('id, consumer_number, consumer_name, address, mobile')
            .in('consumer_number', missingNumbers);

          if (remoteResults && remoteResults.length > 0) {
            remoteResults.forEach((r: any) => {
              resolvedMap.set(r.consumer_number.toLowerCase(), {
                consumer_number: r.consumer_number,
                consumer_name: r.consumer_name,
                address: r.address,
                mobile: r.mobile,
                found: true,
                source: 'remote',
              });

              db.consumers
                .put({
                  id: r.id || undefined,
                  consumer_number: r.consumer_number,
                  consumer_name: r.consumer_name,
                  mobile: r.mobile || '',
                  address: r.address || '',
                  verification_status: 'Not Collected',
                  created_at: new Date().toISOString(),
                  searchWords: [
                    ...(r.consumer_name ? r.consumer_name.toLowerCase().split(/\s+/) : []),
                    ...(r.consumer_number ? [r.consumer_number.toLowerCase()] : []),
                    ...(r.mobile ? [r.mobile.toLowerCase()] : []),
                  ],
                })
                .catch(console.error);
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

    const match = await db.consumers
      .where('consumer_number')
      .equalsIgnoreCase(cleanNum)
      .first();

    if (match) {
      setEntries((prev) => [
        ...prev,
        {
          consumer_number: match.consumer_number,
          consumer_name: match.consumer_name,
          address: match.address,
          mobile: match.mobile,
          found: true,
          source: 'local',
        },
      ]);
      setSingleInput('');
      setShowSuggestions(false);
      toast.success(`Added ${match.consumer_name}`);
      return;
    }

    if (navigator.onLine) {
      const { data: remoteData } = await supabase
        .from('consumers')
        .select('consumer_number, consumer_name, address, mobile')
        .eq('consumer_number', cleanNum)
        .maybeSingle();

      if (remoteData) {
        setEntries((prev) => [
          ...prev,
          {
            consumer_number: remoteData.consumer_number,
            consumer_name: remoteData.consumer_name,
            address: remoteData.address,
            mobile: remoteData.mobile,
            found: true,
            source: 'remote',
          },
        ]);
        setSingleInput('');
        setShowSuggestions(false);
        toast.success(`Added ${remoteData.consumer_name}`);
        return;
      }
    }

    setEntries((prev) => [
      ...prev,
      {
        consumer_number: cleanNum,
        consumer_name: 'Consumer Record Not Found',
        found: false,
        source: 'manual',
      },
    ]);
    setSingleInput('');
    setShowSuggestions(false);
    toast.success(`Added consumer #${cleanNum}`);
  };

  const handleRemoveEntry = (index: number) => {
    const itemToRemove = entries[index];
    setEntries((prev) => prev.filter((_, i) => i !== index));
    toast.success(`Removed #${itemToRemove.consumer_number}`);
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
      setEntries([]);
      try {
        const key = getDeviceScopedKey(agentId, reportDate);
        localStorage.removeItem(key);
        localStorage.removeItem(`bgcls_day_end_latest_${getDeviceId()}`);
        localStorage.removeItem('bgcls_day_end_entries');
      } catch (err) {
        console.error('Failed to clear local storage keys:', err);
      }
      toast.success('List cleared');
    }
  };

  // Format Date to DD/MM/YYYY
  const formattedDateString = useMemo(() => {
    if (!reportDate) return '';
    const [year, month, day] = reportDate.split('-');
    return `${day}/${month}/${year}`;
  }, [reportDate]);

  // Construct WhatsApp report text
  const reportMessageText = useMemo(() => {
    if (entries.length === 0) return '';

    let text = `📦 *BHARAT GAS - DAY END DELIVERY REPORT*\n`;
    text += `👤 *Agent Name:* ${agentName.trim()}\n`;
    text += `📅 *Date:* ${formattedDateString}\n`;
    text += `📊 *Total Deliveries Completed:* ${entries.length}\n\n`;
    text += `*Completed Deliveries List:*\n`;

    entries.forEach((item, index) => {
      text += `${index + 1}. ${item.consumer_number} - ${item.consumer_name}\n`;
    });

    const rawNumbersCsv = entries.map((item) => item.consumer_number).join(',');
    text += `\n${rawNumbersCsv}`;

    return text;
  }, [entries, agentName, formattedDateString]);

  // Raw CSV numbers string
  const rawCsvString = useMemo(() => {
    return entries.map((item) => item.consumer_number).join(',');
  }, [entries]);

  const [inputMode, setInputMode] = useState<'single' | 'scan' | 'voice' | 'bulk'>('single');
  const [isScanningBill, setIsScanningBill] = useState<boolean>(false);
  const [scanPreviewUrl, setScanPreviewUrl] = useState<string | null>(null);
  const [isListeningVoice, setIsListeningVoice] = useState<boolean>(false);

  // Handle Bill Receipt Photo Upload & OCR Extraction (e.g. Cons No:28721381)
  const handleBillPhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsScanningBill(true);
    const previewUrl = URL.createObjectURL(file);
    setScanPreviewUrl(previewUrl);
    toast.loading('Scanning Siddhartha Bharatgas bill receipt...', { id: 'ocr' });

    try {
      const res = await scanBillReceipt(file);
      if (res.found && res.consumerNumber) {
        if (entries.some((e) => e.consumer_number.toLowerCase() === res.consumerNumber.toLowerCase())) {
          toast.error(`Consumer #${res.consumerNumber} (${res.consumerName}) is already added`, { id: 'ocr' });
        } else {
          setEntries((prev) => [
            ...prev,
            {
              consumer_number: res.consumerNumber,
              consumer_name: res.consumerName || 'Consumer Record Found',
              address: res.address,
              mobile: res.mobile,
              found: true,
              source: 'local',
            },
          ]);
          toast.success(`Scanned #${res.consumerNumber} - ${res.consumerName || 'Verified'}!`, { id: 'ocr' });
        }
      } else if (res.consumerNumber) {
        if (entries.some((e) => e.consumer_number.toLowerCase() === res.consumerNumber.toLowerCase())) {
          toast.error(`Consumer #${res.consumerNumber} is already added`, { id: 'ocr' });
        } else {
          setEntries((prev) => [
            ...prev,
            {
              consumer_number: res.consumerNumber,
              consumer_name: 'Consumer Record Not Found',
              found: false,
              source: 'manual',
            },
          ]);
          toast.success(`Extracted Cons No: #${res.consumerNumber}`, { id: 'ocr' });
        }
      } else {
        toast.error('Could not find "Cons No:" on bill. Please take a clearer photo.', { id: 'ocr' });
      }
    } catch (err) {
      console.error('Bill OCR scan failed:', err);
      toast.error('Failed to scan bill photo', { id: 'ocr' });
    } finally {
      setIsScanningBill(false);
    }
  };

  // Handle Speech Voice Dictation ("2 8 7 2 1 3 8 1")
  const handleVoiceDictation = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error('Voice dictation is not supported in this browser');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    setIsListeningVoice(true);
    toast.loading('Listening... Speak consumer number aloud', { id: 'voice' });

    recognition.onresult = async (event: any) => {
      setIsListeningVoice(false);
      const transcript = event.results[0][0].transcript;
      const cleanNum = transcript.replace(/[^0-9]/g, '');

      if (!cleanNum) {
        toast.error(`Could not parse numbers from "${transcript}"`, { id: 'voice' });
        return;
      }

      setSingleInput(cleanNum);
      setInputMode('single');
      toast.success(`Heard: #${cleanNum}`, { id: 'voice' });
    };

    recognition.onerror = (err: any) => {
      console.error('Voice error:', err);
      setIsListeningVoice(false);
      toast.error('Voice recognition stopped', { id: 'voice' });
    };

    recognition.onend = () => {
      setIsListeningVoice(false);
    };

    recognition.start();
  };

  // Share via WhatsApp
  const handleShareWhatsApp = () => {
    if (entries.length === 0) {
      toast.error('Please add at least one consumer to share');
      return;
    }

    const phoneNumber = '917337487571';
    const encodedText = encodeURIComponent(reportMessageText);
    const whatsappUrl = `https://api.whatsapp.com/send?phone=${phoneNumber}&text=${encodedText}`;

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
    <div className="min-h-screen bg-slate-100 pb-36 pt-3 px-3 max-w-xl mx-auto font-sans">
      {/* Sleek Mobile Compact Header */}
      <div className="bg-gradient-to-br from-slate-900 via-indigo-950 to-blue-950 text-white rounded-3xl p-4 shadow-xl border border-white/10 mb-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-amber-400/20 border border-amber-400/30 flex items-center justify-center text-amber-400 shrink-0">
              <ClipboardList className="w-4 h-4" />
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight leading-tight">Day End Report</h1>
              <p className="text-[10px] text-blue-200">Supervisor: +91 7337487571</p>
            </div>
          </div>
          <span className="bg-amber-400 text-slate-950 text-xs font-black px-2.5 py-1 rounded-full shadow-sm">
            {entries.length} Deliveries
          </span>
        </div>

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

      {/* Segmented Action Control (4 Non-Typing / Fast Entry Modes) */}
      <div className="bg-slate-200/80 p-1 rounded-2xl grid grid-cols-4 gap-1 mb-3">
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
          onClick={() => setInputMode('scan')}
          className={`py-2 px-1 rounded-xl text-[11px] font-bold transition-all flex items-center justify-center gap-1 ${
            inputMode === 'scan'
              ? 'bg-white text-indigo-900 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Camera className="w-3.5 h-3.5 text-amber-600" /> Scan Bill
        </button>
        <button
          onClick={() => setInputMode('voice')}
          className={`py-2 px-1 rounded-xl text-[11px] font-bold transition-all flex items-center justify-center gap-1 ${
            inputMode === 'voice'
              ? 'bg-white text-emerald-900 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Mic className="w-3.5 h-3.5 text-emerald-600" /> Voice
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
        ) : inputMode === 'scan' ? (
          /* Bill Photo OCR Scanner Mode (Siddhartha Bharatgas Receipt Cons No: 28721381) */
          <div className="text-center py-2">
            <p className="text-xs font-bold text-slate-800 mb-1">
              📷 Scan Siddhartha Bharatgas Bill Receipt
            </p>
            <p className="text-[11px] text-slate-500 mb-3">
              Takes photo or selects bill image to extract <strong className="text-blue-600 font-semibold">Cons No: 28721381</strong> automatically
            </p>

            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleBillPhotoUpload}
              className="hidden"
              id="camera-bill-file-input"
            />
            <label
              htmlFor="camera-bill-file-input"
              className="inline-flex items-center justify-center gap-2 bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 hover:from-blue-700 hover:to-indigo-700 text-white font-bold px-5 py-3 rounded-2xl shadow-lg shadow-blue-600/30 cursor-pointer active:scale-95 transition-all text-xs sm:text-sm"
            >
              {isScanningBill ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-amber-300" /> Scanning Receipt OCR...
                </>
              ) : (
                <>
                  <Camera className="w-4 h-4 text-amber-300" /> Take Bill Photo / Upload
                </>
              )}
            </label>

            {scanPreviewUrl && (
              <div className="mt-3 relative max-w-xs mx-auto rounded-2xl overflow-hidden border border-slate-200 shadow-sm">
                <img src={scanPreviewUrl} alt="Bill Receipt Preview" className="w-full h-32 object-cover" />
                <span className="absolute bottom-1 right-1 bg-slate-900/80 text-white text-[9px] px-2 py-0.5 rounded-md backdrop-blur-sm font-semibold">
                  Scanned Receipt
                </span>
              </div>
            )}
          </div>
        ) : inputMode === 'voice' ? (
          /* Speech Voice Dictation Mode ("2 8 7 2 1 3 8 1") */
          <div className="text-center py-3">
            <p className="text-xs font-bold text-slate-800 mb-1">
              🎙️ Speak Consumer Number Aloud
            </p>
            <p className="text-[11px] text-slate-500 mb-3">
              Speak numbers into mic (e.g. "2 8 7 2 1 3 8 1")
            </p>

            <button
              type="button"
              onClick={handleVoiceDictation}
              disabled={isListeningVoice}
              className={`w-14 h-14 rounded-full mx-auto flex items-center justify-center text-white shadow-xl transition-all ${
                isListeningVoice
                  ? 'bg-rose-500 animate-pulse ring-8 ring-rose-200'
                  : 'bg-gradient-to-br from-emerald-600 to-teal-600 active:scale-95 hover:scale-105 shadow-emerald-600/30'
              }`}
            >
              {isListeningVoice ? <Mic className="w-6 h-6 animate-bounce" /> : <Mic className="w-6 h-6" />}
            </button>
            <p className="text-[11px] font-bold text-slate-600 mt-2">
              {isListeningVoice ? 'Listening... Speak numbers now' : 'Tap mic to start speaking'}
            </p>
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

        {entries.length === 0 ? (
          <div className="text-center py-6 text-slate-400">
            <ClipboardList className="w-8 h-8 mx-auto mb-1 opacity-40 text-slate-400" />
            <p className="text-xs font-semibold text-slate-500">No deliveries added yet</p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Use Quick Search or Bulk Paste above to add completed deliveries
            </p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
            {entries.map((item, index) => (
              <div
                key={`${item.consumer_number}-${index}`}
                className="flex items-center justify-between p-2.5 rounded-2xl border border-slate-100 bg-slate-50/80 hover:bg-slate-100 transition-colors"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full text-[11px] font-black flex items-center justify-center">
                    {index + 1}
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
                    </div>
                    <p className="text-xs text-slate-700 font-medium truncate">{item.consumer_name}</p>
                    {item.address && (
                      <p className="text-[10px] text-slate-400 truncate max-w-xs">{item.address}</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    onClick={() => handleMoveEntry(index, 'up')}
                    disabled={index === 0}
                    className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-800 disabled:opacity-20 rounded-xl"
                    title="Move Up"
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleMoveEntry(index, 'down')}
                    disabled={index === entries.length - 1}
                    className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-800 disabled:opacity-20 rounded-xl"
                    title="Move Down"
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleRemoveEntry(index)}
                    className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors"
                    title="Remove"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Floating Mobile Bottom Action Dock */}
      <div className="fixed bottom-[68px] left-3 right-3 z-40 max-w-xl mx-auto">
        <div className="bg-slate-900/90 backdrop-blur-md border border-slate-700/60 p-2 rounded-2xl shadow-2xl flex gap-2 items-center">
          <button
            onClick={handleShareWhatsApp}
            disabled={entries.length === 0}
            className="flex-1 bg-emerald-600 hover:bg-emerald-500 active:scale-98 text-white py-3 px-4 rounded-xl font-black text-xs sm:text-sm disabled:opacity-40 transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/30"
          >
            <Send className="w-4 h-4" /> Share on WhatsApp
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

      <AgentBottomNav />
    </div>
  );
};

export default AgentDispatchSummary;
