import { test } from "bun:test";
import { fixtureImport, runUiFixture } from "../scripts/ui-fixture";

const source = (path: string) => fixtureImport(new URL(path, import.meta.url));

test("tooltip stories theme the shell and wallpaper, not only the tooltip", async () => {
  await runUiFixture(
    "tooltip-story-theme",
    `
    const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
    const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
    const {default:preview}=await import(${source("./preview.tsx")});
    const {default:meta,States}=await import(${source("../src/stories/design-system/Tooltip.stories.tsx")});
    const {default:comparison,LighterSurface}=await import(${source("../src/stories/tooltips/Tooltips.stories.tsx")});
    const {createThemeTokens}=await import(${source("../src/mainview/dynamic-theme.ts")});
    const root=createRoot(document.getElementById('root'));
    const check=(ok,message)=>{if(!ok)throw Error(message)};
    const tokens=createThemeTokens('#7DBFBD');
    const originalAccent=getComputedStyle(document.documentElement).getPropertyValue('--ds-accent');
    const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
    const rgba=color=>{
      ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);
      return [...ctx.getImageData(0,0,1,1).data];
    };
    flushSync(()=>root.render(preview.decorators[0](()=>null,{parameters:{windowPreview:true}})));
    check(getComputedStyle(document.querySelector('.glass-wallpaper')).backgroundImage!=='none','other stories keep the original wallpaper');
    for(const [story, storyMeta, backdrops] of [
      [States,meta,['plain']],
      [LighterSurface,comparison,['code','image','plain','text']],
    ]){
      for(const backdrop of backdrops){
        const parameters={...storyMeta.parameters,...story.parameters};
        flushSync(()=>root.render(preview.decorators[0](
          ()=>story.render({backdrop}),{parameters}
        )));
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const shell=getComputedStyle(document.querySelector('.app-shell'));
        const wallpaper=getComputedStyle(document.querySelector('.glass-wallpaper'));
        check(shell.getPropertyValue('--ds-shell-start').trim()===tokens['--ds-shell-start'],'shell uses #7DBFBD theme');
        check(wallpaper.backgroundImage==='none','no blue/purple sample wallpaper');
        check(rgba(wallpaper.backgroundColor).join()===rgba(tokens['--ds-bg-primary']).join(),'wallpaper uses theme surface');
        const tips=[...document.querySelectorAll('.ui-tooltip')];
        check(tips.length===(story===States?4:16),'all content shapes rendered');
        for(const tip of tips){
          const style=getComputedStyle(tip);
          check(style.getPropertyValue('--ds-accent').trim()===tokens['--ds-accent'],'tooltip shares shell theme');
          check(Math.abs(rgba(style.backgroundColor)[3]-128)<=1,'surface remains 50% translucent');
        }
        if(story===LighterSurface){
          const standard=getComputedStyle(tips[0]),light=getComputedStyle(tips[4]),faint=getComputedStyle(tips[8]),milky=getComputedStyle(tips[12]);
          check(standard.backgroundColor!==light.backgroundColor,'tint comparison preserved');
          check(light.backgroundColor!==faint.backgroundColor,'extra-faint tint differs');
          check(standard.backdropFilter===light.backdropFilter,'blur unchanged');
          check(standard.color===light.color,'text unchanged');
          check(standard.backdropFilter===faint.backdropFilter&&standard.color===faint.color,'extra-faint variant changes only tint');
          const luminance=color=>{const [r,g,b]=rgba(color);return 0.2126*r+0.7152*g+0.0722*b};
          check(luminance(milky.backgroundColor)>luminance(faint.backgroundColor),'white tint raises brightness');
          check(milky.borderColor===faint.borderColor&&milky.backdropFilter===faint.backdropFilter&&milky.color===faint.color,'white tint preserves border, blur and text');
        }
      }
    }
    check(getComputedStyle(document.documentElement).getPropertyValue('--ds-accent')===originalAccent,'theme does not leak into other stories');
    window.__fixtureMetrics={theme:'#7DBFBD',stories:2,backdrops:4};
    `,
    { viewport: { width: 1280, height: 900 } },
  );
}, 120_000);
