#!/bin/bash
f="$1"; n=$(basename "$f" .webm)
read a p <<< $(ffprobe -v error -f lavfi "movie=$f,tblend=all_mode=difference,signalstats" \
  -show_entries frame_tags=lavfi.signalstats.YAVG -of csv=p=0 2>/dev/null \
  | awk 'NF{s+=$1;c++;if($1>m)m=$1} END{printf "%.4f %.3f",(c?s/c:0),m}')
printf "%s\t%s\t%s\t%s\n" "$n" "$a" "$p" "$(stat -f%z "$f")"
