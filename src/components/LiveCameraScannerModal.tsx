import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
import { matchConsumerWithDatabase, areNamesSimilar, findConsumersByAmbiguousVariants } from '../lib/consumerMatcher';
import { DISTRIBUTOR_BLACKLIST, normalizeDigits, numberKey, isAddableConsumerNumber } from '../lib/scanUtils';

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
  /** Number verified, but the printed name does not resemble the DB name. */
  name_mismatch?: boolean;
  /**
   * Full payload for this bill. Re-sent to the parent right before the scanner
   * closes if a background list reload dropped it, so the final list can never
   * contain fewer bills than the "N Added" counter.
   */
  payload?: {
    consumer_id?: string;
    address?: string;
    mobile?: string;
    duplicate_of_agent?: string;
    duplicate_claimed_date?: string;
  };
}

interface FailedScanItem {
  /** Unique per physical capture: unread bills must never collapse into one row. */
  id: string;
  raw_number: string;
  reason: string;
  timestamp: number;
}

export interface ActiveScanFailAlert {
  type: 'NOT_FOUND' | 'TOO_LONG' | 'BLACKLISTED' | 'NOT_DETECTED';
  consumer_number?: string;
  consumer_name?: string;
  /**
   * A database consumer that differs from the printed number only at
   * dot-matrix ambiguous 8/6/0 positions. Offered for confirmation only —
   * never added automatically.
   */
  suggested_match?: {
    consumer_id?: string;
    consumer_number: string;
    consumer_name: string;
    address?: string;
    mobile?: string;
  };
  reason: string;
}

// One shared AudioContext: creating a new one per beep leaks contexts (Chrome
// allows only a handful) and the double-bill fraud alarm goes silent after a
// few scans. Nodes are still created per beep, only the context is reused.
let sharedAudioCtx: AudioContext | null = null;

function getSharedAudioContext(): AudioContext | null {
  try {
    if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return null;
      sharedAudioCtx = new AudioCtx();
    }
    if (sharedAudioCtx.state === 'suspended') {
      void sharedAudioCtx.resume().catch(() => {});
    }
    return sharedAudioCtx;
  } catch (_) {
    return null;
  }
}

