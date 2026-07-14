import React, { memo } from 'react';
import { type Consumer } from '../lib/db';
import { MapPin, Camera, ChevronRight, Phone, CheckCircle2, AlertCircle } from 'lucide-react';

interface ConsumerCardProps {
  consumer: Consumer;
  onClick: () => void;
}

export const ConsumerCard: React.FC<ConsumerCardProps> = ({ consumer, onClick }) => {
  const hasLocalLocation = consumer.has_location;
  const hasLocalPhoto = consumer.has_photos;

  let progress = 0;
  if (hasLocalLocation) progress += 50;
  if (hasLocalPhoto) progress += 50;

  return (
    <div 
      onClick={onClick}
      className="glass-card glass-card-hover rounded-2xl p-5 mb-4 active:scale-[0.98] transition-all cursor-pointer group relative overflow-hidden"
    >
      <div className="absolute top-4 right-4">
        {progress === 100 ? (
          <div className="bg-emerald-100 text-emerald-600 px-2 py-1 rounded-md text-xs font-bold flex items-center gap-1 shadow-sm border border-emerald-200">
            <CheckCircle2 size={12} /> Complete
          </div>
        ) : (
          <div className="bg-amber-100 text-amber-700 px-2 py-1 rounded-md text-xs font-bold flex items-center gap-1 shadow-sm border border-amber-200">
            <AlertCircle size={12} /> Pending
          </div>
        )}
      </div>

      <div className="flex justify-between items-start mb-3 mt-1">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-full bg-gradient-to-br from-blue-100 to-blue-50 flex items-center justify-center text-blue-600 shrink-0 shadow-sm border border-blue-200">
            <span className="font-bold text-lg">{consumer.consumer_name.charAt(0).toUpperCase()}</span>
          </div>
          <div>
            <span className="inline-block px-2 py-0.5 bg-slate-100 text-slate-600 text-[10px] font-bold rounded mb-1.5 uppercase tracking-wider">
              #{consumer.consumer_number}
            </span>
            <h3 className="font-bold text-slate-800 text-[17px] flex items-center gap-1.5 leading-tight pr-20">
              {consumer.consumer_name}
            </h3>
          </div>
        </div>
      </div>
      
      {/* Mobile Number */}
      <div className="flex items-center gap-2 text-sm text-slate-600 mb-3 font-medium ml-[56px]">
        <Phone size={14} className="text-slate-400" />
        {consumer.mobile}
      </div>

      <p className="text-sm text-slate-500 mb-5 line-clamp-2 leading-relaxed ml-[56px] pr-8">{consumer.address}</p>
      
      <div className="flex justify-between items-end ml-[56px] mb-1">
        <div className="flex gap-2">
          <div className={`flex items-center justify-center w-8 h-8 rounded-full shadow-sm border ${hasLocalLocation ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-slate-50 text-slate-400 border-slate-200 group-hover:bg-amber-50 group-hover:text-amber-500 group-hover:border-amber-200 transition-colors'}`} title={hasLocalLocation ? 'GPS Saved' : 'Needs GPS'}>
            <MapPin size={14} />
          </div>
          
          <div className={`flex items-center justify-center w-8 h-8 rounded-full shadow-sm border ${hasLocalPhoto ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-slate-50 text-slate-400 border-slate-200 group-hover:bg-amber-50 group-hover:text-amber-500 group-hover:border-amber-200 transition-colors'}`} title={hasLocalPhoto ? 'Photo Saved' : 'Needs Photo'}>
            <Camera size={14} />
          </div>
        </div>
        
        <div className="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center group-hover:bg-blue-50 transition-colors shadow-sm border border-slate-200 group-hover:border-blue-200">
          <ChevronRight size={18} className="text-slate-400 group-hover:text-blue-600 transition-colors" />
        </div>
      </div>

      {/* Progress Bar */}
      <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-slate-100">
        <div 
          className={`h-full transition-all duration-1000 ease-out ${progress === 100 ? 'bg-gradient-to-r from-emerald-400 to-emerald-500' : progress === 50 ? 'bg-gradient-to-r from-amber-400 to-amber-500' : 'bg-transparent'}`}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
};
