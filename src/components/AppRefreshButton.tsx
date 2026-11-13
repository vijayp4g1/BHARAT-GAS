import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { RefreshCw, Settings, X, Loader2, AlertTriangle, WifiOff, ShieldCheck } from 'lucide-react';
import { clearAppCacheAndReload } from '../lib/appCache';

/* -------------------------------------------------------------------------- */
/*  Modal                                                                     */
/* -------------------------------------------------------------------------- */

interface AppRefreshModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AppRefreshModal: React.FC<AppRefreshModalProps> = ({ isOpen, onClose }) => {
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState('');
  const [online, setOnline] = useState<boolean>(() => navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setIsBusy(false);
    setError('');
    setOnline(navigator.onLine);
  }, [isOpen]);

  if (!isOpen) return null;

  const handleRefresh = async () => {
    setError('');
    setIsBusy(true);
    try {
      await clearAppCacheAndReload();
      // The page navigates away here.
    } catch (err: any) {
      setError(err?.message || 'Could not refresh the app. Please try again.');
      setIsBusy(false);
    }
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="app-refresh-title"
      className="fixed inset-0 z-[4000] bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4"
    >
      <div className="bg-slate-900 border border-slate-700 rounded-3xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3 p-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-sky-500/20 border border-sky-400/40 text-sky-300 flex items-center justify-center shrink-0">
              <RefreshCw className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 id="app-refresh-title" className="text-sm font-black text-white">
                Refresh App / Clear Cache
              </h3>
              <p className="text-[10px] text-slate-400">
                Fixes old screens after an update
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isBusy}
            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 disabled:opacity-40"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3 text-xs text-slate-300 leading-relaxed">
          <p>
            Use this when the app keeps showing old screens, an old bug, or a fix that should
            already be live.
          </p>

          <div className="rounded-xl bg-emerald-950/40 border border-emerald-500/30 p-2.5">
            <p className="flex items-center gap-1.5 font-bold text-emerald-300 text-[11px] mb-1">
              <ShieldCheck className="w-3.5 h-3.5" /> These are kept
            </p>
            <p className="text-[11px] text-emerald-100/90">
              Everything in your app data: login, saved bills, unsaved drafts, scanned-bill audit
              log, archived/no-supply flags, app settings, and offline bill data (IndexedDB).
            </p>
          </div>

          <div className="rounded-xl bg-slate-950/70 border border-slate-700 p-2.5">
            <p className="font-bold text-slate-200 text-[11px] mb-1">These are cleared</p>
            <p className="text-[11px] text-slate-400">
              Only the downloaded app files (JavaScript/CSS/images) and the old service worker.
              They are re-downloaded immediately. No saved data or drafts are deleted.
            </p>
          </div>

          <div className="rounded-xl bg-amber-950/30 border border-amber-500/30 p-2.5">
            <p className="flex items-center gap-1.5 font-bold text-amber-300 text-[11px] mb-1">
              <AlertTriangle className="w-3.5 h-3.5" /> Chrome limitation
            </p>
            <p className="text-[11px] text-amber-100/90">
              A website cannot clear Chrome&apos;s entire browser cache. This clears this app&apos;s
              cache and service worker. If Chrome itself is stuck, use Chrome → Settings → Site
              settings → this site → <b>Clear &amp; reset</b>. That also removes unsaved drafts.
            </p>
          </div>

          {!online && (
            <div className="rounded-xl bg-rose-950/40 border border-rose-500/40 p-2.5 flex items-center gap-2 text-rose-200 font-bold text-[11px]">
              <WifiOff className="w-4 h-4 shrink-0" />
              Connect to the internet first — the fresh app needs to download.
            </div>
          )}

          {error && (
            <div className="rounded-xl bg-rose-950/40 border border-rose-500/40 p-2.5 text-rose-200 font-bold text-[11px]">
              {error}
            </div>
          )}
        </div>

        <div className="p-4 pt-0 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isBusy}
            className="flex-1 bg-slate-800 hover:bg-slate-700 border border-white/15 text-slate-200 font-bold py-2.5 rounded-xl text-xs disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isBusy || !online}
            className="flex-1 bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white font-black py-2.5 rounded-xl text-xs flex items-center justify-center gap-1.5 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isBusy ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Refreshing…</span>
              </>
            ) : (
              <>
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Refresh App</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

/* -------------------------------------------------------------------------- */
/*  Trigger button                                                            */
/* -------------------------------------------------------------------------- */

interface AppRefreshButtonProps {
  /** Classes for the trigger button itself. */
  className?: string;
  title?: string;
  variant?: 'icon' | 'menu' | 'link';
  label?: string;
  /** Called before opening (e.g. to close a dropdown menu). */
  onOpen?: () => void;
}

export const AppRefreshButton: React.FC<AppRefreshButtonProps> = ({
  className = '',
  title = 'Refresh app / clear cache',
  variant = 'icon',
  label = 'Refresh App / Clear Cache',
  onOpen,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  const open = () => {
    onOpen?.();
    setIsOpen(true);
  };

  return (
    <>
      <button type="button" onClick={open} className={className} title={title}>
        {variant === 'icon' ? (
          <Settings className="w-4 h-4" />
        ) : (
          <>
            <RefreshCw className={variant === 'menu' ? 'w-4 h-4' : 'w-3 h-3'} />
            <span>{label}</span>
          </>
        )}
      </button>
      <AppRefreshModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  );
};

export default AppRefreshButton;
