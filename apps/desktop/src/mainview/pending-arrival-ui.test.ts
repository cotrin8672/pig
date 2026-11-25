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
  "only newly presented pending messages rise, across queue moves, confirmation and remounts",
  () =>
    runUiFixture(
      "pending-arrival",
      `
    const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
    const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
    const {OpeningMessages}=await import(${local("./ChatOpening.tsx")});
    const {OptimisticMessages}=await import(${local("./OptimisticMessages.tsx")});
    const {MessageQueue}=await import(${local("./MessageQueue.tsx")});
    const {useStore}=await import(${local("./store.ts")});
    const {sends}=await import(${local("./rpc.ts")});
    ${fixtureHelpers}
    const root=createFixtureRoot(createRoot);
    const motion=Object.assign(new EventTarget(),{matches:false});
    const match=window.matchMedia.bind(window);
    window.matchMedia=q=>q==='(prefers-reduced-motion: reduce)'?motion:match(q);
    const played=[];
    const animate=Element.prototype.animate;
    Element.prototype.animate=function(frames,opts){
      const animation=animate.call(this,frames,opts);
      played.push({node:this,animation,frames,opts}); return animation;
    };
    const row=id=>({id,content:{text:id,images:[],pastes:[]}});
    const a=row('initial'), b=row('queue'), c=row('steer');
    let items=[a], steering=[], live=[], records=[];
    sends.optimistic=()=>live;
    const render=()=>flushSync(()=>root.render(<><OpeningMessages/><OptimisticMessages snapshot={{info:{id:'chat'},address:{},transcript:{records,running:false}}}/><MessageQueue items={items} steering={steering} onEdit={()=>{}} onDelete={()=>{}}/></>));
    render(); check(played.length===0,'initial rows are not arrivals');
    items=[a,b]; steering=[c]; render();
    check(played.length===2&&played.every(x=>x.node.matches('li > .message-queue-row-content')&&x.opts.duration===120&&x.frames[0].transform==='translateY(4px)'),'both kinds of new tray rows rise');
    const trayRows=[...document.querySelectorAll('.message-queue li')];
    const bounds=()=>trayRows.map(el=>{const {y,height}=el.getBoundingClientRect();return [y,height]});
    const before=bounds();
    check(before.every(([,h])=>h>0&&h===before[0][1]),'steering and queue have the same measured height');
    for(const time of [20,60,120]){
      for(const {animation} of played){animation.pause(); animation.currentTime=time;}
      check(JSON.stringify(bounds())===JSON.stringify(before),'row geometry stays fixed throughout entrance');
    }
    items=[b,a]; render(); items=[a]; steering=[b,c]; render();
    check(played.length===2,'reordering and promoting a row do not replay');
    const d=row('live'); live=[{key:{requestId:d.id},content:d.content}]; render();
    check(played.length===3&&played.at(-1).node.matches('article.message.user'),'optimistic user bubble rises');
    records=[{requestId:d.id}]; render(); check(!document.querySelector('article'),'confirmed optimistic bubble disappears');
    records=[]; render(); check(played.length===3,'redisplaying same request is silent');
    flushSync(()=>root.render(null));render();check(played.length===3,'remount is silent');
    flushSync(()=>useStore.setState({openingTarget:{cwd:'project',queued:[{kind:'send',...row('opening'),timestamp:1}]}}));
    check(played.length===4&&played.at(-1).node.textContent.includes('opening'),'first opening send rises');
    motion.matches=true; motion.dispatchEvent(new Event('change'));
    check(played.at(-1).animation.playState==='idle','switching to reduced motion stops the entrance');
    items=[a,row('quiet')];render();check(played.length===4,'reduced motion creates no animation');
  `,
    ),
  60_000,
);
