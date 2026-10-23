// Reuse unchanged message/media nodes so streaming one reply does not rebuild its history.
export class RenderCache {
  constructor(){this.items=new Map();}
  get(id,value,build,immutable=false){
    const previous=this.items.get(id);if(immutable&&previous?.value===value)return previous.node;
    const signature=JSON.stringify(value);
    if(previous?.signature===signature){previous.value=value;return previous.node;}
    const node=build(value,previous?.node);this.items.set(id,{signature,node,value});return node;
  }
  retain(ids){const keep=new Set(ids);for(const id of this.items.keys())if(!keep.has(id))this.items.delete(id);}
  clear(){this.items.clear();}
}
export function reconcileChildren(parent,nodes){
  let next=parent.firstChild;
  for(const node of nodes){if(node===next)next=next.nextSibling;else parent.insertBefore(node,next);}
  while(next){const remove=next;next=next.nextSibling;parent.removeChild(remove);}
}
