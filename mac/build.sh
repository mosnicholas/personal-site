#!/bin/sh
# Builds Likes.app (the menu bar app) into mac/build; `--install` also copies
# it to /Applications and opens it. Needs only Apple's command line tools.
set -e
cd "$(dirname "$0")"
swift build -c release
app=build/Likes.app
rm -rf "$app"
mkdir -p "$app/Contents/MacOS"
cp .build/release/Likes "$app/Contents/MacOS/Likes"
cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>fyi.nimo.likes</string>
  <key>CFBundleName</key><string>Likes</string>
  <key>CFBundleExecutable</key><string>Likes</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
PLIST
codesign --force --sign - "$app"
echo "Built $app"
if [ "$1" = "--install" ]; then
  pkill -x Likes || true
  rm -rf /Applications/Likes.app
  cp -R "$app" /Applications/
  open /Applications/Likes.app
  echo "Installed /Applications/Likes.app"
fi
