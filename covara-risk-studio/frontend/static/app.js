/* Covara – Studio. Kurse kommen vom Backend (Yahoo Finance über yfinance), gerechnet wird im Browser. */
(() => {
const {$,$$,esc,rng,gen,Phi,phi,Pinv,chol,mean,sd,qu,es,covM,risk,SC,shock,eur,ek,pc,nf,nice,histSvg,rowsHtml}=CV;
const SQ=Math.sqrt(252);
const PAGES={depot:'Depot laden',portfolio:'Portfolio',risiko:'Risiko',vola:'Risiko-Wetter',stress:'Stresstests',einstellungen:'Einstellungen'};
/* alte Links landen auf den zusammengelegten Seiten; #beitraege und #faktoren springen dort zum Abschnitt */
const ALIAS={uebersicht:'portfolio',kennzahlen:'portfolio',beitraege:'risiko',faktoren:'risiko'};
const ALIAS_AT={beitraege:'r-aktien',faktoren:'r-faktoren'};
const SECT=['Technologie','Kommunikation','Zykl. Konsum','Finanzen','Gesundheit','Basiskonsum','Energie','Industrie','Versorger','Grundstoffe','Immobilien'];

/* ---------- Zustand ---------- */
let S={pf:null,src:'demo',conf:.99,h:1,wi:null,wauto:true,wx:null,sc:0,cm:-.2,cs:'Technologie',cx:-.1};
try{const v=JSON.parse(localStorage.getItem('covara-v4')||'null');if(v&&(!v.pf||v.pf.every(p=>typeof p.tk==='string'&&p.sh>0)))S={...S,...v}}catch(e){}
if(S.wauto===undefined){S.wauto=true;S.wx=null}
const save=()=>{try{localStorage.setItem('covara-v4',JSON.stringify(S))}catch(e){}};
let HD=null,D=null,T=0,DATES=[];

/* ---------- Server ---------- */
async function api(path,body){const r=await fetch(path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 if(r.status===401){location.href='/login';throw new Error('Bitte zuerst anmelden.')}
 let d=null;try{d=await r.json()}catch(e){}
 if(!r.ok)throw new Error(d&&typeof d.detail==='string'?d.detail:'Der Server antwortet nicht wie erwartet.');return d}
const have=()=>HD&&S.pf.every(p=>HD.tickers.includes(p.tk));
async function loadHist(){loadEvents(S.pf.map(p=>p.tk));if(!have())HD=await api('/api/history',{tickers:S.pf.map(p=>p.tk)});compute()}
let busy=false;
function setBusy(b){busy=b;$('#demo-pf').disabled=b;$('#demo-pf').textContent=b?'Wird zusammengestellt …':(S.pf?'Neues Demo-Portfolio erstellen':'Demo-Portfolio erstellen');if(b)$('#src').textContent='Kurse werden von Yahoo Finance geladen …';else srcLine()}
/* Demo-Depot: 8–12 zufällige S&P-500-Aktien, zufällige Verteilung, Gesamtwert 65.000–100.000 €, ganze Stück zum letzten Kurs */
async function makeDemo(){if(busy)return;setBusy(true);$('#dp-err').textContent='';
 try{const seed=Date.now()%2147483647,{tickers}=await api('/api/random',{seed}),_ev=loadEvents(tickers),hd=await api('/api/history',{tickers}),r=rng(seed^0x5bd1e995);
  const target=65000+r()*35000,raw=tickers.map(()=>.4+r()*1.6),sum=raw.reduce((a,b)=>a+b);
  const pf=tickers.map((tk,k)=>({tk,sh:Math.max(1,Math.round(target*raw[k]/sum/hd.last[k]))}));
  pf.sort((a,b)=>b.sh*hd.last[hd.tickers.indexOf(b.tk)]-a.sh*hd.last[hd.tickers.indexOf(a.tk)]);
  HD=hd;S.pf=pf;S.src='demo';S.wx=null;S.wi=null;S.wauto=true;compute();save();location.hash='portfolio'}
 catch(e){$('#dp-err').textContent=e.message}finally{setBusy(false)}}
function fail(e){$('#load-h').textContent='Die Kurse konnten nicht geladen werden.';$('#load-p').textContent=e.message;$('#retry').hidden=false}
const dDE=iso=>new Date(iso+'T12:00:00').toLocaleDateString('de-DE');
function srcLine(){$('#src').innerHTML=HD?`Kurse von <b>Yahoo Finance</b> · ${dDE(HD.dates[0])} bis ${dDE(HD.dates[HD.dates.length-1])} · ${HD.dates.length} Handelstage · in Euro`:(S.pf?'Kurse werden geladen …':'Noch kein Depot geladen.')}

/* ---------- Routing ----------
   Seiten über location.hash. Sprünge innerhalb einer Seite laufen über JUMP + scrollIntoView, nie über den Hash. */
const page=()=>{const h=location.hash.slice(1);return h in PAGES?h:(ALIAS[h]||'portfolio')};
const FREE=['depot','einstellungen'];
let JUMP=null;
function showPage(){const h=location.hash.slice(1);if(ALIAS[h]){if(ALIAS_AT[h])JUMP=ALIAS_AT[h];history.replaceState(null,'','#'+ALIAS[h])}
 let p=page();if(!S.pf&&!FREE.includes(p)){history.replaceState(null,'','#depot');p='depot'}
 const ready=FREE.includes(p)||!!D;$('#load').hidden=ready;$$('[data-page]').forEach(s=>s.hidden=!ready||s.dataset.page!==p);
 $$('.nav a').forEach(a=>{if(a.getAttribute('href')==='#'+p)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current')});
 $('#ptitle').textContent=PAGES[p];$('.tool .ctl').hidden=FREE.includes(p)||!D;renderDepotNote();drawAll();spy();
 if(ready&&JUMP){const el=document.getElementById(JUMP);if(el&&!el.closest('[hidden]')){JUMP=null;requestAnimationFrame(()=>el.scrollIntoView({behavior:CV.RM?'auto':'smooth',block:'start'}))}}}
/* zu einer Seite und optional zu einem Abschnitt darauf */
function go(p,id){JUMP=id||null;if(location.hash==='#'+p)showPage();else location.hash=p}
addEventListener('hashchange',()=>{scrollTo({top:0,behavior:'instant'});showPage()});
/* Sprungleiste der Risiko-Seite: aktiven Abschnitt markieren */
const RSEC=['r-verlust','r-aktien','r-faktoren'];
function spy(){if(page()!=='risiko'||!D)return;let cur=RSEC[0];for(const id of RSEC)if(document.getElementById(id).getBoundingClientRect().top<170)cur=id;
 $$('#r-jump button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.j===cur))}
addEventListener('scroll',spy,{passive:true});

/* ---------- Bedienung ---------- */
function bind(){
 $('#sc-c').addEventListener('click',e=>{const b=e.target.closest('[data-v]');if(!b)return;S.conf=+b.dataset.v;renderRisk();upd()});
 $('#sc-h').addEventListener('click',e=>{const b=e.target.closest('[data-v]');if(!b)return;S.h=+b.dataset.v;renderRisk();upd()});
 renderRisk();
 $('#demo-pf').addEventListener('click',makeDemo);
 $('#retry').addEventListener('click',()=>{$('#retry').hidden=true;$('#load-h').textContent='Dein Depot wird geladen …';start()});
 $('#wi').addEventListener('change',e=>{S.wi=+e.target.value;S.wauto=false;S.wx=null;renderWhat();save()});
 $('#o-lv').addEventListener('click',e=>{const b=e.target.closest('[data-lv]');if(!b||!D)return;const l=D.levers[+b.dataset.lv];if(l&&l.go)l.go()});
 $('#v-drb').addEventListener('click',()=>{if(!D||!D.w2)return;const dr=D.w2.dr;S.wi=dr.top;S.wx=dr.x;S.wauto=false;save();renderAll();go('risiko','r-aktien')});
 $('#r-jump').addEventListener('click',e=>{const b=e.target.closest('[data-j]');if(b)document.getElementById(b.dataset.j).scrollIntoView({behavior:CV.RM?'auto':'smooth',block:'start'})});
 $('#wx').addEventListener('input',e=>{S.wx=+e.target.value;renderWhat();save()});
 $('#s-c').addEventListener('click',e=>{const b=e.target.closest('[data-i]');if(!b)return;S.sc=+b.dataset.i;renderStress();save()});
 $('#cm').addEventListener('input',e=>{S.cm=+e.target.value;renderCustom();save()});
 $('#cs').addEventListener('change',e=>{S.cs=e.target.value;renderCustom();save()});
 $('#cx').addEventListener('input',e=>{S.cx=+e.target.value;renderCustom();save()});
 $('#cs').innerHTML=SECT.map(s=>`<option>${esc(s)}</option>`).join('');$('#cm').value=S.cm;$('#cs').value=S.cs;$('#cx').value=S.cx;
 $('#out').addEventListener('click',async()=>{try{await fetch('/api/logout',{method:'POST'})}catch(e){}location.href='/'})}
function upd(){compute();save();renderRisk()}
/* Einstellungen: Risikomessung mit Erklärung und Live-Beispiel */
const hName=()=>({1:'1 Tag',10:'10 Tage',21:'1 Monat'}[S.h]);
function renderRisk(){
 for(const [id,v,x] of [['#sc-c',String(S.conf),'#sc-cx'],['#sc-h',String(S.h),'#sc-hx']]){let txt='';
  $$(id+' button').forEach(b=>{const on=b.dataset.v===v;b.setAttribute('aria-pressed',on);if(on)txt=b.dataset.x});$(x).textContent=txt}
 $('#gr').textContent=`${pc(S.conf)} · ${hName()}`;
 $('#sc-now').innerHTML=D?`<span>Beispiel mit deinem Depot</span><b>${eur(D.his.v)}</b><span>Mit ${pc(S.conf)} Sicherheit verlierst du ${hT()} nicht mehr als diesen Betrag. ${D.mean.f} wird es mehr, dann im Schnitt ${eur(D.his.e)}.</span>`:'<span>Noch kein Depot geladen. Mit einem Depot steht hier ein Beispiel mit echten Zahlen.</span>'}

/* ---------- Rechnen ---------- */
function compute(){if(!HD||!S.pf)return;
 const idx=S.pf.map(p=>HD.tickers.indexOf(p.tk)),RR=idx.map(i=>HD.returns[i]),M=HD.market,names=idx.map(i=>HD.names[i]),sect=idx.map(i=>HD.sectors[i]);
 T=M.length;DATES=HD.dates.map(d=>new Date(d+'T12:00:00'));
 const last=idx.map(i=>HD.last[i]),val=S.pf.map((p,k)=>p.sh*last[k]),V=val.reduce((a,b)=>a+b),w=val.map(v=>v/V),n=idx.length,{C}=covM(RR),rk=risk(w,C),h=S.h,sh=Math.sqrt(h),z=Pinv(S.conf);
 const R=new Float64Array(T);for(let t=0;t<T;t++){let s=0;for(let k=0;k<n;k++)s+=w[k]*RR[k][t];R[t]=s}
 const mu=mean(R),sp=sd(R),mM=mean(M);let vm=0;for(let t=0;t<T;t++)vm+=(M[t]-mM)**2;
 const betas=RR.map(r=>{const m=mean(r);let c=0;for(let t=0;t<T;t++)c+=(r[t]-m)*(M[t]-mM);return c/vm});
 const Lh=[];for(let t=0;t+h<=T;t++){let s=0;for(let k=t;k<t+h;k++)s+=R[k];Lh.push(-s*V)}Lh.sort((a,b)=>a-b);
 const par={v:V*(z*sp*sh-mu*h),e:V*(sp*sh*phi(z)/(1-S.conf)-mu*h)},his={v:qu(Lh,S.conf),e:es(Lh,S.conf)};
 const L=chol(C);let mc={v:NaN,e:NaN};if(L){const vv=w.map((_,j)=>{let s=0;for(let i=j;i<n;i++)s+=L[i][j]*w[i];return s}),g=gen(rng(5)),N=20000,ls=new Float64Array(N);
  for(let s=0;s<N;s++){let d=0;for(let j=0;j<n;j++)d+=vv[j]*g();ls[s]=-(mu*h+sh*d)*V}ls.sort();mc={v:qu(ls,S.conf),e:es(ls,S.conf)}}
 const lr=Array.from(R,x=>-x),lm=mean(lr),ls2=sd(lr);let S3=0,S4=0;for(const x of lr){S3+=((x-lm)/ls2)**3;S4+=((x-lm)/ls2)**4}const skew=S3/T,kurt=S4/T-3;
 const zc=z+(z*z-1)*skew/6+(z**3-3*z)*kurt/24-(2*z**3-5*z)*skew*skew/36,cf={v:Math.abs(kurt)<6?V*(zc*sp*sh-mu*h):NaN,e:NaN};
 /* Wertverlauf der heutigen Stückzahlen (Buy-and-hold), rückwärts aus dem letzten Kurs */
 const eq=new Array(T+1).fill(0);idx.forEach((_,k)=>{let px=last[k];eq[T]+=S.pf[k].sh*px;for(let t=T-1;t>=0;t--){px/=1+RR[k][t];eq[t]+=S.pf[k].sh*px}});
 const ix=[eq[0]];let peak=eq[0],mdd=0,mddi=0;const dd=[0];for(let t=0;t<T;t++){ix.push(ix[t]*(1+M[t]));peak=Math.max(peak,eq[t+1]);const d=eq[t+1]/peak-1;dd.push(d);if(d<mdd){mdd=d;mddi=t+1}}
 const retA=Math.pow(eq[T]/eq[0],252/T)-1,volA=sp*SQ,rf=.03,dn=Math.sqrt(mean(Array.from(R,x=>Math.min(0,x-rf/252)**2)))*SQ;
 let cvm=0;for(let t=0;t<T;t++)cvm+=(R[t]-mu)*(M[t]-mM);const beta=cvm/vm,te=sd(Array.from(R,(x,t)=>x-M[t]))*SQ,ixA=Math.pow(ix[T]/ix[0],252/T)-1;
 const sig=C.map((_,k)=>Math.sqrt(C[k][k])),divr=w.reduce((a,x,k)=>a+x*sig[k],0)/sp;
 const corr=C.map((r,a)=>r.map((c,b)=>c/(sig[a]*sig[b])));let ac=0,nc=0;for(let a=0;a<n;a++)for(let b=a+1;b<n;b++){ac+=corr[a][b];nc++}ac/=nc||1;
 const sec={};sect.forEach((s,k)=>sec[s]=(sec[s]||0)+w[k]);
 D={V,last,val,tks:S.pf.map(p=>p.tk),names,sect,betas,RR,w,C,rk,R,mu,sp,z,par,his,mc,cf,skew,kurt,Lh,eq,ix,dd,mdd,mddi,retA,volA,sharpe:(retA-rf)/volA,sortino:(retA-rf)/dn,beta,te,ixA,divr,corr,ac,sec,lossP:Phi(-(mu*252)/(sp*SQ)),sig};
 D.mus=RR.map(mean);D.pv0=pvar(D,w).v;D.etf=etf(M,V,h);D.ratio=volA/D.etf.vol;D.mean=meaning(D);
 D.f=factors(R,RR);fitWeather(D);D.w2=weather(D);D.levers=levers(D);
 if(S.wauto||S.wi==null||S.wi>=n)S.wi=D.clumpK;
 $('#gv').textContent=eur(V);renderAll();showPage()}

/* Parametrischer VaR für beliebige Gewichte (Was-wäre-wenn und Hebel nutzen dieselbe Rechnung) */
function pvar(d,w2){const r=risk(w2,d.C),mu2=w2.reduce((a,v,j)=>a+v*d.mus[j],0);return{v:d.V*(d.z*r.sd*Math.sqrt(S.h)-mu2*S.h),r}}
/* Gewicht einer Aktie auf x setzen, übrige anteilig skalieren */
const rew=(w,k,x)=>{const cur=w[k];return w.map((v,j)=>j===k?x:(cur<1?v*(1-x)/(1-cur):0))};
/* S&P-500-ETF in gleicher Höhe: gleiche Sicherheit, gleicher Zeitraum, überlappende h-Tages-Summen */
function etf(M,V,h){const L=[];for(let t=0;t+h<=M.length;t++){let s=0;for(let k=t;k<t+h;k++)s+=M[k];L.push(-s*V)}L.sort((a,b)=>a-b);
 return{vol:sd(M)*SQ,v:qu(L,S.conf),e:es(L,S.conf)}}
/* Übersetzungen: wie oft wird der VaR überschritten, wie oft endet ein Jahr im Minus */
const ZW=['null','ein','zwei','drei','vier','fünf','sechs','sieben','acht','neun','zehn','elf','zwölf','dreizehn'];
const cap=t=>t[0].toUpperCase()+t.slice(1);
function often(conf,h){const n=(1-conf)*252/h;
 if(n>=1){const a=Math.floor(n+1e-9),b=Math.ceil(n-1e-9);
  if(b<ZW.length)return a===b?(a===1?'etwa einmal im Jahr':`etwa ${ZW[a]}mal im Jahr`):`etwa ${ZW[a]}- bis ${ZW[b]}mal im Jahr`;
  return a===b?`etwa ${a}-mal im Jahr`:`etwa ${a}- bis ${b}-mal im Jahr`}
 const X=Math.round(1/n);return X<=1?'etwa einmal im Jahr':`etwa alle ${X} Jahre`}
function lossYear(p){const X=Math.round(1/p);return p>=.5?'In mehr als jedem zweiten Jahr':X<=2?'Etwa jedes zweite Jahr':X>50?'Seltener als alle 50 Jahre':`Etwa jedes ${X}. Jahr`}
function meaning(d){return{f:cap(often(S.conf,S.h)),ly:lossYear(d.lossP),per:{1:'an solchen schlechten Tagen',10:'in solchen schlechten Zeiträumen',21:'in solchen schlechten Monaten'}[S.h]}}
/* ---------- Hebel: alle Kandidaten mit Wirkung in Euro, die drei größten werden gezeigt ---------- */
const sg=v=>(v<0?'−':'+')+eur(Math.abs(v));
function levers(d){const L=[],n=d.w.length,sh=Math.sqrt(S.h),nm=k=>esc(d.names[k]);
 /* Klumpen: größte Differenz Risikoanteil − Gewicht */
 let k=-1,best=0;d.rk.share.forEach((s,j)=>{const x=s-d.w[j];if(s>1.3*d.w[j]&&s>.12&&x>best){best=x;k=j}});
 d.clumpK=k>=0?k:d.rk.share.indexOf(Math.max(...d.rk.share));
 if(k>=0){const x=Math.round(d.w[k]*2/3*100)/100,dv=pvar(d,rew(d.w,k,x)).v-d.pv0;
  L.push({ic:'klumpen',c:'--bad',tag:'Klumpen',imp:Math.abs(dv),h:`${nm(k)} treibt dein Risiko.`,
   t:`${pc(d.rk.share[k],0)} deines Risikos kommen von einer Aktie mit nur ${pc(d.w[k],0)} Gewicht.`,
   el:`Gewicht ${pc(d.w[k],0)} → ${pc(x,0)}`,ev:`VaR ${sg(dv)}`,b:'Ausprobieren',
   go:()=>{S.wi=k;S.wx=x;S.wauto=false;save();renderAll();go('risiko','r-aktien')}})}
 /* Streuung: 5 weitere gleich gewichtete Aktien senken die firmenspezifische Varianz um n/(n+5) */
 if(d.f&&d.f.idio>.15){const q=n/(n+5),v=d.rk.v,nv=v-d.f.idio*v*(1-q),ni=d.f.idio*q*v/nv,mu=d.w.reduce((a,x,j)=>a+x*d.mus[j],0),dv=d.V*(d.z*Math.sqrt(nv)*sh-mu*S.h)-d.pv0;
  L.push({ic:'streu',c:'--warn',tag:'Streuung',imp:Math.abs(dv),h:'Viel Risiko hängt an einzelnen Firmen.',
   t:`Ein großer Teil der Schwankung kommt nicht vom Markt, sondern von einzelnen Firmen. Mit mehr Aktien gleicht sich das teilweise aus, der VaR sänke um etwa ${eur(-dv)}.`,
   el:'5 Aktien mehr, gleich gewichtet · firmenspezifischer Anteil',ev:`${pc(d.f.idio,0)} → ${pc(ni,0)}`,b:'Ausprobieren',go:()=>go('depot')})}
 /* Stil: Faktor mit |t| ≥ 2 und größtem |Beta|, Wirkung = |Beta| × 10 % × Depotwert */
 const sig=d.f?d.f.st.filter(x=>x.k!=='MKT'&&Math.abs(x.t)>=2).sort((a,b)=>Math.abs(b.b)-Math.abs(a.b)):[];
 if(sig[0]){const f=sig[0],tl=f.b>0?f.p:f.m,e=Math.abs(f.b)*.1*d.V;
  L.push({ic:'stil',c:'--g',tag:'Stil',imp:e,h:`Du setzt auf ${tl.t}.`,t:`Laufen ${tl.g} 10 % schlechter als ${tl.o}, kostet dich das spürbar Geld.`,
   el:`wenn ${tl.g} 10 % zurückfallen`,ev:`≈ −${eur(e)}`,b:'Szenario ansehen',go:()=>go('risiko','r-faktoren')})}
 /* Sektor: größter Sektor über 35 %, Wirkung wenn er auf 25 % sinkt */
 const ts=Object.entries(d.sec).filter(e=>e[0]!=='ETF/Fonds'&&e[0]!=='Sonstige').sort((a,b)=>b[1]-a[1])[0];
 if(ts&&ts[1]>.35&&ts[1]<.99){const [sn,s]=ts,w2=d.w.map((x,j)=>d.sect[j]===sn?x*.25/s:x*.75/(1-s)),dv=pvar(d,w2).v-d.pv0,can=SECT.includes(sn);
  L.push({ic:'sektor',c:'--warn',tag:'Sektor',imp:Math.abs(dv),h:`Dein Depot hängt stark an ${esc(sn)}.`,
   t:'Gerät diese Branche unter Druck, trifft es einen großen Teil deines Geldes auf einmal.',el:`${esc(sn)} ${pc(s,0)} → 25 %`,ev:`VaR ${sg(dv)}`,
   b:can?'Szenario ansehen':null,go:can?()=>{S.cs=sn;S.cx=-.2;$('#cs').value=sn;$('#cx').value=-.2;save();renderCustom();go('stress','s-own')}:null})}
 /* Unruhige Phase: Risiko-Wetter der nächsten Woche, Wirkung = VaR 1 Woche (Prognose) − VaR 1 Woche (normal) */
 const wk=d.w2.hz[1],wdv=d.w2.var5-d.w2.norm5;
 if(wk.lv>=2)L.push({ic:'vola',c:WL[wk.lv].c,tag:'Wetter',imp:Math.abs(wdv),h:'Eine unruhige Phase steht an.',
  t:`Das Risiko-Wetter für die nächste Woche: ${WL[wk.lv].n}. Größere Verluste sind dann wahrscheinlicher als sonst.`,
  el:'VaR für eine Woche gegenüber normal',ev:sg(wdv),b:'Risiko-Wetter ansehen',go:()=>go('vola')});
 /* weniger als drei Kandidaten: mit positiven Punkten auffüllen */
 const top=L.sort((a,b)=>b.imp-a.imp).slice(0,3),has=t=>top.some(x=>x.tag===t),nS=Object.keys(d.sec).length,ok=(h,t)=>({ic:'gut',c:'--t',tag:'Gut',h,t});
 const good=[nS>=4&&!has('Sektor')&&ok(`Gut verteilt über ${nS} Sektoren.`,'Keine Branche bestimmt allein, wie es deinem Depot geht.'),
  !has('Klumpen')&&Math.max(...d.rk.share)<=.25&&ok('Kein Wert dominiert dein Risiko.','Das Risiko verteilt sich auf mehrere Aktien.'),
  d.f&&d.f.idio<=.15&&ok('Wenig firmenspezifisches Risiko.','Dein Depot schwankt vor allem mit dem Markt, einzelne Firmen fallen kaum ins Gewicht.'),
  wk.lv<=1&&ok(`Risiko-Wetter: ${WL[wk.lv].n}.`,'Für die nächste Woche ist keine erhöhte Unruhe zu erwarten.'),
  d.f&&!sig.length&&ok('Keine einseitige Stil-Wette.','Kein Anlagestil wie Value oder Growth prägt dein Depot deutlich.')].filter(Boolean);
 return[...top,...good].slice(0,3)}


/* ---------- Faktor-Analyse ----------
   Long-Short-Faktoren aus ETF-Kursen (Backend liefert IWM, IVE, IVW, MTUM, QUAL, USMV in Euro).
   Regression: Depotrendite = α + Σ β_j · Faktor_j + ε (kleinste Quadrate). */
const FDEF=[{k:'MKT',n:'Markt',sn:'Markt'},
 {k:'SMB',n:'Größe',sn:'Größe',etf:['IWM'],pos:'eher kleinere Firmen',neg:'eher große Konzerne',
  p:{t:'kleinere Firmen',g:'kleine Firmen',o:'große'},m:{t:'große Konzerne',g:'große Konzerne',o:'kleine'}},
 {k:'VAL',n:'Value statt Growth',sn:'Value',etf:['IVE','IVW'],pos:'günstig bewertete Value-Aktien',neg:'Wachstumsaktien (Growth)',
  p:{t:'günstig bewertete Value-Aktien',g:'Value-Aktien',o:'Wachstumsaktien'},m:{t:'Wachstumsaktien',g:'Wachstumsaktien',o:'Value-Aktien'}},
 {k:'MOM',n:'Momentum',sn:'Mom.',etf:['MTUM'],pos:'Gewinner der letzten Monate',neg:'Nachzügler der letzten Monate',
  p:{t:'die Gewinner der letzten Monate',g:'die Gewinner der letzten Monate',o:'die Nachzügler'},m:{t:'die Nachzügler der letzten Monate',g:'die Nachzügler',o:'die Gewinner'}},
 {k:'QUAL',n:'Qualität',sn:'Qual.',etf:['QUAL'],pos:'profitable, solide Firmen',neg:'Firmen mit schwächeren Bilanzen',
  p:{t:'solide, profitable Firmen',g:'solide Firmen',o:'schwächere'},m:{t:'Firmen mit schwächeren Bilanzen',g:'schwächere Firmen',o:'solide'}},
 {k:'LVOL',n:'Geringe Schwankung',sn:'Ruhe',etf:['USMV'],pos:'defensive, ruhige Aktien',neg:'schwankungsfreudige Aktien',
  p:{t:'ruhige, defensive Aktien',g:'ruhige Aktien',o:'schwankungsfreudige'},m:{t:'schwankungsfreudige Aktien',g:'schwankungsfreudige Aktien',o:'ruhige'}}];
function ols(y,X){const p=X.length+1,T=y.length,cols=[new Array(T).fill(1),...X],A=[],c=[];
 for(let i=0;i<p;i++){A[i]=[];let s=0;for(let t=0;t<T;t++)s+=cols[i][t]*y[t];c[i]=s;for(let j=0;j<p;j++){if(j<i){A[i][j]=A[j][i];continue}let q=0;for(let t=0;t<T;t++)q+=cols[i][t]*cols[j][t];A[i][j]=q}}
 const L=chol(A);if(!L)return null;
 const solve=b=>{const z=[];for(let i=0;i<p;i++){let s=b[i];for(let k=0;k<i;k++)s-=L[i][k]*z[k];z[i]=s/L[i][i]}const x=[];for(let i=p-1;i>=0;i--){let s=z[i];for(let k=i+1;k<p;k++)s-=L[k][i]*x[k];x[i]=s/L[i][i]}return x};
 const b=solve(c),my=mean(y),res=new Float64Array(T);let sse=0,sst=0;
 for(let t=0;t<T;t++){let f=0;for(let i=0;i<p;i++)f+=b[i]*cols[i][t];res[t]=y[t]-f;sse+=res[t]**2;sst+=(y[t]-my)**2}
 const s2=sse/(T-p),se=b.map((_,i)=>{const e=new Array(p).fill(0);e[i]=1;return Math.sqrt(s2*solve(e)[i])});
 return{a:b[0],ta:b[0]/se[0],b:b.slice(1),t:b.slice(1).map((x,i)=>x/se[i+1]),r2:1-sse/sst,res}}
function factors(R,RR){const F=HD.factors||{},M=HD.market,fs=[];
 for(const f of FDEF){if(f.k==='MKT'){fs.push({...f,v:M});continue}if(!f.etf.every(e=>F[e]&&F[e].length===M.length))continue;
  const a=F[f.etf[0]],b=f.etf[1]?F[f.etf[1]]:M;fs.push({...f,v:a.map((x,t)=>x-b[t])})}
 const X=fs.map(f=>f.v),reg=ols(Array.from(R),X);if(!reg)return null;
 const {C:CF}=covM(X),mv=reg.b.map((_,i)=>reg.b.reduce((s,bj,j)=>s+CF[i][j]*bj,0)),contrib=reg.b.map((b,i)=>b*mv[i]),idio=sd(reg.res)**2,tot=contrib.reduce((a,b)=>a+b,0)+idio;
 const share=contrib.map(c=>c/tot);
 return{fs,reg,share,idio:idio/tot,per:RR.map(r=>ols(r,X)),st:fs.map((f,i)=>({...f,b:reg.b[i],t:reg.t[i],sh:share[i]}))}}

/* ---------- Risiko-Wetter: Modell ----------
   GJR-GARCH(1,1): ε_t = r_t − μ, σ²(t+1) = ω + (α + γ·1[ε_t<0])·ε_t² + β·σ²(t), ω = v0·(1 − α − γ/2 − β).
   Prognose per gefilterter historischer Simulation (2.000 Pfade, 63 Handelstage) mit Aufschlägen an Termintagen. */
const H_W=63,NP=2000,HZ=[1,5,21,63];
const WL=[{n:'Ruhig',a:'ruhig',c:'--t',ic:'sun'},{n:'Wechselhaft',a:'wechselhaft',c:'--n',ic:'part'},{n:'Unruhig',a:'unruhig',c:'--warn',ic:'rain'},{n:'Sturm',a:'stürmisch',c:'--bad',ic:'storm'}];
const lvOf=r=>r<.85?0:r<1.15?1:r<1.5?2:3;
const EV={key:'',earn:null,macro:null,earnErr:false,macroErr:false,loading:false,ver:0};
const med=a=>{const s=Float64Array.from(a).sort(),n=s.length;return n?(n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2):NaN};
const isoOf=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
/* Handelstage nach vorn: einfach Mo–Fr fortschreiben */
function tradeDays(last,H){const out=[],d=new Date(last);while(out.length<H){d.setDate(d.getDate()+1);const w=d.getDay();if(w>0&&w<6)out.push(new Date(d))}return out}
function gjrLL(e,v0,a,g,b){const w=v0*(1-a-g/2-b);let s2=v0,L=0;for(let t=0;t<e.length;t++){const x=e[t],x2=x*x;L+=Math.log(s2)+x2/s2;s2=w+(x<0?a+g:a)*x2+b*s2}return-.5*(L+e.length*Math.log(2*Math.PI))}
/* Maximum Likelihood: grobes Gitter, dann zweimal feiner um das Optimum. noG = GARCH(1,1) zum Vergleich */
function gjrFit(r,noG){const m=mean(r),e=Float64Array.from(r,x=>x-m);let v0=0;for(const x of e)v0+=x*x;v0/=e.length;
 let best={a:.05,g:0,b:.9,l:-Infinity};
 const tryP=(a,g,b)=>{if(a<0||g<0||b<0||a+g/2+b>=.999)return;const l=gjrLL(e,v0,a,g,b);if(l>best.l)best={a,g,b,l}};
 for(let i=0;i<=10;i++)for(let j=0;j<=(noG?0:10);j++)for(let k=0;k<=13;k++)tryP(i*.02,j*.03,.6+k*.03);
 for(const f of[5,25]){const c={...best};for(let i=-5;i<=5;i++)for(let j=noG?0:-5;j<=(noG?0:5);j++)for(let k=-5;k<=5;k++)tryP(c.a+i*.02/f,c.g+j*.03/f,c.b+k*.03/f)}
 const {a,g,b}=best,p=a+g/2+b,w=v0*(1-p),T=e.length,sig=new Float64Array(T+1);let s2=v0;
 for(let t=0;t<T;t++){sig[t]=s2;const x=e[t];s2=w+(x<0?a+g:a)*x*x+b*s2}sig[T]=s2;
 const z=Float64Array.from(e,(x,t)=>x/Math.sqrt(sig[t])),fc=[];for(let k=1;k<=H_W;k++)fc.push(v0+Math.pow(p,k-1)*(sig[T]-v0));
 const np=noG?3:4;return{a,g,b,w,p,v0,m,sig,z,fc,ll:best.l,np,aic:2*np-2*best.l,hl:Math.log(.5)/Math.log(p)}}
/* Simulation: je Tag zufälliges z aus den standardisierten Residuen, Varianz am Termintag σ² + Δvar */
function fhs(g,dv,N,H,seed){const r=rng(seed),z=g.z,nz=z.length,cum=new Float32Array(N*H),vol=new Float32Array(N*H);
 for(let i=0;i<N;i++){let s2=g.sig[g.sig.length-1],c=0;for(let d=0;d<H;d++){const se=Math.sqrt(s2+dv[d]),x=se*z[Math.floor(r()*nz)];c+=g.m+x;cum[i*H+d]=c;vol[i*H+d]=se;s2=g.w+(x<0?g.a+g.g:g.a)*x*x+g.b*s2}}
 return{cum,vol,N,H}}
/* Termine: typischer Sprung je Aktie und je Termin-Art aus der Vergangenheit, Aufschlag auf die Depot-Varianz */
function eventModel(d){const ds=HD.dates,T=ds.length,fdd=tradeDays(DATES[T-1],H_W),fd=fdd.map(isoOf);
 const fi=x=>{for(let i=0;i<fd.length;i++)if(fd[i]>=x)return i;return-1};
 const pi=x=>{for(let i=0;i<T;i++)if(ds[i]>=x)return(new Date(ds[i])-new Date(x))/864e5<=4?i:-1;return-1};
 const dv=new Float64Array(H_W),list=[],stocks=[];
 d.tks.forEach((tk,k)=>{const e=EV.earn&&EV.earn[tk],st={tk,k,n:0,J:NaN,nn:NaN,m:1,add:0};stocks.push(st);if(!e)return;
  const r=d.RR[k],J=[];for(const x of e.past||[]){const i=pi(x);if(i<0)continue;J.push(Math.max(Math.abs(r[i]),i+1<T?Math.abs(r[i+1]):0))}
  st.n=J.length;if(J.length<3)return;st.J=med(J);st.nn=med(Array.from(r,Math.abs));st.m=Math.max(1,st.J/st.nn);st.add=d.w[k]**2*d.C[k][k]*(st.m**2-1);
  for(const x of e.next||[]){const i=fi(x);if(i<0)continue;dv[i]+=st.add;list.push({date:x,i,kind:'earn',k,tk,label:`${tk} Quartalszahlen`,short:tk,jump:st.J,dv:st.add})}});
 const M=HD.market,nM=med(Array.from(M,Math.abs)),vM=sd(M)**2,mm={};
 for(const [typ,nm] of[['fomc','Fed-Zinsentscheid'],['cpi','US-Inflationsdaten']]){const idx=(EV.macro||[]).filter(e=>e.type===typ&&e.date<=ds[T-1]).map(e=>pi(e.date)).filter(i=>i>=0),J=idx.map(i=>Math.abs(M[i]));
  mm[typ]={nm,n:J.length,J:J.length>=3?med(J):NaN,m:J.length>=3?Math.max(1,med(J)/nM):1.3,fb:J.length<3}}
 for(const e of EV.macro||[]){if(e.date<=ds[T-1])continue;const i=fi(e.date);if(i<0)continue;const q=mm[e.type];if(!q)continue;const add=d.beta**2*vM*(q.m**2-1);dv[i]+=add;
  list.push({date:e.date,i,kind:e.type,label:e.label,short:e.type==='fomc'?'Fed':'CPI',jump:q.J,dv:add})}
 list.sort((a,b)=>a.i-b.i||b.dv-a.dv);
 list.forEach((e,j)=>{const b=d.g.fc[e.i];e.mult=Math.sqrt((b+dv[e.i])/b);const f=list.find(x=>x.i===e.i);if(f!==e)e.with=f.label});
 return{dv,list,stocks,mm,fdd}}
/* Sturmtreiber: jede Aktie mit denselben α, γ, β, eigener Langfrist-Varianz und eigener Rekursion; Beiträge nach Euler */
function drivers(d,em){const g=d.g,p=g.p,n=d.w.length;
 const sig=d.RR.map((r,k)=>{const m=d.mus[k];let v0=0;for(const x of r)v0+=(x-m)**2;v0/=r.length;const w=v0*(1-p);let s2=v0;
  for(let t=0;t<r.length;t++){const x=r[t]-m;s2=w+(x<0?g.a+g.g:g.a)*x*x+g.b*s2}
  const add=d.C[k][k]*(em.stocks[k].m**2-1);let acc=0;for(let j=0;j<5;j++)acc+=v0+Math.pow(p,j)*(s2-v0)+(em.list.some(e=>e.kind==='earn'&&e.k===k&&e.i===j)?add:0);return Math.sqrt(acc/5)});
 const R=d.corr,var5=w=>{const ws=w.map((x,k)=>x*sig[k]);let v=0;for(let a=0;a<n;a++)for(let b=0;b<n;b++)v+=ws[a]*R[a][b]*ws[b];const mu=w.reduce((s,x,k)=>s+x*d.mus[k],0);return{v,VaR:d.V*(d.z*Math.sqrt(5*v)-5*mu)}};
 const ws=d.w.map((x,k)=>x*sig[k]),Rw=ws.map((_,a)=>ws.reduce((s,x,b)=>s+R[a][b]*x,0)),vp=var5(d.w).v,share=ws.map((x,a)=>x*Rw[a]/vp);
 const top=share.indexOf(Math.max(...share)),x=Math.round(d.w[top]/2*100)/100;
 return{sig,share,top,x,dv:var5(rew(d.w,top,x)).VaR-var5(d.w).VaR}}
/* Trefferquote: Parameter nur auf den ersten 250 Tagen, danach fest vorwärts filtern (Out-of-Sample) */
function backtest(r,dates){const n0=250,T=r.length;if(T<n0+40)return null;const f=gjrFit(r.slice(0,n0)),s=new Float64Array(T);let s2=f.v0;
 for(let t=0;t<T;t++){s[t]=s2;const x=r[t]-f.m;s2=f.w+(x<0?f.a+f.g:f.a)*x*x+f.b*s2}
 const wk=x=>{const q=new Date(x);q.setDate(q.getDate()-(q.getDay()+6)%7);return isoOf(q)},rr=rng(11),nz=f.z.length,P=300,vals=new Float64Array(P),weeks=[];
 for(let t=n0;t+5<=T;t++){if(t>n0&&wk(dates[t])===wk(dates[t-1]))continue;
  for(let i=0;i<P;i++){let v=s[t],acc=0;for(let j=0;j<5;j++){const x=Math.sqrt(v)*f.z[Math.floor(rr()*nz)],y=f.m+x;acc+=y*y;v=f.w+(x<0?f.a+f.g:f.a)*x*x+f.b*v}vals[i]=Math.sqrt(acc)}
  vals.sort();let real=0,nv=0;for(let j=0;j<5;j++)real+=r[t+j]**2;real=Math.sqrt(real);for(let j=t-20;j<t;j++)nv+=r[j]**2;const naive=Math.sqrt(5*nv/20),m=vals[P/2];
  weeks.push({d:dates[t],hit:real>=vals[P*.1]&&real<=vals[P*.9],better:Math.abs(m-real)<Math.abs(naive-real)})}
 return{weeks,n:weeks.length,hits:weeks.filter(w=>w.hit).length,better:weeks.filter(w=>w.better).length}}
/* Phasen der Vergangenheit nach σ_t / σ_lang */
function phases(g){const T=g.z.length,lv=new Uint8Array(T),sh=[0,0,0,0],runs=[];let run=0;
 for(let t=0;t<T;t++){lv[t]=lvOf(Math.sqrt(g.sig[t]/g.v0));sh[lv[t]]++;if(lv[t]>=2)run++;else if(run){runs.push(run);run=0}}if(run)runs.push(run);
 let len=1;while(len<T&&lv[T-1-len]===lv[T-1])len++;
 return{lv,share:sh.map(x=>x/T),runs:runs.length,meanRun:runs.length?mean(runs):0,cur:{lv:lv[T-1],len}}}
/* Schätzung und Simulation werden gecacht: Einstellungen (Sicherheit, Zeitraum) ändern nur die Quantile */
let FIT={key:''},SIM={key:''};
function fitWeather(d){const key=S.pf.map(p=>p.tk+':'+p.sh).join()+'|'+HD.dates[HD.dates.length-1];
 if(FIT.key!==key){const t0=performance.now(),R=Array.from(d.R);FIT={key,g:gjrFit(R),g11:gjrFit(R,true)};FIT.bt=backtest(R,HD.dates);FIT.ph=phases(FIT.g);FIT.ms=performance.now()-t0}
 d.g=FIT.g;d.g11=FIT.g11;d.bt=FIT.bt;d.ph=FIT.ph}
function weather(d){const t0=performance.now(),g=d.g,key=FIT.key+'|'+EV.ver;
 if(SIM.key!==key){const em=eventModel(d);SIM={key,em,sim:fhs(g,em.dv,NP,H_W,7),dr:drivers(d,em)}}
 const {em,sim,dr}=SIM,N=NP,H=H_W,lr=Math.sqrt(g.v0*252),V=d.V,col=new Float64Array(N);
 const fan=[.1,.25,.5,.75,.9].map(()=>new Float64Array(H));
 for(let k=0;k<H;k++){for(let i=0;i<N;i++)col[i]=sim.vol[i*H+k]*SQ;col.sort();[.1,.25,.5,.75,.9].forEach((q,j)=>fan[j][k]=col[Math.min(N-1,Math.floor(q*N))])}
 const loss=h=>{const L=new Float64Array(N);for(let i=0;i<N;i++)L[i]=-sim.cum[i*H+h-1]*V;return L.sort()};
 const dayVaR=k=>{const L=new Float64Array(N);for(let i=0;i<N;i++)L[i]=-(sim.cum[i*H+k]-(k?sim.cum[i*H+k-1]:0))*V;L.sort();return qu(L,S.conf)};
 const norm=h=>V*(d.z*Math.sqrt(h*g.v0)-g.m*h);
 const hz=HZ.map(h=>{let s=0;for(let k=0;k<h;k++)s+=fan[2][k];const ratio=s/h/lr,evs=em.list.filter(e=>e.i<h);let lv=lvOf(ratio);
  if(lv<3&&evs.some(e=>fan[2][e.i]/lr>=1.5))lv++;const L=loss(h);return{h,ratio,lv,n:evs.length,v:qu(L,S.conf),e:es(L,S.conf)}});
 let s5=0;for(let k=0;k<5;k++)s5+=dayVaR(k);
 const Lh=loss(S.h),vix=vixCmp(d,hz[2].ratio*lr);
 const w={lr,fan,hz,em,dr,vix,var5:hz[1].v,norm5:norm(5),day5:s5/5-norm(1),varH:qu(Lh,S.conf),esH:es(Lh,S.conf),paths:N};
 w.head=headline(d,w);w.ms=FIT.ms+performance.now()-t0;return w}
/* Markt gegen Modell: implizite Depot-Vola aus dem VIX */
function vixCmp(d,model){const v=HD.vix;if(!v||!v.level||v.level.length<30)return null;const lvl=v.level[v.level.length-1];if(!(lvl>0))return null;
 const idio=Math.max(0,d.sp**2-d.beta**2*sd(HD.market)**2)*252,impl=Math.sqrt(d.beta**2*(lvl/100)**2+idio),dev=impl/model-1;
 return{lvl,impl,model,dev,spark:v.level.slice(-252),msg:dev>.15?'Der Markt erwartet mehr Unruhe als dein Modell.':dev<-.15?'Der Markt erwartet weniger Unruhe als dein Modell.':'Markt und Modell sind sich einig.'}}
/* Urteil als Satz: Stufen heute, nächste Tage, nächster Monat und der Grund */
function headline(d,w){const [a0,a1,a2]=w.hz.map(x=>WL[x.lv].a);
 let s=a0===a1&&a1===a2?`Heute ${a0}, und so bleibt es voraussichtlich den ganzen Monat`:a0===a1?`Heute und in den nächsten Tagen ${a0}, im nächsten Monat ${a2}`:a1===a2?`Heute ${a0}, danach ${a1}`:`Heute ${a0}, in den nächsten Tagen ${a1}, im nächsten Monat ${a2}`;
 const why=lim=>{const ev=w.em.list.filter(e=>e.i<lim),ks=[...new Set(ev.filter(e=>e.kind==='earn').map(e=>e.k))],p=[];
  if(ks.length===1)p.push(`${d.names[ks[0]]} legt Zahlen vor`);else if(ks.length>1)p.push(`${cap(ks.length<ZW.length?ZW[ks.length]:String(ks.length))} deiner Aktien legen Zahlen vor`);
  if(ev.some(e=>e.kind==='fomc'))p.push(p.length?'die Fed entscheidet über die Zinsen':'Die Fed entscheidet über die Zinsen');
  if(ev.some(e=>e.kind==='cpi'))p.push(p.length?'neue US-Inflationsdaten kommen':'Neue US-Inflationsdaten kommen');
  return p.length>1?p.slice(0,-1).join(', ')+' und '+p[p.length-1]:p[0]||''};
 const wk=why(5),mo=why(21);
 if(wk||mo)return`${s}: ${wk||mo}.`;
 return w.hz[0].lv>=2?`${s}: Die Unruhe der letzten Tage wirkt nach.`:`${s}.`}
/* Termine von Yahoo (Quartalszahlen) und Markt-Termine laden; Fehler werden toleriert */
async function loadEvents(tks){const key=tks.join();if(EV.key===key&&(EV.earn||EV.loading))return;EV.key=key;EV.earn=null;EV.earnErr=false;EV.loading=true;
 const pE=api('/api/events',{tickers:tks}).then(x=>{EV.earn=x&&typeof x==='object'?x:{}}).catch(()=>{EV.earn={};EV.earnErr=true});
 const pM=EV.macro?Promise.resolve():api('/api/macro').then(x=>{EV.macro=Array.isArray(x)?x:[]}).catch(()=>{EV.macro=[];EV.macroErr=true});
 await Promise.all([pE,pM]);if(EV.key!==key)return;EV.loading=false;EV.ver++;
 if(D&&D.tks.join()===key){D.w2=weather(D);D.levers=levers(D);renderAll();drawAll()}}

/* ---------- Zeichner mit Datumsachse ---------- */
const mon=d=>(d||DATES[T-1]).toLocaleDateString('de-DE',{month:'short',year:'2-digit'});
function lineSvg(s,ser,o2={}){const W=s.clientWidth,H2=s.clientHeight;if(!W)return;const sm=W<520,n=ser[0].v.length;
 const m={l:sm?66:72,r:o2.area?16:(sm?64:96),t:14,b:30},iw=W-m.l-m.r,ih=H2-m.t-m.b;
 let lo=Infinity,hi=-Infinity;for(const s2 of ser)for(const v of s2.v){if(v<lo)lo=v;if(v>hi)hi=v}if(o2.area)hi=0;const pad=(hi-lo)*.06;lo-=pad;if(!o2.area)hi+=pad;
 const X=i=>m.l+i/(n-1)*iw,Y=v=>m.t+(hi-v)/(hi-lo)*ih,f=o2.fmt||ek;
 let o=nice(lo,hi,4).map(t=>`<line x1="${m.l}" x2="${W-m.r}" y1="${Y(t)}" y2="${Y(t)}" stroke="var(--ln)"/><text x="${m.l-8}" y="${Y(t)+4}" text-anchor="end">${f(t)}</text>`).join('');
 const xt=sm?[0,.5,1]:[0,.25,.5,.75,1];o+=xt.map(p=>{const i=Math.round(p*(n-1));return`<text x="${X(i)}" y="${H2-8}" text-anchor="${p===0?'start':p===1?'end':'middle'}">${mon(DATES[Math.max(0,i-1)])}</text>`}).join('');
 if(o2.area){const pts=Array.from(ser[0].v,(v,i)=>X(i).toFixed(1)+','+Y(v).toFixed(1)).join(' ');o+=`<polygon points="${X(0)},${Y(0)} ${pts} ${X(n-1)},${Y(0)}" fill="var(--bad)" opacity=".18"/><polyline points="${pts}" fill="none" stroke="var(--bad)" stroke-width="1.6"/>`}
 else{o+=ser.map(s2=>{const step=Math.max(1,Math.floor(n/(iw*1.5)));let p='';for(let i=0;i<n;i+=step)p+=X(i).toFixed(1)+','+Y(s2.v[i]).toFixed(1)+' ';p+=X(n-1).toFixed(1)+','+Y(s2.v[n-1]).toFixed(1);return`<polyline points="${p}" fill="none" stroke="var(--${s2.k})" stroke-width="${s2.w||2}" stroke-linejoin="round"/>`}).join('');
  const ends=ser.map(s2=>({k:s2.k,l:s2.label,y:Y(s2.v[n-1])})).sort((a,b)=>a.y-b.y);for(let i=1;i<ends.length;i++)if(ends[i].y-ends[i-1].y<16)ends[i].y=ends[i-1].y+16;
  o+=ends.map(e=>`<text x="${W-m.r+8}" y="${e.y+4}" style="fill:var(--${e.k})">${e.l}</text>`).join('')}
 if(o2.mark)o+=`<circle cx="${X(o2.mark.i)}" cy="${Y(o2.mark.v)}" r="4" fill="var(--bad)"/><text x="${X(o2.mark.i)+(o2.mark.i>n/2?-8:8)}" y="${Y(o2.mark.v)+18}" text-anchor="${o2.mark.i>n/2?'end':'start'}" style="fill:var(--bad)">${o2.mark.t}</text>`;
 s.innerHTML=o}

/* ---------- Darstellen ---------- */
const hT=()=>({1:'an einem Tag',10:'in zehn Handelstagen',21:'in einem Monat'}[S.h]);
const SRI=v=>v<.005?1:v<.05?2:v<.12?3:v<.2?4:v<.3?5:v<.8?6:7;
const SRIN=['','sehr niedrig','niedrig','eher niedrig','mittel','erhöht','hoch','sehr hoch'];
const kpi=(l,v,s='',cls='')=>`<div class="kpi ${cls}"><span>${l}</span><b>${v}</b>${s?`<span>${s}</span>`:''}</div>`;
const hBad=()=>({1:'Schlechter Tag',10:'Schlechte zwei Wochen',21:'Schlechter Monat'}[S.h]);
const ICON={klumpen:'<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3" fill="currentColor"/>',
 streu:'<circle cx="6" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
 stil:'<circle cx="12" cy="12" r="8"/><path d="M15.5 8.5l-2.2 4.8-4.8 2.2 2.2-4.8z"/>',
 sektor:'<path d="M12 4a8 8 0 1 0 8 8h-8z"/><path d="M15 3.6A8 8 0 0 1 20.4 9H15z"/>',
 vola:'<path d="M3 13c2 0 2-5 4-5s2 9 4 9 2-12 4-12 2 8 3 8h3"/>',gut:'<path d="M5 12.5l4.5 4.5L19 7.5"/>'};
const lvHtml=(l,i)=>`<article class="lv" style="--c:var(${l.c})"><div class="lv-h"><span class="lv-i" aria-hidden="true"><svg viewBox="0 0 24 24">${ICON[l.ic]}</svg></span><span class="lv-t">${l.tag}</span></div>
 <h3>${l.h}</h3><p>${l.t}</p>${l.ev?`<div class="lv-e"><span class="small">${l.el}</span><b>${l.ev}</b></div>`:'<span></span>'}${l.b?`<button type="button" class="btn gh sm" data-lv="${i}">${l.b}</button>`:'<span></span>'}</article>`;
function renderAll(){if(!D)return;const d=D,V=d.V,nm=k=>esc(d.names[k]),tk=k=>esc(d.tks[k]);
 /* Urteil mit Maßstab: S&P-500-ETF in gleicher Höhe */
 const r=d.ratio,lvl=r<.9?['--t','Ruhiger als der Markt']:r<1.15?['--n','Etwa wie der Markt']:r<1.4?['--warn','Erhöhtes Risiko']:['--bad','Hohes Risiko'],rd=x=>pc(Math.round(x*20)/20,0);
 $('#o-amp').style.setProperty('--c',`var(${lvl[0]})`);$('#o-amp').textContent=lvl[1];
 {const wl=d.w2.hz[1].lv;$('#o-wb').innerHTML=`${wIcon(wl)}<span>Risiko-Wetter: <b>${WL[wl].n}</b></span>`}
 $('#o-h').textContent=r>=1.15?`Dein Depot schwankt rund ${rd(r-1)} stärker als ein S&P-500-ETF.`:r<.9?`Dein Depot ist rund ${rd(1-r)} ruhiger als ein S&P-500-ETF.`:'Dein Depot schwankt etwa so stark wie ein S&P-500-ETF.';
 const up=d.retA>d.ixA;
 $('#o-ret').textContent=`In den letzten zwei Jahren brachte dein Depot ${pc(d.retA)} pro Jahr, ein S&P-500-ETF ${pc(d.ixA)}.`+(r>=1.15?(up?' Das höhere Risiko wurde bisher belohnt.':' Das höhere Risiko hat sich bisher nicht ausgezahlt.'):r<.9&&up?' Mehr Rendite bei weniger Schwankung.':'');
 const pair=(lab,a,b,f)=>{const mx=Math.max(a,b)||1;return`<div class="pr"><span class="lbl">${lab}</span>${[['Dein Depot',a,'d'],['S&amp;P-500-ETF',b,'e']].map(([n,v,c])=>`<div class="br ${c}"><span>${n}</span><span class="bt"><i style="width:${(Math.max(0,v)/mx*100).toFixed(1)}%"></i></span><b>${f(v)}</b></div>`).join('')}</div>`};
 $('#o-cmp').innerHTML=pair(`${hBad()} (VaR)`,d.his.v,d.etf.v,eur)+pair('Schwankung pro Jahr',d.volA,d.etf.vol,v=>pc(v,0))+'<p class="small">ETF mit gleichem Betrag, gemessen wie dein Depot.</p>';
 /* drei wichtigste Punkte */
 $('#o-lv').innerHTML=d.levers.map(lvHtml).join('');
 /* Übersetzung */
 $('#o-mh').textContent='in Alltagssprache';
 $('#o-m').innerHTML=[[d.mean.f,`verlierst du ${hT()} mehr als ${eur(d.his.v)}.`],[`Im Schnitt ${eur(d.his.e)}`,`sind es ${d.mean.per}.`],[d.mean.ly,'endest du nach zwölf Monaten im Minus.']]
  .map(([a,b])=>`<div class="mn"><b>${a}</b><span>${b}</span></div>`).join('');
 const sri=SRI(d.volA);
 $('#o-sc').innerHTML=Array.from({length:7},(_,i)=>`<i class="${i+1===sri?'on':''}" style="${i+1===sri?`background:color-mix(in srgb,var(--bad) ${Math.round(i/6*100)}%,var(--t))`:''}">${i+1}</i>`).join('');
 $('#o-sct').textContent=`Dein Depot liegt in Klasse ${sri}: ${SRIN[sri]}.`;
 /* Positionen */
 $('#p-h').textContent='sortiert nach Wert';
 const k2=v=>v.toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2})+' €';
 $('#p-t').innerHTML=S.pf.map((p,k)=>`<tr><td class="l"><span class="tk">${tk(k)}</span> <span class="mut">${nm(k)}</span></td><td class="l hide-s">${esc(d.sect[k])}</td><td>${p.sh.toLocaleString('de-DE')}</td><td class="hide-s">${k2(d.last[k])}</td><td>${eur(d.val[k])}</td><td>${pc(d.w[k])}</td></tr>`).join('');
 $('#p-f').innerHTML=`<tr><td class="l">Gesamt</td><td class="hide-s"></td><td></td><td class="hide-s"></td><td>${eur(V)}</td><td>100 %</td></tr>`;
 $('#p-src').textContent=`${S.src==='demo'?'Demo-Portfolio':'Importiertes Depot'} · bewertet mit dem Schlusskurs vom ${DATES[T-1].toLocaleDateString('de-DE')}, in Euro umgerechnet.`;
 const se=Object.entries(d.sec).sort((a,b)=>b[1]-a[1]);$('#p-s').innerHTML=rowsHtml(se.map(([s,v])=>({n:esc(s),v,t:`<b>${pc(v,0)}</b>`})),se[0][1]);
 /* Kennzahlen, Profi-Kennzahlen eingeklappt */
 $('#k-k').innerHTML=kpi('Sharpe Ratio',nf(d.sharpe),'Rendite über dem Zins je Einheit Schwankung. Über 1 gilt als gut.')+kpi('Beta',nf(d.beta),`Bewegt sich der S&amp;P 500 um 10 %, bewegt sich dein Depot im Schnitt um ${pc(Math.abs(d.beta)*.1,0)}.`)+kpi('Gleichlauf',nf(d.ac),'mittlere Korrelation deiner Aktien. 0: unabhängig, 1: laufen im Gleichschritt.');
 $('#k-p').innerHTML=kpi('Tracking Error',pc(d.te),'gegen S&amp;P 500, p.a.')+kpi('Calmar Ratio',nf(d.retA/Math.abs(d.mdd||1)),'Rendite / Max. Drawdown')+kpi('Sortino Ratio',nf(d.sortino),'Rendite je Einheit Abwärtsschwankung');
 /* Risiko: Verlust */
 $('#r-h').textContent=`Zum Vergleich: Ein S&P-500-ETF in gleicher Höhe käme auf einen VaR von ${eur(d.etf.v)} und schwankt ${pc(d.etf.vol)} pro Jahr.`;
 $('#r-k').innerHTML=kpi(`Value at Risk · ${pc(S.conf)} · ${hName()}`,eur(d.his.v),`Mit ${pc(S.conf)} Sicherheit verlierst du ${hT()} nicht mehr. ${d.mean.f} wird es mehr.`)+kpi('Expected Shortfall',eur(d.his.e),`So viel sind es im Schnitt ${d.mean.per}.`)+kpi('Volatilität p.a.',pc(d.volA),'typische Schwankung über ein Jahr')+kpi('Verlust nach 1 Jahr',pc(d.lossP,0),`${d.mean.ly} endest du nach zwölf Monaten im Minus.`);
 $('#r-hs').textContent=`Historische Simulation · ${d.Lh.length} Zeiträume à ${S.h} ${S.h>1?'Tage':'Tag'}`;
 const fin=x=>isFinite(x)?eur(x):'–';
 $('#r-meth').innerHTML=`<thead><tr><th class="l">Methode</th><th>Value at Risk</th><th>Expected Shortfall</th></tr></thead><tbody>${[['Historisch',d.his],['Parametrisch',d.par],['Monte Carlo',d.mc],['Cornish-Fisher',d.cf]].map(([n,x])=>`<tr><td class="l">${n}</td><td>${fin(x.v)}</td><td>${fin(x.e)}</td></tr>`).join('')}<tr><td class="l">Schiefe · Überschuss-Wölbung</td><td colspan="2">${nf(d.skew)} · ${nf(d.kurt)}</td></tr></tbody>`;
 /* Risiko: Aktien */
 const order=d.tks.map((_,k)=>k).sort((a,b)=>d.rk.share[b]-d.rk.share[a]),mx=Math.max(...d.rk.share,...d.w,.01);
 $('#b-h').textContent=`${d.names[order[0]]} trägt mit ${pc(d.rk.share[order[0]],0)} am meisten zum Risiko bei.`;
 $('#b-r').innerHTML=rowsHtml(order.map(k=>({n:`<span class="tk">${tk(k)}</span>`,v:Math.max(0,d.rk.share[k]),w:d.w[k],c:d.rk.share[k]>d.w[k]*1.3?'neg':'',t:`<b>${pc(d.rk.share[k],0)}</b> Risiko · ${pc(d.w[k],0)} Gewicht`})),mx);
 $('#wx').max=Math.max(.5,Math.ceil(Math.max(...d.w)*100)/100);
 if(S.wi==null||S.wi>=d.tks.length)S.wi=d.clumpK;$('#wi').innerHTML=d.tks.map((_,k)=>`<option value="${k}">${tk(k)} · ${nm(k)}</option>`).join('');$('#wi').value=S.wi;renderWhat();
 renderStress();renderCustom();renderFactors();renderWeather();renderRisk()}
/* Faktor-Profil als Satz aus allen Stil-Faktoren mit |t| ≥ 2 */
const ADJ={SMB:['kleine','große'],QUAL:['profitable','weniger profitable'],LVOL:['ruhige','schwankungsfreudige'],MOM:['zuletzt starke','zuletzt schwache']};
function profile(sig){if(!sig.length)return'Dein Depot hat keine klare Stil-Neigung, es läuft vor allem mit dem Markt.';
 const g=k=>sig.find(x=>x.k===k),adj=['SMB','QUAL','LVOL','MOM'].filter(g).map(k=>ADJ[k][g(k).b>0?0:1]),v=g('VAL'),noun=v?(v.b>0?'Value-Firmen':'Wachstumsfirmen'):'Firmen';
 return`Dein Depot setzt auf ${adj.length?adj.join(', ')+' ':''}${noun}.`}
function renderFactors(){const f=D.f;
 if(!f){$('#f-h').textContent='Die Faktor-Analyse konnte für dieses Depot nicht gerechnet werden.';['#f-k','#f-b','#f-r','#f-rt','#f-t','#f-tt'].forEach(id=>$(id).innerHTML='');return}
 const {reg,st}=f,style=st.filter(x=>x.k!=='MKT'),mk=st[0],sig=style.filter(x=>Math.abs(x.t)>=2);
 $('#f-h').textContent=profile(sig)+` Bewegt sich der Markt um 10 %, bewegt sich dein Depot um etwa ${pc(Math.abs(mk.b)*.1,0)}.`+(style.length?'':' Faktor-Daten von Yahoo Finance fehlen gerade.');
 const mx=Math.max(.3,...style.map(x=>Math.abs(x.b)));
 $('#f-b').innerHTML=style.map(x=>{const weak=Math.abs(x.t)<2,tl=x.b>0?x.p:x.m;return`<div class="fxr"><span>${x.n}<small>${weak?'kein klarer Effekt':(x.b>0?x.pos:x.neg)}</small></span><span class="fxb"><i class="${x.b>=0?'p':'m'} ${weak?'weak':''}" style="width:${Math.min(50,Math.abs(x.b)/mx*50)}%"></i></span><span class="v">${x.b>=0?'+':''}${nf(x.b)}</span>${weak?'':`<p class="fxe">Laufen ${tl.g} 10 % schlechter als ${tl.o}, kostet dich das ≈ ${eur(Math.abs(x.b)*.1*D.V)}.</p>`}</div>`}).join('')||'<p class="mut">Keine Stil-Faktoren verfügbar.</p>';
 const sp=v=>Math.abs(v)<.005?'unter 1 %':pc(v,0),items=[...st.map(x=>({n:x.n,v:Math.abs(x.sh),c:x.sh<0?'pos':'',t:`<b>${sp(x.sh)}</b>`})),{n:'Firmenspezifisch',v:f.idio,c:'neg',t:`<b>${pc(f.idio,0)}</b>`}];
 $('#f-r').innerHTML=rowsHtml(items,Math.max(...items.map(i=>i.v),.01));
 $('#f-rt').textContent='Den firmenspezifischen Teil kannst du mit mehr Aktien verringern, Markt- und Stilrisiko nicht.'+(st.some(x=>x.sh<0)?' Grün: senkt das Risiko.':'');
 /* Für Profis */
 $('#f-k').innerHTML=kpi('Markt-Beta',nf(mk.b),mk.b>1.05?'stärker als der S&amp;P 500':mk.b<.95?'ruhiger als der S&amp;P 500':'etwa wie der S&amp;P 500')+kpi('Erklärt durch Faktoren',pc(reg.r2,0),'R² der Regression')+kpi('Alpha p.a.',pc(reg.a*252),Math.abs(reg.ta)>=2?(reg.a>0?'Mehrrendite':'Minderrendite')+' nach Faktoren, statistisch deutlich':'nicht von null zu unterscheiden');
 $('#f-tt').innerHTML=`<thead><tr><th class="l">Faktor</th><th>t-Wert</th><th class="l">gesichert (|t| ≥ 2)</th></tr></thead><tbody>${st.map(x=>`<tr><td class="l">${x.n}</td><td>${nf(x.t)}</td><td class="l">${Math.abs(x.t)>=2?'ja':'nein'}</td></tr>`).join('')}</tbody>`;
 const cell=(v,k)=>{const p=Math.round(Math.min(1,Math.abs(v)/(k===0?1.6:.8))*62);return`<td style="background:color-mix(in srgb,var(${v>=0?'--ink':'--g'}) ${p}%,var(--sf));${p>38?'color:var(--on)':''}">${nf(v)}</td>`};
 $('#f-t').innerHTML=`<tr><th></th>${st.map(x=>`<th>${x.sn}</th>`).join('')}<th>R²</th></tr>`+D.tks.map((tk,k)=>{const r=f.per[k];return r?`<tr><th scope="row"><span class="tk">${esc(tk)}</span></th>${r.b.map((v,i)=>cell(v,i)).join('')}<td>${pc(r.r2,0)}</td></tr>`:''}).join('')}
/* ---------- Risiko-Wetter: Darstellung ---------- */
const CLOUD='M15 36h19a7 7 0 0 0 .8-13.95A10 10 0 0 0 15.6 21.3 7.4 7.4 0 0 0 15 36z';
const WICON={sun:'<circle cx="24" cy="24" r="8"/><path d="M24 6v5M24 37v5M6 24h5M37 24h5M11.3 11.3l3.5 3.5M33.2 33.2l3.5 3.5M11.3 36.7l3.5-3.5M33.2 14.8l3.5-3.5"/>',
 part:'<circle cx="18" cy="17" r="6"/><path d="M18 5v3M6 17h3M9.5 8.5l2 2M26.5 8.5l-2 2"/><path d="M17 40h18a6.5 6.5 0 0 0 .7-12.95A9 9 0 0 0 18.4 26.3 6.9 6.9 0 0 0 17 40z" fill="var(--sf)"/>',
 rain:`<path d="${CLOUD}" transform="translate(0 -6)"/><path d="M18 35l-2 5M25 35l-2 5M32 35l-2 5"/>`,
 storm:`<path d="${CLOUD}" transform="translate(0 -7)"/><path d="M26 31l-5 7h6l-4 7"/>`};
const wIcon=(lv,cls='')=>`<svg class="wi ${cls}" viewBox="0 0 48 48" aria-hidden="true" style="color:var(${WL[lv].c})">${WICON[WL[lv].ic]}</svg>`;
const ddm=x=>new Date(x+'T12:00:00').toLocaleDateString('de-DE',{weekday:'short',day:'2-digit',month:'2-digit'});
function renderWeather(){const d=D,w=d.w2,g=d.g;if(!w)return;
 $('#v-h').textContent=w.head;
 $('#v-note').textContent=EV.loading?'Termine werden geladen …':[EV.earnErr&&'Die Termine der Quartalszahlen fehlen gerade, die Prognose rechnet ohne sie.',EV.macroErr&&'Die Markt-Termine fehlen gerade.',!w.vix&&'Keine VIX-Daten, der Vergleich mit dem Markt entfällt.'].filter(Boolean).join(' ');
 /* Wetterleiste */
 const NM=['Heute','1 Woche','1 Monat','3 Monate'],BAD=['Schlechter Tag bis zu','Schlechte Woche: bis zu','Schlechter Monat: bis zu','Schlechte 3 Monate: bis zu'];
 $('#v-wx').innerHTML=w.hz.map((x,i)=>`<div class="wc${i===0?' on':''}"><span class="wc-n">${NM[i]}</span>${wIcon(x.lv)}<b>${WL[x.lv].n}</b><span>${BAD[i]} <strong>${eur(x.v)}</strong></span><span class="small">${x.n===0?'keine Termine':x.n===1?'1 Termin':x.n+' Termine'}</span></div>`).join('');
 $('#v-lr').textContent=pc(w.lr,0);
 /* Was kommt */
 const ev=w.em.list;
 $('#v-ev').innerHTML=EV.loading&&!ev.length?'<li class="mut">Termine werden geladen …</li>':ev.length?ev.slice(0,12).map((e,n)=>`<li data-ei="${n}" tabindex="0"><span class="d">${ddm(e.date)}</span><span><b>${esc(e.label)}</b><small>${isFinite(e.jump)?`${e.kind==='earn'?'üblich':'S&amp;P 500 üblich'} ±${pc(e.jump,1)}`:'noch zu wenig Erfahrung mit diesem Termin'} · ${e.with?`am selben Tag wie ${esc(e.with)}`:e.mult<1.05?'kaum Effekt aufs Depot':`Depot schwankt an dem Tag etwa ${nf(e.mult,1)}-mal so stark`}</small></span></li>`).join('')+(ev.length>12?`<li class="small">und ${ev.length-12} weitere</li>`:''):'<li class="mut">Keine bekannten Termine in den nächsten 90 Tagen.</li>';
 /* Sturmtreiber */
 const dr=w.dr,ord=d.tks.map((_,k)=>k).sort((a,b)=>dr.share[b]-dr.share[a]).slice(0,5),mx=Math.max(...ord.map(k=>Math.max(dr.share[k],d.w[k])),.01);
 $('#v-dr').innerHTML=rowsHtml(ord.map(k=>({n:`<span class="tk">${esc(d.tks[k])}</span>`,v:Math.max(0,dr.share[k]),w:d.w[k],c:dr.share[k]>d.w[k]*1.3?'neg':'',t:`<b>${pc(dr.share[k],0)}</b> · ${pc(d.w[k],0)} Gewicht`})),mx);
 $('#v-drl').textContent=`Wenn du das Gewicht von ${d.names[dr.top]} halbierst (${pc(d.w[dr.top],0)} → ${pc(dr.x,0)}), ändert sich der VaR für eine Woche um ${sg(dr.dv)}.`;
 /* Markt gegen Modell */
 $('#v-mm').hidden=!w.vix;
 if(w.vix){$('#v-mmt').textContent=w.vix.msg;$('#v-mmk').innerHTML=kpi('Modell, 1 Monat',pc(w.vix.model,0),'Prognose für dein Depot')+kpi('Markt, über den VIX',pc(w.vix.impl,0),`VIX heute ${nf(w.vix.lvl,1)}`)}
 /* Trefferquote */
 const bt=d.bt;$('#v-bt').textContent=bt?`In ${bt.hits} von ${bt.n} Wochen lag die Prognose richtig. In ${pc(bt.better/bt.n,0)} der Wochen war sie genauer als „wie zuletzt“.`:'Für den Test ist die Historie zu kurz.';
 $('#v-btd').innerHTML=bt?bt.weeks.map(x=>`<i class="${x.hit?'h':''}" title="Woche ab ${dDE(x.d)}: ${x.hit?'Treffer':'daneben'}"></i>`).join(''):'';
 /* VaR */
 $('#v-var').innerHTML=kpi('VaR mit Prognose',eur(w.varH),`${pc(S.conf)}, ${hName()}, mit Terminen`)+kpi('VaR im Normalfall',eur(D.par.v),'gleiche Schwankung an jedem Tag')+kpi('VaR historisch',eur(D.his.v),'aus zwei Jahren Verlusten');
 $('#v-vt').textContent=Math.abs(w.day5)<1?'In den nächsten 5 Tagen ist ein schlechter Tag etwa so teuer wie im Normalfall.':`In den nächsten 5 Tagen ist ein schlechter Tag ${eur(Math.abs(w.day5))} ${w.day5>0?'teurer':'günstiger'} als im Normalfall.`;
 /* Für Profis */
 const g11=d.g11,ph=d.ph,mmr=Object.values(w.em.mm),stk=w.em.stocks.filter(s=>s.n>0);
 $('#v-p').innerHTML=`<div class="kpis">${kpi('α',nf(g.a,3),'Reaktion auf Schocks')+kpi('γ',nf(g.g,3),'Zusatz bei Verlusten')+kpi('β',nf(g.b,3),'Gedächtnis')+kpi('ω',(g.w*1e6).toLocaleString('de-DE',{maximumFractionDigits:2})+'·10⁻⁶','Varianz-Targeting')+kpi('Persistenz',nf(g.p,3),'α + γ/2 + β')+kpi('Halbwertszeit',`${Math.round(g.hl)} Tage`,'ln(0,5) / ln(Persistenz)')}</div>
 <div class="scroll"><table class="tbl"><thead><tr><th class="l">Modell</th><th>Log-Likelihood</th><th>Parameter</th><th>AIC</th></tr></thead><tbody><tr><td class="l">GJR-GARCH(1,1)</td><td>${nf(g.ll,1)}</td><td>${g.np}</td><td>${nf(g.aic,1)}</td></tr><tr><td class="l">GARCH(1,1)</td><td>${nf(g11.ll,1)}</td><td>${g11.np}</td><td>${nf(g11.aic,1)}</td></tr></tbody></table></div>
 <p class="small">Kleinerer AIC ist besser: ${g.aic<g11.aic?'GJR':'GARCH(1,1)'} passt hier besser. GARCH(1,1): α = ${nf(g11.a,3)}, β = ${nf(g11.b,3)}.</p>
 <div class="scroll"><table class="tbl"><thead><tr><th class="l">Termin-Multiplikator</th><th>vergangene Termine</th><th>üblicher Sprung</th><th>normaler Tag</th><th>Multiplikator</th></tr></thead><tbody>${mmr.map(q=>`<tr><td class="l">${q.nm} (S&amp;P 500)</td><td>${q.n}</td><td>${isFinite(q.J)?pc(q.J,2):'–'}</td><td>–</td><td>${nf(q.m)}${q.fb?' (Annahme)':''}</td></tr>`).join('')}${stk.map(s=>`<tr><td class="l"><span class="tk">${esc(s.tk)}</span> Quartalszahlen</td><td>${s.n}</td><td>${isFinite(s.J)?pc(s.J,2):'–'}</td><td>${isFinite(s.nn)?pc(s.nn,2):'–'}</td><td>${s.n>=3?nf(s.m):'zu wenige'}</td></tr>`).join('')}</tbody></table></div>
 <p class="small">Phasen der letzten zwei Jahre: ${WL.map((l,i)=>`${l.n} ${pc(ph.share[i],0)}`).join(' · ')}. Unruhige Phasen (ab „Unruhig“): ${ph.runs}, im Schnitt ${nf(ph.meanRun,1)} Handelstage. Aktuelle Phase: ${WL[ph.cur.lv].n} seit ${ph.cur.len} ${ph.cur.len===1?'Handelstag':'Handelstagen'}.</p>
 <p class="small">Methode: GJR-GARCH(1,1) mit Varianz-Targeting, Maximum Likelihood (Normalverteilung) auf einem Gitter. Prognose per gefilterter historischer Simulation: ${nf(w.paths,0)} Pfade über ${H_W} Handelstage, je Tag ein zufälliges standardisiertes Residuum der Vergangenheit. Termintage bekommen einen Varianz-Aufschlag aus dem Median der vergangenen Reaktionen. Trefferquote: Parameter auf den ersten 250 Handelstagen geschätzt, danach fest vorwärts gefiltert, je Wochenstart 300 Pfade. Rechenzeit ${Math.round(w.ms)} ms.</p>`}
/* ---------- Risiko-Wetter: interaktives Diagramm ----------
   Ausschnitt VW = {a,b} als Index über Vergangenheit (0 … T0−1) und Prognose (T0 … T0+H−1).
   Zoomen: Fenster in der Übersicht unten, Bereich aufziehen (Maus), Pinch auf dem Trackpad, Tasten + und −.
   Einheit: Schwankung in % p. a. oder „schlechter Tag“ in Euro (kalibriert auf die Karte „Heute“). */
let VW=null,VWkey='',HLE=-1,VRAF=0;
const vOn=k=>!(S.vh||[]).includes(k);
function vSer(d){const g=d.g,w2=d.w2,F=w2.fan,T0=g.sig.length-1,H=F[0].length,past=Array.from(g.sig.subarray(0,T0),v=>Math.sqrt(v*252)),fd=w2.em.fdd;
 return{T0,H,N:T0+H,past,F,fd,dt:j=>j<T0?DATES[j]:fd[j-T0],val:j=>j<T0?past[j]:F[2][j-T0],kE:w2.hz[0].v/F[2][0]}}
function vPreset(d,r){const T0=d.g.sig.length-1,H=d.w2.fan[0].length;const n=r===3?63:r===2?T0:252;VW={a:Math.max(0,T0-n),b:T0+H-1}}
function vClamp(d,a,b){const N=d.g.sig.length-1+d.w2.fan[0].length,min=10;let s=Math.max(min,Math.min(N-1,b-a));a=Math.max(0,Math.min(a,N-1-s));return{a,b:a+s}}
function vSet(v,custom=true){VW=vClamp(D,v.a,v.b);if(custom&&S.vr!==0){S.vr=0;save();vSeg()}vRedraw()}
function vSeg(){$$('#v-rg button').forEach(x=>x.setAttribute('aria-pressed',+x.dataset.r===S.vr))}
function vRedraw(){if(VRAF)return;VRAF=requestAnimationFrame(()=>{VRAF=0;if(!D||!D.w2)return;weatherSvg($('#v-g'),D);navSvg($('#v-nav'),D)})}
const dLong=x=>x.toLocaleDateString('de-DE',{weekday:'short',day:'2-digit',month:'2-digit',year:'numeric'});
function weatherSvg(s,d){const W=s.clientWidth,H2=s.clientHeight;if(!W||!d.w2)return;const w2=d.w2,sm=W<520,Q=vSer(d),{T0,H,N,past,F}=Q;
 const key=T0+'|'+H+'|'+FIT.key;if(VWkey!==key||!VW){VWkey=key;vPreset(d,S.vr||1)}
 const {a,b}=VW,eu=S.vu==='e',k=eu?Q.kE:1,fmt=eu?v=>eur(v):v=>pc(v,0),lr=w2.lr;
 const m={l:eu?(sm?60:70):(sm?40:52),r:sm?12:118,t:44,b:30},iw=W-m.l-m.r,ih=H2-m.t-m.b,X=j=>m.l+(j-a)/(b-a)*iw;
 const j0=Math.max(0,Math.floor(a)),j1=Math.min(N-1,Math.ceil(b)),evs=w2.em.list,evd=new Set(evs.map(e=>e.i));
 /* y-Achse aus dem sichtbaren Ausschnitt; Spitzen an Termintagen zählen nicht mit */
 let mn=Infinity,mx=-Infinity;const acc=v=>{if(v<mn)mn=v;if(v>mx)mx=v};
 for(let j=j0;j<=j1;j++){if(j<T0)acc(past[j]);else{const q=j-T0;if(evd.has(q))continue;acc(F[vOn('b1')?0:vOn('b2')?1:2][q]);acc(F[vOn('b1')?4:vOn('b2')?3:2][q])}}
 if(vOn('l'))acc(lr);if(!isFinite(mx)){mn=lr*.8;mx=lr*1.2}
 let ticks=nice(mn*k*.88,mx*k*1.06,sm?3:4);const lo=Math.min(ticks[0],mn*k*.9),hi=Math.max(ticks[ticks.length-1],mx*k*1.06),Y=v=>m.t+(hi-v*k)/(hi-lo)*ih;ticks=ticks.filter(t=>t>=lo&&t<=hi);
 const base=m.t+ih,tn=T0-1,xn=X(tn),now=past[tn],showNow=tn>=a&&tn<=b,f2=n=>n.toFixed(1);
 let o=`<defs><clipPath id="v-clip"><rect x="${m.l}" y="${m.t-1}" width="${iw}" height="${ih+2}"/></clipPath></defs><g clip-path="url(#v-clip)">`;
 /* Phasen: unruhig und Sturm als dezente Streifen */
 if(vOn('p')){const PC=[null,null,['--warn',.11],['--bad',.13]],e1=Math.min(j1,T0-1);let i0=j0;
  for(let j=j0+1;j<=e1+1;j++){if(j<=e1&&d.ph.lv[j]===d.ph.lv[i0])continue;const c=PC[d.ph.lv[i0]];if(c)o+=`<rect x="${f2(X(i0-.5))}" y="${m.t}" width="${f2(X(j-.5)-X(i0-.5))}" height="${ih}" fill="var(${c[0]})" opacity="${c[1]}"/>`;i0=j}}
 o+='</g>'+ticks.map(t=>`<line x1="${m.l}" x2="${W-m.r}" y1="${f2(m.t+(hi-t)/(hi-lo)*ih)}" y2="${f2(m.t+(hi-t)/(hi-lo)*ih)}" stroke="var(--ln)"/><text x="${m.l-8}" y="${f2(m.t+(hi-t)/(hi-lo)*ih+4)}" text-anchor="end">${fmt(t)}</text>`).join('')+'<g clip-path="url(#v-clip)">';
 /* Vergangenheit */
 if(j0<T0){const e1=Math.min(T0-1,j1+1),st=Math.max(1,Math.floor((e1-j0)/(iw*1.5)));let pts='';const s0=Math.max(0,j0-1);for(let j=s0;j<e1;j+=st)pts+=f2(X(j))+','+f2(Y(past[j]))+' ';pts+=f2(X(e1))+','+f2(Y(past[e1]));
  o+=`<polygon points="${f2(X(s0))},${base} ${pts} ${f2(X(e1))},${base}" fill="var(--ink)" opacity=".08"/><polyline points="${pts}" fill="none" stroke="var(--ink)" stroke-width="${b-a<130?1.8:1.3}" stroke-linejoin="round" opacity=".85"/>`}
 /* Fächer ab dem heutigen Punkt */
 if(j1>=tn){const band=(p,q)=>{const up=[`${f2(xn)},${f2(Y(now))}`],dn=[];for(let i=0;i<H;i++){up.push(f2(X(T0+i))+','+f2(Y(F[q][i])));dn.unshift(f2(X(T0+i))+','+f2(Y(F[p][i])))}return up.concat(dn).join(' ')};
  if(vOn('b1'))o+=`<polygon points="${band(0,4)}" fill="var(--t)" opacity=".16"/>`;if(vOn('b2'))o+=`<polygon points="${band(1,3)}" fill="var(--t)" opacity=".26"/>`;
  o+=`<polyline points="${[`${f2(xn)},${f2(Y(now))}`,...Array.from(F[2],(v,i)=>f2(X(T0+i))+','+f2(Y(v)))].join(' ')}" fill="none" stroke="var(--t)" stroke-width="2.4" stroke-linejoin="round"/>`}
 o+='</g>';
 /* Langfrist-Niveau */
 if(vOn('l'))o+=`<line x1="${m.l}" x2="${W-m.r}" y1="${f2(Y(lr))}" y2="${f2(Y(lr))}" stroke="var(--mut)" stroke-dasharray="5 4"/>`+(sm?'':`<text x="${W-m.r+10}" y="${f2(Y(lr)-3)}" style="fill:var(--mut)"><tspan>Ø ${fmt(lr*k)}</tspan><tspan x="${W-m.r+10}" dy="15">langfristig</tspan></text>`);
 /* Termine: Linie, Marke an der x-Achse, höchstens 4 Beschriftungen; abgeschnittene Spitzen mit echtem Wert */
 const vis=evs.map((e,n)=>({e,n,j:T0+e.i})).filter(o=>o.j>=a-.5&&o.j<=b+.5);
 if(vOn('e')){for(const {e,n,j} of vis){const x=f2(X(j)),on=n===HLE;o+=`<line class="evl" data-ei="${n}" x1="${x}" x2="${x}" y1="${m.t}" y2="${base}" stroke="var(${on?'--ink':'--mut'})" stroke-width="1" opacity="${on?.9:.35}"/><circle class="evm" data-ei="${n}" cx="${x}" cy="${base}" r="${on?6:3.5}" fill="var(${e.kind==='earn'?'--g':'--ink'})" stroke="var(--sf)" stroke-width="1.5"/>`}
  const top=[...vis].sort((p,q)=>q.e.dv-p.e.dv).slice(0,sm?2:4).sort((p,q)=>p.j-q.j),rows=[[],[],[]];
  for(const {e,j} of top){const up=F[vOn('b1')?4:vOn('b2')?3:2][e.i]*k,cl=up>hi,t=e.short+(cl?` · bis ${fmt(up)}`:''),tw=t.length*6.6+8,x=X(j),l=Math.max(m.l+2,Math.min(x-tw/2,W-4-tw));
   const r=rows.findIndex(R=>R.every(([p,q])=>l>q+4||l+tw<p-4));if(r<0)continue;rows[r].push([l,l+tw]);
   o+=`<text x="${f2(l+tw/2)}" y="${m.t+12+r*15}" text-anchor="middle" style="fill:var(--ink);font-size:12px;font-weight:600">${esc(t)}</text>`;
   if(cl)o+=`<path d="M${f2(x-4)} ${m.t+5}l4-5 4 5z" fill="var(--t)"/>`}}
 /* heute */
 if(showNow){o+=`<line x1="${f2(xn)}" x2="${f2(xn)}" y1="${m.t-8}" y2="${base}" stroke="var(--ink)" stroke-dasharray="2 3"/><circle cx="${f2(xn)}" cy="${f2(Y(now))}" r="5" fill="var(--ink)" stroke="var(--sf)" stroke-width="2"/>`;
  const nearR=W-m.r-xn<(sm?70:190);o+=`<text x="${f2(nearR?xn+8:xn-8)}" y="${m.t-16}" text-anchor="${nearR&&!sm?'start':'end'}" style="fill:var(--ink);font-weight:600">heute ${fmt(now*k)}</text>`;
  if(!sm&&!nearR&&b>=T0+5)o+=`<text x="${f2(xn+8)}" y="${m.t-16}" style="fill:var(--t);font-weight:600">Prognose · Median ${fmt(F[2][H-1]*k)}</text>`}
 else if(a>tn)o+=`<text x="${m.l}" y="${m.t-16}" style="fill:var(--t);font-weight:600">Prognose</text>`;
 /* Datumsachse: Monate, bei kleinem Ausschnitt Wochen oder Tage */
 const span=(Q.dt(j1)-Q.dt(j0))/864e5,gap=sm?58:80,ix=[];
 for(let j=Math.max(1,Math.ceil(a));j<=Math.floor(b);j++){const p=Q.dt(j-1),c=Q.dt(j);if(span>110?p.getMonth()!==c.getMonth():span>24?c.getDay()<p.getDay():true)ix.push(j)}
 let lastX=-1e9;for(const j of ix){const x=X(j);if(x<m.l+18||x>W-m.r-18||x-lastX<gap)continue;lastX=x;const dd=Q.dt(j);
  o+=`<text x="${f2(x)}" y="${H2-8}" text-anchor="middle"${j>=T0?' style="fill:var(--t)"':''}>${span>110?dd.toLocaleDateString('de-DE',sm?{month:'short'}:{month:'short',year:'2-digit'}):dd.toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit'})}</text>`}
 /* Fadenkreuz, Auswahlrechteck, Fläche für Maus und Finger */
 o+=`<g id="v-hov" style="pointer-events:none" visibility="hidden"><line y1="${m.t}" y2="${base}" stroke="var(--ink)" stroke-width="1"/><line class="hy" x1="${m.l}" x2="${W-m.r}" stroke="var(--ink)" stroke-width="1" stroke-dasharray="2 3" opacity=".5"/><circle r="5" stroke="var(--sf)" stroke-width="2"/>
  <rect class="py" height="20" rx="4" fill="var(--ink)"/><text class="py" style="fill:var(--on);stroke:none;font-weight:600"></text><rect class="px" height="20" rx="4" fill="var(--ink)"/><text class="px" text-anchor="middle" style="fill:var(--on);stroke:none;font-weight:600"></text></g>`;
 o+=`<rect id="v-br" y="${m.t}" height="${ih}" fill="var(--t)" opacity=".15" stroke="var(--t)" visibility="hidden" style="pointer-events:none"/>`;
 o+=`<rect x="${m.l}" y="${m.t}" width="${iw}" height="${ih+m.b}" fill="transparent" style="cursor:crosshair"/>`;
 s.innerHTML=o;s.querySelectorAll('text:not(.py):not(.px)').forEach(t=>{t.style.paintOrder='stroke';t.style.stroke='var(--sf)';t.style.strokeWidth='4px';t.style.strokeLinejoin='round'});
 s._v={X,Y,a,b,N,T0,H,m,iw,ih,W,H2,base,k,fmt,Q,vis,jOf:x=>a+(x-m.l)/iw*(b-a)};
 const tip=vTip(s);tip.hidden=true;if(s._cur!=null&&s._kb)vShow(s,s._cur);
 if(!s._hov){s._hov=1;vBind(s)}}
function vTip(s){let t=s.parentElement.querySelector('.ctip');if(!t){t=document.createElement('div');t.className='ctip';t.hidden=true;s.parentElement.appendChild(t)}return t}
/* Tooltip und Fadenkreuz für Index j */
function vShow(s,j,evN){const v=s._v,G=s.querySelector('#v-hov');if(!v||!G||!D)return;const d=D,Q=v.Q;j=Math.max(0,Math.min(v.N-1,Math.round(j)));s._cur=j;
 const fut=j>=v.T0,q=j-v.T0,val=Q.val(j),px=v.X(j),py=Math.max(v.m.t,Math.min(v.base,v.Y(val))),dt=Q.dt(j),evs=fut?D.w2.em.list.map((e,n)=>({e,n})).filter(o=>o.e.i===q):[];
 const [lx,ly,c,ry,ty,rx,tx]=G.children;G.setAttribute('visibility','visible');
 lx.setAttribute('x1',px);lx.setAttribute('x2',px);ly.setAttribute('y1',py);ly.setAttribute('y2',py);c.setAttribute('cx',px);c.setAttribute('cy',py);c.setAttribute('fill',fut?'var(--t)':'var(--ink)');
 ty.textContent=v.fmt(val*v.k);const yw=ty.textContent.length*7+12;ry.setAttribute('x',Math.max(2,v.m.l-yw-2));ry.setAttribute('width',yw);ry.setAttribute('y',py-10);ty.setAttribute('x',Math.max(2,v.m.l-yw-2)+6);ty.setAttribute('y',py+4);
 tx.textContent=dt.toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:'2-digit'});const xw=70,xx=Math.max(v.m.l,Math.min(px-xw/2,v.W-v.m.r-xw));rx.setAttribute('x',xx);rx.setAttribute('width',xw);rx.setAttribute('y',v.H2-24);tx.setAttribute('x',xx+xw/2);tx.setAttribute('y',v.H2-9);
 const tip=vTip(s),kE=Q.kE;let h;
 if(!fut){const lv=d.ph.lv[j];h=`<b>${dLong(dt)}</b><span class="lvl">${wIcon(lv)}${WL[lv].n}</span><span>Schwankung <strong>${pc(val,1)}</strong> pro Jahr</span><span>Schlechter Tag bis zu <strong>${eur(val*kE)}</strong></span>`}
 else{const F=Q.F,lv=lvOf(F[2][q]/D.w2.lr);h=`<b>Prognose · ${dLong(dt)}</b><span class="lvl">${wIcon(lv)}${WL[lv].n}</span><span>Median <strong>${pc(F[2][q],1)}</strong> pro Jahr</span><span>Die Hälfte der Zukünfte: ${pc(F[1][q],0)} bis ${pc(F[3][q],0)}</span><span>8 von 10 Zukünften: ${pc(F[0][q],0)} bis ${pc(F[4][q],0)}</span><span>Schlechter Tag bis zu <strong>${eur(F[2][q]*kE)}</strong></span>`+
  evs.map(({e})=>`<span class="ev"><i style="background:var(${e.kind==='earn'?'--g':'--ink'})"></i>${esc(e.label)} · ${e.with?'zusammen mit dem Termin darüber':e.mult<1.05?'kaum Effekt aufs Depot':`Depot ×${nf(e.mult,1)}`}</span>`).join('')}
 tip.innerHTML=h;tip.hidden=false;const tw=tip.offsetWidth,th=tip.offsetHeight,fw=s.clientWidth;
 let lx2=px+16;if(lx2+tw>fw-4)lx2=px-16-tw;if(lx2<4)lx2=Math.max(4,Math.min(fw-tw-4,px-tw/2));
 tip.style.left=lx2+'px';tip.style.top=Math.max(4,Math.min(v.H2-th-34,py-th/2))+'px';
 const n=evN!=null?evN:evs.length?evs[0].n:-1;vHL(n,false)}
function vHide(s){const G=s.querySelector('#v-hov');if(G)G.setAttribute('visibility','hidden');vTip(s).hidden=true;s._cur=null;vHL(-1,false)}
/* Termin in Diagramm und Liste gemeinsam hervorheben */
function vHL(n,fromList){if(n===HLE)return;HLE=n;const s=$('#v-g');
 s.querySelectorAll('.evm').forEach(c=>{const on=+c.dataset.ei===n;c.setAttribute('r',on?6:3.5)});
 s.querySelectorAll('.evl').forEach(l=>{const on=+l.dataset.ei===n;l.setAttribute('opacity',on?.9:.35);l.setAttribute('stroke',on?'var(--ink)':'var(--mut)')});
 $$('#v-ev li[data-ei]').forEach(li=>li.classList.toggle('hl',+li.dataset.ei===n))}
function vBind(s){
 const pos=e=>{const r=s.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top}};
 const pick=x=>{const v=s._v;let j=v.jOf(x),evN=null;const near=v.vis.map(o=>({...o,dx:Math.abs(v.X(o.j)-x)})).filter(o=>o.dx<10).sort((p,q)=>p.dx-q.dx)[0];if(near&&vOn('e')){j=near.j;evN=near.n}return{j,evN}};
 let br=null;
 s.addEventListener('pointerdown',e=>{const {x}=pos(e);s._kb=false;const p=pick(x);vShow(s,p.j,p.evN);
  if(e.pointerType==='mouse'&&e.button===0){br={x0:x,x1:x};s.setPointerCapture(e.pointerId)}});
 s.addEventListener('pointermove',e=>{const {x}=pos(e),v=s._v;s._kb=false;
  if(br){br.x1=Math.max(v.m.l,Math.min(v.m.l+v.iw,x));const R=s.querySelector('#v-br'),l=Math.min(br.x0,br.x1),w=Math.abs(br.x1-br.x0);if(w>4){R.setAttribute('x',l);R.setAttribute('width',w);R.setAttribute('visibility','visible')}}
  const p=pick(x);vShow(s,p.j,p.evN)});
 const end=e=>{if(!br)return;const v=s._v,w=Math.abs(br.x1-br.x0);if(w>8){const p=v.jOf(Math.min(br.x0,br.x1)),q=v.jOf(Math.max(br.x0,br.x1));vHide(s);vSet({a:p,b:q})}br=null;const R=s.querySelector('#v-br');if(R)R.setAttribute('visibility','hidden')};
 s.addEventListener('pointerup',end);s.addEventListener('pointercancel',e=>{br=null;vHide(s)});
 s.addEventListener('pointerleave',e=>{if(e.pointerType==='mouse'&&!br)vHide(s)});
 s.addEventListener('dblclick',()=>{vHide(s);if(!S.vr){S.vr=1;save();vSeg()}vPreset(D,S.vr);vRedraw()});
 /* Trackpad: Pinch zoomt um den Mauszeiger, waagerecht wischen verschiebt */
 s.addEventListener('wheel',e=>{const v=s._v;if(!v)return;const {x}=pos(e),c=v.jOf(x),w=v.b-v.a;
  if(e.ctrlKey){e.preventDefault();const f=Math.exp(e.deltaY*.01),nw=w*f;vSet({a:c-(c-v.a)*nw/w,b:c+(v.b-c)*nw/w})}
  else if(Math.abs(e.deltaX)>Math.abs(e.deltaY)){e.preventDefault();const dj=e.deltaX/v.iw*w;vSet({a:v.a+dj,b:v.b+dj})}},{passive:false});
 /* Tastatur: Pfeile gehen Tag für Tag, + und − zoomen, 0 setzt zurück */
 s.addEventListener('keydown',e=>{const v=s._v;if(!v)return;const w=v.b-v.a,c=s._cur!=null?s._cur:v.T0-1;let used=true;s._kb=true;
  if(e.key==='ArrowLeft'||e.key==='ArrowRight'){const j=Math.max(0,Math.min(v.N-1,c+(e.key==='ArrowLeft'?-1:1)*(e.shiftKey?5:1)));if(j<v.a||j>v.b)vSet({a:j<v.a?j:j-w,b:j<v.a?j+w:j});s._cur=j;vShow(s,j)}
  else if(e.key==='+'||e.key==='=')vSet({a:c-(c-v.a)*.6,b:c+(v.b-c)*.6});
  else if(e.key==='-')vSet({a:c-(c-v.a)/.6,b:c+(v.b-c)/.6});
  else if(e.key==='0'){S.vr=S.vr||1;save();vSeg();vPreset(D,S.vr);vRedraw()}
  else if(e.key==='Home'){s._cur=v.a;vShow(s,Math.ceil(v.a))}else if(e.key==='End'){s._cur=v.b;vShow(s,Math.floor(v.b))}
  else if(e.key==='Escape'){s._kb=false;vHide(s)}else used=false;
  if(used)e.preventDefault()});
 s.addEventListener('blur',()=>{if(s._kb){s._kb=false;vHide(s)}})}
/* Übersicht: ganzer Zeitraum, verschiebbares Fenster mit Griffen */
function navSvg(s,d){const W=s.clientWidth,H2=s.clientHeight;if(!W||!d.w2||!VW)return;const Q=vSer(d),{T0,H,N,past,F}=Q,m={l:4,r:4,t:4,b:4},iw=W-m.l-m.r,ih=H2-m.t-m.b,X=j=>m.l+j/(N-1)*iw;
 let hi=0,lo=Infinity;for(const v of past){hi=Math.max(hi,v);lo=Math.min(lo,v)}for(const v of F[2]){hi=Math.max(hi,v);lo=Math.min(lo,v)}const Y=v=>m.t+(hi-Math.min(hi,v))/(hi-lo||1)*ih,f2=n=>n.toFixed(1);
 const st=Math.max(1,Math.floor(T0/iw));let pts='';for(let j=0;j<T0;j+=st)pts+=f2(X(j))+','+f2(Y(past[j]))+' ';pts+=f2(X(T0-1))+','+f2(Y(past[T0-1]));
 let fp='';for(let i=0;i<H;i++)fp+=f2(X(T0+i))+','+f2(Y(F[2][i]))+' ';
 const xa=X(VW.a),xb=X(VW.b);
 s.innerHTML=`<rect x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" rx="6" fill="var(--sf2)"/><polyline points="${pts}" fill="none" stroke="var(--ink)" stroke-width="1" opacity=".6"/><polyline points="${f2(X(T0-1))},${f2(Y(past[T0-1]))} ${fp}" fill="none" stroke="var(--t)" stroke-width="1.5"/>
 <rect x="${m.l}" y="${m.t}" width="${f2(Math.max(0,xa-m.l))}" height="${ih}" fill="var(--sf)" opacity=".7"/><rect x="${f2(xb)}" y="${m.t}" width="${f2(Math.max(0,m.l+iw-xb))}" height="${ih}" fill="var(--sf)" opacity=".7"/>
 <rect x="${f2(xa)}" y="${m.t}" width="${f2(xb-xa)}" height="${ih}" rx="4" fill="none" stroke="var(--ink)" stroke-width="1.5"/>
 <rect x="${f2(xa-4)}" y="${m.t+ih/2-11}" width="8" height="22" rx="3" fill="var(--ink)"/><rect x="${f2(xb-4)}" y="${m.t+ih/2-11}" width="8" height="22" rx="3" fill="var(--ink)"/>`;
 s._n={X,jOf:x=>(x-m.l)/iw*(N-1),xa,xb};
 if(!s._b){s._b=1;let drag=null;
  const px=e=>e.clientX-s.getBoundingClientRect().left;
  s.addEventListener('pointerdown',e=>{const n=s._n,x=px(e),w=VW.b-VW.a;let mode=Math.abs(x-n.xa)<14?'l':Math.abs(x-n.xb)<14?'r':x>n.xa&&x<n.xb?'m':'c';
   if(mode==='c'){const c=n.jOf(x);vSet({a:c-w/2,b:c+w/2});mode='m'}
   drag={mode,x0:x,a:VW.a,b:VW.b};s.setPointerCapture(e.pointerId);vHide($('#v-g'));e.preventDefault()});
  s.addEventListener('pointermove',e=>{const n=s._n,x=px(e);if(!drag){s.style.cursor=Math.abs(x-n.xa)<14||Math.abs(x-n.xb)<14?'ew-resize':x>n.xa&&x<n.xb?'grab':'pointer';return}
   const dj=n.jOf(x)-n.jOf(drag.x0);if(drag.mode==='m')vSet({a:drag.a+dj,b:drag.b+dj});else if(drag.mode==='l')vSet({a:Math.max(0,Math.min(drag.a+dj,drag.b-10)),b:drag.b});else vSet({a:drag.a,b:Math.min(n.jOf(s.clientWidth-4),Math.max(drag.b+dj,drag.a+10))})});
  const up=()=>{drag=null};s.addEventListener('pointerup',up);s.addEventListener('pointercancel',up)}}
/* VIX-Sparkline über ein Jahr */
function sparkSvg(s,a){const W=s.clientWidth,H2=s.clientHeight;if(!W||!a)return;const lo=Math.min(...a),hi=Math.max(...a),X=i=>4+i/(a.length-1)*(W-8),Y=v=>6+(hi-v)/(hi-lo||1)*(H2-28);
 const pts=a.map((v,i)=>X(i).toFixed(1)+','+Y(v).toFixed(1)).join(' ');
 s.innerHTML=`<polyline points="${pts}" fill="none" stroke="var(--ink)" stroke-width="1.4" stroke-linejoin="round"/><circle cx="${X(a.length-1)}" cy="${Y(a[a.length-1])}" r="3.5" fill="var(--ink)"/><text x="4" y="${H2-2}">vor einem Jahr</text><text x="${W-4}" y="${H2-2}" text-anchor="end">heute</text>`}
function renderWhat(){if(!D)return;const d=D,k=S.wi,cur=d.w[k],x=S.wx??cur,{v:v1,r}=pvar(d,rew(d.w,k,x)),dv=v1-d.pv0;
 $('#wx').value=x;$('#wxo').textContent=`${pc(x,0)} (aktuell ${pc(cur,0)})`;
 $('#b-w').innerHTML=kpi('VaR neu',eur(v1),Math.abs(dv)<1?'unverändert':`${dv>=0?'+':''}${eur(dv)} (parametrisch)`)+kpi('Volatilität neu',pc(r.sd*SQ),`vorher ${pc(d.rk.sd*SQ)}`)+kpi('Risikoanteil',pc(r.share[k],0),`vorher ${pc(d.rk.share[k],0)}`)}
function renderStress(){if(!D)return;const d=D,V=d.V,res=SC.map(s=>shock(d.betas,d.sect,d.w,s.m,s.s)),wi=res.reduce((a,r,i)=>r.p<res[a].p?i:a,0);
 $('#s-h').textContent=`Härtester Fall wäre ${SC[wi].n}: ${eur(res[wi].p*V)} (${pc(res[wi].p,0)}). Ein S&P-500-ETF hätte ${eur(-SC[wi].m*V)} verloren.`;
 const vs=i=>{const x=(res[i].p-SC[i].m)*V;return Math.abs(x)<1?'so viel wie der ETF':`${eur(Math.abs(x))} ${x<0?'mehr':'weniger'} Verlust als der ETF`};
 $('#s-c').innerHTML=SC.map((s,i)=>`<button class="scb" data-i="${i}" aria-pressed="${i===S.sc}"><span>${s.n}</span><b>${eur(res[i].p*V)}</b><span>${pc(res[i].p,0)} · Markt ${pc(s.m,0)}</span><span class="vs">${vs(i)}</span></button>`).join('');
 const r=res[S.sc],it=d.tks.map((_,k)=>({k,l:r.per[k]*d.w[k]*V})).sort((a,b)=>a.l-b.l),mx=Math.max(...it.map(o=>Math.abs(o.l)),1);
 $('#s-dt').textContent=SC[S.sc].n;
 $('#s-r').innerHTML=rowsHtml(it.map(o=>({n:`<span class="tk">${esc(d.tks[o.k])}</span>`,v:Math.abs(o.l),c:o.l<0?'neg':'pos',t:`<b>${o.l>=0?'+':''}${eur(o.l)}</b> · ${pc(r.per[o.k],0)}`})),mx)}
function renderCustom(){if(!D)return;$('#cmo').textContent=pc(S.cm,0);$('#cxo').textContent=(S.cx>=0?'+':'')+pc(S.cx,0);const r=shock(D.betas,D.sect,D.w,S.cm,{[S.cs]:S.cx});
 $('#s-o').innerHTML=kpi('Portfolio',eur(r.p*D.V),pc(r.p,1))+kpi('Markt',pc(S.cm,0),`Beta ${nf(D.beta)}`)}
function renderDepotNote(){$('#dp-now').textContent=D&&S.pf?`Aktuell geladen: ${S.src==='demo'?'Demo-Portfolio':'importiertes Depot'} mit ${S.pf.length} Positionen im Wert von ${eur(D.V)}. Ein neues Demo-Portfolio ersetzt es.`:'';if(!busy)$('#demo-pf').textContent=S.pf?'Neues Demo-Portfolio erstellen':'Demo-Portfolio erstellen'}
function drawAll(){if(!D)return;const d=D,p=page();
 if(p==='portfolio'){lineSvg($('#o-eq'),[{k:'ink',v:d.eq,label:'Portfolio',w:2.4},{k:'g',v:d.ix,label:'S&amp;P 500'}]);
  lineSvg($('#k-dd'),[{k:'bad',v:d.dd}],{area:1,fmt:v=>pc(v,0),mark:{i:d.mddi,v:d.mdd,t:`${pc(d.mdd)} am ${DATES[Math.max(0,d.mddi-1)].toLocaleDateString('de-DE')}`}})}
 if(p==='risiko')histSvg($('#r-g'),d.Lh,d.his.v,d.his.e);
 if(p==='vola'&&d.w2){weatherSvg($('#v-g'),d);navSvg($('#v-nav'),d);if(d.w2.vix)sparkSvg($('#v-sp'),d.w2.vix.spark)}
 }
for(const id of['#o-eq','#r-g','#k-dd','#v-g','#v-sp','#v-nav'])new ResizeObserver(()=>drawAll()).observe($(id));

if(S.vr==null)S.vr=innerWidth<600?3:1;vSeg();
$$('#v-rg button').forEach(b=>b.addEventListener('click',()=>{S.vr=+b.dataset.r;save();vSeg();if(D&&D.w2){vHide($('#v-g'));vPreset(D,S.vr);vRedraw()}}));
const vUn=()=>$$('#v-un button').forEach(x=>x.setAttribute('aria-pressed',x.dataset.u===(S.vu==='e'?'e':'p')));vUn();
$$('#v-un button').forEach(b=>b.addEventListener('click',()=>{S.vu=b.dataset.u;save();vUn();vHide($('#v-g'));vRedraw()}));
const vLg=()=>$$('#v-lg button').forEach(x=>x.setAttribute('aria-pressed',vOn(x.dataset.ly)));vLg();
$$('#v-lg button').forEach(b=>b.addEventListener('click',()=>{const k=b.dataset.ly,h=new Set(S.vh||[]);h.has(k)?h.delete(k):h.add(k);S.vh=[...h];save();vLg();vHide($('#v-g'));vRedraw()}));
{const L=$('#v-ev'),at=e=>e.target.closest&&e.target.closest('li[data-ei]');
 L.addEventListener('mouseover',e=>{const li=at(e);if(li)vHL(+li.dataset.ei,true)});L.addEventListener('mouseleave',()=>vHL(-1,true));
 L.addEventListener('focusin',e=>{const li=at(e);if(li)vHL(+li.dataset.ei,true)});L.addEventListener('focusout',()=>vHL(-1,true));
 L.addEventListener('click',e=>{const li=at(e);if(!li||!D||!D.w2)return;const ev=D.w2.em.list[+li.dataset.ei],j=D.g.sig.length-1+ev.i,s=$('#v-g');if(!s._v)return;if(j<s._v.a||j>s._v.b)vSet({a:j-(s._v.b-s._v.a)/2,b:j+(s._v.b-s._v.a)/2});requestAnimationFrame(()=>requestAnimationFrame(()=>{vShow(s,j,+li.dataset.ei);s.scrollIntoView({block:'nearest',behavior:'smooth'})}))})}
{const mq=matchMedia('(hover:none)'),hint=()=>$('#v-hint').textContent=mq.matches?'Tippen oder wischen zeigt Werte. Unten das Fenster ziehen, um hineinzuzoomen.':'Fahr über das Diagramm für Werte. Bereich aufziehen zum Vergrößern, Doppelklick setzt zurück. Auch mit Tastatur: Pfeile, + und −.';hint();mq.addEventListener('change',hint)}
/* ---------- Depot-Import: Dateien → Spalten erkennen (ggf. zuordnen) → Prüfen → Übernehmen ---------- */
const IMP={files:[],rows:[],seq:0,map:{},tables:[]};
const ACCEPT=['csv','txt','tsv','xlsx','xlsm','pdf','png','jpg','jpeg','webp','heic','heif'],DOCS=['pdf','png','jpg','jpeg','webp','heic','heif'];
const isDoc=f=>DOCS.includes((f.name.split('.').pop()||'').toLowerCase());
const FLD=[['name','Name'],['isin','ISIN'],['ticker','Ticker / Symbol'],['qty','Stückzahl']];
const e2=v=>new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR',minimumFractionDigits:2,maximumFractionDigits:2}).format(v);
const kb=n=>n<1048576?`${Math.max(1,Math.round(n/1024))} KB`:`${(n/1048576).toFixed(1).replace('.',',')} MB`;
const qf=v=>v==null||v===''?'':String(+(+v).toFixed(6)).replace('.',',');
const qp=s=>{const v=parseFloat(String(s).trim().replace(/\s/g,'').replace(/\.(?=\d{3}(\D|$))/g,'').replace(',','.'));return isFinite(v)&&v>0?v:null};
function addFiles(list){$('#imp-err').textContent='';
 for(const f of list){const ext=(f.name.split('.').pop()||'').toLowerCase();
  if(!ACCEPT.includes(ext)){$('#imp-err').textContent=`${f.name}: Dateityp wird nicht unterstützt.`;continue}
  if(f.size>10485760){$('#imp-err').textContent=`${f.name} ist größer als 10 MB.`;continue}
  if(IMP.files.length>=5){$('#imp-err').textContent='Höchstens 5 Dateien auf einmal.';break}
  if(!IMP.files.some(x=>x.name===f.name&&x.size===f.size))IMP.files.push(f)}
 IMP.map={};renderFiles()}
function renderFiles(){$('#imp-list').innerHTML=IMP.files.map((f,i)=>`<li><span>${esc(f.name)}</span><span class="small">${kb(f.size)}</span><button type="button" class="x" data-i="${i}" aria-label="${esc(f.name)} entfernen">×</button></li>`).join('');
 $('#imp-go').disabled=!IMP.files.length||IMP.busy}
async function runImport(){if(!IMP.files.length||IMP.busy)return;IMP.busy=true;$('#imp-err').textContent='';
 const b=$('#imp-go');b.disabled=true;b.classList.add('wait');b.textContent=IMP.files.some(isDoc)?'Gemini liest die Dateien …':'Wird ausgelesen …';
 const mo=$('#map-ok');mo.disabled=true;mo.textContent='Wird geprüft …';
 try{const fd=new FormData();IMP.files.forEach(f=>fd.append('files',f));if(Object.keys(IMP.map).length)fd.append('mapping',JSON.stringify(IMP.map));
  const r=await fetch('/api/import',{method:'POST',body:fd});
  if(r.status===401){location.href='/login';return}
  let d=null;try{d=await r.json()}catch(e){}
  if(!r.ok)throw new Error(d&&typeof d.detail==='string'?d.detail:'Der Server antwortet nicht wie erwartet.');
  IMP.tables=d.tables||[];IMP.warn=d.warnings||[];
  if(d.need_map){openMap();return}
  if($('#map-dlg').open)$('#map-dlg').close();
  IMP.rows=d.rows.map(x=>({id:++IMP.seq,src:x.name_file,isin:x.isin,note:x.note,sym:x.symbol||'',qty:x.quantity,ok:x.ok,reason:x.reason,name:x.name,last:x.last,cur:x.currency,sector:x.sector}));
  IMP.warn=[...IMP.warn,...(d.skipped||[]).map(n=>`„${n}“: keine Stückzahl, übersprungen`)];
  if(!IMP.rows.length&&!IMP.warn.length)IMP.warn=['Keine Wertpapierpositionen gefunden.'];
  openCheck()}
 catch(e){if($('#map-dlg').open)$('#map-err').textContent=e.message;else $('#imp-err').textContent=e.message}
 finally{IMP.busy=false;b.classList.remove('wait');b.textContent='Depot auslesen';mo.disabled=false;mo.textContent='Weiter zur Prüfung';renderFiles()}}
/* Spalten zuordnen: je Datei vier Auswahlfelder plus Vorschau der ersten Zeilen */
function openMap(){$('#map-err').textContent='';renderMap();const c=$('#imp-dlg');if(c.open)c.close();const d=$('#map-dlg');if(!d.open)d.showModal()}
function renderMap(){$('#map-b').innerHTML=IMP.tables.map((t,ti)=>{const m=IMP.map[t.file]||t.mapping,lab={};FLD.forEach(([f,l])=>{if(m[f]!=null)lab[m[f]]=l});
  const sel=FLD.map(([f,l])=>`<label>${l}<select data-t="${ti}" data-f="${f}"><option value="">– keine –</option>${t.columns.map((c,i)=>`<option value="${i}"${m[f]===i?' selected':''}>${esc(c)}</option>`).join('')}</select></label>`).join('');
  const head=t.columns.map((c,i)=>`<th class="${lab[i]?'on':''}">${lab[i]?`<span class="tag">${lab[i]}</span>`:''}${esc(c)}</th>`).join(''),
   body=t.preview.map(r=>`<tr>${r.map((c,i)=>`<td class="${lab[i]?'on':''}">${esc(c)}</td>`).join('')}</tr>`).join('');
  return`<div class="map-f"><h4>${esc(t.file)} <span class="small mut">· ${t.n} Zeilen</span></h4><div class="map-sel">${sel}</div><div class="scroll"><table class="tbl mapt"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div></div>`}).join('')}
function curMap(t){return IMP.map[t.file]||{...t.mapping}}
function confirmMap(){for(const t of IMP.tables){const m=curMap(t);
  if(m.qty==null){$('#map-err').textContent=`${t.file}: Bitte die Spalte mit der Stückzahl wählen.`;return}
  if(m.name==null&&m.isin==null&&m.ticker==null){$('#map-err').textContent=`${t.file}: Bitte Name, ISIN oder Ticker wählen.`;return}
  IMP.map[t.file]=m}
 $('#map-err').textContent='';runImport()}
function openCheck(){renderCheck();const d=$('#imp-dlg');if(!d.open)d.showModal()}
function rowHtml(r){const v=r.ok&&r.qty?r.qty*r.last:null;
 const st=r.checking?'<span class="mut">wird geprüft …</span>':r.ok?`<span class="okk">✓</span> ${esc(r.cur||'')}${r.sector?' · '+esc(r.sector):''}`:`<span class="bad">✗</span> ${esc(r.reason||'nicht geprüft')}`;
 return`<tr data-id="${r.id}" class="${r.ok?'':'no'}"><td class="l nm"><b>${esc(r.src||r.name||'–')}</b>${r.ok&&r.name&&r.name!==r.src?`<span class="small">${esc(r.name)}</span>`:''}${r.note?`<span class="small note">${esc(r.note)}</span>`:''}</td>
 <td class="l" data-l="Yahoo-Symbol"><input class="sym" value="${esc(r.sym)}" aria-label="Yahoo-Symbol" spellcheck="false" autocapitalize="characters"></td>
 <td data-l="Stück"><input class="qty" inputmode="decimal" value="${qf(r.qty)}" aria-label="Stückzahl"></td>
 <td class="hide-s">${r.ok?e2(r.last):'–'}</td><td class="val" data-l="Wert">${v!=null?eur(v):'–'}</td><td class="l st">${st}</td>
 <td class="rm"><button type="button" class="x" aria-label="Zeile entfernen">×</button></td></tr>`}
function renderCheck(){$('#imp-remap').hidden=!IMP.tables.length;$('#imp-t').innerHTML=IMP.rows.map(rowHtml).join('')||'<tr><td colspan="7" class="mut l">Keine Positionen. Mit „Zeile hinzufügen“ manuell ergänzen.</td></tr>';
 $('#imp-warn').innerHTML=(IMP.warn||[]).map(w=>`<li>${esc(w)}</li>`).join('');sumCheck()}
function sumCheck(){const ok=IMP.rows.filter(r=>r.ok&&r.qty>0),tot=ok.reduce((a,r)=>a+r.qty*r.last,0),bad=IMP.rows.length-ok.length;
 $('#imp-sum').textContent=`${IMP.rows.length} Positionen erkannt · ${ok.length} gültig${bad?` · ${bad} mit Problem`:''}`;
 $('#imp-tot').innerHTML=ok.length?`Depotwert <b>${eur(tot)}</b>`:'';
 const busyRow=IMP.rows.some(r=>r.checking),n=new Set(ok.map(r=>r.sym)).size;
 $('#imp-ok').disabled=n<2||busyRow;$('#imp-ok').title=n<2?'Mindestens zwei gültige Positionen nötig':''}
async function recheck(r){r.checking=true;renderCheck();
 try{const [c]=await api('/api/resolve',{items:[{symbol:r.sym||null,isin:null}]});Object.assign(r,{sym:c.symbol||r.sym,ok:c.ok,reason:c.reason,name:c.name,last:c.last,cur:c.currency,sector:c.sector,note:null})}
 catch(e){Object.assign(r,{ok:false,reason:e.message})}
 r.checking=false;renderCheck()}
async function acceptImport(){const m=new Map();
 for(const r of IMP.rows)if(r.ok&&r.qty>0)m.set(r.sym,(m.get(r.sym)||0)+r.qty);
 if(m.size<2)return;const pf=[...m].map(([tk,sh])=>({tk,sh}));
 const ok=$('#imp-ok');ok.disabled=true;ok.textContent='Kurse werden geladen …';
 try{const hd=await api('/api/history',{tickers:pf.map(p=>p.tk)});loadEvents(hd.tickers);
  pf.forEach(p=>p.tk=hd.tickers[pf.indexOf(p)]);
  pf.sort((a,b)=>b.sh*hd.last[hd.tickers.indexOf(b.tk)]-a.sh*hd.last[hd.tickers.indexOf(a.tk)]);
  HD=hd;S.pf=pf;S.src='import';S.wx=null;S.wi=null;S.wauto=true;compute();save();srcLine();
  $('#imp-dlg').close();IMP.files=[];renderFiles();location.hash='portfolio'}
 catch(e){$('#imp-sum').textContent=e.message}
 finally{ok.textContent='Übernehmen';sumCheck()}}
/* Gemini nur, wenn der Server einen Schlüssel hat; Hinweis zum Datenschutz */
async function features(){let g=false;try{g=(await api('/api/features')).gemini}catch(e){}const n=$('#imp-gem');n.hidden=false;
 n.textContent=g?'PDF und Screenshots liest Google Gemini (Gratis-Version). Google darf diese Inhalte zur Verbesserung seiner Produkte nutzen: Schwärze vorher Name, Adresse und Depotnummer.':'PDF und Screenshots sind auf diesem Server nicht eingerichtet. CSV und Excel funktionieren.'}
function bindImport(){features();const fi=$('#imp-f'),dz=$('#imp-drop');
 fi.addEventListener('change',()=>{addFiles(fi.files);fi.value=''});
 ['dragenter','dragover'].forEach(t=>dz.addEventListener(t,e=>{e.preventDefault();dz.classList.add('on')}));
 ['dragleave','drop'].forEach(t=>dz.addEventListener(t,e=>{e.preventDefault();dz.classList.remove('on')}));
 dz.addEventListener('drop',e=>addFiles(e.dataTransfer.files));
 $('#imp-list').addEventListener('click',e=>{const b=e.target.closest('[data-i]');if(!b)return;IMP.files.splice(+b.dataset.i,1);IMP.map={};renderFiles()});
 $('#imp-go').addEventListener('click',runImport);
 const row=e=>IMP.rows.find(r=>r.id===+e.target.closest('tr')?.dataset.id);
 $('#imp-t').addEventListener('change',e=>{const r=row(e);if(!r)return;
  if(e.target.classList.contains('sym')){const v=e.target.value.trim().toUpperCase();if(v!==r.sym){r.sym=v;recheck(r)}}
  if(e.target.classList.contains('qty')){r.qty=qp(e.target.value);renderCheck()}});
 $('#imp-t').addEventListener('click',e=>{if(!e.target.classList.contains('x'))return;const r=row(e);IMP.rows=IMP.rows.filter(x=>x!==r);renderCheck()});
 $('#imp-add').addEventListener('click',()=>{IMP.rows.push({id:++IMP.seq,src:'Neue Position',sym:'',qty:null,ok:false,reason:'Symbol eintragen'});renderCheck();
  const ins=$$('#imp-t .sym');ins[ins.length-1]?.focus()});
 $('#imp-ok').addEventListener('click',acceptImport);
 $('#imp-x').addEventListener('click',()=>$('#imp-dlg').close());
 $('#imp-remap').addEventListener('click',openMap);
 $('#map-b').addEventListener('change',e=>{const s=e.target.closest('select');if(!s)return;const t=IMP.tables[+s.dataset.t],m=curMap(t),v=s.value===''?null:+s.value;
  for(const [f] of FLD)if(f!==s.dataset.f&&m[f]===v&&v!=null)m[f]=null; /* eine Spalte nur einmal */
  m[s.dataset.f]=v;IMP.map[t.file]=m;$('#map-err').textContent='';renderMap()});
 $('#map-ok').addEventListener('click',confirmMap);
 $('#map-x').addEventListener('click',()=>$('#map-dlg').close());
 $('#map-cancel').addEventListener('click',()=>$('#map-dlg').close());
 $('#imp-cancel').addEventListener('click',()=>$('#imp-dlg').close());
 renderFiles()}

/* ---------- Start ---------- */
async function start(){if(!S.pf){showPage();srcLine();return}try{setBusy(true);await loadHist()}catch(e){fail(e)}finally{setBusy(false)}}
if(location.search.includes('debug'))window.CVD=()=>({D,EV,FIT,SIM}); /* nur für Tests */
CV.initMode();bind();bindImport();showPage();start();
})();
