import React, { useEffect, useRef, useState, useCallback } from 'react';
import { 
  X, 
  Flashlight, 
  CheckCircle2, 
  AlertCircle, 
  Sparkles, 
  Loader2, 
  Search, 
  Plus, 
  Check, 
  Camera,
  Image as ImageIcon,
  Upload,
  WifiOff
} from 'lucide-react';
import db, { type Consumer } from '../lib/db';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import { scanBillWithGemini } from '../lib/gemini';
import { matchConsumerWithDatabase } from '../lib/consumerMatcher';

interface LiveCameraScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConsumerScanned: (consumer: {
    consumer_id?: string;
    consumer_number: string;
    consumer_name: string;
    address?: string;
    mobile?: string;
    found: boolean;
    duplicate_of_agent?: string;
    duplicate_claimed_date?: string;
  }) => void;
  existingNumbers: string[];
  claimedByOtherAgents?: Record<string, { agentName: string; date?: string; consumerName?: string }>;
  agentName?: string;
  agentId?: string;
}

interface ScannedSessionItem {
  consumer_number: string;
  consumer_name: string;
  timestamp: number;
}

interface FailedScanItem {
  raw_number: string;
  reason: string;
  timestamp: number;
}

export interface ActiveScanFailAlert {
  type: 'NOT_FOUND' | 'NAME_MISMATCH' | 'TOO_LONG' | 'BLACKLISTED' | 'NOT_DETECTED';
  consumer_number?: string;
  consumer_name?: string;
  db_consumer_name?: string;
  reason: string;
}

const DISTRIBUTOR_BLACKLIST = new Set([
  '169624',
  '23092200',
  '23192200',
  '23192211',
  '1800224344',
  '7718012345',
  '7715012345',
  '1718012345',
  '17718012345',
  '17715012345',
  '36406262986',
  '500054',
  '271119',
  '99400',
  '94666',
  '2367',
  '19441220350',
]);

function playSuccessBeep() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch (err) {
    // Audio fallback
  }
}

function playWarningAlarm() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, ctx.currentTime);
    osc.frequency.setValueAtTime(160, ctx.currentTime + 0.15);
    osc.frequency.setValueAtTime(220, ctx.currentTime + 0.3);
    gain.gain.setValueAtTime(0.35, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.5);
  } catch (err) {
    // Audio fallback
  }
}

function cleanAndNormalizeDigits(raw: string): string {
  const digits = raw
    .toUpperCase()
    .replace(/I|L|\|/g, '1')
    .replace(/O|Q/g, '0')
    .replace(/B/g, '8')
    .replace(/Z/g, '2')
    .replace(/S/g, '5')
    .replace(/G/g, '6')
    .replace(/T/g, '7')
    .replace(/[^0-9]/g, '');

  const unpadded = digits.replace(/^0+/, '');
  return unpadded || digits;
}

