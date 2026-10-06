/** Prefer a complete specific reference over a name contained inside it.
 * Separate mentions and equal aliases remain ambiguous. Never expands candidates.
 */
export const normalizeReference = (value:string) => value.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export function isProjectSelection(content:string,labels:string[]):boolean {
  const text=` ${normalizeReference(content)} `;
  return labels.some(label=>{
    const name=normalizeReference(label);if(name.length<3||!text.includes(` ${name} `))return false;
    const rest=text.replace(` ${name} `,' ').trim();
    return !rest||rest.split(/\s+/).every(word=>['yes','the','it','s','i','mean','meant','project','please','thanks','that','one'].includes(word));
  });
}
export function matchProjectReferences<T>(content:string,candidates:T[],labels:(candidate:T)=>string[]):T[]{
  const text=` ${normalizeReference(content)} `;
  const spans:Array<{candidate:T;start:number;end:number}>=[];
  for(const candidate of candidates) for(const label of labels(candidate)) {
    const name=normalizeReference(label);if(name.length<3)continue;
    const needle=` ${name} `;let at=text.indexOf(needle);
    while(at!==-1){spans.push({candidate,start:at,end:at+needle.length});at=text.indexOf(needle,at+1);}
  }
  return candidates.filter(candidate=>spans.some(s=>s.candidate===candidate&&!spans.some(other=>
    other.candidate!==candidate&&other.start<=s.start&&other.end>=s.end&&(other.start<s.start||other.end>s.end))));
}
