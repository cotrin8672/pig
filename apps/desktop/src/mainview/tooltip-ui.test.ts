import { test } from "bun:test";
import { existsSync } from "node:fs";
import {
  fixtureEdge,
  fixtureHelpers,
  fixtureImport,
  runUiFixture,
} from "../../scripts/ui-fixture";

const local = (path: string) => fixtureImport(new URL(path, import.meta.url));

test(
  "all tooltip surfaces use the adopted faint tint with a neutral lift",
  () =>
    runUiFixture(
      "tooltip-surface",
      `
    const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
    const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
    const {TooltipShapes}=await import(${local("../stories/tooltips/TooltipPreview.tsx")});
    const {applyThemeTokens}=await import(${local("./dynamic-theme.ts")});
    await import(${local("./styles.css")});
    ${fixtureHelpers}
    const root=createFixtureRoot(createRoot);
    flushSync(()=>root.render(<div className="app-shell" style={{display:'block',padding:24}}>
      <TooltipShapes backdrop="text"/>
      <div className="usage-popover ui-tooltip" style={{left:24,top:400}}>Usage details</div>
      <div className="stats-tip ui-tooltip" style={{left:320,top:400}}>Statistics</div>
    </div>));
    await wait();
    document.getAnimations().filter(a=>a.animationName==='tooltip-in').forEach(a=>a.finish());
    const reference=document.createElement('div');
    reference.style.backgroundColor='rgb(from color-mix(in srgb, var(--ds-text-primary) 12%, color-mix(in srgb, var(--ds-accent) 4%, var(--ds-bg-popover))) r g b / 0.5)';
    reference.style.border='1px solid color-mix(in srgb, var(--ds-accent) 16%, transparent)';
    document.body.append(reference);
    const dark=document.createElement('div');
    dark.style.backgroundColor='rgb(from color-mix(in srgb, var(--ds-accent) 4%, var(--ds-bg-popover)) r g b / 0.5)';
    document.body.append(dark);
    const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
    const rgba=color=>{
      ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);
      return [...ctx.getImageData(0,0,1,1).data];
    };
    const brightness=color=>{const [r,g,b]=rgba(color);return 0.2126*r+0.7152*g+0.0722*b};
    for(const seed of ['#7DBFBD','#809cce','#dc91b6','#a8a8a8']){
      applyThemeTokens(document.documentElement.style,seed);await wait();
      const expected=getComputedStyle(reference),surfaces=[...document.querySelectorAll('.ui-tooltip')];
      check(surfaces.length===6,'all four shapes, usage and statistics surfaces');
      for(const surface of surfaces){
        const style=getComputedStyle(surface);
        check(style.backgroundColor===expected.backgroundColor,'surface matches adopted white tint: '+seed);
        check(style.borderTopColor===expected.borderTopColor,'surface uses 16% accent border');
        check(Math.abs(rgba(style.backgroundColor)[3]-128)<=1&&style.opacity==='1','50% background alpha without fading text');
        check(style.backdropFilter==='blur(4px) saturate(1.4)','blur and saturation are unchanged');
        check(brightness(style.backgroundColor)>brightness(getComputedStyle(dark).backgroundColor),'white lift prevents the faint tint from becoming dark');
      }
    }
    reference.remove();dark.remove();
    applyThemeTokens(document.documentElement.style,'#7DBFBD');await wait();
  `,
    ),
  60_000,
);

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

test.skipIf(!existsSync(fixtureEdge) && !process.env.PIG_REQUIRE_UI_TESTS)(
  "a tooltip with an action stays open across the gap and runs it once",
  () =>
    runUiFixture(
      "tooltip-action",
      `
    const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
    const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
    const {TooltipLayer,useTooltip}=await import(${local("./Tooltip.tsx")});
    await import(${local("./styles.css")});
    ${fixtureHelpers}
    const pause=ms=>new Promise(r=>setTimeout(r,ms));
    let runs=0;
    function Fixture(){
      const tooltip=useTooltip();
      return <div style={{padding:120}}>
        <span className="meter" style={{display:'inline-block',width:40,height:20}} {...tooltip({tier:'detail',side:'top',label:'Context 19% used',description:'186.1k / 1M',action:{label:'Compact context',run:()=>runs++}})}>19%</span>
        <span className="plain" style={{display:'inline-block',width:40,height:20,marginLeft:80}} {...tooltip({tier:'label',side:'top',label:'Plain'})}>P</span>
      </div>;
    }
    const root=createFixtureRoot(createRoot);
    flushSync(()=>root.render(<TooltipLayer><Fixture/></TooltipLayer>));await wait();
    const meter=document.querySelector('.meter'),plain=document.querySelector('.plain');
    const move=(from,to)=>from.dispatchEvent(new PointerEvent('pointerout',{bubbles:true,relatedTarget:to}));
    meter.dispatchEvent(new PointerEvent('pointerover',{bubbles:true,relatedTarget:document.body}));
    await until(()=>document.querySelector('.tooltip-action'),'the action tooltip opens');
    const panel=document.querySelector('.tooltip[data-interactive]');
    check(panel&&panel.getAttribute('role')==='group'&&getComputedStyle(panel).pointerEvents==='auto','an action makes the surface a hoverable group');
    move(meter,document.body);await pause(80);
    check(panel.isConnected,'crossing the gap does not close it');
    panel.dispatchEvent(new PointerEvent('pointerover',{bubbles:true,relatedTarget:document.body}));await pause(300);
    check(panel.isConnected,'the pointer inside keeps it open');
    panel.querySelector('.tooltip-action').click();await wait();
    check(runs===1&&!document.querySelector('.tooltip'),'the action runs once and closes the tooltip');
    meter.dispatchEvent(new PointerEvent('pointerover',{bubbles:true,relatedTarget:document.body}));
    await until(()=>document.querySelector('.tooltip-action'),'the action tooltip reopens');
    move(meter,document.body);await pause(300);
    check(!document.querySelector('.tooltip'),'leaving without reaching it closes after the grace period');
    plain.dispatchEvent(new PointerEvent('pointerover',{bubbles:true,relatedTarget:document.body}));
    await until(()=>document.querySelector('[role="tooltip"]'),'a plain tooltip opens');
    check(getComputedStyle(document.querySelector('[role="tooltip"]')).pointerEvents==='none','plain tooltips still ignore the pointer');
    move(plain,document.body);await wait();
    check(!document.querySelector('.tooltip'),'plain tooltips still close at once');
  `,
    ),
  60_000,
);