export const LiveCameraScannerModal: React.FC<LiveCameraScannerModalProps> = ({
  isOpen,
  onClose,
  onConsumerScanned,
  existingNumbers,
  claimedByOtherAgents = {},
  agentName,
  agentId,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [alreadyAddedNotice, setAlreadyAddedNotice] = useState<string | null>(null);
  const [duplicateScamNotice, setDuplicateScamNotice] = useState<{
    consumer_number: string;
    consumer_name: string;
    agentName: string;
    date?: string;
  } | null>(null);
  const [torchOn, setTorchOn] = useState<boolean>(false);
  const [scannedSessionList, setScannedSessionList] = useState<ScannedSessionItem[]>([]);
  const [failedScanList, setFailedScanList] = useState<FailedScanItem[]>([]);
  const [showFailedList, setShowFailedList] = useState<boolean>(false);
  const [showSessionList, setShowSessionList] = useState<boolean>(false);
  const [activeScanFailAlert, setActiveScanFailAlert] = useState<ActiveScanFailAlert | null>(null);
  const manualInputRef = useRef<HTMLInputElement | null>(null);
  const [statusText, setStatusText] = useState<string>('Align "Details of Receiver:" in view');
  const [manualInput, setManualInput] = useState<string>('');
  const [isSuccessFlash, setIsSuccessFlash] = useState<boolean>(false);
  const [isShutterFlash, setIsShutterFlash] = useState<boolean>(false);
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);

  // Monitor network online/offline state
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setStatusText('Connection restored — Ready to scan');
    };
    const handleOffline = () => {
      setIsOnline(false);
      setStatusText('Offline: AI Snap requires connection');
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Set of all added consumer numbers to prevent re-adding
  const scannedSetRef = useRef<Set<string>>(new Set(existingNumbers.map((n) => n.toLowerCase())));
  
  // Cooldown map to avoid spamming the same bill
  const recentSeenCooldownRef = useRef<Map<string, number>>(new Map());

  // Sync existing numbers
  useEffect(() => {
    existingNumbers.forEach((num) => scannedSetRef.current.add(num.toLowerCase()));
  }, [existingNumbers]);

  // Start video stream when modal opens
  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      return;
    }

    startCamera();

    return () => {
      stopCamera();
    };
  }, [isOpen]);

  const startCamera = async () => {
    try {
      setStatusText('Connecting to HD camera...');
      
      // Request natural aspect ratio and continuous autofocus for sharp receipts
      const constraints: any = {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          focusMode: { ideal: 'continuous' },
          advanced: [
            { focusMode: 'continuous' },
            { exposureMode: 'continuous' },
            { whiteBalanceMode: 'continuous' }
          ]
        },
      };

      let mediaStream: MediaStream;
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (errFallback) {
        // Fallback to basic environment camera if advanced constraints fail
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' }
        });
      }

      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        await videoRef.current.play();
      }

      // Attempt to apply continuous autofocus capability
      const track = mediaStream.getVideoTracks()[0];
      if (track) {
        const capabilities: any = track.getCapabilities ? track.getCapabilities() : {};
        if (capabilities.focusMode && capabilities.focusMode.includes('continuous')) {
          await track.applyConstraints({
            advanced: [{ focusMode: 'continuous' } as any]
          }).catch(() => {});
        }
      }

      setStatusText('Gemini AI Vision Active — Hold bill steady');
    } catch (err) {
      console.error('Camera access error:', err);
      setStatusText('Camera unavailable or permission denied');
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
    }
  };

  // Toggle flashlight/torch
  const toggleTorch = async () => {
    if (!stream) return;
    const track = stream.getVideoTracks()[0];
    if (track && (track.getCapabilities() as any)?.torch) {
      try {
        await track.applyConstraints({
          advanced: [{ torch: !torchOn } as any],
        });
        setTorchOn(!torchOn);
      } catch (e) {
        console.error('Torch error:', e);
      }
    }
  };

  // Tap-to-focus on mobile
  const triggerFocus = async () => {
    if (!stream) return;
    const track = stream.getVideoTracks()[0];
    if (track) {
      const capabilities: any = track.getCapabilities ? track.getCapabilities() : {};
      if (capabilities.focusMode && capabilities.focusMode.includes('continuous')) {
        await track.applyConstraints({
          advanced: [{ focusMode: 'continuous' } as any]
        }).catch(() => {});
      }
    }
  };

  // Direct action handlers for on-screen scan failure alert
  const handleForceAdd = (overrideNum?: string, overrideName?: string) => {
    const targetNum = overrideNum || activeScanFailAlert?.consumer_number || '';
    const cleanNum = cleanAndNormalizeDigits(targetNum);
    if (!cleanNum) {
      toast.error('Invalid Consumer Number');
      return;
    }
    const finalName = (overrideName || activeScanFailAlert?.consumer_name || '').trim() || `Customer #${cleanNum}`;

    // Mark as added in local scanned set
    scannedSetRef.current.add(cleanNum.toLowerCase());

    // Check for double bill scam
    const otherClaimant = claimedByOtherAgents[cleanNum.toLowerCase()];
    if (otherClaimant) {
      playWarningAlarm();
      setDuplicateScamNotice({
        consumer_number: cleanNum,
        consumer_name: finalName,
        agentName: otherClaimant.agentName,
        date: otherClaimant.date,
      });
    } else {
      playSuccessBeep();
    }

    setIsSuccessFlash(true);
    setTimeout(() => setIsSuccessFlash(false), 400);

    setLastScanned(`${cleanNum} - ${finalName}`);
    setScannedSessionList((prev) => [
      { consumer_number: cleanNum, consumer_name: finalName, timestamp: Date.now() },
      ...prev,
    ]);

    // Add to audit log
    try {
      const todayStr = new Date().toISOString().split('T')[0];
      const rawLog = localStorage.getItem('bgcls_scanned_receipts_audit_log');
      const log = rawLog ? JSON.parse(rawLog) : [];
      log.unshift({
        consumer_number: cleanNum,
        consumer_name: finalName,
        address: 'Directly Verified / Physical Bill',
        mobile: '',
        found: true,
        cylinder_type: '14.2KG_STD',
        timestamp: Date.now(),
        date: todayStr,
        agent_name: (agentName || '').trim().toUpperCase(),
        agent_id: agentId,
      });
      localStorage.setItem('bgcls_scanned_receipts_audit_log', JSON.stringify(log.slice(0, 300)));
    } catch (_) {}

    // Call onConsumerScanned with found: true so parent pages accept it
    onConsumerScanned({
      consumer_number: cleanNum,
      consumer_name: finalName,
      address: 'Directly Verified / Physical Bill',
      mobile: '',
      found: true,
      duplicate_of_agent: otherClaimant ? otherClaimant.agentName : undefined,
      duplicate_claimed_date: otherClaimant ? otherClaimant.date : undefined,
    });

    toast.success(`✨ Added #${cleanNum} (${finalName})!`, { id: 'scan-snap' });
    setStatusText(`Added #${cleanNum}! Ready for next bill`);

    // Remove from failedScanList if present
    setFailedScanList((prev) => prev.filter((item) => item.raw_number !== cleanNum));

    // Clear alert
    setActiveScanFailAlert(null);
  };

  const handleEditNumber = () => {
    if (activeScanFailAlert?.consumer_number) {
      setManualInput(activeScanFailAlert.consumer_number);
    }
    setActiveScanFailAlert(null);
    setTimeout(() => {
      manualInputRef.current?.focus();
      manualInputRef.current?.select();
    }, 100);
  };

  const handleRetrySnap = () => {
    setActiveScanFailAlert(null);
    setTimeout(() => {
      performScan();
    }, 150);
  };

  // Process a candidate consumer number match
  const processMatchedConsumerNumber = async (
    rawNum: string,
    extractedName?: string
  ): Promise<boolean> => {
    const cleanNum = cleanAndNormalizeDigits(rawNum);

    if (!cleanNum || cleanNum.length < 1 || cleanNum.length > 12) {
      playWarningAlarm();
      if (navigator.vibrate) navigator.vibrate([300, 100, 300]);
      const reason = cleanNum && cleanNum.length > 12
        ? `Too many digits (${cleanNum.length}). Bharatgas numbers are 1-10 digits.`
        : 'Could not extract valid digits.';
      setActiveScanFailAlert({
        type: 'TOO_LONG',
        consumer_number: cleanNum,
        consumer_name: extractedName,
        reason,
      });
      if (cleanNum) {
        setFailedScanList((prev) => [
          { raw_number: cleanNum, reason: `Too long (${cleanNum.length} digits)`, timestamp: Date.now() },
          ...prev,
        ]);
      }
      return false;
    }

    if (DISTRIBUTOR_BLACKLIST.has(cleanNum)) {
      playWarningAlarm();
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
      setActiveScanFailAlert({
        type: 'BLACKLISTED',
        consumer_number: cleanNum,
        consumer_name: extractedName,
        reason: `Ignored distributor / telephone code #${cleanNum}. Aim camera at "Details of Receiver:".`,
      });
      return false;
    }

    // Match with local Dexie or remote Supabase, checking number, name, and 8/6/0 variants!
    const match = await matchConsumerWithDatabase(cleanNum, extractedName);

    // STRICT DATABASE VERIFICATION GUARD:
    // If consumer is not verified in the database, show prominent alert directly on screen!
    if (!match.found) {
      playWarningAlarm();
      if (navigator.vibrate) navigator.vibrate([400, 150, 400]);
      const isMismatch = match.name_verified === false && Boolean(match.consumer_name);
      const failReason = isMismatch
        ? `Receipt has "${extractedName || 'Unknown'}", but Agency Database has "${match.consumer_name}".`
        : `Consumer #${cleanNum} is NOT found in agency database.`;

      // Trigger direct on-screen popup alert immediately
      setActiveScanFailAlert({
        type: isMismatch ? 'NAME_MISMATCH' : 'NOT_FOUND',
        consumer_number: cleanNum,
        consumer_name: extractedName || '',
        db_consumer_name: isMismatch ? match.consumer_name : undefined,
        reason: failReason,
      });

      setStatusText(`Bill #${cleanNum} not verified. Action required above.`);
      setFailedScanList((prev) => [
        { raw_number: cleanNum, reason: isMismatch ? 'Name mismatch' : 'Not found in database', timestamp: Date.now() },
        ...prev,
      ]);
      return false;
    }

    const resolvedNum = match.consumer_number;
    const finalName = match.consumer_name;
    const finalAddress = match.address || 'Verified in Agency Database';
    const finalMobile = match.mobile || '';

    // Anti-spam cooldown (5 seconds for the same number)
    const now = Date.now();
    const lastSeen =
      recentSeenCooldownRef.current.get(resolvedNum.toLowerCase()) ||
      recentSeenCooldownRef.current.get(cleanNum.toLowerCase());
    if (lastSeen && now - lastSeen < 5000) {
      return false;
    }
    recentSeenCooldownRef.current.set(resolvedNum.toLowerCase(), now);
    recentSeenCooldownRef.current.set(cleanNum.toLowerCase(), now);

    const isAlreadyAdded =
      scannedSetRef.current.has(resolvedNum.toLowerCase()) ||
      scannedSetRef.current.has(cleanNum.toLowerCase());
    if (isAlreadyAdded) {
      setAlreadyAddedNotice(`Consumer #${resolvedNum} is already in delivery list!`);
      setTimeout(() => setAlreadyAddedNotice(null), 2500);
      return true;
    }

    // INSTANT ADDITION TO UI FOR VERIFIED CONSUMER
    scannedSetRef.current.add(resolvedNum.toLowerCase());
    scannedSetRef.current.add(cleanNum.toLowerCase());
    setAlreadyAddedNotice(null);

    // ANTI-FRAUD / DOUBLE-BILL SCAM GUARD:
    // Check if this cash memo was ALREADY submitted by another delivery boy!
    const otherClaimant =
      claimedByOtherAgents[resolvedNum.toLowerCase()] ||
      claimedByOtherAgents[cleanNum.toLowerCase()];

    if (otherClaimant) {
      if (navigator.vibrate) navigator.vibrate([400, 150, 400, 150, 400]);
      playWarningAlarm();

      setDuplicateScamNotice({
        consumer_number: resolvedNum,
        consumer_name: finalName,
        agentName: otherClaimant.agentName,
        date: otherClaimant.date,
      });

      toast.error(
        `🚨 DOUBLE BILL SCAM ALERT! Bill #${resolvedNum} (${finalName}) was ALREADY GIVEN BY ${otherClaimant.agentName.toUpperCase()}!`,
        { id: 'scam-alert', duration: 8000 }
      );
    } else {
      if (navigator.vibrate) navigator.vibrate([100, 40, 100]);
      playSuccessBeep();
    }

    setIsSuccessFlash(true);
    setTimeout(() => setIsSuccessFlash(false), 400);

    setLastScanned(`${resolvedNum} - ${finalName}`);
    setScannedSessionList((prev) => [
      { consumer_number: resolvedNum, consumer_name: finalName, timestamp: Date.now() },
      ...prev,
    ]);

    // Persistent Write-Ahead Audit Log (Survives app switching, browser refresh & RAM clearing)
    try {
      const todayStr = new Date().toISOString().split('T')[0];
      const rawLog = localStorage.getItem('bgcls_scanned_receipts_audit_log');
      const log = rawLog ? JSON.parse(rawLog) : [];
      log.unshift({
        consumer_id: match.consumer_id,
        consumer_number: resolvedNum,
        consumer_name: finalName,
        address: finalAddress,
        mobile: finalMobile,
        found: true,
        cylinder_type: '14.2KG_STD',
        timestamp: Date.now(),
        date: todayStr,
        agent_name: (agentName || '').trim().toUpperCase(),
        agent_id: agentId,
      });
      // Retain latest 300 scans
      localStorage.setItem('bgcls_scanned_receipts_audit_log', JSON.stringify(log.slice(0, 300)));
    } catch (_) {}

    onConsumerScanned({
      consumer_id: match.consumer_id,
      consumer_number: resolvedNum,
      consumer_name: finalName,
      address: finalAddress,
      mobile: finalMobile,
      found: true,
      duplicate_of_agent: otherClaimant ? otherClaimant.agentName : undefined,
      duplicate_claimed_date: otherClaimant ? otherClaimant.date : undefined,
    });

    if (match.corrected) {
      toast.success(
        `✨ Verified: #${resolvedNum} (${finalName}) [Auto-corrected dot-matrix 8/6 from #${match.original_number}]`,
        { id: 'scan-snap', duration: 4500 }
      );
    } else if (match.name_verified) {
      toast.success(
        `✨ Verified: #${resolvedNum} (${finalName})`,
        { id: 'scan-snap' }
      );
    } else {
      toast.success(`✨ Added #${resolvedNum} (${finalName})!`, { id: 'scan-snap' });
    }

    return true;
  };

  /**
   * Capture the full camera frame at optimal clarity (1000px max, lightweight JPEG)
   * Drastically reduces network upload payload to ~60KB for sub-second Gemini inference.
   */
  const captureCameraFrame = (): string | null => {
    if (!videoRef.current || !canvasRef.current) return null;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx || video.videoWidth === 0 || video.videoHeight === 0) return null;

    const maxDim = 1600;
    let targetW = video.videoWidth;
    let targetH = video.videoHeight;
    if (targetW > maxDim || targetH > maxDim) {
      if (targetW > targetH) {
        targetH = Math.round((targetH * maxDim) / targetW);
        targetW = maxDim;
      } else {
        targetW = Math.round((targetW * maxDim) / targetH);
        targetH = maxDim;
      }
    }

    canvas.width = targetW;
    canvas.height = targetH;
    ctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight, 0, 0, targetW, targetH);

    return canvas.toDataURL('image/jpeg', 0.88);
  };

  // Main Scan Trigger (Exclusively Gemini AI Vision - 1-Tap Snap)
  const performScan = useCallback(async () => {
    if (isProcessing || !videoRef.current) return;

    if (!navigator.onLine) {
      toast.error('Offline: AI Snap requires internet. Type Cons No below.', { id: 'scan-snap' });
      return;
    }

    const imgDataUrl = captureCameraFrame();
    if (!imgDataUrl) return;

    setActiveScanFailAlert(null);
    setIsProcessing(true);
    setIsShutterFlash(true);
    setTimeout(() => setIsShutterFlash(false), 200);
    toast.loading('Gemini AI reading cash memo...', { id: 'scan-snap' });

    try {
      setStatusText('Gemini AI reading Cons No & Name...');
      const result = await scanBillWithGemini(imgDataUrl);

      if (result.error) {
        playWarningAlarm();
        setActiveScanFailAlert({
          type: 'NOT_DETECTED',
          reason: `AI Notice: ${result.error}`,
        });
        toast.error(`AI Notice: ${result.error}`, { id: 'scan-snap' });
        setStatusText('Hold bill steady and tap Snap...');
        return;
      }

      if (result.found && result.consumerNumber) {
        const matched = await processMatchedConsumerNumber(result.consumerNumber, result.consumerName);
        if (matched) {
          toast.success('Matched successfully!', { id: 'scan-snap' });
          setStatusText(`Matched #${result.consumerNumber}! Ready for next bill`);
          return;
        }
      } else {
        playWarningAlarm();
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
        setActiveScanFailAlert({
          type: 'NOT_DETECTED',
          reason: 'Cons No: not detected. Make sure "Details of Receiver:" is in view & in focus.',
        });
        setStatusText('Cons No not detected. Tap Retry or type number.');
        toast.error('Cons No: not detected. Make sure "Details of Receiver:" is in view & in focus.', {
          id: 'scan-snap',
          duration: 3500,
        });
      }
    } catch (err: any) {
      console.warn('Scan cycle error:', err);
      toast.error(`Scan error: ${err.message || 'Check connection'}`, { id: 'scan-snap' });
    } finally {
      setIsProcessing(false);
    }
  }, [isProcessing]);

  // Direct Photo Capture / Gallery Upload Handler
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!navigator.onLine) {
      toast.error('Offline: AI Snap requires internet. Type Cons No below.', { id: 'scan-snap' });
      return;
    }

    setActiveScanFailAlert(null);
    setIsProcessing(true);
    setIsShutterFlash(true);
    setTimeout(() => setIsShutterFlash(false), 200);
    toast.loading('Gemini AI reading photo...', { id: 'scan-snap' });

    try {
      setStatusText('Gemini AI reading photo...');
      const result = await scanBillWithGemini(file);

      if (result.error) {
        playWarningAlarm();
        setActiveScanFailAlert({
          type: 'NOT_DETECTED',
          reason: `AI Notice: ${result.error}`,
        });
        toast.error(`AI Notice: ${result.error}`, { id: 'scan-snap' });
        setStatusText('Hold bill steady and tap Snap...');
        return;
      }

      if (result.found && result.consumerNumber) {
        const matched = await processMatchedConsumerNumber(result.consumerNumber, result.consumerName);
        if (matched) {
          toast.success('Matched successfully!', { id: 'scan-snap' });
          setStatusText(`Matched #${result.consumerNumber}! Ready for next bill`);
          return;
        }
      } else {
        playWarningAlarm();
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
        setActiveScanFailAlert({
          type: 'NOT_DETECTED',
          reason: 'Cons No: not detected in photo. Make sure "Details of Receiver:" is clearly visible.',
        });
        setStatusText('Cons No: not detected in photo...');
        toast.error('Cons No: not detected. Make sure "Details of Receiver:" is clearly visible.', {
          id: 'scan-snap',
          duration: 3500,
        });
      }
    } catch (err: any) {
      console.warn('File upload scan error:', err);
      toast.error(`Scan error: ${err.message || 'Check connection'}`, { id: 'scan-snap' });
    } finally {
      setIsProcessing(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Manual Key-in Handler
  const handleManualAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualInput.trim()) return;

    setIsProcessing(true);
    const cleanNum = cleanAndNormalizeDigits(manualInput);

    if (!cleanNum) {
      toast.error('Please enter valid digits for Consumer Number');
      setIsProcessing(false);
      return;
    }

    const ok = await processMatchedConsumerNumber(cleanNum);
    if (ok) {
      setManualInput('');
    } else {
      toast.error(`Could not add Consumer #${cleanNum}`);
    }
    setIsProcessing(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col justify-between overflow-hidden font-sans select-none">
      {/* 1. FULLSCREEN VIDEO STREAM VIEWFINDER */}
      <div 
        onClick={triggerFocus}
        className="absolute inset-0 w-full h-full bg-black flex items-center justify-center cursor-pointer overflow-hidden"
        title="Tap to focus"
      >
        <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
        <canvas ref={canvasRef} className="hidden" />

        {/* Shutter Flash Animation */}
        {isShutterFlash && (
          <div className="absolute inset-0 bg-white/70 pointer-events-none z-30 transition-opacity duration-150" />
        )}

        {/* Target Box Guides: Formatted for Bharatgas Cash Memos */}
        <div
          className={`absolute top-[12%] bottom-[25%] inset-x-5 sm:inset-x-12 max-w-sm mx-auto border-2 rounded-3xl pointer-events-none flex flex-col justify-between p-3.5 sm:p-4 transition-all duration-300 z-10 ${
            isSuccessFlash
              ? 'border-emerald-400 bg-emerald-500/20 shadow-[0_0_80px_rgba(16,185,129,0.5)]'
              : 'border-dashed border-amber-400/80 shadow-[0_0_60px_rgba(245,158,11,0.25)]'
          }`}
        >
          <div className="flex justify-between">
            <div className="w-6 h-6 sm:w-7 sm:h-7 border-t-4 border-l-4 border-amber-400 rounded-tl-xl" />
            <div className="w-6 h-6 sm:w-7 sm:h-7 border-t-4 border-r-4 border-amber-400 rounded-tr-xl" />
          </div>

          {/* Sweeping Laser Animation Line */}
          <div className="relative w-full h-1 overflow-visible">
            <div className="absolute inset-x-0 h-0.5 bg-gradient-to-r from-transparent via-amber-400 to-transparent shadow-[0_0_14px_#fbbf24] animate-pulse" />
          </div>

          {/* Central Instruction Badge */}
          <div className="text-center bg-slate-950/85 backdrop-blur-md text-amber-300 font-extrabold text-[11px] sm:text-xs py-1.5 px-3 sm:py-2 sm:px-4 rounded-full mx-auto border border-amber-400/40 shadow-lg flex items-center gap-1.5 pointer-events-none">
            {isProcessing ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
                <span>Reading Cons No & Name...</span>
              </>
            ) : (
              <>
                <Camera className="w-3.5 h-3.5 text-amber-400" />
                <span>Align receipt & tap Snap</span>
              </>
            )}
          </div>

          <div className="flex justify-between">
            <div className="w-6 h-6 sm:w-7 sm:h-7 border-b-4 border-l-4 border-amber-400 rounded-bl-xl" />
            <div className="w-6 h-6 sm:w-7 sm:h-7 border-b-4 border-r-4 border-amber-400 rounded-br-xl" />
          </div>
        </div>
      </div>

      {/* 2. FLOATING TOP HEADER OVERLAY */}
      <div className="relative z-30 bg-gradient-to-b from-slate-950 via-slate-950/70 to-transparent p-3 pt-3.5 text-white">
        <div className="flex items-center justify-between max-w-lg mx-auto">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-amber-500/20 border border-amber-400/30 flex items-center justify-center text-amber-400 shrink-0">
              <Sparkles className="w-4 h-4 text-amber-400 animate-pulse" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xs sm:text-sm font-bold tracking-tight flex items-center gap-1.5 truncate">
                <span>Gemini AI Scanner</span>
                {scannedSessionList.length > 0 && (
                  <span className="text-[10px] bg-emerald-500/30 text-emerald-300 border border-emerald-400/40 font-black px-1.5 py-0.2 rounded-full">
                    {scannedSessionList.length} Added
                  </span>
                )}
              </h2>
              <p className="text-[10px] text-slate-300 truncate">
                {agentName ? `Scanning for: ${agentName}` : 'Aim at Cons No & Name'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={toggleTorch}
              className={`p-2 sm:p-2.5 rounded-xl border transition-all active:scale-95 ${
                torchOn ? 'bg-amber-500 text-slate-900 border-amber-400' : 'bg-white/10 text-white border-white/15'
              }`}
              title="Toggle Flashlight"
            >
              <Flashlight className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 sm:p-2.5 rounded-xl bg-white/10 hover:bg-white/20 active:scale-95 text-white border border-white/15 transition-all"
              title="Close Scanner"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Floating Notification Alerts */}
        <div className="max-w-lg mx-auto mt-1 space-y-1">
          {duplicateScamNotice && (
            <div className="bg-gradient-to-r from-rose-600 via-rose-700 to-red-800 text-white p-2.5 rounded-2xl shadow-2xl border-2 border-rose-300 flex items-start gap-2 animate-in zoom-in-95 duration-200">
              <span className="text-base leading-none">🚨</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-black uppercase tracking-wider bg-black/40 px-1.5 py-0.2 rounded-full text-rose-200">
                    DOUBLE BILL SCAM
                  </span>
                  <button type="button" onClick={() => setDuplicateScamNotice(null)} className="text-white/80 p-0.5">
                    <X size={14} />
                  </button>
                </div>
                <p className="text-xs font-black truncate mt-0.5">
                  #{duplicateScamNotice.consumer_number} — {duplicateScamNotice.consumer_name}
                </p>
                <p className="text-[10px] text-amber-200 font-bold">
                  ALREADY GIVEN BY: <span className="underline uppercase text-white font-black">{duplicateScamNotice.agentName}</span>
                </p>
              </div>
            </div>
          )}

          {alreadyAddedNotice && (
            <div className="bg-amber-500 text-slate-950 p-2 rounded-xl shadow-lg flex items-center gap-2 border border-amber-300 font-bold text-xs animate-pulse">
              <AlertCircle className="w-4 h-4 shrink-0 text-slate-950" />
              <span className="truncate">{alreadyAddedNotice}</span>
            </div>
          )}

          {!isOnline && !alreadyAddedNotice && (
            <div className="bg-amber-500 text-slate-950 p-2 rounded-xl shadow-lg flex items-center gap-2 border border-amber-300 font-bold text-xs animate-pulse">
              <WifiOff className="w-4 h-4 shrink-0 text-slate-950" />
              <span className="truncate">Offline mode: Type Cons No below</span>
            </div>
          )}

          {lastScanned && !alreadyAddedNotice && !duplicateScamNotice && (
            <div className="bg-emerald-600/95 text-white p-2 rounded-xl shadow-lg flex items-center gap-2 border border-emerald-400/40">
              <CheckCircle2 className="w-4 h-4 text-amber-300 shrink-0" />
              <span className="text-xs font-black truncate uppercase">ADDED: #{lastScanned}</span>
            </div>
          )}
        </div>
      </div>

      {/* 3. DIRECT SCAN FAILURE MODAL OVERLAY (SCROLLABLE & FULLY VISIBLE ON ANY MOBILE) */}
      {activeScanFailAlert && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-3 animate-in fade-in zoom-in-95 duration-150 overflow-y-auto">
          <div className="bg-gradient-to-b from-slate-900 via-rose-950/50 to-slate-900 border-2 border-rose-500 rounded-3xl p-4 w-full max-w-sm text-white shadow-[0_0_60px_rgba(244,63,94,0.4)] flex flex-col gap-3 max-h-[88vh] overflow-y-auto my-auto">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-rose-500/30 pb-2">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-rose-500/20 border border-rose-400/40 flex items-center justify-center text-rose-400 shrink-0">
                  <AlertCircle className="w-5 h-5 text-rose-400 animate-bounce" />
                </div>
                <div>
                  <h3 className="text-xs sm:text-sm font-black text-rose-300 uppercase tracking-wide">
                    {activeScanFailAlert.type === 'NAME_MISMATCH'
                      ? '⚠️ Name Mismatch!'
                      : activeScanFailAlert.type === 'NOT_FOUND'
                      ? '❌ Not In Database!'
                      : activeScanFailAlert.type === 'NOT_DETECTED'
                      ? '🔍 Cons No Not Detected!'
                      : '⚠️ Bill Not Added!'}
                  </h3>
                  <p className="text-[10px] text-slate-300 font-medium">Choose action for this bill</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveScanFailAlert(null)}
                className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Bill Details Box */}
            <div className="bg-slate-950/80 rounded-2xl p-3 border border-rose-500/30 flex flex-col gap-2">
              {activeScanFailAlert.consumer_number && (
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-bold text-slate-400">Scanned Number</span>
                  <span className="font-mono text-base font-black text-amber-400">
                    #{activeScanFailAlert.consumer_number}
                  </span>
                </div>
              )}
              {activeScanFailAlert.consumer_name && (
                <div className="flex items-start justify-between gap-2 border-t border-white/5 pt-1.5">
                  <span className="text-[10px] uppercase font-bold text-slate-400 shrink-0">Receipt Name</span>
                  <span className="text-xs font-bold text-white text-right truncate">
                    {activeScanFailAlert.consumer_name}
                  </span>
                </div>
              )}
              {activeScanFailAlert.db_consumer_name && (
                <div className="flex items-start justify-between gap-2 border-t border-white/5 pt-1.5">
                  <span className="text-[10px] uppercase font-bold text-rose-400 shrink-0">Database Name</span>
                  <span className="text-xs font-bold text-rose-200 text-right truncate">
                    {activeScanFailAlert.db_consumer_name}
                  </span>
                </div>
              )}

              {/* Reason Explanation */}
              <div className="bg-rose-950/40 rounded-xl p-2 border border-rose-500/20 text-[11px] text-rose-200 font-semibold leading-relaxed mt-0.5">
                {activeScanFailAlert.reason}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col gap-2 pt-0.5">
              {activeScanFailAlert.consumer_number && (
                <button
                  type="button"
                  onClick={() => handleForceAdd()}
                  className="w-full bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 hover:from-emerald-500 hover:to-teal-500 text-white font-black py-2.5 sm:py-3 px-3 rounded-2xl shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2 text-xs uppercase tracking-wide border border-emerald-400/50"
                >
                  <Check className="w-4 h-4" />
                  <span>Force Add (#{activeScanFailAlert.consumer_number})</span>
                </button>
              )}

              <div className="flex gap-2">
                {activeScanFailAlert.consumer_number && (
                  <button
                    type="button"
                    onClick={handleEditNumber}
                    className="flex-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black py-2 px-2 rounded-xl text-xs flex items-center justify-center gap-1 active:scale-95 transition-all shadow"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Edit</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleRetrySnap}
                  className="flex-1 bg-slate-800 hover:bg-slate-700 border border-white/20 text-white font-bold py-2 px-2 rounded-xl text-xs flex items-center justify-center gap-1 active:scale-95 transition-all"
                >
                  <Camera className="w-3.5 h-3.5 text-amber-400" />
                  <span>Retry</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveScanFailAlert(null)}
                  className="bg-white/10 hover:bg-white/20 text-slate-300 font-semibold py-2 px-3 rounded-xl text-xs transition-all shrink-0"
                >
                  Skip
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4. FLOATING BOTTOM CONTROL DECK OVERLAY */}
      <div className="relative z-30 mt-auto bg-gradient-to-t from-slate-950 via-slate-950/95 to-transparent p-3 pt-4 text-white">
        <div className="max-w-lg mx-auto flex flex-col gap-2.5">
          {/* Main Shutter & Photo Snap Button Row */}
          <div className="flex items-center gap-2">
            <input
              type="file"
              ref={fileInputRef}
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleFileUpload}
            />

            {/* BIG 1-TAP AI SNAP PRIMARY SHUTTER BUTTON */}
            <button
              type="button"
              onClick={performScan}
              disabled={isProcessing || !isOnline}
              className={`flex-1 font-black py-3.5 px-4 rounded-2xl shadow-2xl active:scale-95 transition-all flex items-center justify-center gap-2 border text-sm uppercase tracking-wide disabled:opacity-60 ${
                !isOnline
                  ? 'bg-slate-800 text-amber-300 border-amber-500/40 shadow-none cursor-not-allowed'
                  : 'bg-gradient-to-r from-amber-400 via-orange-500 to-amber-500 hover:from-amber-500 hover:to-orange-600 text-slate-950 border-amber-300 shadow-orange-500/30'
              }`}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin text-slate-950" />
                  <span>Reading...</span>
                </>
              ) : !isOnline ? (
                <>
                  <WifiOff className="w-5 h-5 text-amber-400" />
                  <span>Offline (Type Below)</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-5 h-5 text-slate-950 animate-pulse" />
                  <span>1-TAP AI SNAP</span>
                </>
              )}
            </button>

            {/* Photo / Gallery Upload Button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing}
              className="bg-slate-900/90 hover:bg-slate-800 text-white font-bold py-3.5 px-3.5 rounded-2xl shadow-xl active:scale-95 transition-all flex items-center justify-center gap-1.5 border border-white/20 text-xs disabled:opacity-50 shrink-0"
              title="Snap with phone camera or pick from gallery"
            >
              <Camera className="w-4 h-4 text-amber-400" />
              <span className="text-[11px] font-semibold">Photo</span>
            </button>
          </div>

          {/* Quick Expandable Session Status Bar */}
          {(scannedSessionList.length > 0 || failedScanList.length > 0) && (
            <div className="flex items-center justify-between text-[11px] bg-slate-900/80 border border-white/10 px-3 py-1.5 rounded-xl">
              <div className="flex items-center gap-2">
                {scannedSessionList.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowSessionList((v) => !v);
                      setShowFailedList(false);
                    }}
                    className="text-emerald-400 font-bold hover:underline flex items-center gap-1"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>{scannedSessionList.length} Added</span>
                  </button>
                )}
                {failedScanList.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowFailedList((v) => !v);
                      setShowSessionList(false);
                    }}
                    className="text-rose-400 font-bold hover:underline flex items-center gap-1"
                  >
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span>{failedScanList.length} Failed</span>
                  </button>
                )}
              </div>
              <span className="text-[10px] text-slate-400 font-medium truncate max-w-[150px]">
                {statusText}
              </span>
            </div>
          )}

          {/* Collapsible Session Added Bills Sheet */}
          {showSessionList && scannedSessionList.length > 0 && (
            <div className="bg-slate-900/95 border border-white/15 p-2 rounded-2xl max-h-28 overflow-x-auto flex gap-1.5">
              {scannedSessionList.map((item, idx) => (
                <div
                  key={`${item.consumer_number}-${idx}`}
                  className="bg-slate-800/90 border border-white/10 rounded-xl px-2.5 py-1 text-xs shrink-0 flex items-center gap-1.5"
                >
                  <Check className="w-3 h-3 text-emerald-400" />
                  <span className="font-mono font-bold text-amber-300">#{item.consumer_number}</span>
                  <span className="text-[11px] text-slate-300 max-w-[100px] truncate">{item.consumer_name}</span>
                </div>
              ))}
            </div>
          )}

          {/* Collapsible Failed Scans Sheet */}
          {showFailedList && failedScanList.length > 0 && (
            <div className="bg-rose-950/95 border border-rose-500/40 p-2 rounded-2xl max-h-28 overflow-y-auto flex flex-col gap-1">
              {failedScanList.map((item, idx) => (
                <div
                  key={`fail-${item.raw_number}-${idx}`}
                  className="bg-rose-900/60 border border-rose-500/30 rounded-xl px-2.5 py-1 flex items-start gap-2 text-xs"
                >
                  <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <span className="font-mono font-bold text-rose-200">#{item.raw_number}</span>
                    <p className="text-[10px] text-rose-300 leading-tight">{item.reason}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Manual Key-in & Finish Session Row */}
          <div className="flex items-center gap-2">
            <form onSubmit={handleManualAdd} className="flex-1 flex items-center gap-1.5">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                <input
                  ref={manualInputRef}
                  type="text"
                  value={manualInput}
                  onChange={(e) => setManualInput(e.target.value)}
                  placeholder="Or type Cons No (e.g. 1842)..."
                  className="w-full bg-slate-900/90 border border-white/20 rounded-xl pl-8 pr-2.5 py-2 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-amber-400 font-medium"
                />
              </div>
              <button
                type="submit"
                disabled={!manualInput.trim() || isProcessing}
                className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold px-3 py-2 rounded-xl text-xs flex items-center gap-1 transition-all active:scale-95 shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Add</span>
              </button>
            </form>

            <button
              type="button"
              onClick={onClose}
              className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold px-4 py-2 rounded-xl text-xs shadow-lg active:scale-95 transition-all shrink-0 whitespace-nowrap"
            >
              Done ({scannedSessionList.length})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LiveCameraScannerModal;
