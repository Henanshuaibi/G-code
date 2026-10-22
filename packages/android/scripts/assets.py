#!/usr/bin/env python3
from pathlib import Path
import hashlib,json,zipfile,subprocess
root=Path(__file__).resolve().parents[1]
assets=root/'android/assets';assets.mkdir(parents=True,exist_ok=True)
license_dir=root/'build/licenses';license_dir.mkdir(parents=True,exist_ok=True)
(license_dir/'OpenCode-LICENSE').write_bytes((root.parents[1]/'LICENSE').read_bytes())
manifest=json.loads((root/'build/runtime-manifest.json').read_text())
packages=set()
for item in manifest:
 try:
  owner=subprocess.check_output(['dpkg-query','-S',item['source']],text=True).split(':',1)[0];packages.add(owner)
 except subprocess.CalledProcessError:pass
prefix=Path('/data/data/com.termux/files/usr')
for package in packages:
 doc=prefix/'share/doc'/package/'copyright'
 if doc.is_file():(license_dir/(package+'-copyright')).write_bytes(doc.read_bytes())
(license_dir/'RUNTIME-SOURCES.txt').write_text('Android runtime built by Termux. Packages: '+', '.join(sorted(packages))+'\nSources and build recipes: https://github.com/termux/termux-packages/tree/master/packages\nNode.js: https://nodejs.org/ and https://github.com/termux/termux-packages/tree/master/packages/nodejs\nLibraries: OpenSSL, ICU, c-ares, SQLite, libffi, zlib, libc++. See package copyrights.\n')
files=[]
for directory in ['src','web','node_modules']:
 for file in (root/directory).rglob('*'):
  if not file.is_file() or file.is_symlink():continue
  relative=file.relative_to(root);parts=relative.parts
  if any(p in ['.git','.cache','test','tests','__tests__','.github'] for p in parts):continue
  if file.name.endswith(('.map','.d.ts','.d.mts','.d.cts')):continue
  if file.name=='probe.mjs':continue
  # Non-Android native binaries are not part of this runtime profile.
  if any(p.startswith(('linux-','darwin-','win32-')) for p in parts) and file.suffix in ['.node','.so','.dll','.exe']:continue
  files.append((file,relative.as_posix()))
files.extend((file,'licenses/'+file.name) for file in license_dir.iterdir() if file.is_file())
archive=assets/'engine.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as zip:
 for file,relative in sorted(files):zip.write(file,relative)
with zipfile.ZipFile(archive) as zip:assert zip.testzip() is None
(assets/'engine.sha256').write_text(hashlib.sha256(archive.read_bytes()).hexdigest()+'\n')
print('Engine bundle:',len(files),'files,',archive.stat().st_size,'bytes')
