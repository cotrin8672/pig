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
  "dragging files anywhere on the chat pane shows a full-pane overlay and attaches every dropped file",
  () =>
    runUiFixture(
      "file-drop",
      `
      const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
      const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
      const {ChatLayout}=await import(${local("./ChatLayout.tsx")});
      const {ChatOpening}=await import(${local("./ChatOpening.tsx")});
      const {ComposerFrame}=await import(${local("./ComposerFrame.tsx")});
      const {useStore}=await import(${local("./store.ts")});
      await import(${local("./styles.css")});
      await import(${local("./session-panel.css")});
      await import(${local("./composer.css")});
      ${fixtureHelpers}
      const root=createFixtureRoot(createRoot);
      const dropped=[];
      flushSync(()=>root.render(
        <div style={{position:'fixed',inset:0,display:'flex'}}>
          <ChatLayout composer={<ComposerFrame onFiles={(files)=>dropped.push(...files.map(f=>f.name))}><div className="composer">composer</div></ComposerFrame>}>
            <div style={{height:400}}>chat</div>
          </ChatLayout>
        </div>));
      await wait();
      const shell=document.querySelector('.chat-shell');
      const before=document.querySelector('.composer').getBoundingClientRect().top;
      const data=new DataTransfer();
      data.items.add(new File(['x'],'sheet.xlsx'));
      data.items.add(new File(['y'],'note.txt',{type:'text/plain'}));
      const target=document.querySelector('.transcript');
      target.dispatchEvent(new DragEvent('dragenter',{bubbles:true,cancelable:true,dataTransfer:data}));
      const over=new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:data});
      target.dispatchEvent(over);
      check(over.defaultPrevented,'the transcript must accept file drops');
      await until(()=>document.querySelector('.file-drop-overlay'),'overlay appears while dragging over the transcript');
      const overlay=document.querySelector('.file-drop-overlay').getBoundingClientRect();
      const pane=shell.getBoundingClientRect();
      check(overlay.width>pane.width-32&&overlay.height>pane.height-32,'overlay must cover the pane');
      check(document.querySelector('.composer').getBoundingClientRect().top===before,'overlay must not move the composer');
      target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}));
      await until(()=>!document.querySelector('.file-drop-overlay'),'overlay disappears after the drop');
      check(dropped.join()==='sheet.xlsx,note.txt','every dropped file, not only images, must be attached: '+dropped.join());

      const openId='file-drop-opening',opening={cwd:'fixture',draftId:openId};
      window.__requests={storeAttachment:({name})=>'fixture/'+name};
      flushSync(()=>useStore.setState({openId,openingTarget:opening,pendingOpens:{[openId]:opening}}));
      flushSync(()=>root.render(<ChatOpening/>));
      const textFile=new DataTransfer();
      textFile.items.add(new File(['y'],'note.txt',{type:'text/plain'}));
      document.querySelector('.transcript').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:textFile}));
      await until(()=>document.querySelector('.composer-attachment.file'),'the opening composer shows the dropped file');
      const send=document.querySelector('.send-button');
      check(!send.disabled&&document.querySelector('textarea').value==='','a file alone enables send');
      send.click();
      const pending=useStore.getState().pendingOpens[openId].queued?.[0];
      check(pending?.kind==='send'&&pending.content.text===''&&pending.content.files?.[0]?.path==='fixture/note.txt','a file alone is queued for the chat that is opening');
      await wait();
      check(!document.querySelector('.composer-attachment'),'the queued attachment leaves the draft');
      `,
    ),
  60_000,
);
