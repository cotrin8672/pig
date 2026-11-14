/** Runs inside the native titlebar fixture with the real Chat/MainViewport.
 * Keep all positions, frame samples and hover-retention waits unchanged. */
export const titlebarChatFixture = `
      metrics.stage="titlebar-clipping";
      metrics.titlebarClipping=[];
      for(const collapsed of [false,true]){
        await render(<div className={"app-shell"+(collapsed?" sidebar-collapsed":"")}><aside className="sidebar"/><MainViewport><Chat snapshot={{...base,transcript:transcript(Array.from({length:40},(_,i)=>user(i)))}}/></MainViewport><WindowTitlebar maximized={false} onAction={()=>{}}/></div>);
        const bar=document.querySelector('.window-titlebar'),clip=document.querySelector('.main-clip'),thread=document.querySelector('.thread-scroll');
        await pause(220);
        const measure=()=>{
          const nodes=[document.querySelector('.session-layout'),document.querySelector('.composer'),document.querySelector('[data-record-id="r20"]'),thread];
          return [...nodes.flatMap(node=>{check(node,"missing titlebar measurement target");const r=node.getBoundingClientRect();return [r.x,r.y,r.width,r.height];}),thread.scrollTop,thread.scrollHeight,thread.clientHeight];
        };
        for(const position of ['top','middle','bottom']){
          thread.scrollTop=position==='top'?0:position==='bottom'?thread.scrollHeight:1000;await wait();
          const before=measure();
          for(const expanded of [true,false]){
            if(expanded){const r=bar.getBoundingClientRect();window.dispatchEvent(new MouseEvent('mousemove',{clientX:r.left+100,clientY:2}));}
            else window.dispatchEvent(new Event('blur'));
            for(let frame=0;frame<10;frame++){
              await pause(35);
              const actual=measure();
              check(actual.every((value,i)=>Math.abs(value-before[i])<0.01),'titlebar must not resize or move chat/composer/records or change scroll position during animation: '+JSON.stringify({collapsed,position,expanded,frame,viewport:[innerWidth,innerHeight],before,actual}));
            }
            check(bar.dataset.expanded===String(expanded),'titlebar hover must change visibility');
            const bounds=clip.getBoundingClientRect();
            check(Math.abs(bounds.top-(expanded?34:8))<0.01,'only the clipping boundary should move');
            if(expanded){
              check(!!document.elementFromPoint(bounds.left+100,20)?.closest('.window-titlebar'),'revealed band must receive pointer input');
              check(!document.elementFromPoint(bounds.left+100,33)?.closest('.main-viewport'),'clipped content must not receive pointer input');
            }
          }
          metrics.titlebarClipping.push({collapsed,position,drift:0});
        }
        const barBounds=bar.getBoundingClientRect();
        const move=(x,y)=>window.dispatchEvent(new MouseEvent('mousemove',{clientX:x,clientY:y}));
        move(barBounds.left+100,46);await pause(350);
        check(bar.dataset.expanded==='false','retention margin must not open a closed band');
        move(barBounds.left+100,2);await pause(350);
        for(const [x,y] of [[barBounds.left+100,58],[barBounds.left-24,24],[barBounds.right+4,24]]){
          move(x,y);await pause(350);
          check(bar.dataset.expanded==='true','open band must stay visible in its retention margin');
        }
        check(!document.elementFromPoint(barBounds.left+100,46)?.closest('.window-titlebar'),'retention margin must not intercept page input');
        move(barBounds.left+100,72);await pause(150);
        check(bar.dataset.expanded==='true','leaving must allow 200ms to return');
        move(barBounds.left+100,46);await pause(350);
        check(bar.dataset.expanded==='true','returning to the margin must cancel collapse');
        move(barBounds.left+100,72);await pause(700);
        check(bar.dataset.expanded==='false' && Math.abs(clip.getBoundingClientRect().top-8)<0.01,'leaving beyond the margin must collapse the band');
        bar.focus();await pause(350);
        check(Math.abs(clip.getBoundingClientRect().top-34)<0.01,'keyboard focus must reveal the band');
        bar.blur();await pause(350);
      }
`;
