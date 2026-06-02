# Autopilot LaunchAgents (Phase Cron-To-LaunchAgent-1A, 2026-06-02)

**Independent, redundant fire paths for every critical autopilot.**

## Why this exists

Tonight (2026-06-02) proved that macOS cron is broken on this Mac — entries with FDA granted to `/usr/sbin/cron` STILL don't fire (TCC inheritance issue). Scheduler.sh is now the SOLE autopilot mechanism, which is too brittle (one bug → 14-hour outage).

This directory installs a SECOND independent fire path: one LaunchAgent per autopilot, each with its own `StartCalendarInterval`. LaunchAgents inherit launchd's permissions cleanly and work reliably from `~/Projects/`.

## The 5 autopilots

| Autopilot | Plist | Time | What it does |
|---|---|---|---|
| populator-chain | `com.motel666.populator-chain` | 3:05 AM daily | 5 populators in sequence (MLB stats/logs, NBA DvP+team stats) |
| grading-nightly | `com.motel666.grading-nightly` | 4:00 AM daily | Refreshes calibration corpus with last night's outcomes |
| audit-nightly | `com.motel666.audit-nightly` | 5:00 AM daily | Writes daily proof report |
| slate-mlb-hourly | `com.motel666.slate-mlb-hourly` | 9 AM - 11 PM hourly | MLB slate refresh (15 fires/day) |
| slate-nba-30min | `com.motel666.slate-nba-30min` | 4 PM - 11:30 PM every 30 min | NBA slate refresh (16 fires/day) |

## Layering with scheduler.sh

**Both fire** — npm scripts are idempotent so double-fires are no-ops, not corruption.

- **scheduler.sh** (primary): also fires these autopilots at the same times via its own logic
- **LaunchAgent autopilots** (redundancy): independent fire path — if scheduler.sh crashes, dies, or has a bug, these still fire

If scheduler.sh fires at 4:00 AM AND grading-nightly LaunchAgent also fires at 4:00 AM, the second invocation no-ops because the grading-backfill-all script checks "did we already grade this date" via SQLite count.

## Install

```bash
bash /Users/andrewmoore/Projects/betting-dashboard/backend/scripts/autopilots/install-autopilots.sh
```

## Uninstall

```bash
bash /Users/andrewmoore/Projects/betting-dashboard/backend/scripts/autopilots/uninstall-autopilots.sh
```

## Logs

All autopilot output appends to `.scratch/autopilot.log` with timestamps. Each entry has the autopilot name + start/end markers + exit code.

## Verify

After install, check with:

```bash
launchctl list | grep com.motel666
```

Should show 4 original agents (backend, scheduler, caffeinate, cloudflared) PLUS 5 new autopilot agents.

## When to use this

This is the **macOS-native cron replacement**. It's independent of `scheduler.sh` and `/usr/sbin/cron`. Use this any time you need a scheduled job that:

- Must fire reliably from `~/Projects/` (works — non-protected folder)
- Can survive a single-process failure
- Inherits launchd's permission model (FDA grants etc.)
