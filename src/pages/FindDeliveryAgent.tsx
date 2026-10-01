import React, { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { 
  Search, ArrowLeft, MapPin, Users, Phone, MessageCircle, 
  Building2, CheckCircle2, ChevronRight, 
  Flame, Navigation, Sparkles, Filter, Copy, Check,
  ExternalLink, Compass, Layers, ShieldCheck, Map
} from 'lucide-react';
import { ManagerBottomNav } from '../components/ManagerBottomNav';
import { AgentBottomNav } from '../components/AgentBottomNav';
import { 
  DELIVERY_AREAS, 
  TOP_COLONIES, 
  POPULAR_COLONIES, 
  AGENT_NAMES,
  searchPreIndexedAreas, 
  searchLiveConsumersByLocation,
  getAgentNameFromArea,
  type AreaInfo,
  type ColonyMatch,
  type LiveSearchResult
} from '../data/areaColonies';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';

export const FindDeliveryAgent: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const isAgent = location.pathname.startsWith('/agent');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedAgentFilter, setSelectedAgentFilter] = useState<string>('ALL');
  const [activeTab, setActiveTab] = useState<'search' | 'directory' | 'colonies_az'>('search');
  const [selectedArea, setSelectedArea] = useState<AreaInfo | null>(null);
  const [selectedColonyModal, setSelectedColonyModal] = useState<ColonyMatch | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [liveResults, setLiveResults] = useState<LiveSearchResult[]>([]);
  const [isLiveSearching, setIsLiveSearching] = useState(false);
  const [agentsList, setAgentsList] = useState<any[]>([]);

  // Search Debounce
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedQuery(searchQuery.trim());
    }, 250);
    return () => clearTimeout(handler);
  }, [searchQuery]);

  // Fetch registered agents from Supabase
  useEffect(() => {
    const fetchAgents = async () => {
      try {
        const { data } = await supabase.from('agents').select('id, name, username, phone, status');
        if (data) setAgentsList(data);
      } catch (e) {
        console.error('Error loading agents:', e);
      }
    };
    fetchAgents();
  }, []);

  // Match agent record for an area code
  const getAgentContact = (agentName: string) => {
    const clean = agentName.toLowerCase().replace(/[^a-z]/g, '');
    return agentsList.find(a => {
      const aName = a.name.toLowerCase().replace(/[^a-z]/g, '');
      const aUser = a.username.toLowerCase().replace(/[^a-z]/g, '');
      return clean.includes(aName) || aName.includes(clean) || clean.includes(aUser);
    });
  };

  // Copy Area Code to clipboard helper
  const handleCopyCode = (code: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    toast.success(`Copied area code: ${code}`);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  // Pre-indexed search results
  const preIndexedMatches = useMemo(() => {
    const filterAgent = selectedAgentFilter === 'ALL' ? undefined : selectedAgentFilter;
    return searchPreIndexedAreas(debouncedQuery, filterAgent);
  }, [debouncedQuery, selectedAgentFilter]);

  // Trigger live search against database
  useEffect(() => {
    if (debouncedQuery.length >= 3 && activeTab === 'search') {
      setIsLiveSearching(true);
      searchLiveConsumersByLocation(debouncedQuery)
        .then(results => {
          setLiveResults(results);
        })
        .finally(() => {
          setIsLiveSearching(false);
        });
    } else {
      setLiveResults([]);
    }
  }, [debouncedQuery, activeTab]);

  // A-Z grouped colonies
  const coloniesAlphabetical = useMemo(() => {
    const groups: Record<string, ColonyMatch[]> = {};
    const filtered = selectedAgentFilter === 'ALL' 
      ? TOP_COLONIES 
      : TOP_COLONIES.filter(c => {
          const pAgent = getAgentNameFromArea(c.primaryArea);
          return pAgent.toLowerCase() === selectedAgentFilter.toLowerCase();
        });

    filtered.forEach(c => {
      const letter = c.name.charAt(0).toUpperCase();
      if (!groups[letter]) groups[letter] = [];
      groups[letter].push(c);
    });

    return Object.keys(groups).sort().map(letter => ({
      letter,
      colonies: groups[letter].sort((a,b) => a.name.localeCompare(b.name))
    }));
  }, [selectedAgentFilter]);

  // Color generator for Area Badges
  const getAreaBadgeColor = (areaCode: string) => {
    const colors = [
      'bg-blue-50 text-blue-700 border-blue-200',
      'bg-indigo-50 text-indigo-700 border-indigo-200',
      'bg-violet-50 text-violet-700 border-violet-200',
      'bg-emerald-50 text-emerald-700 border-emerald-200',
      'bg-amber-50 text-amber-700 border-amber-200',
      'bg-cyan-50 text-cyan-700 border-cyan-200',
      'bg-teal-50 text-teal-700 border-teal-200',
      'bg-rose-50 text-rose-700 border-rose-200'
    ];
    let hash = 0;
    for (let i = 0; i < areaCode.length; i++) {
      hash = areaCode.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col pb-32 md:pb-16">
      {/* Header */}
      <header className="glass-header text-white px-3 py-3 sm:px-5 sm:py-4 sticky top-0 z-30 shadow-md">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <button 
              onClick={() => {
                if (window.history.length > 2) {
                  navigate(-1);
                } else {
                  navigate(isAgent ? '/agent/search' : '/manager/dashboard');
                }
              }} 
              className="p-2 bg-white/10 hover:bg-white/20 rounded-xl transition-colors active:scale-95 shadow-sm shrink-0"
              title={isAgent ? "Back to Search" : "Back to Dashboard"}
            >
              <ArrowLeft size={18} />
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="p-1 bg-amber-400 text-amber-950 rounded-lg shadow-sm shrink-0">
                  <Flame size={15} />
                </div>
                <h1 className="text-base sm:text-xl font-black tracking-tight truncate">Find Delivery Agent</h1>
              </div>
              <p className="text-[11px] text-blue-100 font-medium truncate hidden sm:block">
                Instant delivery area code & agent lookup by colony, village, or landmark
              </p>
            </div>
          </div>

          {/* Quick Metrics */}
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="bg-white/15 px-2.5 py-1 rounded-xl text-[11px] font-bold border border-white/20 shadow-sm flex items-center gap-1">
              <Building2 size={12} className="text-amber-300" />
              <span>23 Beats</span>
            </span>
            <span className="bg-white/15 px-2.5 py-1 rounded-xl text-[11px] font-bold border border-white/20 shadow-sm flex items-center gap-1">
              <Users size={12} className="text-emerald-300" />
              <span>33.1k</span>
            </span>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-6xl w-full mx-auto p-3 sm:p-5 md:p-8 space-y-4 sm:space-y-6">

        {/* Search Hero Card */}
        <div className="glass-card p-4 sm:p-6 rounded-2xl sm:rounded-3xl shadow-sm border border-slate-200/80 bg-gradient-to-br from-white via-white to-blue-50/50 relative overflow-hidden">
          <div className="absolute top-0 right-0 -mr-16 -mt-16 w-56 h-56 rounded-full bg-blue-100/40 blur-3xl pointer-events-none"></div>

          <div className="flex items-center justify-between gap-2 mb-2">
            <label htmlFor="area-search-input" className="block text-[11px] sm:text-xs font-extrabold uppercase tracking-wider text-slate-500 truncate">
              Search Colony, Village, or Landmark
            </label>
            <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-100 shrink-0">
              Fuzzy Aliases
            </span>
          </div>

          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
              <Search size={19} className="text-blue-600" />
            </div>
            <input
              id="area-search-input"
              type="search"
              inputMode="search"
              enterKeyHint="search"
              placeholder="e.g. Gajularamaram, Gandimysamma, Chintal, Jeedimetla, Suraram..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-14 py-3 sm:py-3.5 bg-white border-2 border-slate-200 hover:border-blue-300 focus:border-blue-600 rounded-xl sm:rounded-2xl text-slate-800 text-sm sm:text-base font-bold placeholder-slate-400 focus:outline-none focus:ring-4 focus:ring-blue-100 transition-all shadow-sm"
              autoFocus
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600"
              >
                <span className="text-xs bg-slate-100 px-2 py-1 rounded-lg font-bold hover:bg-slate-200">Clear</span>
              </button>
            )}
          </div>

          {/* Agent Filter Selector */}
          <div className="mt-3 pt-3 border-t border-slate-100">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-1.5 text-[11px] sm:text-xs font-bold text-slate-600">
                <Filter size={12} className="text-blue-600" />
                <span>Filter by Beat Agent:</span>
              </div>
              {selectedAgentFilter !== 'ALL' && (
                <button
                  onClick={() => setSelectedAgentFilter('ALL')}
                  className="text-[11px] font-bold text-red-600 hover:underline"
                >
                  Reset
                </button>
              )}
            </div>

            <div className="flex gap-1.5 overflow-x-auto pb-1 hide-scrollbar">
              <button
                onClick={() => setSelectedAgentFilter('ALL')}
                className={`text-xs font-bold px-2.5 py-1.5 rounded-xl border whitespace-nowrap transition-all ${
                  selectedAgentFilter === 'ALL'
                    ? 'bg-slate-800 text-white border-slate-900 shadow-sm'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                All ({DELIVERY_AREAS.length})
              </button>
              {AGENT_NAMES.map((name) => (
                <button
                  key={name}
                  onClick={() => setSelectedAgentFilter(name)}
                  className={`text-xs font-bold px-2.5 py-1.5 rounded-xl border whitespace-nowrap transition-all ${
                    selectedAgentFilter === name
                      ? 'bg-blue-600 text-white border-blue-700 shadow-sm shadow-blue-500/20'
                      : 'bg-white text-slate-700 border-slate-200 hover:border-blue-400 hover:bg-blue-50/50'
                  }`}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>

          {/* Popular Colony Fast-Filter Pills - Single Row Scroll */}
          <div className="mt-2.5 pt-2.5 border-t border-slate-100">
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 mb-1.5">
              <Sparkles size={12} className="text-amber-500" />
              <span>Fast Tap Colony:</span>
            </div>
            <div className="flex overflow-x-auto pb-1 gap-1.5 hide-scrollbar whitespace-nowrap">
              {POPULAR_COLONIES.map((colony) => (
                <button
                  key={colony}
                  onClick={() => {
                    setSearchQuery(colony);
                    setActiveTab('search');
                  }}
                  className={`text-xs font-bold px-2.5 py-1 rounded-lg border transition-all shrink-0 active:scale-95 ${
                    searchQuery.toLowerCase() === colony.toLowerCase()
                      ? 'bg-blue-600 text-white border-blue-700 shadow-sm'
                      : 'bg-white text-slate-700 border-slate-200 hover:border-blue-400 hover:bg-blue-50/50'
                  }`}
                >
                  {colony}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Tab Toggle Navigation - Mobile-First Segmented Control */}
        <div className="bg-slate-200/80 p-1 rounded-2xl grid grid-cols-3 gap-1 shadow-inner">
          <button
            onClick={() => setActiveTab('search')}
            className={`py-2 px-1 rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'search'
                ? 'bg-white text-blue-600 shadow-sm scale-[1.01]'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Search size={14} className="shrink-0" />
            <span className="truncate">Search</span>
            {debouncedQuery && (
              <span className="w-2 h-2 rounded-full bg-blue-600 shrink-0"></span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('directory')}
            className={`py-2 px-1 rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'directory'
                ? 'bg-white text-blue-600 shadow-sm scale-[1.01]'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Building2 size={14} className="shrink-0" />
            <span className="truncate">23 Beats</span>
          </button>
          <button
            onClick={() => setActiveTab('colonies_az')}
            className={`py-2 px-1 rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'colonies_az'
                ? 'bg-white text-blue-600 shadow-sm scale-[1.01]'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Compass size={14} className="shrink-0" />
            <span className="truncate">Colonies A-Z</span>
          </button>
        </div>

        {activeTab === 'search' && isLiveSearching && (
          <div className="flex items-center justify-center gap-2 text-xs font-bold text-blue-600 py-1 bg-blue-50/80 rounded-xl border border-blue-100">
            <div className="w-2 h-2 rounded-full bg-blue-600 animate-ping"></div>
            <span>Scanning live customer database...</span>
          </div>
        )}

        {/* TAB 1: Search View */}
        {activeTab === 'search' && (
          <div className="space-y-6">
            {!debouncedQuery && selectedAgentFilter === 'ALL' ? (
              // Empty state guide
              <div className="glass-card p-8 sm:p-12 rounded-3xl text-center border border-dashed border-slate-300">
                <div className="w-16 h-16 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto mb-4 border border-blue-100 shadow-sm">
                  <Navigation size={28} />
                </div>
                <h3 className="text-lg sm:text-xl font-bold text-slate-800 mb-2">
                  Type any Colony, Village, or Street Name
                </h3>
                <p className="text-slate-500 text-sm max-w-md mx-auto mb-6">
                  Instantly find out which delivery agent covers that address, their area code, and how many consumers are registered in that beat.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-2xl mx-auto text-left">
                  <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/80">
                    <p className="text-xs font-bold text-slate-700">1. Instant Beat Match</p>
                    <p className="text-[11px] text-slate-500 mt-1">Identifies primary area code (e.g. 11-NAVEEN or 01-RAJU).</p>
                  </div>
                  <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/80">
                    <p className="text-xs font-bold text-slate-700">2. Real Consumer Data</p>
                    <p className="text-[11px] text-slate-500 mt-1">Queries 33,000+ consumer records to confirm addresses.</p>
                  </div>
                  <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/80">
                    <p className="text-xs font-bold text-slate-700">3. Direct Agent Call</p>
                    <p className="text-[11px] text-slate-500 mt-1">One-click call or WhatsApp to the assigned delivery person.</p>
                  </div>
                </div>
              </div>
            ) : (
              // Search Results Content
              <div className="space-y-6">

                {/* Pre-Indexed Colony Matches */}
                {preIndexedMatches.matchedColonies.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h2 className="text-sm font-extrabold uppercase tracking-wider text-slate-600 flex items-center gap-2">
                        <MapPin size={16} className="text-blue-600" />
                        Matched Colonies & Villages ({preIndexedMatches.matchedColonies.length})
                      </h2>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {preIndexedMatches.matchedColonies.slice(0, 12).map((colony, idx) => {
                        const agentName = getAgentNameFromArea(colony.primaryArea);
                        const contact = getAgentContact(agentName);

                        return (
                          <div 
                            key={idx}
                            onClick={() => setSelectedColonyModal(colony)}
                            className="glass-card p-5 rounded-2xl border border-slate-200 hover:border-blue-400 transition-all shadow-sm hover:shadow-md flex flex-col justify-between gap-4 group bg-white cursor-pointer"
                          >
                            <div>
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <div className="flex items-center gap-2">
                                    <h3 className="font-black text-slate-800 text-lg group-hover:text-blue-600 transition-colors">
                                      {colony.name}
                                    </h3>
                                    <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                                      {colony.totalConsumers} Consumers
                                    </span>
                                  </div>
                                  <p className="text-xs text-slate-500 font-medium mt-1">
                                    Colony / Landmark Beat
                                  </p>
                                </div>

                                <button
                                  onClick={(e) => handleCopyCode(colony.primaryArea, e)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-black bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 shrink-0 transition-colors"
                                  title="Click to copy area code"
                                >
                                  {copiedCode === colony.primaryArea ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
                                  <span>{colony.primaryArea}</span>
                                </button>
                              </div>

                              {/* Primary Agent Section */}
                              <div className="mt-4 p-3.5 bg-slate-50/80 rounded-xl border border-slate-200 flex items-center justify-between gap-3">
                                <div className="flex items-center gap-3 min-w-0">
                                  <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center font-black text-sm shrink-0 shadow-sm">
                                    {agentName.charAt(0).toUpperCase()}
                                  </div>
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-1.5">
                                      <p className="font-bold text-slate-800 text-sm truncate">{agentName}</p>
                                      <span className="text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">Primary</span>
                                    </div>
                                    <p className="text-xs text-slate-500 truncate">Delivery Agent for {colony.primaryArea}</p>
                                  </div>
                                </div>

                                {/* Call / WhatsApp Links */}
                                <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                                  {contact?.phone && (
                                    <a
                                      href={`tel:${contact.phone}`}
                                      className="p-2 bg-white hover:bg-emerald-50 text-slate-700 hover:text-emerald-600 border border-slate-200 rounded-lg transition-colors shadow-sm"
                                      title={`Call ${agentName}`}
                                    >
                                      <Phone size={15} />
                                    </a>
                                  )}
                                  <a
                                    href={`https://wa.me/?text=${encodeURIComponent(`Hi ${agentName}, inquiring about Bharat Gas delivery for customer in ${colony.name} (${colony.primaryArea}).`)}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="p-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg transition-colors shadow-sm"
                                    title={`WhatsApp inquiry for ${colony.name}`}
                                  >
                                    <MessageCircle size={15} />
                                  </a>
                                </div>
                              </div>

                              {/* Secondary Overlapping Beats if any */}
                              {colony.secondaryAreas && colony.secondaryAreas.length > 0 && (
                                <div className="mt-3">
                                  <p className="text-[11px] font-bold text-slate-500 mb-1">Also partially served by:</p>
                                  <div className="flex flex-wrap gap-1.5">
                                    {colony.secondaryAreas.map((sec, sIdx) => (
                                      <span key={sIdx} className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                                        {sec.area} ({sec.count} cstrs)
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>

                            {/* View in Consumers Table */}
                            <div className="pt-2 border-t border-slate-100 mt-2 flex items-center justify-between text-xs">
                              <span className="text-slate-400 font-medium">Click card for full details</span>
                              <span className="text-blue-600 font-bold flex items-center gap-0.5 group-hover:translate-x-0.5 transition-transform">
                                Explore <ChevronRight size={14} />
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Direct Area Code Matches */}
                {preIndexedMatches.matchedAreas.length > 0 && (
                  <div className="space-y-3">
                    <h2 className="text-sm font-extrabold uppercase tracking-wider text-slate-600 flex items-center gap-2">
                      <Building2 size={16} className="text-indigo-600" />
                      Matched Delivery Area Codes ({preIndexedMatches.matchedAreas.length})
                    </h2>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      {preIndexedMatches.matchedAreas.map((area) => (
                        <div 
                          key={area.code}
                          className="glass-card p-5 rounded-2xl border border-slate-200 bg-white shadow-sm hover:shadow-md transition-all flex flex-col justify-between"
                        >
                          <div>
                            <div className="flex items-center justify-between gap-2 mb-3">
                              <button
                                onClick={(e) => handleCopyCode(area.code, e)}
                                className={`px-2.5 py-1 rounded-lg text-xs font-black border flex items-center gap-1.5 ${getAreaBadgeColor(area.code)}`}
                                title="Click to copy area code"
                              >
                                {copiedCode === area.code ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
                                <span>{area.code}</span>
                              </button>
                              <span className="text-xs font-bold text-slate-500">
                                {area.totalConsumers.toLocaleString()} Consumers
                              </span>
                            </div>

                            <p className="font-extrabold text-slate-800 text-base mb-1">
                              Agent: {area.agentName}
                            </p>

                            {/* Top Locations covered */}
                            <div className="mt-3">
                              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Key Colonies & Streets:</p>
                              <div className="flex flex-wrap gap-1">
                                {area.topLocations.slice(0, 6).map((loc, lIdx) => (
                                  <span key={lIdx} className="text-[10px] bg-slate-50 text-slate-700 px-2 py-0.5 rounded border border-slate-200">
                                    {loc.name}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </div>

                          <div className="pt-4 border-t border-slate-100 mt-4 flex items-center justify-between">
                            <span className="text-xs text-slate-400 font-medium">
                              Pin: {area.pincodes.slice(0, 2).join(', ') || '500054'}
                            </span>
                            <button
                              onClick={() => setSelectedArea(area)}
                              className="text-xs font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1"
                            >
                              Details <ChevronRight size={14} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Live Database Address Matches */}
                {liveResults.length > 0 && (
                  <div className="space-y-4 pt-4 border-t border-slate-200">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="text-sm font-extrabold uppercase tracking-wider text-slate-700 flex items-center gap-2">
                          <CheckCircle2 size={16} className="text-emerald-600" />
                          Live Database Customer Matches
                        </h2>
                        <p className="text-xs text-slate-500">
                          Found {liveResults.reduce((acc, r) => acc + r.matchCount, 0)} customer addresses matching "{debouncedQuery}" in live database
                        </p>
                      </div>
                    </div>

                    <div className="space-y-3">
                      {liveResults.map((result) => (
                        <div 
                          key={result.areaCode}
                          className="glass-card p-4 sm:p-5 rounded-2xl border border-slate-200 bg-white shadow-sm"
                        >
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                            <div className="flex items-center gap-3">
                              <button
                                onClick={() => handleCopyCode(result.areaCode)}
                                className={`px-3 py-1 rounded-xl text-sm font-black border flex items-center gap-1.5 ${getAreaBadgeColor(result.areaCode)}`}
                                title="Click to copy area code"
                              >
                                {copiedCode === result.areaCode ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
                                <span>{result.areaCode}</span>
                              </button>
                              <div>
                                <p className="font-extrabold text-slate-800 text-sm">
                                  Delivery Agent: {result.agentName}
                                </p>
                                <p className="text-xs text-slate-500">
                                  {result.matchCount} matched customer{result.matchCount > 1 ? 's' : ''} in this area
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              <a
                                href={`https://wa.me/?text=${encodeURIComponent(`Hi ${result.agentName}, customer delivery query for area ${result.areaCode} matching location ${debouncedQuery}.`)}`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1.5 text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 px-3 py-1.5 rounded-xl transition-colors"
                              >
                                <MessageCircle size={14} /> WhatsApp Agent
                              </a>
                            </div>
                          </div>

                          {/* Sample Real Customer Addresses */}
                          <div className="mt-3">
                            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Sample Consumer Addresses in this beat:</p>
                            <div className="space-y-2">
                              {result.sampleConsumers.map((c) => (
                                <div key={c.consumer_number} className="p-2.5 bg-slate-50 rounded-xl border border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs">
                                  <div className="min-w-0">
                                    <span className="font-bold text-slate-800">{c.consumer_name}</span>
                                    <span className="text-slate-400 ml-2">#{c.consumer_number}</span>
                                    <p className="text-slate-600 text-[11px] truncate mt-0.5">{c.address}</p>
                                  </div>
                                  <span className="text-[11px] font-bold text-slate-500 shrink-0">
                                    📱 {c.mobile}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* If absolutely nothing matched */}
                {!isLiveSearching && 
                 preIndexedMatches.matchedColonies.length === 0 && 
                 preIndexedMatches.matchedAreas.length === 0 && 
                 liveResults.length === 0 && (
                  <div className="glass-card p-12 rounded-3xl text-center border border-slate-200">
                    <p className="text-base font-bold text-slate-700 mb-1">No exact colony or area match found for "{debouncedQuery}"</p>
                    <p className="text-xs text-slate-500 mb-4">Try searching with a shorter keyword (e.g. "Gajula", "Jeedimetla", "Shapur", "Chintal") or explore the Directory tab.</p>
                    <button
                      onClick={() => setActiveTab('directory')}
                      className="px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold shadow-sm"
                    >
                      Browse All 23 Beats
                    </button>
                  </div>
                )}

              </div>
            )}
          </div>
        )}

        {/* TAB 2: Full Directory of 23 Delivery Beats */}
        {activeTab === 'directory' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-black text-slate-800">Siddhartha Bharat Gas — 23 Delivery Beats</h2>
                <p className="text-xs text-slate-500">Sorted by total consumer volume with complete coverage breakdowns</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {DELIVERY_AREAS.filter(area => {
                if (selectedAgentFilter === 'ALL') return true;
                return area.agentName.toLowerCase() === selectedAgentFilter.toLowerCase();
              }).map((area) => (
                <div 
                  key={area.code}
                  className="glass-card p-5 rounded-2xl border border-slate-200 bg-white shadow-sm hover:shadow-md transition-all flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <button
                        onClick={() => handleCopyCode(area.code)}
                        className={`px-2.5 py-1 rounded-xl text-xs font-black border flex items-center gap-1.5 ${getAreaBadgeColor(area.code)}`}
                        title="Click to copy area code"
                      >
                        {copiedCode === area.code ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
                        <span>{area.code}</span>
                      </button>
                      <span className="text-xs font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md">
                        {area.totalConsumers.toLocaleString()} Consumers
                      </span>
                    </div>

                    <h3 className="font-extrabold text-slate-800 text-lg mb-0.5">
                      {area.agentName}
                    </h3>
                    <p className="text-xs text-slate-500 mb-3">Assigned Delivery Staff</p>

                    <div className="p-3 bg-slate-50/80 rounded-xl border border-slate-100 mb-3">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Key Colonies & Landmarks:</p>
                      <div className="flex flex-wrap gap-1">
                        {area.topLocations.slice(0, 8).map((loc, idx) => (
                          <button
                            key={idx}
                            onClick={() => {
                              setSearchQuery(loc.name);
                              setActiveTab('search');
                            }}
                            className="text-[10px] font-bold bg-white text-slate-700 hover:text-blue-600 hover:border-blue-300 px-2 py-0.5 rounded border border-slate-200 transition-colors"
                          >
                            {loc.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                    <span className="text-xs text-slate-500 font-medium">
                      Pincode: {area.pincodes.slice(0, 2).join(', ') || '500054'}
                    </span>

                    <button
                      onClick={() => setSelectedArea(area)}
                      className="text-xs font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1"
                    >
                      View Beat Details <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 3: Colonies Alphabetical Index (A-Z) */}
        {activeTab === 'colonies_az' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-black text-slate-800">Alphabetical Colonies & Areas Directory</h2>
                <p className="text-xs text-slate-500">Quick alphabetical lookup of all prominent colonies and their delivery agents</p>
              </div>
            </div>

            <div className="space-y-6">
              {coloniesAlphabetical.map(group => (
                <div key={group.letter} className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-blue-600 text-white font-black flex items-center justify-center text-sm shadow-sm">
                      {group.letter}
                    </div>
                    <span className="text-xs font-bold text-slate-400">({group.colonies.length} colonies)</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                    {group.colonies.map((colony, cIdx) => (
                      <div
                        key={cIdx}
                        onClick={() => setSelectedColonyModal(colony)}
                        className="p-3 bg-white border border-slate-200 hover:border-blue-300 rounded-xl shadow-sm hover:shadow transition-all cursor-pointer flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <p className="font-bold text-slate-800 text-xs sm:text-sm truncate">{colony.name}</p>
                          <p className="text-[11px] text-slate-500">{colony.totalConsumers} consumers</p>
                        </div>
                        <span className="text-[10px] font-black px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-100 shrink-0">
                          {colony.primaryArea}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </main>

      {/* Selected Colony Modal */}
      {selectedColonyModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[88vh] animate-in slide-in-from-bottom sm:zoom-in-95 duration-200">
            <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-4 sm:p-5 text-white flex justify-between items-center shrink-0">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider bg-white/20 px-2 py-0.5 rounded">Colony Beat Breakdown</span>
                <h3 className="text-lg sm:text-xl font-black mt-0.5 truncate">{selectedColonyModal.name}</h3>
                <p className="text-xs text-blue-100">{selectedColonyModal.totalConsumers} registered consumers</p>
              </div>
              <button 
                onClick={() => setSelectedColonyModal(null)}
                className="p-2 text-white/80 hover:text-white hover:bg-white/20 rounded-full"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
              <div className="p-4 bg-blue-50/80 rounded-2xl border border-blue-100">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-extrabold uppercase text-blue-700">Primary Delivery Beat</span>
                  <button
                    onClick={() => handleCopyCode(selectedColonyModal.primaryArea)}
                    className="text-[10px] font-bold bg-white text-blue-600 px-2 py-0.5 rounded border border-blue-200 flex items-center gap-1 shadow-sm"
                  >
                    <Copy size={10} /> Copy Code
                  </button>
                </div>
                <p className="text-xl font-black text-blue-900">{selectedColonyModal.primaryArea}</p>
                <p className="text-xs text-slate-600 mt-0.5">Agent: {getAgentNameFromArea(selectedColonyModal.primaryArea)}</p>
              </div>

              {selectedColonyModal.secondaryAreas && selectedColonyModal.secondaryAreas.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">Overlapping / Partial Beats:</p>
                  <div className="space-y-2">
                    {selectedColonyModal.secondaryAreas.map((sec, idx) => (
                      <div key={idx} className="p-2.5 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between text-xs">
                        <div>
                          <span className="font-bold text-slate-800">{sec.area}</span>
                          <span className="text-slate-400 ml-2">({getAgentNameFromArea(sec.area)})</span>
                        </div>
                        <span className="font-bold text-slate-600">{sec.count} consumers</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="pt-4 border-t border-slate-100 flex gap-2">
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${selectedColonyModal.name}, Hyderabad, Telangana`)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-colors"
                >
                  <Map size={15} /> Google Maps
                </a>
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(`Hi ${getAgentNameFromArea(selectedColonyModal.primaryArea)}, customer delivery inquiry for ${selectedColonyModal.name} (${selectedColonyModal.primaryArea}).`)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-2 shadow-sm transition-colors"
                >
                  <MessageCircle size={15} /> WhatsApp Agent
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Selected Area Modal / Detail Drawer */}
      {selectedArea && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[88vh] animate-in slide-in-from-bottom sm:zoom-in-95 duration-200">
            <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-4 sm:p-5 text-white flex justify-between items-center shrink-0">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider bg-white/20 px-2 py-0.5 rounded">Beat Details</span>
                <h3 className="text-lg sm:text-xl font-black mt-0.5 truncate">{selectedArea.code}</h3>
                <p className="text-xs text-blue-100">Delivery Agent: {selectedArea.agentName}</p>
              </div>
              <button 
                onClick={() => setSelectedArea(null)}
                className="p-2 text-white/80 hover:text-white hover:bg-white/20 rounded-full"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-blue-50 rounded-xl border border-blue-100">
                  <p className="text-[10px] font-bold text-blue-600 uppercase">Total Consumers</p>
                  <p className="text-2xl font-black text-blue-900">{selectedArea.totalConsumers.toLocaleString()}</p>
                </div>
                <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-100">
                  <p className="text-[10px] font-bold text-emerald-600 uppercase">Primary Pincode</p>
                  <p className="text-xl font-black text-emerald-900">{selectedArea.pincodes.slice(0, 2).join(', ') || '500054'}</p>
                </div>
              </div>

              <div>
                <p className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">Coverage Colonies & Landmarks:</p>
                <div className="flex flex-wrap gap-1.5">
                  {selectedArea.topLocations.map((loc, idx) => (
                    <button 
                      key={idx} 
                      onClick={() => {
                        setSelectedArea(null);
                        setSearchQuery(loc.name);
                        setActiveTab('search');
                      }}
                      className="text-xs bg-slate-100 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-300 text-slate-800 px-2.5 py-1 rounded-lg border border-slate-200 font-medium transition-colors"
                    >
                      {loc.name} ({loc.count})
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100 flex gap-2">
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(`Hi ${selectedArea.agentName}, customer delivery query for your area ${selectedArea.code}.`)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-2 shadow-sm transition-colors"
                >
                  <MessageCircle size={16} /> WhatsApp Agent
                </a>
                <button
                  onClick={() => {
                    setSelectedArea(null);
                    if (isAgent) {
                      navigate(`/agent/search`);
                    } else {
                      navigate(`/manager/consumers`);
                    }
                  }}
                  className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-2 shadow-sm transition-colors"
                >
                  <Users size={16} /> View Consumers
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Role-Aware Bottom Navigation */}
      {isAgent ? <AgentBottomNav /> : <ManagerBottomNav />}

    </div>
  );
};
export default FindDeliveryAgent;
