#!/usr/bin/env sh
# ===========================================================================
#  NOCTURNE Key Pass — cross build of the Windows exe from Linux or macOS
#
#  Usage:  ./build.sh
#  Output: dist/NOCTURNE-KeyPass.exe
#
#  Uses MinGW-w64 when installed, otherwise falls back to Zig
#  (zig c++ can target Windows with no extra downloads).
# ===========================================================================
set -e
cd "$(dirname "$0")"

OUT="dist/NOCTURNE-KeyPass.exe"
SRC="src/main.cpp src/nc_core.cpp src/nc_paths.cpp src/nc_draw.cpp src/nc_view.cpp src/nc_platform.cpp"
LIBS="-lgdi32 -luser32 -lgdiplus -ldwmapi -lole32 -lshell32 -lcomctl32"

mkdir -p dist

if command -v x86_64-w64-mingw32-g++ >/dev/null 2>&1; then
    echo "[build] MinGW-w64 found"
    x86_64-w64-mingw32-g++ -std=c++17 -O2 -mwindows -static -o "$OUT" $SRC $LIBS
elif command -v i686-w64-mingw32-g++ >/dev/null 2>&1; then
    echo "[build] MinGW-w64 (32 bit) found"
    i686-w64-mingw32-g++ -std=c++17 -O2 -mwindows -static -o "$OUT" $SRC $LIBS
elif command -v zig >/dev/null 2>&1; then
    echo "[build] Zig found, cross compiling"
    zig c++ -target x86_64-windows-gnu -std=c++17 -O2 -Wno-date-time \
        -Wl,--subsystem,windows -static -o "$OUT" $SRC $LIBS
else
    echo "[build] No Windows C++ compiler found."
    echo "Install one of these and run ./build.sh again:"
    echo "  * mingw-w64   (apt install mingw-w64 / brew install mingw-w64)"
    echo "  * zig         (https://ziglang.org/download/)"
    exit 1
fi

echo "[build] Done: $OUT"
ls -l "$OUT"
