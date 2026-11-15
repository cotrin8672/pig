import { test } from "bun:test";
import { syntaxFixture } from "../../scripts/syntax-fixture";
import {
  fixtureHelpers,
  fixtureImport,
  runUiFixture,
} from "../../scripts/ui-fixture";

test(
  "ranged syntax keeps full text, fonts, painted colors, live selection, annotations and scrolling",
  () =>
    runUiFixture(
      "syntax-ranges",
      `
  const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
  const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
  const {CodeText,HighlightedDiff}=await import(${fixtureImport(new URL("./HighlightedCode.tsx", import.meta.url))});
  const {SyntaxRangesContext}=await import(${fixtureImport(new URL("./SyntaxText.tsx", import.meta.url))});
  const {highlightCode}=await import(${fixtureImport(new URL("./syntax-highlighting.ts", import.meta.url))});
  const {rememberAnnotationRange,useAnnotationHighlight}=await import(${fixtureImport(new URL("./annotation-highlights.ts", import.meta.url))});
  const {registerBuiltinChatRenderers,installChatRenderers}=await import(${fixtureImport(new URL("./chat-renderer-registry.ts", import.meta.url))});
  const {applyPatchRenderer}=await import(${fixtureImport(new URL("./ApplyPatchRenderer.tsx", import.meta.url))});
  const {ToolBlock}=await import(${fixtureImport(new URL("./ToolBlock.tsx", import.meta.url))});
  await import(${fixtureImport(new URL("./styles.css", import.meta.url))});
  ${fixtureHelpers}
  ${syntaxFixture}
  const root=createFixtureRoot(createRoot),metrics=window.__fixtureMetrics={};
  const source=(text,language,enabled)=><SyntaxRangesContext.Provider value={enabled}><div className="tool-body"><pre className="tool-code"><CodeText text={text} language={language}/></pre></div></SyntaxRangesContext.Provider>;
  const samples=[
    ['ts','class Derived extends Base {\\n  readonly value = "日本語 😀";\\n}\\n'],
    ['markdown','# Heading\\n\\n**bold** _italic_ ~~strike~~\\n'],
    ['c','#if ENABLED\\nconst int value = 2;\\n#endif\\n'],
    ['rust','fn main() { println!("hello"); }\\n'],
    ['ansi','\\u001b[1;32mgreen\\u001b[0m plain\\n\\u001b[48;5;196m background \\u001b[0m'],
    ['ts','const 日本語 = 1;\\r\\n\\r\\nconst tail = 2;\\r\\n'],
  ];
  const ink=element=>{
    const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT),result=[];let node;
    while(node=walker.nextNode())for(let offset=0;offset<node.length;offset++){
      if(/\\s/.test(node.data[offset]))continue;
      result.push([node.data[offset],syntaxStyle(node,offset)]);
    }
    return JSON.stringify(result);
  };
  const copy=element=>{
    const range=new Range();range.selectNodeContents(element);getSelection().removeAllRanges();getSelection().addRange(range);
    const result=getSelection().toString();getSelection().removeAllRanges();return result;
  };
  for(const [language,text] of samples){
    await highlightCode(text,language);
    flushSync(()=>root.render(<div style={{display:'grid',gridTemplateColumns:'480px 480px',gap:16}}>
      <section data-old>{source(text,language,false)}</section><section data-new>{source(text,language,true)}</section>
    </div>));await wait();
    const before=document.querySelector('[data-old] pre'),after=document.querySelector('[data-new] pre');
    check(copy(before)===copy(after),'full native copy must match: '+language);
    check(ink(before)===ink(after),'painted color/font/decorations must match: '+language+' '+ink(before)+' '+ink(after));
    check(before.scrollHeight===after.scrollHeight&&before.scrollWidth===after.scrollWidth,'scroll dimensions must match: '+language);
    const pixel=await capturePixels();
    const glyphPixels=element=>{
      const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT),leaf=walker.nextNode(),glyph=new Range();
      glyph.setStart(leaf,0);glyph.setEnd(leaf,1);
      const bounds=glyph.getBoundingClientRect(),values=[];
      for(let y=Math.ceil(bounds.top);y<Math.floor(bounds.bottom);y++)for(let x=Math.ceil(bounds.left);x<Math.floor(bounds.right);x++)values.push(pixel(x,y));
      return values;
    };
    // Windows uses per-channel ClearType alpha; compare the real raster against
    // the legacy glyph, not an incorrect grayscale foreground blend formula.
    check(JSON.stringify(glyphPixels(before))===JSON.stringify(glyphPixels(after)),'actual first glyph pixels must match the legacy foreground/font: '+language);
    if(language==='ts'){
      const marks=[before,after].map(element=>{
        const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT),node=walker.nextNode(),range=new Range();
        range.setStart(node,0);range.setEnd(node,1);return range;
      });
      CSS.highlights.set('pig-annotation-saved',new Highlight(...marks));await wait();
      const markedPixels=await capturePixels(),a=marks[0].getBoundingClientRect(),b=marks[1].getBoundingClientRect();
      const marked=rect=>{
        const values=[];for(let y=Math.ceil(rect.top);y<Math.floor(rect.bottom);y++)for(let x=Math.ceil(rect.left);x<Math.floor(rect.right);x++)values.push(markedPixels(x,y));return values;
      };
      check(JSON.stringify(marked(a))===JSON.stringify(marked(b)),'annotation background/underline must not change the syntax foreground');
      CSS.highlights.delete('pig-annotation-saved');
    }
    metrics[language]=(metrics[language]??0)+1;
    flushSync(()=>root.render(null));await wait();
  }
  const code=Array.from({length:800},(_,i)=>'const value'+i+' = call('+i+');').join('\\n');
  await highlightCode(code,'ts');
  let card=false;
  function Annotation(){const ref=useAnnotationHighlight('syntax-test');return <ul><li ref={ref}>Annotation</li></ul>;}
  const render=text=>flushSync(()=>root.render(<>{source(text,'ts',true)}{card&&<Annotation/>}</>));
  render(code);await wait();
  const pre=document.querySelector('pre'),walker=document.createTreeWalker(pre,NodeFilter.SHOW_TEXT),leaf=walker.nextNode();
  check(pre.scrollHeight>pre.clientHeight*10,'the actual 8-line tool preview must have a long inner scroll range');
  const mark=new Range();mark.setStart(leaf,6);mark.setEnd(leaf,12);
  const quote=mark.toString();getSelection().setBaseAndExtent(leaf,12,leaf,6);
  const original=pre.querySelector('.syntax-source');
  const next=code+'\\nconst appended = 2;';await highlightCode(next,'ts');render(next);await wait();
  check(mark.startContainer===leaf&&mark.toString()===quote&&getSelection().toString()===quote,'append must retain the actual range/selection nodes');
  check(getSelection().anchorNode===leaf&&getSelection().anchorOffset===12,'backward direction/endpoints stay intact');
  const inline=next.replace('call(0)','call(0) + 1');await highlightCode(inline,'ts');render(inline);await wait();
  check(mark.startContainer===leaf&&mark.toString()===quote&&getSelection().toString()===quote,'same-line append/edit must keep the unmodified selection');
  check(pre.querySelector('.syntax-source')===original,'streaming uses one representation from mount');
  getSelection().removeAllRanges();
  for(const proportion of [1,0,.5]){
    pre.scrollTop=(pre.scrollHeight-pre.clientHeight)*proportion;
    pre.dispatchEvent(new Event('scroll'));await wait();
    check(syntaxReady(),'scrolling must repaint syntax colors');
    const paints=[...CSS.highlights].filter(([name])=>name.startsWith('pig-syntax-'));
    const count=paints.reduce((total,[,value])=>total+value.size,0);
    check(count<1200,'range count must be bounded by the visible/overscan lines, not all 800 rows');
  }
  pre.scrollTop=0;pre.dispatchEvent(new Event('scroll'));await wait();
  let trusted=false;pre.addEventListener('wheel',event=>{trusted=event.isTrusted;},{once:true});
  const wheelBounds=pre.getBoundingClientRect();
  window.__fixtureInput={method:'Input.dispatchMouseEvent',params:{type:'mouseWheel',x:wheelBounds.left+80,y:wheelBounds.top+40,deltaX:0,deltaY:300}};
  await until(()=>!window.__fixtureInput&&trusted&&pre.scrollTop>0,'trusted native wheel must scroll the actual code preview');
  await wait();
  const inView=[...pre.querySelectorAll('.syntax-text')].find(span=>{
    const rect=span.getBoundingClientRect();return rect.top>wheelBounds.top+16&&rect.bottom<wheelBounds.bottom-12;
  });
  check(inView&&syntaxPainted(inView,0,inView.textContent.length).every(Boolean),'newly visible native-wheel lines must retain all syntax colors');
  metrics.trustedWheel=true;
  metrics.large={elements:pre.querySelectorAll('*').length,textNodes:[...pre.querySelectorAll('.syntax-text')].length};
  check(pre.querySelectorAll('*').length<1700,'remove most per-color elements while retaining complete source');
  // Real annotation colors have higher priority; no syntax rebuild may invalidate their Range.
  rememberAnnotationRange('syntax-test',mark);card=true;render(inline);await wait();
  const annotation=CSS.highlights.get('pig-annotation-saved');
  check(annotation&&[...annotation].some(range=>range.toString()===quote),'real annotation hook must bind the exact source quote');
  document.querySelector('li').dispatchEvent(new Event('mouseenter'));await wait();
  check(CSS.highlights.get('pig-annotation-active')?.priority===1,'annotation emphasis must outrank syntax colors');
  pre.scrollTop=0;pre.dispatchEvent(new Event('scroll'));await wait();
  check(mark.toString()===quote&&[...annotation].some(range=>range.toString()===quote),'repainting must retain independent annotation ranges');
  const diff='-1 const old = 1;\\n+1 const next = 2;\\n 2 const context = 3;';
  await highlightCode('const old = 1;\\nconst context = 3;','ts');await highlightCode('const next = 2;\\nconst context = 3;','ts');
  flushSync(()=>root.render(<HighlightedDiff text={diff} path="file.ts" numbered/>));await wait();
  check(document.querySelector('.tool-diff').textContent===diff,'diff prefixes and source stay complete');
  check(document.querySelector('.tool-diff > .del')&&document.querySelector('.tool-diff > .add'),'full-width diff row backgrounds retain their original elements');
  const wrapped=Array.from({length:60},(_,index)=>'\\nconst wrap'+index+' = "'+'wrapping 日本語 '.repeat(18)+'";').join('\\n');
  await highlightCode(wrapped,'ts');
  flushSync(()=>root.render(source(wrapped,'ts',true)));await wait();
  const wrappedPre=document.querySelector('pre');
  wrappedPre.style.width='300px';wrappedPre.style.whiteSpace='pre-wrap';wrappedPre.style.overflowWrap='anywhere';await wait();
  for(const ratio of [0,.25,.6,1]){
    wrappedPre.scrollTop=(wrappedPre.scrollHeight-wrappedPre.clientHeight)*ratio;
    wrappedPre.dispatchEvent(new Event('scroll'));await wait();
    const viewport=wrappedPre.getBoundingClientRect();
    const painted=[...wrappedPre.querySelectorAll('.syntax-text')].filter(span=>span.textContent.trim()&&[...span.getClientRects()].some(rect=>rect.top>viewport.top+16&&rect.bottom<viewport.bottom-12));
    check(painted.length&&painted.every(span=>syntaxPainted(span,0,span.textContent.length).every(Boolean)),'blank/wrapped logical lines must preserve correct visible colors throughout inner scrolling');
  }
  metrics.wrappedAndBlankLines=true;
  registerBuiltinChatRenderers([applyPatchRenderer]);
  const patch='*** Begin Patch\\n*** Add File: file.ts\\n+const patched = 1;\\n*** End Patch';
  await highlightCode('const patched = 1;','ts');
  flushSync(()=>root.render(<ToolBlock call={{id:'patch',name:'apply_patch',arguments:{patch}}} state={{status:'done'}} live={false}/>));await wait();
  check(document.querySelector('.patch-files .syntax-source'),'shipped apply_patch renderer must also reduce its file/diff DOM');
  installChatRenderers([{id:'builtin:apply-patch',kind:'tool',component:({DefaultRenderer})=><DefaultRenderer/>}]);await wait();
  check(!document.querySelector('.syntax-source'),'custom renderers may not opt into native ranges by impersonating a builtin ID');
  installChatRenderers([]);registerBuiltinChatRenderers([]);
  const huge='plain line\\n'.repeat(8000);
  flushSync(()=>root.render(<pre><CodeText text={huge} language="ts"/></pre>));await wait();
  check(document.querySelector('pre').textContent===huge&&!document.querySelector('.syntax-source'),'an initially oversized unhighlighted source stays one lean plain text node');
  root.unmount();await wait();
  check(![...CSS.highlights.keys()].some(name=>name.startsWith('pig-syntax-')),'unmount must release all global syntax ranges');
  metrics.cleanup=true;
  `,
      { viewport: { width: 1100, height: 800 } },
    ),
  60_000,
);
