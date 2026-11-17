import { test } from "bun:test";
import {
  fixtureHelpers,
  fixtureImport,
  runUiFixture,
} from "../../scripts/ui-fixture";

test(
  "code headers, Mermaid, GitHub alerts and footnotes render in Markdown",
  () =>
    runUiFixture(
      "markdown-blocks",
      `
  const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
  const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
  const {Markdown}=await import(${fixtureImport(new URL("./MessageContent.tsx", import.meta.url))});
  await import(${fixtureImport(new URL("./styles.css", import.meta.url))});
  ${fixtureHelpers}
  const root=createFixtureRoot(createRoot),metrics=window.__fixtureMetrics={};
  const copied=[];
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{copied.push(text)}}});
  const longtasks=[];
  new PerformanceObserver(list=>{for(const entry of list.getEntries())longtasks.push(entry.duration)}).observe({type:'longtask'});
  const fence='\u0060\u0060\u0060';
  const flow='graph TD\\n  A[Start <img src=x onerror=alert(1)>] --> B{Check}\\n  B -->|yes| C[Done]\\n  click A "javascript:alert(1)"';
  const text=[
    fence+'ts','const answer = 42;',fence,'',
    fence+'mermaid',flow,fence,'',
    fence+'mermaid','pie title Pets','  "Dogs" : 3','  "Cats" : 2',fence,'',
    '> [!WARNING]','> Back up first.','',
    '> plain quote','',
    'See note[^1].','','[^1]: The footnote.',
  ].join('\\n');
  const render=(source,streaming=false)=>flushSync(()=>root.render(<div className="prose"><Markdown text={source} streaming={streaming}/></div>));

  // Streaming: an open mermaid fence stays code; it renders once the fence closes.
  const open='Intro\\n\\n'+fence+'mermaid\\n'+flow;
  render(open,true);
  await until(()=>document.querySelector('.markdown-code .markdown-code-language')?.textContent==='mermaid','open fence shows a labelled code block');
  await new Promise(resolve=>setTimeout(resolve,400));
  check(!document.querySelector('.markdown-mermaid'),'an unclosed fence must not render a partial diagram');
  const started=performance.now();longtasks.length=0;
  render(open+'\\n'+fence+'\\n\\nAfter',true);
  await until(()=>document.querySelector('.markdown-mermaid')?.shadowRoot?.querySelector('svg'),'closed fence renders while streaming');
  metrics.workerDiagramMs=Math.round(performance.now()-started);
  metrics.workerLongestTaskMs=Math.round(Math.max(0,...longtasks));
  render(open+'\\n'+fence+'\\n\\nAfter',false);await wait();
  flushSync(()=>root.render(null));

  render(text);
  await until(()=>document.querySelectorAll('.markdown-mermaid').length===2&&[...document.querySelectorAll('.markdown-mermaid')].every(host=>host.shadowRoot?.querySelector('svg')),'worker and official Mermaid diagrams render');
  const [beautiful,official]=document.querySelectorAll('.markdown-mermaid');
  for(const host of [beautiful,official]){
    const shadow=host.shadowRoot;
    check(!shadow.querySelector('script')&&![...shadow.querySelectorAll('*')].some(el=>[...el.attributes].some(a=>/^on/i.test(a.name)||(/href$/i.test(a.name)&&!a.value.startsWith('#')))),'diagram SVG must be inert');
    check(!shadow.innerHTML.includes('@import'),'diagram must not fetch fonts');
    const svg=shadow.querySelector('svg').getBoundingClientRect();
    check(svg.width>20&&svg.height>20&&svg.width<=host.getBoundingClientRect().width+.5,'diagram is laid out within the message width');
  }
  check(!document.querySelector('.prose style'),'diagram styles stay inside the shadow root');
  check(beautiful.shadowRoot.textContent.includes('Check'),'flowchart labels render');
  check(official.shadowRoot.textContent.includes('Dogs'),'unsupported types fall back to official Mermaid');

  const blocks=[...document.querySelectorAll('.markdown-code')];
  check(blocks.length===3,'every fence has one code frame');
  const ts=blocks[0];
  check(ts.querySelector('.markdown-code-language').textContent==='ts'&&ts.querySelector('pre > code.language-ts'),'language label above the unchanged pre/code');
  const header=ts.querySelector('.markdown-code-header').getBoundingClientRect(),pre=ts.querySelector('pre').getBoundingClientRect();
  check(Math.abs(header.left-pre.left)<.5&&Math.abs(header.right-pre.right)<.5&&header.bottom<=pre.top+.5,'header spans the code frame above the code');
  check(getComputedStyle(ts.querySelector('pre')).backgroundColor==='rgba(0, 0, 0, 0)','pre does not stack a second background');
  ts.querySelector('.markdown-code-copy').click();
  await until(()=>copied.length===1,'copy button copies');
  check(copied[0]==='const answer = 42;','copies the exact code without the fence newline');
  blocks[1].querySelector('.markdown-code-copy').click();
  await until(()=>copied.length===2,'diagram copy');
  check(copied[1]===flow,'diagram copy returns the Mermaid source');

  const alert=document.querySelector('blockquote.markdown-alert[data-alert="warning"]');
  check(alert&&alert.querySelector('.markdown-alert-title svg')&&!alert.textContent.includes('[!WARNING]')&&alert.textContent.includes('Back up first.'),'GitHub alert renders a title and drops its marker');
  const color=getComputedStyle(alert).borderLeftColor;
  check(color!==getComputedStyle(document.querySelectorAll('blockquote')[1]).borderLeftColor,'alerts use a state color');
  check(!document.querySelectorAll('blockquote')[1].classList.contains('markdown-alert'),'plain quotes stay plain');

  const scrolled=[];const original=Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView=function(){scrolled.push(this)};
  try{
    document.querySelector('sup a').click();
    check(scrolled[0]?.id==='user-content-fn-1'&&document.querySelector('.prose').contains(scrolled[0]),'footnote reference jumps within the message');
    document.querySelector('[data-footnote-backref]').click();
    check(scrolled[1]?.id==='user-content-fnref-1','footnote backref jumps back');
  }finally{Element.prototype.scrollIntoView=original;}
  metrics.diagrams=2;
  flushSync(()=>root.render(null));
  `,
      { viewport: { width: 900, height: 900 } },
    ),
  60_000,
);
