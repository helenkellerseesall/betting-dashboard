#!/bin/bash
# Label sample outcomes for backtest

API="http://localhost:4000"

# Function to label an outcome
label_leg() {
  local event=$1
  local player=$2
  local prop=$3
  local side=$4
  local line=$5
  local book=$6
  local outcome=$7
  
  curl -s -X POST "$API/label-outcome" \
    -H "Content-Type: application/json" \
    -d "{\"eventId\":\"$event\",\"player\":\"$player\",\"propType\":\"$prop\",\"side\":\"$side\",\"line\":$line,\"book\":\"$book\",\"outcome\":$outcome}" \
    > /dev/null && echo "✓ Labeled $player $prop $side $line = $outcome"
}

echo "Labeling sample outcomes for backtest..."
echo ""

# Sample outcomes (generated pseudo-randomly based on hit rates)
label_leg "97559ed79c99e86d90fc2f9d2059e761" "LaMelo Ball" "Assists" "Over" "6.5" "DraftKings" "1"
label_leg "97559ed79c99e86d90fc2f9d2059e761" "LaMelo Ball" "Assists" "Over" "6.5" "FanDuel" "1"
label_leg "97559ed79c99e86d90fc2f9d2059e761" "LaMelo Ball" "Assists" "Under" "6.5" "DraftKings" "0"
label_leg "97559ed79c99e86d90fc2f9d2059e761" "LaMelo Ball" "Assists" "Under" "6.5" "FanDuel" "0"

label_leg "97559ed79c99e86d90fc2f9d2059e761" "Davion Mitchell" "Assists" "Over" "5.5" "DraftKings" "1"
label_leg "97559ed79c99e86d90fc2f9d2059e761" "Davion Mitchell" "Assists" "Over" "5.5" "FanDuel" "0"
label_leg "97559ed79c99e86d90fc2f9d2059e761" "Davion Mitchell" "Assists" "Under" "5.5" "DraftKings" "0"
label_leg "97559ed79c99e86d90fc2f9d2059e761" "Davion Mitchell" "Assists" "Under" "5.5" "FanDuel" "1"

label_leg "97559ed79c99e86d90fc2f9d2059e761" "Tyler Herro" "Assists" "Over" "4.5" "DraftKings" "1"
label_leg "97559ed79c99e86d90fc2f9d2059e761" "Tyler Herro" "Assists" "Over" "4.5" "FanDuel" "1"

label_leg "97559ed79c99e86d90fc2f9d2059e761" "Cody Martin" "Assists" "Over" "2.5" "DraftKings" "0"
label_leg "97559ed79c99e86d90fc2f9d2059e761" "Cody Martin" "Assists" "Over" "2.5" "FanDuel" "0"

label_leg "97559ed79c99e86d90fc2f9d2059e761" "Brandon Miller" "Points" "Over" "20.5" "DraftKings" "1"
label_leg "97559ed79c99e86d90fc2f9d2059e761" "Brandon Miller" "Points" "Over" "20.5" "FanDuel" "1"

label_leg "97559ed79c99e86d90fc2f9d2059e761" "Nick Richards" "Rebounds" "Over" "8.5" "DraftKings" "0"
label_leg "97559ed79c99e86d90fc2f9d2059e761" "Nick Richards" "Rebounds" "Over" "8.5" "FanDuel" "1"

label_leg "97559ed79c99e86d90fc2f9d2059e761" "Caleb Martin" "Points" "Over" "12.5" "DraftKings" "1"
label_leg "97559ed79c99e86d90fc2f9d2059e761" "Caleb Martin" "Points" "Over" "12.5" "FanDuel" "0"

label_leg "97559ed79c99e86d90fc2f9d2059e761" "Tidjane Salaun" "Points" "Over" "15.5" "DraftKings" "1"
label_leg "97559ed79c99e86d90fc2f9d2059e761" "Tidjane Salaun" "Points" "Over" "15.5" "FanDuel" "1"

label_leg "97559ed79c99e86d90fc2f9d2059e761" "Ish Smith" "Assists" "Over" "3.5" "DraftKings" "1"
label_leg "97559ed79c99e86d90fc2f9d2059e761" "Ish Smith" "Assists" "Over" "3.5" "FanDuel" "0"

echo ""
echo "Sample labeling complete. Ready to backtest."
