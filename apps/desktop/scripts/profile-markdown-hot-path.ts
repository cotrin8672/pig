// Offline Edge probe: production worker round trip, not React paint or user data.
import { fixtureImport, runUiFixture } from "./ui-fixture";

await runUiFixture(
  "markdown-hot-path",
  `
  await import(${fixtureImport(new URL("../src/mainview/styles.css", import.meta.url))});
  const {prepareMarkdown}=await import(${fixtureImport(new URL("../src/mainview/markdown-processing.ts", import.meta.url))});
  const m=window.__fixtureMetrics={};
  const {parseMarkdown}=await import(${fixtureImport(new URL("../src/mainview/markdown-engine.ts", import.meta.url))});
  // Probe the proposed blank-line split against rendered structure (not just offsets).
  const prefix="Read [the manual][docs].\\n\\n";
  const suffix="[docs]: https://example.org/docs";
  const hasLink=nodes=>nodes.some(n=>n.tagName==="a"||n.children&&hasLink(n.children));
  m.tailOnly={fullResolvesLink:hasLink(parseMarkdown(prefix+suffix,true).tree.children),
    splitResolvesLink:hasLink([...parseMarkdown(prefix,true).tree.children,...parseMarkdown(suffix,true).tree.children])};
  for(const kinds of [1,16,80]){
    const body=Array.from({length:80},(_,i)=>"$x_{"+i%kinds+"}$").join("\\n\\n");
    const cache=new Map(),times=[[],[]];
    for(let i=0;i<8;i++){
      const text=body+"\\n\\n"+"word ".repeat(i+1),results=[];
      for(const j of [i%2,1-i%2]){
        const t=performance.now();results[j]=parseMarkdown(text,true,j?cache:undefined);
        if(i>0)times[j].push(performance.now()-t);
      }
      if(JSON.stringify(results[0])!==JSON.stringify(results[1]))throw Error("cached tree mismatch");
    }
    m["unique"+kinds]=times.map(t=>t.sort((a,b)=>a-b)[3]);
  }
  for(const [name,body] of [
    ["paragraphs","Paragraph with **emphasis**.\\n\\n".repeat(100)],
    ["table","|A|B|\\n|---|---|\\n"+"| text | 123 |\\n".repeat(250)],
    ["math","$$x^2 + y^2 = z^2$$\\n\\n".repeat(80)]
  ]){
    const run=async text=>{const t=performance.now();const result=await prepareMarkdown(text,undefined,true);
      if(!result?.nodes)throw Error("missing parsed output"); return performance.now()-t;};
    const first=await run(body);const times=[];let text=body;
    for(let i=0;i<12;i++){text+=" more";times.push(await run(text));}
    times.sort((a,b)=>a-b);
    m[name]={chars:body.length,firstMs:first,appendMedianMs:(times[5]+times[6])/2,appendMaxMs:times[11],sameTextCacheMs:await run(text)};
  }
`,
);
