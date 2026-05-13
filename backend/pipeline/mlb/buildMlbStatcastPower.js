/**
 * @orphan
 *
 * EXECUTION-PATH AUDIT (orphan-code hardening pass):
 *   This module exports a default async function but is **NOT REQUIRED**
 *   by ANY file in the repository — neither live (server.js, http/,
 *   routes/, pipeline/) nor scripts (backend/scripts/).
 *
 *   Output file: backend/data/mlbStatcastPower.json
 *   Output consumers: none found via grep
 *     (the file is produced but never read — the Phase 1B ingest path
 *      uses its own data sources via pipeline/mlb/ingest/refreshMlbPitcherStats.js
 *      and refreshMlbBullpenWorkload.js)
 *
 *   STATUS: type-A orphan (exported, zero references)
 *   ACTION: kept on disk per "DO NOT aggressively delete blindly" rule;
 *           marked here so future authors do not invest in this path
 *           without first wiring a live consumer.
 *
 *   To make this module live, a consumer would need to:
 *     1. require() the produced JSON in a scoring path
 *     2. Wire batter exit-velocity / barrel-rate context into a deriver
 *     3. Surface that signal in row.barrelContext or similar
 *
 *   See also: pipeline/mlb/context/deriveMlbPitcherEnvironmentContext.js
 *   (where statcast power could plug in via the `pitcherStatsByName` lookup).
 */
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const normalizeName = require('../../utils/normalizeName');

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
  
