import { test } from "bun:test";
import { existsSync } from "node:fs";
import {
  fixtureEdge,
  fixtureHelpers,
  fixtureImport,
  runUiFixture,
} from "../../scripts/ui-fixture";

test.skipIf(!existsSync(fixtureEdge) && !process.env.PIG_REQUIRE_UI_TESTS)(
  "turn rail stays out of text selection and its right-biased ticks animate together",
  () =>
    runUiFixture(
      "turn-rail",
      `
      const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
      const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
      const {TurnRail}=await import(${fixtureImport(new URL("./TurnRail.tsx", import.meta.url))});
      await import(${fixtureImport(new URL("./styles.css", import.meta.url))});
      ${fixtureHelpers}
      const records=Array.from({length:60},(_,i)=>({id:String(i),kind:"message",message:{role:"user",content:"Turn "+i}}));
      const root=createFixtureRoot(createRoot);
      const thread={current:null};
      flushSync(()=>root.render(
        <div style={{position:"relative",marginLeft:32,height:560,background:"#000","--chat-width":"480px","--ds-text-faint":"#aaa","--ds-text-secondary":"#aaa","--ds-accent":"#62e5ff"}}>
          <section ref={thread} style={{height:"100%",display:"grid",placeItems:"center"}}>
            <p>Select this text without opening the conversation turns.</p>
          </section>
          <TurnRail sessionId="test" records={records} thread={thread}/>
        </div>
      ));
      const rail=document.querySelector(".turn-rail");
      const ticks=rail.firstElementChild;
      const input=async (type,point,extra={})=>{
        window.__fixtureInput={method:"Input.dispatchMouseEvent",params:{type,...point,...extra}};
        await until(()=>!window.__fixtureInput,"input "+type);
        await wait();
      };
      const center=element=>{
        const rect=element.getBoundingClientRect();
        return {x:rect.left+rect.width/2,y:rect.top+rect.height/2};
      };
      const point=center(ticks.children[14]);
      const hit=()=>rail.contains(document.elementFromPoint(point.x,point.y));
      const open=()=>ticks.querySelector("[data-open]");
      await input("mouseMoved",point);
      check(open()===ticks.children[14]&&hit(),"hover opens the turn under the pointer");
      check(ticks.scrollHeight>ticks.clientHeight&&ticks.clientWidth===ticks.offsetWidth&&getComputedStyle(ticks).scrollbarWidth==="none","overflow has no visible scrollbar or gutter, even on hover");
      await until(()=>!ticks.getAnimations({subtree:true}).length,"tick transitions settle");

      const pixels=await capturePixels();
      const line=i=>{
        const tick=ticks.children[i];
        const {left}=tick.getBoundingClientRect(),{right}=ticks.getBoundingClientRect();
        const {y}=center(tick);
        const painted=[];
        for(let x=Math.ceil(left);x<right;x++) if(pixels(x,y)[0]>30) painted.push(x);
        return {length:painted.length,left:painted[0],right:painted.at(-1)};
      };
      const peak=line(14),near=line(15),far=line(16);
      check(peak.length>near.length&&near.length-far.length>=7,"the mound falls off steeply");
      const rest=line(9);
      const leftGrowth=rest.left-peak.left,rightGrowth=peak.right-rest.right;
      check(leftGrowth>=3&&rightGrowth-leftGrowth>=8,"the peak extends a little to the left and farther to the right");
      const tinted=i=>{
        const {left,right}=line(i),{y}=center(ticks.children[i]);
        const [r,,b]=pixels((left+right)/2,y);
        return b-r>40;
      };
      check(tinted(14)&&[0,12,13,15,16].every(i=>!tinted(i)),"only the previewed tick uses the accent");
      const [r,g,b]=pixels((peak.left+peak.right)/2,point.y);
      check(Math.abs(r-98)<=10&&Math.abs(g-229)<=10&&Math.abs(b-255)<=10,"the previewed tick paints the accent without fading it into the background");

      const before=open();
      window.__fixtureInput={method:"Input.dispatchMouseEvent",params:{type:"mouseWheel",x:ticks.getBoundingClientRect().left-8,y:point.y,deltaX:0,deltaY:50}};
      await until(()=>{
        const after=open();
        if(!after||after===before)return false;
        const transitions=[before,after].flatMap(tick=>{
          const animations=tick.getAnimations({subtree:true});
          return ["width","translate","background-color"].map(property=>animations.find(animation=>animation.transitionProperty===property));
        });
        return transitions.every(animation=>animation&&animation.startTime===transitions[0]?.startTime&&animation.effect.getTiming().duration===transitions[0].effect.getTiming().duration);
      },"the previous and next preview tick animate color, width and offset together");
      await until(()=>!window.__fixtureInput,"wheel input acknowledged");
      check(ticks.scrollTop>0,"the rail still scrolls with the wheel");

      const text=thread.current.querySelector("p");
      const from=center(text);
      await input("mousePressed",from,{button:"left",buttons:1,clickCount:1});
      await input("mouseMoved",{x:from.x-100,y:from.y},{button:"left",buttons:1});
      await input("mouseMoved",point,{button:"left",buttons:1});
      check(!hit()&&!open()&&getComputedStyle(rail).visibility==="hidden","dragging into the rail does not reveal or hit it");
      await input("mouseReleased",point,{button:"left",buttons:0,clickCount:1});
      check(!getSelection().isCollapsed&&!hit(),"rail stays hidden until the text selection is cleared");
      getSelection().removeAllRanges();
      await until(hit,"the rail is interactive again");
      await input("mouseMoved",point);
      check(open(),"preview returns after clearing selection");
      `,
    ),
  60_000,
);
