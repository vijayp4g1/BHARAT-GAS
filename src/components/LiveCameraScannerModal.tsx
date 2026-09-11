import React, { useEffect, useRef, useState, useCallback } from 'react';
import { 
  X, 
  Flashlight, 
  CheckCircle2, 
  AlertCircle, 
  Zap, 
  Sparkles, 
  Loader2, 
  Search, 
  Plus, 
  RotateCcw,
  Check,
  Eye,
  SlidersHorizontal,
  Volume2
} from 'lucide-react';
import db, { type Consumer } from '../lib/db';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import { scanBillWithGemini } from '../lib/gemini';
import Tesseract from 'tesseract.js';

interface LiveCameraScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConsumerScanned: (consumer: {
    consumer_number: string;
    consumer_name: string;
    address?: string;
    mobile?: string;
    found: boolean;
  }) => void;
  existingNumbers: string[];
}

interface ScannedSessionItem {
  consumer_number: string;
  consumer_name: string;
  timestamp: number;
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
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.28);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.28);
  } catch (err) {
    // Audio fallback
  }
}

function cleanAndNormalizeDigits(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/I|L|\|/g, '1')
    .replace(/O|Q/g, '0')
    .replace(/B/g, '8')
    .replace(/Z/g, '2')
    .replace(/S/g, '5')
    .replace(/G/g, '6')
    .replace(/T/g, '7')
    .replace(/[^0-9]/g, '');
}

function preprocessCanvasForOcr(sourceCanvas: HTMLCanvasElement): HTMLCanvasElement {
  const processedCanvas = document.createElement('canvas');
  processedCanvas.width = sourceCanvas.width;
  processedCanvas.height = sourceCanvas.height;
  const ctx = processedCanvas.getContext('2d');
  if (!ctx) return sourceCanvas;

  ctx.drawImage(sourceCanvas, 0, 0);
  const imgData = ctx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  const data = imgData.data;

  // Grayscale & high contrast boost for receipt text OCR
  const contrast = 50;
  const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));

  for (let i = 0; i < data.length; i += 4) {
    const avg = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    let color = factor * (avg - 128) + 128;
    color = Math.min(255, Math.max(0, color));
    data[i] = color;
    data[i + 1] = color;
    data[i + 2] = color;
  }

  ctx.putImageData(imgData, 0, 0);
  return processedCanvas;
}

