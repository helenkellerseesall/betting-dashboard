const axios = require('axios');
const fs = require('fs');
const path = require('path');

function normalizeName(name) {
  return name
    ?.toLowerCase()
    .replace(/\./g, '')
    .replace(/jr|sr|ii|iii/g, '')
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')   // collapse spaces
    .trim();
}

module.exports = async function buildMlbStatcastPower() {
  try {
    const url =
      'https://baseballsavant.mlb.com/statcast_search/csv?all=true&hfGT=R&player_type=batter&hfSea=2025';

    const res = await axios.get(url);
    console.log('[STATCAST RAW LENGTH]', res.data.length);

    if (!res.data || res.data.length < 1000) {
      console.log('[STATCAST ERROR] Empty or invalid CSV');
      return;
    }

    const rows = res.data.split('\n');
    const headers = rows[0].split(',');
    const playerIndex = headers.indexOf('player_name');
    const evIndex = headers.indexOf('launch_speed');
    console.log('[STATCAST HEADERS FOUND]', playerIndex, evIndex);

    const powerMap = {};

    rows.slice(1).forEach(line => {
      const cols = line.split(',');

      const player = cols[playerIndex];
      const exitVelo = parseFloat(cols[evIndex]);

      if (!player || !exitVelo || isNaN(exitVelo)) return;

      const normalized = normalizeName(player);
      if (!normalized) return;

      if (!powerMap[normalized]) {
        powerMap[normalized] = { totalEV: 0, count: 0 };
      }

      powerMap[normalized].totalEV += exitVelo;
      powerMap[normalized].count++;
    });

    if (Object.keys(powerMap).length === 0) {
      console.log('[STATCAST ERROR] No players parsed');
      return;
    }

    const finalMap = {};

    Object.entries(powerMap).forEach(([player, data]) => {
      finalMap[player] = {
        avgExitVelocity: data.totalEV / data.count,
        powerScore: (data.totalEV / data.count) / 2
      };
    });

    const filePath = path.join(process.cwd(), 'backend/data/mlbStatcastPower.json');

    fs.writeFileSync(filePath, JSON.stringify(finalMap, null, 2));
    console.log('[STATCAST FILE WRITTEN TO]', filePath);

    console.log('[STATCAST BUILT]', Object.keys(finalMap).length);

  } catch (err) {
    console.error('[STATCAST POWER ERROR]', err.message);
  }
};
  
