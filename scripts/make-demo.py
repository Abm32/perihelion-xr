#!/usr/bin/env python3
"""Cut the demo video from recorded emulator clips.

Input:  artifacts/rec/<clip>/list.txt  (written by test/rec.mjs; see scripts/demo-lib.sh)
Output: perihelion-demo.mp4

Every gameplay frame is a real capture of the running app in the IWSDK
emulator. Captions, title cards and a soft synthesized pad are added here.
"""
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REC = os.path.join(ROOT, "artifacts", "rec")
OUT = os.path.join(REC, "cut")
FONT = "/usr/share/fonts/noto/NotoSans-Bold.ttf"
ENC = ["-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p", "-r", "30", "-an"]
os.makedirs(OUT, exist_ok=True)


def run(args):
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True)


def text(name, body):
    path = os.path.join(OUT, name + ".txt")
    with open(path, "w") as f:
        f.write(body)
    return path


def caption(name, body, start, end, size=30, y="h-76"):
    return (
        f"drawtext=fontfile={FONT}:textfile={text(name, body)}:fontsize={size}:fontcolor=white:"
        f"box=1:boxcolor=black@0.62:boxborderw=12:x=(w-text_w)/2:y={y}:enable='between(t,{start},{end})'"
    )


# clip, start, end (seconds in the raw recording), corner label, pre-filter, captions [(text, from, to)]
SHOTS = [
    ("a_level1", 1.5, 14.5, "IWSDK emulator, Quest 3 profile", "", [
        ("Before your first shot, a ghost shows the move.", 0, 5.4),
        ("Pinch the comet. Pull back. Let go.", 5.4, 13),
    ]),
    # The empty sky, cut in three to drop the pauses between actions.
    ("b_void", 1.0, 8.0, "IWSDK emulator, Quest 3 profile", "", [
        ("Level two is an empty sky. Nothing here has gravity.", 0, 4.4),
        ("So the comet flies straight into the rock. No path exists.", 4.4, 7),
    ]),
    ("b_void", 10.5, 17.0, "IWSDK emulator, Quest 3 profile", "", [
        ("Make one. Pinch the air to plant gravity.", 0, 6.5),
    ]),
    ("b_void", 20.5, 29.6, "IWSDK emulator, Quest 3 profile", "", [
        ("You are the gravity.", 0, 9.1),
    ]),
    ("c_cup", 1.5, 22.0, "IWSDK emulator, Quest 3 profile", "", [
        ("It plays on your real desk.", 0, 4.6),
        ("It scans the desk with live depth. That cup has gravity now.", 4.6, 11.2),
        ("Real objects bend the comet. Move the cup, change the puzzle.", 11.2, 20.5),
    ]),
    ("d_blackhole", 1.5, 13.5, "IWSDK emulator, Quest 3 profile", "", [
        ("Level three. A black hole, and a moon that moves only while the comet flies.", 0, 5.6),
        ("Slow motion at perihelion. Three new skies every day.", 5.6, 12),
    ]),
    ("f_flat", 1.5, 16.5, "Desktop browser", "crop=1000:562:140:44,scale=1280:720,", [
        ("No headset? Same game with a mouse, a webcam, or an Android phone in AR.", 0, 15),
    ]),
]

parts = []

# Title card
title = os.path.join(OUT, "00_title.mp4")
run(["-f", "lavfi", "-i", "color=c=0x05070d:s=1280x720:d=4.2:r=30", "-vf", ",".join([
    f"drawtext=fontfile={FONT}:textfile={text('t1', 'PERIHELION')}:fontsize=92:fontcolor=white:x=(w-text_w)/2:y=230",
    f"drawtext=fontfile={FONT}:textfile={text('t2', 'You are the gravity.')}:fontsize=44:fontcolor=0xffd76b:x=(w-text_w)/2:y=350",
    f"drawtext=fontfile={FONT}:textfile={text('t3', 'A hands-first daily gravity puzzle for Meta Quest, built with the Immersive Web SDK')}:fontsize=24:fontcolor=0x9fb8ff:x=(w-text_w)/2:y=440",
    "fade=t=in:st=0:d=0.5", "fade=t=out:st=3.7:d=0.5",
]), *ENC, title])
parts.append(title)

