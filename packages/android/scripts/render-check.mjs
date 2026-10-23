import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Element,Text} from 'domhandler';
import {appendChild,prepend,removeElement,textContent} from 'domutils';
const root=process.env.OPENCODE_TEST_ENTRY?path.dirname(path.dirname(process.env.OPENCODE_TEST_ENTRY)):path.resolve('.');
const {RenderCache,reconcileChildren}=await import(pathToFileURL(path.join(root,'web/render-cache.js')));
// Use the installed HTML tree implementation; this is not a browser layout/touch test.
const parent=new Element('section',{});let inserts=0,removes=0,builds=0;
parent.insertBefore=function(node,reference){inserts++;removeElement(node);if(reference)prepend(reference,node);else appendChild(this,node);return node;};
parent.removeChild=function(node){assert.equal(node.parent,this);removes++;removeElement(node);return node;};
const cache=new RenderCache();const build=(item,previous)=>{builds++;const node=new Element('article',{id:item.id,open:previous?.attribs.open??'false'});appendChild(node,new Text(item.text));return node;};
const rows=Array.from({length:500},(_,i)=>({id:'message-'+i,text:'消息 '+i}));
const render=data=>data.map(item=>cache.get(item.id,item,build));
const original=render(rows);original[12].attribs.open='true';reconcileChildren(parent,original);assert.equal(builds,500);assert.equal(inserts,500);inserts=0;removes=0;
reconcileChildren(parent,render(rows.map(item=>({...item}))));assert.equal(builds,500);assert.equal(inserts+removes,0,'Unchanged refresh performs no node replacement or movement');
rows[499].text+=' 更新';const changed=render(rows);reconcileChildren(parent,changed);assert.equal(builds,501);assert.equal(inserts,1);assert.equal(removes,1);assert.equal(parent.children[12],original[12]);assert.equal(parent.children[12].attribs.open,'true');assert.equal(textContent(parent.children[499]),'消息 499 更新');
const moved=[changed[499],changed[0],changed[12]];reconcileChildren(parent,moved);assert.deepEqual(parent.children,moved);assert.equal(moved[2].attribs.open,'true');
cache.retain(rows.slice(0,3).map(item=>item.id));assert.equal(cache.items.size,3);cache.clear();assert.equal(cache.items.size,0);
reconcileChildren(parent,[]);assert.equal(parent.children.length,0);reconcileChildren(parent,[original[0]]);assert.equal(parent.firstChild,original[0]);assert.equal(parent.firstChild.nextSibling,null);
console.log('PASS: 500-message tree: unchanged refresh 0 node operations; one streaming change 1 build + 1 insert/1 removal; existing nodes/state retained; reorder, removal and cache release');

let serializations=0;const immutable={id:'stable',toJSON(){serializations++;return {id:this.id};}};cache.get('stable',immutable,build,true);for(let i=0;i<100;i++)cache.get('stable',immutable,build,true);assert.equal(serializations,1,'Stable history references must not be repeatedly serialized');console.log('PASS: immutable history 100 refreshes perform 1 serialization total');
