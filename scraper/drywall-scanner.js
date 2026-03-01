// Drywall Opportunity Scanner — deep scan for permits nearing the drywall stage
const config = require('../config');
const db = require('../db/init');
const utils = require('./utils');

const signals = config.charleston.signals;
const passedStatuses = config.charleston.allPassedStatuses.map(s => s.toLowerCase());
const scheduledStatuses = config.charleston.scheduledStatuses.map(s => s.toLowerCase());
const signalTags = config.charleston.signalTags;

let scanStatus = null;

function getScanStatus() { return scanStatus; }

// Analyze a single permit's inspection history for drywall opportunity signals
function analyzePermit(permit) {
  const inspType = (permit.inspection_type || '').trim();
  const inspStatus = (permit.inspection_status || '').trim().toLowerCase();
  const isPassed = passedStatuses.some(s => inspStatus.includes(s));
  const isScheduled = scheduledStatuses.some(s => inspStatus.includes(s));

  const matchedSignals = [];

  // ── HIGH CONFIDENCE ──
  // Framing approved
  if (isPassed && signals.high.framing.includes(inspType)) {
    matchedSignals.push({ tag: signalTags[inspType] || 'FRAME', type: inspType, status: permit.inspection_status, date: permit.inspection_date, confidence: 'high' });
  }
  // Rough-ins approved
  if (isPassed && signals.high.roughIns.includes(inspType)) {
    matchedSignals.push({ tag: signalTags[inspType] || inspType.substring(0, 8), type: inspType, status: permit.inspection_status, date: permit.inspection_date, confidence: 'high' });
  }
  // Insulation approved
  if (isPassed && signals.high.insulation.includes(inspType)) {
    matchedSignals.push({ tag: 'INSULATION', type: inspType, status: permit.inspection_status, date: permit.inspection_date, confidence: 'high' });
  }
  // Energy envelope approved
  if (isPassed && signals.high.energyEnvelope.includes(inspType)) {
    matchedSignals.push({ tag: 'ENVELOPE', type: inspType, status: permit.inspection_status, date: permit.inspection_date, confidence: 'high' });
  }
  // Fire rated wall assembly approved
  if (isPassed && signals.high.fireRatedWall.includes(inspType)) {
    matchedSignals.push({ tag: 'FIRE-WALL', type: inspType, status: permit.inspection_status, date: permit.inspection_date, confidence: 'high' });
  }
  // Insulation scheduled (high signal — imminent)
  if (isScheduled && signals.high.insulation.includes(inspType)) {
    matchedSignals.push({ tag: 'INSULATION-SCHED', type: inspType, status: permit.inspection_status, date: permit.inspection_date, confidence: 'high' });
  }

  // ── MEDIUM CONFIDENCE ──
  if (isPassed && signals.medium.sheathing.includes(inspType)) {
    matchedSignals.push({ tag: 'SHEATHING', type: inspType, status: permit.inspection_status, date: permit.inspection_date, confidence: 'medium' });
  }
  if (isPassed && signals.medium.strapping.includes(inspType)) {
    matchedSignals.push({ tag: 'STRAPPING', type: inspType, status: permit.inspection_status, date: permit.inspection_date, confidence: 'medium' });
  }
  if (isPassed && signals.medium.gasRough.includes(inspType)) {
    matchedSignals.push({ tag: 'GAS-R', type: inspType, status: permit.inspection_status, date: permit.inspection_date, confidence: 'medium' });
  }
  if (isPassed && signals.medium.fireplaceFraming.includes(inspType)) {
    matchedSignals.push({ tag: 'FP-FRAME', type: inspType, status: permit.inspection_status, date: permit.inspection_date, confidence: 'medium' });
  }
  if (isPassed && signals.medium.sprinklerRough.includes(inspType)) {
    matchedSignals.push({ tag: 'SPRINK-R', type: inspType, status: permit.inspection_status, date: permit.inspection_date, confidence: 'medium' });
  }
  if (isPassed && signals.medium.fireAlarmRough.includes(inspType)) {
    matchedSignals.push({ tag: 'FIRE-ALM-R', type: inspType, status: permit.inspection_status, date: permit.inspection_date, confidence: 'medium' });
  }
  // Rough-ins scheduled (medium)
  if (isScheduled && signals.high.roughIns.includes(inspType)) {
    matchedSignals.push({ tag: signalTags[inspType] + '-SCHED', type: inspType, status: permit.inspection_status, date: permit.inspection_date, confidence: 'medium' });
  }

  // ── LOW CONFIDENCE ──
  // Framing scheduled
  if (isScheduled && signals.high.framing.includes(inspType)) {
    matchedSignals.push({ tag: 'FRAME-SCHED', type: inspType, status: permit.inspection_status, date: permit.inspection_date, confidence: 'low' });
  }
  if (isPassed && signals.low.foundation.includes(inspType)) {
    matchedSignals.push({ tag: 'FOUNDATION', type: inspType, status: permit.inspection_status, date: permit.inspection_date, confidence: 'low' });
  }
  if (isPassed && signals.low.bondBeam.includes(inspType)) {
    matchedSignals.push({ tag: 'BOND-BEAM', type: inspType, status: permit.inspection_status, date: permit.inspection_date, confidence: 'low' });
  }
  if (isPassed && (signals.low.electricalSlab.includes(inspType) || signals.low.plumbingSlab.includes(inspType))) {
    matchedSignals.push({ tag: signalTags[inspType] || 'SLAB', type: inspType, status: permit.inspection_status, date: permit.inspection_date, confidence: 'low' });
  }
  if (isPassed && signals.low.electricalUnderground.includes(inspType)) {
    matchedSignals.push({ tag: 'ELEC-UG', type: inspType, status: permit.inspection_status, date: permit.inspection_date, confidence: 'low' });
  }

  return matchedSignals;
}

