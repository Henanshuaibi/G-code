#!/data/data/com.termux/files/usr/bin/sh
set -eu
cd "$(dirname "$0")"
mobile_sdk=${OPENCODE_ANDROID_SDK_DIR:-../../../pulse-player/tools}
if [ ! -f tools/mobile.keystore ] || [ ! -f signing-certificate.sha256 ]; then echo '缺少原始签名。全新项目请先运行 sh scripts/init-signing.sh；已有版本不要重新生成。' >&2; exit 1; fi
mobile_cert=$(keytool -exportcert -keystore tools/mobile.keystore -storepass:file tools/signing-password -alias mobile 2>/dev/null | sha256sum | cut -d ' ' -f 1)
[ "$mobile_cert" = "$(cat signing-certificate.sha256)" ] || { echo '签名不匹配' >&2; exit 1; }
[ -f build/runtime-manifest.json ] || python3 scripts/runtime.py
python3 scripts/assets.py
mkdir -p build/generated build/classes build/dex
find build/classes -name '*.class' -delete
aapt2 compile --dir android/res -o build/res.zip
aapt2 link -I "$mobile_sdk/android-res.jar" --manifest android/AndroidManifest.xml -A android/assets --java build/generated -o build/resources.apk build/res.zip
javac --release 8 -encoding UTF-8 -classpath "$mobile_sdk/android.jar" -d build/classes android/src/cn/g/opencode/*.java build/generated/cn/g/opencode/R.java
jar cf build/classes.jar -C build/classes .
java -Xmx512m -cp "$mobile_sdk/r8.jar" com.android.tools.r8.D8 --lib "$mobile_sdk/android.jar" --min-api 30 --output build/dex build/classes.jar
python3 - <<'PY'
import shutil,zipfile
from pathlib import Path
shutil.copy2('build/resources.apk','build/unsigned.apk')
with zipfile.ZipFile('build/unsigned.apk','a',zipfile.ZIP_DEFLATED) as z:
 z.write('build/dex/classes.dex','classes.dex')
 for p in Path('build/native/arm64-v8a').glob('*.so'):z.write(p,'lib/arm64-v8a/'+p.name)
PY
zipalign -f 4 build/unsigned.apk build/aligned.apk
apksigner sign --ks tools/mobile.keystore --ks-pass file:tools/signing-password --out build/G-code-0.19.apk build/aligned.apk
apksigner verify --verbose build/G-code-0.19.apk
zipalign -c 4 build/G-code-0.19.apk
