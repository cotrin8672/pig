// Isolated Edge. Tests Zustand ownership + the production prepend path, not DOM.
import { fixtureImport, runUiFixture } from "./ui-fixture";

await runUiFixture(
  "renderer-retention",
  `
    const {useStore}=await import(${fixtureImport(new URL("../src/mainview/store.ts", import.meta.url))});
    const {receiveSnapshot,receiveRuntime}=await import(${fixtureImport(new URL("../src/mainview/runtime-events.ts", import.meta.url))});
    const {prependHistory}=await import(${fixtureImport(new URL("../src/mainview/chat-snapshot.ts", import.meta.url))});
    const {emptyTranscript}=await import(${fixtureImport(new URL("../src/shared/transcript.ts", import.meta.url))});
    await import(${fixtureImport(new URL("../src/mainview/styles.css", import.meta.url))});
    const assert=(ok,msg)=>{if(!ok)throw Error(msg)};
    const ids=Array.from({length:8},(_,i)=>"fixture-"+i);
    const perPage=50;
    const record=(id,order)=>{
      const a=new Uint8Array(24*1024);crypto.getRandomValues(a);
      const role="assistant", text=btoa(String.fromCharCode(...a));
      return {id:id+"-"+order,entryId:id+"-"+order,parentId:id+"-"+(order-1),
        order,branchId:"fixture",kind:"message",message:{role,content:[{type:"text",text}]}};
    };
    const makePage=(id,start)=>({...emptyTranscript(),
      records:Array.from({length:perPage},(_,i)=>record(id,start+i)),
      history:{revision:"fixture",before:start? id+"-"+start:undefined}});
    const metrics=window.__fixtureMetrics={};
    async function sample(label) {
      const state=useStore.getState();
      metrics[label]={snapshots:Object.keys(state.snapshots).length,records:
        Object.values(state.snapshots).reduce((n,s)=>n+s.transcript.records.length,0)};
      window.__fixtureHeap=label;
      for(let i=0;i<400&&window.__fixtureHeap;i++)await new Promise(r=>setTimeout(r,25));
      assert(!window.__fixtureHeap,"GC sample timed out");
    }
    const address=id=>({hostId:"fixture",sessionId:id,epoch:1});
    function add(id) {
      const addr=address(id);
      receiveSnapshot({address:addr,snapshotSeq:1,info:{id,cwd:"fixture",title:id,modified:0},effort:"off",
        transcript:makePage(id,200)});
      for(let start=150;start>=0;start-=perPage) useStore.setState(s=>{
        const current=s.snapshots[id], next=prependHistory(current,makePage(id,start),id+"-"+(start+perPage));
        assert(current!==next,"page not merged");
        return {snapshots:{...s.snapshots,[id]:next}};
      });
      receiveRuntime({type:"suspended",previous:addr,address:{...addr,epoch:2},snapshotSeq:2,
        historyRevision:"fixture",draftRevision:1});
    }
    await sample("baseline");
    for(const id of ids) add(id);
    await sample("8-suspended-with-pages");
    assert(metrics["8-suspended-with-pages"].records===2000,"all old pages retained");
    assert(Object.values(useStore.getState().snapshots).every(s=>s.suspended),"suspension not applied");
    // Diagnostic only: release the four local prepends, keep the actual wire-tail objects.
    useStore.setState(s=>({snapshots:Object.fromEntries(Object.entries(s.snapshots).map(([id,snap])=>
      [id,{...snap,transcript:{...snap.transcript,records:snap.transcript.records.slice(-perPage)}}]))}));
    await sample("retained-tails-only");
    assert(metrics["retained-tails-only"].records===400,"tail lost");
    useStore.setState({snapshots:{}});
    await sample("all-released");
  `,
  { realRpc: true, sampleHeap: true },
);
