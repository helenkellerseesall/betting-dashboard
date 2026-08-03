# FE/PERF MEASUREMENT FENCE — item 3, measurement phase (2026-08-03)
# Read-only against the live server. Writes ONLY to .scratch/. No code edits.
# Idempotent: safe to re-run; each run overwrites its own output file.
# NOTE: the three /state?sport=nba hits may trigger at most ONE internal
# odds-API refresh (the route's own 2-min cooldown caps it) — this is the
# exact call the phone fires on every cold open, so measuring it is the point.
set -u
cd /Users/andrewmoore/Projects/betting-dashboard || exit 1
mkdir -p .scratch
OUT=.scratch/perf_measure_2026-08-03.txt
BASE="http://127.0.0.1:4000"
: > "$OUT"
say() { echo "$1" | tee -a "$OUT"; }

say "== perf fence $(date '+%Y-%m-%d %H:%M:%S %Z') =="
UP=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$BASE/api/ws/version")
say "server probe /api/ws/version HTTP $UP"
[ "$UP" = "200" ] || { say "SERVER NOT REACHABLE on 127.0.0.1:4000 — start it, then re-run"; exit 1; }

# ── 1. per-endpoint timings: 3 hits each (hit1 may be cold, 2-3 warm/memo) ──
say ""
say "-- per-endpoint: 3 hits, seconds + bytes (time_total size_download) --"
for EP in \
  "/m/" \
  "/api/ws/version" \
  "/api/ws/top-picks?limit=50" \
  "/api/ws/daily3" \
  "/api/ws/state?sport=mlb" \
  "/api/ws/state?sport=nba" \
  "/api/ws/state?sport=mlb&date=2026-08-01" \
  "/api/ws/ledger/yesterday" \
  "/api/ws/graduation-board" \
  "/api/ws/ladder-lab" \
  "/api/ws/games?sport=mlb" \
; do
  L=$(for i in 1 2 3; do curl -s -o /dev/null --max-time 180 -w "%{time_total}s/%{size_download}B " "$BASE$EP"; done)
  say "$EP  ->  $L"
done
say "note: /state?sport=mlb&date=2026-08-01 is a guaranteed 60s-cache MISS = honest cold-build cost of a real (8/1-sized) slate."

# ── 2. gzip potential of the big bodies (what compression middleware WOULD do) ──
say ""
say "-- gzip -9 potential (raw -> gzipped bytes) --"
for EP in "/api/ws/state?sport=mlb" "/api/ws/top-picks?limit=50" "/api/ws/ledger/yesterday" "/m/"; do
  curl -s --max-time 180 "$BASE$EP" -o .scratch/perf_body.tmp
  RAW=$(wc -c < .scratch/perf_body.tmp | tr -d " ")
  GZ=$(gzip -9 -c .scratch/perf_body.tmp | wc -c | tr -d " ")
  say "$EP  raw=$RAW  gz=$GZ"
done
rm -f .scratch/perf_body.tmp

# ── 3. whale-file parse cost on THIS Mac (the per-request tax) ──
say ""
say "-- JSON parse cost (ms) of the files routes read per request --"
node -e '
const fs=require("fs");
for (const f of ["backend/runtime/tracking/personal_ledger.json","backend/snapshot-mlb.json","backend/runtime/tracking/mlb_tracked_bets_2026-08-02.json"]) {
  try { const s=fs.readFileSync(f,"utf8"); const t0=Date.now(); const j=JSON.parse(s); const t1=Date.now();
    console.log(f, "bytes="+s.length, "parse="+(t1-t0)+"ms");
  } catch(e){ console.log(f, "ERR", e.message); }
}' | tee -a "$OUT"

# ── 4. ledger forensics: why is it 63MB? (read-only) ──
say ""
say "-- personal_ledger.json shape --"
node -e '
const fs=require("fs");
const j=JSON.parse(fs.readFileSync("backend/runtime/tracking/personal_ledger.json","utf8"));
const bets=j.bets||[];
console.log("total rows:", bets.length);
const byRes={}; for (const b of bets) byRes[b.result||"?"]=(byRes[b.result||"?"]||0)+1;
console.log("by result:", JSON.stringify(byRes));
const real=bets.filter(b=>b.realMoney).length;
console.log("realMoney rows:", real, "| tracked/system rows:", bets.length-real);
const byDate={}; for (const b of bets) byDate[b.date||"?"]=(byDate[b.date||"?"]||0)+1;
const dates=Object.keys(byDate).sort().slice(-5);
console.log("rows on last 5 slates:", dates.map(d=>d+"="+byDate[d]).join(" "));
const sized=bets.map(b=>({id:b.id,n:JSON.stringify(b).length})).sort((a,b)=>b.n-a.n).slice(0,5);
console.log("5 largest single rows (bytes):", JSON.stringify(sized));
' | tee -a "$OUT"

# ── 5. the FE boot shape: both /state in parallel (what Promise.all pays) ──
say ""
say "-- parallel /state pair (FE boot shape) vs solo --"
node -e '
async function timed(u){const t0=Date.now();const r=await fetch(u);const b=await r.arrayBuffer();return {u, ms:Date.now()-t0, bytes:b.byteLength}}
(async()=>{
  const B="http://127.0.0.1:4000";
  const solo=await timed(B+"/api/ws/state?sport=mlb");
  console.log("solo mlb:", JSON.stringify(solo));
  const t0=Date.now();
  const both=await Promise.all([timed(B+"/api/ws/state?sport=mlb"), timed(B+"/api/ws/state?sport=nba")]);
  console.log("parallel pair:", JSON.stringify(both), "wall="+(Date.now()-t0)+"ms");
})().catch(e=>console.log("ERR",e.message));
' | tee -a "$OUT"

# ── 6. edge leg (Cloudflare Access overhead from this Mac; phone adds cellular) ──
say ""
say "-- edge leg: dns/connect/tls/ttfb/total (Access login page still measures the edge) --"
curl -s -o /dev/null --max-time 30 -w "https://edge.motel666.com/m/  dns=%{time_namelookup}s connect=%{time_connect}s tls=%{time_appconnect}s ttfb=%{time_starttransfer}s total=%{time_total}s http=%{http_code} bytes=%{size_download}\n" "https://edge.motel666.com/m/" | tee -a "$OUT"

# ── 7. cleanup of CB bridge-staging leftovers (mine, ~85MB, safe to delete) ──
rm -f .scratch/perf_stage.tar.gz .scratch/ps1.tar.gz .scratch/stage_ps1.tgz .scratch/probe.txt
say ""
say "cleanup: removed CB staging leftovers from .scratch (perf_stage.tar.gz ps1.tar.gz stage_ps1.tgz probe.txt)"
say "== fence complete — full output in $OUT =="
