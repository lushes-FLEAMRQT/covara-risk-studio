/* Covara – Trailer auf der Startseite.
   Läuft ohne Login mit einem festen Beispielportfolio (simulierte Kurse, grob geschätzte Volatilität und Beta). */
(() => {
const {$,$$,esc,RM,rng,gen,qu,covM,risk,SC,shock,eur,pc,histSvg,rowsHtml}=CV;

/* Ticker, Name, Sektor, Volatilität p.a., Beta */
const S10=[['NVDA','Nvidia','Technologie',.5,1.8],['TSLA','Tesla','Zykl. Konsum',.6,2],['AAPL','Apple','Technologie',.28,1.2],['MSFT','Microsoft','Technologie',.26,1.1],['JPM','JPMorgan','Finanzen',.25,1.1],
 ['KO','Coca-Cola','Basiskonsum',.15,.55],['PG','Procter & Gamble','Basiskonsum',.16,.4],['JNJ','Johnson & Johnson','Gesundheit',.16,.5],['XOM','ExxonMobil','Energie',.28,.9],['AMZN','Amazon','Zykl. Konsum',.33,1.2]];
const T=504,SQ=Math.sqrt(252);
const R=(()=>{const g=gen(rng(19)),td=nu=>{let c=0;for(let q=0;q<nu;q++){const e=g();c+=e*e}return Math.max(-4,Math.min(4,g()/Math.sqrt(c/nu)*Math.sqrt((nu-2)/nu)))};
 const sm=.17/SQ,M=new Float64Array(T);for(let t=0;t<T;t++){let v=sm,d=.09/252;if(t>=300&&t<332){v=sm*2.4;d=-.0065}else if(t>=332&&t<380){v=sm*1.5;d=.003}M[t]=d+v*td(5)}
 const ss=.09/SQ,SF={};for(const s of new Set(S10.map(u=>u[2]))){SF[s]=new Float64Array(T);for(let t=0;t<T;t++)SF[s][t]=ss*td(5)*(t>=300&&t<332?1.7:1)}
 return S10.map(([,,sec,vol,b])=>{const v2=(vol/SQ)**2-b*b*sm*sm-ss*ss,si=Math.sqrt(Math.max(v2,(.1/SQ)**2)),al=(.03+b*.05-b*.09)/252,r=new Float64Array(T);for(let t=0;t<T;t++)r[t]=al+b*M[t]+SF[sec][t]+si*td(5);return r})})();
const C0=covM(R).C,BETA=S10.map(u=>u[4]),SECT=S10.map(u=>u[2]);
const sampW=x=>S10.map((_,k)=>k===0?x:(1-x)/(S10.length-1));
const TS=risk(sampW(.1),C0).sd*250000;
const T1=(()=>{const g=gen(rng(3)),a=new Float64Array(10000);for(let i=0;i<a.length;i++)a[i]=TS*g()-20;return a.sort()})();
const TR={s:0,t0:0,hold:false,idle:0,conf:.99,nv:.1,sc:0};

function s1(){const v=qu(T1,TR.conf);$('#s1v').textContent=eur(v);$('#s1c').textContent=pc(TR.conf);histSvg($('#s1g'),T1,v,null)}
function s2(){const w=sampW(TR.nv),r=risk(w,C0),mx=Math.max(...r.share,...w,.01);$('#s2w').textContent=pc(TR.nv,0);$('#s2v').textContent=pc(r.share[0],0);
 $('#s2g').innerHTML=rowsHtml(S10.map((u,k)=>({n:esc(u[1]),v:Math.max(0,r.share[k]),w:w[k],c:k===0?'neg':'',t:`<b>${pc(r.share[k],0)}</b>`})),mx)}
function s3(){const sc=SC[TR.sc],r=shock(BETA,SECT,sampW(.1),sc.m,sc.s);$('#s3v').textContent=eur(r.p*250000);
 $$('#s3s button').forEach((b,i)=>b.setAttribute('aria-pressed',i===TR.sc));
 const mx=Math.max(-r.p,-sc.m,.01),hi=r.per.indexOf(Math.max(...r.per)),lo=r.per.indexOf(Math.min(...r.per));
 $('#s3g').innerHTML=rowsHtml([{n:'Beispielportfolio',v:-r.p,c:'neg',t:`<b>${pc(r.p,0)}</b>`},{n:'Markt (S&amp;P 500)',v:-sc.m,t:`<b>${pc(sc.m,0)}</b>`}],mx)+`<p class="small" style="margin-top:6px">Stärkste Aktie: ${esc(S10[hi][1])} (${pc(r.per[hi],0)}), schwächste: ${esc(S10[lo][1])} (${pc(r.per[lo],0)})</p>`}
$('#s3s').innerHTML=SC.map((s,i)=>`<button data-i="${i}" aria-pressed="false">${s.k}</button>`).join('');
function showScene(i){TR.s=i;TR.t0=performance.now();$$('.chap>[role=tab]').forEach(b=>{b.setAttribute('aria-selected',+b.dataset.s===i);b.querySelector('.bar i').style.width='0'});
 $$('[data-scene]').forEach(s=>s.hidden=+s.dataset.scene!==i);[s1,s2,s3][i]()}
function tick(t){if(TR.idle&&t>TR.idle){TR.idle=0;TR.t0=t}if(!TR.hold&&!TR.idle){const p=(t-TR.t0)/7000,b=$(`.chap [data-s="${TR.s}"] .bar i`);if(b)b.style.width=Math.min(100,p*100)+'%';if(p>=1)showScene((TR.s+1)%3)}requestAnimationFrame(tick)}
/* Läuft immer automatisch durch; nach einer Eingabe 10 Sekunden Pause, beim Drüberfahren hält er an */
function pause(){TR.idle=performance.now()+10000}

$$('.chap>[role=tab]').forEach(b=>b.addEventListener('click',()=>{showScene(+b.dataset.s);pause()}));
{const st=$('#trailer');st.addEventListener('pointerenter',e=>{if(e.pointerType==='mouse')TR.hold=true});st.addEventListener('pointerleave',()=>{TR.hold=false;TR.t0=performance.now()-((parseFloat($(`.chap [data-s="${TR.s}"] .bar i`).style.width)||0)/100*7000)})}
$('#s1r').addEventListener('input',e=>{TR.conf=+e.target.value;s1();pause()});
$('#s2r').addEventListener('input',e=>{TR.nv=+e.target.value;s2();pause()});
$('#s3s').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;TR.sc=+b.dataset.i;s3();pause()});
new ResizeObserver(()=>{if(TR.s===0)s1()}).observe($('#s1g'));

CV.initMode();
showScene(0);
requestAnimationFrame(tick);
})();
