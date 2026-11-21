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
  "edit menu in Edge: fields, links and the page's own copy/paste handlers",
  () =>
    runUiFixture(
      "edit-menu",
      `
      const {initEditMenu,runEditMenuCommand}=await import(${local("./edit-menu.ts")});
      await import(${local("./styles.css")});
      ${fixtureHelpers}
      const shown=[];
      initEditMenu((request)=>shown.push(request));
      document.body.innerHTML='<p id="plain">plain text</p><a id="link" href="https://example.com/docs">docs</a><textarea id="field"></textarea>';
      const field=document.getElementById('field');
      // Like the composer: copy unfolds a marker, a long paste is handled by the page.
      field.addEventListener('copy',(event)=>{event.clipboardData.setData('text/plain','unfolded');event.preventDefault();});
      field.addEventListener('paste',(event)=>{const text=event.clipboardData.getData('text/plain');if(text==='long'){event.preventDefault();document.execCommand('insertText',false,'[folded]');}});
      const menu=(node)=>{const event=new MouseEvent('contextmenu',{bubbles:true,cancelable:true});node.dispatchEvent(event);return event;};

      check(menu(document.getElementById('plain')).defaultPrevented&&shown.length===0,'plain text without selection: no WebView menu and no native menu');
      menu(document.getElementById('link'));
      check(shown.at(-1).url==='https://example.com/docs'&&shown.at(-1).items[0]==='openLink','links offer opening in the browser');

      field.value='hello world';field.focus();field.setSelectionRange(0,5);
      menu(field);
      const request=shown.at(-1);
      check(request.items.includes('paste')&&!request.disabled,'a field with a selection enables cut/copy/paste');
      check(request.text==='unfolded','copy text goes through the page copy handler: '+request.text);

      runEditMenuCommand({action:'cut'});
      check(field.value===' world','cut deletes the selection: '+JSON.stringify(field.value));
      document.execCommand('undo');
      check(field.value==='hello world','cut stays on the native undo stack');

      field.setSelectionRange(field.value.length,field.value.length);
      runEditMenuCommand({action:'paste',text:'!'});
      check(field.value==='hello world!','paste inserts plain text at the caret: '+JSON.stringify(field.value));
      runEditMenuCommand({action:'paste',text:'long'});
      check(field.value==='hello world![folded]','the page paste handler still decides: '+JSON.stringify(field.value));

      runEditMenuCommand({action:'selectAll'});
      check(field.selectionStart===0&&field.selectionEnd===field.value.length,'select all selects the field');
      `,
    ),
  60_000,
);
