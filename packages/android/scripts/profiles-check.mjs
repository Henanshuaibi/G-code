import assert from 'node:assert/strict';
import {profiles} from '../src/profiles.mjs';
const legacy={base:'https://relay.example/v1',model:'old-model',key:'fake-only'};
assert.deepEqual(profiles(legacy).selected,{providerID:'mobile',id:'old-model'});assert.equal(profiles(legacy).providers[0].key,'fake-only');assert(!legacy.providers);
const config={providers:[{id:'a',models:['same','second']},{id:'b',models:['same']}],defaultModel:{providerID:'b',id:'same'}};
assert.equal(profiles(config).choices.length,3);assert.deepEqual(profiles(config).selected,{providerID:'b',id:'same'});
assert.deepEqual(profiles({...config,defaultModel:{providerID:'deleted',id:'same'}}).selected,{providerID:'a',id:'same'});assert.equal(profiles({}).selected,undefined);
console.log('PASS: legacy engine configuration, multiple providers, identical model IDs kept separate and default fallback');
