import React, { useState } from 'react';
import { MapPin, X, ShieldAlert, RefreshCw, Smartphone, Globe, Lock, Settings, ChevronRight } from 'lucide-react';

interface LocationPermissionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRetry?: () => void;
  errorMessage?: string | null;
}

export const LocationPermissionModal: React.FC<LocationPermissionModalProps> = ({
  isOpen,
  onClose,
  onRetry,
  errorMessage,
}) => {
  const [activeTab, setActiveTab] = useState<'chrome' | 'safari' | 'device'>('chrome');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full overflow-hidden border border-slate-100 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="bg-gradient-to-r from-red-500 to-rose-600 p-5 text-white relative">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 bg-white/20 hover:bg-white/30 rounded-full transition-colors"
          >
            <X size={18} />
          </button>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center border border-white/30">
              <ShieldAlert size={24} className="text-white" />
            </div>
            <div>
              <h3 className="font-extrabold text-lg leading-tight">Location Permission Blocked</h3>
              <p className="text-xs text-rose-100 mt-0.5">How to allow GPS access on your phone</p>
            </div>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="p-5 overflow-y-auto space-y-4 text-slate-700 flex-1">
          {errorMessage && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs font-semibold text-red-700 flex items-start gap-2">
              <ShieldAlert size={16} className="mt-0.5 shrink-0 text-red-500" />
              <span>{errorMessage}</span>
            </div>
          )}

          <p className="text-xs text-slate-500 font-medium">
            Your browser or phone has blocked location access for this site. Follow the quick steps below for your browser to enable it:
          </p>

          {/* Browser Selection Tabs */}
          <div className="grid grid-cols-3 gap-1 bg-slate-100 p-1 rounded-xl text-xs font-bold">
            <button
              onClick={() => setActiveTab('chrome')}
              className={`py-2 rounded-lg transition-all flex items-center justify-center gap-1 ${
                activeTab === 'chrome'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Globe size={14} /> Chrome
            </button>
            <button
              onClick={() => setActiveTab('safari')}
              className={`py-2 rounded-lg transition-all flex items-center justify-center gap-1 ${
                activeTab === 'safari'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Smartphone size={14} /> Safari
            </button>
            <button
              onClick={() => setActiveTab('device')}
              className={`py-2 rounded-lg transition-all flex items-center justify-center gap-1 ${
                activeTab === 'device'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Settings size={14} /> Phone GPS
            </button>
          </div>

          {/* Tab 1: Android / Chrome */}
          {activeTab === 'chrome' && (
            <div className="space-y-3 bg-slate-50 p-4 rounded-2xl border border-slate-200 text-xs">
              <h4 className="font-bold text-slate-800 flex items-center gap-1.5">
                <Lock size={14} className="text-blue-600" /> Enable in Google Chrome (Android / PC)
              </h4>
              <ol className="space-y-2 text-slate-600 pl-1">
                <li className="flex items-start gap-2">
                  <span className="bg-blue-100 text-blue-700 font-black rounded-full w-5 h-5 flex items-center justify-center shrink-0 text-[10px]">1</span>
                  <span>Look at the top left of your browser address bar next to the website URL.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="bg-blue-100 text-blue-700 font-black rounded-full w-5 h-5 flex items-center justify-center shrink-0 text-[10px]">2</span>
                  <span>Tap the <strong>Padlock icon 🔒</strong> or <strong>Tune icon 🛠️</strong>.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="bg-blue-100 text-blue-700 font-black rounded-full w-5 h-5 flex items-center justify-center shrink-0 text-[10px]">3</span>
                  <span>Tap <strong>Permissions</strong> or <strong>Site settings</strong>.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="bg-blue-100 text-blue-700 font-black rounded-full w-5 h-5 flex items-center justify-center shrink-0 text-[10px]">4</span>
                  <span>Change <strong>Location</strong> setting from <em>Blocked</em> to <strong>Allow</strong>.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="bg-blue-100 text-blue-700 font-black rounded-full w-5 h-5 flex items-center justify-center shrink-0 text-[10px]">5</span>
                  <span>Return here and tap <strong>Try Capture Again</strong> below.</span>
                </li>
              </ol>
            </div>
          )}

          {/* Tab 2: iPhone / Safari */}
          {activeTab === 'safari' && (
            <div className="space-y-3 bg-slate-50 p-4 rounded-2xl border border-slate-200 text-xs">
              <h4 className="font-bold text-slate-800 flex items-center gap-1.5">
                <Smartphone size={14} className="text-blue-600" /> Enable in iOS Safari (iPhone / iPad)
              </h4>
              <ol className="space-y-2 text-slate-600 pl-1">
                <li className="flex items-start gap-2">
                  <span className="bg-blue-100 text-blue-700 font-black rounded-full w-5 h-5 flex items-center justify-center shrink-0 text-[10px]">1</span>
                  <span>Tap the <strong>"aA"</strong> button in the left of the Safari search bar.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="bg-blue-100 text-blue-700 font-black rounded-full w-5 h-5 flex items-center justify-center shrink-0 text-[10px]">2</span>
                  <span>Select <strong>Website Settings</strong>.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="bg-blue-100 text-blue-700 font-black rounded-full w-5 h-5 flex items-center justify-center shrink-0 text-[10px]">3</span>
                  <span>Tap <strong>Location</strong> and select <strong>Allow</strong> or <strong>Ask</strong>.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="bg-blue-100 text-blue-700 font-black rounded-full w-5 h-5 flex items-center justify-center shrink-0 text-[10px]">4</span>
                  <span>If still blocked, open iPhone <strong>Settings</strong> app &gt; <strong>Privacy &amp; Security</strong> &gt; <strong>Location Services</strong> &gt; <strong>Safari Websites</strong> &gt; <strong>While Using the App</strong>.</span>
                </li>
              </ol>
            </div>
          )}

          {/* Tab 3: Device Settings */}
          {activeTab === 'device' && (
            <div className="space-y-3 bg-slate-50 p-4 rounded-2xl border border-slate-200 text-xs">
              <h4 className="font-bold text-slate-800 flex items-center gap-1.5">
                <Settings size={14} className="text-blue-600" /> Turn on Phone GPS / Location Services
              </h4>
              <ol className="space-y-2 text-slate-600 pl-1">
                <li className="flex items-start gap-2">
                  <span className="bg-blue-100 text-blue-700 font-black rounded-full w-5 h-5 flex items-center justify-center shrink-0 text-[10px]">1</span>
                  <span>Swipe down from top of your phone screen to open <strong>Quick Settings</strong> panel.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="bg-blue-100 text-blue-700 font-black rounded-full w-5 h-5 flex items-center justify-center shrink-0 text-[10px]">2</span>
                  <span>Ensure <strong>Location / GPS icon 📍</strong> is turned <strong>ON</strong>.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="bg-blue-100 text-blue-700 font-black rounded-full w-5 h-5 flex items-center justify-center shrink-0 text-[10px]">3</span>
                  <span>If outdoors, stand away from tall metallic structures for better satellite connection.</span>
                </li>
              </ol>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-slate-50 border-t border-slate-100 flex flex-col sm:flex-row items-center gap-2">
          {onRetry && (
            <button
              onClick={() => {
                onClose();
                onRetry();
              }}
              className="w-full sm:flex-1 py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20 transition-colors"
            >
              <RefreshCw size={14} /> Try Capture Again
            </button>
          )}
          <button
            onClick={onClose}
            className="w-full sm:w-auto py-3 px-5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-xl font-bold text-xs transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
