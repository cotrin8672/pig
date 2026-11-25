// Compare the installed versions using real browser selection and PiG's saved annotation.
import { fixtureHelpers, fixtureImport, runUiFixture } from "./ui-fixture";

for (const mode of ["current", "answer"]) {
  await runUiFixture(
    `body-${mode}`,
    `
    await import(${fixtureImport(new URL("../src/mainview/styles.css", import.meta.url))});
    const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
    const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
    const {rememberAnnotationRange,useAnnotationHighlight}=await import(${fixtureImport(new URL("../src/mainview/annotation-highlights.ts", import.meta.url))});
    const {${mode === "current" ? "Markdown" : "AnswerMarkdown"}:Renderer}=await import(${fixtureImport(new URL("../src/mainview/MessageContent.tsx", import.meta.url))});
    const body=(text,live)=><Renderer text={text} streaming={live}/>;
    ${fixtureHelpers}
    const root=createFixtureRoot(createRoot);let card=false;
    const reference=async()=>{
      const a=document.querySelector('article a[href="https://example.org/manual"]');
      if(a)return true;
      const b=[...document.querySelectorAll('article button[data-streamdown="link"]')].find(el=>el.textContent==="説明");
      if(!b)return false;
      b.click();await wait();
      const dialog=document.querySelector('[role="dialog"],dialog,[data-streamdown*="modal"]');
      const found=!!dialog?.textContent.includes("https://example.org/manual")||!!document.querySelector('a[href="https://example.org/manual"]');
      const cancel=[...document.querySelectorAll("button")].find(el=>/^(cancel|close)$/i.test(el.textContent.trim()));cancel?.click();await wait();
      return found;
    };
    function Card(){const ref=useAnnotationHighlight("probe");return <li ref={ref}>引用</li>;}
    const render=(text,live=true)=>flushSync(()=>root.render(<><article className="message assistant"><div className="prose">{body(text,live)}</div></article>{card&&<Card/>}</>));
    const prefix="最初の **選んだ文章🍵** です。\\n\\n[説明][ref]\\n\\n";
    let text=prefix+"$$\\nx^2 + y^2";render(text);
    const strong=()=>document.querySelector('strong,[data-streamdown="strong"]');
    await until(strong,"first paragraph");
    const metrics=window.__fixtureMetrics={partialMath:!!document.querySelector(".katex")};
    const range=document.createRange();range.selectNodeContents(strong());
    const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
    rememberAnnotationRange("probe",range);card=true;
    text+=" = z^2\\n$$\\n\\n[ref]: https://example.org/manual\\n\\n"+"$$x^2+y^2=z^2$$\\n\\n".repeat(79);
    render(text);await until(()=>document.querySelectorAll(".katex").length===80,"complete math");
    metrics.liveLink=await reference();
    const times=[];
    for(let i=0;i<12;i++){text+=" more"+i;const start=performance.now();render(text);await until(()=>document.querySelector("article").textContent.includes("more"+i),"visible append");await wait();times.push(performance.now()-start);}
    metrics.medianAppendFrameMs=times.sort((a,b)=>a-b)[6];
    const quote=()=>[selection.toString(),...[...(CSS.highlights.get("pig-annotation-saved")??[])].map(r=>r.toString())];
    metrics.liveQuote=quote();
    render(text,false);await wait();await new Promise(r=>setTimeout(r,250));
    metrics.finalQuote=quote();metrics.finalLink=await reference();
    metrics.referenceParagraph=[...document.querySelectorAll("article p")].find(p=>p.textContent.includes("説明"))?.outerHTML.slice(0,600);
    document.addEventListener("copy",e=>{metrics.copySelection=selection.toString();e.preventDefault()},{once:true});
    window.__fixtureInput={method:"Input.dispatchKeyEvent",params:{type:"rawKeyDown",key:"c",code:"KeyC",windowsVirtualKeyCode:67,modifiers:2}};
    await until(()=>!window.__fixtureInput,"copy input");
    check(metrics.liveLink && metrics.finalLink && metrics.copySelection==="選んだ文章🍵" && [...metrics.liveQuote,...metrics.finalQuote].every(q=>q==="選んだ文章🍵"), "link/selection regression: "+JSON.stringify(metrics));
    if(${mode === "answer"})check(metrics.partialMath,"incomplete display math must render");
    root.unmount();
  `,
  );
}
