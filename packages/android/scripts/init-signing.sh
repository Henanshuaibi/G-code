#!/data/data/com.termux/files/usr/bin/sh
set -eu
cd "$(dirname "$0")/.."
if [ -e tools/mobile.keystore ] || [ -e signing-certificate.sha256 ]; then echo '已存在签名身份，拒绝覆盖。' >&2; exit 1; fi
mkdir -p tools
python3 -c 'import secrets,pathlib; p=pathlib.Path("tools/signing-password"); p.write_text(secrets.token_hex(24)); p.chmod(0o600)'
keytool -genkeypair -keystore tools/mobile.keystore -storepass:file tools/signing-password -keypass:file tools/signing-password -alias mobile -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=OpenCode Mobile Unofficial, O=Local Android Port' >/dev/null 2>&1
chmod 600 tools/mobile.keystore
keytool -exportcert -keystore tools/mobile.keystore -storepass:file tools/signing-password -alias mobile 2>/dev/null | sha256sum | cut -d ' ' -f 1 > signing-certificate.sha256
