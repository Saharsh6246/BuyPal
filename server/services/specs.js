// Extracts verifiable specs from the listing text. Nothing here is invented: if a number is not in the
// listing text, the field stays null and the UI shows it as "not listed".

const TIER_SCORE = { 50: 0.4, 60: 0.55, 70: 0.7, 80: 0.85, 90: 1 };

export function extractSpecs(text) {
  const t = String(text || '');
  const specs = { ramGb: null, storageGb: null, screenIn: null, refreshHz: null, gpu: null, gpuScore: null, cpu: null, cpuScore: null, batteryHours: null, weightKg: null };

  const ram = t.match(/(\d{1,3})\s?GB\s*(?:of\s*)?(?:DDR\d\w*|LPDDR\d\w*|unified\s*)?\s*(?:RAM|memory)/i)
    || t.match(/(?:RAM|memory)[^.\d]{0,15}(\d{1,3})\s?GB/i)
    || t.match(/(\d{1,3})\s?GB\s*(?:DDR\d|LPDDR\d)/i);
  if (ram) specs.ramGb = Number(ram[1]);

  const storage = t.match(/(\d+(?:\.\d+)?)\s?(TB|GB)\s*(?:NVMe\s*)?(?:PCIe\s*)?(?:M\.2\s*)?(SSD|HDD|eMMC|storage)/i);
  if (storage) {
    const value = Number(storage[1]) * (storage[2].toUpperCase() === 'TB' ? 1000 : 1);
    if (value >= 64 && !(specs.ramGb && value === specs.ramGb)) specs.storageGb = value;
  }

  const screen = t.match(/(\d{2}(?:\.\d)?)\s?(?:"|”|-?inch|-?in\b)/i);
  if (screen) {
    const size = Number(screen[1]);
    if (size >= 10 && size <= 90) specs.screenIn = size;
  }

  const hz = t.match(/(\d{2,3})\s?Hz/i);
  if (hz && Number(hz[1]) >= 60 && Number(hz[1]) <= 540) specs.refreshHz = Number(hz[1]);

  const nvidia = t.match(/(?:RTX|GTX)\s?(\d{4})(\s?(?:Ti|SUPER))?/i);
  if (nvidia) {
    const model = nvidia[1];
    specs.gpu = `${/GTX/i.test(nvidia[0]) ? 'GTX' : 'RTX'} ${model}${nvidia[2] ? ` ${nvidia[2].trim()}` : ''}`;
    const tier = TIER_SCORE[Number(model.slice(-2))] ?? 0.5;
    const series = Number(model.slice(0, 2));
    const seriesBoost = series >= 50 ? 0.1 : series >= 40 ? 0.05 : series >= 30 ? 0 : -0.1;
    specs.gpuScore = Math.max(0.1, Math.min(1, tier + seriesBoost));
  } else if (/Radeon\s?RX\s?\d{4}/i.test(t)) {
    specs.gpu = t.match(/Radeon\s?RX\s?\d{4}\w*/i)[0];
    specs.gpuScore = 0.55;
  } else if (/Arc\s?(?:A\d{3}|Graphics)/i.test(t)) {
    specs.gpu = 'Intel Arc';
    specs.gpuScore = 0.3;
  }

  const intel = t.match(/Core\s?(?:Ultra\s?)?(i[3579]|[3579])[-\s]?(\d{4,5}\w*)?/i);
  const ryzen = t.match(/Ryzen\s?(?:AI\s?)?([3579])\s?(\d{4}\w*)?/i);
  const apple = t.match(/Apple\s?M(\d)(\s?(?:Pro|Max|Ultra))?/i) || t.match(/\bM([1-4])(\s?(?:Pro|Max))?\b/);
  if (apple) {
    specs.cpu = `Apple M${apple[1]}${apple[2] ? ` ${apple[2].trim()}` : ''}`;
    specs.cpuScore = /Max|Ultra/i.test(apple[2] || '') ? 1 : /Pro/i.test(apple[2] || '') ? 0.9 : 0.78;
  } else if (intel) {
    const tier = Number(intel[1].replace(/\D/g, ''));
    specs.cpu = `Intel Core ${intel[1].toLowerCase().startsWith('i') ? intel[1].toLowerCase() : `Ultra ${tier}`}${intel[2] ? ` ${intel[2]}` : ''}`;
    specs.cpuScore = { 3: 0.3, 5: 0.55, 7: 0.8, 9: 1 }[tier] ?? 0.5;
  } else if (ryzen) {
    specs.cpu = `AMD Ryzen ${ryzen[1]}${ryzen[2] ? ` ${ryzen[2]}` : ''}`;
    specs.cpuScore = { 3: 0.3, 5: 0.55, 7: 0.8, 9: 1 }[Number(ryzen[1])] ?? 0.5;
  } else if (/Snapdragon\s?X/i.test(t)) {
    specs.cpu = 'Snapdragon X';
    specs.cpuScore = 0.65;
  }

  const battery = t.match(/(?:up to\s*)?(\d{1,2})(?:\+)?\s?(?:-?hours?|-?hrs?)\s*(?:of\s*)?(?:battery|video|usage|playback)/i)
    || t.match(/battery[^.]{0,40}?(\d{1,2})\s?(?:hours?|hrs?)/i);
  if (battery && Number(battery[1]) >= 2 && Number(battery[1]) <= 40) specs.batteryHours = Number(battery[1]);

  const weight = t.match(/(?:weigh\w*|weight)[^.]{0,25}?(\d(?:\.\d+)?)\s?(kg|lbs?|pounds?)/i)
    || t.match(/(\d(?:\.\d+)?)\s?(kg|lbs?|pounds?)\b/i);
  if (weight) {
    const kg = /kg/i.test(weight[2]) ? Number(weight[1]) : Number(weight[1]) * 0.4536;
    if (kg >= 0.5 && kg <= 5) specs.weightKg = Math.round(kg * 100) / 100;
  }

  return specs;
}

const UNIT = { g: ['g', 1], gm: ['g', 1], kg: ['g', 1000], ml: ['ml', 1], l: ['ml', 1000], ltr: ['ml', 1000], litre: ['ml', 1000], litres: ['ml', 1000], liter: ['ml', 1000] };

/** Pack size from text such as "500 g", "1 kg" or "1 litre", normalised to grams or millilitres. Null when none is stated. */
export function parseSize(text) {
  const m = String(text || '').toLowerCase().match(/(\d+(?:\.\d+)?)\s?(kg|gm|g|ml|ltr|litres?|liters?|l)\b/);
  if (!m) return null;
  const [unit, factor] = UNIT[m[2]];
  return { unit, qty: Math.round(Number(m[1]) * factor * 1000) / 1000 };
}

/** Short, human-readable chips built only from specs that were actually found. */
export function specChips(specs) {
  const chips = [];
  if (specs.cpu) chips.push(specs.cpu);
  if (specs.gpu) chips.push(specs.gpu);
  if (specs.ramGb) chips.push(`${specs.ramGb}GB RAM`);
  if (specs.storageGb) chips.push(specs.storageGb >= 1000 ? `${specs.storageGb / 1000}TB storage` : `${specs.storageGb}GB storage`);
  if (specs.screenIn) chips.push(`${specs.screenIn}" ${specs.refreshHz ? `${specs.refreshHz}Hz ` : ''}display`.replace('  ', ' '));
  else if (specs.refreshHz) chips.push(`${specs.refreshHz}Hz`);
  if (specs.batteryHours) chips.push(`${specs.batteryHours}h battery`);
  if (specs.weightKg) chips.push(`${specs.weightKg}kg`);
  return chips;
}

/**
 * Computer-style performance score in 0..1 using only the specs that were found.
 * Returns null when too little is known to say anything honest.
 */
export function performanceScore(specs, { gaming = false } = {}) {
  const parts = [];
  // For gaming, a listing with no dedicated GPU is scored as weak (a scoring prior; it is never shown as a claim).
  if (specs.gpuScore != null) parts.push([gaming ? 0.4 : 0.15, specs.gpuScore]);
  else if (gaming) parts.push([0.4, 0.1]);
  if (specs.cpuScore != null) parts.push([0.3, specs.cpuScore]);
  if (specs.ramGb != null) parts.push([0.2, Math.min(specs.ramGb, 32) / 32]);
  if (specs.storageGb != null) parts.push([0.1, Math.min(specs.storageGb, 2000) / 2000]);
  if (specs.refreshHz != null) parts.push([gaming ? 0.1 : 0.05, Math.min(specs.refreshHz, 240) / 240]);
  const weight = parts.reduce((sum, [w]) => sum + w, 0);
  if (weight < 0.3) return null;
  return parts.reduce((sum, [w, v]) => sum + w * v, 0) / weight;
}
