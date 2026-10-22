#!/data/data/com.termux/files/usr/bin/sh
set -eu
cd "$(dirname "$0")/.."
mkdir -p build/test-deps build/profile-test/classes
python3 - <<'PY'
from pathlib import Path
import hashlib,urllib.request
p=Path('build/test-deps/json-20240303.jar');digest='3cf6cd6892e32e2b4c1c39e0f52f5248a2f5b37646fdfbb79a66b46b618414ed'
if not p.exists():p.write_bytes(urllib.request.urlopen('https://repo.maven.apache.org/maven2/org/json/json/20240303/json-20240303.jar',timeout=20).read())
assert hashlib.sha256(p.read_bytes()).hexdigest()==digest,'Test-only JSON-java dependency integrity mismatch'
PY
javac --release 8 -encoding UTF-8 -classpath build/test-deps/json-20240303.jar -d build/profile-test/classes android/src/cn/g/opencode/ApiProfiles.java tests/ApiProfilesCheck.java
java -cp build/profile-test/classes:build/test-deps/json-20240303.jar cn.g.opencode.ApiProfilesCheck
