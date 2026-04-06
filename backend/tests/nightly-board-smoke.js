const http = require("http");

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(new Error(`Failed to parse JSON from ${url}: ${err.message}`));
          }
        });
      })
      .on("error", reject);
  });
}

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function isSpecialRow(row) {
  const text = [
    row?.marketKey,
    row?.propType,
    row?.sourceLane,
    row?.mustPlayBetType,
    row?.mustPlaySourceLane,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return [
    "first_basket",
    "first basket",
    "first_team_basket",
    "first team basket",
    "double_double",
    "double double",
    "triple_double",
    "triple double",
    "special",
    "bestspecials",
  ].some((x) => text.includes(x));
}

(async () => {
  const data = await fetchJson("http://localhost:4000/api/best-available");
  const ba = data?.bestAvailable || {};
  const topCard = ba?.topCard || {};
  const bettingNow = Array.isArray(ba?.bettingNow) ? ba.bettingNow : [];
  const slateValidator = data?.slateStateValidator || {};
  const rolloverApplied = slateValidator?.rolloverApplied === true;
  const rolloverSlateState = slateValidator?.slateState || "";

  if (!bettingNow.length) fail("bettingNow is empty");
  if (!Array.isArray(topCard?.topSingles) || !topCard.topSingles.length) fail("topSingles is empty");
  if (!Array.isArray(topCard?.topLadders) || !topCard.topLadders.length) fail("topLadders is empty");
  if (!Array.isArray(topCard?.topMustPlays) || !topCard.topMustPlays.length) {
    if (rolloverApplied) {
      console.log(`WARN: topMustPlays is empty (rolloverApplied=true, slateState=${rolloverSlateState}) — skipping`);
    } else {
      fail("topMustPlays is empty");
    }
  }

  const rank1 = bettingNow[0];
  if (rank1 && isSpecialRow(rank1)) fail("bettingNow rank 1 is a special");

  const specialsInTop3 = bettingNow.slice(0, 3).filter(isSpecialRow).length;
  if (specialsInTop3 > 1) fail(`bettingNow has ${specialsInTop3} specials in top 3`);

  const avoidRows = bettingNow.filter((row) =>
    String(row?.playDecision || "").toLowerCase().includes("avoid")
  );
  if (avoidRows.length) fail(`bettingNow contains avoid rows: ${avoidRows.map(r => r.player).join(", ")}`);

  const badSurfacedSpecials = bettingNow.filter(
    (row) =>
      isSpecialRow(row) &&
      !row?.playDecision &&
      !row?.decisionSummary
  );
  if (badSurfacedSpecials.length) {
    fail(
      `bettingNow contains null-decision specials: ${badSurfacedSpecials
        .map((r) => r.player)
        .join(", ")}`
    );
  }

  console.log("PASS: nightly board smoke test passed");
})();