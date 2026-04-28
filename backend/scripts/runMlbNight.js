async function runAll() {
  try {
    console.log("🔄 Refreshing snapshot...");
    await fetch("http://localhost:4000/refresh-snapshot?force=1");

    console.log("🌦️ Building weather...");
    require("../pipeline/mlb/buildMlbWeather");

    console.log("📊 Fetching best available...");
    const res = await fetch("http://localhost:4000/api/best-available?sport=baseball_mlb");
    const data = await res.json();

    const hr = data.hrPredictionToday;
    const slips = data.hrSlips;

    console.log("\n🔍 VERIFY:");
    console.log({
      zeroPower: hr.mostLikelyHr.filter(p => p.powerScore === 0).length,
      nullWeather: hr.mostLikelyHr.filter(p => p._weatherScore == null).length,
    });

    console.log("\n🌦️ WEATHER ENVIRONMENT");
    const weatherAvg = hr.mostLikelyHr.length
      ? hr.mostLikelyHr.reduce((a, b) => a + (b._weatherScore || 0), 0) /
        hr.mostLikelyHr.length
      : 0;

    console.log("\n🌦️ WEATHER SCORE:", weatherAvg);

    if (weatherAvg < 0) {
      console.log("⚠️ BAD HR SLATE");
    } else {
      console.log("🔥 GOOD HR SLATE");
    }

    console.log("\n🔥 TOP HR:");
    hr.mostLikelyHr.slice(0, 5).forEach(p => {
      const prob = Number.isFinite(Number(p.modelProbability))
        ? Number(p.modelProbability)
        : Math.min((Number(p.hrScore) || 0) / 250, 0.3);
      const edge = Number.isFinite(Number(p.edge)) ? Number(p.edge) : null;
      const pct = (prob * 100).toFixed(1);
      const edgePct = edge == null ? "n/a" : (edge * 100).toFixed(1);
      console.log(`${p.player} (${p.team}) | Probability: ${prob.toFixed(3)} (${pct}%) | Edge: ${edgePct}%`);
    });

    console.log("\n[PROB CHECK]");
    hr.mostLikelyHr.slice(0, 5).forEach(p => {
      console.log({ player: p.player, modelProbability: p.modelProbability, impliedProbability: p.impliedProbability, edge: p.edge });
    });

    console.log("\n💰 SLIPS:");

    Object.entries(slips).forEach(([type, arr]) => {
      console.log(`\n${type.toUpperCase()}:`);
      arr.forEach((slip, i) => {
        console.log(`  Slip ${i + 1}:`);
        slip.forEach(p => console.log(`    - ${p.player} (${p.team})`));
      });
    });

    console.log("\n✅ READY TO BET\n");

  } catch (e) {
    console.error("[RUN ERROR]", e);
  }
}

runAll();

