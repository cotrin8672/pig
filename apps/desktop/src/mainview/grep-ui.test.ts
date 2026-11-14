import { test } from "bun:test";
import {
  fixtureHelpers,
  fixtureImport,
  runUiFixture,
} from "../../scripts/ui-fixture";
import { edit, grep, ls } from "../stories/proposals/data";

const source = (path: string) => fixtureImport(new URL(path, import.meta.url));

test("Grep in Edge: shared geometry, grouped output, disclosure, search and annotations", async () => {
  await runUiFixture(
    "grep",
    `
    const {createElement:h}=await import(${fixtureImport(import.meta.resolve("react"))});
    const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
    const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
    const {ToolBlock,ToolGroup}=await import(${source("./ToolBlock.tsx")});
    const {DisclosureScope}=await import(${source("./LazyDetails.tsx")});
    const {rememberAnnotationRange}=await import(${source("./annotation-highlights.ts")});
    const {installChatRenderers}=await import(${source("./chat-renderer-registry.ts")});
    const {grep,edit,ls}=${JSON.stringify({ grep, edit, ls })};
    const Grep=({data})=>h(ToolBlock,data);
    const result=text=>({...grep.tool,state:{status:'done',result:{content:[{type:'text',text}]}}});
    await import(${source("./styles.css")});
    await import(${source("../stories/glass-stage.css")});
    ${fixtureHelpers}
    const root=createFixtureRoot(createRoot);
    let generation=0;
    const render=(children,width=760)=>flushSync(()=>root.render(h('div',{key:++generation,className:'glass-stage'},
      h('div',{className:'glass-wallpaper'}),h('div',{className:'app-shell glass-shell',style:{'--window-opacity':0.78}},
      h('div',{className:'transcript',style:{width:'100%',maxWidth:width,padding:24}},children)))));
    for(const [width,scale] of [[760,1],[360,1],[360,1.4]]){
      document.documentElement.style.setProperty('--font-scale',scale);
      render([h(Grep,{key:'grep',data:grep.tool}),h(ToolBlock,{key:'edit',...edit.tool}),h(ToolBlock,{key:'ls',...ls.tool})],width);
      await wait();
      const rows=[...document.querySelectorAll('.tool-row')];
      rows[2].querySelector('summary').click();await wait();
      const outputs=rows.map(row=>row.querySelector('.tool-body pre'));
      const bounds=outputs.map(node=>node.getBoundingClientRect());
      check(bounds.every(rect=>Math.abs(rect.left-bounds[0].left)<1&&Math.abs(rect.right-bounds[0].right)<1),'Grep/Edit/List output alignment');
      check(rows.every(row=>Math.abs(row.querySelector('.tool-body').getBoundingClientRect().left-row.getBoundingClientRect().left-22)<1),'shared 22px body indent');
      const output=outputs[0],style=getComputedStyle(output);
      check(output.clientHeight<=8*parseFloat(style.lineHeight)+16+8+1,'eight-line preview scales with text');
      check(output.scrollHeight>output.clientHeight,'groups stay inside vertically scrollable output');
      check(document.querySelectorAll('.tool-grep-file').length===4,'one group per file');
      check(document.querySelectorAll('.tool-grep-line').length===8,'all matching lines retained');
      check(document.querySelectorAll('.tool-grep-line mark').length===9,'highlight every occurrence');
      check(style.backgroundColor===getComputedStyle(outputs[1]).backgroundColor,'shared translucent output surface');
      const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');ctx.fillStyle=style.backgroundColor;ctx.fillRect(0,0,1,1);
      const alpha=ctx.getImageData(0,0,1,1).data[3];check(alpha>0&&alpha<255&&style.opacity==='1','surface alpha, not whole element opacity');
      check(document.documentElement.scrollWidth<=innerWidth,'no page overflow');
      check(rows[0].dataset.toolCallId==='grep','real tool identity retained');
    }
    render(h(Grep,{data:result([
      'src/app.ts-2- // Set the header',
      'src/app.ts:3: import { greeting } from "./i18n/greeting";',
      'src/app.ts-4- const user = getUser();',
      '--',
      'src/app.ts-17- if (user) {',
      'src/app.ts:18:   header.textContent = greeting(user.locale, user.name);',
      'src/app.ts-19- }',
      '[2 matches limit reached. Use limit=4 for more.]',
    ].join('\\n'))}),360);await wait();
    check(document.querySelectorAll('.tool-grep-file').length===1,'repeated file/context grouped');
    check(document.querySelectorAll('.tool-grep-context').length===4,'context retained');
    check(document.querySelector('.tool-grep-count').textContent==='2','count excludes context');
    check(document.querySelector('.tool-meta').textContent.includes('2 matches'),'summary excludes context');
    check(document.querySelector('.tool-grep-notice').textContent.includes('limit reached'),'limit notice retained');
    check(document.querySelectorAll('.tool-grep-context mark').length===0,'context is not highlighted');
    check(document.querySelectorAll('.tool-grep-line')[4].querySelector('code').textContent.startsWith('  header'),'source indentation retained');

    render(h(Grep,{data:result(Array.from({length:24},(_,index)=>'src/components/navigation/deeply/nested/Header.tsx:'+(index+1)+':   const text = greeting(user.locale, user.name); // '+'long value '.repeat(12)).join('\\n'))}),360);await wait();
    let output=document.querySelector('.tool-grep-output');
    check(output.scrollWidth>output.clientWidth&&output.scrollHeight>output.clientHeight,'both axes scroll inside output');
    output.scrollTop=output.scrollHeight;output.scrollLeft=output.scrollWidth;await wait();
    const top=output.scrollTop,left=output.scrollLeft;
    const summary=document.querySelector('.tool-row > summary');summary.click();await wait();
    check(!document.querySelector('.tool-grep-output'),'unannotated collapsed body is released');
    summary.click();await wait();output=document.querySelector('.tool-grep-output');
    check(output.scrollTop===top&&output.scrollLeft===left,'shared disclosure restores both scroll positions');

    render(h(Grep,{data:result('No matches found')}));await wait();
    check(document.querySelector('.tool-body').textContent==='No matches found','empty result is not a fabricated group');
    render(h(Grep,{data:result('unrecognized <output>')}));await wait();
    check(document.querySelector('.tool-body').textContent==='unrecognized <output>','unfamiliar output stays escaped and complete');
    for(const phase of ['running','error']){
      const data=phase==='running'?{...grep.tool,live:true,state:undefined}:{...grep.tool,state:{status:'error',result:{content:[{type:'text',text:grep.error}]}}};
      render(h(Grep,{data}));await wait();
      check(!document.querySelector('.tool-grep-file'),'no stale results');
      check(phase==='running'?!!document.querySelector('.tool-meta .spinner'):document.querySelector('.tool-body').textContent.includes(grep.error),'shared running/error state');
    }
    const calls=[{...grep.tool.call,type:'toolCall'},{...ls.tool.call,type:'toolCall'}];
    const tools={grep:grep.tool.state,ls:ls.tool.state};
    const values={'/fixture/group:grep':false,'/fixture/call:grep/tool:grep/body':false};
    render(h(DisclosureScope,{id:'fixture',values,reveal:1},h(ToolGroup,{calls,tools,live:false,target:{toolCallId:'grep',serial:1}})));await wait();
    check(!!document.querySelector('[data-tool-call-id="grep"] .tool-grep-output'),'search reveal opens the group and Grep');

    installChatRenderers([{id:'grep-override',kind:'tool',match:data=>data.call.name==='grep',component:({DefaultRenderer})=>h('div',{'data-custom':'grep'},h(DefaultRenderer))}]);
    render(h(Grep,{data:grep.tool}));await wait();
    check(!!document.querySelector('[data-custom="grep"] .tool-grep-output'),'custom renderer can decorate the new builtin');
    installChatRenderers([]);
    render(h(Grep,{data:grep.tool}));await wait();
    const mark=document.querySelector('.tool-grep-line mark'),range=document.createRange();range.selectNodeContents(mark);
    rememberAnnotationRange('grep-selection',range);await wait();
    document.querySelector('.tool-row > summary').click();await wait();
    check(mark.isConnected&&range.toString()==='greeting','annotation protects the grouped DOM while collapsed');
    document.documentElement.style.setProperty('--font-scale',1);
    render(h(Grep,{data:grep.tool}));await wait();
    `,
    { viewport: { width: 900, height: 800 } },
  );
}, 60_000);