for i, (clip, a, b, label, pre, caps) in enumerate(SHOTS, 1):
    raw = os.path.join(OUT, clip + "_raw.mp4")
    if not os.path.exists(raw) or "--recut" in sys.argv:
        run(["-f", "concat", "-safe", "0", "-i", os.path.join(REC, clip, "list.txt"),
             "-vf", "fps=30,scale=1280:720", *ENC, raw])
    d = b - a
    filters = [
        # Cover the emulator's own toolbar (top right) and, on the desktop shot, the
        # self-measurement line (top left): it holds emulator numbers, not a device's.
        "drawbox=x=1010:y=0:w=270:h=34:color=0x05070d@0.92:t=fill",
        f"drawtext=fontfile={FONT}:textfile={text(f'l{i}', label)}:fontsize=15:fontcolor=0x9fb8ff:x=w-text_w-14:y=9",
    ]
    if clip == "f_flat":
        filters.insert(0, "drawbox=x=0:y=0:w=300:h=40:color=0x0b0b0b:t=fill")
    filters += [caption(f"c{i}_{k}", t, s, e, size=26 if len(t) > 60 else 30) for k, (t, s, e) in enumerate(caps)]
    filters += ["fade=t=in:st=0:d=0.35", f"fade=t=out:st={d - 0.35:.2f}:d=0.35"]
    seg = os.path.join(OUT, f"{i:02d}_{clip}.mp4")
    run(["-ss", str(a), "-t", str(d), "-i", raw, "-vf", pre + ",".join(filters), *ENC, seg])
    parts.append(seg)

# End card
end = os.path.join(OUT, "99_end.mp4")
run(["-f", "lavfi", "-i", "color=c=0x05070d:s=1280x720:d=5.5:r=30", "-vf", ",".join([
    f"drawtext=fontfile={FONT}:textfile={text('e1', 'PERIHELION')}:fontsize=64:fontcolor=white:x=(w-text_w)/2:y=190",
    f"drawtext=fontfile={FONT}:textfile={text('e2', 'perihelion-three.vercel.app')}:fontsize=40:fontcolor=0xffd76b:x=(w-text_w)/2:y=300",
    f"drawtext=fontfile={FONT}:textfile={text('e3', 'Hands only.  Seated.  One gesture.')}:fontsize=28:fontcolor=white:x=(w-text_w)/2:y=390",
    f"drawtext=fontfile={FONT}:textfile={text('e4', 'Every level is solved before you see it. Every pixel and sound is generated in code.')}:fontsize=22:fontcolor=0x9fb8ff:x=(w-text_w)/2:y=450",
    f"drawtext=fontfile={FONT}:textfile={text('e5', 'Gameplay captured in the IWSDK emulator and a desktop browser.')}:fontsize=18:fontcolor=0x6f7f9f:x=(w-text_w)/2:y=640",
    "fade=t=in:st=0:d=0.5", "fade=t=out:st=5.0:d=0.5",
]), *ENC, end])
parts.append(end)

listing = os.path.join(OUT, "parts.txt")
with open(listing, "w") as f:
    f.writelines(f"file '{p}'\n" for p in parts)
silent = os.path.join(OUT, "silent.mp4")
run(["-f", "concat", "-safe", "0", "-i", listing, "-c", "copy", silent])

total = float(subprocess.check_output(
    ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", silent]).decode())
# A quiet synthesized pad (A major: A2, E3, A3, C#4), each voice breathing slowly. No samples.
pad = "+".join(f"{g}*sin(2*PI*{f}*t)*(0.6+0.4*sin(2*PI*{l}*t))" for f, g, l in
               [(110, 0.5, 0.07), (164.81, 0.35, 0.05), (220, 0.3, 0.09), (277.18, 0.18, 0.04)])
final = os.path.join(ROOT, "perihelion-demo.mp4")
run(["-i", silent, "-f", "lavfi", "-i", f"aevalsrc='{pad}':s=44100:d={total:.2f}",
     "-af", f"lowpass=f=900,volume=0.16,afade=t=in:d=2,afade=t=out:st={total - 2.5:.2f}:d=2.5",
     "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart", final])
print(f"{final}  {total:.1f} s  {os.path.getsize(final) / 1e6:.1f} MB")
