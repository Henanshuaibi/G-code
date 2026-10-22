import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
const entry=process.env.OPENCODE_TEST_ENTRY?new URL('file://'+path.join(path.dirname(path.dirname(process.env.OPENCODE_TEST_ENTRY)),'web/appearance.js')):new URL('../web/appearance.js',import.meta.url);
const {appearance,defaultAppearance,loadAppearance,themeFor}=await import(entry);
assert.equal(themeFor(loadAppearance('')).background,'#ffffff');assert.equal(themeFor(defaultAppearance).foreground,'#111111');
assert.equal(themeFor({...defaultAppearance,mode:'system'},false).background,'#ffffff');assert.notEqual(themeFor({...defaultAppearance,mode:'system'},true).background,'#ffffff');assert.equal(themeFor({...defaultAppearance,mode:'light'},true).background,'#ffffff');
const folder=await mkdtemp(path.resolve('build/appearance-test-'));
try{
  const custom=appearance({mode:'custom',background:'#F6F8FA',foreground:'#17202A',accent:'#0066CC',fontSize:19,radius:4});const file=path.join(folder,'ui.json');await writeFile(file,JSON.stringify(custom));const loaded=loadAppearance(await readFile(file,'utf8'));assert.deepEqual(loaded,custom);assert.equal(themeFor(loaded).background,'#f6f8fa');assert.equal(themeFor(loaded).tokens['--font-size'],'19px');assert.equal(themeFor(loaded).tokens['--radius'],'4px');
  const dark=appearance({...loaded,mode:'dark'});assert.equal(appearance({...dark,mode:'custom'}).background,custom.background);assert.equal(themeFor(dark).dark,true);
  for(const invalid of [{mode:'custom',background:'#fff'},{mode:'custom',accent:'red; background:url(https://example.invalid)'},{mode:'custom',foreground:'#ffffff'},{fontSize:100},{radius:-1},{mode:'bad'}])assert.throws(()=>appearance(invalid));
  assert.deepEqual(loadAppearance('{broken'),appearance());assert.deepEqual(loadAppearance('{"mode":"custom","background":"url(x)"}'),appearance());assert.equal(appearance({mode:'light',background:'invalid temporary field'}).background,'#ffffff');
  for(const mode of ['light','dark','system','custom'])for(const systemDark of [false,true]){const theme=themeFor({...custom,mode},systemDark);for(const value of Object.values(theme.tokens))assert(!/undefined|NaN|url\(|;/.test(value));}
  console.log('PASS: packaged appearance preferences: white/black default, system switching, persisted custom colors/font/radius, preset round-trip, malformed storage fallback and invalid/unreadable color rejection');
}finally{await rm(folder,{recursive:true,force:true});}
