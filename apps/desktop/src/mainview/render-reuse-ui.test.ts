import { test } from "bun:test";
import { existsSync } from "node:fs";
import {
  fixtureEdge,
  fixtureHelpers,
  fixtureImport,
  runUiFixture,
} from "../../scripts/ui-fixture";

test.skipIf(!existsSync(fixtureEdge) && !process.env.PIG_REQUIRE_UI_TESTS)(
  "render reuse safety: live merge selection controls, cached Markdown, URLs and renderer changes",
  () =>
    runUiFixture(
      "render-reuse",
      `
    const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
    const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
    const {Fragment}=await import(${fixtureImport(import.meta.resolve("react"))});
    const {BuiltinMarkdown,Markdown}=await import(${fixtureImport(new URL("./MessageContent.tsx", import.meta.url))});
    const {prepareMarkdown}=await import(${fixtureImport(new URL("./markdown-processing.ts", import.meta.url))});
    const {highlightCode}=await import(${fixtureImport(new URL("./syntax-highlighting.ts", import.meta.url))});
    const {installChatRenderers}=await import(${fixtureImport(new URL("./chat-renderer-registry.ts", import.meta.url))});
    const {normalizeMath}=await import(${fixtureImport(new URL("../shared/math.ts", import.meta.url))});
    const {useStore}=await import(${fixtureImport(new URL("./store.ts", import.meta.url))});
    await import(${fixtureImport(new URL("./styles.css", import.meta.url))});
    ${fixtureHelpers}
    const root=createFixtureRoot(createRoot), metrics=window.__fixtureMetrics={};
    useStore.setState(s=>({settings:{...s.settings,language:'en'}}));
    const select=(element,start,end)=>{
      const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT),node=walker.nextNode();
      check(node&&node.length>=end,'selection target must exist');
      const range=document.createRange();range.setStart(node,start);range.setEnd(node,end);
      getSelection().removeAllRanges();getSelection().addRange(range);return range.cloneRange();
    };
    const lines=['stable selected text','second line'];
    function Output({compact,append}) {
      const text=append?[...lines,'new output']:lines;
      return <pre className="tool-diff">{compact?<span className="add">{text.join('\\n')}</span>:text.map((line,i)=><Fragment key={i}><span className="add">{line}</span>{i<text.length-1?'\\n':''}</Fragment>)}</pre>;
    }
    for(const compact of [false,true]) {
      flushSync(()=>root.render(<Output key={String(compact)} compact={compact} append={false}/>));await wait();
      const body=document.querySelector('pre'),mark=select(body,7,15),quote=getSelection().toString();
      check(quote==='selected','selection control must cover the intended text');
      const before=mark.getBoundingClientRect();
      flushSync(()=>root.render(<Output key={String(compact)} compact={compact} append={true}/>));await wait();
      check(body.textContent===[...lines,'new output'].join('\\n'),'candidate must retain full bytes and line order');
      const preserved=getSelection().toString()===quote&&mark.toString()===quote;
      if(!compact) {
        check(preserved,'existing line nodes must preserve selection and annotation ranges');
        check(Math.abs(mark.getBoundingClientRect().top-before.top)<.5,'unchanged selected lines must not move');
      }
      // Diagnostic negative control, not a proposed production optimization.
      metrics[compact?'naiveLiveMergePreservedRange':'existingLinesPreservedRange']=preserved;
      getSelection().removeAllRanges();
    }
    flushSync(()=>root.render(null));await wait();
    const code='const selected = 7;\\n';
    const text='## Stable heading\\n\\n| a | b |\\n| - | - |\\n| one | two |\\n\\n'+Array.from({length:100},(_,i)=>'$x_'+i+'^2$').join('\\n\\n')+'\\n\\n~~~ts\\n'+code+'~~~\\n\\n[safe](https://example.test) [unsafe](javascript:alert%281%29)';
    const parsed=await prepareMarkdown(normalizeMath(text));
    check(parsed?.tree,'native worker must return parsed Markdown');
    await highlightCode(code,'ts');
    let visits=0,children=parsed.tree.children;
    Object.defineProperty(parsed.tree,'children',{configurable:true,get(){visits++;return children;},set(value){children=value;}});
    const builtin=()=>flushSync(()=>root.render(<BuiltinMarkdown data={{text}}/>));
    builtin();
    const codeNode=document.querySelector('pre code'),table=document.querySelector('table'),math=document.querySelector('.katex');
    check(codeNode&&table&&math,'cached rendering must retain code, tables and math');
    const mark=select(codeNode,0,5),quote=getSelection().toString(),html=document.querySelector('#root').innerHTML;
    visits=0;await wait();metrics.cachedSettlementTreeReads=visits;
    visits=0;const repeatedAt=performance.now();builtin();metrics.sameTreeParentRenderMs=performance.now()-repeatedAt;await wait();metrics.sameTreeParentReads=visits;
    check(metrics.sameTreeParentReads===0,'an identical parsed tree must not repeat Markdown post-processing');
    check(document.querySelector('pre code')===codeNode&&document.querySelector('table')===table&&document.querySelector('.katex')===math,'same-tree reuse must retain independent DOM and stateful components');
    check(mark.toString()===quote&&getSelection().toString()===quote,'same-tree reuse must retain selection and annotation ranges');
    check(document.querySelector('#root').innerHTML===html,'same-tree reuse must retain exact rendered markup');
    check([...document.querySelectorAll('a')].every(a=>!a.getAttribute('href')?.startsWith('javascript:')),'URL safety must not be bypassed by cached trees');
    getSelection().removeAllRanges();
    const imageText=text+'\\n\\n![fixture](#fixture-image)';
    await prepareMarkdown(normalizeMath(imageText));
    const imageBuiltin=()=>flushSync(()=>root.render(<BuiltinMarkdown data={{text:imageText}}/>));
    imageBuiltin();await wait();
    document.querySelector('.image-preview').click();
    await until(()=>document.querySelector('.image-viewer')?.open,'cached image gallery must still open');
    const viewer=document.querySelector('.image-viewer');imageBuiltin();await wait();
    check(document.querySelector('.image-viewer')===viewer&&viewer.open,'same-tree reuse must retain image viewer state');
    const openLabel=document.querySelector('.image-preview').getAttribute('aria-label');
    useStore.setState(s=>({settings:{...s.settings,language:'ja'}}));await wait();
    check(document.querySelector('.image-preview').getAttribute('aria-label')!==openLabel&&document.querySelector('.image-viewer')===viewer,'child locale subscriptions and viewer state must survive parent memoization');
    viewer.dispatchEvent(new Event('cancel',{cancelable:true}));await wait();
    check(!document.querySelector('.image-viewer'),'image viewer must still close independently');
    installChatRenderers([{id:'reuse-image',kind:'image',component:({DefaultRenderer})=><span data-reuse-image><DefaultRenderer/></span>}]);
    await until(()=>document.querySelector('[data-reuse-image] .image-preview'),'nested renderer subscriptions must update even when the Markdown tree is memoized');
    installChatRenderers([]);await until(()=>!document.querySelector('[data-reuse-image]')&&document.querySelector('.image-preview'),'nested renderer removal must restore its builtin');
    flushSync(()=>root.render(<Markdown text={text}/>));await wait();
    installChatRenderers([{id:'reuse-test',kind:'markdown',component:({DefaultRenderer})=><section data-reuse-custom><DefaultRenderer/></section>}]);
    await until(()=>document.querySelector('[data-reuse-custom] .katex'),'renderer installation must still apply to cached Markdown');
    installChatRenderers([]);await until(()=>!document.querySelector('[data-reuse-custom]')&&document.querySelector('.katex'),'renderer removal must restore the builtin');
    flushSync(()=>root.render(<Markdown text={text.replace('Stable heading','Changed heading')}/>));
    await until(()=>document.querySelector('h2')?.textContent==='Changed heading','changed input must not display the cached old tree');
    console.info('Render reuse safety',JSON.stringify(metrics));
    root.unmount();
  `,
    ),
  60_000,
);
