#!/usr/bin/env python3
"""Bundle the installed Android Node runtime with its own ELF dependencies.

The resulting files use Android's native-library extraction directory. Runtime
execution has no dependency on the build machine's Termux installation paths.
"""
from pathlib import Path
import hashlib,json,os,re,shutil,subprocess
root=Path(__file__).resolve().parents[1]
prefix=Path(shutil.which('node')).resolve().parent.parent
out=root/'build/native/arm64-v8a';out.mkdir(parents=True,exist_ok=True)
system={'libc.so','libm.so','libdl.so','liblog.so','libandroid.so'}
def dynamic(file):
 text=subprocess.check_output(['readelf','-d',str(file)],text=True)
 return re.findall(r'NEEDED.*?\[(.*?)\]',text),re.findall(r'(?:RUNPATH|RPATH).*?\[(.*?)\]',text)
def name(file):return re.sub(r'\.so(?:\.\d+)+$','.so',file)
queue=[Path(shutil.which('node')).resolve()];seen=set();record=[]
while queue:
 source=queue.pop(0)
 if source in seen:continue
 seen.add(source)
 needed,paths=dynamic(source);data=source.read_bytes()
 own=re.findall(r'SONAME.*?\[(.*?)\]',subprocess.check_output(['readelf','-d',str(source)],text=True))
 for lib in needed+own:
  if lib in system:continue
  if lib in needed:
   dependency=(prefix/'lib'/lib).resolve()
   if not dependency.is_file():raise RuntimeError('Missing runtime dependency: '+lib)
   queue.append(dependency)
  target=name(lib)
  old=lib.encode()+b'\0';new=target.encode()+b'\0'
  assert len(new)<=len(old)
  data=data.replace(old,new+b'\0'*(len(old)-len(new)))
 for path in paths:
  old=path.encode()+b'\0';new=b'$ORIGIN\0'
  assert len(new)<=len(old)
  data=data.replace(old,new+b'\0'*(len(old)-len(new)))
 target=out/('libnode-runtime.so' if source==Path(shutil.which('node')).resolve() else name(source.name))
 target.write_bytes(data);target.chmod(0o755)
 record.append({'file':target.name,'source':str(source),'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)})
# Prove that the packaged files resolve each other with the normal Termux environment removed.
probe=root/'build/runtime-probe';probe.mkdir(exist_ok=True)
env={'HOME':str(probe),'TMPDIR':str(probe),'PATH':'/system/bin','LD_LIBRARY_PATH':str(out),'OPENSSL_CONF':'/dev/null'}
result=subprocess.check_output([str(out/'libnode-runtime.so'),'--no-warnings','-e',"const s=require('node:sqlite');const d=new s.DatabaseSync(':memory:');d.exec('CREATE TABLE t(x)'); console.log(JSON.stringify({node:process.version,platform:process.platform,sqlite:d.prepare('SELECT 1 AS ok').get().ok,home:process.env.HOME}));"],env=env,text=True)
print(result.strip())
(root/'build/runtime-manifest.json').write_text(json.dumps(record,indent=2)+'\n')
print('Bundled',len(record),'runtime files,',sum(x['bytes'] for x in record),'bytes')
