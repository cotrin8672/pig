import { test } from "bun:test";
import {
  fixtureHelpers,
  fixtureImport,
  runUiFixture,
} from "../../scripts/ui-fixture";

const local = (path: string) => fixtureImport(new URL(path, import.meta.url));

test(
  "sign-in keeps prompt focus and sends replies through its non-modal frame",
  () =>
    runUiFixture(
      "oauth-dialog",
      `
    const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
    const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
    const {OAuthLoginDialog}=await import(${local("./OAuthLoginDialog.tsx")});
    const {useStore}=await import(${local("./store.ts")});
    await import(${local("./styles.css")});
    ${fixtureHelpers}
    const sent=[];
    window.__messages={
      resolveLogin:reply=>sent.push(['answer',reply]),
      cancelLogin:reply=>sent.push(['cancel',reply]),
    };
    const root=createFixtureRoot(createRoot);
    function Login() {
      const login=useStore(s=>s.login);
      return login && <OAuthLoginDialog key={login.loginId} login={login}/>;
    }
    const base={loginId:'preview',method:'oauth',provider:'openai-codex'};
    const setLogin=state=>flushSync(()=>useStore.setState({login:{...base,...state}}));
    flushSync(()=>root.render(<Login/>));
    setLogin({prompt:{type:'select',message:'Sign-in method',options:[{id:'profile',label:'Example profile'}]}});
    await until(()=>document.querySelector('dialog.dialog-frame[open]'),'sign-in opens');
    const dialog=document.querySelector('dialog');
    const option=dialog.querySelector('.oauth-option');
    check(!dialog.matches(':modal')&&dialog.getAttribute('aria-modal')==='false','sign-in remains non-modal');
    check(document.activeElement===option,'sign-in focuses the first choice');
    option.click();
    await until(()=>!dialog.querySelector('.oauth-option'),'resolved prompt disappears');
    check(sent.length===1&&sent[0][0]==='answer'&&sent[0][1].value==='profile'&&sent[0][1].loginId===base.loginId,'one answer carries the selected value and login ID');
    setLogin({prompt:{type:'manual_code',message:'Verification code'}});
    await until(()=>dialog.querySelector('input')===document.activeElement,'sign-in focuses the next prompt in the same dialog');
    const input=document.activeElement;
    const escape=isComposing=>input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',isComposing,bubbles:true,cancelable:true}));
    escape(true);await wait();
    check(dialog.open&&sent.length===1,'IME Escape does not cancel authentication');
    escape(false);
    await until(()=>!document.querySelector('dialog[open]'),'Escape dismisses sign-in');
    check(sent.length===2&&sent[1][0]==='cancel'&&sent[1][1].loginId===base.loginId,'only the current login is cancelled');
    setLogin({error:'Could not sign in'});
    await until(()=>document.querySelector('dialog[open] .error-alert[role=alert]'),'sign-in announces its failure');
    check(!document.querySelector('dialog[open] [role=status]'),'error replaces the waiting status');
    `,
      { realRpc: true, viewport: { width: 390, height: 844 } },
    ),
  60_000,
);
