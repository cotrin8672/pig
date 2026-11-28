import { test } from "bun:test";
import {
  fixtureHelpers,
  fixtureImport,
  runUiFixture,
} from "../../scripts/ui-fixture";

test(
  "remote drafts survive uncertain receipts and late acceptance clears only the sent draft",
  () =>
    runUiFixture(
      "remote-recovery",
      `
  const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
  const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
  const {RemoteConversation}=await import(${fixtureImport(new URL("./RemoteConversation.tsx", import.meta.url))});
  const {RemoteSidebar}=await import(${fixtureImport(new URL("./RemoteSidebar.tsx", import.meta.url))});
  const {remoteDraftKey,saveRemoteDraft}=await import(${fixtureImport(new URL("./remote-workspace.ts", import.meta.url))});
  const {useStore}=await import(${fixtureImport(new URL("./store.ts", import.meta.url))});
  await import(${fixtureImport(new URL("./styles.css", import.meta.url))});
  ${fixtureHelpers}
  const root=createFixtureRoot(createRoot);
  let sends=0,original,receipt,late;
  const history=[{id:'sample',role:'user',text:'Remote\\nmessage'},{id:'answer',role:'assistant',text:'Plain answer'}];
  const hosts=[{id:'a',name:'Test PC',online:true,projects:[{id:'p',name:'Project'}]}];
  window.__requests={remoteHosts:async()=>hosts,remoteWorkspace:async({query:q})=>{
    if(q.op==='send'){ sends++;original=q;if(late)return late.promise;throw Error('lost acknowledgement'); }
    if(q.op==='receipt'){receipt=q;return {state:'unknown'};}
    if(q.op==='list')return {chats:[{chat:'b',title:'Test'}],total:1};
    return {messages:history,running:false};
  }};
  const open=view=>{
    useStore.setState({page:'remoteChat',remoteHosts:hosts,remoteThread:{host:'a',hostName:'Test PC',project:'p',projectName:'Project',chat:'b',title:'Test',view}});
    flushSync(()=>root.render(<>
      <aside className="sidebar"><RemoteSidebar/></aside>
      <div style={{height:400,width:'100%'}}><RemoteConversation/></div>
    </>));
  };
  open('old');const area=()=>document.querySelector('textarea');
  const button=text=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent===text);
  await until(()=>document.querySelector('.message.user > .user-bubble'),'shared bubble');
  check(document.querySelector('.message.user > .user-bubble').textContent===history[0].text,'remote text keeps its line breaks');
  check(!document.querySelector('.remote-message .user-bubble'),'assistant answers are not user bubbles');
  check(!!area()?.closest('.composer-dock > form.composer') && area().matches('.chat-text-area'),'remote uses the common dock, form and input');
  document.querySelector('.project-toggle').click();
  await until(()=>document.querySelector('.thread-row.active > button[aria-current="page"]'),'remote row uses the common selected state');
  check(!document.querySelector('.thread-row .thread-more'),'remote row does not offer local-only actions');
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(area(),'keep my words');
  area().dispatchEvent(new Event('input',{bubbles:true}));
  await until(()=>!button('送信').disabled,'send enabled');button('送信').click();
  await until(()=>button('受付を確認') && !button('受付を確認').disabled,'uncertain');
  const form=area().form;
  check(form.querySelector('[role="status"]').compareDocumentPosition(area()) & Node.DOCUMENT_POSITION_FOLLOWING,'receipt state stays above the editor');
  check(form.lastElementChild.matches('.composer-toolbar'),'only actions are rendered after the editor');
  flushSync(()=>root.render(null));sessionStorage.clear();open('new');
  await until(()=>area()?.value==='keep my words','restored draft');
  button('受付を確認').click();await wait();await until(()=>receipt && !button('再送せず下書きに戻す').disabled,'receipt lookup');
  check(receipt.view==='new' && receipt.id===original.id,'lookup original request using reopened chat');
  button('再送せず下書きに戻す').click();
  await until(()=>!area().disabled,'unlocked');
  check(sends===1 && area().value==='keep my words','recover text without resending');
  late=Promise.withResolvers();
  await until(()=>!button('送信').disabled,'explicit send enabled');
  button('送信').click();
  await until(()=>sends===2,'second send is in flight');
  const key=remoteDraftKey('a','b'), outbox=key+':pending:'+original.id;
  check(localStorage.getItem(outbox),'its receipt is persisted before dispatch');
  flushSync(()=>root.render(null));
  saveRemoteDraft(key,'a newer draft');
  open('new');
  await until(()=>area()?.value==='keep my words','reopening before the reply shows the unresolved send');
  late.resolve({disposition:'started'});
  await until(()=>!localStorage.getItem(outbox),'late acceptance clears its receipt offscreen');
  await until(()=>area()?.value==='a newer draft','the reopened thread keeps the newer draft');
  check(!button('受付を確認') && sends===2,'accepted send is not uncertain or repeated');
`,
    ),
  120_000,
);
