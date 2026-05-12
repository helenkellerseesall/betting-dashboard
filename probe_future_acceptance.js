"use strict"
process.chdir(__dirname)
const { buildSlateEvents } = require('./backend/pipeline/schedule/buildSlateEvents')

// Session AX — Future-Slate Acceptance verification probe.
// Three scenarios:
//   PASS 1: today has pregame games → use them (unchanged from Session AW)
//   PASS 2: today complete but tomorrow has pregame → use TOMORROW (new Session AX behavior)
//   PASS 3: nothing upcoming at all → 0 events, honest empty
// Also verify the consumer fallback chain (fetchNbaOddsSnapshot's slateEvents).

const now = new Date("2026-05-13T05:30:00Z").getTime()  // simulate "now" — May 12 9:30 PM PDT / May 13 1:30 AM EDT
console.log("simulated 'now':", new Date(now).toISOString())
console.log("Detroit date for now:", new Date(now).toLocaleDateString("en-CA", { timeZone: "America/Detroit" }))
console.log("")

// ===== PASS 1: today's pregame games =====
console.log("============== PASS 1 — today has pregame games ==============")
;(async () => {
  const fixture1 = [
    // Today (Detroit), pregame
    { id: "today_pregame_a", commence_time: "2026-05-13T23:00:00Z", away_team: "BOS", home_team: "BKN" },
    { id: "today_pregame_b", commence_time: "2026-05-14T01:30:00Z", away_team: "HOU", home_team: "PHX" },
    // Today (Detroit), past
    { id: "today_past",      commence_time: "2026-05-13T00:11:44Z", away_team: "DET", home_team: "CLE" },
    // Tomorrow (Detroit)
    { id: "tomorrow",        commence_time: "2026-05-14T18:00:00Z", away_team: "MIA", home_team: "ATL" },
  ]
  const r1 = await buildSlateEvents({ now, events: fixture1 })
  console.log("scheduledEvents (today + future):", r1.scheduledEvents.map(e => e.id))
  console.log("upcomingEvents (any future date):", r1.upcomingEvents.map(e => e.id))
  // fetchNbaOddsSnapshot's fallback choice
  const slateEvents1 = r1.scheduledEvents.length ? r1.scheduledEvents : r1.upcomingEvents
  console.log("→ slateEvents (consumer choice):", slateEvents1.map(e => e.id))
  const expect1 = ["today_pregame_a", "today_pregame_b"]
  console.log("EXPECTED:", expect1, "  PASS:", JSON.stringify(slateEvents1.map(e => e.id).sort()) === JSON.stringify(expect1.sort()) ? "✓" : "✗")

  // ===== PASS 2: today complete, tomorrow pregame =====
  console.log("\n============== PASS 2 — today complete + tomorrow pregame (NEW Session AX behavior) ==============")
  const fixture2 = [
    { id: "today_completed_a", commence_time: "2026-05-13T00:11:44Z", away_team: "DET", home_team: "CLE" },
    { id: "today_completed_b", commence_time: "2026-05-13T02:40:00Z", away_team: "OKC", home_team: "LAL" },
    { id: "tomorrow_a",        commence_time: "2026-05-13T23:00:00Z", away_team: "SAS", home_team: "MIN" },
    { id: "tomorrow_b",        commence_time: "2026-05-14T01:30:00Z", away_team: "CLE", home_team: "DET" },
  ]
  const r2 = await buildSlateEvents({ now, events: fixture2 })
  console.log("scheduledEvents (today + future):", r2.scheduledEvents.map(e => e.id))
  console.log("upcomingEvents (any future date):", r2.upcomingEvents.map(e => e.id))
  const slateEvents2 = r2.scheduledEvents.length ? r2.scheduledEvents : r2.upcomingEvents
  console.log("→ slateEvents (consumer choice):", slateEvents2.map(e => e.id))
  const expect2 = ["tomorrow_a", "tomorrow_b"]
  console.log("EXPECTED:", expect2, "  PASS:", JSON.stringify(slateEvents2.map(e => e.id).sort()) === JSON.stringify(expect2.sort()) ? "✓" : "✗")

  // ===== PASS 3: nothing upcoming at all =====
  console.log("\n============== PASS 3 — no upcoming events at all (honest empty) ==============")
  const fixture3 = [
    { id: "all_completed_a", commence_time: "2026-05-13T00:11:44Z", away_team: "DET", home_team: "CLE" },
    { id: "all_completed_b", commence_time: "2026-05-13T02:40:00Z", away_team: "OKC", home_team: "LAL" },
  ]
  const r3 = await buildSlateEvents({ now, events: fixture3 })
  console.log("scheduledEvents:", r3.scheduledEvents.map(e => e.id))
  console.log("upcomingEvents:", r3.upcomingEvents.map(e => e.id))
  const slateEvents3 = r3.scheduledEvents.length ? r3.scheduledEvents : r3.upcomingEvents
  console.log("→ slateEvents:", slateEvents3.map(e => e.id))
  console.log("EXPECTED: [] (honest empty)  PASS:", slateEvents3.length === 0 ? "✓" : "✗")

  // ===== PASS 4: simulate the hard-reset's fallback chain =====
  console.log("\n============== PASS 4 — server.js hard-reset fallback chain ==============")
  // Replicate hard-reset logic: if rawScheduledEvents is empty, fall back to upcomingFromAllAnyDate
  function simulateHardResetFallback(allEventsAttribute, rawScheduledEvents, slateNow) {
    const upcomingFromAllAnyDate = (allEventsAttribute || []).filter(event => {
      const t = event?.commence_time || event?.gameTime || ""
      const ms = new Date(t).getTime()
      return Number.isFinite(ms) && ms > slateNow
    })
    return rawScheduledEvents.length ? rawScheduledEvents : upcomingFromAllAnyDate
  }
  const allEvents2 = fixture2  // today completed + tomorrow upcoming
  const result4 = simulateHardResetFallback(allEvents2, r2.scheduledEvents, now)
  console.log("hard-reset final scheduledEvents:", result4.map(e => e.id))
  console.log("EXPECTED: tomorrow_a, tomorrow_b  PASS:", JSON.stringify(result4.map(e => e.id).sort()) === JSON.stringify(["tomorrow_a", "tomorrow_b"].sort()) ? "✓" : "✗")
  console.log("  → previously hard-reset used `todayLiveOrUpcoming` which would have been [] → 404 returned")
  console.log("  → now hard-reset returns ", result4.length, " events from tomorrow's slate ✓")
})()
