#!/data/data/com.termux/files/usr/bin/sh
set -eu
cd "$(dirname "$0")/.."
mkdir -p build/control-test/classes
javac --release 8 -encoding UTF-8 -d build/control-test/classes android/src/cn/g/opencode/ControlGate.java tests/ControlGateCheck.java android/src/cn/g/opencode/ScreenFrame.java tests/ScreenFrameCheck.java android/src/cn/g/opencode/ControlRequest.java tests/ControlRequestCheck.java
java -cp build/control-test/classes cn.g.opencode.ControlGateCheck
java -cp build/control-test/classes cn.g.opencode.ScreenFrameCheck
java -cp build/control-test/classes cn.g.opencode.ControlRequestCheck
