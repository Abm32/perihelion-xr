# Helpers for recording the demo in the IWSDK emulator. Sourced by record-demo.sh.
C="npx @iwsdk/cli"
aim() { $C browser run test/live.aim.mjs 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['result'])"; }
field() { python3 -c "import sys,json; d=json.loads(sys.argv[1]); v=d[sys.argv[2]]; print(json.dumps({'x':v[0],'y':v[1],'z':v[2]}) if isinstance(v,list) else v)" "$1" "$2"; }
hand_to() { # hand_to <pos-json> <seconds> [anchor]
  $C xr animate-to --input-json "{\"device\":\"hand-right\",\"position\":$1,\"anchor\":\"${3:-grasp}\",\"duration\":$2,\"easing\":\"minimum-jerk\"}" >/dev/null 2>&1; }
pinch() { $C xr set-select-value --input-json "{\"device\":\"hand-right\",\"value\":$1,\"duration\":0.15}" >/dev/null 2>&1; }
rest() { hand_to "{\"x\":$1,\"y\":0.62,\"z\":-1.2}" 0.5; }
look() { $C xr look-at --input-json "{\"device\":\"headset\",\"target\":{\"x\":$1,\"y\":0.5,\"z\":-1.62}}" >/dev/null 2>&1; }
seat() { $C xr set-transform --input-json "{\"device\":\"headset\",\"position\":{\"x\":$1,\"y\":1.0,\"z\":-1.15},\"orientation\":{\"x\":-0.25,\"y\":0,\"z\":0,\"w\":0.968}}" >/dev/null 2>&1; }
rec_start() { REC=start $C browser run test/rec.mjs >/dev/null 2>&1; }
rec_stop() { REC=stop REC_OUT=$1 $C browser run test/rec.mjs 2>/dev/null | grep -o 'artifacts/rec/[^"]*'; }
shoot() { # pinch the comet at the pad, draw back to <pull-json>, hold, let go
  A=$(aim); hand_to "$(field "$A" pad)" 0.7; pinch 1; sleep 0.25; hand_to "$1" 0.9; sleep 0.7; pinch 0; }
cam() { $C xr set-transform --input-json "{\"device\":\"headset\",\"position\":{\"x\":$1,\"y\":0.9,\"z\":-1.27}}" >/dev/null 2>&1; look "$1"; }
rest() { hand_to "{\"x\":$(python3 -c "print($1+0.33)"),\"y\":0.56,\"z\":-1.22}" 0.5; }
rec() { (REC_OUT=$1 REC_SECONDS=$2 $C browser run test/rec.mjs --timeout 90000 2>&1 | grep -o '"result": "[^"]*"' > artifacts/rec/$1.log) & }
ready() { for i in 1 2 3 4 5 6 7 8 9 10; do A=$(aim); echo "$A" | grep -q "\"phase\":\"aim\",\"index\":$1" && return 0; sleep 1; done; echo "not ready: $A"; return 1; }
# pull without querying the game (the recorder is running): pad and pull are passed in
shoot2() { hand_to "$1" 0.7; pinch 1; sleep 0.25; hand_to "$2" 0.9; sleep 0.7; pinch 0; }
