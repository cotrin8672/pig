// Run before/after changing MessageContent, with --two-stage only on the old build.
import { fixtureHelpers, fixtureImport, runUiFixture } from "./ui-fixture";

const twoStage = process.argv.includes("--two-stage");
await runUiFixture(
  "answer-frames",
  `
  await import(${fixtureImport(new URL("../src/mainview/styles.css", import.meta.url))});
  const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
  const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
  const {AnswerMarkdown}=await import(${fixtureImport(new URL("../src/mainview/MessageContent.tsx", import.meta.url))});
  ${fixtureHelpers}
  check(!matchMedia('(prefers-reduced-motion: reduce)').matches,'probe needs normal motion');
  const root=createFixtureRoot(createRoot);
  const quote='選んだ文章🍵';
  let target='';
  const render=(live=true)=>flushSync(()=>root.render(<article className="message assistant"><div className="prose"><AnswerMarkdown text={'**'+quote+'**\\n\\n'+target} streaming={live}/></div></article>));
  render();
  const selected=document.querySelector('strong').firstChild;
  const range=document.createRange();range.setStart(selected,0);range.setEnd(selected,selected.length);
  const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
  const history=[];
  const sample=()=>{
    const body=document.querySelector('article').textContent;
    check(selection.anchorNode===selected && selection.focusNode===selected && selection.toString()===quote,'selection lost at '+body.length);
    check(body.startsWith(quote),'missing first paragraph: '+body);
    const text=body.slice(quote.length);
    check(target.startsWith(text) && text.length >= (history.at(-1)??0),'wrong prefix: '+text);
    history.push(text.length);
    return text.length;
  };
  const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
  const append=text=>{target+=text;render();};
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  await wait();
  const long='日本語の文章を少しずつ表示して、途中の文字も読めるか確かめます。'.repeat(5);
  append(long);
  const partial=new Set();
  const end=performance.now()+2000;
  do {
    await frame();const n=sample();if(n===target.length)break;
    if(n>0)partial.add(n);
    check(performance.now()<end,'append did not settle: '+history);
  } while(true);
  // Uneven sizes and overlapping arrivals, including completion while behind.
  await delay(39);append('次に、');await frame();sample();
  append('直前の追記が流れている間にも新しい情報が届きます。'.repeat(4));
  await delay(21);await frame();sample();append('続報です。');
  await until(()=>sample()===target.length,'overlapping appends did not settle');
  append('ここで回答を完了します。'.repeat(8));
  const before=sample();
  check(before<target.length,'no pending text at stop: '+history);
  render(false);
  check(sample()===target.length,'completion not synchronous: '+history);
  await delay(160);await frame();check(sample()===target.length,'stale frame after stop');
  window.__fixtureMetrics={intermediateLengths:[...partial],pendingAtStop:target.length-before,finalLength:target.length,selection:selection.toString()};
  check(${twoStage ? "partial.size===1" : "partial.size>=2"},'unexpected intermediate frames: '+JSON.stringify(window.__fixtureMetrics));
  root.unmount();
`,
);
