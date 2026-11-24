import { test } from "bun:test";
import {
  fixtureHelpers,
  fixtureImport,
  runUiFixture,
} from "../../scripts/ui-fixture";

const local = (path: string) => fixtureImport(new URL(path, import.meta.url));

test(
  "primitives render with design tokens alone, without any screen stylesheet",
  () =>
    runUiFixture(
      "primitives-isolated",
      `
    const {createRoot}=await import(${fixtureImport(import.meta.resolve("react-dom/client"))});
    const {flushSync}=await import(${fixtureImport(import.meta.resolve("react-dom"))});
    await import(${local("../../scripts/fixtures/primitive-theme.css")});
    const {Chip}=await import(${local("./primitives/Chip.tsx")});
    const {CountBadge}=await import(${local("./primitives/CountBadge.tsx")});
    const {IndicatorDot}=await import(${local("./primitives/IndicatorDot.tsx")});
    const {Keycap}=await import(${local("./primitives/Keycap.tsx")});
    const {Button}=await import(${local("./primitives/Button.tsx")});
    const {IconButton}=await import(${local("./primitives/IconButton.tsx")});
    const {Spinner}=await import(${local("./primitives/Spinner.tsx")});
    const {Switch}=await import(${local("./primitives/Switch.tsx")});
    const {Checkbox}=await import(${local("./primitives/Checkbox.tsx")});
    const {Select}=await import(${local("./primitives/Select.tsx")});
    const {TextField}=await import(${local("./primitives/TextField.tsx")});
    const {FileIcon}=await import(${local("./primitives/FileIcon.tsx")});
    const {ProviderIcon}=await import(${local("./primitives/ProviderIcon.tsx")});
    const {SegmentedControl}=await import(${local("./primitives/SegmentedControl.tsx")});
    const {SearchField}=await import(${local("./primitives/SearchField.tsx")});
    const {SettingsCard}=await import(${local("./patterns/SettingsCard.tsx")});
    const {SettingsRow}=await import(${local("./patterns/SettingsRow.tsx")});
    const picks=[];
    ${fixtureHelpers}
    const root=createFixtureRoot(createRoot);
    flushSync(()=>root.render(<>
      <div id="badges">{[0,1,99,100].map(n=><CountBadge key={n} count={n}/>)}</div>
      <div id="chips">{['metadata','tag','accent-tag'].map(v=><Chip key={v} variant={v}>Tag</Chip>)}</div>
      <div id="dots">{['running','waiting','completed','failed','unread'].map(s=><IndicatorDot key={s} state={s}/>)}</div>
      <Keycap>Enter</Keycap>
      <Button variant="primary">保存</Button><Button disabled>取消</Button>
      <IconButton aria-label="閉じる">×</IconButton><Spinner size={17}/>
      <label id="toggle"><Switch/>画像</label><Checkbox id="partial" mixed aria-label="会話"/>
      <TextField aria-label="検索" defaultValue="テスト"/>
      <SegmentedControl aria-label="表示" value="a" onChange={v=>picks.push(v)} options={[{value:'a',label:'A'},{value:'b',label:'B'},{value:'c',label:'C',disabled:true}]}/>
      <SearchField id="search" aria-label="絞り込み" value="x" onChange={()=>{}} onClear={()=>picks.push('clear')} clearLabel="消去"/>
      <SearchField id="empty-search" aria-label="空" value="" onChange={()=>{}} onClear={()=>{}} clearLabel="消去"/>
      <SettingsCard id="card"><SettingsRow label="一" setting="one"><span>A</span></SettingsRow><SettingsRow label="二"><span>B</span></SettingsRow></SettingsCard><Select aria-label="言語" defaultValue="ja"><option>en</option><option>ja</option></Select>
      <div id="providers">{['google-vertex','google-vertex-regional','google','unknown'].map(id=><ProviderIcon key={id} provider={id} size={16}/>)}</div>
      <div id="files">{['main.TSX','notes.md','LICENSE'].map(name=><FileIcon key={name} name={name} size={28}/>)}</div>
    </>));
    await wait();
    const faces=id=>Array.from(document.getElementById(id).children);
    const filled=s=>s.backgroundColor!=='rgba(0, 0, 0, 0)';
    const badges=faces('badges');
    check(badges.map(b=>b.textContent).join(',')==='1,99,99+','zero hidden and counts capped');
    for(const b of badges){
      const s=getComputedStyle(b);
      check(filled(s)&&s.color!==s.backgroundColor&&parseFloat(s.borderRadius)>=b.offsetHeight/2,'badge has contrasting text on a pill');
      check(b.offsetWidth>=14&&b.offsetHeight===13,'badge retains its face around the number');
    }
    const chips=faces('chips').map(el=>getComputedStyle(el));
    check(chips.every(s=>filled(s)&&parseFloat(s.borderRadius)>0&&parseFloat(s.paddingLeft)>0),'all chip variants have a padded surface');
    check(chips[1].color!==chips[2].color,'accent tag is distinct');
    const dots=faces('dots').map(el=>getComputedStyle(el));
    check(dots.every(s=>s.width==='6px'&&s.height==='6px'&&filled(s)),'every dot has a visible face');
    check(new Set(dots.map(s=>s.backgroundColor)).size===dots.length,'distinct state colors including unread');
    const key=getComputedStyle(document.querySelector('kbd'));
    const track=document.querySelector('.model-switch'),off=getComputedStyle(track).backgroundColor;
    document.querySelector('#toggle').click();await wait();
    check(track.offsetWidth===26&&document.querySelector('#toggle input').checked&&off!==getComputedStyle(track).backgroundColor,'label toggles a visible switch');
    check(document.querySelector('#partial').indeterminate && document.querySelector('#partial').offsetWidth<30,'partial checkbox stays compact');
    check(filled(getComputedStyle(document.querySelector('select')))&&document.querySelector('select').value==='ja','select surface and value');
    check(parseFloat(getComputedStyle(document.querySelector('input[aria-label="検索"]')).borderTopWidth)===1,'text field has its own border');
    check(filled(key)&&parseFloat(key.borderBottomWidth)>=2,'keycap has a face and lower edge');
    const [primary,secondary,icon]=document.querySelectorAll('button');
    check(primary.type==='button' && filled(getComputedStyle(primary)) && getComputedStyle(primary).backgroundColor!==getComputedStyle(secondary).backgroundColor && secondary.disabled,'button emphasis and disabled state');
    check(icon.offsetWidth===32 && icon.offsetHeight===32,'square icon target');
    const segments=[...document.querySelectorAll('.segmented-control button')];
    check(segments[0].getAttribute('aria-pressed')==='true' && filled(getComputedStyle(segments[0])) && !filled(getComputedStyle(segments[1])),'selected segment is raised');
    segments[0].click();segments[1].click();segments[2].click();
    check(picks.join(',')==='b' && segments[2].disabled,'only a new, enabled segment reports a change');
    const field=document.querySelector('#search').closest('.ui-search-field');
    check(filled(getComputedStyle(field)) && !filled(getComputedStyle(field.querySelector('input'))) && field.querySelector('svg').getAttribute('aria-hidden')==='true','search field draws one surface around a borderless input');
    field.querySelector('button[aria-label="消去"]').click();
    check(picks.at(-1)==='clear' && !document.querySelector('#empty-search').closest('.ui-search-field').querySelector('button'),'clear button only while there is text');
    const sel=document.querySelector('.ui-select');
    check(sel.querySelector('svg') && getComputedStyle(sel.querySelector('select')).appearance!=='auto','select draws its own chevron');
    const card=document.querySelector('#card'),rows=card.querySelectorAll('.settings-row');
    check(filled(getComputedStyle(card)) && getComputedStyle(card).opacity==='1' && rows[0].dataset.setting==='one' && parseFloat(getComputedStyle(rows[1]).borderTopWidth)===1,'settings card is a translucent surface with separated rows');
    const spinner=document.querySelector('svg.spinner');
    check(getComputedStyle(spinner).width==='17px' && spinner.getAttribute('aria-hidden')==='true','inline spinner layout size and semantics independent of its rotation');
    const [vertex,regional,google,fallback]=faces('providers');
    check(vertex.innerHTML===regional.innerHTML && vertex.innerHTML!==google.innerHTML,'prefer the longest matching provider prefix');
    check(fallback.matches('svg.provider-fallback-icon') && getComputedStyle(fallback).flexShrink==='0','unknown provider has a standalone fallback');
    const files=faces('files');
    check(files.every(el=>el.matches('svg[aria-hidden="true"]')&&el.getBoundingClientRect().width===28) && new Set(files.map(el=>el.innerHTML)).size===3,'code, text and unknown attachments remain distinct');
    `,
    ),
  60_000,
);
