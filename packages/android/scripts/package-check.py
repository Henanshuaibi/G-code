from pathlib import Path
import hashlib,io,json,re,subprocess,zipfile,xml.etree.ElementTree as E
root=Path(__file__).resolve().parents[1];apk=root/'build/G-code-0.13.apk';ns='{http://schemas.android.com/apk/res/android}'
manifest=E.parse(root/'android/AndroidManifest.xml').getroot()
assert manifest.attrib['package']=='cn.g.opencode' and manifest.attrib[ns+'versionCode']=='13'
assert manifest.find('uses-sdk').attrib[ns+'minSdkVersion']=='30'
assert manifest.find('application').attrib[ns+'extractNativeLibs']=='true'
assert manifest.find('application').attrib[ns+'allowBackup']=='false'
assert not manifest.find('queries').findall('package')
query=manifest.find('queries/intent');assert query.find('action').attrib[ns+'name']=='android.intent.action.MAIN' and query.find('category').attrib[ns+'name']=='android.intent.category.LAUNCHER'
services={p.attrib[ns+'name']:p for p in manifest.find('application').findall('service')}
assert services['.PhoneControlService'].attrib[ns+'permission']=='android.permission.BIND_ACCESSIBILITY_SERVICE'
accessibility=E.parse(root/'android/res/xml/phone_control.xml').getroot()
assert accessibility.attrib[ns+'canRetrieveWindowContent']=='true'
assert accessibility.attrib[ns+'canPerformGestures']=='true' and accessibility.attrib[ns+'canTakeScreenshot']=='true'
assert ns+'packageNames' not in accessibility.attrib
assert 'flagRetrieveInteractiveWindows' in accessibility.attrib[ns+'accessibilityFlags']
old_apk=root.parents[2]/'G-code-0.12.apk'
assert {p.attrib[ns+'name'] for p in manifest.findall('uses-permission')}=={'android.permission.INTERNET','android.permission.FOREGROUND_SERVICE','android.permission.FOREGROUND_SERVICE_DATA_SYNC'}
certs=subprocess.check_output(['apksigner','verify','--print-certs',str(apk)],text=True)
cert=re.search(r'certificate SHA-256 digest: ([a-f0-9]+)',certs).group(1)
assert cert==(root/'signing-certificate.sha256').read_text().strip()
if old_apk.exists():assert cert in subprocess.check_output(['apksigner','verify','--print-certs',str(old_apk)],text=True)
old=root.parents[2]/'G-studio-0.9.apk'
if old.exists():assert cert not in subprocess.check_output(['apksigner','verify','--print-certs',str(old)],text=True)
secret=(root/'tools/signing-password').read_bytes().strip()
with zipfile.ZipFile(apk) as archive:
 assert archive.testzip() is None
 assert not any(n.endswith(('.keystore','.jks')) or 'signing-password' in n for n in archive.namelist())
 dex=archive.read('classes.dex');assert b'openChatGPT' in dex and b'auth.openai.com' in dex;assert b'MediaMetadataRetriever' in dex and b'BitmapFactory' in dex and b'attachmentStatus' in dex and b'video/*' in dex and b'OpenCode Mobile' not in dex and b'Lcn/g/opencode/UiAppearance;' in dex and b'Lcn/g/opencode/ControlRequest;' in dex and b'Lcn/g/opencode/ScreenFrame;' in dex and b'CompletableFuture' in dex and b'restartEngine' in dex and b'Lcn/g/opencode/PhoneControlService;' in dex and b'Lcn/g/opencode/ControlGate;' in dex;assert secret not in dex and b'RecognizerIntent' not in dex and b'importProject' not in dex and b'exportProject' not in dex
 content=archive.read('assets/engine.zip');assert hashlib.sha256(content).hexdigest()==archive.read('assets/engine.sha256').decode().strip()
 with zipfile.ZipFile(io.BytesIO(content)) as bundle:
  assert bundle.testzip() is None
  for file in ['src/server.mjs','src/engine.mjs','src/chatgpt.mjs','src/pty.cjs','src/device.mjs','src/run-state.mjs','src/profiles.mjs','src/media.mjs','src/video-download.mjs','src/attachments.mjs','src/http-body.mjs','web/index.html','web/app.js','web/request.js','web/drafts.js','web/usage.js','web/render-cache.js','web/appearance.js','web/style.css']:assert bundle.read(file)==(root/file).read_bytes(),file
  assert json.loads(bundle.read('node_modules/@opencode/sdk/package.json'))['version']=='2.0.32'
  assert 'licenses/OpenCode-LICENSE' in bundle.namelist()
  for name in ['src/server.mjs','src/engine.mjs','web/app.js','web/index.html']:assert secret not in bundle.read(name) and b'test-api-key-not-real' not in bundle.read(name)
 for runtime in json.loads((root/'build/runtime-manifest.json').read_text()):
  name='lib/arm64-v8a/'+runtime['file'];assert hashlib.sha256(archive.read(name)).hexdigest()==runtime['sha256']
badging=subprocess.check_output(['aapt2','dump','badging',str(apk)],text=True)
assert "package: name='cn.g.opencode' versionCode='13' versionName='0.13'" in badging
assert "application-label:'G code'" in badging and "native-code: 'arm64-v8a'" in badging
subprocess.run(['apksigner','verify','--verbose',str(apk)],check=True)
subprocess.run(['zipalign','-c','4',str(apk)],check=True)
print('PASS: APK identity, arm64 runtime integrity, original SDK source/version, private signing, permissions, engine assets, signature and alignment')
