import { test } from "bun:test";
import { existsSync } from "node:fs";
import {
  fixtureEdge,
  fixtureHelpers,
  fixtureImport,
  runUiFixture,
} from "../../scripts/ui-fixture";

test.skipIf(!existsSync(fixtureEdge) && !process.env.PIG_REQUIRE_UI_TESTS)(
  "saved output DOM reduction preserves rendering, full copy, ranges and streaming settlement",
  () =>
    runUiFixture(
      "output-dom",
      `
    const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
    const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
    const {CodeText,HighlightedDiff,SavedOutputContext}=await import(${fixtureImport(new URL("./HighlightedCode.tsx", import.meta.url))});
    const {SyntaxRangesContext}=await import(${fixtureImport(new URL("./SyntaxText.tsx", import.meta.url))});
    const {highlightCode}=await import(${fixtureImport(new URL("./syntax-highlighting.ts", import.meta.url))});
    const {Chat}=await import(${fixtureImport(new URL("./App.tsx", import.meta.url))});
    const {useStore}=await import(${fixtureImport(new URL("./store.ts", import.meta.url))});
    const {emptyTranscript}=await import(${fixtureImport(new URL("../shared/transcript.ts", import.meta.url))});
    const {prepareMarkdown}=await import(${fixtureImport(new URL("./markdown-processing.ts", import.meta.url))});
    const {installChatRenderers}=await import(${fixtureImport(new URL("./chat-renderer-registry.ts", import.meta.url))});
    await import(${fixtureImport(new URL("./styles.css", import.meta.url))});
    ${fixtureHelpers}
    const root=createFixtureRoot(createRoot),metrics=window.__fixtureMetrics={};
    window.__requests={listSlashCommands:()=>[]};
    useStore.setState(s=>({settings:{...s.settings,language:'en'}}));
    const comments=Array.from({length:1200},(_,i)=>'// selected 日本語 😀 comment '+i).join('\\n');
    const mixed=Array.from({length:200},(_,i)=>'  const value'+i+' = call('+i+');').join('\\n');
    const samples=[['comments',comments,'ts'],['mixed',mixed,'ts'],['crlf','  const 日本語 = "<script>";\\r\\n\\r\\n  const tail = 2;\\r\\n','ts'],['fonts','# Title\\n\\n**bold** _italic_ ~~strike~~\\n','markdown']];
    const output=(text,language,saved)=><SyntaxRangesContext.Provider value={false}><SavedOutputContext.Provider value={saved}><pre className="tool-code"><code><CodeText text={text} language={language}/></code></pre></SavedOutputContext.Provider></SyntaxRangesContext.Provider>;
    const rangeAt=(element,start,length)=>{
      const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);let node,offset=0,begin,end;
      while(node=walker.nextNode()){
        if(!begin&&start<offset+node.length)begin=[node,start-offset];
        if(start+length<=offset+node.length){end=[node,start+length-offset];break;}
        offset+=node.length;
      }
      check(begin&&end,'source range must exist');
      const range=document.createRange();range.setStart(...begin);range.setEnd(...end);return range;
    };
    const ink=(element)=>{
      const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT),result=[];let node;
      while(node=walker.nextNode()){
        const style=getComputedStyle(node.parentElement);
        for(const c of node.data)if(!/\\s/u.test(c))result.push([c,style.color,style.backgroundColor,style.fontStyle,style.fontWeight,style.textDecorationLine]);
      }
      return JSON.stringify(result);
    };
    const copy=(element)=>{
      const range=document.createRange();range.selectNodeContents(element);
      getSelection().removeAllRanges();getSelection().addRange(range);
      const value=getSelection().toString();getSelection().removeAllRanges();return value;
    };
    const nodes=(element)=>{
      const walker=document.createTreeWalker(element,NodeFilter.SHOW_ALL);let count=0;
      while(walker.nextNode())count++;return count;
    };
    for(const [name,text,language] of samples){
      await highlightCode(text,language);
      flushSync(()=>root.render(<div style={{display:'grid',gridTemplateColumns:'500px 500px',gap:16,padding:12}}><section data-before>{output(text,language,false)}</section><section data-after>{output(text,language,true)}</section></div>));
      await wait();
      const before=document.querySelector('[data-before] pre'),after=document.querySelector('[data-after] pre');
      check(before.textContent===text&&after.textContent===text,name+': every byte and newline must remain');
      check(!document.querySelector('script:not([src])'),name+': source must remain escaped');
      check(copy(before)===copy(after),name+': native full selection/copy must match');
      check(ink(before)===ink(after),name+': glyph colors, fonts and backgrounds must match');
      check(before.scrollWidth===after.scrollWidth&&before.scrollHeight===after.scrollHeight,name+': inner scroll geometry must match');
      for(const offset of [0,Math.floor(text.length/2),text.length-1]){
        if(/\\s/u.test(text[offset]))continue;
        const a=rangeAt(before,offset,1).getBoundingClientRect(),b=rangeAt(after,offset,1).getBoundingClientRect();
        const ar=before.getBoundingClientRect(),br=after.getBoundingClientRect();
        check(Math.abs(a.left-ar.left-(b.left-br.left))<.1&&Math.abs(a.top-ar.top-(b.top-br.top))<.1&&Math.abs(a.width-b.width)<.1,name+': glyph placement must match');
      }
      metrics[name]={before:before.querySelectorAll('*').length,after:after.querySelectorAll('*').length,beforeNodes:nodes(before),afterNodes:nodes(after)};
      if(name==='comments')check(metrics[name].after<metrics[name].before/100,'uniform code must remove over 99% of its elements');
      if(name==='mixed')check(metrics[name].after<metrics[name].before,'ordinary highlighted code must also remove elements');
      if(name==='comments'||name==='mixed')check(metrics[name].afterNodes<metrics[name].beforeNodes,'total DOM nodes, including text leaves, must also decrease');
      if(name==='mixed'){
        before.scrollTop=after.scrollTop=40;before.scrollLeft=after.scrollLeft=5;
        const mark=rangeAt(after,text.indexOf('value50'),7),quote=mark.toString(),node=mark.startContainer;
        getSelection().setBaseAndExtent(mark.endContainer,mark.endOffset,mark.startContainer,mark.startOffset);
        const anchor=getSelection().anchorNode,anchorOffset=getSelection().anchorOffset,top=after.scrollTop,left=after.scrollLeft;
        flushSync(()=>root.render(<div style={{display:'grid',gridTemplateColumns:'500px 500px',gap:16,padding:12}}><section data-before>{output(text,language,false)}</section><section data-after>{output(text,language,false)}</section></div>));
        await wait();
        check(after===document.querySelector('[data-after] pre')&&mark.startContainer===node&&mark.toString()===quote,'parent/context changes must preserve exact annotation ranges');
        check(getSelection().toString()===quote&&getSelection().anchorNode===anchor&&getSelection().anchorOffset===anchorOffset,'backward native selection must retain direction and endpoints');
        check(after.scrollTop===top&&after.scrollLeft===left,'inner scroll must not reset');
        getSelection().removeAllRanges();
      }
    }
    const initial='// selected first\\n// selected second',extended=initial+'\\n// appended';
    await highlightCode(initial,'ts');await highlightCode(extended,'ts');
    for(const savedAtMount of [false,true]){
      const render=(text,saved)=>flushSync(()=>root.render(<SyntaxRangesContext.Provider value={false}><section key={String(savedAtMount)}><SavedOutputContext.Provider value={saved}><pre className="tool-code"><CodeText text={text} language="ts"/></pre></SavedOutputContext.Provider></section></SyntaxRangesContext.Provider>));
      render(initial,savedAtMount);await wait();
      const pre=document.querySelector('pre'),mark=rangeAt(pre,3,8),node=mark.startContainer,quote=mark.toString();
      getSelection().removeAllRanges();getSelection().addRange(mark.cloneRange());
      render(extended,true);await wait();
      check(pre.textContent===extended,'appended output must remain complete');
      check(mark.startContainer===node&&mark.toString()===quote&&getSelection().toString()===quote,'append and live-to-saved settlement must preserve native ranges');
      metrics[savedAtMount?'savedAppend':'liveSettlement']=true;
      if(!savedAtMount)check(pre.querySelectorAll('.syntax-token').length===3,'streaming output must not switch to compact DOM on completion');
      getSelection().removeAllRanges();
    }
    const diff='-1   const old = 1;\\n+1   const next = 2;\\n 2   const context = 3;';
    await highlightCode('  const old = 1;\\n  const context = 3;','ts');await highlightCode('  const next = 2;\\n  const context = 3;','ts');
    flushSync(()=>root.render(<SyntaxRangesContext.Provider value={false}><div style={{display:'grid',gridTemplateColumns:'500px 500px',gap:16,padding:12}}>{[false,true].map(saved=><section key={String(saved)}><SavedOutputContext.Provider value={saved}><HighlightedDiff text={diff} path="file.ts" numbered/></SavedOutputContext.Provider></section>)}</div></SyntaxRangesContext.Provider>));await wait();
    const diffs=[...document.querySelectorAll('.tool-diff')];
    check(diffs.every(pre=>pre.textContent===diff),'diff prefixes, numbers and complete content must remain');
    check(ink(diffs[0])===ink(diffs[1]),'diff code styles must match');
    const rows=diffs.map(pre=>[...pre.children].map(row=>[row.className,getComputedStyle(row).backgroundColor,row.getBoundingClientRect().width,row.getBoundingClientRect().height]));
    check(JSON.stringify(rows[0])===JSON.stringify(rows[1]),'full-width add/delete backgrounds and row geometry must remain');
    check(diffs[1].querySelectorAll('*').length<diffs[0].querySelectorAll('*').length,'completed diffs must remove redundant whitespace spans');
    metrics.diff={before:diffs[0].querySelectorAll('*').length,after:diffs[1].querySelectorAll('*').length};
    flushSync(()=>root.render(null));await wait();
    const code='// saved first\\n// saved second\\n// saved third';
    const markdown='~~~ts\\n'+code+'\\n~~~';await highlightCode(code+'\\n','ts');await prepareMarkdown(markdown);
    const message={role:'assistant',content:[{type:'text',text:markdown}],api:'openai-responses',provider:'fixture',model:'fixture',stopReason:'stop',timestamp:1,usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
    const record={id:'saved',entryId:'saved',parentId:null,branchId:'saved',order:0,kind:'message',message};
    const snapshot={address:{hostId:'dom-fixture',sessionId:'dom-fixture',epoch:1},snapshotSeq:1,info:{id:'dom-fixture',cwd:'fixture',title:'Fixture',modified:0},effort:'off',effortLevels:[],transcript:{...emptyTranscript(),history:{revision:'branch'},records:[record]}};
    flushSync(()=>root.render(<Chat snapshot={snapshot}/>));await until(()=>document.querySelector('.prose code .syntax-source'),'production Chat must render the saved code');
    check(document.querySelectorAll('.prose code .syntax-source').length===1&&document.querySelectorAll('.prose code .syntax-token').length===0,'production saved records must use range colors without token spans');
    metrics.productionSavedChat=true;
    installChatRenderers([{id:'dom-extension',kind:'markdown',component:({DefaultRenderer})=><DefaultRenderer/>}]);
    await until(()=>document.querySelectorAll('.prose code .syntax-token').length===3,'custom renderers and their defaults must retain the original representation');
    check(document.querySelector('.prose code').textContent===code+'\\n','custom defaults must retain complete source');
    installChatRenderers([]);
    await until(()=>document.querySelectorAll('.prose code .syntax-source').length===1,'removing a renderer must restore the ranged builtin');
    metrics.customRendererUnchanged=true;
    flushSync(()=>root.render(null));await wait();
    const call={type:'toolCall',id:'read-tool',name:'read',arguments:{path:'file.ts'}};
    const toolSnapshot={...snapshot,transcript:{...snapshot.transcript,records:[{...record,message:{...message,content:[call]}}],tools:{'read-tool':{status:'done',result:{content:[{type:'text',text:code}]}}}}};
    await highlightCode(code,'ts');
    flushSync(()=>root.render(<Chat key="tool-chat" snapshot={toolSnapshot}/>));
    document.querySelector('.work-toggle[aria-expanded="false"]')?.click();
    await until(()=>document.querySelector('.tool-row summary'),'production tool must render');
    document.querySelector('.tool-row summary').click();
    await until(()=>document.querySelector('.tool-output .syntax-source'),'completed tool body must open');
    check(document.querySelectorAll('.tool-output .syntax-source').length===1&&document.querySelectorAll('.tool-output .syntax-token').length===0,'production completed tool results must enable ranged code');
    const details=document.querySelector('.tool-row'),body=document.querySelector('.tool-output pre');
    const toolMark=rangeAt(body,3,5),toolQuote=toolMark.toString(),toolNode=toolMark.startContainer;
    getSelection().removeAllRanges();getSelection().addRange(toolMark.cloneRange());
    flushSync(()=>root.render(<Chat key="tool-chat" snapshot={{...toolSnapshot,snapshotSeq:2,info:{...toolSnapshot.info,title:'Renamed'}}}/>));await wait();
    check(document.querySelector('.tool-row')===details&&document.querySelector('.tool-output pre')===body,'unrelated snapshot updates must retain disclosure and body DOM');
    check(toolMark.startContainer===toolNode&&toolMark.toString()===toolQuote&&getSelection().toString()===toolQuote,'completed tool ranges must survive snapshot updates');
    metrics.productionCompletedTool=true;
    getSelection().removeAllRanges();
    root.unmount();
  `,
      { viewport: { width: 1200, height: 900 } },
    ),
  60_000,
);
