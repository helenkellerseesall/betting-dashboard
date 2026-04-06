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

function summarizePlayers(rows) {
  return rows.map((row) => row?.player || "unknown").join(", ");
}

function getSlateValidator(data, bestAvailable) {
  return (
    data?.slateStateValidator ||
    bestAvailable?.slateStateValidator ||
    bestAvailable?.diagnostics?.slateStateValidator ||
    {}
  );
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
  const slateValidator = getSlateValidator(data, ba);
  const failures = [];
  const warnings = [];

  const slateState = slateValidator?.slateState || "unknown";
  const currentPregameGameCount = Number.isFinite(Number(slateValidator?.currentPregameGameCount))
    ? Number(slateValidator.currentPregameGameCount)
    : null;
  const rolloverApplied = slateValidator?.rolloverApplied === true;
  const currentDateKeyChosen = slateValidator?.currentDateKeyChosen || null;
  const nextDateKeyConsidered = slateValidator?.nextDateKeyConsidered || null;
  const tinySlate = currentPregameGameCount === 0 || currentPregameGameCount === 1;

  console.log(
    [
      "SLATE:",
      `state=${slateState}`,
      `currentPregameGameCount=${currentPregameGameCount ?? "unknown"}`,
      `rolloverApplied=${rolloverApplied}`,
      `currentDateKeyChosen=${currentDateKeyChosen || "unknown"}`,
      `nextDateKeyConsidered=${nextDateKeyConsidered || "unknown"}`,
    ].join(" ")
  );

  if (rolloverApplied && !currentDateKeyChosen) {
    failures.push("[rollover state problem] rolloverApplied=true but currentDateKeyChosen is missing");
  }

  if (rolloverApplied && !nextDateKeyConsidered) {
    failures.push("[rollover state problem] rolloverApplied=true but nextDateKeyConsidered is missing");
  }

  if (!bettingNow.length) {
    failures.push("[surfaced integrity] bettingNow is empty");
  }

  if (!Array.isArray(topCard?.topSingles) || !topCard.topSingles.length) {
    failures.push("[surfaced integrity] topSingles is empty");
  }

  if (!Array.isArray(topCard?.topLadders) || !topCard.topLadders.length) {
    failures.push("[surfaced integrity] topLadders is empty");
  }

  if (!Array.isArray(topCard?.topMustPlays) || !topCard.topMustPlays.length) {
    if (tinySlate || rolloverApplied) {
      warnings.push(
        `[late-slate small-board allowance] topMustPlays is empty; allowing because currentPregameGameCount=${currentPregameGameCount ?? "unknown"} and rolloverApplied=${rolloverApplied}`
      );
    } else {
      failures.push("[late-slate small-board allowance] topMustPlays is empty on a normal-sized current pregame slate");
    }
  }

  const rank1 = bettingNow[0];
  if (rank1 && isSpecialRow(rank1)) {
    failures.push("[surfaced integrity] bettingNow rank 1 is a special");
  }

  const specialsInTop3 = bettingNow.slice(0, 3).filter(isSpecialRow).length;
  if (specialsInTop3 > 1) {
    warnings.push(`[late-slate small-board allowance] bettingNow has ${specialsInTop3} specials in top 3`);
  }

  const avoidRows = bettingNow.filter((row) =>
    ["avoid", "fade"].some((term) =>
      String(row?.playDecision || "").toLowerCase().includes(term)
    )
  );
  if (avoidRows.length) {
    failures.push(`[surfaced integrity] bettingNow contains avoid/fade rows: ${summarizePlayers(avoidRows)}`);
  }

  const badSurfacedSpecials = bettingNow.filter(
    (row) =>
      isSpecialRow(row) &&
      !row?.playDecision &&
      !row?.decisionSummary
  );
  if (badSurfacedSpecials.length) {
    failures.push(
      `[surfaced integrity] bettingNow contains null-decision specials: ${summarizePlayers(badSurfacedSpecials)}`
    );
  }

  warnings.forEach((message) => console.warn(`WARN: ${message}`));

  if (failures.length) {
    failures.forEach((message) => console.error(`FAIL: ${message}`));
    process.exit(1);
  }

  console.log(
    `PASS: nightly board smoke test passed [state=${slateState} chosen=${currentDateKeyChosen || "unknown"} rolloverApplied=${rolloverApplied} currentPregameGameCount=${currentPregameGameCount ?? "unknown"}]`
  );
})().catch((error) => {
  fail(`[surfaced integrity] smoke test request failed: ${error.message}`);
});