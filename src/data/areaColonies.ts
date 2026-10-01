import areaData from './areaDataGenerated.json';
import { supabase } from '../lib/supabase';

export interface AreaInfo {
  code: string;
  agentName: string;
  totalConsumers: number;
  pincodes: string[];
  topLocations: { name: string; count: number }[];
}

export interface ColonyMatch {
  name: string;
  totalConsumers: number;
  primaryArea: string;
  secondaryAreas: { area: string; count: number }[];
}

export interface LiveSearchResult {
  areaCode: string;
  agentName: string;
  matchCount: number;
  sampleConsumers: {
    consumer_number: string;
    consumer_name: string;
    address: string;
    mobile: string;
  }[];
}

// Extract human-friendly delivery agent name from area code (e.g. "11-NAVEEN" -> "Naveen", "003-ANAND" -> "Anand")
export function getAgentNameFromArea(areaCode: string): string {
  if (!areaCode) return 'Unassigned';
  const lower = areaCode.toLowerCase();
  if (lower.includes('portin') || lower.includes('port-in')) {
    return 'Port-In Transfer';
  }
  const parts = areaCode.split('-');
  if (parts.length > 1) {
    const raw = parts.slice(1).join('-').trim();
    return raw
      .toLowerCase()
      .split(' ')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }
  return areaCode;
}

export const DELIVERY_AREAS: AreaInfo[] = areaData.areas.map((a: any) => ({
  ...a,
  agentName: getAgentNameFromArea(a.code)
}));

export const TOP_COLONIES: ColonyMatch[] = areaData.topColonies;

export const AGENT_NAMES: string[] = Array.from(
  new Set(DELIVERY_AREAS.map(a => a.agentName))
).filter(name => name && name !== 'Unassigned').sort();

// Popular fast-filter tags shown as pills
export const POPULAR_COLONIES = [
  'Gajularamaram',
  'Jeedimetla',
  'Chintal',
  'Gandimysamma',
  'Suraram',
  'Shapur Nagar',
  'J Gutta',
  'Doolapally',
  'Bahadurpally',
  'Kukatpally',
  'Subash Nagar',
  'Balanagar',
  'Bowrampet',
  'Qutbullapur'
];

// Common acronyms and alternative spellings in Hyderabad / Medchal Malkajgiri
export const COLONY_ALIASES: Record<string, string[]> = {
  'QTB': ['QUTBULLAPUR', 'QUTUBULLAPUR', 'CHINTAL'],
  'JDM': ['JEEDIMETLA', 'JEDIMETLA'],
  'J GUTTA': ['J-GUTTA', 'JGUTTA', 'JAGATHGIRI GUTTA', 'JAGATHGIRIGUTTA'],
  'HAL': ['BALANAGAR', 'HAL TOWNSHIP', 'BALA NAGAR'],
  'GAJULARAMARAM': ['GAJULA RAMARAM', 'RAMARAM'],
  'GANDIMYSAMMA': ['GANDIMAISAMMA', 'GANDI MYSAMMA', 'BOWRAMPET'],
  'SURARAM': ['SURARAM COLONY', 'SURARAM VILLAGE'],
  'SHAPUR': ['SHAPUR NAGAR', 'SHAPURNAGAR'],
  'KUKATPALLY': ['KPHB', 'KUKAT PALLY'],
  'BAHADURPALLY': ['BAHADUR PALLY', 'MAHINDRA'],
  'DOOLAPALLY': ['DULAPALLY', 'DOOLA PALLY'],
  'SUBASH NAGAR': ['SUBHASH NAGAR', 'SUBHASHNAGAR']
};

/**
 * Searches pre-indexed colonies and area codes with fuzzy alias support.
 */
export function searchPreIndexedAreas(query: string, filterAgent?: string) {
  const cleanQ = query.trim().toUpperCase().replace(/[^A-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleanQ && !filterAgent) return { matchedAreas: [], matchedColonies: [] };

  // Expand aliases
  const searchTerms = [cleanQ];
  if (cleanQ) {
    for (const [canonical, aliases] of Object.entries(COLONY_ALIASES)) {
      if (canonical.includes(cleanQ) || cleanQ.includes(canonical)) {
        searchTerms.push(canonical, ...aliases);
      }
      for (const al of aliases) {
        if (al.includes(cleanQ) || cleanQ.includes(al)) {
          searchTerms.push(canonical, ...aliases);
        }
      }
    }
  }

  // 1. Search in areas directly
  let matchedAreas = DELIVERY_AREAS.filter(a => {
    if (filterAgent && a.agentName.toLowerCase() !== filterAgent.toLowerCase()) {
      return false;
    }
    if (!cleanQ) return true;

    return searchTerms.some(term => 
      a.code.toUpperCase().includes(term) ||
      a.agentName.toUpperCase().includes(term) ||
      a.pincodes.some(p => p.includes(term)) ||
      a.topLocations.some(l => l.name.toUpperCase().includes(term))
    );
  });

  // 2. Search in top colonies
  let matchedColonies = TOP_COLONIES.filter(c => {
    if (filterAgent) {
      const primaryAgent = getAgentNameFromArea(c.primaryArea);
      const isPrimary = primaryAgent.toLowerCase() === filterAgent.toLowerCase();
      const isSecondary = c.secondaryAreas.some(s => getAgentNameFromArea(s.area).toLowerCase() === filterAgent.toLowerCase());
      if (!isPrimary && !isSecondary) return false;
    }
    if (!cleanQ) return true;

    return searchTerms.some(term =>
      c.name.includes(term) ||
      c.primaryArea.toUpperCase().includes(term)
    );
  });

  // Rank matches: exact match on colony name appears first
  if (cleanQ) {
    matchedColonies.sort((a, b) => {
      const aExact = a.name === cleanQ ? 1 : 0;
      const bExact = b.name === cleanQ ? 1 : 0;
      if (aExact !== bExact) return bExact - aExact;
      return b.totalConsumers - a.totalConsumers;
    });
  }

  return { matchedAreas, matchedColonies };
}

/**
 * Live search against full database for specific address/street keywords,
 * grouping matches by Area Code.
 */
export async function searchLiveConsumersByLocation(query: string): Promise<LiveSearchResult[]> {
  const cleanQ = query.trim();
  if (!cleanQ || cleanQ.length < 2) return [];

  try {
    const escaped = cleanQ.replace(/[%_]/g, '\\$&');
    
    const { data, error } = await supabase
      .from('consumers')
      .select('consumer_number, consumer_name, address, mobile, area_code')
      .or(`address.ilike.%${escaped}%,area_code.ilike.%${escaped}%`)
      .not('area_code', 'is', null)
      .limit(100);

    if (error || !data) return [];

    const map = new Map<string, {
      areaCode: string;
      agentName: string;
      consumers: typeof data;
    }>();

    for (const c of data) {
      const code = c.area_code || 'UNKNOWN';
      if (!map.has(code)) {
        map.set(code, {
          areaCode: code,
          agentName: getAgentNameFromArea(code),
          consumers: []
        });
      }
      map.get(code)!.consumers.push(c);
    }

    return Array.from(map.values())
      .map(entry => ({
        areaCode: entry.areaCode,
        agentName: entry.agentName,
        matchCount: entry.consumers.length,
        sampleConsumers: entry.consumers.slice(0, 6)
      }))
      .sort((a, b) => b.matchCount - a.matchCount);

  } catch (err) {
    console.error('Error querying live consumers by location:', err);
    return [];
  }
}
