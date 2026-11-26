import { test } from "bun:test";
import {
  fixtureHelpers,
  fixtureImport,
  runUiFixture,
} from "../../scripts/ui-fixture";

test(
  "remote draft and uncertain receipt survive reopening without a second send",
  () =>
    runUiFixture(
      "remote-recovery",
      `
  const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
  const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
  const {RemoteConversation}=await import(${fixtureImport(new URL("./RemoteConversation.tsx", import.meta.url))});
  const {useStore}=await import(${fixtureImport(new URL("./store.ts", import.meta.url))});
  ${fixtureHelpers}
  const root=createFixtureRoot(createRoot);
  let sends=0,original,receipt;
  window.__requests={remoteWorkspace:async({query:q})=>{
    if(q.op==='send'){ sends++;original=q;throw Error('lost acknowledgement'); }
    if(q.op==='receipt'){receipt=q;return {state:'unknown'};}
    return {messages:[],running:false};
  }};
  const open=view=>{
    useStore.setState({remoteThread:{host:'a',chat:'b',title:'Test',view}});
    flushSync(()=>root.render(<RemoteConversation/>));
  };
  open('old');const area=()=>document.querySelector('textarea');
  const button=text=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent===text);
  await until(()=>button('送信') && area(),'composer');
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(area(),'keep my words');
  area().dispatchEvent(new Event('input',{bubbles:true}));
  await until(()=>!button('送信').disabled,'send enabled');button('送信').click();
  await until(()=>button('受付を確認') && !button('受付を確認').disabled,'uncertain');
  flushSync(()=>root.render(null));sessionStorage.clear();open('new');
  await until(()=>area()?.value==='keep my words','restored draft');
  button('受付を確認').click();await wait();await until(()=>receipt && !button('再送せず下書きに戻す').disabled,'receipt lookup');
  check(receipt.view==='new' && receipt.id===original.id,'lookup original request using reopened chat');
  button('再送せず下書きに戻す').click();
  await until(()=>!area().disabled,'unlocked');
  check(sends===1 && area().value==='keep my words','recover text without resending');
`,
    ),
  120_000,
);