function playSuccessBeep() {
  const ctx = getSharedAudioContext();
  if (!ctx) return;
  try {
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
  const ctx = getSharedAudioContext();
  if (!ctx) return;
  try {
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
  // Small viewfinder rectangle + the dashed guide inside it. Only the guide
  // area is cropped and sent to Gemini, which keeps image tokens (cost) low.
  const previewFrameRef = useRef<HTMLDivElement | null>(null);
  const guideBoxRef = useRef<HTMLDivElement | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isVideoReady, setIsVideoReady] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<boolean>(false);
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [alreadyAddedNotice, setAlreadyAddedNotice] = useState<string | null>(null);
  const [nameMismatchNotice, setNameMismatchNotice] = useState<{
    consumer_number: string;
    receipt_name: string;
    db_name: string;
  } | null>(null);
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
  const [activeScanFailAlert, setActiveScanFailAlert] = useState<ActiveScanFailAlert | null>(null);
  const manualInputRef = useRef<HTMLInputElement | null>(null);
  const [statusText, setStatusText] = useState<string>('Align "Details of Receiver:" in view');
  const [manualInput, setManualInput] = useState<string>('');
  const [isSuccessFlash, setIsSuccessFlash] = useState<boolean>(false);
  const [isShutterFlash, setIsShutterFlash] = useState<boolean>(false);
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [snapAttempts, setSnapAttempts] = useState<number>(0);
  // Bills that resolved as "already in the delivery list" this session. Tracked
  // separately so "N snaps vs M added" can be reconciled instead of looking
  // like lost bills.
  const [duplicateCount, setDuplicateCount] = useState<number>(0);
  const [showDoneWarning, setShowDoneWarning] = useState<boolean>(false);

  // Hard guard against double-taps / overlapping async scans (prevents duplicate
  // API calls, wrong counts and single-bill double reads).
  const isProcessingRef = useRef<boolean>(false);
  const prevOpenRef = useRef<boolean>(false);

  // The live MediaStream lives in a ref, not state: cleanup must always stop the
  // tracks that are actually running, even when the component unmounts or React
  // StrictMode re-runs the start effect while getUserMedia is still pending.
  const streamRef = useRef<MediaStream | null>(null);
  const cameraRequestRef = useRef<number>(0);
  const failedScanIdRef = useRef<number>(0);
  const pendingUnreadRetakeRef = useRef<string[]>([]);

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

  // Set of all added consumer numbers to prevent re-adding.
  // Keys are normalized the same way scanned numbers are (leading zeros, OCR
  // letter/digit swaps), otherwise "0117231569" and "117231569" count as two
  // different bills and the same memo gets added twice.
  const scannedSetRef = useRef<Set<string>>(
    new Set(existingNumbers.map((n) => numberKey(n)))
  );
  
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
    scannedSetRef.current = new Set(
      nums.map((num) => numberKey(num))
    );
  }, [existingNumbersKey, agentId, agentName]);

  // Add a bill to the session counter at most once. The counter drives both the
  // "N Added" badge and the Done button, so a repeated add of the same memo must
  // never inflate it above the number of unique bills in the delivery list.
  const pushSessionAdded = (
    consumerNumber: string,
    consumerName: string,
    nameMismatch: boolean = false,
    payload?: ScannedSessionItem['payload']
  ) => {
    const key = numberKey(consumerNumber);
    setScannedSessionList((prev) =>
      prev.some((item) => numberKey(item.consumer_number) === key)
        ? prev
        : [
            {
              consumer_number: consumerNumber,
              consumer_name: consumerName,
              timestamp: Date.now(),
              name_mismatch: nameMismatch,
              payload,
            },
            ...prev,
          ]
    );
  };

  // Reset per-session counters + cooldowns every time the scanner is opened.
  useEffect(() => {
    if (isOpen && !prevOpenRef.current) {
      setScannedSessionList([]);
      setFailedScanList([]);
      setLastScanned(null);
      setAlreadyAddedNotice(null);
      setNameMismatchNotice(null);
      setDuplicateScamNotice(null);
      setActiveScanFailAlert(null);
      setSnapAttempts(0);
      setDuplicateCount(0);
      setShowDoneWarning(false);
      recentSeenCooldownRef.current.clear();
      pendingUnreadRetakeRef.current = [];
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

  // Start the camera while the modal is open. The cleanup invalidates any
  // in-flight getUserMedia request and stops the *real* tracks via a ref, so a
  // late permission result can never leave the camera running after close.
  useEffect(() => {
    if (!isOpen) return;

    void startCamera();

    return () => {
      cameraRequestRef.current += 1;
      stopCamera();
    };
    // startCamera/stopCamera only touch refs and state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const releaseStreamTracks = () => {
    const active = streamRef.current;
    if (active) {
      active.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  const startCamera = async () => {
    const requestId = ++cameraRequestRef.current;
    setIsVideoReady(false);
    setCameraError(false);
    setTorchOn(false);
    // A previous stream can still be alive on StrictMode remount / fast re-open.
    releaseStreamTracks();

    try {
      setStatusText('Connecting to HD camera...');

      // Request the sharpest stream the phone can give us; the crop below is
      // what actually goes to Gemini. `ideal` lets weak devices fall back.
      const constraints: any = {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 2560 },
          height: { ideal: 1440 },
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

      // Modal closed (or a newer request started) while permission was pending.
      if (requestId !== cameraRequestRef.current) {
        mediaStream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = mediaStream;
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        try {
          await videoRef.current.play();
        } catch (playErr) {
          // iOS can defer autoplay until metadata is ready; the video's
          // onPlaying handler below still marks the preview ready.
          console.warn('Camera preview play() deferred:', playErr);
        }
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

      if (requestId !== cameraRequestRef.current) return;
      setStatusText('Gemini AI Vision Active — Hold bill steady');
    } catch (err) {
      if (requestId !== cameraRequestRef.current) return;
      console.error('Camera access error:', err);
      setStatusText('Camera unavailable or permission denied');
      setIsVideoReady(false);
      setCameraError(true);
    }
  };

  const stopCamera = () => {
    releaseStreamTracks();
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsVideoReady(false);
    setTorchOn(false);
  };

  // Toggle flashlight/torch
  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
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
    const track = streamRef.current?.getVideoTracks()[0];
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
    const cleanNum = normalizeDigits(targetNum);
    if (!isAddableConsumerNumber(cleanNum)) {
      toast.error('Invalid Consumer Number');
      return;
    }
    const numKey = numberKey(cleanNum);
    const finalName = (overrideName || activeScanFailAlert?.consumer_name || '').trim() || `Customer #${cleanNum}`;

    // Force Add must obey the same duplicate guard as a verified scan: the
    // operator can hit it more than once for the same bill, and each tap used
    // to add a second copy + inflate the "N Added" counter.
    if (scannedSetRef.current.has(numKey)) {
      setAlreadyAddedNotice(`Consumer #${cleanNum} is already in delivery list!`);
      setTimeout(() => setAlreadyAddedNotice(null), 2500);
      setActiveScanFailAlert(null);
      setStatusText(`#${cleanNum} already added — ready for next bill`);
      return;
    }

    // Mark as added in local scanned set
    scannedSetRef.current.add(numKey);

    // Check for double bill scam
    const otherClaimant = claimedByOtherAgents[numKey];
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

    setNameMismatchNotice(null);
    setLastScanned(`${cleanNum} - ${finalName}`);
    pushSessionAdded(cleanNum, finalName, false, {
      address: 'Directly Verified / Physical Bill',
      mobile: '',
      duplicate_of_agent: otherClaimant ? otherClaimant.agentName : undefined,
      duplicate_claimed_date: otherClaimant ? otherClaimant.date : undefined,
    });

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
      prev.filter((item) => normalizeDigits(item.raw_number) !== cleanNum)
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

  const handleEditFailedItem = (rawNumber: string) => {
    editingFailedNumberRef.current = rawNumber;
    setManualInput(rawNumber);
    setTimeout(() => {
      manualInputRef.current?.focus();
      manualInputRef.current?.select();
    }, 100);
  };

  // The operator confirmed that a scanned number is the database record which
  // differs only in faint 8/6/0 digits. Add exactly that record through the
  // normal verified-add path (duplicate + double-bill guards included).
  const handleAcceptSuggestedMatch = async () => {
    const suggestion = activeScanFailAlert?.suggested_match;
    const printedNumber = activeScanFailAlert?.consumer_number;
    if (!suggestion) return;

    setActiveScanFailAlert(null);
    const outcome = await processMatchedConsumerNumber(
      suggestion.consumer_number,
      suggestion.consumer_name
    );

    if (outcome !== 'failed' && printedNumber) {
      // The printed (misread) number was recorded as pending; it is now resolved.
      setFailedScanList((prev) =>
        prev.filter((item) => numberKey(item.raw_number) !== numberKey(printedNumber))
      );

      if (outcome === 'added') {
        setStatusText(
          `Added #${suggestion.consumer_number} (corrected 8/6/0) — ready for next bill`
        );
        toast.success(
          `✨ Added #${suggestion.consumer_number} — corrected faint 8/6/0 from #${printedNumber}`,
          { id: 'scan-snap', duration: 5000 }
        );
      } else {
        setStatusText(`#${suggestion.consumer_number} already added — ready for next bill`);
      }
    }
  };

  // A retake replaces one "unread" capture (a bill where no number could be
  // read). The row is only retired once a capture actually starts, so a retake
  // that never happens can never silently clear a not-added bill.
  const queueUnreadRetake = (id?: string) => {
    const targetId =
      id ||
      failedScanList.find((item) => !numberKey(item.raw_number))?.id ||
      '';
    if (targetId) pendingUnreadRetakeRef.current.push(targetId);
  };

  const consumeQueuedUnreadRetake = () => {
    const id = pendingUnreadRetakeRef.current.shift();
    if (!id) return;
    setFailedScanList((prev) => prev.filter((item) => item.id !== id));
  };

  const handleRetrySnap = () => {
    // A retake only replaces an "unread" capture. Retrying a bill that DID have
    // a number must not consume an unrelated unread row.
    const alertHadNumber = Boolean(activeScanFailAlert?.consumer_number);
    setActiveScanFailAlert(null);
    if (!alertHadNumber) queueUnreadRetake();
    setTimeout(() => {
      performScan();
    }, 150);
  };

  // Records a bill that could not be auto-added so it is never silently lost.
  // The operator gets a final "N bills not added" guard when closing the scanner.
  const recordFailedScan = (rawNumber: string, reason: string) => {
    const digits = numberKey(rawNumber);
    // Generate the id once, outside the updater: React may invoke updaters more
    // than once (StrictMode), and side effects inside them are unreliable.
    const id = `fail-${Date.now()}-${failedScanIdRef.current++}`;
    setFailedScanList((prev) => {
      // The same numbered bill retried with a different reason stays one row.
      if (digits && prev.some((item) => numberKey(item.raw_number) === digits)) {
        return prev;
      }
      // A capture with no readable number is its own physical bill: never
      // dedupe those, otherwise many unread bills collapse into one "???" and
      // disappear from the Done guard.
      return [
        {
          id,
          raw_number: digits,
          reason,
          timestamp: Date.now(),
        },
        ...prev,
      ];
    });
  };

  const handleRemoveFailedScan = (id: string) => {
    setFailedScanList((prev) => prev.filter((item) => item.id !== id));
  };

  const handleRescanUnread = (id: string) => {
    queueUnreadRetake(id);
    setShowDoneWarning(false);
    setTimeout(() => {
      void performScan();
    }, 250);
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
    const cleanNum = normalizeDigits(rawNum);

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

    // Exact-number lookup: the printed number is the only key used to select a
    // consumer. A number that is not in the database is never swapped for a
    // look-alike (8/6/0 variants, one-digit neighbours).
    // Pass the raw OCR string so a leading-zero spelling is tried too.
    const match = await matchConsumerWithDatabase(rawNum, extractedName);

    // STRICT DATABASE VERIFICATION GUARD:
    // If consumer is not verified in the database, show prominent alert directly on screen!
    if (!match.found) {
      if (!silent) {
        // Before declaring "not found", look for the one printer defect we can
        // reason about safely: faint dot-matrix 8/6/0 digits. Only a single
        // candidate whose name matches the printed name is offered, and the
        // operator must confirm it — the scanner never auto-adds it.
        let suggestedMatch: ActiveScanFailAlert['suggested_match'];
        if (isAddableConsumerNumber(cleanNum) && extractedName) {
          const variants = await findConsumersByAmbiguousVariants(rawNum);
          const named = variants.filter((candidate) =>
            areNamesSimilar(extractedName, candidate.consumer_name)
          );
          if (named.length === 1) {
            suggestedMatch = named[0];
          }
        }

        playWarningAlarm();
        if (navigator.vibrate) navigator.vibrate([400, 150, 400]);

        // Trigger direct on-screen popup alert immediately
        setActiveScanFailAlert({
          type: 'NOT_FOUND',
          consumer_number: cleanNum,
          consumer_name: extractedName || '',
          suggested_match: suggestedMatch,
          reason: suggestedMatch
            ? `#${cleanNum} is not in the data, but it differs from #${suggestedMatch.consumer_number} only in 8/6/0 digits and the name matches. Confirm the database number below.`
            : `Consumer number #${cleanNum} not found in data.`,
        });

        setStatusText(`Bill #${cleanNum} not verified. Action required above.`);
        recordFailedScan(cleanNum, 'Not found in database');
      }
      return 'failed';
    }

    const resolvedNum = match.consumer_number;
    const finalName = match.consumer_name;
    const finalAddress = match.address || 'Verified in Agency Database';
    const finalMobile = match.mobile || '';

    // ADVISORY NAME CHECK (never used to select a consumer):
    // The number decides which database record is added. If the printed name
    // shares nothing with that record, flag it so a misread number that happens
    // to be valid cannot slip in silently — the operator still sees the bill.
    const nameMismatch =
      Boolean(extractedName) && Boolean(finalName) && !areNamesSimilar(extractedName as string, finalName);

    // Anti-spam cooldown (5 seconds for the same number). Skipped for internal
    // silent passes so they never suppress the final user-facing error.
    if (!silent) {
      const now = Date.now();
      const lastSeen =
        recentSeenCooldownRef.current.get(numberKey(resolvedNum)) ||
        recentSeenCooldownRef.current.get(numberKey(cleanNum));
      if (lastSeen && now - lastSeen < 5000) {
        // Same bill snapped again moments later: treat it as an already-handled
        // duplicate (not a lost bill) so the session counters stay honest.
        return 'duplicate';
      }
      recentSeenCooldownRef.current.set(numberKey(resolvedNum), now);
      recentSeenCooldownRef.current.set(numberKey(cleanNum), now);
    }

    const resolvedKey = numberKey(resolvedNum);
    const rawKey = numberKey(cleanNum);

    if (scannedSetRef.current.has(resolvedKey) || scannedSetRef.current.has(rawKey)) {
      if (!silent) {
        setAlreadyAddedNotice(`Consumer #${resolvedNum} is already in delivery list!`);
        setTimeout(() => setAlreadyAddedNotice(null), 2500);
        setStatusText(`#${resolvedNum} already added — ready for next bill`);
      }
      return 'duplicate';
    }

    // INSTANT ADDITION TO UI FOR VERIFIED CONSUMER
    scannedSetRef.current.add(resolvedKey);
    scannedSetRef.current.add(rawKey);
    setAlreadyAddedNotice(null);
    setNameMismatchNotice(
      nameMismatch
        ? { consumer_number: resolvedNum, receipt_name: extractedName as string, db_name: finalName }
        : null
    );
    // Retire any earlier failed row for this bill (e.g. DB was unreachable on
    // the first attempt, then a retry verified it). Without this the pending
    // row survives and blocks Done while the bill is already added.
    setFailedScanList((prev) =>
      prev.filter((item) => {
        const itemKey = numberKey(item.raw_number);
        return itemKey !== resolvedKey && itemKey !== rawKey;
      })
    );

    // ANTI-FRAUD / DOUBLE-BILL SCAM GUARD:
    // Check if this cash memo was ALREADY submitted by another delivery boy!
    const otherClaimant =
      claimedByOtherAgents[resolvedKey] ||
      claimedByOtherAgents[rawKey];

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
    pushSessionAdded(resolvedNum, finalName, nameMismatch, {
      consumer_id: match.consumer_id,
      address: finalAddress,
      mobile: finalMobile,
      duplicate_of_agent: otherClaimant ? otherClaimant.agentName : undefined,
      duplicate_claimed_date: otherClaimant ? otherClaimant.date : undefined,
    });

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

    if (nameMismatch) {
      setStatusText(`Added #${resolvedNum} — printed name differs, verify bill`);
      toast(
        `⚠ Added #${resolvedNum} (${finalName}), but the receipt name reads "${extractedName}". Verify this bill.`,
        { id: 'scan-snap', icon: '⚠️', duration: 6500 }
      );
    } else {
      toast.success(`✨ Verified: #${resolvedNum} (${finalName})`, { id: 'scan-snap' });
    }

    return 'added';
  };

  /**
   * Capture ONLY the small guide rectangle (Cons No + Name line), not the full
   * camera frame.
   *
   * Why: Gemini charges image tokens by pixel area, and a full-page photo also
   * gives the model dates, amounts and telephone numbers to get confused by.
   * A tight crop of the receiver line is both far cheaper and more accurate.
   *
   * The mapping mirrors CSS `object-cover`: the video is scaled to cover the
   * preview box, so the visible guide rectangle maps back to a source-pixel
   * crop inside the camera frame.
   */
  const captureCameraFrame = (): string | null => {
    if (!videoRef.current || !canvasRef.current) return null;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx || video.videoWidth === 0 || video.videoHeight === 0) return null;

    const vw = video.videoWidth;
    const vh = video.videoHeight;

    // Fallback = centre strip of the frame if the guide box can't be measured.
    let sx = 0;
    let sy = vh * 0.35;
    let sw = vw;
    let sh = vh * 0.3;

    const frame = previewFrameRef.current;
    const guide = guideBoxRef.current;
    if (frame && guide) {
      const f = frame.getBoundingClientRect();
      const g = guide.getBoundingClientRect();
      if (f.width > 0 && f.height > 0 && g.width > 0 && g.height > 0) {
        const scale = Math.max(f.width / vw, f.height / vh);
        const offX = (vw * scale - f.width) / 2;
        const offY = (vh * scale - f.height) / 2;

        // Small margin so ascenders/descenders of the dot-matrix line aren't clipped.
        const padX = g.width * 0.03;
        const padY = g.height * 0.18;

        sx = (g.left - f.left + offX - padX) / scale;
        sy = (g.top - f.top + offY - padY) / scale;
        sw = (g.width + padX * 2) / scale;
        sh = (g.height + padY * 2) / scale;

        sx = Math.max(0, Math.min(sx, vw - 1));
        sy = Math.max(0, Math.min(sy, vh - 1));
        sw = Math.max(32, Math.min(sw, vw - sx));
        sh = Math.max(24, Math.min(sh, vh - sy));
      }
    }

    // Keep enough pixels for faint dot-matrix print. 1280 wide keeps the broken
    // 8/6/0 pin dots readable; the crop is still a tiny image for Gemini.
    const maxDim = 1280;
    let targetW = sw;
    let targetH = sh;
    if (targetW > maxDim || targetH > maxDim) {
      if (targetW / maxDim > targetH / maxDim) {
        targetH = Math.round((targetH * maxDim) / targetW);
        targetW = maxDim;
      } else {
        targetW = Math.round((targetW * maxDim) / targetH);
        targetH = maxDim;
      }
    }

    canvas.width = Math.max(32, Math.round(targetW));
    canvas.height = Math.max(24, Math.round(targetH));
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

    return canvas.toDataURL('image/jpeg', 0.92);
  };

  /**
   * Runs one complete OCR → database-verification cycle for an image.
   *
   * Accuracy/cost strategy:
   *   1. Cheapest Flash-Lite model reads the bill.
   *   2. If NO number is detected, ONE high-contrast grayscale re-read is
   *      attempted (faint dot-matrix digits recover here). A number that was
   *      read but is not in the database is never re-read or substituted.
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
    // This capture is a real retake: retire the queued unread row now.
    consumeQueuedUnreadRetake();
    setActiveScanFailAlert(null);
    setNameMismatchNotice(null);
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
          reason: `AI could not read this bill: ${first.error}. The bill was NOT added — rescan it.`,
        });
        toast.error(`AI Notice: ${first.error}`, { id: 'scan-snap' });
        // Previously this path recorded nothing, so every timeout/quota/network
        // failure silently vanished from the "bills not added" guard.
        recordFailedScan('', `AI could not read the bill (${first.error})`);
        setStatusText('AI could not read this bill — tap Retry or rescan it');
        return;
      }

      if (first.found && first.consumerNumber) {
        // Silent pass: no popup/record yet, so a retry or a confirmed suggestion
        // can resolve the bill without leaving a stale "not added" row.
        const firstOutcome = await processMatchedConsumerNumber(
          first.consumerNumber,
          first.consumerName,
          { silent: true }
        );
        if (firstOutcome === 'added') {
          // The add path already showed a success or name-mismatch toast.
          setStatusText(`Matched #${first.consumerNumber}! Ready for next bill`);
          return;
        }
        if (firstOutcome === 'duplicate') {
          setDuplicateCount((n) => n + 1);
          toast(`#${first.consumerNumber} is already in the list`, { id: 'scan-snap', icon: '⚠️' });
          setStatusText(`#${first.consumerNumber} already added — ready for next bill`);
          return;
        }

        // Not in the database: show exactly the number that was read. No
        // look-alike substitutes (8/6/0 or one-digit) and no second guess from
        // a re-read, so a different consumer is never added for this bill.
        const finalOutcome = await processMatchedConsumerNumber(
          first.consumerNumber,
          first.consumerName
        );
        if (finalOutcome === 'duplicate') {
          setDuplicateCount((n) => n + 1);
        }
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
            // The add path already showed a success or name-mismatch toast.
            setStatusText(`Recovered #${retry.consumerNumber}! Ready for next bill`);
          } else if (recovered === 'duplicate') {
            setDuplicateCount((n) => n + 1);
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
      recordFailedScan('', 'Cons No not detected — rescan this bill');
      setStatusText('Cons No not detected. Tap Retry or rescan the bill.');
      toast.error('Cons No: not detected. Make sure "Details of Receiver:" is in view & in focus.', {
        id: 'scan-snap',
        duration: 3500,
      });
    } catch (err: any) {
      console.warn('Scan cycle error:', err);
      // Never let an unexpected pipeline error drop a capture silently.
      recordFailedScan('', `Scan failed (${err?.message || 'check connection'})`);
      toast.error(`Scan error: ${err.message || 'Check connection'}`, { id: 'scan-snap' });
    } finally {
      isProcessingRef.current = false;
      setIsProcessing(false);
    }
  };

  // Main Scan Trigger (Exclusively Gemini AI Vision - 1-Tap Snap)
  const performScan = async () => {
    if (isProcessingRef.current) return;

    if (!navigator.onLine) {
      toast.error('Offline: AI Snap requires internet. Type Cons No below.', { id: 'scan-snap' });
      return;
    }

    if (!isVideoReady || !videoRef.current || videoRef.current.videoWidth === 0) {
      toast.error('Camera is still starting — hold on a moment', { id: 'scan-snap' });
      setStatusText('Camera starting… please wait');
      return;
    }

    const imgDataUrl = captureCameraFrame();
    if (!imgDataUrl) {
      toast.error('Could not capture the bill — hold steady and retry', { id: 'scan-snap' });
      setStatusText('Capture failed — hold steady and tap Snap');
      return;
    }

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
    const cleanNum = normalizeDigits(manualInput);

    if (!cleanNum) {
      toast.error('Please enter valid digits for Consumer Number');
      setIsProcessing(false);
      return;
    }

    const outcome = await processMatchedConsumerNumber(cleanNum, undefined, { silent: true });
    if (outcome === 'failed') {
      if (DISTRIBUTOR_BLACKLIST.has(cleanNum) || cleanNum.length > 12) {
        toast.error(`Consumer #${cleanNum} cannot be added`);
        setIsProcessing(false);
        return;
      }
      // Typed number is not in the database: add exactly what was typed.
      // Never substitute a similar number from the database.
      handleForceAdd(cleanNum);
    }
    // The bill is now in the list — retire its pending (failed) entry so the
    // Done guard and "Add All" do not add a second, mis-read copy of it.
    const editedNumber = editingFailedNumberRef.current;
    const editedDigits = editedNumber ? normalizeDigits(editedNumber) : '';
    setFailedScanList((prev) =>
      prev.filter((item) => {
        const digits = normalizeDigits(item.raw_number);
        return digits !== cleanNum && digits !== editedDigits;
      })
    );
    editingFailedNumberRef.current = null;
    setManualInput('');
    if (outcome === 'duplicate') {
      toast(`#${cleanNum} is already in the list`, { icon: '⚠️' });
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
      const digits = normalizeDigits(item.raw_number);
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

  // Captures with no usable number (AI timeout/quota, blurry line, or a
  // nonsensical digit run). There is nothing to force-add: each one must be
  // physically rescanned or explicitly acknowledged. They used to be collapsed
  // into one "???" row and then silently cleared by "Add All", which is how a
  // session could show "36 scanned, 22 added" with no trace of the other 14.
  const pendingKeys = new Set(pendingBills.map((item) => numberKey(item.raw_number)));
  const unreadBills = failedScanList.filter(
    (item) => !pendingKeys.has(numberKey(item.raw_number))
  );
  const unresolvedCount = pendingBills.length + unreadBills.length;

  /**
   * The session counter is the record of what the operator actually scanned.
   * A background roster/realtime refresh can replace the parent list while the
   * camera is open, which used to leave "40 added" in the scanner but only 37
   * bills in the list. Before closing, re-send every counted bill that is not
   * in the parent list so the final list always matches the counter.
   */
  const closeScanner = (excludeNumberKeys?: Set<string>) => {
    const present = new Set(existingNumbers.map((n) => numberKey(n)));
    const missing = scannedSessionList.filter((item) => {
      const key = numberKey(item.consumer_number);
      return !present.has(key) && !excludeNumberKeys?.has(key);
    });

    missing.forEach((item) => {
      onConsumerScanned({
        consumer_id: item.payload?.consumer_id,
        consumer_number: item.consumer_number,
        consumer_name: item.consumer_name,
        address: item.payload?.address || 'Directly Verified / Physical Bill',
        mobile: item.payload?.mobile || '',
        found: true,
        duplicate_of_agent: item.payload?.duplicate_of_agent,
        duplicate_claimed_date: item.payload?.duplicate_claimed_date,
      });
    });

    if (missing.length > 0) {
      console.warn(
        `[Scanner] Restored ${missing.length} bill(s) that were missing from the delivery list.`
      );
      toast.success(
        `Restored ${missing.length} bill${missing.length === 1 ? '' : 's'} to the list`,
        { id: 'scan-restore', duration: 4000 }
      );
    }

    onClose();
  };

  const handleForceAddAllPending = () => {
    const items = [...pendingBills];
    if (items.length === 0) return;

    const batch = items
      .map((item) => {
        const cleanNum = normalizeDigits(item.raw_number);
        return { item, cleanNum };
      })
      .filter(
        ({ cleanNum }) =>
          Boolean(cleanNum) && !scannedSetRef.current.has(numberKey(cleanNum))
      );

    batch.forEach(({ cleanNum }) => {
      const otherClaimant = claimedByOtherAgents[numberKey(cleanNum)];
      const finalName = `Customer #${cleanNum}`;

      scannedSetRef.current.add(numberKey(cleanNum));
      pushSessionAdded(cleanNum, finalName, false, {
        address: 'Directly Verified / Physical Bill',
        mobile: '',
        duplicate_of_agent: otherClaimant ? otherClaimant.agentName : undefined,
        duplicate_claimed_date: otherClaimant ? otherClaimant.date : undefined,
      });
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

    // Retire every numbered pending bill now that it has been resolved: either
    // added just now, or already present in the delivery list. Unread captures
    // stay so "Add All" can never clear them as a side effect.
    const resolvedKeys = new Set(pendingBills.map((item) => numberKey(item.raw_number)));
    setFailedScanList((prev) =>
      prev.filter(
        (item) => !item.raw_number || !resolvedKeys.has(numberKey(item.raw_number))
      )
    );

    if (unreadBills.length > 0) {
      toast.error(
        `${unreadBills.length} bill${unreadBills.length === 1 ? '' : 's'} still unread — rescan before closing`,
        { id: 'scan-snap', duration: 5000 }
      );
      setStatusText(`${unreadBills.length} unread bill(s) still not added`);
      return;
    }

    setShowDoneWarning(false);
    setNameMismatchNotice(null);
    if (batch.length > 0) {
      toast.success(`Added ${batch.length} pending bill(s) ✓`, { id: 'scan-snap' });
      setStatusText(`Added ${batch.length} pending bill(s). Done!`);
    } else {
      toast('Those bills were already in the delivery list', { id: 'scan-snap', icon: '⚠️' });
      setStatusText('No new bills needed — already in the list');
    }

    // These were just sent above; do not re-send them. Any earlier scanned bill
    // that a background reload dropped is still restored.
    closeScanner(new Set(batch.map(({ cleanNum }) => numberKey(cleanNum))));
  };

  const handleDone = () => {
    if (unresolvedCount > 0) {
      setShowDoneWarning(true);
      return;
    }
    closeScanner();
  };

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[2000] h-[100dvh] w-full bg-slate-950 flex flex-col overflow-hidden font-sans select-none overscroll-none"
      data-bgcls-editing="true"
    >
      {/* 2. FLOATING TOP HEADER OVERLAY */}
      <div
        className="relative z-30 shrink-0 bg-gradient-to-b from-slate-950 via-slate-950/70 to-transparent p-3 pt-3.5 text-white"
        style={{ paddingTop: 'max(0.875rem, env(safe-area-inset-top))' }}
      >
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

          {nameMismatchNotice && (
            <div className="bg-amber-500 text-slate-950 p-2 rounded-xl shadow-lg flex items-start gap-2 border border-amber-300 text-xs font-bold animate-in zoom-in-95 duration-200">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="truncate">
                  #{nameMismatchNotice.consumer_number} added as {nameMismatchNotice.db_name}
                </p>
                <p className="text-[10px] font-semibold truncate">
                  Receipt name reads "{nameMismatchNotice.receipt_name}" — verify this bill
                </p>
              </div>
              <button
                type="button"
                onClick={() => setNameMismatchNotice(null)}
                className="p-0.5 shrink-0"
                title="Dismiss"
              >
                <X size={14} />
              </button>
            </div>
          )}

          {lastScanned && !alreadyAddedNotice && !duplicateScamNotice && !nameMismatchNotice && (
            <div className="bg-emerald-600/95 text-white p-2 rounded-xl shadow-lg flex items-center gap-2 border border-emerald-400/40">
              <CheckCircle2 className="w-4 h-4 text-amber-300 shrink-0" />
              <span className="text-xs font-black truncate uppercase">ADDED: #{lastScanned}</span>
            </div>
          )}
        </div>
      </div>

      {/* 0. COMPACT CAMERA VIEWFINDER + QUICK ACTIONS (scrollable body) */}
      <main className="relative z-20 flex flex-1 min-h-0 flex-col overflow-y-auto px-3 py-2">
        <div className="mx-auto flex w-full max-w-lg flex-1 min-h-0 flex-col gap-2">
          <div
            ref={previewFrameRef}
            onClick={triggerFocus}
            className="relative w-full h-[min(408px,52dvh)] sm:h-[min(480px,55dvh)] overflow-hidden rounded-2xl border border-white/15 bg-black shadow-2xl cursor-pointer"
            title="Tap to focus"
          >
            <video
              ref={videoRef}
              playsInline
              muted
              className="absolute inset-0 h-full w-full object-cover"
              onLoadedMetadata={() => setIsVideoReady(true)}
              onPlaying={() => setIsVideoReady(true)}
            />
            <canvas ref={canvasRef} className="hidden" />

            {/* Shutter Flash Animation */}
            {isShutterFlash && (
              <div className="absolute inset-0 bg-white/70 pointer-events-none z-30 transition-opacity duration-150" />
            )}

            {/* Camera unavailable: the guide box would be misleading here. */}
            {cameraError && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-1.5 bg-slate-950/85 px-6 text-center pointer-events-none">
                <Camera className="w-6 h-6 text-slate-500" />
                <p className="text-xs font-black text-amber-300">Camera unavailable</p>
                <p className="text-[10px] text-slate-400">
                  Allow camera access, or use the Photo button / type the Cons No below.
                </p>
              </div>
            )}

            {/* Crop guide: ONLY this rectangle is sent to Gemini. */}
            <div
              ref={guideBoxRef}
              className={`absolute inset-x-3 top-1/2 -translate-y-1/2 h-[110px] sm:h-[130px] border-2 rounded-xl pointer-events-none flex flex-col justify-center transition-all duration-300 z-10 ${
                isSuccessFlash
                  ? 'border-emerald-400 bg-emerald-500/20 shadow-[0_0_40px_rgba(16,185,129,0.45)]'
                  : 'border-dashed border-amber-400/80 shadow-[0_0_24px_rgba(245,158,11,0.2)]'
              }`}
            >
              {/* Sweeping Laser Animation Line */}
              <div className="relative w-full h-0.5 overflow-visible">
                <div className="absolute inset-x-0 h-0.5 bg-gradient-to-r from-transparent via-amber-400 to-transparent shadow-[0_0_14px_#fbbf24] animate-pulse" />
              </div>

              {/* Compact instruction / progress chip */}
              <div className="absolute inset-x-0 top-1.5 flex justify-center">
                <div className="bg-slate-950/85 backdrop-blur-md text-amber-300 font-extrabold text-[9px] py-0.5 px-2 rounded-full border border-amber-400/40 shadow-lg flex items-center gap-1 pointer-events-none">
                  {isProcessing ? (
                    <>
                      <Loader2 className="w-3 h-3 animate-spin text-amber-400" />
                      <span>Reading Cons No & Name...</span>
                    </>
                  ) : (
                    <>
                      <Camera className="w-3 h-3 text-amber-400" />
                      <span>Cons No + Name inside box</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          <p className="text-center text-[10px] text-slate-400 -mt-1">
            Only the boxed line is scanned — keep the receipt line inside it.
          </p>

          {/* Compact quick actions — sits directly under the camera preview */}
          <div className="flex items-center gap-2">
            <input
              type="file"
              ref={fileInputRef}
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleFileUpload}
            />

            {/* 1-TAP AI SNAP PRIMARY SHUTTER BUTTON */}
            <button
              type="button"
              onClick={performScan}
              disabled={isProcessing || !isOnline || !isVideoReady}
              className={`flex-1 font-black py-2.5 px-3 rounded-xl shadow-xl active:scale-95 transition-all flex items-center justify-center gap-1.5 border text-[11px] uppercase tracking-wide disabled:opacity-60 ${
                !isOnline
                  ? 'bg-slate-800 text-amber-300 border-amber-500/40 shadow-none cursor-not-allowed'
                  : 'bg-gradient-to-r from-amber-400 via-orange-500 to-amber-500 hover:from-amber-500 hover:to-orange-600 text-slate-950 border-amber-300 shadow-orange-500/30'
              }`}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
                  <span>Reading...</span>
                </>
              ) : !isOnline ? (
                <>
                  <WifiOff className="w-4 h-4 text-amber-400" />
                  <span>Offline (Type Below)</span>
                </>
              ) : !isVideoReady ? (
                cameraError ? (
                  <>
                    <Camera className="w-4 h-4 text-slate-950" />
                    <span>Camera Off — Type Below</span>
                  </>
                ) : (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
                    <span>Starting Camera…</span>
                  </>
                )
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-slate-950 animate-pulse" />
                  <span>1-Tap AI Snap</span>
                </>
              )}
            </button>

            {/* Photo / Gallery Upload Button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing}
              className="bg-slate-900/90 hover:bg-slate-800 text-white font-bold py-2.5 px-3 rounded-xl shadow-lg active:scale-95 transition-all flex items-center justify-center gap-1 border border-white/20 text-[11px] disabled:opacity-50 shrink-0"
              title="Snap with phone camera or pick from gallery"
            >
              <Camera className="w-4 h-4 text-amber-400" />
              <span className="font-semibold">Photo</span>
            </button>
          </div>

          {/* Quick Session Status Bar */}
          <div className="shrink-0 flex items-center justify-between gap-2 text-[11px] bg-slate-900/80 border border-white/10 px-3 py-1.5 rounded-xl">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
              <span className="text-slate-400 font-semibold" title="Snap attempts this session (retakes included)">
                {snapAttempts} snaps
              </span>
              <span className="text-emerald-400 font-bold flex items-center gap-1">
                <Check className="w-3.5 h-3.5" />
                <span>{scannedSessionList.length} Added</span>
              </span>
              {duplicateCount > 0 && (
                <span
                  className="text-sky-300 font-bold"
                  title="Already in the delivery list — not lost bills"
                >
                  {duplicateCount} already
                </span>
              )}
              {unresolvedCount > 0 && (
                <span className="text-rose-400 font-bold flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>{unresolvedCount} Not added</span>
                </span>
              )}
            </div>
            <span className="text-[10px] text-slate-400 font-medium truncate max-w-[130px] shrink-0">
              {statusText}
            </span>
          </div>

          {/* Live session list — fills the rest of the screen so the layout has
              no dead space, and lets the operator verify what was added. */}
          <div className="flex-1 min-h-0 overflow-y-auto rounded-2xl border border-white/10 bg-slate-900/50 p-1.5 flex flex-col gap-1">
            {scannedSessionList.length === 0 && failedScanList.length === 0 && (
              <div className="flex h-full min-h-[64px] flex-col items-center justify-center text-center gap-1 px-6 py-3">
                <Camera className="w-5 h-5 text-slate-600" />
                <p className="text-[11px] font-semibold text-slate-400">Scanned bills appear here</p>
                <p className="text-[10px] text-slate-500">
                  Keep only the Cons No + Name line inside the box, then tap 1-Tap AI Snap.
                </p>
              </div>
            )}

            {scannedSessionList.map((item, idx) => (
              <div
                key={`${item.consumer_number}-${idx}`}
                className={`border rounded-xl px-2.5 py-1.5 text-xs flex items-center gap-2 shrink-0 ${
                  item.name_mismatch
                    ? 'bg-amber-900/40 border-amber-500/40'
                    : 'bg-slate-800/90 border-white/10'
                }`}
                title={
                  item.name_mismatch
                    ? 'Number verified, but the printed name differs from the database name'
                    : undefined
                }
              >
                {item.name_mismatch ? (
                  <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                ) : (
                  <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                )}
                <span className="font-mono font-bold text-amber-300 shrink-0">#{item.consumer_number}</span>
                <span className="text-[11px] text-slate-300 truncate">{item.consumer_name}</span>
                {item.name_mismatch && (
                  <span className="ml-auto text-[9px] font-black uppercase tracking-wide text-amber-300 shrink-0">
                    Verify
                  </span>
                )}
              </div>
            ))}

            {failedScanList.length > 0 && (
              <div className="mt-auto pt-1.5 border-t border-rose-500/20 flex flex-col gap-1">
                <p className="text-[9px] font-black uppercase tracking-wider text-rose-400 px-1">
                  Not added yet — resolve or rescan before Done
                </p>
                {failedScanList.map((item) => (
                  <div
                    key={item.id}
                    className="bg-rose-900/60 border border-rose-500/30 rounded-xl px-2.5 py-1 flex items-start gap-2 text-xs shrink-0"
                  >
                    <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <span className="font-mono font-bold text-rose-200">
                        {item.raw_number ? `#${item.raw_number}` : 'Unread bill'}
                      </span>
                      <p className="text-[10px] text-rose-300 leading-tight">{item.reason}</p>
                      {item.raw_number ? (
                        <div className="flex gap-1.5 mt-1">
                          <button
                            type="button"
                            onClick={() => handleForceAdd(item.raw_number)}
                            className="flex-1 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-black py-1 px-2 rounded-lg text-[10px] flex items-center justify-center gap-1 active:scale-95 transition-all"
                          >
                            <Check className="w-3 h-3" />
                            <span>Force Add</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleEditFailedItem(item.raw_number)}
                            className="flex-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black py-1 px-2 rounded-lg text-[10px] flex items-center justify-center gap-1 active:scale-95 transition-all"
                          >
                            <Plus className="w-3 h-3" />
                            <span>Edit</span>
                          </button>
                        </div>
                      ) : (
                        <div className="flex gap-1.5 mt-1">
                          <button
                            type="button"
                            onClick={() => handleRescanUnread(item.id)}
                            className="flex-1 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-slate-950 font-black py-1 px-2 rounded-lg text-[10px] flex items-center justify-center gap-1 active:scale-95 transition-all"
                          >
                            <Camera className="w-3 h-3" />
                            <span>Rescan</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemoveFailedScan(item.id)}
                            className="flex-1 bg-slate-800 hover:bg-slate-700 border border-white/20 text-slate-300 font-bold py-1 px-2 rounded-lg text-[10px] active:scale-95 transition-all"
                          >
                            <span>Resolved</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>


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
                    {activeScanFailAlert.suggested_match
                      ? '✅ Possible Match Found!'
                      : activeScanFailAlert.type === 'NOT_FOUND'
                      ? '❌ Not Found In Data!'
                      : activeScanFailAlert.type === 'NOT_DETECTED'
                      ? '🔍 Cons No Not Detected!'
                      : '⚠️ Bill Not Added!'}
                  </h3>
                  <p className="text-[10px] text-slate-300 font-medium">
                    {activeScanFailAlert.suggested_match
                      ? 'Confirm the 8/6/0 correction before adding'
                      : 'Choose action for this bill'}
                  </p>
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

              {/* Reason Explanation */}
              <div className="bg-rose-950/40 rounded-xl p-2 border border-rose-500/20 text-[11px] text-rose-200 font-semibold leading-relaxed mt-0.5">
                {activeScanFailAlert.reason}
              </div>
            </div>

            {/* Confirm-first 8/6/0 recovery. NOTHING is added automatically. */}
            {activeScanFailAlert.suggested_match && (
              <div className="bg-emerald-950/50 border-2 border-emerald-500/60 rounded-2xl p-3 flex flex-col gap-2.5">
                <p className="text-[10px] font-black uppercase tracking-wider text-emerald-300">
                  Possible 8 / 6 / 0 correction
                </p>

                <div className="flex items-center justify-between gap-2 rounded-xl bg-slate-950/70 border border-emerald-500/30 px-2.5 py-2">
                  <div className="min-w-0">
                    <p className="text-[9px] uppercase font-bold text-slate-400">Printed on bill</p>
                    <p className="font-mono text-sm font-black text-amber-400">
                      #{activeScanFailAlert.consumer_number}
                    </p>
                  </div>
                  <span className="text-emerald-400 font-black text-sm shrink-0">→</span>
                  <div className="min-w-0 text-right">
                    <p className="text-[9px] uppercase font-bold text-slate-400">Database match</p>
                    <p className="font-mono text-sm font-black text-emerald-200">
                      #{activeScanFailAlert.suggested_match.consumer_number}
                    </p>
                  </div>
                </div>

                <div className="min-w-0">
                  <p className="text-xs font-bold text-white truncate">
                    {activeScanFailAlert.suggested_match.consumer_name}
                  </p>
                  <p className="text-[10px] text-emerald-200/80 leading-snug mt-0.5">
                    The two numbers differ only in faint 8/6/0 digits and the name matches.
                    <b className="text-emerald-300"> Nothing is added until you confirm.</b>
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleAcceptSuggestedMatch}
                  className="w-full bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 hover:from-emerald-500 hover:to-teal-500 text-white font-black py-3 px-3 rounded-xl shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2 text-xs uppercase tracking-wide border border-emerald-400/60"
                >
                  <Check className="w-4 h-4" />
                  <span>Confirm &amp; Add #{activeScanFailAlert.suggested_match.consumer_number}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveScanFailAlert(null)}
                  className="w-full bg-slate-800 hover:bg-slate-700 border border-white/20 text-slate-300 font-bold py-2 px-3 rounded-xl text-[11px] active:scale-95 transition-all"
                >
                  No — keep printed #{activeScanFailAlert.consumer_number}
                </button>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex flex-col gap-2 pt-0.5">
              {activeScanFailAlert.consumer_number && !activeScanFailAlert.suggested_match && (
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

      {/* 4. FIXED BOTTOM BAR: manual key-in + finish */}
      <div
        className="relative z-30 shrink-0 border-t border-white/10 bg-slate-950/95 px-3 pt-2 text-white"
        style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
      >
        <div className="mx-auto flex w-full max-w-lg flex-col gap-2">
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
                unresolvedCount > 0
                  ? 'bg-gradient-to-r from-amber-500 to-orange-600 text-slate-950 animate-pulse'
                  : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white'
              }`}
            >
              Done ({scannedSessionList.length})
              {unresolvedCount > 0 ? ` · ${unresolvedCount} not added` : ''}
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
                  {snapAttempts} snap{snapAttempts === 1 ? '' : 's'}: {scannedSessionList.length} added
                  {duplicateCount > 0 ? `, ${duplicateCount} already in the list` : ''}
                  {unresolvedCount > 0 ? `, ${unresolvedCount} not added` : ''}.
                </p>
              </div>
            </div>

            <div className="bg-slate-950/80 rounded-2xl p-3 border border-amber-500/30 text-xs text-amber-100 leading-relaxed space-y-2">
              {pendingBills.length > 0 && (
                <div>
                  <b>{pendingBills.length}</b> scanned bill{pendingBills.length === 1 ? '' : 's'} could not be
                  auto-verified in the agency database. Add them now so no cash memo is missed.
                  <div className="mt-2 flex flex-wrap gap-1">
                    {pendingBills.slice(0, 12).map((item) => (
                      <span
                        key={item.id}
                        className="font-mono text-[11px] bg-amber-500/15 border border-amber-400/30 text-amber-200 px-1.5 py-0.5 rounded-md"
                      >
                        #{item.raw_number}
                      </span>
                    ))}
                    {pendingBills.length > 12 && (
                      <span className="text-[11px] text-amber-300">+{pendingBills.length - 12} more</span>
                    )}
                  </div>
                </div>
              )}

              {unreadBills.length > 0 && (
                <div className="border-t border-amber-500/20 pt-2">
                  <b>{unreadBills.length}</b> bill{unreadBills.length === 1 ? '' : 's'} have no usable
                  number (AI timeout / quota / blurry print / merged digits). They cannot be force-added —{' '}
                  <b>rescan those bills</b>, or mark each row Resolved after checking the paper.
                </div>
              )}
            </div>

            {pendingBills.length > 0 && (
              <button
                type="button"
                onClick={handleForceAddAllPending}
                className="w-full bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 hover:from-emerald-500 hover:to-teal-500 text-white font-black py-3 px-3 rounded-2xl shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2 text-xs uppercase tracking-wide border border-emerald-400/50"
              >
                <Check className="w-4 h-4" />
                Add All {pendingBills.length} Bill{pendingBills.length === 1 ? '' : 's'}
              </button>
            )}

            {unreadBills.length > 0 && (
              <button
                type="button"
                onClick={() => unreadBills[0] && handleRescanUnread(unreadBills[0].id)}
                className="w-full bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-slate-950 font-black py-3 px-3 rounded-2xl shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2 text-xs uppercase tracking-wide"
              >
                <Camera className="w-4 h-4" />
                Retake Unread Bill
              </button>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  // The pending list is always visible in the session panel now.
                  setShowDoneWarning(false);
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
                  closeScanner();
                }}
                className="flex-1 bg-slate-800 hover:bg-slate-700 border border-white/20 text-slate-300 font-semibold py-2.5 px-2 rounded-xl text-xs active:scale-95 transition-all"
              >
                Close Anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
};

export default LiveCameraScannerModal;
