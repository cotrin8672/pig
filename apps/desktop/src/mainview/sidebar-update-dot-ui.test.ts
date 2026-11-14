import { test } from "bun:test";
import { existsSync } from "node:fs";
import {
  fixtureEdge,
  fixtureHelpers,
  fixtureImport,
  runUiFixture,
} from "../../scripts/ui-fixture";

test.skipIf(!existsSync(fixtureEdge) && !process.env.PIG_REQUIRE_UI_TESTS)(
  "settings update dot matches the provider dot and uses the highlight",
  () =>
    runUiFixture(
      "sidebar-update-dot",
      `
      const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
      const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
      await import(${fixtureImport(new URL("./styles.css", import.meta.url))});
      await import(${fixtureImport(new URL("./notifications.css", import.meta.url))});
      ${fixtureHelpers}
      const root=createFixtureRoot(createRoot);
      flushSync(()=>root.render(<aside className="sidebar" style={{width:260}}><div className="sidebar-footer">
        <button type="button" className="sidebar-icon" id="plain">A</button>
        <button type="button" className="sidebar-icon" id="update">A<span className="sidebar-update-dot"/></button>
        <button type="button" className="sidebar-icon" id="provider">B<span className="sidebar-provider-dot connected"/></button>
      </div></aside>));
      await wait();
      const rect=(selector)=>document.querySelector(selector).getBoundingClientRect();
      const plain=rect('#plain'),update=rect('#update'),provider=rect('#provider');
      check(plain.width===update.width&&plain.height===update.height,'the dot must not resize the settings icon');
      const dot=rect('.sidebar-update-dot'),peer=rect('.sidebar-provider-dot');
      check(dot.width===peer.width&&dot.height===peer.height,'update dot must match the provider dot size');
      check(dot.right-update.left===peer.right-provider.left&&dot.bottom-update.top===peer.bottom-provider.top,'update dot must sit where the provider dot sits');
      const probe=document.createElement('span');probe.style.color='var(--ds-highlight)';document.body.append(probe);
      check(getComputedStyle(document.querySelector('.sidebar-update-dot')).backgroundColor===getComputedStyle(probe).color,'update dot must use the highlight colour');
      `,
    ),
  60_000,
);
