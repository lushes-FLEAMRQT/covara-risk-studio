/* Covara – gemeinsame Bausteine: Mathematik, Formate, Zeichner, Farbmodus */
(() => {
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const root=document.documentElement;
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const RM=matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- Mathematik ---------- */
const rng=seed=>{let a=seed>>>0;return()=>{a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}};
const gen=r=>{let sp=null;return()=>{if(sp!==null){const v=sp;sp=null;return v}let u=0;while(u===0)u=r();const v=r(),m=Math.sqrt(-2*Math.log(u));sp=m*Math.sin(2*Math.PI*v);return m*Math.cos(2*Math.PI*v)}};
const erf=x=>{const t=1/(1+.3275911*Math.abs(x)),y=1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-.284496736)*t+.254829592)*t*Math.exp(-x*x);return x>=0?y:-y};
const Phi=x=>.5*(1+erf(x/Math.SQRT2));
const phi=x=>Math.exp(-x*x/2)/Math.sqrt(2*Math.PI);
function Pinv(p){p=Math.min(Math.max(p,1e-12),1-1e-12);const a=[-39.69683028665376,220.9460984245205,-275.9285104469687,138.357751867269,-30.66479806614716,2.506628277459239],b=[-54.47609879822406,161.5858368580409,-155.6989798598866,66.80131188771972,-13.28068155288572],c=[-.007784894002430293,-.3223964580411365,-2.400758277161838,-2.549732539343734,4.374664141464968,2.938163982698783],d=[.007784695709041462,.3224671290700398,2.445134137142996,3.754408661907416];let q,r;
 if(p<.02425){q=Math.sqrt(-2*Math.log(p));return(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5])/((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1)}
 if(p>.97575){q=Math.sqrt(-2*Math.log(1-p));return-(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5])/((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1)}
 q=p-.5;r=q*q;return(((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q/(((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1)}
function chol(A){const n=A.length,L=A.map(r=>r.map(()=>0));for(let i=0;i<n;i++)for(let j=0;j<=i;j++){let s=A[i][j];for(let k=0;k<j;k++)s-=L[i][k]*L[j][k];if(i===j){if(s<=1e-14)return null;L[i][i]=Math.sqrt(s)}else L[i][j]=s/L[j][j]}return L}
const mean=a=>{let s=0;for(const x of a)s+=x;return s/a.length};
const sd=a=>{const m=mean(a);let s=0;for(const x of a)s+=(x-m)**2;return Math.sqrt(s/(a.length-1))};
const qu=(L,a)=>L[Math.min(L.length-1,Math.floor(a*L.length))];
const es=(L,a)=>{const i=Math.min(L.length-1,Math.floor(a*L.length));let s=0;for(let k=i;k<L.length;k++)s+=L[k];return s/(L.length-i)};
/* Kovarianz und Risikozerlegung (Euler) */
function covM(R){const n=R.length,T=R[0].length,m=R.map(mean),C=[];for(let a=0;a<n;a++)C[a]=[];
 for(let a=0;a<n;a++)for(let b=a;b<n;b++){const ra=R[a],rb=R[b];let s=0;for(let t=0;t<T;t++)s+=(ra[t]-m[a])*(rb[t]-m[b]);C[a][b]=C[b][a]=s/(T-1)}return{C,m}}
function risk(w,C){const n=w.length,mv=new Array(n).fill(0);let v=0;for(let a=0;a<n;a++){for(let b=0;b<n;b++)mv[a]+=C[a][b]*w[b];v+=w[a]*mv[a]}return{v,sd:Math.sqrt(v),mv,share:w.map((x,a)=>v>0?x*mv[a]/v:0)}}
/* Historische Krisen: Marktbewegung S&P 500 (Hoch bis Tief, gerundet) + geschätzter Sektoraufschlag */
const SC=[{n:'Finanzkrise 2008/09',k:'2008',m:-.5,s:{Finanzen:-.25,Immobilien:-.15,'Zykl. Konsum':-.05,Basiskonsum:.2,Gesundheit:.15,Versorger:.1}},
 {n:'Dotcom-Crash 2000–02',k:'2000',m:-.45,s:{Technologie:-.35,Kommunikation:-.25,Basiskonsum:.25,Gesundheit:.15,Energie:.2,Versorger:.1,Immobilien:.15}},
 {n:'Corona-Crash 2020',k:'2020',m:-.34,s:{Energie:-.25,Industrie:-.1,Finanzen:-.08,Immobilien:-.1,Technologie:.1,Kommunikation:.05,Basiskonsum:.1,Gesundheit:.05}},
 {n:'Zinsschock 2022',k:'2022',m:-.25,s:{Technologie:-.1,Kommunikation:-.15,'Zykl. Konsum':-.1,Energie:.6,Versorger:.2,Basiskonsum:.15,Gesundheit:.15,Immobilien:-.05}}];
const shock=(beta,sect,w,m,s)=>{let p=0;const per=w.map((x,k)=>{const r=Math.max(-.95,beta[k]*m+(s[sect[k]]||0));p+=x*r;return r});return{p,per}};

/* ---------- Format ---------- */
const eur=v=>new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(v).replace('-','−');
const ek=v=>Math.abs(v)>=1000?(v/1000).toLocaleString('de-DE',{maximumFractionDigits:Math.abs(v)>=100000?0:1}).replace('-','−')+' Tsd. €':Math.round(v).toLocaleString('de-DE').replace('-','−')+' €';
const pc=(v,d=1)=>(v*100).toLocaleString('de-DE',{maximumFractionDigits:d}).replace('-','−')+' %';
const nf=(v,d=2)=>v.toLocaleString('de-DE',{minimumFractionDigits:d,maximumFractionDigits:d}).replace('-','−');
const nice=(a,b,n)=>{const raw=(b-a)/n||1,st=Math.pow(10,Math.floor(Math.log10(raw))),e=raw/st,step=st*(e>5?10:e>2?5:e>1?2:1),r=[];for(let v=Math.ceil(a/step)*step;v<=b+1e-9;v+=step)r.push(Math.abs(v)<1e-12?0:v);return r};

/* ---------- Zeichner ---------- */
function histSvg(s,L,V,E){const W=s.clientWidth,H2=s.clientHeight;if(!W)return;const lo=L[Math.floor(L.length*.002)],hi=L[Math.floor(L.length*.998)];
 const B=W<520?24:40,bw=(hi-lo)/B,cnt=new Array(B).fill(0);for(const v of L){const k=Math.floor((v-lo)/bw);if(k>=0&&k<B)cnt[k]++}
 const m={l:12,r:12,t:34,b:30},iw=W-m.l-m.r,ih=H2-m.t-m.b,mx=Math.max(...cnt),X=p=>m.l+(p+hi)/(hi-lo)*iw;
 let o=cnt.map((c,k)=>{const l0=lo+k*bw,tl=l0+bw/2>=V,bh=c/mx*ih;return`<rect x="${(X(-(l0+bw))+.5).toFixed(1)}" y="${(m.t+ih-bh).toFixed(1)}" width="${Math.max(1,iw/B-1.5).toFixed(1)}" height="${bh.toFixed(1)}" rx="1.5" fill="var(${tl?'--bad':'--ink'})" opacity="${tl?1:.82}"/>`}).join('');
 o+=nice(-hi,-lo,W<520?3:6).filter(t=>X(t)>m.l+30&&X(t)<W-m.r-30).map(t=>`<text x="${X(t)}" y="${H2-8}" text-anchor="middle">${ek(t)}</text>`).join('');
 o+=`<line x1="${m.l}" x2="${W-m.r}" y1="${m.t+ih+.5}" y2="${m.t+ih+.5}" stroke="var(--ln)"/><line x1="${X(-V)}" x2="${X(-V)}" y1="${m.t-8}" y2="${m.t+ih}" stroke="var(--ink)" stroke-dasharray="4 3"/>`;
 if(E!=null)o+=`<line x1="${X(-E)}" x2="${X(-E)}" y1="${m.t-8}" y2="${m.t+ih}" stroke="var(--bad)"/>`;
 o+=`<text x="${Math.max(m.l,Math.min(X(-V)+6,W-(E!=null?(W<520?150:230):110)))}" y="${m.t-12}"><tspan style="fill:var(--ink)">VaR ${ek(-V)}</tspan>${E!=null?`<tspan dx="10" style="fill:var(--bad)">ES ${ek(-E)}</tspan>`:''}</text>`;
 s.innerHTML=o}
const rowsHtml=(items,mx)=>items.map(it=>`<div class="row"><span>${it.n}</span><span class="trk"><i class="${it.c||''}" style="width:${Math.max(0,Math.min(100,it.v/mx*100))}%"></i>${it.w!=null?`<em style="left:calc(${Math.min(100,it.w/mx*100)}% - 1px)"></em>`:''}</span><span class="rv">${it.t}</span></div>`).join('');

/* ---------- Farbmodus (gilt auf allen Seiten) ---------- */
let saved=null;try{saved=localStorage.getItem('covara-mode')}catch(e){}
const sysMode=()=>matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
function setMode(m){root.dataset.mode=m;$$('.mode button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.m===m));
 const t=m==='dark'?'Hellmodus einschalten':'Dunkelmodus einschalten';$$('.mt').forEach(b=>{b.setAttribute('aria-label',t);b.title=t})}
const keep=m=>{saved=m;try{localStorage.setItem('covara-mode',m)}catch(e){}setMode(m)};
function initMode(){$$('.mode button').forEach(b=>b.addEventListener('click',()=>keep(b.dataset.m)));
 $$('.mt').forEach(b=>b.addEventListener('click',()=>keep(root.dataset.mode==='dark'?'light':'dark')));
 matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{if(!saved)setMode(sysMode())});setMode(saved||sysMode())}
root.dataset.mode=saved||sysMode(); /* vor dem ersten Zeichnen, damit nichts aufblitzt */

window.CV={$,$$,esc,RM,rng,gen,Phi,phi,Pinv,chol,mean,sd,qu,es,covM,risk,SC,shock,eur,ek,pc,nf,nice,histSvg,rowsHtml,initMode};
})();
