import { test } from "bun:test";
import { existsSync } from "node:fs";
import {
  fixtureEdge,
  fixtureHelpers,
  fixtureImport,
  runUiFixture,
} from "../../scripts/ui-fixture";

const local = (path: string) => fixtureImport(new URL(path, import.meta.url));

test.skipIf(!existsSync(fixtureEdge) && !process.env.PIG_REQUIRE_UI_TESTS)(
  "notification panel paints above usage bars and follows shared read state",
  () =>
    runUiFixture(
      "notification-center",
      `
    const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
    const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
    const {NotificationCenter}=await import(${local("./NotificationCenter.tsx")});
    const {ProviderUsageView}=await import(${local("./ProviderUsageView.tsx")});
    const {connectNoticeHistory,receiveNoticeHistory,useStore}=await import(${local("./store.ts")});
    const {usageFixtures,usageFixtureTime}=await import(${local("../stories/providers/usage-fixtures.ts")});
    await import(${local("./styles.css")});
    ${fixtureHelpers}
    const root=createFixtureRoot(createRoot);
    useStore.setState(s=>({settings:{...s.settings,language:'en'},
      noticeHistory:[{id:'n1',level:'error',message:'Failed to import 2 chats',createdAt:Date.now(),read:false}]}));
    flushSync(()=>root.render(<div className="app-shell" style={{height:'100vh'}}><aside className="sidebar" style={{height:'100%'}}>
      <div style={{flex:1}}/>
      <ProviderUsageView entries={usageFixtures} display="remaining" now={usageFixtureTime}/>
      <div className="sidebar-footer"><NotificationCenter/></div>
    </aside></div>));
    await wait();
    document.querySelector('.notification-center').open=true;await wait();
    const panel=document.querySelector('.notification-panel').getBoundingClientRect();
    const covered=[...document.querySelectorAll('.provider-usage-card *')].filter(el=>{
      const r=el.getBoundingClientRect();
      return r.width>0&&r.height>0&&r.top>=panel.top&&r.bottom<=panel.bottom&&r.left>=panel.left&&r.right<=panel.right;
    });
    check(covered.length>0,'the fixture must place usage rows under the open panel');
    for(const el of covered){
      const r=el.getBoundingClientRect(),hit=document.elementFromPoint((r.left+r.right)/2,(r.top+r.bottom)/2);
      check(hit?.closest('.notification-panel'),'usage content must not paint above the notification panel: '+el.className);
    }
    const [initial]=useStore.getState().noticeHistory;
    const snapshot={revision:1,notices:[initial,{...initial,id:'n2',message:'Second notification'}]};
    const sent=[];
    await connectNoticeHistory(async request=>{
      sent.push(request);
      return snapshot;
    },[]);
    await wait();
    check(document.querySelector('.notification-badge').textContent==='2','both notices should be unread');
    document.querySelector('.notification-entry:last-child').click();
    check(sent.at(-1).type==='read'&&sent.at(-1).ids.join()==='n1','click must submit only the selected ID');
    receiveNoticeHistory({revision:2,notices:[{...initial,read:true},snapshot.notices[1]]});
    await wait();
    check(document.querySelector('.notification-badge').textContent==='1','first read should update the badge');
    receiveNoticeHistory({revision:3,notices:snapshot.notices.map(n=>({...n,read:true}))});
    receiveNoticeHistory(snapshot);
    await wait();
    check(!document.querySelector('.notification-badge'),'another window should clear the badge without reloading');
    check(!document.querySelector('.notification-unread-dot'),'a stale reply must not bring back unread dots');
  `,
    ),
  60_000,
);