// Calculate overall confidence from matched signals
function calculateConfidence(allSignals) {
  const highCount = allSignals.filter(s => s.confidence === 'high').length;
  const medCount = allSignals.filter(s => s.confidence === 'medium').length;

  if (highCount >= 3) return 'HIGH';
  if (highCount >= 1 && medCount >= 1) return 'MEDIUM';
  if (highCount >= 1) return 'MEDIUM';
  if (medCount >= 3) return 'MEDIUM';
  if (medCount >= 1 || allSignals.length > 0) return 'LOW';
  return null;
}

// Estimate timeline based on signals
function estimateTimeline(allSignals) {
  const highCount = allSignals.filter(s => s.confidence === 'high').length;
  const hasInsulation = allSignals.some(s => s.tag === 'INSULATION' || s.tag === 'INSULATION-SCHED');
  const hasAllRoughIns = ['ELEC-R', 'PLUMB-R', 'MECH-R'].every(tag => allSignals.some(s => s.tag === tag));
  const hasFraming = allSignals.some(s => s.tag === 'FRAME' || s.tag === 'TRUSS');

  if (hasInsulation) return 'Drywall needed: ~1-2 weeks';
  if (hasFraming && hasAllRoughIns) return 'Drywall needed: ~2-3 weeks';
  if (hasFraming) return 'Drywall needed: ~3-4 weeks';
  if (highCount >= 1) return 'Drywall needed: ~4-6 weeks';
  return 'Drywall needed: ~6-8 weeks';
}

// Run the full drywall opportunity scan on all permits in the DB
async function runScan() {
  utils.log('🎯 [Drywall Scanner] Starting deep scan...');
  await db.getDb();

  scanStatus = { running: true, total: 0, scanned: 0, opportunities: 0, started_at: new Date().toISOString() };

  // Get all permits
  const result = await db.queryPermits({ per_page: 9999 });
  const allPermits = result.data;
  scanStatus.total = allPermits.length;

  utils.log(`🎯 [Drywall Scanner] Scanning ${allPermits.length} permits...`);

  // Group permits by address to detect multiple inspections on same property
  const byAddress = {};
  for (const p of allPermits) {
    const key = (p.address || '').toLowerCase().trim();
    if (!byAddress[key]) byAddress[key] = [];
    byAddress[key].push(p);
  }

  let opportunityCount = 0;

  for (const [address, permits] of Object.entries(byAddress)) {
    // Analyze all inspections for this address
    const allSignals = [];
    for (const permit of permits) {
      const signals = analyzePermit(permit);
      allSignals.push(...signals);
      scanStatus.scanned++;
    }

    if (allSignals.length === 0) continue;

    const confidence = calculateConfidence(allSignals);
    if (!confidence) continue;

    const timeline = estimateTimeline(allSignals);

    // Mark ALL permits at this address as drywall opportunities
    for (const permit of permits) {
      const permitSignals = analyzePermit(permit);
      if (permitSignals.length > 0 || confidence === 'HIGH') {
        await db.updateDrywallOpportunity(permit.permit_number, {
          is_opportunity: true,
          confidence,
          signals: JSON.stringify(allSignals.map(s => ({ tag: s.tag, type: s.type, status: s.status, date: s.date }))),
          estimated_date: timeline,
        });
        opportunityCount++;
      }
    }
  }

  scanStatus = {
    running: false,
    total: allPermits.length,
    scanned: allPermits.length,
    opportunities: opportunityCount,
    completed_at: new Date().toISOString(),
  };

  utils.log(`🎯 [Drywall Scanner] Complete — ${opportunityCount} opportunities found from ${allPermits.length} permits`);
  return scanStatus;
}

module.exports = { runScan, getScanStatus, analyzePermit, calculateConfidence, estimateTimeline };
