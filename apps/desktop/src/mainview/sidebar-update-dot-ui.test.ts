import { test } from "bun:test";
import { existsSync } from "node:fs";
import {
  fixtureEdge,
  fixtureHelpers,
  fixtureImport,
  runUiFixture,
} from "../../scripts/ui-fixture";

test.skipIf(!existsSync(fixtureEdge) && !process.env.PIG_REQUIRE_UI_TESTS)(
  "settings and extension updates appear at the top right without shifting icons",
  () =>
    runUiFixture(
      "sidebar-update-dot",
      `
      const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
      const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
      const {App}=await import(${fixtureImport(new URL("./App.tsx", import.meta.url))});
      const {useStore}=await import(${fixtureImport(new URL("./store.ts", import.meta.url))});
      await import(${fixtureImport(new URL("./styles.css", import.meta.url))});
      ${fixtureHelpers}
      const root=createFixtureRoot(createRoot);
      flushSync(()=>useStore.setState(s=>({
        initialized:false,cachedSidebar:true,installed:[],appUpdate:undefined,
        settings:{...s.settings,language:'en'},
      })));
      flushSync(()=>root.render(<App/>));
      await wait();
      const icons=()=>[...document.querySelectorAll('.sidebar-footer .sidebar-icon')];
      const settings=icons()[0],provider=icons()[1],extensions=icons()[2];
      const rects=()=>icons().map(el=>{const r=el.getBoundingClientRect();return [r.x,r.y,r.width,r.height]});
      const before=rects();
      check(!document.querySelector('.sidebar-update-dot'),'no update badges before updates are known');
      const pkg={source:'npm:fixture',scope:'user',types:['extension'],updateAvailable:false};
      flushSync(()=>useStore.setState({installed:[pkg],installedLoaded:true}));
      check(!extensions.querySelector('.sidebar-update-dot'),'up-to-date packages must not show a badge');
      flushSync(()=>useStore.setState({
        installed:[pkg,{...pkg,source:'npm:other',updateAvailable:true}],
        appUpdate:{status:'available',current:'1.0.0',latest:'2.0.0'},
      }));
      await wait();
      check(JSON.stringify(rects())===JSON.stringify(before),'update badges must not move or resize icons');
      check(extensions.getAttribute('aria-label').includes('Update available'),'extension updates must have an accessible label');
      const probe=document.createElement('span');probe.style.color='var(--ds-highlight)';document.body.append(probe);
      const peer=provider.querySelector('.sidebar-provider-dot').getBoundingClientRect();
      check(document.querySelectorAll('.sidebar-update-dot').length===2,'both settings and extensions must show updates');
      for(const icon of [settings,extensions]){
        const badge=icon.querySelector('.sidebar-update-dot'),dot=badge.getBoundingClientRect(),button=icon.getBoundingClientRect();
        check(dot.width===peer.width&&dot.height===peer.height,'update badges must match the provider dot size');
        check(Math.abs(dot.top-button.top-3)<0.1&&Math.abs(button.right-dot.right-3)<0.1,'update badges must sit at the top right');
        check(getComputedStyle(badge).backgroundColor===getComputedStyle(probe).color,'update badges must use the highlight colour');
      }
      const providerRect=provider.getBoundingClientRect();
      check(Math.abs(providerRect.bottom-peer.bottom-3)<0.1,'provider status must remain at the bottom right');
      flushSync(()=>useStore.setState({installed:[pkg]}));
      check(!extensions.querySelector('.sidebar-update-dot')&&settings.querySelector('.sidebar-update-dot'),'finishing extension updates must clear only their badge');
      flushSync(()=>useStore.setState({installed:[{...pkg,updateAvailable:true}]}));
      check(extensions.querySelector('.sidebar-update-dot'),'a new extension update must show its badge');
      flushSync(()=>useStore.setState({installed:[],appUpdate:undefined}));
      check(!document.querySelector('.sidebar-update-dot'),'removal and app update completion must clear their badges');
      check(extensions.getAttribute('aria-label')==='Extensions','cleared updates must restore the accessible label');
      check(JSON.stringify(rects())===JSON.stringify(before),'clearing badges must preserve the icon layout');
      root.unmount();
      `,
    ),
  60_000,
);
