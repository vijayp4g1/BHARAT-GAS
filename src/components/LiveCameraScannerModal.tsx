import React, { useEffect, useRef, useState } from 'react';
import { X, Camera, Flashlight, CheckCircle2, AlertCircle, RefreshCw, Zap, Volume2, Sparkles, Loader2, Key, Search, Plus } from 'lucide-react';
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
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.25);
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
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [scanEngine, setScanEngine] = useState<'LOCAL' | 'GEMINI'>('LOCAL');
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [alreadyAddedNotice, setAlreadyAddedNotice] = useState<string | null>(null);
  const [torchOn, setTorchOn] = useState<boolean>(false);
  const [scannedCount, setScannedCount] = useState<number>(0);
  const [statusText, setStatusText] = useState<string>('Align Cons No: inside box...');
  const [manualInput, setManualInput] = useState<string>('');

  const scannedSetRef = useRef<Set<string>>(new Set(existingNumbers.map((n) => n.toLowerCase())));

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
      setIsScanning(true);
      setStatusText('Camera Active — Ready to scan');
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
    setIsScanning(false);
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
  const processMatchedConsumerNumber = async (rawNum: string, fallbackName?: string) => {
    const cleanNum = cleanAndNormalizeDigits(rawNum);

    if (!cleanNum || cleanNum.length < 1 || cleanNum.length > 10) {
      return false;
    }

    if (DISTRIBUTOR_BLACKLIST.has(cleanNum)) {
      toast.error(`Ignored helpline/distributor number #${cleanNum}.`);
      return false;
    }

    const localMatch = await db.consumers
      .where('consumer_number')
      .equalsIgnoreCase(cleanNum)
      .first();

    if (localMatch) {
      const isAlreadyAdded = scannedSetRef.current.has(localMatch.consumer_number.toLowerCase());
      if (isAlreadyAdded) {
        setAlreadyAddedNotice(`Consumer #${localMatch.consumer_number} (${localMatch.consumer_name}) is ALREADY in your delivery list!`);
        setTimeout(() => setAlreadyAddedNotice(null), 3000);
        toast.success('Found but already added.');
        return true;
      }

      // Success! Consumer number matched in master database
      scannedSetRef.current.add(localMatch.consumer_number.toLowerCase());
      setAlreadyAddedNotice(null);

      if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
      playSuccessBeep();

      setLastScanned(`${localMatch.consumer_number} - ${localMatch.consumer_name}`);
      setScannedCount((prev) => prev + 1);

      onConsumerScanned({
        consumer_number: localMatch.consumer_number,
        consumer_name: localMatch.consumer_name,
        address: localMatch.address,
        mobile: localMatch.mobile,
        found: true,
      });

      toast.success(`Scanned: #${localMatch.consumer_number} (${localMatch.consumer_name})!`);
      return true;
    } else {
      // Check remote database if online
      let remoteMatch: any = null;
      if (navigator.onLine) {
        try {
          const { data } = await supabase
            .from('consumers')
            .select('consumer_number, consumer_name, address, mobile')
            .eq('consumer_number', cleanNum)
            .maybeSingle();
          remoteMatch = data;
        } catch (e) {
          console.error('Remote lookup error:', e);
        }
      }

      const targetName = remoteMatch?.consumer_name || fallbackName?.trim().toUpperCase() || 'NEW CUSTOMER';
      const targetAddress = remoteMatch?.address || 'Registered via Scanner';
      const targetMobile = remoteMatch?.mobile || '';

      // Auto-create and save new consumer into local IndexedDB
      const newConsumerRecord: Consumer = {
        id: `cons_${cleanNum}_${Date.now()}`,
        consumer_number: cleanNum,
        consumer_name: targetName,
        mobile: targetMobile,
        address: targetAddress,
        verification_status: remoteMatch ? 'Verified' : 'Pending',
        created_at: new Date().toISOString(),
        searchWords: [
          ...targetName.toLowerCase().split(/\s+/),
          cleanNum.toLowerCase(),
        ],
      };

      await db.consumers.put(newConsumerRecord).catch((err: any) => console.error('Dexie put error:', err));

      // Auto-save to Supabase remote database if online and not existing
      if (navigator.onLine && !remoteMatch) {
        try {
          await supabase
            .from('consumers')
            .insert([
              {
                consumer_number: cleanNum,
                consumer_name: targetName,
                address: targetAddress,
                verification_status: 'Pending',
              },
            ]);
          toast.success(`Synced #${cleanNum} to cloud database!`);
        } catch (err: any) {
          console.error('Supabase auto-insert error:', err);
        }
      }

      const isAlreadyAdded = scannedSetRef.current.has(cleanNum.toLowerCase());
      if (isAlreadyAdded) {
        setAlreadyAddedNotice(`Consumer #${cleanNum} (${targetName}) is ALREADY in your delivery list!`);
        setTimeout(() => setAlreadyAddedNotice(null), 3000);
        toast.success('Found but already added.');
        return true;
      }

      scannedSetRef.current.add(cleanNum.toLowerCase());
      setAlreadyAddedNotice(null);

      if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
      playSuccessBeep();

      setLastScanned(`${cleanNum} - ${targetName}`);
      setScannedCount((prev) => prev + 1);

      onConsumerScanned({
        consumer_number: cleanNum,
        consumer_name: `${targetName} (New)`,
        address: targetAddress,
        mobile: targetMobile,
        found: true,
      });

      toast.success(`✨ Registered New Customer #${cleanNum} (${targetName})!`, { duration: 4000 });
      return true;
    }
  };

  // Main Scan Trigger (Supports Native Barcode, Local Offline Tesseract, and Gemini AI Vision)
  const handleSnap = async () => {
    if (!videoRef.current || !canvasRef.current) return;

    setIsProcessing(true);
    toast.loading('Processing receipt...', { id: 'scan-snap' });

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    if (video.videoWidth > 0 && ctx) {
      const maxDim = 1200;
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

      // Method 1: Try Native Browser Barcode Detector if available
      if ('BarcodeDetector' in window) {
        try {
          const barcodeDetector = new (window as any).BarcodeDetector({
            formats: ['code_128', 'code_39', 'qr_code', 'ean_13', 'upc_a'],
          });
          const barcodes = await barcodeDetector.detect(canvas);
          if (barcodes && barcodes.length > 0) {
            for (const barcode of barcodes) {
              const rawVal = barcode.rawValue || '';
              const matched = await processMatchedConsumerNumber(rawVal);
              if (matched) {
                toast.success('Barcode scanned successfully!', { id: 'scan-snap' });
                setIsProcessing(false);
                return;
              }
            }
          }
        } catch (e) {
          console.warn('Native BarcodeDetector attempt skipped:', e);
        }
      }

      // Method 2: Local Offline Tesseract OCR Engine
      if (scanEngine === 'LOCAL') {
        try {
          toast.loading('Local Offline OCR scanning image...', { id: 'scan-snap' });
          const preprocessed = preprocessCanvasForOcr(canvas);
          const { data } = await Tesseract.recognize(preprocessed, 'eng');
          const fullText = data.text || '';

          // Look for Cons No / Consumer patterns first
          const consNoMatches = Array.from(fullText.matchAll(/(?:CONS|CONSUMER|CON|NO|C\/N)\s*[:\-\#\.]*\s*(\d{1,10})/gi));
          let success = false;

          for (const match of consNoMatches) {
            const numCandidate = match[1];
            if (numCandidate) {
              const isOk = await processMatchedConsumerNumber(numCandidate);
              if (isOk) {
                success = true;
                break;
              }
            }
          }

          // If no explicit Cons No label found, check all standalone digit sequences against 31k database
          if (!success) {
            const digitMatches = fullText.match(/\b\d{1,10}\b/g) || [];
            for (const dig of digitMatches) {
              const isOk = await processMatchedConsumerNumber(dig);
              if (isOk) {
                success = true;
                break;
              }
            }
          }

          if (success) {
            toast.success('Local OCR scan complete!', { id: 'scan-snap' });
            setIsProcessing(false);
            return;
          } else {
            toast.error('Cons No: not recognized by Local OCR. Try AI Gemini mode or type below.', { id: 'scan-snap', duration: 4000 });
          }
        } catch (err: any) {
          console.error('Tesseract local OCR error:', err);
          toast.error(`Local OCR error: ${err.message || 'failed'}. Try Gemini mode.`, { id: 'scan-snap' });
        }
      } else {
        // Method 3: Gemini Cloud AI Vision
        try {
          toast.loading('AI Gemini vision parsing receipt...', { id: 'scan-snap' });
          const imgDataUrl = canvas.toDataURL('image/jpeg', 0.80);
          const geminiRes = await scanBillWithGemini(imgDataUrl);

          if (geminiRes.error) {
            toast.error(`AI Error: ${geminiRes.error}`, { id: 'scan-snap', duration: 4000 });
            setIsProcessing(false);
            return;
          }

          if (geminiRes.found && geminiRes.consumerNumber) {
            const ok = await processMatchedConsumerNumber(geminiRes.consumerNumber, geminiRes.consumerName);
            if (ok) {
              toast.success('AI Vision snap matched successfully!', { id: 'scan-snap' });
              setIsProcessing(false);
              return;
            }
          } else {
            toast.error('Cons No: not detected in camera view. Reposition receipt or type below.', { id: 'scan-snap', duration: 4000 });
          }
        } catch (err: any) {
          console.error('Gemini snap OCR failed:', err);
          toast.error(`AI snap failed: ${err.message || 'unknown error'}`, { id: 'scan-snap' });
        }
      }
    } else {
      toast.error('Camera feed is not ready yet', { id: 'scan-snap' });
    }

    setIsProcessing(false);
  };

  // Method 4: Instant Manual Key-In Handler
  const handleManualAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualInput.trim()) return;

    setIsProcessing(true);
    const cleanNum = cleanAndNormalizeDigits(manualInput);

    if (!cleanNum) {
      toast.error('Please enter valid digits for Consumer Number.');
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
      {/* Top Header Bar with Engine Selector */}
      <div className="flex flex-col gap-2 z-10 bg-slate-900/90 backdrop-blur-md border border-white/10 p-3 rounded-2xl text-white shadow-xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-amber-500/20 border border-amber-400/30 flex items-center justify-center text-amber-400">
              <Zap className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold tracking-tight">Multi-Method Receipt Scanner</h2>
              <p className="text-[11px] text-slate-400">Tesseract OCR • Native Barcode • Gemini AI</p>
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

        {/* Engine Toggle Buttons */}
        <div className="grid grid-cols-2 gap-2 pt-1 border-t border-white/10">
          <button
            type="button"
            onClick={() => setScanEngine('LOCAL')}
            className={`py-1.5 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
              scanEngine === 'LOCAL'
                ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/30'
                : 'bg-white/5 text-slate-300 hover:bg-white/10'
            }`}
          >
            <Zap className="w-3.5 h-3.5" /> ⚡ Local OCR (Offline)
          </button>

          <button
            type="button"
            onClick={() => setScanEngine('GEMINI')}
            className={`py-1.5 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
              scanEngine === 'GEMINI'
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/30'
                : 'bg-white/5 text-slate-300 hover:bg-white/10'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" /> ✨ Gemini AI Vision
          </button>
        </div>
      </div>

      {/* Viewfinder Video Stream Container */}
      <div className="relative flex-1 my-2 rounded-3xl overflow-hidden border border-white/20 shadow-2xl bg-black flex items-center justify-center">
        <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
        <canvas ref={canvasRef} className="hidden" />

        {/* Target Box */}
        <div className="absolute inset-x-4 top-6 bottom-24 border-2 border-dashed border-amber-400/80 rounded-3xl pointer-events-none flex flex-col justify-between p-4 shadow-[0_0_60px_rgba(245,158,11,0.25)]">
          <div className="flex justify-between">
            <div className="w-6 h-6 border-t-4 border-l-4 border-amber-400 rounded-tl-lg" />
            <div className="w-6 h-6 border-t-4 border-r-4 border-amber-400 rounded-tr-lg" />
          </div>

          <div className="text-center bg-slate-950/85 backdrop-blur-md text-amber-300 font-extrabold text-xs py-2 px-5 rounded-full mx-auto border border-amber-400/40 shadow-lg">
            📷 Point camera at receipt ({scanEngine === 'LOCAL' ? 'Local Fast OCR' : 'Gemini AI Vision'})
          </div>

          <div className="flex justify-between">
            <div className="w-6 h-6 border-b-4 border-l-4 border-amber-400 rounded-bl-lg" />
            <div className="w-6 h-6 border-b-4 border-r-4 border-amber-400 rounded-br-lg" />
          </div>
        </div>

        {/* Already Added Alert Badge */}
        {alreadyAddedNotice && (
          <div className="absolute top-4 left-4 right-4 bg-amber-500 text-slate-950 p-3 rounded-2xl shadow-xl flex items-center gap-2 border border-amber-300 font-bold text-xs z-30 animate-pulse">
            <AlertCircle className="w-5 h-5 shrink-0 text-slate-950" />
            <span className="truncate">{alreadyAddedNotice}</span>
          </div>
        )}

        {/* Live Detected Badge Alert */}
        {lastScanned && !alreadyAddedNotice && (
          <div className="absolute top-4 left-4 right-4 bg-emerald-600 text-white p-3.5 rounded-2xl shadow-xl flex items-center gap-2 border border-emerald-400/40 animate-bounce z-20">
            <CheckCircle2 className="w-6 h-6 text-amber-300 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-black truncate uppercase tracking-tight">ADDED: #{lastScanned}</p>
              <p className="text-[10px] text-emerald-100 font-semibold">Matched 31k master database</p>
            </div>
          </div>
        )}

        {/* Snap Trigger Button on Viewfinder */}
        <div className="absolute bottom-4 inset-x-0 flex justify-center z-20">
          <button
            type="button"
            onClick={handleSnap}
            disabled={isProcessing}
            className={`font-black px-6 py-3 rounded-2xl shadow-2xl active:scale-95 transition-all flex items-center gap-2 border text-xs tracking-wide uppercase ${
              scanEngine === 'LOCAL'
                ? 'bg-gradient-to-r from-emerald-500 to-teal-500 text-slate-950 border-emerald-300 shadow-emerald-500/40'
                : 'bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 text-slate-950 border-amber-300 shadow-amber-500/40'
            }`}
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-slate-950" /> Scanning Receipt...
              </>
            ) : scanEngine === 'LOCAL' ? (
              <>
                <Zap className="w-4 h-4 text-slate-950" /> 1-Tap Fast Local OCR
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 text-slate-950" /> 1-Tap AI Snap
              </>
            )}
          </button>
        </div>
      </div>

      {/* Bottom Control Bar: Quick Manual Key-In & Session Counter */}
      <div className="flex flex-col gap-2 bg-slate-900/90 backdrop-blur-md border border-white/10 p-3 rounded-2xl text-white">
        <form onSubmit={handleManualAdd} className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
            <input
              type="text"
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              placeholder="Or type Cons No (e.g. 1842) directly here..."
              className="w-full bg-slate-800/90 border border-white/15 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-amber-400"
            />
          </div>
          <button
            type="submit"
            disabled={!manualInput.trim() || isProcessing}
            className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold px-4 py-2 rounded-xl text-xs flex items-center gap-1 transition-all shrink-0"
          >
            <Plus className="w-4 h-4" /> Add
          </button>
        </form>

        <div className="flex items-center justify-between pt-1 border-t border-white/10">
          <div>
            <span className="text-[11px] font-bold text-slate-300 block">{statusText}</span>
            <span className="text-[10px] text-amber-400 font-semibold">
              {scannedCount} bills added this session
            </span>
          </div>
          <button
            onClick={onClose}
            className="bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-bold px-4 py-2 rounded-xl text-xs shadow-lg shadow-emerald-600/30 active:scale-95 transition-all"
          >
            Done ({scannedCount})
          </button>
        </div>
      </div>
    </div>
  );
};