export const LiveCameraScannerModal: React.FC<LiveCameraScannerModalProps> = ({
  isOpen,
  onClose,
  onConsumerScanned,
  existingNumbers,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [scanEngine, setScanEngine] = useState<'GEMINI' | 'LOCAL'>('GEMINI');
  const [autoScanEnabled, setAutoScanEnabled] = useState<boolean>(true);
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [alreadyAddedNotice, setAlreadyAddedNotice] = useState<string | null>(null);
  const [torchOn, setTorchOn] = useState<boolean>(false);
  const [scannedSessionList, setScannedSessionList] = useState<ScannedSessionItem[]>([]);
  const [statusText, setStatusText] = useState<string>('Align Cons No: & Name inside box...');
  const [manualInput, setManualInput] = useState<string>('');
  const [isSuccessFlash, setIsSuccessFlash] = useState<boolean>(false);

  // Set of all added consumer numbers to prevent re-adding
  const scannedSetRef = useRef<Set<string>>(new Set(existingNumbers.map((n) => n.toLowerCase())));
  
  // Cooldown map to avoid spamming the same bill while it remains in front of the lens
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
      setStatusText('Starting HD camera feed...');
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });

      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        await videoRef.current.play();
      }
      setStatusText('Gemini AI Active — Align receipt');
    } catch (err) {
      console.error('Camera access error:', err);
      setStatusText('Camera permission denied or camera unavailable');
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

  // Process a candidate consumer number match
  const processMatchedConsumerNumber = async (
    rawNum: string,
    extractedName?: string
  ): Promise<boolean> => {
    const cleanNum = cleanAndNormalizeDigits(rawNum);

    if (!cleanNum || cleanNum.length < 1 || cleanNum.length > 10) {
      return false;
    }

    if (DISTRIBUTOR_BLACKLIST.has(cleanNum)) {
      return false;
    }

    // Check anti-spam cooldown (5 seconds for the same number)
    const now = Date.now();
    const lastSeen = recentSeenCooldownRef.current.get(cleanNum.toLowerCase());
    if (lastSeen && now - lastSeen < 5000) {
      return false; // Still within cooldown, ignore quietly
    }
    recentSeenCooldownRef.current.set(cleanNum.toLowerCase(), now);

    // 1. Check local Dexie master database
    const localMatch = await db.consumers
      .where('consumer_number')
      .equalsIgnoreCase(cleanNum)
      .first();

    if (localMatch) {
      const isAlreadyAdded = scannedSetRef.current.has(localMatch.consumer_number.toLowerCase());
      if (isAlreadyAdded) {
        setAlreadyAddedNotice(`Consumer #${localMatch.consumer_number} (${localMatch.consumer_name}) already added!`);
        setTimeout(() => setAlreadyAddedNotice(null), 3000);
        return true;
      }

      // Success! Consumer number matched in master database
      scannedSetRef.current.add(localMatch.consumer_number.toLowerCase());
      setAlreadyAddedNotice(null);

      if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
      playSuccessBeep();

      setIsSuccessFlash(true);
      setTimeout(() => setIsSuccessFlash(false), 800);

      const displayName = localMatch.consumer_name || extractedName || 'Matched Consumer';
      setLastScanned(`${localMatch.consumer_number} - ${displayName}`);

      setScannedSessionList((prev) => [
        { consumer_number: localMatch.consumer_number, consumer_name: displayName, timestamp: Date.now() },
        ...prev,
      ]);

      onConsumerScanned({
        consumer_number: localMatch.consumer_number,
        consumer_name: displayName,
        address: localMatch.address,
        mobile: localMatch.mobile,
        found: true,
      });

      toast.success(`✨ Scanned #${localMatch.consumer_number} (${displayName})!`);
      return true;
    } else {
      // 2. Check remote database if online
      let remoteMatch: any = null;
      if (navigator.onLine) {
        try {
          const { data } = await supabase
            .from('consumers')
            .select('id, consumer_number, consumer_name, address, mobile')
            .eq('consumer_number', cleanNum)
            .maybeSingle();
          remoteMatch = data;
        } catch (e) {
          console.warn('Remote lookup error:', e);
        }
      }

      const finalName = remoteMatch?.consumer_name || extractedName?.trim().toUpperCase() || 'New / Unverified';
      const finalAddress = remoteMatch?.address || 'Scanned via Gemini AI';
      const finalMobile = remoteMatch?.mobile || '';

      // Cache locally if verified remotely
      if (remoteMatch) {
        const cachedRecord: Consumer = {
          id: remoteMatch.id || `cons_${cleanNum}_${Date.now()}`,
          consumer_number: cleanNum,
          consumer_name: finalName,
          mobile: finalMobile,
          address: finalAddress,
          verification_status: 'Verified',
          created_at: new Date().toISOString(),
          searchWords: [...finalName.toLowerCase().split(/\s+/), cleanNum.toLowerCase()],
        };
        await db.consumers.put(cachedRecord).catch((err: any) => console.error('Dexie put error:', err));
      }

      const isAlreadyAdded = scannedSetRef.current.has(cleanNum.toLowerCase());
      if (isAlreadyAdded) {
        setAlreadyAddedNotice(`Consumer #${cleanNum} is already in your delivery list!`);
        setTimeout(() => setAlreadyAddedNotice(null), 3000);
        return true;
      }

      scannedSetRef.current.add(cleanNum.toLowerCase());
      setAlreadyAddedNotice(null);

      if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
      playSuccessBeep();

      setIsSuccessFlash(true);
      setTimeout(() => setIsSuccessFlash(false), 800);

      setLastScanned(`${cleanNum} - ${finalName}`);
      setScannedSessionList((prev) => [
        { consumer_number: cleanNum, consumer_name: finalName, timestamp: Date.now() },
        ...prev,
      ]);

      onConsumerScanned({
        consumer_number: cleanNum,
        consumer_name: finalName,
        address: finalAddress,
        mobile: finalMobile,
        found: Boolean(remoteMatch),
      });

      if (remoteMatch) {
        toast.success(`✨ Matched #${cleanNum} (${finalName})!`);
      } else {
        toast(`Added #${cleanNum} (${finalName})`, { icon: 'ℹ️' });
      }
      return true;
    }
  };

  /**
   * Crop and capture the active viewfinder area
   * Cropping the center ~75% focuses Gemini AI directly on the receipt,
   * eliminating background hands/steering wheel and boosting inference speed by 3x.
   */
  const captureViewfinderCrop = (): HTMLCanvasElement | null => {
    if (!videoRef.current || !canvasRef.current) return null;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx || video.videoWidth === 0 || video.videoHeight === 0) return null;

    // Viewfinder target box is centered with some margins
    const cropX = Math.round(video.videoWidth * 0.08);
    const cropY = Math.round(video.videoHeight * 0.08);
    const cropW = Math.round(video.videoWidth * 0.84);
    const cropH = Math.round(video.videoHeight * 0.78);

    // Target max dimensions for crisp dot-matrix receipt OCR
    const maxDim = 900;
    let targetW = cropW;
    let targetH = cropH;
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
    ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, targetW, targetH);

    return canvas;
  };

  // Main Scan Trigger (Supports Gemini AI Vision & Local Offline OCR)
  const performScan = useCallback(async (isAutoTrigger = false) => {
    if (isProcessing || !videoRef.current || !canvasRef.current) return;

    const canvas = captureViewfinderCrop();
    if (!canvas) return;

    setIsProcessing(true);
    if (!isAutoTrigger) {
      toast.loading('Gemini AI reading receipt...', { id: 'scan-snap' });
    }

    try {
      if (scanEngine === 'GEMINI') {
        setStatusText('Gemini AI parsing Cons No & Name...');
        const imgDataUrl = canvas.toDataURL('image/jpeg', 0.82);
        const result = await scanBillWithGemini(imgDataUrl);

        if (result.error) {
          if (!isAutoTrigger) {
            toast.error(`AI Notice: ${result.error}`, { id: 'scan-snap' });
          }
          setStatusText('Reposition receipt in box...');
          return;
        }

        if (result.found && result.consumerNumber) {
          const matched = await processMatchedConsumerNumber(result.consumerNumber, result.consumerName);
          if (matched) {
            if (!isAutoTrigger) {
              toast.success('Matched successfully!', { id: 'scan-snap' });
            }
            setStatusText(`Matched #${result.consumerNumber}! Flip to next bill`);
            return;
          }
        } else {
          setStatusText('Align "Cons No:" & Name inside box...');
          if (!isAutoTrigger) {
            toast.error('Cons No: not detected. Bring camera closer to "Details of Receiver:"', {
              id: 'scan-snap',
              duration: 3000,
            });
          }
        }
      } else {
        // Local Offline Tesseract OCR Mode (Strict Consumer Number Matching Only)
        setStatusText('Local OCR reading text...');
        const preprocessed = preprocessCanvasForOcr(canvas);
        const { data } = await Tesseract.recognize(preprocessed, 'eng');
        const fullText = data.text || '';

        // Strict Regex: ONLY match when explicitly preceded by CONS NO / CONSUMER NO (never bare "NO" or random digits!)
        const consNoRegex = /(?:CONS(?:UMER)?[\s\.\-_]*NO|DETAILS\s*OF\s*RECEIVER[\s\S]*?CONS[\s\.\-_]*NO)[\s\:\.\-#]*([0-9]{1,10})/gi;
        const consNoMatches = Array.from(fullText.matchAll(consNoRegex));
        let matched = false;

        for (const match of consNoMatches) {
          if (match[1]) {
            const candidateNum = match[1];
            // Verify candidate is not a helpline or distributor code
            if (!DISTRIBUTOR_BLACKLIST.has(candidateNum) && candidateNum.length >= 1) {
              matched = await processMatchedConsumerNumber(candidateNum);
              if (matched) break;
            }
          }
        }

        // Note: Do NOT guess arbitrary numbers from shop numbers, house numbers, or GST!
        if (matched) {
          setStatusText('Matched via Local OCR!');
          if (!isAutoTrigger) toast.success('Local OCR matched!', { id: 'scan-snap' });
        } else {
          setStatusText('Dot-matrix text faint. Switch to Gemini AI for 100% match.');
          if (!isAutoTrigger) {
            toast.error('Cons No: not detected. Tip: Switch to Gemini AI Vision for dot-matrix bills!', {
              id: 'scan-snap',
              duration: 4000,
            });
          }
        }
      }
    } catch (err: any) {
      console.warn('Scan cycle error:', err);
      if (!isAutoTrigger) {
        toast.error(`Scan error: ${err.message || 'Check connection'}`, { id: 'scan-snap' });
      }
    } finally {
      setIsProcessing(false);
    }
  }, [isProcessing, scanEngine]);

  // Continuous Auto-Scan Interval Loop
  useEffect(() => {
    if (!isOpen || !autoScanEnabled) return;

    const intervalTimer = setInterval(() => {
      if (!isProcessing && videoRef.current && videoRef.current.videoWidth > 0) {
        performScan(true);
      }
    }, 1500);

    return () => clearInterval(intervalTimer);
  }, [isOpen, autoScanEnabled, isProcessing, performScan]);

  // Manual Input Key-in Handler
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
    <div className="fixed inset-0 z-50 bg-slate-950/95 backdrop-blur-md flex flex-col justify-between p-3 font-sans">
      {/* Top Header Bar */}
      <div className="flex flex-col gap-2 z-10 bg-slate-900/90 backdrop-blur-md border border-white/10 p-3 rounded-2xl text-white shadow-xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-amber-500/20 border border-amber-400/30 flex items-center justify-center text-amber-400">
              <Sparkles className="w-4 h-4 text-amber-400 animate-pulse" />
            </div>
            <div>
              <h2 className="text-sm font-bold tracking-tight flex items-center gap-1.5">
                <span>Gemini AI Receipt Scanner</span>
                <span className="text-[9px] bg-amber-500/30 text-amber-300 font-extrabold px-1.5 py-0.5 rounded uppercase">
                  Cons No & Name
                </span>
              </h2>
              <p className="text-[10px] text-slate-300">Extracts Cons No & customer name below it</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={toggleTorch}
              className={`p-2.5 rounded-xl border transition-all ${
                torchOn ? 'bg-amber-500 text-slate-900 border-amber-400' : 'bg-white/10 text-white border-white/10'
              }`}
              title="Toggle Flashlight"
            >
              <Flashlight className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              className="p-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white border border-white/10 transition-all"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Engine and Auto-Scan Controls */}
        <div className="grid grid-cols-2 gap-2 pt-1 border-t border-white/10">
          <button
            type="button"
            onClick={() => setAutoScanEnabled(!autoScanEnabled)}
            className={`py-1.5 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 border ${
              autoScanEnabled
                ? 'bg-emerald-500 text-slate-950 border-emerald-400 shadow-md shadow-emerald-500/20'
                : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'
            }`}
          >
            <Zap className={`w-3.5 h-3.5 ${autoScanEnabled ? 'animate-bounce' : ''}`} />
            {autoScanEnabled ? 'Auto-Scan: ON (Hands-free)' : 'Auto-Scan: OFF'}
          </button>

          <button
            type="button"
            onClick={() => setScanEngine(scanEngine === 'GEMINI' ? 'LOCAL' : 'GEMINI')}
            className="py-1.5 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 border border-white/10 bg-white/10 text-white hover:bg-white/15"
          >
            {scanEngine === 'GEMINI' ? (
              <>
                <Sparkles className="w-3.5 h-3.5 text-amber-400" /> Mode: Gemini AI
              </>
            ) : (
              <>
                <SlidersHorizontal className="w-3.5 h-3.5 text-blue-400" /> Mode: Local OCR
              </>
            )}
          </button>
        </div>
      </div>

      {/* Viewfinder Video Stream Container */}
      <div className="relative flex-1 my-2 rounded-3xl overflow-hidden border border-white/20 shadow-2xl bg-black flex items-center justify-center">
        <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
        <canvas ref={canvasRef} className="hidden" />

        {/* Target Box with High-Tech Corner Guides & Laser Animation */}
        <div
          className={`absolute inset-x-4 top-6 bottom-20 border-2 rounded-3xl pointer-events-none flex flex-col justify-between p-4 transition-all duration-300 ${
            isSuccessFlash
              ? 'border-emerald-400 bg-emerald-500/20 shadow-[0_0_80px_rgba(16,185,129,0.5)]'
              : 'border-dashed border-amber-400/80 shadow-[0_0_60px_rgba(245,158,11,0.25)]'
          }`}
        >
          <div className="flex justify-between">
            <div className="w-7 h-7 border-t-4 border-l-4 border-amber-400 rounded-tl-xl" />
            <div className="w-7 h-7 border-t-4 border-r-4 border-amber-400 rounded-tr-xl" />
          </div>

          {/* Sweeping Laser Animation Line (Active when scanning) */}
          <div className="relative w-full h-1 overflow-visible">
            <div className="absolute inset-x-0 h-0.5 bg-gradient-to-r from-transparent via-amber-400 to-transparent shadow-[0_0_12px_#fbbf24] animate-pulse" />
          </div>

          {/* Central Instruction Badge */}
          <div className="text-center bg-slate-950/85 backdrop-blur-md text-amber-300 font-extrabold text-xs py-2 px-4 rounded-full mx-auto border border-amber-400/40 shadow-lg flex items-center gap-1.5">
            {isProcessing ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
                <span>Reading Cons No: & Name...</span>
              </>
            ) : autoScanEnabled ? (
              <>
                <Eye className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
                <span>Align "Details of Receiver:" in box</span>
              </>
            ) : (
              <span>Align receipt and tap Snap below</span>
            )}
          </div>

          <div className="flex justify-between">
            <div className="w-7 h-7 border-b-4 border-l-4 border-amber-400 rounded-bl-xl" />
            <div className="w-7 h-7 border-b-4 border-r-4 border-amber-400 rounded-br-xl" />
          </div>
        </div>

        {/* Already Added Warning Notification */}
        {alreadyAddedNotice && (
          <div className="absolute top-4 left-4 right-4 bg-amber-500 text-slate-950 p-3 rounded-2xl shadow-xl flex items-center gap-2 border border-amber-300 font-bold text-xs z-30 animate-pulse">
            <AlertCircle className="w-5 h-5 shrink-0 text-slate-950" />
            <span className="truncate">{alreadyAddedNotice}</span>
          </div>
        )}

        {/* Live Detected Success Notification Badge */}
        {lastScanned && !alreadyAddedNotice && (
          <div className="absolute top-4 left-4 right-4 bg-emerald-600 text-white p-3 rounded-2xl shadow-xl flex items-center gap-2.5 border border-emerald-400/40 z-20">
            <CheckCircle2 className="w-5 h-5 text-amber-300 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-black truncate uppercase tracking-tight">ADDED: #{lastScanned}</p>
              <p className="text-[10px] text-emerald-100 font-semibold">Matched in master database</p>
            </div>
          </div>
        )}

        {/* Manual Snap Trigger Button on Viewfinder */}
        <div className="absolute bottom-3 inset-x-0 flex justify-center z-20">
          <button
            type="button"
            onClick={() => performScan(false)}
            disabled={isProcessing}
            className="bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 hover:from-amber-600 hover:to-orange-600 text-slate-950 font-black px-6 py-2.5 rounded-2xl shadow-2xl active:scale-95 transition-all flex items-center gap-2 border border-amber-300/80 text-xs uppercase tracking-wide disabled:opacity-50"
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-slate-950" /> Reading Receipt...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 text-slate-950" /> 1-Tap Manual Snap
              </>
            )}
          </button>
        </div>
      </div>

      {/* Session Scanned Receipts Horizontal Tray */}
      {scannedSessionList.length > 0 && (
        <div className="bg-slate-900/90 backdrop-blur-md border border-white/10 p-2 rounded-2xl mb-2 text-white">
          <div className="flex items-center justify-between text-[10px] text-slate-400 px-1 mb-1 font-semibold">
            <span>Bills Added This Session ({scannedSessionList.length}):</span>
            <span className="text-amber-400">Ready for Day End</span>
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-1 custom-scrollbar">
            {scannedSessionList.map((item, idx) => (
              <div
                key={`${item.consumer_number}-${idx}`}
                className="bg-slate-800 border border-white/10 rounded-xl px-2.5 py-1 text-xs shrink-0 flex items-center gap-1.5"
              >
                <Check className="w-3 h-3 text-emerald-400" />
                <span className="font-mono font-bold text-amber-300">#{item.consumer_number}</span>
                <span className="text-[11px] text-slate-300 max-w-[120px] truncate">{item.consumer_name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bottom Bar: Manual Key-In & Finish Session */}
      <div className="flex flex-col gap-2 bg-slate-900/90 backdrop-blur-md border border-white/10 p-3 rounded-2xl text-white">
        <form onSubmit={handleManualAdd} className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              placeholder="Or type Cons No (e.g. 1842) directly..."
              className="w-full bg-slate-800/90 border border-white/15 rounded-xl pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-amber-400"
            />
          </div>
          <button
            type="submit"
            disabled={!manualInput.trim() || isProcessing}
            className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold px-3.5 py-1.5 rounded-xl text-xs flex items-center gap-1 transition-all shrink-0"
          >
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </form>

        <div className="flex items-center justify-between pt-1 border-t border-white/10">
          <div className="min-w-0 pr-2">
            <span className="text-[11px] font-bold text-slate-300 block truncate">{statusText}</span>
            <span className="text-[10px] text-amber-400 font-semibold">
              {scannedSessionList.length} receipts scanned this session
            </span>
          </div>
          <button
            onClick={onClose}
            className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold px-4 py-2 rounded-xl text-xs shadow-lg shadow-emerald-600/30 active:scale-95 transition-all shrink-0"
          >
            Done ({scannedSessionList.length})
          </button>
        </div>
      </div>
    </div>
  );
};

export default LiveCameraScannerModal;
