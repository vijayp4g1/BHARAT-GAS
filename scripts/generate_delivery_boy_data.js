import fs from 'fs';
import * as XLSX from 'xlsx';

const CSV_PATH = 'customers data/ListOfConsumers (5).csv';

console.log('Generating Delivery Boy / Find Area Data from', CSV_PATH);

const fileBuf = fs.readFileSync(CSV_PATH);
const workbook = XLSX.read(fileBuf, { type: 'buffer' });
const sheetName = workbook.SheetNames[0];
const worksheet = workbook.Sheets[sheetName];
const rawRows = XLSX.utils.sheet_to_json(worksheet, { range: 3 });

console.log(`Parsed ${rawRows.length} raw rows from CSV.`);

// Ignored noise tokens for colony matching
const NOISE_TOKENS = new Set([
  '-', '0', 'N/A', 'NA', 'NULL', 'UNKNOWN', 'TELANGANA', 'MEDCHAL MALKAJGIRI', 
  'MEDCHAL', 'HYDERABAD', 'DISTRICT', 'INDIA', 'ANDHRA PRADESH', 'AP',
  'ROAD', 'STREET', 'LANE', 'HNO', 'H NO', 'HOUSE', 'FLAT', 'PLOT', 'NEAR', 'OPP'
]);

function cleanName(raw) {
  if (!raw) return '';
  let str = String(raw).toUpperCase().trim();
  str = str.replace(/[,\.\-\/\\#;:\(\)]/g, ' ').replace(/\s+/g, ' ').trim();
  if (NOISE_TOKENS.has(str) || str.length < 3 || /^\d+$/.test(str)) return '';
  return str;
}

// Map of consumer number to clean consumer data
const consumers = new Map();
for (const row of rawRows) {
  const cNum = String(row.ConsumerNumber !== undefined ? row.ConsumerNumber : '').trim();
  if (!cNum || !/^\d+$/.test(cNum)) continue;

  const areaCode = String(row.AreaCodeDesc || '').trim() || 'UNASSIGNED';
  const pincode = String(row.PinCode || '').replace(/\D/g, '').trim();

  const landmark = cleanName(row.AreaLandMark);
  const village = cleanName(row.CityTownVillage);
  const street = cleanName(row.StreetRoadName);
  const complex = cleanName(row.HousingComplexBuilding);

  const locations = new Set();
  if (landmark) locations.add(landmark);
  if (village) locations.add(village);
  if (street) locations.add(street);
  if (complex) locations.add(complex);

  if (!consumers.has(cNum)) {
    consumers.set(cNum, {
      consumer_number: cNum,
      area_code: areaCode,
      pincode: pincode && pincode.length === 6 ? pincode : null,
      locations: Array.from(locations)
    });
  } else {
    // Merge extra locations if secondary SV row has them
    const existing = consumers.get(cNum);
    for (const loc of locations) {
      if (!existing.locations.includes(loc)) existing.locations.push(loc);
    }
    if (!existing.pincode && pincode && pincode.length === 6) {
      existing.pincode = pincode;
    }
  }
}

console.log(`Aggregating data across ${consumers.size} unique consumers...`);

// Group by Area
const areaMap = new Map();
const colonyAreaMap = new Map(); // colonyName -> Map(areaCode -> count)

for (const c of consumers.values()) {
  if (!areaMap.has(c.area_code)) {
    areaMap.set(c.area_code, {
      code: c.area_code,
      totalConsumers: 0,
      pincodeCounts: new Map(),
      locationCounts: new Map()
    });
  }

  const aEntry = areaMap.get(c.area_code);
  aEntry.totalConsumers++;

  if (c.pincode) {
    aEntry.pincodeCounts.set(c.pincode, (aEntry.pincodeCounts.get(c.pincode) || 0) + 1);
  }

  for (const loc of c.locations) {
    aEntry.locationCounts.set(loc, (aEntry.locationCounts.get(loc) || 0) + 1);

    if (!colonyAreaMap.has(loc)) {
      colonyAreaMap.set(loc, new Map());
    }
    const cMap = colonyAreaMap.get(loc);
    cMap.set(c.area_code, (cMap.get(c.area_code) || 0) + 1);
  }
}

// Build areas array
const areas = Array.from(areaMap.values())
  .filter(a => a.code && a.code !== 'UNASSIGNED')
  .map(a => {
    // Sort pincodes by frequency
    const pincodes = Array.from(a.pincodeCounts.entries())
      .sort((x, y) => y[1] - x[1])
      .map(x => x[0]);

    // Sort topLocations by frequency (top 15)
    const topLocations = Array.from(a.locationCounts.entries())
      .sort((x, y) => y[1] - x[1])
      .slice(0, 15)
      .map(([name, count]) => ({ name, count }));

    return {
      code: a.code,
      totalConsumers: a.totalConsumers,
      pincodes,
      topLocations
    };
  })
  .sort((a, b) => b.totalConsumers - a.totalConsumers);

// Build topColonies array
const topColonies = Array.from(colonyAreaMap.entries())
  .map(([name, areasCountMap]) => {
    let totalConsumers = 0;
    const areaBreakdown = [];
    for (const [area, count] of areasCountMap.entries()) {
      totalConsumers += count;
      areaBreakdown.push({ area, count });
    }
    areaBreakdown.sort((x, y) => y.count - x.count);

    const primaryArea = areaBreakdown[0]?.area || '';
    const secondaryAreas = areaBreakdown.slice(1, 4);

    return {
      name,
      totalConsumers,
      primaryArea,
      secondaryAreas
    };
  })
  .filter(c => c.totalConsumers >= 5 && c.name.length >= 3)
  .sort((a, b) => b.totalConsumers - a.totalConsumers)
  .slice(0, 400);

const outputJson = {
  areas,
  topColonies
};

fs.writeFileSync('src/data/areaDataGenerated.json', JSON.stringify(outputJson, null, 2), 'utf-8');

console.log(`Successfully generated src/data/areaDataGenerated.json!`);
console.log(`Total Areas: ${areas.length}`);
console.log(`Top Colonies indexed: ${topColonies.length}`);
console.log('Top 5 Areas:');
areas.slice(0, 5).forEach(a => console.log(`  ${a.code}: ${a.totalConsumers} consumers, ${a.topLocations.length} locations`));
console.log('Top 5 Colonies:');
topColonies.slice(0, 5).forEach(c => console.log(`  ${c.name}: ${c.totalConsumers} total (Primary: ${c.primaryArea})`));
