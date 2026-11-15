import { test } from "bun:test";
import { existsSync } from "node:fs";
import {
  fixtureEdge,
  fixtureHelpers,
  fixtureImport,
  runUiFixture,
} from "../../scripts/ui-fixture";

const local = (path: string) => fixtureImport(new URL(path, import.meta.url));

const setup = `
    const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
    const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
    const {ChatHistoryImport}=await import(${local("./ChatHistoryImportSettings.tsx")});
    const {ContentPage}=await import(${local("./ContentPage.tsx")});
    const {NotificationCenter}=await import(${local("./NotificationCenter.tsx")});
    const {rpc}=await import(${local("./rpc.ts")});
    const {useStore}=await import(${local("./store.ts")});
    const {en,ja}=await import(${local("../shared/i18n.ts")});
    await import(${local("./styles.css")});
    await import(${local("./settings.css")});
    await import(${local("./content-page.css")});
    ${fixtureHelpers}
    const root=createFixtureRoot(createRoot);
    const messages=[],calls=[];
    let complete;
    rpc.send=new Proxy({},{get:(_,name)=>payload=>messages.push({name,payload})});
    window.__requests={importChatHistory:input=>{calls.push(input);return new Promise(resolve=>complete=resolve);}};
    const piris='C:\\\\work\\\\piris',other='C:\\\\work\\\\other';
    useStore.setState(s=>({settings:{...s.settings,language:'en'},bootstrap:{...s.bootstrap,generalCwd:'C:/general',projects:[piris]}}));
    // The real settings page structure, so the page-height fit is exercised.
    const mount=()=>flushSync(()=>root.render(<div style={{height:'100vh'}}><ContentPage className="settings-page" title="Settings"><div className="settings-layout"><nav className="settings-nav"><button type="button">General</button><NotificationCenter/></nav><section className="settings-content"><h2>Chat import</h2><ChatHistoryImport/></section></div></ContentPage></div>));
    const fitsWindow=()=>{const page=document.querySelector('.content-page');check(page.scrollHeight<=page.clientHeight+1,'the page itself does not scroll');const submit=document.querySelector('.history-footer > button');check(submit.getBoundingClientRect().bottom<=innerHeight,'the import button stays inside the window');};
    const dialog=()=>document.querySelector('.history-import');
    const button=label=>[...document.querySelectorAll('button')].find(el=>el.textContent===label);
    const source=name=>[...document.querySelectorAll('.history-tabs button')].find(el=>el.querySelector(':scope > span').textContent===name);
    const click=async el=>{check(el,'missing control');el.click();await wait();};
    const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
    const search=async value=>{const input=dialog().querySelector('.history-search input');setter.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));await wait();};
    const choose=async(label,value)=>{const el=dialog().querySelector('select[aria-label="'+label+'"]');el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));await wait();};
    const rows=()=>[...dialog().querySelectorAll('.history-list input[type=checkbox]')];
    const titles=()=>[...dialog().querySelectorAll('.history-item-title')].map(el=>el.textContent);
    const all=()=>dialog().querySelector('.history-listhead input');
    const deliver=preview=>{window.__rpcHandlers.messages.chatHistoryFile({requestId:useStore.getState().chatHistoryFile.requestId,preview});return wait();};
    // Hundreds of chats across projects, unsorted on arrival.
    const many=Array.from({length:300},(_,i)=>({id:'c'+i,source:'codex',title:'Chat '+String(i).padStart(3,'0'),modified:1_700_000_000_000+((i*7919)%300)*60_000,workspace:i%3===0?piris:i%3===1?other:undefined,warnings:[]}));
`;

