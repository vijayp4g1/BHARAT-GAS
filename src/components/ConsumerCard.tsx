import React from 'react';
import { type Consumer } from '../lib/db';
import db from '../lib/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { MapPin, Camera, ChevronRight, User, Phone } from 'lucide-react';

interface ConsumerCardProps {
  consumer: Consumer;
  onClick: () => void;
}

export const ConsumerCard: React.FC<ConsumerCardProps> = ({ consumer, onClick }) => {
  const hasLocalLocation = consumer.has_location;
  const hasLocalPhoto = consumer.has_photos;

  return (
    <div 
      onClick={onClick}
      className="glass-card glass-card-hover rounded-2xl p-5 mb-4 active:scale-[0.98] transition-all cursor-pointer group"
    >
      <div className="flex justify-between items-start mb-3">
        <div>
          <span className="inline-block px-2.5 py-1 bg-blue-50 text-blue-700 text-xs font-bold rounded-lg mb-2.5 border border-blue-100/50">
            #{consumer.consumer_number}
          </span>
          <h3 className="font-bold text-slate-800 text-lg flex items-center gap-1.5">
            <User size={18} className="text-slate-400 group-hover:text-blue-500 transition-colors" />
            {consumer.consumer_name}
          </h3>
        </div>
        <div className="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center group-hover:bg-blue-50 transition-colors">
          <ChevronRight size={18} className="text-slate-400 group-hover:text-blue-500 transition-colors" />
        </div>
      </div>
      
      {/* Mobile Number */}
      <div className="flex items-center gap-2 text-sm text-slate-600 mb-3 font-medium">
        <Phone size={14} className="text-slate-400" />
        {consumer.mobile}
      </div>

      <p className="text-sm text-slate-500 mb-4 line-clamp-2 leading-relaxed">{consumer.address}</p>
      
      <div className="flex gap-3">
        <div className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full shadow-sm border ${hasLocalLocation ? 'bg-emerald-50 text-emerald-700 border-emerald-100/50' : 'bg-amber-50 text-amber-700 border-amber-100/50'}`}>
          <MapPin size={12} className={hasLocalLocation ? 'text-emerald-500' : 'text-amber-500'} />
          {hasLocalLocation ? 'GPS Saved' : 'Needs GPS'}
        </div>
        
        <div className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full shadow-sm border ${hasLocalPhoto ? 'bg-emerald-50 text-emerald-700 border-emerald-100/50' : 'bg-amber-50 text-amber-700 border-amber-100/50'}`}>
          <Camera size={12} className={hasLocalPhoto ? 'text-emerald-500' : 'text-amber-500'} />
          {hasLocalPhoto ? 'Photo Saved' : 'Needs Photo'}
        </div>
      </div>
    </div>
  );
};
