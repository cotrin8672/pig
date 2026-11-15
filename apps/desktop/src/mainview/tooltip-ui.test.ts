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
  "tooltip glides between gapless rows and re-enters across gaps",
  () =>
    runUiFixture(
      "tooltip-switch",
      `
    const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
    const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
    const {TooltipLayer,useTooltip}=await import(${local("./Tooltip.tsx")});
    await import(${local("./styles.css")});
    ${fixtureHelpers}
    const pause=ms=>new Promise(r=>setTimeout(r,ms));
    function Fixture(){
      const tooltip=useTooltip();
      return <div style={{display:'flex',gap:200,padding:40}}>
        <ul style={{listStyle:'none',margin:0,padding:0,width:200}}>
          {['First session','Second session with a longer title','Third'].map(label=>
            <li key={label} className="row" style={{height:28}} {...tooltip({tier:'detail',side:'right',label,description:'piris'})}>{label}</li>)}
        </ul>
        <div className="icons" style={{display:'flex',gap:6,height:32}}>
          {['One','Two'].map(label=><button key={label} type="button" style={{width:32}} {...tooltip({tier:'label',side:'top',label})}>{label[0]}</button>)}
        </div>
      </div>;
    }
    const root=createFixtureRoot(createRoot);
    flushSync(()=>root.render(<TooltipLayer><Fixture/></TooltipLayer>));await wait();
    const rows=[...document.querySelectorAll('.row')],icons=[...document.querySelectorAll('.icons button')];
    const panel=()=>document.querySelector('[role="tooltip"]');
    const names=el=>el.getAnimations({subtree:true}).map(a=>a.animationName??a.transitionProperty);
    const centre=el=>{const r=el.getBoundingClientRect();return r.top+r.height/2;};
    // Leaving one React element for another dispatches both in one event, as a real pointer does.
    const move=(from,to)=>from.dispatchEvent(new PointerEvent('pointerout',{bubbles:true,relatedTarget:to}));
    rows[0].dispatchEvent(new PointerEvent('pointerover',{bubbles:true,relatedTarget:document.body}));
    await until(()=>panel(),'the first row opens after the delay');await wait();
    const first=panel(),firstContent=first.querySelector('.ui-tooltip-swap');
    check(names(first).includes('tooltip-in')&&!names(first).includes('top'),'a fresh open fades in without gliding: '+names(first));
    await pause(200);
    move(rows[0],rows[1]);await wait();
    check(panel()===first,'gapless rows keep the same surface open');
    check(first.querySelector('.ui-tooltip-swap')!==firstContent&&first.textContent.includes('Second session'),'the content is replaced');
    const switching=names(first);
    check(switching.includes('top')&&switching.includes('tooltip-swap')&&!switching.includes('tooltip-in'),'a row switch glides and cross-fades the content without replaying the entry: '+switching);
    await pause(250);
    check(Math.abs(centre(first)-centre(rows[1]))<1.5,'the glide ends centred on the new row');
    move(rows[1],document.querySelector('ul').parentElement);await wait();
    check(!panel(),'leaving the list closes the tooltip');
    icons[0].dispatchEvent(new PointerEvent('pointerover',{bubbles:true,relatedTarget:document.body}));
    await until(()=>panel()?.textContent==='One','the icon opens immediately while warm');await pause(200);
    move(icons[0],icons[0].parentElement);await wait();
    await pause(80);
    move(icons[0].parentElement,icons[1]);await wait();
    const reopened=panel();
    check(reopened&&reopened.textContent==='Two','crossing a gap reopens immediately');
    check(names(reopened).includes('tooltip-in')&&!names(reopened).includes('top'),'crossing a gap re-enters with the fade instead of gliding: '+names(reopened));
  `,
    ),
  60_000,
);