test.skipIf(!existsSync(fixtureEdge) && !process.env.PIG_REQUIRE_UI_TESTS)(
  "chat import page: source tabs, project filter, sort, select-all over hundreds of chats",
  () =>
    runUiFixture(
      "local-chat-history",
      `${setup}
    mount();await wait();
    check(dialog()&&!document.querySelector('dialog'),'import is a settings page, not a dialog');
    check(source('Codex').getAttribute('aria-pressed')==='true'&&dialog().querySelector('.history-tabs').classList.contains('segmented-control'),'source tabs reuse the shared segmented control');
    check(messages[0].name==='listChatHistory'&&messages[0].payload.source==='codex','opening lists Codex right away');
    check(dialog().textContent.includes(en.historySourceReading),'loading is shown inside the pane');
    await deliver({id:'plan',kind:'local',source:'codex',label:'Codex',rejected:0,conversations:many});
    check(rows().length===300&&dialog().textContent.includes(en.historyAllProjects(300)),'all chats are listed');
    const times=[...dialog().querySelectorAll('.history-item-date')].map(el=>Date.parse(el.dateTime));
    check(times.every((t,i)=>i===0||times[i-1]>=t),'newest first by default');
    await choose(en.historySort,'oldest');
    const oldest=[...dialog().querySelectorAll('.history-item-date')].map(el=>Date.parse(el.dateTime));
    check(oldest.every((t,i)=>i===0||oldest[i-1]<=t),'sort switches to oldest first');
    await choose(en.historySort,'title');
    check(titles()[0]==='Chat 000'&&titles()[1]==='Chat 001','sort by title');
    const options=[...dialog().querySelectorAll('select[aria-label="'+en.historyProject+'"] option')].map(o=>o.textContent);
    check(options[0]===en.historyAllProjects(300)&&options.includes('piris (100)')&&options.includes('other (100)'),'project filter shows folder names with counts');
    await choose(en.historyProject,piris);
    check(rows().length===100,'project filter narrows the list');
    check(!dialog().querySelector('.history-footer select')&&dialog().textContent.includes(en.historyImportToProjects),'chats go to their own project instead of a chosen destination');
    await click(all());
    check(dialog().textContent.includes(en.historyImportCount(100,300)),'select all applies to the filtered rows');
    await search('Chat 00');
    check(rows().length===4&&all().checked,'search narrows within the project and keeps selection');
    await choose(en.historyProject,'');await search('');
    check(all().indeterminate,'partial selection shows an indeterminate select-all');
    await click(button(en.historyImportSubmit(100)));
    check(calls[0].previewId==='plan'&&calls[0].ids.length===100&&!('cwd' in calls[0]),'only the selected chats are sent; the host places them');
    check(button(en.historyImportBusy).disabled&&dialog().querySelector('.history-list').disabled,'import locks the list');
    complete({copied:100,skipped:0,failed:0});
    await until(()=>!useStore.getState().chatHistoryImporting,'import finishes');
    check(useStore.getState().notices.length===0,'a fully successful import posts no notice');
    check(dialog().textContent.includes(en.historyImportCount(0,300)),'imported selection is cleared');
    const list=dialog().querySelector('.history-list');
    check(list.scrollHeight>list.clientHeight&&list.scrollWidth<=list.clientWidth+1,'long lists scroll vertically only');
    fitsWindow();
    const area=list.getBoundingClientRect(),title=list.querySelector('.history-item-title').getBoundingClientRect(),date=list.querySelector('.history-item-date').getBoundingClientRect();
    check(title.right<=date.left&&date.right<=area.right+1,'titles are ellipsized before the date');
    const heights=new Set([...list.querySelectorAll('.history-item')].slice(1,12).map(el=>Math.round(el.getBoundingClientRect().height)));
    check(heights.size===1,'rows with and without a project have the same height');
    const rect=dialog().querySelector('.history-panel').getBoundingClientRect();
    await click(source('Claude Code'));
    check(messages.at(-1).name==='listChatHistory'&&messages.at(-1).payload.source==='claude-code','switching source lists that app');
    const after=dialog().querySelector('.history-panel').getBoundingClientRect();
    check(Math.abs(rect.height-after.height)<1&&Math.abs(rect.width-after.width)<1,'the panel keeps its size while switching sources');
    await click(source(en.historySourceFile));
    check(button(en.historyChooseFile),'the export tab offers a file picker');
    await click(button(en.historyChooseFile));
    check(messages.at(-1).name==='chooseChatHistory','the file picker is only opened on request');
    await click(source('Codex'));
    flushSync(()=>useStore.setState(s=>({settings:{...s.settings,language:'ja'}})));
    await deliver({id:'plan2',kind:'local',source:'codex',label:'Codex',rejected:0,conversations:many});
    check(dialog().textContent.includes(ja.historyAllProjects(300)),'Japanese labels render');
    const selects=[...dialog().querySelectorAll('select')];
    check(selects.every(el=>el.getBoundingClientRect().height<40),'selects stay on one line in Japanese');
    await click(all());await click(button(ja.historyImportSubmit(300)));
    complete({copied:298,skipped:0,failed:2,errors:[
      {id:'c1',title:'Chat 001',message:'ENOENT: no such file or directory, mkdir destination'},
      {id:'c2',title:'Chat 002',message:'No user or assistant text messages were found in this history.'}
    ]});
    await until(()=>!useStore.getState().chatHistoryImporting,'failed import finishes');
    const notice=useStore.getState().notices.find(n=>n.level==='error');
    check(notice?.message.includes(ja.historyImportFailed(2))&&notice.message.includes('Chat 001: ENOENT')&&notice.message.includes('Chat 002: No user or assistant text messages'),'the error notice includes each failed chat and its concrete cause, not just the count');
    check(useStore.getState().noticeHistory.some(n=>n.message===notice.message),'failure reasons remain in notification history');
    check(all().checked,'a failed import keeps the selection for retry');
    window.__fixtureMetrics={rows:rows().length,width:Math.round(after.width),height:Math.round(after.height)};
    await click(document.querySelector('.notification-bell'));
    check([...document.querySelectorAll('.notification-entry-message')].some(el=>el.textContent.includes('Chat 001: ENOENT')&&el.textContent.includes('Chat 002: No user or assistant text messages')),'the rendered notification center shows failure reasons without truncating them');
    await click(document.querySelector('.notification-bell'));
    await click(source('Claude Code'));
    window.__rpcHandlers.messages.chatHistoryFile({requestId:useStore.getState().chatHistoryFile.requestId,error:'SQLITE_BUSY: database is locked'});
    await wait();
    check(dialog().textContent.includes(ja.historyLoadFailed)&&dialog().textContent.includes('SQLITE_BUSY: database is locked'),'list failures also retain their cause next to retry');
  `,
      { realRpc: true, viewport: { width: 1100, height: 900 } },
    ),
  120_000,
);

test.skipIf(!existsSync(fixtureEdge) && !process.env.PIG_REQUIRE_UI_TESTS)(
  "chat import page on a narrow window keeps every control reachable",
  () =>
    runUiFixture(
      "chat-history-import",
      `${setup}
    mount();await wait();
    await deliver({id:'plan',kind:'local',source:'codex',label:'Codex',rejected:0,conversations:many});
    const d=dialog().querySelector('.history-panel').getBoundingClientRect();
    check(d.right<=innerWidth+1,'the panel fits the window width');
    check(dialog().scrollWidth<=dialog().clientWidth+1,'no horizontal overflow');
    const submit=button(en.historyImportSubmit(0));
    check(submit.getBoundingClientRect().bottom<=d.bottom,'the import button stays visible');
    const list=dialog().querySelector('.history-list');
    check(list.clientHeight>=120,'the list keeps usable height');
    fitsWindow();
  `,
      { realRpc: true, viewport: { width: 560, height: 700 } },
    ),
  120_000,
);
