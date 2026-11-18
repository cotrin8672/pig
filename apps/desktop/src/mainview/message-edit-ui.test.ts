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
  "editing a sent message uses the Composer newline and send shortcuts",
  () =>
    runUiFixture(
      "message-edit",
      `
      const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
      const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
      const {UserMessage}=await import(${local("./MessageContent.tsx")});
      const {useStore}=await import(${local("./store.ts")});
      ${fixtureHelpers}
      const root=createFixtureRoot(createRoot);
      const message={role:"user",content:"before",timestamp:0};
      const sends=[];
      window.__requests={regenerate:(session,user,entry)=>sends.push({session,user,entry})};
      flushSync(()=>root.render(<UserMessage message={message} sessionId="chat" entryId="entry" disabled={false}/>));
      const edit=async()=>{
        document.querySelector(".user-actions button:last-child").click();await wait();
        return document.querySelector(".user-edit textarea");
      };
      let field=await edit();
      const press=async(key,modifiers={})=>{
        const event=new KeyboardEvent("keydown",{key,bubbles:true,cancelable:true,...modifiers});
        field.dispatchEvent(event);await wait();return event;
      };
      field.setSelectionRange(2,2);
      await press("Enter");
      check(field.value==="be\\nfore" && field.selectionStart===3 && sends.length===0,"Enter only inserts a newline at the caret");
      await press("Enter",{ctrlKey:true,isComposing:true});
      await press("Enter",{shiftKey:true,keyCode:229});
      await press("Enter",{shiftKey:true,repeat:true});
      check(sends.length===0,"IME and key repeat must not resend");
      await press("Enter",{shiftKey:true});
      check(sends.length===1 && sends[0].session==="chat" && sends[0].entry==="entry" && sends[0].user.content==="be\\nfore","Shift+Enter resends the edited text");
      field=await edit();
      await press("Enter",{ctrlKey:true});
      check(sends.length===2,"Ctrl+Enter also resends");
      flushSync(()=>useStore.setState(state=>({settings:{...state.settings,keybindings:{
        "composer.queue":null,"composer.steer":"Ctrl+S","composer.newline":"Ctrl+J",
      }}})));
      field=await edit();
      check(!(await press("Enter",{shiftKey:true})).defaultPrevented,"disabled queue binding is not intercepted");
      check(!(await press("Enter",{ctrlKey:true})).defaultPrevented,"old send binding is not intercepted");
      field.setSelectionRange(6,6);
      await press("j",{ctrlKey:true});
      check(field.value==="before\\n" && sends.length===2,"custom newline inserts text without resending");
      await press("s",{ctrlKey:true});
      check(sends.length===3 && sends[2].user.content==="before\\n","custom send resends");
      root.unmount();
      `,
    ),
  60_000,
);
