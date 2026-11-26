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
  "notification panel paints above usage bars and updates for shared reads and pending clears",
  () =>
    runUiFixture(
      "notification-center",
      `
    const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
    const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
    const {NotificationCenter}=await import(${local("./NotificationCenter.tsx")});
    const {Notifications}=await import(${local("./Notifications.tsx")});
    const {ProviderUsageView}=await import(${local("./ProviderUsageView.tsx")});
    const {connectNoticeHistory,receiveNoticeHistory,receiveNoticeToast,useStore}=await import(${local("./store.ts")});
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
    </aside><Notifications/></div>));
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
    let pendingClear;
    await connectNoticeHistory(async request=>{
      sent.push(request);
      if(request.type==='clear') return new Promise((resolve,reject)=>{pendingClear={resolve,reject};});
      return snapshot;
    },[]);
    await wait();
    check(document.querySelector('.notification-badge').textContent==='2','both notices should be unread');
    document.querySelector('.notification-entry:last-child').click();
    check(sent.at(-1).type==='read'&&sent.at(-1).ids.join()==='n1','click must submit only the selected ID');
    receiveNoticeHistory({revision:2,notices:[{...initial,read:true},snapshot.notices[1]]});
    await wait();
    check(document.querySelector('.notification-badge').textContent==='1','first read should update the badge');
    const [all,unread]=document.querySelectorAll('.segmented-control.notification-filters button');
    check(all.getAttribute('aria-pressed')==='true'&&unread.textContent==='Unread (1)','all is selected and the unread count is shown');
    unread.click();await wait();
    const entries=()=>[...document.querySelectorAll('.notification-entry')];
    check(unread.getAttribute('aria-pressed')==='true'&&entries().length===1&&entries()[0].textContent.includes('Second notification'),'unread keeps only the unread entry');
    all.click();await wait();
    check(entries().length===2,'all restores the read entry');
    receiveNoticeHistory({revision:3,notices:snapshot.notices.map(n=>({...n,read:true}))});
    receiveNoticeHistory(snapshot);
    await wait();
    check(!document.querySelector('.notification-badge'),'another window should clear the badge without reloading');
    check(!document.querySelector('.notification-unread-dot'),'a stale reply must not bring back unread dots');

    const newest={...initial,id:'n3',message:'Arrived during clear'};
    const clearButton=document.querySelector('button[aria-label="Clear notifications"]');
    receiveNoticeToast({...initial,id:'transient'});
    await wait();
    check(document.querySelector('.toast'),'an active toast is visible before clearing');
    clearButton.click();
    await wait();
    check(clearButton.disabled && sent.at(-1).type==='clear','the pending clear disables the button');
    check(!document.querySelector('.notification-entry, .toast, .notification-badge'),'clear hides history, toasts and badge before the host replies');
    receiveNoticeHistory({revision:4,notices:[...snapshot.notices.map(n=>({...n,read:true})),newest]});
    await wait();
    check(!document.querySelector('.notification-entry, .notification-badge'),'an intervening host update must not flash old history');
    pendingClear.reject(new Error('Clear failed'));
    await wait();
    check(!clearButton.disabled && document.querySelectorAll('.notification-entry').length===3,'failure restores the latest history');
    check(document.querySelector('.notification-badge').textContent==='1','failure restores the latest unread count');
    check(document.querySelector('.notifications').textContent.includes('Clear failed'),'failure is shown as a toast');

    clearButton.click();
    await wait();
    const cleared={revision:5,notices:[]};
    const afterClear={...initial,id:'n4',message:'After clear'};
    receiveNoticeHistory(cleared);
    receiveNoticeHistory({revision:6,notices:[afterClear]});
    receiveNoticeToast(afterClear);
    pendingClear.resolve(cleared);
    await wait();
    check(document.querySelectorAll('.notification-entry').length===1 && document.querySelector('.notification-entry').textContent.includes('After clear'),'a late clear response cannot remove newer history');
    check(document.querySelectorAll('.toast').length===1 && document.querySelector('.toast').textContent.includes('After clear'),'only the new toast remains after success');
  `,
    ),
  60_000,
);
