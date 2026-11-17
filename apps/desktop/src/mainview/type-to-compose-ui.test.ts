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
  "typing outside an editor starts a chat message; clicks keep the editor focused for IME",
  () =>
    runUiFixture(
      "type-to-compose",
      `
      const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
      const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
      const {useState}=await import(${fixtureImport(import.meta.resolve("react"))});
      const {ComposerEditor}=await import(${local("./ComposerEditor.tsx")});
      const {initTypeToCompose}=await import(${local("./type-to-compose.ts")});
      const {useStore}=await import(${local("./store.ts")});
      await import(${local("./styles.css")});
      ${fixtureHelpers}
      const root=createFixtureRoot(createRoot);
      function Editor(){const [value,setValue]=useState('');
        return <ComposerEditor viewKey="type" value={value} onChange={e=>setValue(e.target.value)} onRestore={e=>setValue(e.text)}/>;}
      flushSync(()=>useStore.setState({page:'chat',activePane:1}));
      flushSync(()=>root.render(<section data-pane-id="1">
        <p id="text">transcript text</p><button id="plain" type="button">plain</button>
        <input id="other"/><div className="composer"><Editor/></div></section>));
      await wait();
      const dispose=initTypeToCompose();
      const field=()=>document.querySelector('.composer textarea');
      const key=async(text,modifiers=0)=>{
        window.__fixtureInput={method:'Input.dispatchKeyEvent',params:{type:'keyDown',key:text,text:modifiers?'':text,
          code:'Key'+text.toUpperCase(),windowsVirtualKeyCode:text.toUpperCase().charCodeAt(0),modifiers}};
        await until(()=>!window.__fixtureInput,'trusted key processed');await wait();
      };
      document.getElementById('plain').focus();
      await key('a');
      check(document.activeElement===field()&&field().value==='a','first key from a button is typed into the editor: '+field().value);
      document.getElementById('other').focus();
      await key('b');
      check(document.activeElement.id==='other'&&field().value==='a','other inputs keep their keys');
      document.getElementById('plain').focus();
      await key('c',2);
      check(document.activeElement.id==='plain'&&field().value==='a','modified keys are shortcuts, not text');
      document.getElementById('text').dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));
      document.getElementById('plain').focus();
      await wait();await wait();
      check(document.activeElement===field(),'a click returns focus to the editor so the IME stays active');
      const range=document.createRange();range.selectNodeContents(document.getElementById('text'));
      document.getElementById('plain').focus();
      getSelection().removeAllRanges();getSelection().addRange(range);
      document.getElementById('text').dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));
      await wait();await wait();
      check(document.activeElement.id==='plain','selecting transcript text keeps the selection');
      getSelection().removeAllRanges();
      const dialog=document.body.appendChild(document.createElement('dialog'));dialog.show();
      document.getElementById('plain').focus();
      await key('d');
      check(field().value==='a','open dialogs keep the keyboard');
      dialog.remove();dispose();root.unmount();
      `,
    ),
  60_000,
);
