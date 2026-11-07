import React, { useEffect, useRef, useState } from 'react';
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
  WifiOff
} from 'lucide-react';
import toast from 'react-hot-toast';
import { scanBillWithGemini, enhanceImageForOcr } from '../lib/gemini';
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
  claimedByOtherAgents?: Record<string, { agentName: string; date?: string; consumerName?: string; isPast7Days?: boolean; isSameAgent?: boolean }>;
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
    isSameAgent?: boolean;
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
  const [snapAttempts, setSnapAttempts] = useState<number>(0);
  const [showDoneWarning, setShowDoneWarning] = useState<boolean>(false);

  // Hard guard against double-taps / overlapping async scans (prevents duplicate
  // API calls, wrong counts and single-bill double reads).
  const isProcessingRef = useRef<boolean>(false);
  const prevOpenRef = useRef<boolean>(false);

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

  // Pending failed bill the operator is currently correcting via Edit Number.
  const editingFailedNumberRef = useRef<string | null>(null);

  // Keep the "already added" set in sync with the delivery list.
  // Rebuilding (instead of only adding) means a bill deleted from the list can
  // be scanned again, and switching delivery boy/day never blocks fresh bills.
  const existingNumbersKey = existingNumbers.join('|');
  useEffect(() => {
    const nums = existingNumbersKey ? existingNumbersKey.split('|') : [];
    scannedSetRef.current = new Set(nums.map((num) => num.toLowerCase()));
  }, [existingNumbersKey, agentId, agentName]);

  // Reset per-session counters + cooldowns every time the scanner is opened.
  useEffect(() => {
    if (isOpen && !prevOpenRef.current) {
      setScannedSessionList([]);
      setFailedScanList([]);
      setLastScanned(null);
      setAlreadyAddedNotice(null);
      setDuplicateScamNotice(null);
      setActiveScanFailAlert(null);
      setSnapAttempts(0);
      setShowDoneWarning(false);
      recentSeenCooldownRef.current.clear();
      editingFailedNumberRef.current = null;
    }
    if (!isOpen) {
      setShowDoneWarning(false);
      isProcessingRef.current = false;
    }
    prevOpenRef.current = isOpen;
  }, [isOpen]);

  // Switching delivery boy must never carry the previous boy's cooldowns.
  useEffect(() => {
    if (!isOpen) return;
    recentSeenCooldownRef.current.clear();
  }, [agentId, agentName, isOpen]);

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
        isSameAgent: otherClaimant.isSameAgent,
      });
      const [y, m, d] = (otherClaimant.date || '').split('-');
      const formattedDate = d && m && y ? `${d}-${m}-${y}` : otherClaimant.date;
      toast.error(
        `🚨 DOUBLE BILL ALERT! Bill #${cleanNum} (${finalName}) was ALREADY GIVEN by ${otherClaimant.agentName.toUpperCase()} on ${formattedDate}!`,
        { id: 'scam-alert', duration: 7000 }
      );
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

    // Remove from failedScanList if present (compare normalized digits)
    setFailedScanList((prev) =>
      prev.filter((item) => cleanAndNormalizeDigits(item.raw_number) !== cleanNum)
    );

    // Clear alert
    setActiveScanFailAlert(null);
  };

  const handleEditNumber = () => {
    if (activeScanFailAlert?.consumer_number) {
      // Remember which pending (failed) bill the operator is correcting, so a
      // successful manual add can retire the stale pending entry instead of
      // letting "Add All" add the mis-read number as an extra bill.
      editingFailedNumberRef.current = activeScanFailAlert.consumer_number;
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

  // Records a bill that could not be auto-added so it is never silently lost.
  // The operator gets a final "N bills not added" guard when closing the scanner.
  const recordFailedScan = (rawNumber: string, reason: string) => {
    setFailedScanList((prev) => {
      if (prev.some((item) => item.raw_number === rawNumber && item.reason === reason)) {
        return prev;
      }
      return [{ raw_number: rawNumber, reason, timestamp: Date.now() }, ...prev];
    });
  };

  // Process a candidate consumer number match.
  // Returns:
  //   'added'     → the bill was newly added to the delivery list
  //   'duplicate' → this exact consumer is already in the list (safe re-scan)
  //   'failed'    → could not verify / add (alert + failed-list recorded)
  const processMatchedConsumerNumber = async (
    rawNum: string,
    extractedName?: string,
    options: { silent?: boolean } = {}
  ): Promise<'added' | 'duplicate' | 'failed'> => {
    const silent = options.silent === true;
    const cleanNum = cleanAndNormalizeDigits(rawNum);

    if (!cleanNum || cleanNum.length < 1 || cleanNum.length > 12) {
      const reason =
        cleanNum && cleanNum.length > 12
          ? `Too many digits (${cleanNum.length}). Bharatgas numbers are 1-10 digits.`
          : 'Could not extract valid digits.';
      if (!silent) {
        playWarningAlarm();
        if (navigator.vibrate) navigator.vibrate([300, 100, 300]);
        setActiveScanFailAlert({
          type: 'TOO_LONG',
          consumer_number: cleanNum,
          consumer_name: extractedName,
          reason,
        });
        if (cleanNum) {
          recordFailedScan(
            cleanNum,
            cleanNum.length > 12 ? `Too long (${cleanNum.length} digits)` : 'Invalid digits'
          );
        }
      }
      return 'failed';
    }

    if (DISTRIBUTOR_BLACKLIST.has(cleanNum)) {
      if (!silent) {
        playWarningAlarm();
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
        setActiveScanFailAlert({
          type: 'BLACKLISTED',
          consumer_number: cleanNum,
          consumer_name: extractedName,
          reason: `Ignored distributor / telephone code #${cleanNum}. Aim camera at "Details of Receiver:".`,
        });
      }
      return 'failed';
    }

    // Match with local Dexie or remote Supabase, checking number, name, and 8/6/0 variants!
    const match = await matchConsumerWithDatabase(cleanNum, extractedName);

    // STRICT DATABASE VERIFICATION GUARD:
    // If consumer is not verified in the database, show prominent alert directly on screen!
    if (!match.found) {
      const isMismatch = match.name_verified === false && Boolean(match.consumer_name);
      const failReason = isMismatch
        ? `Receipt has "${extractedName || 'Unknown'}", but Agency Database has "${match.consumer_name}".`
        : `Consumer #${cleanNum} is NOT found in agency database.`;

      if (!silent) {
        playWarningAlarm();
        if (navigator.vibrate) navigator.vibrate([400, 150, 400]);

        // Trigger direct on-screen popup alert immediately
        setActiveScanFailAlert({
          type: isMismatch ? 'NAME_MISMATCH' : 'NOT_FOUND',
          consumer_number: cleanNum,
          consumer_name: extractedName || '',
          db_consumer_name: isMismatch ? match.consumer_name : undefined,
          reason: failReason,
        });

        setStatusText(`Bill #${cleanNum} not verified. Action required above.`);
        recordFailedScan(cleanNum, isMismatch ? 'Name mismatch' : 'Not found in database');
      }
      return 'failed';
    }

    const resolvedNum = match.consumer_number;
    const finalName = match.consumer_name;
    const finalAddress = match.address || 'Verified in Agency Database';
    const finalMobile = match.mobile || '';

    // Anti-spam cooldown (5 seconds for the same number). Skipped for internal
    // silent passes so they never suppress the final user-facing error.
    if (!silent) {
      const now = Date.now();
      const lastSeen =
        recentSeenCooldownRef.current.get(resolvedNum.toLowerCase()) ||
        recentSeenCooldownRef.current.get(cleanNum.toLowerCase());
      if (lastSeen && now - lastSeen < 5000) {
        return 'failed';
      }
      recentSeenCooldownRef.current.set(resolvedNum.toLowerCase(), now);
      recentSeenCooldownRef.current.set(cleanNum.toLowerCase(), now);
    }

    const resolvedAlready = scannedSetRef.current.has(resolvedNum.toLowerCase());
    const rawAlready = scannedSetRef.current.has(cleanNum.toLowerCase());
    const wasAutoCorrected = cleanNum.toLowerCase() !== resolvedNum.toLowerCase();

    if (resolvedAlready || rawAlready) {
      if (wasAutoCorrected && resolvedAlready) {
        // A NEW physical bill was auto-corrected onto a number that is already
        // in the list. That usually means an OCR digit error collided with a
        // different bill — flag it instead of silently dropping it.
        if (!silent) {
          playWarningAlarm();
          setActiveScanFailAlert({
            type: 'NOT_FOUND',
            consumer_number: cleanNum,
            consumer_name: extractedName,
            reason: `OCR auto-corrected this receipt to #${resolvedNum}, which is already in the list. The printed number may be #${cleanNum}. Verify the bill and Force Add if it is different.`,
          });
          recordFailedScan(cleanNum, `Auto-corrected onto already added #${resolvedNum}`);
          setStatusText(`Possible missed bill #${cleanNum}. Verify above.`);
        }
        return 'failed';
      }

      if (!silent) {
        setAlreadyAddedNotice(`Consumer #${resolvedNum} is already in delivery list!`);
        setTimeout(() => setAlreadyAddedNotice(null), 2500);
      }
      return 'duplicate';
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
        isSameAgent: otherClaimant.isSameAgent,
      });

      const [y, m, d] = (otherClaimant.date || '').split('-');
      const formattedDate = d && m && y ? `${d}-${m}-${y}` : otherClaimant.date;

      toast.error(
        `🚨 DOUBLE BILL ALERT! Bill #${resolvedNum} (${finalName}) was ALREADY GIVEN by ${otherClaimant.agentName.toUpperCase()} on ${formattedDate}!`,
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

    return 'added';
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

  /**
   * Runs one complete OCR → database-verification cycle for an image.
   *
   * Accuracy/cost strategy:
   *   1. Cheapest Flash-Lite model reads the bill.
   *   2. If the number is valid but cannot be verified, ONE high-contrast
   *      grayscale re-read is attempted (faint dot-matrix digits recover here).
   *   3. If it still fails, the actionable popup is shown and the bill is
   *      recorded so it cannot be silently lost when the scanner is closed.
   */
  const runScanPipeline = async (imageInput: File | Blob | string, label: string) => {
    if (isProcessingRef.current) return;

    if (!navigator.onLine) {
      toast.error('Offline: AI Snap requires internet. Type Cons No below.', { id: 'scan-snap' });
      return;
    }

    isProcessingRef.current = true;
    setActiveScanFailAlert(null);
    setIsProcessing(true);
    setIsShutterFlash(true);
    setSnapAttempts((n) => n + 1);
    setTimeout(() => setIsShutterFlash(false), 200);
    toast.loading(`Gemini AI reading ${label}...`, { id: 'scan-snap' });

    try {
      setStatusText('Gemini AI reading Cons No & Name...');
      const first = await scanBillWithGemini(imageInput);

      if (first.error) {
        playWarningAlarm();
        setActiveScanFailAlert({
          type: 'NOT_DETECTED',
          reason: `AI Notice: ${first.error}`,
        });
        toast.error(`AI Notice: ${first.error}`, { id: 'scan-snap' });
        setStatusText('Hold bill steady and tap Snap...');
        return;
      }

      if (first.found && first.consumerNumber) {
        // Silent pass: don't show the failure popup until the enhanced re-read
        // has also had a chance to recover the number.
        const firstOutcome = await processMatchedConsumerNumber(
          first.consumerNumber,
          first.consumerName,
          { silent: true }
        );
        if (firstOutcome === 'added') {
          toast.success('Matched successfully!', { id: 'scan-snap' });
          setStatusText(`Matched #${first.consumerNumber}! Ready for next bill`);
          return;
        }
        if (firstOutcome === 'duplicate') {
          toast(`#${first.consumerNumber} is already in the list`, { id: 'scan-snap', icon: '⚠️' });
          setStatusText(`#${first.consumerNumber} already added — ready for next bill`);
          return;
        }

        // Not verified — try ONE high-contrast re-read of the same frame.
        let reportNumber = first.consumerNumber;
        let reportName = first.consumerName;
        setStatusText('Re-reading faint print (enhanced)...');
        toast.loading('Re-reading faint print...', { id: 'scan-snap' });
        const enhanced = await enhanceImageForOcr(imageInput);
        if (enhanced) {
          const retry = await scanBillWithGemini(enhanced);
          if (retry.found && retry.consumerNumber) {
            const retryOutcome = await processMatchedConsumerNumber(
              retry.consumerNumber,
              retry.consumerName,
              { silent: true }
            );
            if (retryOutcome === 'added') {
              toast.success(
                `✨ Recovered: #${retry.consumerNumber} (${retry.consumerName})`,
                { id: 'scan-snap' }
              );
              setStatusText(`Recovered #${retry.consumerNumber}! Ready for next bill`);
              return;
            }
            if (retryOutcome === 'duplicate') {
              toast(`#${retry.consumerNumber} is already in the list`, { id: 'scan-snap', icon: '⚠️' });
              setStatusText(`#${retry.consumerNumber} already added — ready for next bill`);
              return;
            }
            // Surface the enhanced reading (usually the more reliable one).
            reportNumber = retry.consumerNumber;
            reportName = retry.consumerName;
          }
        }

        // Still unverified → now show the actionable popup / record the bill.
        await processMatchedConsumerNumber(reportNumber, reportName);
        return;
      }

      // No number detected on the first pass — try one enhanced re-read before
      // asking the operator to retry.
      setStatusText('Re-reading faint print (enhanced)...');
      toast.loading('Re-reading faint print...', { id: 'scan-snap' });
      const enhanced = await enhanceImageForOcr(imageInput);
      if (enhanced) {
        const retry = await scanBillWithGemini(enhanced);
        if (retry.found && retry.consumerNumber) {
          const recovered = await processMatchedConsumerNumber(
            retry.consumerNumber,
            retry.consumerName
          );
          if (recovered === 'added') {
            toast.success(
              `✨ Recovered: #${retry.consumerNumber} (${retry.consumerName})`,
              { id: 'scan-snap' }
            );
            setStatusText(`Recovered #${retry.consumerNumber}! Ready for next bill`);
          } else if (recovered === 'duplicate') {
            toast(`#${retry.consumerNumber} is already in the list`, { id: 'scan-snap', icon: '⚠️' });
            setStatusText(`#${retry.consumerNumber} already added — ready for next bill`);
          }
          // 'added'/'duplicate' are resolved; 'failed' already showed its popup.
          return;
        }
      }

      playWarningAlarm();
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
      setActiveScanFailAlert({
        type: 'NOT_DETECTED',
        reason: 'Cons No: not detected. Make sure "Details of Receiver:" is in view & in focus.',
      });
      recordFailedScan('', 'Cons No not detected');
      setStatusText('Cons No not detected. Tap Retry or type number.');
      toast.error('Cons No: not detected. Make sure "Details of Receiver:" is in view & in focus.', {
        id: 'scan-snap',
        duration: 3500,
      });
    } catch (err: any) {
      console.warn('Scan cycle error:', err);
      toast.error(`Scan error: ${err.message || 'Check connection'}`, { id: 'scan-snap' });
    } finally {
      isProcessingRef.current = false;
      setIsProcessing(false);
    }
  };

  // Main Scan Trigger (Exclusively Gemini AI Vision - 1-Tap Snap)
  const performScan = async () => {
    if (isProcessingRef.current || !videoRef.current) return;

    if (!navigator.onLine) {
      toast.error('Offline: AI Snap requires internet. Type Cons No below.', { id: 'scan-snap' });
      return;
    }

    const imgDataUrl = captureCameraFrame();
    if (!imgDataUrl) return;

    await runScanPipeline(imgDataUrl, 'cash memo');
  };

  // Direct Photo Capture / Gallery Upload Handler
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      await runScanPipeline(file, 'photo');
    } finally {
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

    const outcome = await processMatchedConsumerNumber(cleanNum);
    if (outcome !== 'failed') {
      // The bill is now in the list — retire its pending (failed) entry so the
      // Done guard and "Add All" do not add a second, mis-read copy of it.
      const editedNumber = editingFailedNumberRef.current;
      const editedDigits = editedNumber ? cleanAndNormalizeDigits(editedNumber) : '';
      setFailedScanList((prev) =>
        prev.filter((item) => {
          const digits = cleanAndNormalizeDigits(item.raw_number);
          return digits !== cleanNum && digits !== editedDigits;
        })
      );
      editingFailedNumberRef.current = null;
      setManualInput('');
      if (outcome === 'duplicate') {
        toast(`#${cleanNum} is already in the list`, { icon: '⚠️' });
      }
    } else {
      toast.error(`Could not add Consumer #${cleanNum}`);
    }
    setIsProcessing(false);
  };

  /**
   * Failed scans that still carry a usable number. These are bills the operator
   * physically scanned but which could not be matched to the agency database.
   * They must be explicitly resolved before the scanner closes — otherwise the
   * "50 scanned but only 45 added" data loss happens.
   */
  // Deduplicate by normalized digits: the same physical bill can fail more than
  // once with different reasons, and "Add All" must never add it twice.
  const pendingBills = (() => {
    const seen = new Set<string>();
    return failedScanList.filter((item) => {
      const digits = cleanAndNormalizeDigits(item.raw_number);
      if (
        digits.length < 1 ||
        digits.length > 12 ||
        DISTRIBUTOR_BLACKLIST.has(digits) ||
        seen.has(digits)
      ) {
        return false;
      }
      seen.add(digits);
      return true;
    });
  })();

  const handleForceAddAllPending = () => {
    const items = [...pendingBills];
    if (items.length === 0) {
      setShowDoneWarning(false);
      onClose();
      return;
    }

    const batch = items
      .map((item) => {
        const cleanNum = cleanAndNormalizeDigits(item.raw_number);
        return { item, cleanNum };
      })
      .filter(
        ({ cleanNum }) =>
          Boolean(cleanNum) && !scannedSetRef.current.has(cleanNum.toLowerCase())
      );

    batch.forEach(({ cleanNum }) => {
      const otherClaimant = claimedByOtherAgents[cleanNum.toLowerCase()];
      const finalName = `Customer #${cleanNum}`;

      scannedSetRef.current.add(cleanNum.toLowerCase());
      setScannedSessionList((prev) => [
        { consumer_number: cleanNum, consumer_name: finalName, timestamp: Date.now() },
        ...prev,
      ]);
      onConsumerScanned({
        consumer_number: cleanNum,
        consumer_name: finalName,
        address: 'Directly Verified / Physical Bill',
        mobile: '',
        found: true,
        duplicate_of_agent: otherClaimant ? otherClaimant.agentName : undefined,
        duplicate_claimed_date: otherClaimant ? otherClaimant.date : undefined,
      });
    });

    setFailedScanList([]);
    setShowDoneWarning(false);
    toast.success(`Added ${batch.length} pending bill(s) ✓`, { id: 'scan-snap' });
    setStatusText(`Added ${batch.length} pending bill(s). Done!`);
    onClose();
  };

  const handleDone = () => {
    if (pendingBills.length > 0) {
      setShowDoneWarning(true);
      return;
    }
    onClose();
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
              onClick={handleDone}
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
                  {duplicateScamNotice.date && (
                    <span className="ml-1 text-white font-semibold">
                      on {(() => {
                        const [y, m, d] = duplicateScamNotice.date.split('-');
                        return d && m && y ? `${d}-${m}-${y}` : duplicateScamNotice.date;
                      })()}
                    </span>
                  )}
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
          {(scannedSessionList.length > 0 || failedScanList.length > 0 || snapAttempts > 0) && (
            <div className="flex items-center justify-between text-[11px] bg-slate-900/80 border border-white/10 px-3 py-1.5 rounded-xl">
              <div className="flex items-center gap-2">
                <span className="text-slate-400 font-semibold" title="Bills captured this session">
                  {snapAttempts} scanned
                </span>
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
              onClick={handleDone}
              className={`font-bold px-4 py-2 rounded-xl text-xs shadow-lg active:scale-95 transition-all shrink-0 whitespace-nowrap ${
                pendingBills.length > 0
                  ? 'bg-gradient-to-r from-amber-500 to-orange-600 text-slate-950 animate-pulse'
                  : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white'
              }`}
            >
              Done ({scannedSessionList.length})
              {pendingBills.length > 0 ? ` · ${pendingBills.length} pending` : ''}
            </button>
          </div>
        </div>
      </div>

      {/* 5. "BILLS NOT ADDED" GUARD — prevents silent data loss */}
      {showDoneWarning && (
        <div className="fixed inset-0 z-[60] bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in zoom-in-95 duration-150">
          <div className="bg-gradient-to-b from-slate-900 via-amber-950/40 to-slate-900 border-2 border-amber-500 rounded-3xl p-4 w-full max-w-sm text-white shadow-[0_0_60px_rgba(245,158,11,0.35)] flex flex-col gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-400/40 flex items-center justify-center shrink-0">
                <AlertCircle className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <h3 className="text-sm font-black text-amber-300">⚠️ Bills Not Added Yet</h3>
                <p className="text-[11px] text-slate-300">
                  You scanned {snapAttempts} bill{snapAttempts === 1 ? '' : 's'}, added {scannedSessionList.length}.
                </p>
              </div>
            </div>

            <div className="bg-slate-950/80 rounded-2xl p-3 border border-amber-500/30 text-xs text-amber-100 leading-relaxed">
              <b>{pendingBills.length}</b> scanned bill{pendingBills.length === 1 ? '' : 's'} could not be
              auto-verified in the agency database. Add them now so no cash memo is missed.
              {pendingBills.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {pendingBills.slice(0, 12).map((item, idx) => (
                    <span
                      key={`${item.raw_number}-${idx}`}
                      className="font-mono text-[11px] bg-amber-500/15 border border-amber-400/30 text-amber-200 px-1.5 py-0.5 rounded-md"
                    >
                      #{item.raw_number || '???'}
                    </span>
                  ))}
                  {pendingBills.length > 12 && (
                    <span className="text-[11px] text-amber-300">+{pendingBills.length - 12} more</span>
                  )}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={handleForceAddAllPending}
              className="w-full bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 hover:from-emerald-500 hover:to-teal-500 text-white font-black py-3 px-3 rounded-2xl shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2 text-xs uppercase tracking-wide border border-emerald-400/50"
            >
              <Check className="w-4 h-4" />
              Add All {pendingBills.length} Bill{pendingBills.length === 1 ? '' : 's'}
            </button>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowDoneWarning(false);
                  setShowFailedList(true);
                  setShowSessionList(false);
                }}
                className="flex-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black py-2.5 px-2 rounded-xl text-xs flex items-center justify-center gap-1 active:scale-95 transition-all"
              >
                <Search className="w-3.5 h-3.5" />
                Review
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowDoneWarning(false);
                  onClose();
                }}
                className="flex-1 bg-slate-800 hover:bg-slate-700 border border-white/20 text-slate-300 font-semibold py-2.5 px-2 rounded-xl text-xs active:scale-95 transition-all"
              >
                Close Anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LiveCameraScannerModal;
