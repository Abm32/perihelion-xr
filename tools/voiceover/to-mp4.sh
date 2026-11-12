#!/usr/bin/env bash
# Convert a take from the voice-over studio (WebM) to an MP4 that every site accepts.
#   tools/voiceover/to-mp4.sh ~/Downloads/perihelion-voiceover.webm [out.mp4]
set -euo pipefail
in="${1:?usage: to-mp4.sh take.webm [out.mp4]}"
out="${2:-${in%.*}.mp4}"
# WebM from MediaRecorder has variable frame timing; resample to a constant 30 fps.
ffmpeg -v error -y -i "$in" -vf "fps=30,format=yuv420p" -c:v libx264 -crf 18 -preset medium \
  -c:a aac -b:a 160k -movflags +faststart "$out"
ffprobe -v error -show_entries format=duration,size -of default=nw=1 "$out"
echo "$out"
