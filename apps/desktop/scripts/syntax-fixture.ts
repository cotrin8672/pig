/** Resolve painted syntax colors, not just the originating element's style. */
export const syntaxFixture = `
const syntaxStyle=(node,offset)=>{
  const style=getComputedStyle(node.parentElement);
  let color=style.color,background=style.backgroundColor;
  for(const [name,highlight] of CSS.highlights){
    if(!name.startsWith('pig-syntax-'))continue;
    for(const range of highlight){
      if(range.isPointInRange(node,offset)&&!(range.endContainer===node&&range.endOffset===offset)){
        const painted=getComputedStyle(node.parentElement,'::highlight('+name+')');
        color=painted.color;background=painted.backgroundColor;break;
      }
    }
  }
  return {color,background,fontStyle:style.fontStyle,fontWeight:style.fontWeight,decoration:style.textDecorationLine};
};
const syntaxReady=()=>[...CSS.highlights].some(([name,value])=>name.startsWith('pig-syntax-')&&value.size);
const syntaxPainted=(element,start,end)=>{
  const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT),values=[];let node,at=0;
  while(node=walker.nextNode()){
    for(let offset=0;offset<node.length;offset++){
      if(at+offset<start||at+offset>=end||/\\s/.test(node.data[offset]))continue;
      let painted=!!node.parentElement.closest('.syntax-token')?.style.color;
      for(const [name,highlight] of CSS.highlights)if(name.startsWith('pig-syntax-'))
        for(const range of highlight)if(range.isPointInRange(node,offset)&&!(range.endContainer===node&&range.endOffset===offset))painted=true;
      values.push(painted);
    }
    at+=node.length;
  }
  return values;
};
`;
