import { useState, useRef, useEffect, useCallback } from "react";
import { db } from './db.js';

// ── TEMA ─────────────────────────────────────────────────────────────────────
const L={bg:"#F7F7F5",sb:"#FFFFFF",card:"#FFFFFF",bd:"#E8E8E5",bdl:"#F0F0ED",tx:"#111827",txm:"#6B7280",txs:"#9CA3AF",ac:"#4F46E5",nav:"#F3F3F0",tag:"#F3F3F0",inp:"#FAFAF8",inpb:"#E0E0DC",gr:"#16A34A",rd:"#DC2626",am:"#D97706",bl:"#2563EB"};
const D={bg:"#0F1117",sb:"#13151B",card:"#1A1D26",bd:"#262A36",bdl:"#1E2230",tx:"#F1F0EE",txm:"#6B7280",txs:"#4B5563",ac:"#6366F1",nav:"#1F2230",tag:"#262A36",inp:"#1F2230",inpb:"#363A48",gr:"#22C55E",rd:"#EF4444",am:"#F59E0B",bl:"#60A5FA"};

// ── ASSET DATABASE ────────────────────────────────────────────────────────────
const MKT={"Forex":{unit:"Lotti",assets:["EURUSD","GBPUSD","USDJPY","USDCHF","AUDUSD","NZDUSD","USDCAD","EURGBP","EURJPY","GBPJPY"]},"Indici & Futures":{unit:"Contratti",assets:["NAS100","US500","US30","DAX40","FTSE100","CAC40","ES1!","NQ1!","CL1!","GC1!"]},"Crypto":{unit:"Contratti",assets:["BTCUSD","ETHUSD","SOLUSD","BNBUSD","XRPUSD"]},"Commodities":{unit:"Contratti",assets:["XAUUSD","XAGUSD","USOIL","UKOIL","NATGAS"]}};
const ALL_ASSETS=["EURUSD","GBPUSD","USDJPY","USDCHF","AUDUSD","NZDUSD","USDCAD","EURGBP","EURJPY","GBPJPY","NAS100","US500","US30","DAX40","FTSE100","BTCUSD","ETHUSD","SOLUSD","XAUUSD","XAGUSD","USOIL"];

// ── NAVIGAZIONE ───────────────────────────────────────────────────────────────
const NAVITEMS=[
  {id:"dashboard",label:"Dashboard",icon:"▣",s:null},
  {id:"strategie",label:"Strategie",icon:"◈",s:"TRADING"},
  {id:"conti",label:"Conti",icon:"◎",s:"TRADING"},
  {id:"journal",label:"Journal",icon:"≡",s:"TRADING"},
  {id:"analytics",label:"Analytics",icon:"∿",s:"ANALISI"},
  {id:"ottimizzazione",label:"Ottimizzazione",icon:"⇌",s:"ANALISI"},
  {id:"sim-cap",label:"Sim. Capitale",icon:"▲",s:"ANALISI"},
  {id:"monte-carlo",label:"Monte Carlo",icon:"≈",s:"ANALISI"},
  {id:"backtest",label:"Backtest",icon:"◧",s:"ANALISI"},
  {id:"coach",label:"Coach",icon:"◉",s:"ALTRO"},
  {id:"report",label:"Report",icon:"☰",s:"ALTRO"},
  {id:"impostazioni",label:"Impostazioni",icon:"◌",s:"ALTRO"}
];

// ── CALCOLI CORE ──────────────────────────────────────────────────────────────
function calcR(entry, sl, exit, dir) {
  if(!entry||!sl||!exit) return 0;
  const e=parseFloat(entry), s=parseFloat(sl), x=parseFloat(exit);
  if(isNaN(e)||isNaN(s)||isNaN(x)) return 0;
  const risk=Math.abs(e-s);
  if(risk===0) return 0;
  const pnl=dir==="L"?(x-e):(e-x);
  return parseFloat((pnl/risk).toFixed(2));
}

// Calcola R ponderato tenendo conto dei parziali
// Se ci sono parziali: R_tot = somma(R_parziale * %chiusa) + R_exit * %residua
function calcRConParziali(entry, sl, exit, dir, parziali) {
  if(!parziali||parziali.length===0) return calcR(entry,sl,exit,dir);
  const e=parseFloat(entry), s=parseFloat(sl);
  if(isNaN(e)||isNaN(s)) return calcR(entry,sl,exit,dir);
  const risk=Math.abs(e-s);
  if(risk===0) return 0;
  let totPerc=0;
  let weightedR=0;
  parziali.forEach(function(p){
    const prezzo=parseFloat(p.prezzo);
    const perc=parseFloat(p.percentuale)||0;
    if(!isNaN(prezzo)&&perc>0){
      const pnl=dir==="L"?(prezzo-e):(e-prezzo);
      const r=pnl/risk;
      weightedR+=r*(perc/100);
      totPerc+=perc;
    }
  });
  // residuo chiuso all'exit finale
  const residuo=Math.max(0,100-totPerc);
  if(residuo>0){
    const exitR=calcR(entry,sl,exit,dir);
    weightedR+=exitR*(residuo/100);
  }
  return parseFloat(weightedR.toFixed(2));
}

function calcIntegrityScore(trade){
  let score=0;
  // +50pt inserimento tempestivo (entro 2h dalla chiusura)
  if(trade.created_at&&trade.data_chiusura){
    const diffH=(new Date(trade.created_at)-new Date(trade.data_chiusura))/(1000*60*60);
    if(diffH<=2) score+=50;
    else score+=Math.max(0,50-Math.floor(diffH/6)*10);
  } else {
    score+=25; // nessun created_at → punteggio neutro
  }
  // +30pt dati completi (MAE + MFE + screenshot)
  let dataPoints=0;
  if(trade.mae!=null) dataPoints++;
  if(trade.mfe!=null) dataPoints++;
  if(trade.screenshot_url) dataPoints++;
  score+=Math.round((dataPoints/3)*30);
  // +20pt note psicologiche >50 caratteri
  if(trade.note_psi&&trade.note_psi.length>50) score+=20;
  else if(trade.note_psi&&trade.note_psi.length>10) score+=10;
  return Math.min(100,score);
}

function calcMetrics(trades) {
  if(!trades||trades.length===0) return {total:0,wins:0,losses:0,be:0,wr:0,pf:0,exp:0,avgWin:0,avgLoss:0,maxDD:0,streak:{cur:0,maxW:0,maxL:0},totalR:0};
  const wins=trades.filter(function(t){return t.r_result>0;});
  const losses=trades.filter(function(t){return t.r_result<0;});
  const bes=trades.filter(function(t){return t.r_result===0;});
  const wr=trades.length>0?Math.round((wins.length/trades.length)*100):0;
  const avgWin=wins.length>0?wins.reduce(function(s,t){return s+t.r_result;},0)/wins.length:0;
  const avgLoss=losses.length>0?Math.abs(losses.reduce(function(s,t){return s+t.r_result;},0)/losses.length):0;
  const grossWin=wins.reduce(function(s,t){return s+t.r_result;},0);
  const grossLoss=Math.abs(losses.reduce(function(s,t){return s+t.r_result;},0));
  const pf=grossLoss>0?parseFloat((grossWin/grossLoss).toFixed(2)):grossWin>0?999:0;
  const exp=parseFloat((trades.reduce(function(s,t){return s+t.r_result;},0)/trades.length).toFixed(2));
  const totalR=parseFloat(trades.reduce(function(s,t){return s+t.r_result;},0).toFixed(2));
  // equity curve e drawdown
  let peak=0,maxDD=0,eq=0;
  trades.forEach(function(t){eq+=t.r_result;if(eq>peak)peak=eq;const dd=peak-eq;if(dd>maxDD)maxDD=dd;});
  // streak
  let curW=0,curL=0,maxW=0,maxL=0,cur=0;
  trades.forEach(function(t){
    if(t.r_result>0){curW++;curL=0;if(curW>maxW)maxW=curW;cur=curW;}
    else if(t.r_result<0){curL++;curW=0;if(curL>maxL)maxL=curL;cur=-curL;}
    else{curW=0;curL=0;}
  });
  const integrityScore=trades.length>0?Math.round(trades.reduce(function(s,t){return s+calcIntegrityScore(t);},0)/trades.length):0;
  return {total:trades.length,wins:wins.length,losses:losses.length,be:bes.length,wr,pf,exp,avgWin:parseFloat(avgWin.toFixed(2)),avgLoss:parseFloat(avgLoss.toFixed(2)),maxDD:parseFloat(maxDD.toFixed(2)),streak:{cur,maxW,maxL},totalR,integrityScore};
}

// helper: { conto_id: capitale_iniziale }
function makeCapMap(conti){const m={};(conti||[]).forEach(function(cn){const cap=cn.capitale_iniziale||cn.cap_iniz||0;if(cn.id&&cap>0)m[cn.id]=cap;});return m;}

function buildEquityCurve(trades, capMap) {
  let eqR=0, eqEur=0, eqPct=0;
  return [{i:0,r:0,eur:0,pct:0}].concat(trades.map(function(t,i){
    eqR+=t.r_result;
    const pnl=t.pnl_eur||0;
    eqEur+=pnl;
    const cap=capMap&&capMap[t.conto_id]>0?capMap[t.conto_id]:null;
    const pctTrade=cap?((pnl/cap)*100):0;
    eqPct+=pctTrade;
    return {i:i+1,r:parseFloat(eqR.toFixed(2)),eur:parseFloat(eqEur.toFixed(2)),pct:parseFloat(eqPct.toFixed(2))};
  }));
}

function fmtR(r){return (r>=0?"+":"")+r+"R";}
function fmtDate(iso){if(!iso)return "—";const d=new Date(iso);return d.getDate()+" "+(["Gen","Feb","Mar","Apr","Mag","Giu","Lug","Ago","Set","Ott","Nov","Dic"][d.getMonth()]);}

// ── CALCOLO % CORRETTO ────────────────────────────────────────────────────────
// makeFmtVal: formatta un valore in R / $ / %
// pnlVal = valore monetario singolo o totale
// capVal = capitale di riferimento PER QUEL CONTESTO (usare sempre il capitale corretto)
function makeFmtVal(unit, totalPnl, capConto){
  return function(r, pnlSingolo){
    if(unit==="R") return fmtR(r);
    if(unit==="$"){
      const p=pnlSingolo!=null?pnlSingolo:totalPnl;
      return (p>=0?"+":"")+"$"+Math.abs(p).toFixed(0);
    }
    if(unit==="%"){
      const p=pnlSingolo!=null?pnlSingolo:totalPnl;
      // capConto = capitale del conto corretto passato dal chiamante
      if(capConto>0) return (p>=0?"+":"")+((p/capConto)*100).toFixed(2)+"%";
      return fmtR(r);
    }
    return fmtR(r);
  };
}

// calcPctTrades: calcola la % cumulativa corretta su un array di trade
// usando per ogni trade il capitale del suo conto specifico
function calcTotalPct(trades, capMap){
  let tot=0;
  trades.forEach(function(t){
    const cap=capMap&&capMap[t.conto_id]>0?capMap[t.conto_id]:0;
    if(cap>0) tot+=((t.pnl_eur||0)/cap)*100;
  });
  return parseFloat(tot.toFixed(2));
}

// fmtPct: formatta un numero come percentuale con segno
function fmtPct(v){return (v>=0?"+":"")+v.toFixed(2)+"%";}


function Badge({v,c}){
  if(v>0) return <span style={{color:c.gr,fontWeight:700}}>{fmtR(v)}</span>;
  if(v<0) return <span style={{color:c.rd,fontWeight:700}}>{fmtR(v)}</span>;
  return <span style={{color:c.txm,fontWeight:700}}>0R</span>;
}

function EqChartSVG({curve,c,h=100,unit}){
  if(!curve||curve.length<2) return <div style={{height:h,display:"flex",alignItems:"center",justifyContent:"center",color:c.txm,fontSize:11}}>Nessun dato</div>;
  const W=500; const PAD_L=40; const PAD_B=18;
  // seleziona la serie corretta in base all unit
  function getVal(p){return unit==="$"?p.eur:unit==="%"?p.pct:p.r;}
  const vals=curve.map(getVal);
  const minV=Math.min.apply(null,vals);
  const maxV=Math.max.apply(null,vals);
  const range=maxV-minV||1;
  const chartH=h-PAD_B; const chartW=W-PAD_L;
  const toX=function(i){return PAD_L+((i/(curve.length-1))*chartW);};
  const toY=function(v){return chartH-8-((v-minV)/range)*(chartH-16);};
  const pts=curve.map(function(p,i){return toX(i)+","+toY(getVal(p));}).join(" ");
  const area=toX(0)+","+(chartH-2)+" "+curve.map(function(p,i){return toX(i)+","+toY(getVal(p));}).join(" ")+" "+toX(curve.length-1)+","+(chartH-2);
  const lastVal=vals[vals.length-1];
  const color=lastVal>=0?c.gr:c.rd;
  const midV=parseFloat(((maxV+minV)/2).toFixed(2));
  const suffix=unit==="$"?"$":unit==="%"?"%":"R";
  const fmtLabel=function(v){return unit==="%"?(v>=0?"+":"")+v.toFixed(1)+"%":unit==="$"?(v>=0?"+":"-")+"$"+Math.abs(v).toFixed(0):(v>=0?"+":"")+v+"R";};
  return (
    <svg width="100%" viewBox={"0 0 "+W+" "+h} style={{overflow:"visible"}}>
      <defs><linearGradient id={"eg"+h} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.15"/><stop offset="100%" stopColor={color} stopOpacity="0"/></linearGradient></defs>
      {/* asse Y labels */}
      <text x={PAD_L-3} y={toY(maxV)+3} textAnchor="end" fontSize="8" fill={c.txm}>{fmtLabel(maxV)}</text>
      <text x={PAD_L-3} y={toY(midV)+3} textAnchor="end" fontSize="8" fill={c.txm}>{fmtLabel(midV)}</text>
      <text x={PAD_L-3} y={toY(minV)+3} textAnchor="end" fontSize="8" fill={c.txm}>{fmtLabel(minV)}</text>
      {/* linea zero */}
      {minV<0&&maxV>0&&<line x1={PAD_L} y1={toY(0)} x2={W} y2={toY(0)} stroke={c.bd} strokeWidth="1" strokeDasharray="3,3"/>}
      {/* asse X labels */}
      <text x={toX(0)} y={h-3} textAnchor="middle" fontSize="7" fill={c.txm}>0</text>
      <text x={toX(Math.floor((curve.length-1)/2))} y={h-3} textAnchor="middle" fontSize="7" fill={c.txm}>{Math.floor((curve.length-1)/2)}</text>
      <text x={toX(curve.length-1)} y={h-3} textAnchor="middle" fontSize="7" fill={c.txm}>{curve.length-1}</text>
      <polygon points={area} fill={"url(#eg"+h+")"}/>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round"/>
      <circle cx={toX(curve.length-1)} cy={toY(lastVal)} r="4" fill={color}/>
    </svg>
  );
}

// ── SIDEBAR ───────────────────────────────────────────────────────────────────
function EdgeLabLogo({size=28}){
  return(
    <svg width={size} height={size} viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="elg1" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#6366F1"/>
          <stop offset="100%" stopColor="#4338CA"/>
        </linearGradient>
        <linearGradient id="elg2" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#818CF8"/>
          <stop offset="100%" stopColor="#6366F1"/>
        </linearGradient>
      </defs>
      <polygon points="100,12 178,56 178,144 100,188 22,144 22,56" fill="url(#elg1)" opacity="0.18"/>
      <polygon points="100,12 178,56 178,144 100,188 22,144 22,56" fill="none" stroke="url(#elg1)" strokeWidth="2" opacity="0.55"/>
      <rect x="58" y="68" width="72" height="10" rx="2" fill="url(#elg1)"/>
      <rect x="58" y="95" width="52" height="10" rx="2" fill="url(#elg2)"/>
      <rect x="58" y="122" width="72" height="10" rx="2" fill="url(#elg1)"/>
      <rect x="58" y="68" width="10" height="64" rx="2" fill="url(#elg1)"/>
      <circle cx="148" cy="72" r="6" fill="#818CF8" opacity="0.95"/>
      <circle cx="148" cy="72" r="2.5" fill="#E0E7FF"/>
    </svg>
  );
}

function Sidebar({active,setActive,setScreen,dark,setDark,c,trades,strategie,conti}){
  let lastSection=null;
  const badges={strategie:strategie.length,conti:conti.length,coach:3};
  return (
    <div style={{width:210,minWidth:210,background:c.sb,borderRight:"1px solid "+c.bd,display:"flex",flexDirection:"column",height:"100vh",flexShrink:0}}>
      <div style={{padding:"14px 12px 10px",display:"flex",alignItems:"center",gap:9}}>
        <EdgeLabLogo size={28}/>
        <div>
          <div style={{fontSize:14,fontWeight:800,color:c.tx,letterSpacing:"-0.03em"}}>EdgeLab</div>
          <div style={{fontSize:8,color:c.txm,letterSpacing:"0.06em",textTransform:"uppercase",fontWeight:500,marginTop:1}}>Trade smarter, not harder</div>
        </div>
      </div>
      <div style={{padding:"0 9px 10px"}}>
        <button onClick={function(){setScreen("form");setActive("");}} style={{width:"100%",padding:"7px 12px",background:"linear-gradient(135deg,#4F46E5,#7C3AED)",border:"none",borderRadius:8,color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:5}}>
          <span style={{fontSize:15}}>+</span> Nuovo Trade
        </button>
      </div>
      <div style={{height:1,background:c.bd,margin:"0 9px"}}/>
      <nav style={{flex:1,padding:"6px",overflowY:"auto"}}>
        {NAVITEMS.map(function(item){
          const isA=active===item.id;
          const showSection=item.s&&item.s!==lastSection;
          if(item.s) lastSection=item.s;
          const badge=badges[item.id];
          return (
            <div key={item.id}>
              {showSection&&<div style={{fontSize:8,fontWeight:700,color:c.txs,letterSpacing:"0.1em",padding:"7px 8px 2px"}}>{item.s}</div>}
              <button onClick={function(){setActive(item.id);setScreen(item.id);}} style={{display:"flex",alignItems:"center",gap:7,width:"100%",padding:"6px 9px",borderRadius:6,border:"none",cursor:"pointer",textAlign:"left",background:isA?c.nav:"transparent",color:isA?c.tx:c.txm,fontSize:12,fontFamily:"inherit",fontWeight:isA?600:400,marginBottom:1}}>
                <span style={{fontSize:11}}>{item.icon}</span>
                <span style={{flex:1}}>{item.label}</span>
                {badge>0&&<span style={{fontSize:9,fontWeight:700,padding:"1px 5px",borderRadius:20,background:isA?c.ac+"18":c.tag,color:isA?c.ac:c.txm}}>{badge}</span>}
              </button>
            </div>
          );
        })}
      </nav>
      <div style={{padding:"8px 12px",borderTop:"1px solid "+c.bd,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div style={{display:"flex",alignItems:"center",gap:7}}>
          <div style={{width:26,height:26,borderRadius:"50%",background:"linear-gradient(135deg,#4F46E5,#7C3AED)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,color:"#fff"}}>M</div>
          <div><div style={{fontSize:11,fontWeight:600,color:c.tx}}>Marco</div><div style={{fontSize:9,color:c.txm}}>{trades.length} trade</div></div>
        </div>
        <button onClick={function(){setDark(!dark);}} style={{width:26,height:26,borderRadius:6,border:"1px solid "+c.bd,background:c.tag,cursor:"pointer",fontSize:12,color:c.txm,display:"flex",alignItems:"center",justifyContent:"center"}}>{dark?"☀":"☾"}</button>
      </div>
    </div>
  );
}

// ── DASHBOARD ─────────────────────────────────────────────────────────────────
function Dashboard({c,setScreen,trades,strategie,conti}){
  const [selConti,setSelConti]=useState([]);
  const [selStrat,setSelStrat]=useState([]);
  const [unit,setUnit]=useState("R");
  function toggleC(id){setSelConti(function(p){return p.includes(id)?p.filter(function(x){return x!==id;}):[...p,id];});}
  function toggleS(id){setSelStrat(function(p){return p.includes(id)?p.filter(function(x){return x!==id;}):[...p,id];});}
  const filtered=trades.filter(function(t){
    if(selConti.length>0&&!selConti.includes(t.conto_id)) return false;
    if(selStrat.length>0&&!selStrat.includes(t.strategia_id)) return false;
    return true;
  });
  const metrics=calcMetrics(filtered);
  const capMap=makeCapMap(conti);
  const curve=buildEquityCurve(filtered,capMap);
  const totalPnl=filtered.reduce(function(s,t){return s+(t.pnl_eur||0);},0);
  // % corretta: somma di (pnl_trade/cap_conto_trade) per ogni trade
  const totalPct=calcTotalPct(filtered,capMap);
  const pctPerTrade=filtered.length>0?(totalPct/filtered.length):0;
  const recent=filtered.slice().sort(function(a,b){return new Date(b.data_apertura)-new Date(a.data_apertura);}).slice(0,5);
  const stratStats=strategie.map(function(s){
    const st=filtered.filter(function(t){return t.strategia_id===s.id;});
    const m=calcMetrics(st);
    const stPnl=st.reduce(function(sum,t){return sum+(t.pnl_eur||0);},0);
    const stPct=calcTotalPct(st,capMap);
    return {...s,_trades:st.length,_wr:m.wr,_pf:m.pf,_r:m.totalR,_pnl:stPnl,_pct:stPct};
  }).filter(function(s){return s._trades>0;});
  // capConto usato solo per DD%: prendiamo il capitale totale dei conti filtrati
  const capConto=conti.filter(function(cn){return selConti.length===0||selConti.includes(cn.id);}).reduce(function(s,cn){return s+(cn.capitale_iniziale||cn.cap_iniz||0);},0);
  // fmtVal: per R e $ usa logica precedente; per % usa totalPct direttamente
  function fmtVal(r, pnlSingolo, pctSingolo){
    if(unit==="R") return fmtR(r);
    if(unit==="$"){const p=pnlSingolo!=null?pnlSingolo:totalPnl;return (p>=0?"+":"")+"$"+Math.abs(p).toFixed(0);}
    if(unit==="%"){const p=pctSingolo!=null?pctSingolo:totalPct;return fmtPct(p);}
    return fmtR(r);
  }
  // ONBOARDING
  const isNew=trades.length===0&&strategie.length===0&&conti.length===0;
  if(isNew) return(
    <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:40,gap:0}}>
      <div style={{fontSize:36,marginBottom:16}}>⚡</div>
      <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:12,justifyContent:"center"}}>
              <EdgeLabLogo size={44}/>
              <div style={{textAlign:"left"}}>
                <div style={{fontSize:26,fontWeight:800,letterSpacing:"-0.04em",color:c.tx}}>EdgeLab</div>
                <div style={{fontSize:9,color:"#6366F1",letterSpacing:"0.12em",textTransform:"uppercase",fontWeight:600}}>Trade smarter, not harder</div>
              </div>
            </div>
      <div style={{fontSize:13,color:c.txm,textAlign:"center",maxWidth:420,marginBottom:32,lineHeight:1.7}}>Il tuo laboratorio personale per analizzare, ottimizzare e migliorare il tuo trading. Segui questi 3 passi per iniziare.</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:14,width:"100%",maxWidth:640,marginBottom:28}}>
        {[{n:"1",icon:"◈",t:"Crea una Strategia",d:"Definisci le regole del tuo setup con checklist personalizzata.",btn:"Vai alle Strategie",sc:"strategie",col:"#4F46E5"},{n:"2",icon:"◎",t:"Aggiungi un Conto",d:"Reale, Demo o Prop Firm. Collegalo alla tua strategia.",btn:"Vai ai Conti",sc:"conti",col:"#0F766E"},{n:"3",icon:"≡",t:"Inserisci il primo Trade",d:"Con entry, SL, exit e opzionalmente MAE/MFE per le analytics.",btn:"Nuovo Trade",sc:"form",col:"#D97706"}].map(function(step){return(
          <div key={step.n} style={{background:c.card,borderRadius:14,padding:"20px 18px",border:"1px solid "+c.bd,display:"flex",flexDirection:"column",gap:8}}>
            <div style={{width:32,height:32,borderRadius:8,background:step.col+"15",border:"1px solid "+step.col+"40",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:800,color:step.col}}>{step.n}</div>
            <div style={{fontSize:13,fontWeight:700,marginTop:4}}>{step.t}</div>
            <div style={{fontSize:11,color:c.txm,lineHeight:1.6,flex:1}}>{step.d}</div>
            <button onClick={function(){setScreen(step.sc);}} style={{padding:"7px 0",borderRadius:8,background:step.col,border:"none",color:"#fff",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit",marginTop:4}}>{step.btn}</button>
          </div>
        );})}
      </div>
      <div style={{fontSize:10,color:c.txm}}>Puoi sempre tornare qui dalla sidebar. I tuoi dati sono salvati localmente nel browser.</div>
    </div>
  );
  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{padding:"11px 20px",borderBottom:"1px solid "+c.bd,display:"flex",alignItems:"center",justifyContent:"space-between",background:c.sb,flexShrink:0}}>
        <div><div style={{fontSize:15,fontWeight:700,letterSpacing:"-0.02em"}}>Dashboard</div><div style={{fontSize:10,color:c.txm,marginTop:1}}>{new Date().toLocaleDateString("it-IT",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}</div></div>
        <div style={{display:"flex",gap:2,background:c.tag,borderRadius:8,padding:2}}>
          {["R","$","%"].map(function(u){return <button key={u} onClick={function(){setUnit(u);}} style={{padding:"4px 10px",borderRadius:6,border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:11,fontWeight:unit===u?700:400,background:unit===u?c.ac:"transparent",color:unit===u?"#fff":c.txm}}>{u}</button>;})}
        </div>
      </div>
      {/* FILTRI */}
      <div style={{padding:"8px 20px",borderBottom:"1px solid "+c.bd,background:c.sb,display:"flex",gap:14,flexShrink:0,flexWrap:"wrap"}}>
        <div style={{display:"flex",gap:5,flexWrap:"wrap",alignItems:"center"}}>
          <span style={{fontSize:9,fontWeight:700,color:c.txm,marginRight:2}}>CONTO</span>
          {conti.map(function(cn){const s=selConti.includes(cn.id);return <button key={cn.id} onClick={function(){toggleC(cn.id);}} style={{padding:"3px 9px",borderRadius:20,border:"1px solid "+(s?c.ac:c.bd),background:s?c.ac+"15":"transparent",color:s?c.ac:c.txm,fontSize:11,fontWeight:s?700:400,cursor:"pointer",fontFamily:"inherit"}}>{cn.nome}</button>;})}
        </div>
        <div style={{width:1,background:c.bd}}/>
        <div style={{display:"flex",gap:5,flexWrap:"wrap",alignItems:"center"}}>
          <span style={{fontSize:9,fontWeight:700,color:c.txm,marginRight:2}}>STRATEGIA</span>
          {strategie.map(function(s){const sel=selStrat.includes(s.id);return <button key={s.id} onClick={function(){toggleS(s.id);}} style={{padding:"3px 9px",borderRadius:20,border:"1px solid "+(sel?c.ac:c.bd),background:sel?c.ac+"15":"transparent",color:sel?c.ac:c.txm,fontSize:11,fontWeight:sel?700:400,cursor:"pointer",fontFamily:"inherit"}}>{s.nome}</button>;})}
        </div>
        {(selConti.length>0||selStrat.length>0)&&<button onClick={function(){setSelConti([]);setSelStrat([]);}} style={{padding:"3px 9px",borderRadius:20,border:"1px solid "+c.bd,background:"transparent",color:c.txm,fontSize:10,cursor:"pointer",fontFamily:"inherit"}}>✕ Reset</button>}
      </div>
      <div style={{flex:1,overflow:"auto",padding:"14px 20px"}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:8,marginBottom:12}}>
          {(function(){
            // DD in %: calcola il max drawdown cumulativo sulla curva %
            const ddCurve=curve.map(function(p){return p.pct;});
            let peak=0,maxDDpct=0;
            ddCurve.forEach(function(v){if(v>peak)peak=v;const dd=peak-v;if(dd>maxDDpct)maxDDpct=dd;});
            maxDDpct=parseFloat(maxDDpct.toFixed(2));
            return [
              {l:"P/L Totale",v:fmtVal(metrics.totalR,totalPnl,totalPct),col:metrics.totalR>=0?c.gr:c.rd,tt:"Il tuo risultato complessivo nel periodo selezionato. In R misura quante unità di rischio hai guadagnato — è la misura più affidabile perché non dipende dalla size. In € o $ è il guadagno monetario reale. In % è il rendimento sul capitale del conto. Se è positivo stai guadagnando, se è negativo stai perdendo capitale reale."},
              {l:"Win Rate",v:metrics.wr+"%",col:metrics.wr>=50?c.gr:c.rd,tt:"La percentuale dei tuoi trade che si chiudono in profitto. Un numero alto sembra positivo, ma può ingannare: puoi avere un win rate del 70% e perdere soldi se le tue perdite sono molto più grandi delle vincite. Un win rate del 40% può essere ottimo se ogni vincita vale 3 volte ogni perdita. Guardalo sempre insieme all'expectancy e al profit factor per avere un quadro completo."},
              {l:"Profit Factor",v:metrics.pf,col:metrics.pf>=1.5?c.gr:metrics.pf>=1?c.am:c.rd,tt:"Il profit factor ti dice quanti euro guadagni per ogni euro che perdi, in totale. Se è 2.0 significa che per ogni 1€ perso ne guadagni 2€ — la strategia è profittevole. Sopra 1.5 è considerato buono. Sotto 1.0 significa che stai perdendo complessivamente. È una delle metriche più importanti perché sintetizza in un numero solo se la tua strategia ha un edge reale."},
              {l:"Expectancy",v:fmtVal(metrics.exp,totalPnl/Math.max(filtered.length,1),pctPerTrade),col:metrics.exp>=0?c.gr:c.rd,tt:"L'expectancy è il guadagno medio che puoi aspettarti da ogni singolo trade, tenendo conto sia di quando vinci sia di quando perdi. È la metrica più importante per valutare una strategia a lungo termine: un'expectancy positiva significa che più trade fai, più guadagni in media. Un'expectancy di +0.5R significa che ogni trade che apri, in media, ti porta mezzo R di profitto — anche considerando le perdite."},
              {l:"Max Drawdown",v:unit==="R"?"-"+metrics.maxDD+"R":unit==="%"?"-"+maxDDpct+"%":"-$"+(capConto>0?(metrics.maxDD/metrics.totalR*Math.abs(totalPnl)).toFixed(0):metrics.maxDD),col:c.rd,tt:"Il drawdown massimo mostra la perdita più grande che hai subito dal punto più alto del tuo conto fino al punto più basso successivo, prima di recuperare. È la misura del 'peggior momento' che hai vissuto. Un drawdown grande mette a dura prova la psicologia e può portarti a smettere troppo presto o a fare errori. Sapere qual è il tuo drawdown massimo storico ti aiuta a capire quanto devi essere resiliente per seguire la strategia."},
              {l:"Integrity Score",v:metrics.integrityScore+"/100",col:metrics.integrityScore>=70?c.gr:metrics.integrityScore>=40?c.am:c.rd,tt:"L'Integrity Score misura quanto sono completi e affidabili i dati che inserisci per ogni trade. Un punteggio alto (70+) significa che hai MAE/MFE compilati, note dettagliate e screenshot allegati — questo rende le analisi di ottimizzazione e le simulazioni molto più accurate. Un punteggio basso significa che stai lasciando campi vuoti e le analisi avanzate (ottimizzazione TP, simulazioni) non possono lavorare correttamente."},
            ];
          })().map(function(m,i){return(
            <div key={i} style={{background:c.card,borderRadius:10,padding:"11px 13px",border:"1px solid "+c.bd}}>
              <div style={{fontSize:8,color:c.txm,fontWeight:600,letterSpacing:"0.05em",marginBottom:4,display:"flex",alignItems:"center",gap:2}}>{m.l.toUpperCase()}<Tooltip text={m.tt} c={c}/></div>
              <div style={{fontSize:17,fontWeight:700,color:m.col,letterSpacing:"-0.03em",lineHeight:1}}>{m.v}</div>
            </div>
          );})}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 280px",gap:10,marginBottom:10}}>
          <div style={{background:c.card,borderRadius:12,padding:"14px 16px",border:"1px solid "+c.bd}}>
            <div style={{fontSize:12,fontWeight:700,marginBottom:10,display:"flex",alignItems:"center",gap:4}}>Equity Curve<Tooltip c={c} text="Mostra come cresce (o scende) il tuo capitale trade dopo trade. Una curva che sale costantemente verso destra indica una strategia solida. Picchi e valli brusche indicano alta volatilità dei risultati. Il drawdown è la distanza dal massimo raggiunto fino al punto più basso successivo — più è profondo, più è difficile psicologicamente e finanziariamente da sostenere."/></div>
            <EqChartSVG curve={curve} c={c} h={100} unit={unit}/>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            <div style={{background:c.card,borderRadius:12,padding:"12px 14px",border:"1px solid "+c.bd,flex:1}}>
              <div style={{fontSize:11,fontWeight:700,marginBottom:8}}>Per Strategia</div>
              {stratStats.length===0&&<div style={{fontSize:10,color:c.txm}}>Nessun dato</div>}
              {stratStats.map(function(s,i){return(
                <div key={s.id} style={{marginBottom:i<stratStats.length-1?8:0}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
                    <span style={{fontSize:11,fontWeight:600}}>{s.nome}</span>
                    <span style={{fontSize:11,fontWeight:700,color:s._r>=0?c.gr:c.rd}}>{fmtVal(s._r,s._pnl,s._pct||0)}</span>
                  </div>
                  <div style={{height:3,borderRadius:2,background:c.bd}}><div style={{height:"100%",width:Math.min(s._wr,100)+"%",background:s._wr>=50?c.gr:c.rd,borderRadius:2}}/></div>
                  <div style={{fontSize:9,color:c.txm,marginTop:2}}>WR {s._wr}% · {s._trades} trade</div>
                  {i<stratStats.length-1&&<div style={{height:1,background:c.bd,margin:"6px 0"}}/>}
                </div>
              );})}
            </div>
          </div>
        </div>
        <div style={{background:c.card,borderRadius:12,padding:"14px 16px",border:"1px solid "+c.bd}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
            <div style={{fontSize:12,fontWeight:700}}>Ultimi Trade</div>
            <span onClick={function(){setScreen("journal");}} style={{fontSize:10,color:c.ac,cursor:"pointer",fontWeight:500}}>Journal →</span>
          </div>
          {recent.length===0&&<div style={{fontSize:11,color:c.txm}}>Nessun trade ancora</div>}
          {recent.map(function(t,i){
            const strat=strategie.find(function(s){return s.id===t.strategia_id;});
            return(
              <div key={t.id} style={{display:"flex",alignItems:"center",gap:8,padding:"7px 0",borderBottom:i<recent.length-1?"1px solid "+c.bdl:"none"}}>
                <div style={{width:22,height:22,borderRadius:4,fontSize:8,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",background:t.direzione==="L"?c.gr+"18":c.rd+"18",color:t.direzione==="L"?c.gr:c.rd,border:"1px solid "+(t.direzione==="L"?c.gr+"44":c.rd+"44"),flexShrink:0}}>{t.direzione==="L"?"▲":"▼"}</div>
                <div style={{flex:1}}><div style={{fontSize:11,fontWeight:600}}>{t.asset}</div><div style={{fontSize:9,color:c.txm}}>{fmtDate(t.data_apertura)}{strat?" · "+strat.nome:""}</div></div>
                <div style={{textAlign:"right"}}>
                  <Badge v={t.r_result} c={c}/>
                  {t.pnl_eur!=null&&unit==="$"&&<div style={{fontSize:9,color:t.pnl_eur>=0?c.gr:c.rd}}>{t.pnl_eur>=0?"+":""}${Math.abs(t.pnl_eur).toFixed(0)}</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── STRATEGIE ─────────────────────────────────────────────────────────────────
function Strategie({c,strategie,reload}){
  const [modal,setModal]=useState(false);
  const [editing,setEditing]=useState(null);
  const [confirmDel,setConfirmDel]=useState(null);
  const emptyForm=function(){return {nome:"",stato:"Attiva",tf:"M15",mercati:[],checklist:{bias:[],trigger:[],contesto:[],gestione:[]},note:""};};
  const [form,setForm]=useState(emptyForm());
  const [assetQ,setAssetQ]=useState("");
  const [assetOpen,setAssetOpen]=useState(false);
  const assetRef=useRef(null);
  const filteredAssets=ALL_ASSETS.filter(function(a){return a.toLowerCase().includes(assetQ.toLowerCase())&&!form.mercati.includes(a);});
  useEffect(function(){
    function fn(e){if(assetRef.current&&!assetRef.current.contains(e.target))setAssetOpen(false);}
    document.addEventListener("mousedown",fn);
    return function(){document.removeEventListener("mousedown",fn);};
  },[]);
  function openNew(){setForm(emptyForm());setEditing(null);setAssetQ("");setModal(true);}
  function openEdit(s){setForm({nome:s.nome,stato:s.stato,tf:s.tf,mercati:[...(s.mercati||[])],checklist:{bias:[...(s.checklist?.bias||[])],trigger:[...(s.checklist?.trigger||[])],contesto:[...(s.checklist?.contesto||[])],gestione:[...(s.checklist?.gestione||[])]},note:s.note||""});setEditing(s.id);setAssetQ("");setModal(true);}
  async function save(){
    if(!form.nome.trim()) return;
    if(editing){await db.strategie.update(editing,{...form});}
    else{await db.strategie.add({...form,data:new Date().toLocaleDateString("it-IT")});}
    await reload();setModal(false);
  }
  async function del(id){await db.strategie.delete(id);await reload();setConfirmDel(null);}
  function addCkItem(cat){setForm({...form,checklist:{...form.checklist,[cat]:[...form.checklist[cat],""]}});}
  function setCkItem(cat,idx,val){const arr=[...form.checklist[cat]];arr[idx]=val;setForm({...form,checklist:{...form.checklist,[cat]:arr}});}
  function removeCkItem(cat,idx){const arr=form.checklist[cat].filter(function(_,i){return i!==idx;});setForm({...form,checklist:{...form.checklist,[cat]:arr}});}
  const statoCol={"Attiva":c.gr,"In pausa":c.am,"Archiviata":c.txm};
  const CK_CATS=[{k:"bias",l:"BIAS"},{k:"trigger",l:"TRIGGER"},{k:"contesto",l:"CONTESTO"},{k:"gestione",l:"GESTIONE"}];
  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{padding:"12px 20px",borderBottom:"1px solid "+c.bd,display:"flex",alignItems:"center",justifyContent:"space-between",background:c.sb,flexShrink:0}}>
        <div><div style={{fontSize:15,fontWeight:700,letterSpacing:"-0.02em"}}>Strategie</div><div style={{fontSize:10,color:c.txm}}>{strategie.length} strategie</div></div>
        <button onClick={openNew} style={{padding:"7px 14px",background:"linear-gradient(135deg,#4F46E5,#7C3AED)",border:"none",borderRadius:8,color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>+ Nuova Strategia</button>
      </div>
      <div style={{flex:1,overflow:"auto",padding:"16px 20px"}}>
        {strategie.length===0&&<div style={{textAlign:"center",padding:"60px",color:c.txm,fontSize:13}}>Nessuna strategia. Creane una per iniziare!</div>}
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>
          {strategie.map(function(s){return(
            <div key={s.id} style={{background:c.card,borderRadius:12,padding:"16px",border:"1px solid "+c.bd}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                <div style={{flex:1}}>
                  <div style={{fontSize:14,fontWeight:700,marginBottom:6}}>{s.nome}</div>
                  <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:4}}>
                    {(s.mercati||[]).slice(0,4).map(function(m){return <span key={m} style={{fontSize:9,fontWeight:600,padding:"2px 6px",borderRadius:20,background:c.ac+"15",color:c.ac}}>{m}</span>;})}
                  </div>
                  <span style={{fontSize:9,fontWeight:600,padding:"2px 6px",borderRadius:20,background:c.tag,color:c.txm}}>{s.tf||"—"}</span>
                </div>
                <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4}}>
                  <div style={{padding:"2px 8px",borderRadius:20,background:(statoCol[s.stato]||c.txm)+"15"}}>
                    <span style={{fontSize:9,fontWeight:700,color:statoCol[s.stato]||c.txm}}>{s.stato}</span>
                  </div>
                  <div style={{display:"flex",gap:4}}>
                    <button onClick={function(){openEdit(s);}} style={{padding:"3px 8px",borderRadius:5,border:"1px solid "+c.bd,background:"transparent",color:c.txm,fontSize:10,cursor:"pointer",fontFamily:"inherit"}}>✏</button>
                    <button onClick={function(){setConfirmDel(s.id);}} style={{padding:"3px 8px",borderRadius:5,border:"1px solid "+c.rd+"40",background:c.rd+"08",color:c.rd,fontSize:10,cursor:"pointer",fontFamily:"inherit"}}>✕</button>
                  </div>
                </div>
              </div>
              <div style={{fontSize:9,color:c.txs,marginTop:4}}>Creata il {s.data||"—"}</div>
            </div>
          );})}
        </div>
      </div>
      {confirmDel&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:600,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:c.card,borderRadius:12,padding:"24px",width:320,boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}}>
            <div style={{fontSize:15,fontWeight:700,marginBottom:8}}>Elimina Strategia</div>
            <div style={{fontSize:12,color:c.txm,marginBottom:20}}>Sei sicuro? Questa azione non può essere annullata.</div>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button onClick={function(){setConfirmDel(null);}} style={{padding:"8px 16px",borderRadius:8,border:"1px solid "+c.bd,background:"transparent",color:c.txm,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Annulla</button>
              <button onClick={function(){del(confirmDel);}} style={{padding:"8px 16px",borderRadius:8,background:c.rd,border:"none",color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>Elimina</button>
            </div>
          </div>
        </div>
      )}
      {modal&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={function(){setModal(false);}}>
          <div style={{background:c.card,borderRadius:14,padding:"24px",width:600,maxHeight:"88vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}} onClick={function(e){e.stopPropagation();}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <div style={{fontSize:16,fontWeight:700}}>{editing?"Modifica Strategia":"Nuova Strategia"}</div>
              <button onClick={function(){setModal(false);}} style={{width:28,height:28,borderRadius:7,border:"1px solid "+c.bd,background:c.tag,cursor:"pointer",fontSize:16,color:c.txm,display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:14}}>
              <div style={{gridColumn:"1/3"}}>
                <div style={{fontSize:10,fontWeight:600,color:c.txm,marginBottom:5}}>NOME *</div>
                <input value={form.nome} onChange={function(e){setForm({...form,nome:e.target.value});}} placeholder="es. Momentum BOS" style={{width:"100%",padding:"9px 12px",borderRadius:8,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:13,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
              </div>
              <div>
                <div style={{fontSize:10,fontWeight:600,color:c.txm,marginBottom:5}}>STATO</div>
                <select value={form.stato} onChange={function(e){setForm({...form,stato:e.target.value});}} style={{width:"100%",padding:"9px 12px",borderRadius:8,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:12,fontFamily:"inherit",outline:"none",cursor:"pointer"}}>
                  {["Attiva","In pausa","Archiviata"].map(function(s){return <option key={s}>{s}</option>;})}
                </select>
              </div>
            </div>
            <div style={{marginBottom:14}}>
              <div style={{fontSize:10,fontWeight:600,color:c.txm,marginBottom:5}}>TIMEFRAME</div>
              <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                {["M1","M5","M15","M30","H1","H4","D1"].map(function(t){return(
                  <button key={t} onClick={function(){setForm({...form,tf:t});}} style={{padding:"5px 10px",borderRadius:6,border:"1px solid "+(form.tf===t?c.ac:c.bd),background:form.tf===t?c.ac+"12":"transparent",color:form.tf===t?c.ac:c.txm,fontSize:11,cursor:"pointer",fontFamily:"inherit",fontWeight:form.tf===t?700:400}}>{t}</button>
                );})}
              </div>
            </div>
            <div style={{marginBottom:14}} ref={assetRef}>
              <div style={{fontSize:10,fontWeight:600,color:c.txm,marginBottom:5}}>ASSET / MERCATI</div>
              <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:6}}>
                {form.mercati.map(function(a){return(
                  <div key={a} style={{display:"flex",alignItems:"center",gap:4,padding:"3px 8px",borderRadius:20,background:c.ac+"15",border:"1px solid "+c.ac+"30"}}>
                    <span style={{fontSize:10,fontWeight:600,color:c.ac}}>{a}</span>
                    <button onClick={function(){setForm({...form,mercati:form.mercati.filter(function(x){return x!==a;})});}} style={{width:12,height:12,borderRadius:"50%",border:"none",background:"transparent",color:c.ac,cursor:"pointer",fontSize:10,lineHeight:1,padding:0}}>×</button>
                  </div>
                );})}
              </div>
              <div style={{position:"relative"}}>
                <input value={assetQ} onChange={function(e){setAssetQ(e.target.value);setAssetOpen(true);}} onFocus={function(){setAssetOpen(true);}} placeholder="Cerca asset..." style={{width:"100%",padding:"8px 12px",borderRadius:8,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:12,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
                {assetOpen&&(
                  <div style={{position:"absolute",top:"calc(100% + 3px)",left:0,right:0,zIndex:300,background:c.card,border:"1px solid "+c.bd,borderRadius:8,boxShadow:"0 8px 24px rgba(0,0,0,0.12)",maxHeight:150,overflowY:"auto"}}>
                    {filteredAssets.slice(0,12).map(function(a){return <div key={a} onClick={function(){setForm({...form,mercati:[...form.mercati,a]});setAssetQ("");setAssetOpen(false);}} style={{padding:"6px 12px",cursor:"pointer",fontSize:12,color:c.tx}} onMouseEnter={function(e){e.currentTarget.style.background=c.tag;}} onMouseLeave={function(e){e.currentTarget.style.background="transparent";}}>{a}</div>;})}
                    {assetQ&&!ALL_ASSETS.includes(assetQ.toUpperCase())&&<div onClick={function(){setForm({...form,mercati:[...form.mercati,assetQ.toUpperCase()]});setAssetQ("");setAssetOpen(false);}} style={{padding:"6px 12px",cursor:"pointer",fontSize:11,color:c.ac,borderTop:"1px solid "+c.bd}}>+ Aggiungi "{assetQ.toUpperCase()}"</div>}
                  </div>
                )}
              </div>
            </div>
            <div style={{marginBottom:14}}>
              <div style={{fontSize:10,fontWeight:600,color:c.txm,marginBottom:8}}>CHECKLIST</div>
              <div style={{fontSize:9,color:c.txm,marginBottom:10,padding:"6px 10px",borderRadius:7,background:c.ac+"08",border:"1px solid "+c.ac+"20"}}>Aggiungi i punti che appariranno come checkbox durante l'inserimento trade.</div>
              {CK_CATS.map(function(cat){return(
                <div key={cat.k} style={{marginBottom:12}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
                    <span style={{fontSize:10,fontWeight:700,color:c.ac,letterSpacing:"0.06em"}}>{cat.l}</span>
                    <button onClick={function(){addCkItem(cat.k);}} style={{fontSize:10,color:c.ac,background:"transparent",border:"none",cursor:"pointer",fontFamily:"inherit",fontWeight:600}}>+ Aggiungi</button>
                  </div>
                  {form.checklist[cat.k].length===0&&<div style={{fontSize:10,color:c.txs,padding:"6px 8px",borderRadius:6,background:c.bg,border:"1px dashed "+c.bd}}>Nessun punto.</div>}
                  {form.checklist[cat.k].map(function(item,idx){return(
                    <div key={idx} style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
                      <span style={{fontSize:10,color:c.txm,flexShrink:0}}>☐</span>
                      <input value={item} onChange={function(e){setCkItem(cat.k,idx,e.target.value);}} placeholder="Descrivi il punto..." style={{flex:1,padding:"6px 9px",borderRadius:6,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:11,fontFamily:"inherit",outline:"none"}}/>
                      <button onClick={function(){removeCkItem(cat.k,idx);}} style={{width:20,height:20,borderRadius:4,border:"1px solid "+c.rd+"40",background:c.rd+"08",color:c.rd,fontSize:10,cursor:"pointer",fontFamily:"inherit",flexShrink:0}}>✕</button>
                    </div>
                  );})}
                </div>
              );})}
            </div>
            <div style={{marginBottom:20}}>
              <div style={{fontSize:10,fontWeight:600,color:c.txm,marginBottom:5}}>NOTE GENERALI</div>
              <textarea value={form.note} onChange={function(e){setForm({...form,note:e.target.value});}} placeholder="Logica della strategia, quando usarla..." style={{width:"100%",height:80,padding:"9px 12px",borderRadius:8,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:12,fontFamily:"inherit",resize:"vertical",outline:"none",boxSizing:"border-box"}}/>
            </div>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button onClick={function(){setModal(false);}} style={{padding:"8px 16px",borderRadius:8,border:"1px solid "+c.bd,background:"transparent",color:c.txm,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Annulla</button>
              <button onClick={save} style={{padding:"8px 20px",borderRadius:8,background:"linear-gradient(135deg,#4F46E5,#7C3AED)",border:"none",color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>Salva</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── CONTI ─────────────────────────────────────────────────────────────────────
function Conti({c,conti,strategie,trades,reload}){
  const [modal,setModal]=useState(false);
  const [editing,setEditing]=useState(null);
  const [confirmDel,setConfirmDel]=useState(null);
  const emptyForm=function(){return {nome:"",tipo:"Reale",broker:"",valuta:"EUR",cap_iniz:"",stato:"Attivo",strats:[]};};
  const [form,setForm]=useState(emptyForm());
  function openNew(){setForm(emptyForm());setEditing(null);setModal(true);}
  function openEdit(cn){setForm({nome:cn.nome,tipo:cn.tipo,broker:cn.broker||"",valuta:cn.valuta||"EUR",cap_iniz:cn.cap_iniz,stato:cn.stato,strats:cn.strats||[]});setEditing(cn.id);setModal(true);}
  async function save(){
    if(!form.nome.trim()) return;
    const cap=parseFloat(form.cap_iniz)||0;
    if(editing){await db.conti.update(editing,{...form,cap_iniz:cap});}
    else{await db.conti.add({...form,cap_iniz:cap});}
    await reload();setModal(false);
  }
  async function del(id){await db.conti.delete(id);await reload();setConfirmDel(null);}
  function toggleStrat(id){const s=form.strats.includes(id)?form.strats.filter(function(x){return x!==id;}):[...form.strats,id];setForm({...form,strats:s});}
  const tipoCol={"Reale":c.gr,"Demo":c.bl,"Prop Firm":c.am,"Backtest":c.txm};
  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{padding:"12px 20px",borderBottom:"1px solid "+c.bd,display:"flex",alignItems:"center",justifyContent:"space-between",background:c.sb,flexShrink:0}}>
        <div><div style={{fontSize:15,fontWeight:700,letterSpacing:"-0.02em"}}>Conti</div><div style={{fontSize:10,color:c.txm}}>{conti.length} conti</div></div>
        <button onClick={openNew} style={{padding:"7px 14px",background:"linear-gradient(135deg,#4F46E5,#7C3AED)",border:"none",borderRadius:8,color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>+ Nuovo Conto</button>
      </div>
      <div style={{flex:1,overflow:"auto",padding:"16px 20px"}}>
        {conti.length===0&&<div style={{textAlign:"center",padding:"60px",color:c.txm,fontSize:13}}>Nessun conto. Creane uno per iniziare!</div>}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
          {conti.map(function(cn){
            const contoTrades=trades.filter(function(t){return t.conto_id===cn.id;});
            const m=calcMetrics(contoTrades);
            const pnl_r=m.totalR;
            const stratNames=strategie.filter(function(s){return (cn.strats||[]).includes(s.id);}).map(function(s){return s.nome;});
            return(
              <div key={cn.id} style={{background:c.card,borderRadius:12,padding:"16px",border:"1px solid "+c.bd}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
                  <div>
                    <div style={{fontSize:15,fontWeight:700,marginBottom:4}}>{cn.nome}</div>
                    <div style={{display:"flex",gap:6,alignItems:"center"}}>
                      <span style={{fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:20,background:(tipoCol[cn.tipo]||c.txm)+"15",color:tipoCol[cn.tipo]||c.txm}}>{cn.tipo}</span>
                      <span style={{fontSize:10,color:c.txm}}>{cn.broker||"—"} · {cn.valuta||"EUR"}</span>
                    </div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontSize:18,fontWeight:700,color:c.tx}}>{cn.valuta||"$"}{(cn.cap_iniz||0).toLocaleString()}</div>
                    <div style={{fontSize:11,color:pnl_r>=0?c.gr:c.rd,fontWeight:600}}>{fmtR(pnl_r)}</div>
                  </div>
                </div>
                <div style={{height:1,background:c.bd,marginBottom:10}}/>
                <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:10}}>
                  {[{l:"Trade",v:contoTrades.length},{l:"Win Rate",v:m.wr+"%"},{l:"Profit Factor",v:m.pf}].map(function(mm,i){return(
                    <div key={i} style={{background:c.bg,borderRadius:7,padding:"8px 10px"}}>
                      <div style={{fontSize:8,color:c.txm,fontWeight:600,marginBottom:2}}>{mm.l}</div>
                      <div style={{fontSize:12,fontWeight:700,color:c.tx}}>{mm.v}</div>
                    </div>
                  );})}
                </div>
                {stratNames.length>0&&(
                  <div style={{marginBottom:10}}>
                    <div style={{fontSize:9,color:c.txm,fontWeight:600,marginBottom:4}}>STRATEGIE</div>
                    <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                      {stratNames.map(function(sn){return <span key={sn} style={{fontSize:10,padding:"2px 8px",borderRadius:20,background:c.ac+"12",color:c.ac}}>{sn}</span>;})}
                    </div>
                  </div>
                )}
                <div style={{display:"flex",gap:7}}>
                  <button onClick={function(){openEdit(cn);}} style={{flex:1,padding:"6px",borderRadius:7,border:"1px solid "+c.bd,background:"transparent",color:c.txm,fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>✏ Modifica</button>
                  <button onClick={function(){setConfirmDel(cn.id);}} style={{padding:"6px 12px",borderRadius:7,border:"1px solid "+c.rd+"40",background:c.rd+"08",color:c.rd,fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>Elimina</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {confirmDel&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:600,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:c.card,borderRadius:12,padding:"24px",width:320,boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}}>
            <div style={{fontSize:15,fontWeight:700,marginBottom:8}}>Elimina Conto</div>
            <div style={{fontSize:12,color:c.txm,marginBottom:20}}>Sei sicuro?</div>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button onClick={function(){setConfirmDel(null);}} style={{padding:"8px 16px",borderRadius:8,border:"1px solid "+c.bd,background:"transparent",color:c.txm,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Annulla</button>
              <button onClick={function(){del(confirmDel);}} style={{padding:"8px 16px",borderRadius:8,background:c.rd,border:"none",color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>Elimina</button>
            </div>
          </div>
        </div>
      )}
      {modal&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={function(){setModal(false);}}>
          <div style={{background:c.card,borderRadius:14,padding:"24px",width:480,maxHeight:"85vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}} onClick={function(e){e.stopPropagation();}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <div style={{fontSize:16,fontWeight:700}}>{editing?"Modifica Conto":"Nuovo Conto"}</div>
              <button onClick={function(){setModal(false);}} style={{width:28,height:28,borderRadius:7,border:"1px solid "+c.bd,background:c.tag,cursor:"pointer",fontSize:16,color:c.txm,display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
              <div style={{gridColumn:"1/-1"}}><div style={{fontSize:10,fontWeight:600,color:c.txm,marginBottom:5}}>NOME *</div><input value={form.nome} onChange={function(e){setForm({...form,nome:e.target.value});}} placeholder="es. Live EUR" style={{width:"100%",padding:"9px 12px",borderRadius:8,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:13,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/></div>
              <div><div style={{fontSize:10,fontWeight:600,color:c.txm,marginBottom:5}}>TIPO</div><select value={form.tipo} onChange={function(e){setForm({...form,tipo:e.target.value});}} style={{width:"100%",padding:"9px 12px",borderRadius:8,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:12,fontFamily:"inherit",outline:"none",cursor:"pointer"}}>{["Reale","Demo","Prop Firm","Backtest"].map(function(t){return <option key={t}>{t}</option>;})}</select></div>
              <div><div style={{fontSize:10,fontWeight:600,color:c.txm,marginBottom:5}}>VALUTA</div><input value={form.valuta} onChange={function(e){setForm({...form,valuta:e.target.value});}} placeholder="EUR" style={{width:"100%",padding:"9px 12px",borderRadius:8,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:12,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/></div>
              <div><div style={{fontSize:10,fontWeight:600,color:c.txm,marginBottom:5}}>BROKER</div><input value={form.broker} onChange={function(e){setForm({...form,broker:e.target.value});}} placeholder="es. IC Markets" style={{width:"100%",padding:"9px 12px",borderRadius:8,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:12,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/></div>
              <div><div style={{fontSize:10,fontWeight:600,color:c.txm,marginBottom:5}}>CAPITALE INIZIALE</div><input value={form.cap_iniz} onChange={function(e){setForm({...form,cap_iniz:e.target.value});}} placeholder="es. 10000" type="number" style={{width:"100%",padding:"9px 12px",borderRadius:8,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:12,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/></div>
              <div><div style={{fontSize:10,fontWeight:600,color:c.txm,marginBottom:5}}>STATO</div><select value={form.stato} onChange={function(e){setForm({...form,stato:e.target.value});}} style={{width:"100%",padding:"9px 12px",borderRadius:8,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:12,fontFamily:"inherit",outline:"none",cursor:"pointer"}}>{["Attivo","Chiuso","Archiviato"].map(function(s){return <option key={s}>{s}</option>;})}</select></div>
            </div>
            {strategie.length>0&&(
              <div style={{marginBottom:16}}>
                <div style={{fontSize:10,fontWeight:600,color:c.txm,marginBottom:8}}>STRATEGIE ASSOCIATE</div>
                {strategie.map(function(s){const sel=form.strats.includes(s.id);return(
                  <div key={s.id} onClick={function(){toggleStrat(s.id);}} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 10px",borderRadius:8,cursor:"pointer",background:sel?c.ac+"10":"transparent",border:"1px solid "+(sel?c.ac+"40":c.bd),marginBottom:5}}>
                    <div style={{width:16,height:16,borderRadius:3,border:"2px solid "+(sel?c.ac:c.bd),background:sel?c.ac:"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{sel&&<span style={{color:"#fff",fontSize:10,fontWeight:700}}>✓</span>}</div>
                    <span style={{fontSize:12,fontWeight:sel?600:400,color:sel?c.ac:c.tx}}>{s.nome}</span>
                  </div>
                );})}
              </div>
            )}
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button onClick={function(){setModal(false);}} style={{padding:"8px 16px",borderRadius:8,border:"1px solid "+c.bd,background:"transparent",color:c.txm,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Annulla</button>
              <button onClick={save} style={{padding:"8px 20px",borderRadius:8,background:"linear-gradient(135deg,#4F46E5,#7C3AED)",border:"none",color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>Salva</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── TRADE FORM ────────────────────────────────────────────────────────────────
function TradeForm({c,strategie,conti,reload,setScreen}){
  const [tab,setTab]=useState("main");
  const [saving,setSaving]=useState(false);
  const [form,setForm]=useState({conto_id:"",strategia_id:"",asset:"",mkt:"",direzione:"L",data_apertura:"",data_chiusura:"",entry:"",exit:"",sl:"",tp:"",size:"",mae:"",mfe:"",commissioni:"",pnl_eur:"",screenshot_url:"",note_tec:"",note_psi:"",mood:"",sc_esecuzione:null,sc_complessivo:null,tags:[]});
  const [ck,setCk]=useState({});
  const [hasParz,setHasParz]=useState(false);
  const [parz,setParz]=useState([{size:"",percentuale:"",prezzo:"",data:"",be:false}]);
  const [assetOpen,setAssetOpen]=useState(false);
  const [assetQ,setAssetQ]=useState(form.asset||"");
  const assetRef=useRef(null);
  const MOODS=["😌 Calmo","😐 Neutro","😰 Ansioso","😤 Frustrato","😵 Euforico","😴 Stanco"];
  const TABS=[{k:"main",l:"Dati Trade",n:"1"},{k:"parziali",l:"Parziali",n:"2"},{k:"journal",l:"Journal Emotivo",n:"3"}];
  const stratObj=strategie.find(function(s){return s.id===parseInt(form.strategia_id);});
  const ckItems=stratObj?[...(stratObj.checklist?.bias||[]),...(stratObj.checklist?.trigger||[]),...(stratObj.checklist?.contesto||[]),...(stratObj.checklist?.gestione||[])]:[];
  const r_result=calcR(form.entry,form.sl,form.exit,form.direzione);
  const contoObj=conti.find(function(cn){return cn.id===parseInt(form.conto_id);});
  const mktAssets=form.mkt?MKT[form.mkt].assets:[];
  const filteredA=mktAssets.filter(function(a){return a.toLowerCase().includes(assetQ.toLowerCase());});
  useEffect(function(){
    function fn(e){if(assetRef.current&&!assetRef.current.contains(e.target))setAssetOpen(false);}
    document.addEventListener("mousedown",fn);
    return function(){document.removeEventListener("mousedown",fn);};
  },[]);
  async function save(){
    // Validazione completa
    const e=parseFloat(form.entry), s=parseFloat(form.sl), x=parseFloat(form.exit);
    const errors=[];
    if(!form.conto_id) errors.push("Seleziona un conto");
    if(!form.asset) errors.push("Seleziona un asset");
    if(!form.entry||isNaN(e)) errors.push("Entry non valida");
    if(!form.sl||isNaN(s)) errors.push("Stop Loss non valido");
    if(!form.exit||isNaN(x)) errors.push("Exit non valida");
    if(!isNaN(e)&&!isNaN(s)){
      if(form.direzione==="L"&&s>=e) errors.push("Long: lo Stop Loss deve essere SOTTO l'entry ("+e+")");
      if(form.direzione==="S"&&s<=e) errors.push("Short: lo Stop Loss deve essere SOPRA l'entry ("+e+")");
    }
    if(!isNaN(e)&&!isNaN(x)&&form.tp){
      const tp=parseFloat(form.tp);
      if(!isNaN(tp)){
        if(form.direzione==="L"&&tp<=e) errors.push("Long: il Take Profit deve essere SOPRA l'entry");
        if(form.direzione==="S"&&tp>=e) errors.push("Short: il Take Profit deve essere SOTTO l'entry");
      }
    }
    if(hasParz){
      const totPerc=parz.filter(function(p){return p.prezzo&&p.percentuale;}).reduce(function(sum,p){return sum+parseFloat(p.percentuale||0);},0);
      if(totPerc>100) errors.push("Le percentuali dei parziali superano il 100% (attuale: "+totPerc.toFixed(0)+"%)");
    }
    if(errors.length>0){alert("⚠ Controlla i seguenti campi:\n\n• "+errors.join("\n• "));return;}
    setSaving(true);
    const parzialiValidi=hasParz?parz.filter(function(p){return p.prezzo&&p.percentuale;}):[];
    const r=calcRConParziali(form.entry,form.sl,form.exit,form.direzione,parzialiValidi);
    const tradeData={
      conto_id:parseInt(form.conto_id),
      strategia_id:form.strategia_id?parseInt(form.strategia_id):null,
      asset:form.asset,
      direzione:form.direzione,
      data_apertura:form.data_apertura||new Date().toISOString(),
      data_chiusura:form.data_chiusura||new Date().toISOString(),
      entry:parseFloat(form.entry),
      exit:parseFloat(form.exit),
      sl:parseFloat(form.sl),
      tp:form.tp?parseFloat(form.tp):null,
      size:form.size?parseFloat(form.size):null,
      mae:form.mae?parseFloat(form.mae):null,
      mfe:form.mfe?parseFloat(form.mfe):null,
      commissioni:form.commissioni?parseFloat(form.commissioni):0,
      pnl_eur:form.pnl_eur?parseFloat(form.pnl_eur):null,
      screenshot_url:form.screenshot_url||"",
      r_result:r,
      note_tec:form.note_tec||"",
      note_psi:form.note_psi||"",
      mood:form.mood||"",
      sc_esecuzione:form.sc_esecuzione,
      sc_complessivo:form.sc_complessivo,
      tags:form.tags||[],
      checklist:ck,
      parziali:hasParz?parz:[],
      created_at:new Date().toISOString(),
      draft:false,
    };
    await db.trade.add(tradeData);
    await reload();
    setSaving(false);
    setScreen("journal");
  }
  async function saveDraft(){
    if(!form.asset||!form.direzione){alert("⚠ Per la bozza servono almeno Asset e Direzione.");return;}
    const draftData={
      conto_id:form.conto_id?parseInt(form.conto_id):null,
      strategia_id:form.strategia_id?parseInt(form.strategia_id):null,
      asset:form.asset,
      direzione:form.direzione,
      data_apertura:form.data_apertura||new Date().toISOString(),
      data_chiusura:form.data_chiusura||new Date().toISOString(),
      entry:null,exit:null,sl:null,tp:null,size:null,mae:null,mfe:null,
      commissioni:0,pnl_eur:null,screenshot_url:"",r_result:0,
      note_tec:form.note_tec||"",note_psi:"",mood:form.mood||"",
      sc_esecuzione:null,sc_complessivo:null,tags:form.tags||[],
      checklist:{},parziali:[],
      created_at:new Date().toISOString(),
      draft:true,
    };
    await db.trade.add(draftData);
    await reload();
    setScreen("journal");
  }
  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{padding:"11px 20px",borderBottom:"1px solid "+c.bd,display:"flex",alignItems:"center",justifyContent:"space-between",background:c.sb,flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <button onClick={function(){setScreen("dashboard");}} style={{padding:"4px 9px",borderRadius:6,border:"1px solid "+c.bd,background:"transparent",color:c.txm,fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>← Indietro</button>
          <div><div style={{fontSize:14,fontWeight:700}}>Nuovo Trade</div></div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <button onClick={saveDraft} style={{padding:"7px 14px",borderRadius:7,background:c.am+"18",border:"1px solid "+c.am+"40",color:c.am,fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
            📋 Salva Bozza
          </button>
          <button onClick={save} disabled={saving} style={{padding:"7px 18px",borderRadius:7,background:saving?"#6366F180":"linear-gradient(135deg,#4F46E5,#7C3AED)",border:"none",color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
            {saving?"Salvataggio...":"💾 Salva Trade"}
          </button>
        </div>
      </div>
      <div style={{padding:"8px 20px",background:c.sb,borderBottom:"1px solid "+c.bd,display:"flex",alignItems:"center",gap:4,flexShrink:0}}>
        {TABS.map(function(t){const a=tab===t.k;return(
          <button key={t.k} onClick={function(){setTab(t.k);}} style={{display:"flex",alignItems:"center",gap:6,padding:"6px 14px",borderRadius:8,border:"none",cursor:"pointer",fontFamily:"inherit",background:a?"linear-gradient(135deg,#4F46E5,#7C3AED)":"transparent",color:a?"#fff":c.txm,fontSize:12,fontWeight:a?600:400}}>
            <span style={{width:18,height:18,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:700,background:a?"rgba(255,255,255,0.3)":c.tag,color:a?"#fff":c.txs,flexShrink:0}}>{t.n}</span>
            {t.l}
          </button>
        );})}
      </div>
      <div style={{flex:1,overflow:"auto",padding:"16px 20px"}}>
        {tab==="main"&&(
          <div style={{maxWidth:780}}>
            <div style={{background:c.card,borderRadius:11,padding:"13px 15px",border:"1px solid "+c.bd,marginBottom:10}}>
              <div style={{fontSize:9,fontWeight:700,color:c.txm,marginBottom:8,letterSpacing:"0.08em"}}>STEP 1 — CONTO & STRATEGIA</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div>
                  <div style={{fontSize:10,fontWeight:600,color:c.txm,marginBottom:4}}>CONTO *</div>
                  <select value={form.conto_id} onChange={function(e){setForm({...form,conto_id:e.target.value});}} style={{width:"100%",padding:"8px 10px",borderRadius:7,border:"1px solid "+(form.conto_id?c.gr+"60":c.inpb),background:c.inp,color:c.tx,fontSize:12,fontFamily:"inherit",outline:"none",cursor:"pointer"}}>
                    <option value="">Seleziona conto...</option>
                    {conti.map(function(cn){return <option key={cn.id} value={cn.id}>{cn.nome}</option>;})}
                  </select>
                </div>
                <div>
                  <div style={{fontSize:10,fontWeight:600,color:c.txm,marginBottom:4}}>STRATEGIA</div>
                  <select value={form.strategia_id} onChange={function(e){setForm({...form,strategia_id:e.target.value});setCk({});}} style={{width:"100%",padding:"8px 10px",borderRadius:7,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:12,fontFamily:"inherit",outline:"none",cursor:"pointer"}}>
                    <option value="">Nessuna strategia</option>
                    {strategie.map(function(s){return <option key={s.id} value={s.id}>{s.nome}</option>;})}
                  </select>
                </div>
              </div>
            </div>
            <div style={{background:c.card,borderRadius:11,padding:"13px 15px",border:"1px solid "+c.bd,marginBottom:10}}>
              <div style={{fontSize:9,fontWeight:700,color:c.txm,marginBottom:8,letterSpacing:"0.08em"}}>STEP 2 — STRUMENTO</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:8}}>
                <div>
                  <div style={{fontSize:10,fontWeight:600,color:c.txm,marginBottom:4}}>MERCATO</div>
                  <select value={form.mkt} onChange={function(e){setForm({...form,mkt:e.target.value,asset:""});setAssetQ("");}} style={{width:"100%",padding:"8px 10px",borderRadius:7,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:12,fontFamily:"inherit",outline:"none",cursor:"pointer"}}>
                    <option value="">Seleziona mercato...</option>
                    {Object.keys(MKT).map(function(m){return <option key={m} value={m}>{m}</option>;})}
                  </select>
                </div>
                <div ref={assetRef} style={{position:"relative"}}>
                  <div style={{fontSize:10,fontWeight:600,color:c.txm,marginBottom:4}}>ASSET *</div>
                  <input value={assetQ} onChange={function(e){setAssetQ(e.target.value);setForm({...form,asset:e.target.value.toUpperCase()});setAssetOpen(true);}} onFocus={function(){setAssetOpen(true);}} placeholder={form.mkt?"Cerca...":"Prima scegli mercato"} disabled={!form.mkt} style={{width:"100%",padding:"8px 10px",borderRadius:7,border:"1px solid "+(form.asset?c.gr+"60":c.inpb),background:form.mkt?c.inp:c.tag,color:c.tx,fontSize:12,fontFamily:"inherit",outline:"none",boxSizing:"border-box",opacity:form.mkt?1:0.6}}/>
                  {assetOpen&&form.mkt&&filteredA.length>0&&(
                    <div style={{position:"absolute",top:"calc(100% + 3px)",left:0,right:0,zIndex:200,background:c.card,border:"1px solid "+c.bd,borderRadius:8,boxShadow:"0 8px 24px rgba(0,0,0,0.12)",maxHeight:150,overflowY:"auto"}}>
                      {filteredA.map(function(a){return <div key={a} onClick={function(){setAssetQ(a);setForm({...form,asset:a});setAssetOpen(false);}} style={{padding:"7px 11px",cursor:"pointer",fontSize:12,color:c.tx}} onMouseEnter={function(e){e.currentTarget.style.background=c.tag;}} onMouseLeave={function(e){e.currentTarget.style.background="transparent";}}>{a}</div>;})}
                    </div>
                  )}
                </div>
              </div>
              <div style={{marginBottom:8}}>
                <div style={{fontSize:10,fontWeight:600,color:c.txm,marginBottom:5}}>DIREZIONE *</div>
                <div style={{display:"flex",gap:8}}>
                  {[{v:"L",l:"▲ Long"},{v:"S",l:"▼ Short"}].map(function(d){return(
                    <button key={d.v} onClick={function(){setForm({...form,direzione:d.v});}} style={{flex:1,padding:"8px",borderRadius:8,border:"2px solid "+(form.direzione===d.v?(d.v==="L"?c.gr:c.rd):c.bd),background:form.direzione===d.v?(d.v==="L"?c.gr+"12":c.rd+"12"):"transparent",cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:700,color:form.direzione===d.v?(d.v==="L"?c.gr:c.rd):c.txm}}>{d.l}</button>
                  );})}
                </div>
              </div>
            </div>
            <div style={{background:c.card,borderRadius:11,padding:"13px 15px",border:"1px solid "+c.bd,marginBottom:10}}>
              <div style={{fontSize:9,fontWeight:700,color:c.txm,marginBottom:8,letterSpacing:"0.08em"}}>STEP 3 — PREZZI & TIMING</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
                <div><div style={{fontSize:10,fontWeight:600,color:c.txm,marginBottom:3}}>DATA/ORA APERTURA</div><input type="datetime-local" value={form.data_apertura} onChange={function(e){setForm({...form,data_apertura:e.target.value});}} style={{width:"100%",padding:"8px 10px",borderRadius:7,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:12,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/></div>
                <div><div style={{fontSize:10,fontWeight:600,color:c.txm,marginBottom:3}}>DATA/ORA CHIUSURA</div><input type="datetime-local" value={form.data_chiusura} onChange={function(e){setForm({...form,data_chiusura:e.target.value});}} style={{width:"100%",padding:"8px 10px",borderRadius:7,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:12,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/></div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8}}>
                {[{l:"ENTRY *",k:"entry"},{l:"STOP LOSS *",k:"sl"},{l:"TAKE PROFIT",k:"tp"},{l:"EXIT *",k:"exit"},{l:"SIZE",k:"size"}].map(function(f){return(
                  <div key={f.k}><div style={{fontSize:10,fontWeight:600,color:c.txm,marginBottom:3}}>{f.l}</div><input value={form[f.k]} onChange={function(e){setForm({...form,[f.k]:e.target.value});}} placeholder="0.00000" style={{width:"100%",padding:"8px 10px",borderRadius:7,border:"1px solid "+(f.k!=="tp"&&f.k!=="size"&&form[f.k]?c.gr+"60":c.inpb),background:c.inp,color:c.tx,fontSize:12,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/></div>
                );})}
              </div>
            </div>
            <div style={{background:c.am+"08",borderRadius:11,padding:"12px 15px",border:"1px solid "+c.am+"30",marginBottom:10}}>
              <div style={{fontSize:11,fontWeight:700,marginBottom:6}}>📊 MAE & MFE — Fortemente Consigliati</div>
              <div style={{fontSize:10,color:c.txm,marginBottom:8}}>Guardali sul grafico dopo la chiusura. Servono per le analytics e il Coach.</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div><div style={{fontSize:10,fontWeight:600,color:c.txm,marginBottom:3}}>MAE (prezzo più sfavorevole)</div><input value={form.mae} onChange={function(e){setForm({...form,mae:e.target.value});}} placeholder="0.00000" style={{width:"100%",padding:"8px 10px",borderRadius:7,border:"1px solid "+c.am+"50",background:c.inp,color:c.tx,fontSize:12,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/></div>
                <div><div style={{fontSize:10,fontWeight:600,color:c.txm,marginBottom:3}}>MFE (prezzo più favorevole)</div><input value={form.mfe} onChange={function(e){setForm({...form,mfe:e.target.value});}} placeholder="0.00000" style={{width:"100%",padding:"8px 10px",borderRadius:7,border:"1px solid "+c.am+"50",background:c.inp,color:c.tx,fontSize:12,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/></div>
              </div>
            </div>
            <div style={{background:c.card,borderRadius:11,padding:"12px 15px",border:"1px solid "+c.bd,marginBottom:10}}>
              <div style={{fontSize:9,fontWeight:700,color:c.txm,marginBottom:8,letterSpacing:"0.08em"}}>P/L & SCREENSHOT</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div>
                  <div style={{fontSize:10,fontWeight:600,color:c.txm,marginBottom:3}}>P/L IN VALUTA ($) — opzionale</div>
                  <input value={form.pnl_eur} onChange={function(e){setForm({...form,pnl_eur:e.target.value});}} placeholder="es. +250.50 oppure -80" style={{width:"100%",padding:"8px 10px",borderRadius:7,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:12,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
                  <div style={{fontSize:9,color:c.txm,marginTop:3}}>Inserisci il P/L reale dal tuo broker</div>
                </div>
                <div>
                  <div style={{fontSize:10,fontWeight:600,color:c.txm,marginBottom:3}}>LINK SCREENSHOT (URL)</div>
                  <input value={form.screenshot_url} onChange={function(e){setForm({...form,screenshot_url:e.target.value});}} placeholder="https://www.tradingview.com/..." style={{width:"100%",padding:"8px 10px",borderRadius:7,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:12,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
                  <div style={{fontSize:9,color:c.txm,marginTop:3}}>Incolla il link del grafico (TradingView, ecc.)</div>
                </div>
              </div>
            </div>
            {(form.entry&&form.sl&&form.exit)&&(
              <div style={{background:c.card,borderRadius:11,padding:"12px 15px",border:"1px solid "+c.bd}}>
                <div style={{fontSize:9,fontWeight:700,color:c.txm,letterSpacing:"0.08em",marginBottom:8}}>CALCOLATO AUTOMATICAMENTE</div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
                  {[{l:"R Risultato",v:fmtR(r_result),col:r_result>0?c.gr:r_result<0?c.rd:c.txm},{l:"R:R Effettivo",v:"1:"+(Math.abs(r_result)).toFixed(2),col:c.tx},{l:"Direzione",v:form.direzione==="L"?"Long ▲":"Short ▼",col:form.direzione==="L"?c.gr:c.rd}].map(function(f){return(
                    <div key={f.l} style={{background:c.bg,borderRadius:7,padding:"8px 10px"}}><div style={{fontSize:8,color:c.txm,marginBottom:2,fontWeight:600}}>{f.l}</div><div style={{fontSize:14,fontWeight:700,color:f.col}}>{f.v}</div></div>
                  );})}
                </div>
              </div>
            )}
          </div>
        )}
        {tab==="parziali"&&(
          <div style={{maxWidth:660}}>
            <div style={{display:"flex",alignItems:"center",gap:10,background:c.card,borderRadius:11,padding:"12px 15px",border:"1px solid "+c.bd,marginBottom:12}}>
              <input type="checkbox" checked={hasParz} onChange={function(e){setHasParz(e.target.checked);}} style={{width:15,height:15,cursor:"pointer",accentColor:c.ac}}/>
              <div><div style={{fontSize:12,fontWeight:600}}>Ho chiuso parziali su questo trade</div></div>
            </div>
            {hasParz&&parz.map(function(p,i){return(
              <div key={i} style={{background:c.card,borderRadius:11,padding:"13px 15px",border:"1px solid "+c.bd,marginBottom:8}}>
                <div style={{fontSize:10,fontWeight:700,color:c.txm,marginBottom:8}}>PARZIALE #{i+1}</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:8}}>
                  {[{l:"SIZE",k:"size"},{l:"% POSIZIONE",k:"percentuale"},{l:"PREZZO",k:"prezzo"}].map(function(f){return(
                    <div key={f.k}><div style={{fontSize:10,fontWeight:600,color:c.txm,marginBottom:3}}>{f.l}</div><input value={p[f.k]||""} onChange={function(e){const np=[...parz];np[i]={...np[i],[f.k]:e.target.value};setParz(np);}} style={{width:"100%",padding:"7px 9px",borderRadius:6,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:11,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/></div>
                  );})}
                </div>
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  <label style={{display:"flex",alignItems:"center",gap:5,fontSize:11,cursor:"pointer"}}><input type="checkbox" checked={p.be||false} onChange={function(e){const np=[...parz];np[i]={...np[i],be:e.target.checked};setParz(np);}} style={{width:13,height:13,accentColor:c.ac}}/> Breakeven</label>
                  <button onClick={function(){setParz(parz.filter(function(_,j){return j!==i;}));}} style={{marginLeft:"auto",padding:"4px 9px",borderRadius:6,border:"1px solid "+c.rd+"40",background:c.rd+"10",color:c.rd,fontSize:10,cursor:"pointer",fontFamily:"inherit"}}>Rimuovi</button>
                </div>
              </div>
            );})}
            {hasParz&&<button onClick={function(){setParz([...parz,{size:"",percentuale:"",prezzo:"",be:false}]);}} style={{width:"100%",padding:"8px",borderRadius:9,border:"1px dashed "+c.ac+"60",background:c.ac+"08",color:c.ac,fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>+ Aggiungi parziale</button>}
          </div>
        )}
        {tab==="journal"&&(
          <div style={{maxWidth:660}}>
            <div style={{background:c.card,borderRadius:11,padding:"13px 15px",border:"1px solid "+c.bd,marginBottom:10}}>
              <div style={{fontSize:12,fontWeight:700,marginBottom:8}}>Stato Mentale Pre-Trade</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:7}}>
                {MOODS.map(function(m){return <button key={m} onClick={function(){setForm({...form,mood:m});}} style={{padding:"6px 11px",borderRadius:7,border:"1px solid "+(form.mood===m?c.ac:c.bd),background:form.mood===m?c.ac+"15":"transparent",color:form.mood===m?c.ac:c.tx,fontSize:12,cursor:"pointer",fontFamily:"inherit",fontWeight:form.mood===m?600:400}}>{m}</button>;})}
              </div>
            </div>
            {stratObj&&ckItems.length>0&&(
              <div style={{background:c.card,borderRadius:11,padding:"13px 15px",border:"1px solid "+c.bd,marginBottom:10}}>
                <div style={{fontSize:12,fontWeight:700,marginBottom:8}}>Checklist — {stratObj.nome}</div>
                {ckItems.map(function(item,i){return(
                  <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"7px 0",borderBottom:"1px solid "+c.bdl}}>
                    <input type="checkbox" checked={!!ck[item]} onChange={function(e){const n={...ck};n[item]=e.target.checked;setCk(n);}} style={{width:14,height:14,cursor:"pointer",accentColor:c.ac}}/>
                    <span style={{fontSize:12,color:ck[item]?c.tx:c.txm}}>{item}</span>
                    {ck[item]&&<span style={{marginLeft:"auto",fontSize:11,color:c.gr}}>✓</span>}
                  </div>
                );})}
                <div style={{marginTop:8,padding:"6px 10px",borderRadius:7,background:c.bg,display:"flex",justifyContent:"space-between"}}>
                  <span style={{fontSize:11,color:c.txm}}>Rispettate</span>
                  <span style={{fontSize:12,fontWeight:700,color:c.ac}}>{Object.values(ck).filter(Boolean).length}/{ckItems.length}</span>
                </div>
              </div>
            )}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
              {[{t:"Voto Esecuzione",k:"sc_esecuzione"},{t:"Voto Complessivo",k:"sc_complessivo"}].map(function(v){return(
                <div key={v.k} style={{background:c.card,borderRadius:11,padding:"11px 13px",border:"1px solid "+c.bd}}>
                  <div style={{fontSize:12,fontWeight:700,marginBottom:8}}>{v.t}</div>
                  <div style={{display:"flex",gap:3,flexWrap:"wrap"}}>
                    {[1,2,3,4,5,6,7,8,9,10].map(function(n){const sel=form[v.k]===n;return <button key={n} onClick={function(){setForm({...form,[v.k]:n});}} style={{width:28,height:28,borderRadius:6,border:"1.5px solid "+(sel?(n>=7?c.gr:n>=5?c.am:c.rd):c.bd),background:sel?(n>=7?c.gr+"15":n>=5?c.am+"15":c.rd+"15"):c.tag,color:n>=7?c.gr:n>=5?c.am:c.rd,fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>{n}</button>;})}
                  </div>
                </div>
              );})}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              {[{l:"NOTE TECNICHE",k:"note_tec",ph:"Cosa ha funzionato?"},{l:"NOTE PSICOLOGICHE",k:"note_psi",ph:"FOMO? Hesitation?"}].map(function(n){return(
                <div key={n.k}><div style={{fontSize:10,fontWeight:600,color:c.txm,marginBottom:4}}>{n.l}</div><textarea value={form[n.k]} onChange={function(e){setForm({...form,[n.k]:e.target.value});}} placeholder={n.ph} style={{width:"100%",height:80,padding:"8px 10px",borderRadius:8,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:11,fontFamily:"inherit",resize:"vertical",outline:"none",boxSizing:"border-box"}}/></div>
              );})}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── JOURNAL DETAIL ────────────────────────────────────────────────────────────
function JournalDetail({trade,c,onBack,strategie,reload,conti}){
  const strat=strategie.find(function(s){return s.id===trade.strategia_id;})||null;
  const win=trade.r_result>0;const be=trade.r_result===0;
  const ckItems=strat?[...(strat.checklist?.bias||[]),...(strat.checklist?.trigger||[]),...(strat.checklist?.contesto||[]),...(strat.checklist?.gestione||[])]:[];
  const [editing,setEditing]=useState(false);
  const [eform,setEform]=useState({
    note_tec:trade.note_tec||"",
    note_psi:trade.note_psi||"",
    mood:trade.mood||"",
    sc_esecuzione:trade.sc_esecuzione||null,
    sc_complessivo:trade.sc_complessivo||null,
    pnl_eur:trade.pnl_eur!=null?String(trade.pnl_eur):"",
    screenshot_url:trade.screenshot_url||"",
    entry:String(trade.entry),
    exit:String(trade.exit),
    sl:String(trade.sl),
    tp:trade.tp!=null?String(trade.tp):"",
    mae:trade.mae!=null?String(trade.mae):"",
    mfe:trade.mfe!=null?String(trade.mfe):"",
    size:trade.size!=null?String(trade.size):"",
  });
  const MOODS=["😌 Calmo","😐 Neutro","😰 Ansioso","😤 Frustrato","😵 Euforico","😴 Stanco"];
  async function saveEdit(){
    const parzialiValidi=(trade.parziali||[]).filter(function(p){return p.prezzo&&p.percentuale;});
    const r=calcRConParziali(eform.entry,eform.sl,eform.exit,trade.direzione,parzialiValidi);
    await db.trade.update(trade.id,{
      entry:parseFloat(eform.entry)||trade.entry,
      exit:parseFloat(eform.exit)||trade.exit,
      sl:parseFloat(eform.sl)||trade.sl,
      tp:eform.tp?parseFloat(eform.tp):null,
      mae:eform.mae?parseFloat(eform.mae):null,
      mfe:eform.mfe?parseFloat(eform.mfe):null,
      size:eform.size?parseFloat(eform.size):null,
      note_tec:eform.note_tec,
      note_psi:eform.note_psi,
      mood:eform.mood,
      sc_esecuzione:eform.sc_esecuzione,
      sc_complessivo:eform.sc_complessivo,
      pnl_eur:eform.pnl_eur?parseFloat(eform.pnl_eur):null,
      screenshot_url:eform.screenshot_url,
      r_result:r,
    });
    await reload();
    setEditing(false);
    onBack();
  }
  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{padding:"11px 20px",borderBottom:"1px solid "+c.bd,display:"flex",alignItems:"center",gap:10,background:c.sb,flexShrink:0}}>
        <button onClick={onBack} style={{padding:"4px 9px",borderRadius:6,border:"1px solid "+c.bd,background:"transparent",color:c.txm,fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>← Journal</button>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <div style={{width:28,height:28,borderRadius:6,fontSize:10,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",background:trade.direzione==="L"?c.gr+"18":c.rd+"18",color:trade.direzione==="L"?c.gr:c.rd,border:"1px solid "+(trade.direzione==="L"?c.gr+"44":c.rd+"44")}}>{trade.direzione==="L"?"▲":"▼"}</div>
          <div><div style={{fontSize:14,fontWeight:700}}>{trade.asset}</div><div style={{fontSize:10,color:c.txm}}>{fmtDate(trade.data_apertura)}{strat?" · "+strat.nome:""}</div></div>
        </div>
        <div style={{marginLeft:"auto",display:"flex",gap:8,alignItems:"center"}}>
          <Badge v={trade.r_result} c={c}/>
          <button onClick={function(){setEditing(true);}} style={{padding:"5px 12px",borderRadius:7,border:"1px solid "+c.ac+"40",background:c.ac+"10",color:c.ac,fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>✏ Modifica</button>
        </div>
      </div>
      <div style={{flex:1,overflow:"auto",padding:"16px 20px"}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
          <div style={{background:c.card,borderRadius:12,padding:"14px 16px",border:"1px solid "+c.bd}}>
            <div style={{fontSize:12,fontWeight:700,marginBottom:10}}>Dati Esecuzione</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              {[{l:"Entry",v:trade.entry},{l:"Exit",v:trade.exit},{l:"Stop Loss",v:trade.sl},{l:"Take Profit",v:trade.tp||"—"},{l:"MAE",v:trade.mae||"—"},{l:"MFE",v:trade.mfe||"—"},{l:"Size",v:trade.size||"—"},{l:"Direzione",v:trade.direzione==="L"?"Long ▲":"Short ▼"}].map(function(f,i){return(
                <div key={i} style={{background:c.bg,borderRadius:7,padding:"8px 10px"}}><div style={{fontSize:8,color:c.txm,fontWeight:600,marginBottom:2}}>{f.l}</div><div style={{fontSize:12,fontWeight:700,color:c.tx}}>{f.v}</div></div>
              );})}
            </div>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            <div style={{background:c.card,borderRadius:12,padding:"14px 16px",border:"1px solid "+c.bd}}>
              <div style={{fontSize:12,fontWeight:700,marginBottom:10}}>Risultato</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                {[{l:"R Risultato",v:fmtR(trade.r_result),col:win?c.gr:be?c.txm:c.rd},{l:"Voto Esecuzione",v:(trade.sc_esecuzione||"—")+"/10",col:trade.sc_esecuzione>=7?c.gr:trade.sc_esecuzione>=5?c.am:c.rd},{l:"Voto Complessivo",v:(trade.sc_complessivo||"—")+"/10",col:trade.sc_complessivo>=7?c.gr:trade.sc_complessivo>=5?c.am:c.rd},{l:"Stato Mentale",v:trade.mood||"—",col:c.tx}].map(function(f,i){return(
                  <div key={i} style={{background:c.bg,borderRadius:7,padding:"8px 10px"}}><div style={{fontSize:8,color:c.txm,fontWeight:600,marginBottom:2}}>{f.l}</div><div style={{fontSize:13,fontWeight:700,color:f.col}}>{f.v}</div></div>
                );})}
              </div>
            </div>
          </div>
        </div>
        {trade.parziali&&trade.parziali.length>0&&(
          <div style={{background:c.card,borderRadius:12,padding:"14px 16px",border:"1px solid "+c.bd,marginBottom:12}}>
            <div style={{fontSize:12,fontWeight:700,marginBottom:6}}>Parziali</div>
            <div style={{fontSize:10,color:c.txm,marginBottom:8,padding:"6px 10px",borderRadius:7,background:c.am+"08",border:"1px solid "+c.am+"20"}}>
              R ponderato: il risultato finale tiene conto di ogni uscita parziale × % della posizione chiusa.
            </div>
            {trade.parziali.map(function(p,i){
              const pR=p.prezzo&&trade.sl?calcR(trade.entry,trade.sl,p.prezzo,trade.direzione):null;
              return(
                <div key={i} style={{display:"flex",gap:12,padding:"8px 10px",borderRadius:8,background:c.bg,marginBottom:6,alignItems:"center"}}>
                  <div style={{flex:1}}><div style={{fontSize:9,color:c.txm}}>Prezzo</div><div style={{fontSize:11,fontWeight:600}}>{p.prezzo||"—"}</div></div>
                  <div style={{flex:1}}><div style={{fontSize:9,color:c.txm}}>% Posizione</div><div style={{fontSize:11,fontWeight:600}}>{p.percentuale||"—"}%</div></div>
                  <div style={{flex:1}}><div style={{fontSize:9,color:c.txm}}>Size</div><div style={{fontSize:11,fontWeight:600}}>{p.size||"—"}</div></div>
                  {pR!=null&&<div style={{textAlign:"right"}}><div style={{fontSize:9,color:c.txm}}>R parziale</div><div style={{fontSize:11,fontWeight:700,color:pR>=0?c.gr:c.rd}}>{fmtR(pR)}</div></div>}
                  {p.be&&<div style={{fontSize:10,fontWeight:700,color:c.am,padding:"2px 7px",borderRadius:20,background:c.am+"15"}}>BE</div>}
                </div>
              );
            })}
          </div>
        )}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
          <div style={{background:c.card,borderRadius:12,padding:"14px 16px",border:"1px solid "+c.bd}}>
            <div style={{fontSize:12,fontWeight:700,marginBottom:10}}>Note Tecniche</div>
            <div style={{fontSize:12,color:c.tx,lineHeight:1.6}}>{trade.note_tec||"—"}</div>
          </div>
          <div style={{background:c.card,borderRadius:12,padding:"14px 16px",border:"1px solid "+c.bd}}>
            <div style={{fontSize:12,fontWeight:700,marginBottom:8}}>Note Psicologiche</div>
            <div style={{fontSize:12,color:c.tx,lineHeight:1.6}}>{trade.note_psi||"—"}</div>
          </div>
        </div>
        {(trade.screenshot_url||trade.pnl_eur!=null)&&(
          <div style={{background:c.card,borderRadius:12,padding:"14px 16px",border:"1px solid "+c.bd,marginBottom:12}}>
            <div style={{fontSize:12,fontWeight:700,marginBottom:10}}>Extra</div>
            <div style={{display:"flex",gap:12,flexWrap:"wrap",alignItems:"center"}}>
              {trade.pnl_eur!=null&&(
                <div style={{background:c.bg,borderRadius:8,padding:"8px 14px"}}>
                  <div style={{fontSize:9,color:c.txm,fontWeight:600,marginBottom:2}}>P/L IN VALUTA</div>
                  <div style={{fontSize:14,fontWeight:700,color:trade.pnl_eur>=0?c.gr:c.rd}}>{trade.pnl_eur>=0?"+":""}{trade.pnl_eur}</div>
                </div>
              )}
              {trade.screenshot_url&&(
                <a href={trade.screenshot_url} target="_blank" rel="noopener noreferrer" style={{display:"flex",alignItems:"center",gap:6,padding:"8px 14px",borderRadius:8,background:c.ac+"10",border:"1px solid "+c.ac+"30",color:c.ac,fontSize:12,fontWeight:600,textDecoration:"none"}}>📸 Apri Screenshot</a>
              )}
            </div>
          </div>
        )}
        {strat&&ckItems.length>0&&(
          <div style={{background:c.card,borderRadius:12,padding:"14px 16px",border:"1px solid "+c.bd}}>
            <div style={{fontSize:12,fontWeight:700,marginBottom:10}}>Checklist — {strat.nome}</div>
            {ckItems.map(function(item,i){const checked=trade.checklist&&trade.checklist[item];return(
              <div key={i} style={{display:"flex",alignItems:"center",gap:7,padding:"5px 0",borderBottom:"1px solid "+c.bdl}}>
                <span style={{fontSize:12,color:checked?c.gr:c.rd}}>{checked?"✓":"✕"}</span>
                <span style={{fontSize:11,color:c.tx}}>{item}</span>
              </div>
            );})}
          </div>
        )}
      </div>
      {/* MODALE MODIFICA */}
      {editing&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:600,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={function(){setEditing(false);}}>
          <div style={{background:c.card,borderRadius:14,padding:"24px",width:600,maxHeight:"88vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}} onClick={function(e){e.stopPropagation();}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
              <div style={{fontSize:15,fontWeight:700}}>Modifica Trade — {trade.asset}</div>
              <button onClick={function(){setEditing(false);}} style={{width:28,height:28,borderRadius:7,border:"1px solid "+c.bd,background:c.tag,cursor:"pointer",fontSize:16,color:c.txm,display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
            </div>
            <div style={{fontSize:9,color:c.txm,marginBottom:14,padding:"7px 10px",borderRadius:7,background:c.ac+"08",border:"1px solid "+c.ac+"20"}}>Puoi modificare prezzi, note, voti e screenshot. L'R viene ricalcolato automaticamente.</div>
            {/* prezzi */}
            <div style={{marginBottom:14}}>
              <div style={{fontSize:10,fontWeight:700,color:c.txm,marginBottom:8,letterSpacing:"0.06em"}}>PREZZI</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8}}>
                {[{l:"Entry",k:"entry"},{l:"SL",k:"sl"},{l:"TP",k:"tp"},{l:"Exit",k:"exit"},{l:"Size",k:"size"}].map(function(f){return(
                  <div key={f.k}><div style={{fontSize:9,color:c.txm,fontWeight:600,marginBottom:3}}>{f.l}</div><input value={eform[f.k]||""} onChange={function(e){setEform({...eform,[f.k]:e.target.value});}} style={{width:"100%",padding:"7px 9px",borderRadius:7,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:11,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/></div>
                );})}
              </div>
            </div>
            <div style={{marginBottom:14}}>
              <div style={{fontSize:10,fontWeight:700,color:c.txm,marginBottom:8,letterSpacing:"0.06em"}}>MAE / MFE / P&L / SCREENSHOT</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                {[{l:"MAE",k:"mae"},{l:"MFE",k:"mfe"},{l:"P/L in $",k:"pnl_eur"},{l:"Link Screenshot",k:"screenshot_url"}].map(function(f){return(
                  <div key={f.k}><div style={{fontSize:9,color:c.txm,fontWeight:600,marginBottom:3}}>{f.l}</div><input value={eform[f.k]||""} onChange={function(e){setEform({...eform,[f.k]:e.target.value});}} style={{width:"100%",padding:"7px 9px",borderRadius:7,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:11,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/></div>
                );})}
              </div>
            </div>
            {/* mood */}
            <div style={{marginBottom:14}}>
              <div style={{fontSize:10,fontWeight:700,color:c.txm,marginBottom:7,letterSpacing:"0.06em"}}>STATO MENTALE</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                {MOODS.map(function(m){return <button key={m} onClick={function(){setEform({...eform,mood:m});}} style={{padding:"5px 10px",borderRadius:7,border:"1px solid "+(eform.mood===m?c.ac:c.bd),background:eform.mood===m?c.ac+"15":"transparent",color:eform.mood===m?c.ac:c.tx,fontSize:11,cursor:"pointer",fontFamily:"inherit",fontWeight:eform.mood===m?600:400}}>{m}</button>;})}
              </div>
            </div>
            {/* voti */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
              {[{t:"Voto Esecuzione",k:"sc_esecuzione"},{t:"Voto Complessivo",k:"sc_complessivo"}].map(function(v){return(
                <div key={v.k} style={{background:c.bg,borderRadius:9,padding:"10px 12px"}}>
                  <div style={{fontSize:10,fontWeight:700,marginBottom:7}}>{v.t}</div>
                  <div style={{display:"flex",gap:3,flexWrap:"wrap"}}>
                    {[1,2,3,4,5,6,7,8,9,10].map(function(n){const sel=eform[v.k]===n;return <button key={n} onClick={function(){setEform({...eform,[v.k]:n});}} style={{width:26,height:26,borderRadius:5,border:"1.5px solid "+(sel?(n>=7?c.gr:n>=5?c.am:c.rd):c.bd),background:sel?(n>=7?c.gr+"15":n>=5?c.am+"15":c.rd+"15"):c.card,color:n>=7?c.gr:n>=5?c.am:c.rd,fontSize:10,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>{n}</button>;})}
                  </div>
                </div>
              );})}
            </div>
            {/* note */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:18}}>
              {[{l:"NOTE TECNICHE",k:"note_tec"},{l:"NOTE PSICOLOGICHE",k:"note_psi"}].map(function(n){return(
                <div key={n.k}><div style={{fontSize:9,color:c.txm,fontWeight:600,marginBottom:4}}>{n.l}</div><textarea value={eform[n.k]||""} onChange={function(e){setEform({...eform,[n.k]:e.target.value});}} style={{width:"100%",height:70,padding:"7px 9px",borderRadius:8,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:11,fontFamily:"inherit",resize:"vertical",outline:"none",boxSizing:"border-box"}}/></div>
              );})}
            </div>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button onClick={function(){setEditing(false);}} style={{padding:"8px 16px",borderRadius:8,border:"1px solid "+c.bd,background:"transparent",color:c.txm,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Annulla</button>
              <button onClick={saveEdit} style={{padding:"8px 20px",borderRadius:8,background:"linear-gradient(135deg,#4F46E5,#7C3AED)",border:"none",color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>💾 Salva Modifiche</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── JOURNAL ───────────────────────────────────────────────────────────────────
function Journal({c,trades,strategie,conti,reload}){
  const [filtDir,setFiltDir]=useState("tutti");
  const [filtRis,setFiltRis]=useState("tutti");
  const [filtAsset,setFiltAsset]=useState("tutti");
  const [filtStrat,setFiltStrat]=useState("tutti");
  const [detail,setDetail]=useState(null);
  const [confirmDel,setConfirmDel]=useState(null);
  if(detail) return <JournalDetail trade={detail} c={c} onBack={function(){setDetail(null);}} strategie={strategie} reload={reload} conti={conti}/>;

  const drafts=trades.filter(function(t){return t.draft===true;});
  const realTrades=trades.filter(function(t){return !t.draft;});

  const assets=["tutti",...Array.from(new Set(realTrades.map(function(t){return t.asset;})))];
  const sorted=realTrades.slice().sort(function(a,b){return new Date(b.data_apertura)-new Date(a.data_apertura);});
  const filtered=sorted.filter(function(t){
    if(filtDir==="long"&&t.direzione!=="L") return false;
    if(filtDir==="short"&&t.direzione!=="S") return false;
    if(filtRis==="win"&&t.r_result<=0) return false;
    if(filtRis==="loss"&&t.r_result>=0) return false;
    if(filtRis==="be"&&t.r_result!==0) return false;
    if(filtAsset!=="tutti"&&t.asset!==filtAsset) return false;
    if(filtStrat!=="tutti"&&String(t.strategia_id)!==filtStrat) return false;
    return true;
  });
  async function delTrade(id){await db.trade.delete(id);await reload();setConfirmDel(null);}

  function TradeRow({t,i,len,isDraft}){
    const strat=strategie.find(function(s){return s.id===t.strategia_id;});
    const integrity=calcIntegrityScore(t);
    const rowBg=isDraft?c.am+"08":"transparent";
    return(
      <div
        key={t.id}
        style={{display:"grid",gridTemplateColumns:"90px 80px 50px 120px 70px 50px 40px 40px 30px",gap:0,padding:"10px 16px",borderBottom:i<len-1?"1px solid "+c.bdl:"none",alignItems:"center",cursor:"pointer",background:rowBg,transition:"background 0.15s"}}
        onClick={function(){setDetail(t);}}
        onMouseEnter={function(e){e.currentTarget.style.background=isDraft?c.am+"14":c.nav;}}
        onMouseLeave={function(e){e.currentTarget.style.background=rowBg;}}
      >
        <div>
          <div style={{fontSize:11,fontWeight:600}}>{fmtDate(t.data_apertura)}</div>
          {isDraft&&<div style={{fontSize:8,fontWeight:700,color:c.am,marginTop:1}}>📋 BOZZA</div>}
        </div>
        <div style={{fontWeight:700,fontSize:12}}>{t.asset||"—"}</div>
        <div><span style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:26,height:16,borderRadius:3,fontSize:9,fontWeight:700,background:t.direzione==="L"?c.gr+"18":c.rd+"18",color:t.direzione==="L"?c.gr:c.rd}}>{t.direzione==="L"?"▲L":"▼S"}</span></div>
        <div style={{fontSize:10,color:c.txm,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{strat?strat.nome:"—"}</div>
        <div>{isDraft?<span style={{fontSize:10,color:c.am}}>da completare</span>:<Badge v={t.r_result} c={c}/>}</div>
        <div style={{fontSize:14}}>{t.mood?t.mood.split(" ")[0]:"—"}</div>
        <div style={{fontSize:11,fontWeight:700,color:t.sc_esecuzione>=7?c.gr:t.sc_esecuzione>=5?c.am:c.rd}}>{t.sc_esecuzione||"—"}</div>
        <div style={{display:"flex",alignItems:"center",gap:2}}>
          <div style={{width:24,height:24,borderRadius:6,background:integrity>=70?c.gr+"20":integrity>=40?c.am+"20":c.rd+"20",border:"1px solid "+(integrity>=70?c.gr+"40":integrity>=40?c.am+"40":c.rd+"40"),display:"flex",alignItems:"center",justifyContent:"center",fontSize:8,fontWeight:700,color:integrity>=70?c.gr:integrity>=40?c.am:c.rd}} title={"Integrity Score: "+integrity+"/100"}>{integrity}</div>
        </div>
        <div onClick={function(e){e.stopPropagation();setConfirmDel(t.id);}} style={{fontSize:11,color:c.rd,cursor:"pointer",opacity:0.6}} onMouseEnter={function(e){e.currentTarget.style.opacity=1;}} onMouseLeave={function(e){e.currentTarget.style.opacity=0.6;}}>✕</div>
      </div>
    );
  }

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{padding:"12px 20px",borderBottom:"1px solid "+c.bd,display:"flex",alignItems:"center",justifyContent:"space-between",background:c.sb,flexShrink:0}}>
        <div>
          <div style={{fontSize:15,fontWeight:700,letterSpacing:"-0.02em"}}>Journal</div>
          <div style={{fontSize:10,color:c.txm}}>{filtered.length} trade{drafts.length>0?" · "+drafts.length+" bozze da completare":""}</div>
        </div>
        <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
          <select value={filtDir} onChange={function(e){setFiltDir(e.target.value);}} style={{padding:"5px 8px",borderRadius:7,border:"1px solid "+c.bd,background:c.inp,color:c.tx,fontSize:11,fontFamily:"inherit",cursor:"pointer"}}>
            <option value="tutti">Direzione</option><option value="long">Long</option><option value="short">Short</option>
          </select>
          <select value={filtRis} onChange={function(e){setFiltRis(e.target.value);}} style={{padding:"5px 8px",borderRadius:7,border:"1px solid "+c.bd,background:c.inp,color:c.tx,fontSize:11,fontFamily:"inherit",cursor:"pointer"}}>
            <option value="tutti">Risultato</option><option value="win">Win</option><option value="loss">Loss</option><option value="be">BE</option>
          </select>
          <select value={filtAsset} onChange={function(e){setFiltAsset(e.target.value);}} style={{padding:"5px 8px",borderRadius:7,border:"1px solid "+c.bd,background:c.inp,color:c.tx,fontSize:11,fontFamily:"inherit",cursor:"pointer"}}>
            {assets.map(function(a){return <option key={a} value={a}>{a==="tutti"?"Asset":a}</option>;})}
          </select>
          <select value={filtStrat} onChange={function(e){setFiltStrat(e.target.value);}} style={{padding:"5px 8px",borderRadius:7,border:"1px solid "+c.bd,background:c.inp,color:c.tx,fontSize:11,fontFamily:"inherit",cursor:"pointer"}}>
            <option value="tutti">Strategia</option>
            {strategie.map(function(s){return <option key={s.id} value={String(s.id)}>{s.nome}</option>;})}
          </select>
        </div>
      </div>
      <div style={{flex:1,overflow:"auto",padding:"14px 20px"}}>
        {trades.length===0?(
          <div style={{textAlign:"center",padding:"60px",color:c.txm,fontSize:13}}>Nessun trade ancora. Clicca "+ Nuovo Trade" per iniziare!</div>
        ):(
          <>
            {/* SEZIONE BOZZE */}
            {drafts.length>0&&(
              <div style={{marginBottom:14}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                  <div style={{fontSize:11,fontWeight:700,color:c.am,letterSpacing:"0.05em"}}>📋 BOZZE DA COMPLETARE</div>
                  <div style={{flex:1,height:1,background:c.am+"30"}}/>
                  <div style={{fontSize:10,color:c.am,background:c.am+"15",padding:"2px 8px",borderRadius:10,border:"1px solid "+c.am+"40"}}>{drafts.length}</div>
                </div>
                <div style={{background:c.card,borderRadius:12,border:"1px solid "+c.am+"40",overflow:"hidden"}}>
                  <div style={{display:"grid",gridTemplateColumns:"90px 80px 50px 120px 70px 50px 40px 40px 30px",gap:0,padding:"7px 16px",background:c.am+"10",borderBottom:"1px solid "+c.am+"30"}}>
                    {["Data","Asset","Dir.","Strategia","Stato","Mood","★","Int.",""].map(function(h,i){return <div key={i} style={{fontSize:8,color:c.am,fontWeight:700,letterSpacing:"0.05em"}}>{h}</div>;})}
                  </div>
                  {drafts.sort(function(a,b){return new Date(b.data_apertura)-new Date(a.data_apertura);}).map(function(t,i){
                    return <TradeRow key={t.id} t={t} i={i} len={drafts.length} isDraft={true}/>;
                  })}
                </div>
                <div style={{fontSize:10,color:c.txm,marginTop:6,paddingLeft:2}}>💡 Clicca su una bozza per completarla con prezzi, MAE/MFE e note</div>
              </div>
            )}
            {/* TRADE REALI */}
            <div style={{background:c.card,borderRadius:12,border:"1px solid "+c.bd,overflow:"hidden"}}>
              <div style={{display:"grid",gridTemplateColumns:"90px 80px 50px 120px 70px 50px 40px 40px 30px",gap:0,padding:"8px 16px",borderBottom:"1px solid "+c.bd,background:c.bg}}>
                {["Data","Asset","Dir.","Strategia","R","Mood","★","Int.",""].map(function(h,i){return <div key={i} style={{fontSize:8,color:c.txs,fontWeight:700,letterSpacing:"0.05em"}}>{h}</div>;})}
              </div>
              {filtered.length===0&&<div style={{padding:"30px",textAlign:"center",color:c.txm,fontSize:12}}>Nessun trade con i filtri selezionati</div>}
              {filtered.map(function(t,i){
                return <TradeRow key={t.id} t={t} i={i} len={filtered.length} isDraft={false}/>;
              })}
            </div>
          </>
        )}
      </div>
      {confirmDel&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:600,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:c.card,borderRadius:12,padding:"24px",width:320,boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}}>
            <div style={{fontSize:15,fontWeight:700,marginBottom:8}}>Elimina Trade</div>
            <div style={{fontSize:12,color:c.txm,marginBottom:20}}>Eliminare questo trade? L'azione non può essere annullata.</div>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button onClick={function(){setConfirmDel(null);}} style={{padding:"8px 16px",borderRadius:8,border:"1px solid "+c.bd,background:"transparent",color:c.txm,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Annulla</button>
              <button onClick={function(){delTrade(confirmDel);}} style={{padding:"8px 16px",borderRadius:8,background:c.rd,border:"none",color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>Elimina</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── HEATMAP CALENDARIO ─────────────────────────────────────────────────────────
function CalHeatmap({trades,c}){
  if(!trades||trades.length===0) return(
    <div style={{textAlign:"center",padding:"40px",color:c.txm,fontSize:12}}>Nessun trade nel periodo selezionato.</div>
  );

  // Raggruppa trade per giorno
  const byDay={};
  trades.forEach(function(t){
    if(!t.data_apertura) return;
    const day=t.data_apertura.slice(0,10);
    if(!byDay[day]) byDay[day]={r:0,n:0,wins:0,losses:0};
    byDay[day].r+=t.r_result||0;
    byDay[day].n++;
    if((t.r_result||0)>0) byDay[day].wins++;
    else if((t.r_result||0)<0) byDay[day].losses++;
  });

  const allDays=Object.keys(byDay).sort();
  if(allDays.length===0) return(
    <div style={{textAlign:"center",padding:"40px",color:c.txm,fontSize:12}}>Nessun trade con data valida.</div>
  );

  // Range mesi
  const firstDate=new Date(allDays[0]+"T00:00:00");
  const lastDate=new Date(allDays[allDays.length-1]+"T00:00:00");
  const months=[];
  let cur=new Date(firstDate.getFullYear(),firstDate.getMonth(),1);
  const endMonth=new Date(lastDate.getFullYear(),lastDate.getMonth(),1);
  while(cur<=endMonth){
    months.push(new Date(cur.getFullYear(),cur.getMonth(),1));
    cur=new Date(cur.getFullYear(),cur.getMonth()+1,1);
  }

  const monthNames=["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];
  const dayNames=["L","M","M","G","V","S","D"];

  const rVals=Object.values(byDay).map(function(d){return Math.abs(d.r);});
  const maxAbs=rVals.length>0?Math.max.apply(null,rVals):1;

  function getCellBg(r){
    if(r===undefined||r===null) return "transparent";
    if(Math.abs(r)<0.005) return c.tag;
    const intensity=Math.min(Math.abs(r)/Math.max(maxAbs,0.01),1);
    const alpha=0.18+intensity*0.72;
    if(r>0) return "rgba(34,197,94,"+alpha.toFixed(2)+")";
    return "rgba(239,68,68,"+alpha.toFixed(2)+")";
  }

  // 4 mesi per riga, poi va a capo
  const COLS=4;
  const rows=[];
  for(let i=0;i<months.length;i+=COLS){
    rows.push(months.slice(i,i+COLS));
  }

  const CELL=34; // px cella
  const GAP=3;

  return(
    <div>
      {rows.map(function(rowMonths,ri){return(
        <div key={ri} style={{display:"flex",gap:20,marginBottom:24,flexWrap:"nowrap"}}>
          {rowMonths.map(function(monthStart,mi){
            const yr=monthStart.getFullYear();
            const mo=monthStart.getMonth();
            const daysInMonth=new Date(yr,mo+1,0).getDate();
            const firstDow=(new Date(yr,mo,1).getDay()+6)%7; // 0=Lun

            const cells=[];

            // Header giorni settimana
            dayNames.forEach(function(dn,di){
              cells.push(
                <div key={"h"+di} style={{width:CELL,height:18,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:700,color:c.txm}}>
                  {dn}
                </div>
              );
            });

            // Celle vuote iniziali
            for(var e=0;e<firstDow;e++){
              cells.push(<div key={"e"+e} style={{width:CELL,height:CELL}}/>);
            }

            // Celle giorni
            for(var d=1;d<=daysInMonth;d++){
              var mo2=String(mo+1).padStart(2,"0");
              var d2=String(d).padStart(2,"0");
              var dateStr=yr+"-"+mo2+"-"+d2;
              var data=byDay[dateStr];
              var bg=getCellBg(data?data.r:undefined);
              var hasTrade=!!data;
              var tip=dateStr+(data?" — "+data.n+" trade | R: "+(data.r>=0?"+":"")+data.r.toFixed(2)+(data.wins>0?" | ✓"+data.wins:"")+(data.losses>0?" | ✗"+data.losses:""):"");
              var textColor=hasTrade?(Math.abs(data.r)>maxAbs*0.5?"#fff":c.tx):c.txm+"60";
              cells.push(
                <div key={"d"+d} title={tip} style={{
                  width:CELL,height:CELL,
                  borderRadius:5,
                  background:bg,
                  border:"1px solid "+(hasTrade?c.bd+"90":c.bd+"40"),
                  display:"flex",
                  alignItems:"center",
                  justifyContent:"center",
                  fontSize:10,
                  fontWeight:hasTrade?700:400,
                  color:textColor,
                  cursor:hasTrade?"default":"default",
                  position:"relative",
                  transition:"transform 0.1s",
                }}>
                  {d}
                </div>
              );
            }

            return(
              <div key={mi} style={{flex:"0 0 auto"}}>
                <div style={{fontSize:11,fontWeight:700,color:c.tx,marginBottom:8,paddingLeft:2}}>
                  {monthNames[mo]} {yr}
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(7,"+CELL+"px)",gap:GAP}}>
                  {cells}
                </div>
              </div>
            );
          })}
        </div>
      );})}

      {/* Legenda */}
      <div style={{display:"flex",gap:14,alignItems:"center",flexWrap:"wrap",marginTop:4,paddingTop:12,borderTop:"1px solid "+c.bd}}>
        <span style={{fontSize:10,color:c.txm,fontWeight:600}}>LEGENDA:</span>
        {[[-2,"Perdita forte"],[-0.5,"Perdita lieve"],[0.01,"Neutro"],[0.5,"Win lieve"],[2,"Win forte"]].map(function(e){return(
          <div key={e[0]} style={{display:"flex",alignItems:"center",gap:5}}>
            <div style={{width:18,height:18,borderRadius:4,background:getCellBg(e[0]),border:"1px solid "+c.bd}}/>
            <span style={{fontSize:10,color:c.txm}}>{e[1]}</span>
          </div>
        );})}
        <span style={{fontSize:10,color:c.txm,marginLeft:8,fontStyle:"italic"}}>Passa il mouse su un giorno per il dettaglio</span>
      </div>
    </div>
  );
}


// ── ANALYTICS ────────────────────────────────────────────────────────────────
function Analytics({c,trades,strategie,conti}){
  const [selConti,setSelConti]=useState([]);
  const [selStrat,setSelStrat]=useState([]);
  const [unit,setUnit]=useState("R");
  const [tab,setTab]=useState("panoramica");
  const [selSessione,setSelSessione]=useState([]);
  const [periodoA,setPeriodoA]=useState({from:"",to:""});
  const [periodoB,setPeriodoB]=useState({from:"",to:""});
  function toggleC(id){setSelConti(function(p){return p.includes(id)?p.filter(function(x){return x!==id;}):[...p,id];});}
  function toggleS(id){setSelStrat(function(p){return p.includes(id)?p.filter(function(x){return x!==id;}):[...p,id];});}
  function toggleSess(s){setSelSessione(function(p){return p.includes(s)?p.filter(function(x){return x!==s;}):[...p,s];});}
  function getSessione(iso){
    if(!iso) return null;
    const h=new Date(iso).getUTCHours();
    if(h>=0&&h<8) return "Asian";
    if(h>=8&&h<13) return "London";
    if(h>=13&&h<22) return "NY";
    return "Asian";
  }
  const filtered=trades.filter(function(t){
    if(selConti.length>0&&!selConti.includes(t.conto_id)) return false;
    if(selStrat.length>0&&!selStrat.includes(t.strategia_id)) return false;
    if(selSessione.length>0&&!selSessione.includes(getSessione(t.data_apertura))) return false;
    return true;
  });
  // helper: filtra per periodo (usato nel tab Confronto)
  function filteredByPeriodo(p){
    return filtered.filter(function(t){
      if(p.from&&t.data_apertura&&t.data_apertura<p.from) return false;
      if(p.to&&t.data_apertura&&t.data_apertura>p.to+"T23:59:59") return false;
      return true;
    });
  }
  const totalPnl=filtered.reduce(function(s,t){return s+(t.pnl_eur||0);},0);
  const capMap=makeCapMap(conti);
  const totalPct=calcTotalPct(filtered,capMap);
  const pctPerTrade=filtered.length>0?(totalPct/filtered.length):0;
  const m=calcMetrics(filtered);
  const curve=buildEquityCurve(filtered,capMap);
  function fmtVal(r, pnlSingolo, pctSingolo){
    if(unit==="R") return fmtR(r);
    if(unit==="$"){const p=pnlSingolo!=null?pnlSingolo:totalPnl;return (p>=0?"+":"")+"$"+Math.abs(p).toFixed(0);}
    if(unit==="%"){const p=pctSingolo!=null?pctSingolo:totalPct;return fmtPct(p);}
    return fmtR(r);
  }
  function tradePct(t){const cap=capMap[t.conto_id]||0;return cap>0?((t.pnl_eur||0)/cap)*100:0;}
  const stratPerf=strategie.map(function(s){
    const st=filtered.filter(function(t){return t.strategia_id===s.id;});
    const sp=st.reduce(function(sum,t){return sum+(t.pnl_eur||0);},0);
    const spct=calcTotalPct(st,capMap);
    return {...s,...calcMetrics(st),_pnl:sp,_pct:spct};
  }).filter(function(s){return s.total>0;});
  const moods=["😌 Calmo","😐 Neutro","😰 Ansioso","😤 Frustrato","😵 Euforico","😴 Stanco"];
  const moodStats=moods.map(function(mood){
    const mt=filtered.filter(function(t){return t.mood===mood;});
    const mm=calcMetrics(mt);
    const mp=mt.reduce(function(s,t){return s+(t.pnl_eur||0);},0);
    return {mood,n:mt.length,wr:mm.wr,exp:mm.exp,pnl:mp};
  }).filter(function(x){return x.n>0;});
  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <ModuleHeader
        title="Analytics"
        subtitle={filtered.length+" trade analizzati"}
        tooltip="Analytics è il cuore di EdgeLab: analizza tutti i tuoi trade reali e ti mostra dove stai guadagnando, dove stai perdendo, e perché. Tab Panoramica: metriche globali e equity curve del tuo periodo selezionato. Tab Calendario: vedi la tua performance giorno per giorno su una mappa visiva — verde guadagno, rosso perdita. Tab Confronto: metti a confronto due periodi diversi per vedere se stai migliorando. Tab Sessioni: analisi per London, NY e Asian con chart per giorno della settimana, ora UTC e durata dei trade. Tab Strategie: ranking delle tue strategie per capire quale ha il vero edge e quale invece pesa sul tuo P/L."
        c={c}
        right={
          <div style={{display:"flex",gap:2,background:c.tag,borderRadius:8,padding:2}}>
            {["R","$","%"].map(function(u){return(
              <button key={u} onClick={function(){setUnit(u);}} style={{padding:"4px 10px",borderRadius:6,border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:11,fontWeight:unit===u?700:400,background:unit===u?c.ac:"transparent",color:unit===u?"#fff":c.txm}}>{u}</button>
            );})}
          </div>
        }
      />
      {/* FILTRI */}
      <div style={{padding:"8px 20px",borderBottom:"1px solid "+c.bd,background:c.sb,display:"flex",gap:14,flexShrink:0,flexWrap:"wrap",alignItems:"center"}}>
        <div style={{display:"flex",gap:5,flexWrap:"wrap",alignItems:"center"}}>
          <span style={{fontSize:9,fontWeight:700,color:c.txm,marginRight:2}}>CONTO</span>
          {conti.map(function(cn){const s=selConti.includes(cn.id);return <button key={cn.id} onClick={function(){toggleC(cn.id);}} style={{padding:"3px 9px",borderRadius:20,border:"1px solid "+(s?c.ac:c.bd),background:s?c.ac+"15":"transparent",color:s?c.ac:c.txm,fontSize:11,fontWeight:s?700:400,cursor:"pointer",fontFamily:"inherit"}}>{cn.nome}</button>;})}
        </div>
        <div style={{width:1,background:c.bd,height:20}}/>
        <div style={{display:"flex",gap:5,flexWrap:"wrap",alignItems:"center"}}>
          <span style={{fontSize:9,fontWeight:700,color:c.txm,marginRight:2}}>STRATEGIA</span>
          {strategie.map(function(s){const sel=selStrat.includes(s.id);return <button key={s.id} onClick={function(){toggleS(s.id);}} style={{padding:"3px 9px",borderRadius:20,border:"1px solid "+(sel?c.ac:c.bd),background:sel?c.ac+"15":"transparent",color:sel?c.ac:c.txm,fontSize:11,fontWeight:sel?700:400,cursor:"pointer",fontFamily:"inherit"}}>{s.nome}</button>;})}
        </div>
        <div style={{width:1,background:c.bd,height:20}}/>
        <div style={{display:"flex",gap:5,alignItems:"center"}}>
          <span style={{fontSize:9,fontWeight:700,color:c.txm,marginRight:2}}>SESSIONE</span>
          {["Asian","London","NY"].map(function(s){const sel=selSessione.includes(s);const col=s==="London"?"#4F46E5":s==="NY"?"#0F766E":"#D97706";return(
            <button key={s} onClick={function(){toggleSess(s);}} style={{padding:"3px 9px",borderRadius:20,border:"1px solid "+(sel?col:c.bd),background:sel?col+"20":"transparent",color:sel?col:c.txm,fontSize:11,fontWeight:sel?700:400,cursor:"pointer",fontFamily:"inherit"}}>{s}</button>
          );})}
        </div>
        {(selConti.length>0||selStrat.length>0||selSessione.length>0)&&<button onClick={function(){setSelConti([]);setSelStrat([]);setSelSessione([]);}} style={{padding:"3px 9px",borderRadius:20,border:"1px solid "+c.bd,background:"transparent",color:c.txm,fontSize:10,cursor:"pointer",fontFamily:"inherit"}}>✕ Reset</button>}
      </div>
      {/* TABS NAVIGAZIONE */}
      <div style={{padding:"0 20px",borderBottom:"1px solid "+c.bd,background:c.sb,display:"flex",gap:0,flexShrink:0}}>
        {[["panoramica","📊 Panoramica"],["calendario","📅 Calendario"],["confronto","⟷ Confronto"],["sessioni","🌍 Sessioni"],["strategie","◈ Strategie"]].map(function(t){const active=tab===t[0];return(
          <button key={t[0]} onClick={function(){setTab(t[0]);}} style={{padding:"9px 16px",border:"none",borderBottom:active?"2px solid "+c.ac:"2px solid transparent",background:"transparent",color:active?c.ac:c.txm,fontSize:11,fontWeight:active?700:400,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap",transition:"color 0.15s"}}>{t[1]}</button>
        );})}
      </div>
      <div style={{flex:1,overflow:"auto",padding:"14px 20px"}}>
        <DisclaimerCampione n={filtered.length} c={c}/>
        {unit==="%"&&filtered.length>0&&filtered.filter(function(t){return t.pnl_eur!=null;}).length===0&&(
          <div style={{margin:"0 0 10px 0",padding:"9px 14px",borderRadius:9,background:c.rd+"10",border:"1px solid "+c.rd+"35",display:"flex",gap:9,alignItems:"flex-start"}}>
            <span style={{fontSize:14,flexShrink:0}}>⚠️</span>
            <div style={{fontSize:11,color:c.rd,lineHeight:1.65}}><strong>Dati monetari mancanti:</strong> per vedere la % reale compila il campo <strong>P/L in $</strong> su ogni trade. In alternativa usa la vista <strong>R</strong>.</div>
          </div>
        )}
        {filtered.length===0?(
          <div style={{textAlign:"center",padding:"60px",color:c.txm,fontSize:13}}>Nessun trade. Inserisci dei trade per vedere le analytics.</div>
        ):(
          <>
            {/* ── TAB: PANORAMICA ── */}
            {tab==="panoramica"&&(
              <>
                <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:8,marginBottom:12}}>
                  {(function(){
                    const ddCurve=curve.map(function(p){return p.pct;});
                    let peak=0,maxDDpct=0;
                    ddCurve.forEach(function(v){if(v>peak)peak=v;const dd=peak-v;if(dd>maxDDpct)maxDDpct=dd;});
                    maxDDpct=parseFloat(maxDDpct.toFixed(2));
                    const winTrades=filtered.filter(function(t){return t.r_result>0;});
                    const lossTrades=filtered.filter(function(t){return t.r_result<0;});
                    const avgWinPnl=winTrades.length>0?winTrades.reduce(function(s,t){return s+(t.pnl_eur||0);},0)/winTrades.length:0;
                    const avgLossPnl=lossTrades.length>0?Math.abs(lossTrades.reduce(function(s,t){return s+(t.pnl_eur||0);},0)/lossTrades.length):0;
                    const avgWinPct=winTrades.length>0?calcTotalPct(winTrades,capMap)/winTrades.length:0;
                    const avgLossPct=lossTrades.length>0?Math.abs(calcTotalPct(lossTrades,capMap))/lossTrades.length:0;
                    return [
                      {l:"P/L Totale",v:fmtVal(m.totalR,totalPnl,totalPct),col:m.totalR>=0?c.gr:c.rd,tt:"Risultato complessivo nel periodo e filtri selezionati. In R è la somma delle unità di rischio guadagnate o perse — la misura più oggettiva perché è indipendente dalla size. In € è il guadagno monetario reale. In % è il rendimento sul capitale del conto calcolato trade per trade."},
                      {l:"Win Rate",v:m.wr+"%",col:m.wr>=50?c.gr:c.rd,tt:"Percentuale dei trade chiusi in profitto. Importante: un win rate alto non garantisce profittabilità. Un trader con win rate 35% può guadagnare molto se i suoi profitti medi sono grandi rispetto alle perdite. Guarda sempre il win rate insieme all'expectancy per avere il quadro reale."},
                      {l:"Profit Factor",v:m.pf,col:m.pf>=1.5?c.gr:m.pf>=1?c.am:c.rd,tt:"Rapporto tra tutto quello che hai guadagnato e tutto quello che hai perso. Se è 2.0 guadagni il doppio di quello che perdi, in totale. Sopra 1.5 è un buon segnale. Sotto 1.0 la strategia perde più di quanto guadagna. È la sintesi più rapida per capire se il tuo trading ha un edge positivo."},
                      {l:"Expectancy",v:fmtVal(m.exp,totalPnl/Math.max(filtered.length,1),pctPerTrade),col:m.exp>=0?c.gr:c.rd,tt:"Quanto guadagni in media per ogni trade aperto, considerando sia vincite che perdite. Se positivo, la tua strategia è profittevole nel tempo — più trade fai, più guadagni. Se negativo, più trade fai, più perdi. È la metrica chiave per decidere se scalare la frequenza di trading."},
                      {l:"Max Drawdown",v:unit==="R"?"-"+m.maxDD+"R":unit==="%"?"-"+maxDDpct+"%":"-$"+avgLossPnl.toFixed(0),col:c.rd,tt:"La perdita cumulativa più grande che hai subito dal massimo del conto fino al minimo successivo. Ti dice qual è stato il momento più duro della tua equity. Un drawdown grande richiede una ripresa proporzionalmente ancora più grande: -25% richiede +33% per tornare al pari. Tienilo monitorato per capire i limiti reali della tua strategia."},
                      {l:"Avg Win / Loss",v:fmtVal(m.avgWin,avgWinPnl,avgWinPct)+" / "+fmtVal(m.avgLoss,avgLossPnl,avgLossPct),col:c.tx,tt:"Il risultato medio dei tuoi trade vincenti confrontato con quello dei perdenti. Il rapporto tra questi due numeri è il tuo R:R reale medio — quanto guadagni in media quando vinci rispetto a quanto perdi quando perdi. Se il tuo avg win è +2R e il tuo avg loss è -1R, il tuo R:R reale è 2:1. Combinato con il win rate, determina completamente la tua profittabilità a lungo termine."},
                    ];
                  })().map(function(mm,i){return(
                    <div key={i} style={{background:c.card,borderRadius:10,padding:"10px 12px",border:"1px solid "+c.bd}}>
                      <div style={{fontSize:8,color:c.txm,fontWeight:600,letterSpacing:"0.05em",marginBottom:4,display:"flex",alignItems:"center",gap:2}}>{mm.l.toUpperCase()}<Tooltip text={mm.tt} c={c}/></div>
                      <div style={{fontSize:14,fontWeight:700,color:mm.col,letterSpacing:"-0.02em",lineHeight:1}}>{mm.v}</div>
                    </div>
                  );})}
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1.4fr 1fr",gap:10,marginBottom:10}}>
                  <div style={{background:c.card,borderRadius:12,padding:"13px 15px",border:"1px solid "+c.bd}}>
                    <div style={{fontSize:12,fontWeight:700,marginBottom:10,display:"flex",alignItems:"center",gap:4}}>Equity Curve<Tooltip c={c} text="Mostra come cresce (o scende) il tuo capitale trade dopo trade. Una curva che sale costantemente verso destra indica una strategia solida. Picchi e valli brusche indicano alta volatilità dei risultati. Il drawdown è la distanza dal massimo raggiunto fino al punto più basso successivo — più è profondo, più è difficile psicologicamente e finanziariamente da sostenere."/></div>
                    <EqChartSVG curve={curve} c={c} h={110} unit={unit}/>
                  </div>
                  <div style={{background:c.card,borderRadius:12,padding:"13px 15px",border:"1px solid "+c.bd}}>
                    <div style={{fontSize:12,fontWeight:700,marginBottom:10,display:"flex",alignItems:"center",gap:4}}>Win / Loss / BE<Tooltip c={c} text="Distribuzione dei tuoi trade: vincenti (Win), perdenti (Loss) e in pareggio (BE = Break Even). Il win rate da solo non basta per giudicare una strategia — puoi guadagnare anche con un win rate del 40% se i tuoi profitti medi sono grandi rispetto alle perdite medie. Guarda sempre il win rate insieme all'expectancy e al profit factor."/></div>
                    {[{l:"✓ Win",n:m.wins,col:c.gr,w:m.wr+"%"},{l:"✗ Loss",n:m.losses,col:c.rd,w:Math.round(m.losses/Math.max(m.total,1)*100)+"%"},{l:"— BE",n:m.be,col:c.txm,w:Math.round(m.be/Math.max(m.total,1)*100)+"%"}].map(function(r,i){return(
                      <div key={i} style={{marginBottom:8}}>
                        <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}><span style={{fontSize:11,fontWeight:600,color:r.col}}>{r.l} ({r.n})</span><span style={{fontSize:10,color:c.txm}}>{r.w}</span></div>
                        <div style={{height:5,borderRadius:3,background:c.bd}}><div style={{height:"100%",width:r.w,background:r.col,borderRadius:3,opacity:0.8}}/></div>
                      </div>
                    );})}
                    <div style={{marginTop:10,padding:"8px 10px",borderRadius:8,background:c.bg}}>
                      <div style={{fontSize:9,color:c.txm,fontWeight:600,marginBottom:2}}>STREAK</div>
                      <div style={{display:"flex",gap:12}}>
                        <span style={{fontSize:11,color:c.gr}}>Max Win: {m.streak.maxW}</span>
                        <span style={{fontSize:11,color:c.rd}}>Max Loss: {m.streak.maxL}</span>
                      </div>
                    </div>
                  </div>
                </div>
                {moodStats.length>0&&(
                  <div style={{background:c.card,borderRadius:12,padding:"13px 15px",border:"1px solid "+c.bd}}>
                    <div style={{fontSize:12,fontWeight:700,marginBottom:10,display:"flex",alignItems:"center",gap:4}}>Stato Mentale vs Risultati<Tooltip c={c} text="Confronta le tue performance in base a come ti sentivi prima di entrare in trade. Se quando sei ansioso o frustrato i risultati peggiorano sensibilmente, è un segnale chiaro che il tuo stato emotivo influenza le tue decisioni. Usa questa sezione per capire in quale condizione mentale sei più lucido e disciplinato, e considera di saltare il trading nei giorni negativi."/></div>
                    {moodStats.map(function(x,i){return(
                      <div key={i} style={{marginBottom:i<moodStats.length-1?8:0}}>
                        <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}><span style={{fontSize:11,fontWeight:600}}>{x.mood}</span><div style={{display:"flex",gap:10}}><span style={{fontSize:11,fontWeight:700,color:x.wr>=50?c.gr:c.rd}}>WR {x.wr}%</span><span style={{fontSize:11,fontWeight:700,color:x.exp>=0?c.gr:c.rd}}>{fmtVal(x.exp)}</span><span style={{fontSize:10,color:c.txm}}>{x.n} trade</span></div></div>
                        <div style={{height:4,borderRadius:3,background:c.bd}}><div style={{height:"100%",width:x.wr+"%",background:x.wr>=60?c.gr:x.wr>=40?c.am:c.rd,borderRadius:3}}/></div>
                      </div>
                    );})}
                  </div>
                )}
              </>
            )}

            {/* ── TAB: CALENDARIO ── */}
            {tab==="calendario"&&(
              <div style={{background:c.card,borderRadius:12,padding:"16px",border:"1px solid "+c.bd}}>
                <div style={{fontSize:12,fontWeight:700,marginBottom:4,display:"flex",alignItems:"center",gap:4}}>Heatmap Calendario — Performance giornaliera<Tooltip c={c} text="Ogni cella è un giorno di trading. Il colore indica il risultato complessivo di quel giorno: verde intenso = giornata molto profittevole, rosso intenso = giornata molto negativa. Cerca pattern visivi: hai giornate rosse concentrate in certi periodi del mese? Certi mesi vanno sistematicamente male? Queste informazioni ti aiutano a capire quando sei più in forma e quando dovresti ridurre la frequenza o la size."/></div>
                <div style={{fontSize:10,color:c.txm,marginBottom:14}}>Ogni cella = un giorno. Verde = profitto, Rosso = perdita. Passa sopra per il dettaglio.</div>
                <CalHeatmap trades={filtered} c={c}/>
              </div>
            )}

            {/* ── TAB: CONFRONTO PERIODI ── */}
            {tab==="confronto"&&(function(){
              const tA=filteredByPeriodo(periodoA);
              const tB=filteredByPeriodo(periodoB);
              const mA=calcMetrics(tA); const mB=calcMetrics(tB);
              const pnlA=tA.reduce(function(s,t){return s+(t.pnl_eur||0);},0);
              const pnlB=tB.reduce(function(s,t){return s+(t.pnl_eur||0);},0);
              const pctA=calcTotalPct(tA,capMap); const pctB=calcTotalPct(tB,capMap);
              const crvA=buildEquityCurve(tA,capMap); const crvB=buildEquityCurve(tB,capMap);
              function fvA(r,p,pct){if(unit==="R")return fmtR(r);if(unit==="$")return (p>=0?"+":"")+"$"+Math.abs(p).toFixed(0);return fmtPct(pct);}
              const metrics=[
                {l:"Trade",a:mA.total,b:mB.total,better:"higher"},
                {l:"Win Rate",a:mA.wr+"%",b:mB.wr+"%",better:"higher",av:mA.wr,bv:mB.wr},
                {l:"Profit Factor",a:mA.pf,b:mB.pf,better:"higher",av:parseFloat(mA.pf),bv:parseFloat(mB.pf)},
                {l:"Expectancy",a:fvA(mA.exp,pnlA/Math.max(tA.length,1),pctA/Math.max(tA.length,1)),b:fvA(mB.exp,pnlB/Math.max(tB.length,1),pctB/Math.max(tB.length,1)),better:"higher",av:mA.exp,bv:mB.exp},
                {l:"P/L",a:fvA(mA.totalR,pnlA,pctA),b:fvA(mB.totalR,pnlB,pctB),better:"higher",av:mA.totalR,bv:mB.totalR},
                {l:"Max DD",a:"-"+mA.maxDD+"R",b:"-"+mB.maxDD+"R",better:"lower",av:mA.maxDD,bv:mB.maxDD},
              ];
              return(
                <>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
                    {[{label:"Periodo A",p:periodoA,setP:setPeriodoA,col:"#4F46E5"},{label:"Periodo B",p:periodoB,setP:setPeriodoB,col:"#0F766E"}].map(function(pd){return(
                      <div key={pd.label} style={{background:c.card,borderRadius:11,padding:"13px 15px",border:"2px solid "+pd.col+"40"}}>
                        <div style={{fontSize:11,fontWeight:700,color:pd.col,marginBottom:10}}>{pd.label}</div>
                        <div style={{display:"flex",gap:8}}>
                          <div style={{flex:1}}><div style={{fontSize:9,color:c.txm,fontWeight:600,marginBottom:4}}>DA</div><input type="date" value={pd.p.from} onChange={function(e){pd.setP(function(p){return {...p,from:e.target.value};});}} style={{width:"100%",padding:"7px 9px",borderRadius:7,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:11,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/></div>
                          <div style={{flex:1}}><div style={{fontSize:9,color:c.txm,fontWeight:600,marginBottom:4}}>A</div><input type="date" value={pd.p.to} onChange={function(e){pd.setP(function(p){return {...p,to:e.target.value};});}} style={{width:"100%",padding:"7px 9px",borderRadius:7,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:11,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/></div>
                        </div>
                      </div>
                    );})}
                  </div>
                  <div style={{background:c.card,borderRadius:11,padding:"13px 15px",border:"1px solid "+c.bd,marginBottom:12}}>
                    <div style={{fontSize:11,fontWeight:700,marginBottom:10}}>Confronto Metriche</div>
                    <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr",gap:0}}>
                      <div style={{fontSize:9,fontWeight:700,color:c.txm,padding:"6px 0",borderBottom:"1px solid "+c.bd}}>METRICA</div>
                      <div style={{fontSize:9,fontWeight:700,color:"#4F46E5",padding:"6px 0",borderBottom:"1px solid "+c.bd,textAlign:"center"}}>PERIODO A</div>
                      <div style={{fontSize:9,fontWeight:700,color:"#0F766E",padding:"6px 0",borderBottom:"1px solid "+c.bd,textAlign:"center"}}>PERIODO B</div>
                      {metrics.map(function(mm,i){
                        const winner=mm.av!=null&&mm.bv!=null?(mm.better==="higher"?mm.av>mm.bv?0:mm.bv>mm.av?1:-1:mm.av<mm.bv?0:mm.bv<mm.av?1:-1):-1;
                        return[
                          <div key={"l"+i} style={{fontSize:11,fontWeight:600,padding:"8px 0",borderBottom:"1px solid "+c.bd+"80"}}>{mm.l}</div>,
                          <div key={"a"+i} style={{fontSize:12,fontWeight:700,padding:"8px 0",borderBottom:"1px solid "+c.bd+"80",textAlign:"center",color:winner===0?c.gr:c.tx,background:winner===0?"#4F46E508":"transparent"}}>{mm.a}</div>,
                          <div key={"b"+i} style={{fontSize:12,fontWeight:700,padding:"8px 0",borderBottom:"1px solid "+c.bd+"80",textAlign:"center",color:winner===1?c.gr:c.tx,background:winner===1?"#0F766E08":"transparent"}}>{mm.b}</div>,
                        ];
                      })}
                    </div>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                    {[{label:"Periodo A",crv:crvA,col:"#4F46E5"},{label:"Periodo B",crv:crvB,col:"#0F766E"}].map(function(pd){return(
                      <div key={pd.label} style={{background:c.card,borderRadius:11,padding:"12px 14px",border:"1px solid "+c.bd}}>
                        <div style={{fontSize:11,fontWeight:700,color:pd.col,marginBottom:8}}>{pd.label} — Equity Curve</div>
                        <EqChartSVG curve={pd.crv} c={c} h={90} unit={unit}/>
                      </div>
                    );})}
                  </div>
                </>
              );
            })()}

            {/* ── TAB: SESSIONI ── */}
            {tab==="sessioni"&&(function(){
              const sessions=["Asian","London","NY"];
              const sessData=sessions.map(function(s){
                const st=filtered.filter(function(t){return getSessione(t.data_apertura)===s;});
                const sm=calcMetrics(st);
                const sp=st.reduce(function(sum,t){return sum+(t.pnl_eur||0);},0);
                const spct=calcTotalPct(st,capMap);
                return {s,n:st.length,wr:sm.wr,exp:sm.exp,pf:sm.pf,totalR:sm.totalR,pnl:sp,pct:spct};
              });

              // ── GIORNI SETTIMANA ──
              const dayNames=["Dom","Lun","Mar","Mer","Gio","Ven","Sab"];
              const dayData=dayNames.map(function(d,i){
                const dt=filtered.filter(function(t){return t.data_apertura&&new Date(t.data_apertura).getDay()===i;});
                const dm=calcMetrics(dt);
                const dp=dt.reduce(function(s,t){return s+(t.pnl_eur||0);},0);
                // durata media in minuti
                const durArr=dt.filter(function(t){return t.data_apertura&&t.data_chiusura;}).map(function(t){return (new Date(t.data_chiusura)-new Date(t.data_apertura))/60000;});
                const avgDur=durArr.length>0?Math.round(durArr.reduce(function(s,v){return s+v;},0)/durArr.length):0;
                return {d,i,n:dt.length,wr:dm.wr,exp:dm.exp,pnl:dp,avgDur};
              }).filter(function(d){return d.n>0;});

              // ── ORE UTC ──
              const hourData=Array.from({length:24},function(_,h){
                const ht=filtered.filter(function(t){return t.data_apertura&&new Date(t.data_apertura).getUTCHours()===h;});
                const hm=calcMetrics(ht);
                const durArr=ht.filter(function(t){return t.data_apertura&&t.data_chiusura;}).map(function(t){return (new Date(t.data_chiusura)-new Date(t.data_apertura))/60000;});
                const avgDur=durArr.length>0?Math.round(durArr.reduce(function(s,v){return s+v;},0)/durArr.length):0;
                return {h,n:ht.length,exp:hm.exp,wr:hm.wr,avgDur};
              });

              // ── DURATA GLOBALE ──
              const durAll=filtered.filter(function(t){return t.data_apertura&&t.data_chiusura;}).map(function(t){
                return {dur:(new Date(t.data_chiusura)-new Date(t.data_apertura))/60000, r:t.r_result||0};
              });
              const avgDurAll=durAll.length>0?Math.round(durAll.reduce(function(s,d){return s+d.dur;},0)/durAll.length):0;
              const avgDurWin=durAll.filter(function(d){return d.r>0;}).length>0?Math.round(durAll.filter(function(d){return d.r>0;}).reduce(function(s,d){return s+d.dur;},0)/durAll.filter(function(d){return d.r>0;}).length):0;
              const avgDurLoss=durAll.filter(function(d){return d.r<0;}).length>0?Math.round(durAll.filter(function(d){return d.r<0;}).reduce(function(s,d){return s+d.dur;},0)/durAll.filter(function(d){return d.r<0;}).length):0;
              function fmtDur(min){if(min<=0)return "—";if(min<60)return min+"min";return Math.floor(min/60)+"h "+(min%60)+"m";}

              // max per scale chart
              const maxWR=Math.max.apply(null,dayData.map(function(d){return d.wr;}));
              const maxExpDay=Math.max.apply(null,dayData.map(function(d){return Math.abs(d.exp);})||[1]);
              const maxExpHour=Math.max.apply(null,hourData.map(function(h){return Math.abs(h.exp);})||[1]);
              const maxN=Math.max.apply(null,hourData.map(function(h){return h.n;})||[1]);

              // helper chart bar generico
              function BarChart({data,keyFn,nameFn,metricFn,metricLabel,colorFn,fmtFn,height,showN}){
                const maxVal=Math.max.apply(null,data.map(metricFn).map(Math.abs))||1;
                return(
                  <div style={{display:"flex",gap:6,alignItems:"flex-end",height:height||100}}>
                    {data.map(function(d,i){
                      const val=metricFn(d);
                      const absVal=Math.abs(val);
                      const pct=absVal/maxVal;
                      const col=colorFn(d,val);
                      const barH=Math.max(pct*(height||100)*0.75, d.n>0||absVal>0?3:0);
                      return(
                        <div key={keyFn(d)} title={nameFn(d)+" — "+metricLabel+": "+(fmtFn?fmtFn(val):val)+(showN?" ("+d.n+" trade)":"")} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:3,cursor:"default"}}>
                          <div style={{fontSize:8,fontWeight:700,color:col,opacity:absVal>0?1:0}}>{fmtFn?fmtFn(val):val}</div>
                          <div style={{width:"100%",flex:1,display:"flex",flexDirection:"column",justifyContent:"flex-end"}}>
                            <div style={{width:"100%",height:barH,background:col,borderRadius:"4px 4px 0 0",opacity:d.n>0?0.82:0.2}}/>
                          </div>
                          <div style={{fontSize:9,fontWeight:600,color:c.txm,textAlign:"center",whiteSpace:"nowrap"}}>{nameFn(d)}</div>
                          {showN&&d.n>0&&<div style={{fontSize:7,color:c.txm}}>{d.n}t</div>}
                        </div>
                      );
                    })}
                  </div>
                );
              }

              return(
                <>
                  {/* Box sessioni */}
                  <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:14}}>
                    {sessData.map(function(sd){const col=sd.s==="London"?"#4F46E5":sd.s==="NY"?"#0F766E":"#D97706";return(
                      <div key={sd.s} style={{background:c.card,borderRadius:11,padding:"13px 15px",border:"2px solid "+col+"30"}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                          <div style={{fontSize:13,fontWeight:700,color:col}}>{sd.s}</div>
                          <div style={{fontSize:10,color:c.txm}}>{sd.n} trade</div>
                        </div>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:5}}>
                          {[{l:"Win Rate",v:sd.wr+"%",col:sd.wr>=50?c.gr:c.rd},{l:"PF",v:sd.pf,col:parseFloat(sd.pf)>=1.5?c.gr:parseFloat(sd.pf)>=1?c.am:c.rd},{l:"Expectancy",v:fmtR(sd.exp),col:sd.exp>=0?c.gr:c.rd},{l:"P/L",v:fmtVal(sd.totalR,sd.pnl,sd.pct),col:sd.totalR>=0?c.gr:c.rd}].map(function(mm,i){return(
                            <div key={i} style={{background:c.bg,borderRadius:7,padding:"6px 8px"}}>
                              <div style={{fontSize:8,color:c.txm,fontWeight:600,marginBottom:1}}>{mm.l}</div>
                              <div style={{fontSize:11,fontWeight:700,color:mm.col}}>{mm.v}</div>
                            </div>
                          );})}
                        </div>
                      </div>
                    );})}
                  </div>

                  {/* ── CHART 1: Giorni settimana per WR ── */}
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
                    <div style={{background:c.card,borderRadius:11,padding:"14px 16px",border:"1px solid "+c.bd}}>
                      <div style={{fontSize:11,fontWeight:700,marginBottom:2,display:"flex",alignItems:"center",gap:4}}>📅 Win Rate per Giorno<Tooltip c={c} text="Mostra in quale giorno della settimana riesci a chiudere in profitto più trade. Un win rate alto in un giorno specifico può dipendere da molti fattori: liquidità del mercato, notizie economiche ricorrenti, o semplicemente la tua routine e concentrazione mentale in quel giorno. Se un giorno ha pochissimi trade non è statisticamente significativo — osserva solo i giorni con almeno 10-15 trade."/></div>
                      <div style={{fontSize:9,color:c.txm,marginBottom:12}}>Quale giorno hai la % di trade vincenti più alta</div>
                      {dayData.length===0?<div style={{textAlign:"center",padding:"20px",color:c.txm,fontSize:11}}>Dati insufficienti</div>:(
                        <BarChart
                          data={dayData}
                          keyFn={function(d){return d.d;}}
                          nameFn={function(d){return d.d;}}
                          metricFn={function(d){return d.wr;}}
                          metricLabel="WR"
                          colorFn={function(d,v){return v>=60?c.gr:v>=40?c.am:c.rd;}}
                          fmtFn={function(v){return v+"%";}}
                          height={110}
                          showN={true}
                        />
                      )}
                    </div>
                    <div style={{background:c.card,borderRadius:11,padding:"14px 16px",border:"1px solid "+c.bd}}>
                      <div style={{fontSize:11,fontWeight:700,marginBottom:2,display:"flex",alignItems:"center",gap:4}}>💰 Expectancy per Giorno<Tooltip c={c} text="A differenza del win rate, l'expectancy per giorno ti dice quanto guadagni IN MEDIA per ogni trade fatto in quel giorno, tenendo conto sia delle vincite che delle perdite. Un giorno con win rate del 70% ma expectancy bassa significa che vinci spesso ma poco. Un giorno con win rate del 45% ma alta expectancy significa che quando vinci vinci grande. L'expectancy è la misura più completa della qualità di un giorno di trading."/></div>
                      <div style={{fontSize:9,color:c.txm,marginBottom:12}}>Quanto guadagni in media per ogni trade in quel giorno</div>
                      {dayData.length===0?<div style={{textAlign:"center",padding:"20px",color:c.txm,fontSize:11}}>Dati insufficienti</div>:(
                        <BarChart
                          data={dayData}
                          keyFn={function(d){return d.d;}}
                          nameFn={function(d){return d.d;}}
                          metricFn={function(d){return d.exp;}}
                          metricLabel="Exp"
                          colorFn={function(d,v){return v>0?c.gr:v<0?c.rd:c.bd;}}
                          fmtFn={function(v){return fmtR(v);}}
                          height={110}
                          showN={true}
                        />
                      )}
                    </div>
                  </div>

                  {/* ── CHART 2: Ore UTC per WR e Expectancy ── */}
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
                    <div style={{background:c.card,borderRadius:11,padding:"14px 16px",border:"1px solid "+c.bd}}>
                      <div style={{fontSize:11,fontWeight:700,marginBottom:2,display:"flex",alignItems:"center",gap:4}}>🕐 Win Rate per Ora (UTC)<Tooltip c={c} text="Mostra in quale fascia oraria (in UTC) riesci a chiudere in profitto più trade. La linea colorata sul bordo superiore indica la sessione di mercato: arancio = Asian (00-07), blu = London (08-12), verde = NY (13-21). Ore con barre alte e verdi sono le tue ore più produttive. Ore rosse con molti trade sono campanelli d'allarme — potresti continuare a operare in fasce orarie che storicamente ti danneggiano."/></div>
                      <div style={{fontSize:9,color:c.txm,marginBottom:12}}>Ore con più trade vincenti — hover per dettaglio</div>
                      <div style={{display:"flex",gap:3,alignItems:"flex-end",height:90}}>
                        {hourData.map(function(hd){
                          const col=hd.n===0?c.bd:hd.wr>=60?c.gr:hd.wr>=40?c.am:c.rd;
                          const pct=hd.n>0?hd.wr/100:0;
                          const sessCol=hd.h<8?"#D97706":hd.h<13?"#4F46E5":hd.h<22?"#0F766E":c.bd;
                          return(
                            <div key={hd.h} title={hd.h+":00 UTC — "+hd.n+" trade, WR "+hd.wr+"%"} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                              <div style={{width:"100%",height:Math.max(pct*70,hd.n>0?3:0),background:hd.n>0?col:c.bd+"40",borderRadius:"3px 3px 0 0",opacity:hd.n>0?0.85:0.25,borderTop:hd.n>0?"2px solid "+sessCol:"none"}}/>
                              <div style={{fontSize:6,color:c.txm}}>{hd.h}</div>
                            </div>
                          );
                        })}
                      </div>
                      <div style={{display:"flex",gap:10,marginTop:6}}>
                        {[{col:"#D97706",l:"Asian"},{col:"#4F46E5",l:"London"},{col:"#0F766E",l:"NY"}].map(function(s){return(
                          <div key={s.l} style={{display:"flex",gap:3,alignItems:"center"}}><div style={{width:8,height:8,borderRadius:1,background:s.col}}/><span style={{fontSize:8,color:c.txm}}>{s.l}</span></div>
                        );})}
                        <span style={{fontSize:8,color:c.txm,marginLeft:4}}>· Linea top = sessione</span>
                      </div>
                    </div>
                    <div style={{background:c.card,borderRadius:11,padding:"14px 16px",border:"1px solid "+c.bd}}>
                      <div style={{fontSize:11,fontWeight:700,marginBottom:2,display:"flex",alignItems:"center",gap:4}}>💰 Expectancy per Ora (UTC)<Tooltip c={c} text="Indica il guadagno medio per trade in ogni fascia oraria. Le barre verdi sono le ore dove in media guadagni ogni volta che apri un trade. Le barre rosse sono ore dove in media perdi — anche se a volte vinci, il risultato complessivo è negativo. Questa analisi è particolarmente utile per decidere un orario di stop: smettere di tradare dopo le 16:00 UTC se quella fascia è sistematicamente rossa per te."/></div>
                      <div style={{fontSize:9,color:c.txm,marginBottom:12}}>Verde = ora profittevole, Rosso = ora da evitare</div>
                      <div style={{display:"flex",gap:3,alignItems:"flex-end",height:90}}>
                        {hourData.map(function(hd){
                          const maxE=Math.max.apply(null,hourData.map(function(h){return Math.abs(h.exp);})||[1]);
                          const pct=maxE>0?Math.abs(hd.exp)/maxE:0;
                          const col=hd.exp>0?c.gr:hd.exp<0?c.rd:c.bd;
                          return(
                            <div key={hd.h} title={hd.h+":00 UTC — Exp "+hd.exp+"R, "+hd.n+" trade"} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                              <div style={{width:"100%",height:Math.max(pct*70,hd.n>0?3:0),background:hd.n>0?col:c.bd+"40",borderRadius:"3px 3px 0 0",opacity:hd.n>0?0.85:0.25}}/>
                              <div style={{fontSize:6,color:c.txm}}>{hd.h}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* ── CHART 3: Durata Media Trade ── */}
                  <div style={{background:c.card,borderRadius:11,padding:"14px 16px",border:"1px solid "+c.bd}}>
                    <div style={{fontSize:11,fontWeight:700,marginBottom:2,display:"flex",alignItems:"center",gap:4}}>⏱ Durata Media Trade<Tooltip c={c} text="Quanto tempo rimangono aperti i tuoi trade in media. Il confronto tra durata dei trade vincenti e perdenti è molto rivelatore: se i loss durano molto più dei win, significa che tendi a tenere aperte le posizioni in perdita sperando in un recupero — un comportamento molto comune ma dannoso. Il pattern ideale è il contrario: win lunghi (lasci correre) e loss corti (tagli veloce). La durata per giorno ti aiuta a capire se certi giorni tendi a fare overtrade o a restare troppo esposto."/></div>
                    <div style={{fontSize:9,color:c.txm,marginBottom:14}}>Quanto durano i tuoi trade — confronto tra win e loss e per giorno della settimana</div>
                    {durAll.length===0?(
                      <div style={{textAlign:"center",padding:"20px",color:c.txm,fontSize:11}}>Nessun dato di durata — assicurati che i trade abbiano data di chiusura.</div>
                    ):(
                      <>
                        {/* Summary durata globale */}
                        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:16}}>
                          {[
                            {l:"Durata Media",v:fmtDur(avgDurAll),sub:"tutti i trade",col:c.tx},
                            {l:"Durata Win",v:fmtDur(avgDurWin),sub:"trade vincenti",col:c.gr},
                            {l:"Durata Loss",v:fmtDur(avgDurLoss),sub:"trade perdenti",col:c.rd},
                          ].map(function(box,i){return(
                            <div key={i} style={{background:c.bg,borderRadius:9,padding:"10px 12px",border:"1px solid "+c.bd}}>
                              <div style={{fontSize:9,color:c.txm,fontWeight:600,marginBottom:4}}>{box.l}</div>
                              <div style={{fontSize:16,fontWeight:700,color:box.col,marginBottom:2}}>{box.v}</div>
                              <div style={{fontSize:9,color:c.txm}}>{box.sub}</div>
                            </div>
                          );})}
                        </div>
                        {/* Bar durata per giorno */}
                        {dayData.filter(function(d){return d.avgDur>0;}).length>0&&(
                          <>
                            <div style={{fontSize:10,fontWeight:600,color:c.txm,marginBottom:8}}>DURATA MEDIA PER GIORNO</div>
                            <BarChart
                              data={dayData.filter(function(d){return d.avgDur>0;})}
                              keyFn={function(d){return d.d;}}
                              nameFn={function(d){return d.d;}}
                              metricFn={function(d){return d.avgDur;}}
                              metricLabel="Durata"
                              colorFn={function(d,v){
                                // colore relativo alla durata media globale
                                if(avgDurAll===0) return c.ac;
                                return v>avgDurAll*1.3?c.am:v<avgDurAll*0.7?c.ac:c.gr;
                              }}
                              fmtFn={fmtDur}
                              height={90}
                              showN={false}
                            />
                            <div style={{fontSize:9,color:c.txm,marginTop:8,fontStyle:"italic"}}>
                              🟢 Vicino alla media · 🟡 Molto più lungo della media · 🔵 Molto più corto
                            </div>
                          </>
                        )}
                      </>
                    )}
                  </div>
                </>
              );
            })()}

            {/* ── TAB: STRATEGIE ── */}
            {tab==="strategie"&&(function(){
              const ranked=[...stratPerf].sort(function(a,b){return b.exp-a.exp;});
              const best=ranked[0];
              return(
                <>
                  {best&&(
                    <div style={{background:c.ac+"0D",borderRadius:11,padding:"12px 15px",border:"1px solid "+c.ac+"30",marginBottom:12,display:"flex",gap:12,alignItems:"center"}}>
                      <div style={{fontSize:22}}>🏆</div>
                      <div>
                        <div style={{fontSize:10,color:c.ac,fontWeight:700,letterSpacing:"0.06em",marginBottom:2}}>MIGLIORE STRATEGIA — EXPECTANCY</div>
                        <div style={{fontSize:15,fontWeight:700}}>{best.nome}</div>
                        <div style={{fontSize:11,color:c.txm}}>Expectancy {fmtR(best.exp)} · WR {best.wr}% · PF {best.pf} · {best.total} trade</div>
                      </div>
                    </div>
                  )}
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    {ranked.map(function(s,rank){
                      const barW=best&&best.exp>0?Math.min((s.exp/best.exp)*100,100):50;
                      return(
                        <div key={s.id} style={{background:c.card,borderRadius:11,padding:"13px 15px",border:"1px solid "+c.bd}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                            <div style={{display:"flex",gap:10,alignItems:"center"}}>
                              <div style={{width:26,height:26,borderRadius:8,background:rank===0?c.ac+"15":c.bd,border:"1px solid "+(rank===0?c.ac:c.bd),display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:rank===0?c.ac:c.txm}}>#{rank+1}</div>
                              <div>
                                <div style={{fontSize:13,fontWeight:700}}>{s.nome}</div>
                                <div style={{fontSize:10,color:c.txm}}>{s.total} trade · {s.wr}% WR</div>
                              </div>
                            </div>
                            <div style={{textAlign:"right"}}>
                              <div style={{fontSize:14,fontWeight:700,color:s.totalR>=0?c.gr:c.rd}}>{fmtVal(s.totalR,s._pnl,s._pct)}</div>
                              <div style={{fontSize:10,color:c.txm}}>PF {s.pf}</div>
                            </div>
                          </div>
                          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6,marginBottom:8}}>
                            {[{l:"Expectancy",v:fmtR(s.exp),col:s.exp>=0?c.gr:c.rd},{l:"Max DD",v:"-"+s.maxDD+"R",col:c.rd},{l:"Max Win",v:s.streak.maxW+" cons.",col:c.gr},{l:"Max Loss",v:s.streak.maxL+" cons.",col:c.rd}].map(function(mm,i){return(
                              <div key={i} style={{background:c.bg,borderRadius:7,padding:"6px 9px"}}>
                                <div style={{fontSize:8,color:c.txm,fontWeight:600,marginBottom:1}}>{mm.l}</div>
                                <div style={{fontSize:11,fontWeight:700,color:mm.col}}>{mm.v}</div>
                              </div>
                            );})}
                          </div>
                          <div style={{height:4,borderRadius:3,background:c.bd}}>
                            <div style={{height:"100%",width:Math.max(barW,0)+"%",background:s.exp>=0?c.gr:c.rd,borderRadius:3,opacity:0.7,transition:"width 0.4s"}}/>
                          </div>
                        </div>
                      );
                    })}
                    {ranked.length===0&&<div style={{textAlign:"center",padding:"40px",color:c.txm,fontSize:12}}>Nessuna strategia con trade nel periodo filtrato.</div>}
                  </div>
                </>
              );
            })()}
          </>
        )}
      </div>
    </div>
  );
}

// ── IMPOSTAZIONI ──────────────────────────────────────────────────────────────
function Impostazioni({c,dark,setDark,reload}){
  const [lingua,setLingua]=useState("it");
  async function exportData(){
    const strats=await db.strategie.toArray();
    const conti=await db.conti.toArray();
    const trades=await db.trade.toArray();
    const data=JSON.stringify({version:"1.0",exported:new Date().toISOString(),strategie:strats,conti,trades},null,2);
    const blob=new Blob([data],{type:"application/json"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url;a.download="edgelab-backup-"+new Date().toISOString().split("T")[0]+".json";
    document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);
  }
  async function importData(e){
    const file=e.target.files[0];if(!file) return;
    const text=await file.text();
    try{
      const data=JSON.parse(text);
      // MERGE: aggiunge ai dati esistenti senza cancellare nulla
      // Remap IDs per evitare collisioni con dati esistenti
      const stratIdMap={};
      const contoIdMap={};
      let addedStrat=0,addedConti=0,addedTrade=0;
      if(data.strategie){
        for(const s of data.strategie){
          const oldId=s.id;
          const {id,...rest}=s;
          const newId=await db.strategie.add(rest);
          stratIdMap[oldId]=newId;
          addedStrat++;
        }
      }
      if(data.conti){
        for(const cn of data.conti){
          const oldId=cn.id;
          const {id,...rest}=cn;
          if(rest.strategie_ids&&Array.isArray(rest.strategie_ids)){
            rest.strategie_ids=rest.strategie_ids.map(function(sid){return stratIdMap[sid]||sid;});
          }
          const newId=await db.conti.add(rest);
          contoIdMap[oldId]=newId;
          addedConti++;
        }
      }
      if(data.trades){
        for(const t of data.trades){
          const {id,...rest}=t;
          if(rest.conto_id&&contoIdMap[rest.conto_id]) rest.conto_id=contoIdMap[rest.conto_id];
          if(rest.strategia_id&&stratIdMap[rest.strategia_id]) rest.strategia_id=stratIdMap[rest.strategia_id];
          await db.trade.add(rest);
          addedTrade++;
        }
      }
      await reload();
      alert("✅ Import completato (MERGE — dati esistenti conservati)\n\nAggiunti:\n• "+addedStrat+" strategie\n• "+addedConti+" conti\n• "+addedTrade+" trade");
    }catch(err){alert("❌ Errore nell'import: "+err.message);}
  }
  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{padding:"12px 20px",borderBottom:"1px solid "+c.bd,background:c.sb,flexShrink:0}}>
        <div style={{fontSize:15,fontWeight:700}}>Impostazioni</div>
      </div>
      <div style={{flex:1,overflow:"auto",padding:"14px 20px"}}>
        <div style={{maxWidth:560,display:"flex",flexDirection:"column",gap:12}}>
          <div style={{background:c.card,borderRadius:12,padding:"16px",border:"1px solid "+c.bd}}>
            <div style={{fontSize:12,fontWeight:700,marginBottom:14}}>Preferenze</div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 0",borderBottom:"1px solid "+c.bdl}}>
              <div><div style={{fontSize:12,fontWeight:600}}>Tema</div></div>
              <div style={{display:"flex",gap:5}}>
                {[{v:false,l:"☀ Chiaro"},{v:true,l:"☾ Scuro"}].map(function(t){return(
                  <button key={t.l} onClick={function(){setDark(t.v);}} style={{padding:"6px 12px",borderRadius:7,border:"1px solid "+(dark===t.v?c.ac:c.bd),background:dark===t.v?c.ac+"15":"transparent",color:dark===t.v?c.ac:c.txm,fontSize:11,cursor:"pointer",fontFamily:"inherit",fontWeight:dark===t.v?600:400}}>{t.l}</button>
                );})}
              </div>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 0"}}>
              <div><div style={{fontSize:12,fontWeight:600}}>Lingua</div></div>
              <select value={lingua} onChange={function(e){setLingua(e.target.value);}} style={{padding:"7px 12px",borderRadius:8,border:"1px solid "+c.bd,background:c.inp,color:c.tx,fontSize:12,fontFamily:"inherit",outline:"none",cursor:"pointer"}}>
                <option value="it">🇮🇹 Italiano</option><option value="en">🇬🇧 English</option>
              </select>
            </div>
          </div>
          <div style={{background:c.card,borderRadius:12,padding:"16px",border:"1px solid "+c.bd}}>
            <div style={{fontSize:12,fontWeight:700,marginBottom:14}}>Backup Dati</div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 12px",borderRadius:8,background:c.bg}}>
                <div><div style={{fontSize:12,fontWeight:600}}>Esporta dati</div><div style={{fontSize:10,color:c.txm}}>Scarica backup completo JSON</div></div>
                <button onClick={exportData} style={{padding:"7px 14px",borderRadius:7,border:"1px solid "+c.bd,background:c.card,color:c.tx,fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>⬇ Esporta</button>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 12px",borderRadius:8,background:c.bg}}>
                <div><div style={{fontSize:12,fontWeight:600}}>Importa dati</div><div style={{fontSize:10,color:c.txm}}>Ripristina da backup JSON</div></div>
                <label style={{padding:"7px 14px",borderRadius:7,border:"1px solid "+c.bd,background:c.card,color:c.tx,fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                  ⬆ Importa<input type="file" accept=".json" onChange={importData} style={{display:"none"}}/>
                </label>
              </div>
            </div>
          </div>
          <div style={{background:c.card,borderRadius:12,padding:"16px",border:"1px solid "+c.bd}}>
            <div style={{fontSize:12,fontWeight:700,marginBottom:8}}>Info</div>
            <div style={{fontSize:10,color:c.txm,lineHeight:1.8}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <EdgeLabLogo size={20}/>
                  <div>
                    <div style={{fontSize:12,fontWeight:800,letterSpacing:"-0.02em"}}>EdgeLab</div>
                    <div style={{fontSize:9,color:"#6366F1",letterSpacing:"0.08em",textTransform:"uppercase"}}>Trade smarter, not harder</div>
                  </div>
                </div>
              <div style={{marginTop:6,padding:"8px 10px",borderRadius:7,background:c.ac+"10",border:"1px solid "+c.ac+"20",color:c.ac}}>✓ Tutti i dati salvati localmente nel browser. Zero server.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── OTTIMIZZAZIONE ────────────────────────────────────────────────────────────
function Ottimizzazione({c,trades,strategie,conti}){
  const [selConti,setSelConti]=useState([]);
  const [selStrat,setSelStrat]=useState([]);
  const [tab,setTab]=useState("storico");
  const [unit,setUnit]=useState("R");
  const [tp,setTp]=useState(2.0);
  const [be,setBe]=useState(0);
  const [botOpen,setBotOpen]=useState(false);
  const [targetWr,setTargetWr]=useState(null);
  const [nProj,setNProj]=useState(50);
  const [stressTest,setStressTest]=useState(false);
  const [stressMfe,setStressMfe]=useState(10); // % riduzione MFE
  const [stressMae,setStressMae]=useState(10); // % peggioramento MAE

  // filtro trade
  const filtered=trades.filter(function(t){
    if(selConti.length>0&&!selConti.includes(t.conto_id)) return false;
    if(selStrat.length>0&&!selStrat.includes(t.strategia_id)) return false;
    return true;
  });

  // calcola R massimo dai MFE reali (arrotondato a 0.1)
  const mfeR=filtered.filter(function(t){return t.mae!=null&&t.mfe!=null&&t.entry&&t.sl;}).map(function(t){
    const risk=Math.abs(t.entry-t.sl);
    if(risk===0) return 0;
    const mfePnl=t.direzione==="L"?(t.mfe-t.entry):(t.entry-t.mfe);
    return Math.round((mfePnl/risk)*10)/10;
  }).filter(function(r){return r>0;});
  const maxMfe=mfeR.length>0?Math.max.apply(null,mfeR):5;
  const pctMfe=filtered.length>0?Math.round((mfeR.length/filtered.length)*100):0;
  const lowMfeWarning=pctMfe<50&&filtered.length>0;

  // genera steps TP (0.5 → maxMfe, step 0.1)
  function genSteps(max){
    const steps=[];
    for(let v=0.5;v<=Math.max(max,5)+0.01;v=Math.round((v+0.1)*10)/10) steps.push(v);
    return steps;
  }
  const tpSteps=genSteps(maxMfe);
  const beSteps=[0,...tpSteps.filter(function(s){return s<tp;})];

  // simula un trade con parametri TP+BE usando MFE/MAE
  function simTrade(t,tpR,beR){
    if(!t.entry||!t.sl) return t.r_result;
    const risk=Math.abs(t.entry-t.sl);
    if(risk===0) return t.r_result;
    // calcola MFE e MAE in R
    let mfeInR=null,maeInR=null;
    if(t.mfe!=null){const pnl=t.direzione==="L"?(t.mfe-t.entry):(t.entry-t.mfe);mfeInR=pnl/risk;}
    if(t.mae!=null){const pnl=t.direzione==="L"?(t.mae-t.entry):(t.entry-t.mae);maeInR=pnl/risk;}
    if(mfeInR===null) return t.r_result; // no MFE, usa reale
    // STRESS TEST: MFE ridotto di stressMfe%, MAE peggiora di stressMae%
    if(stressTest){
      mfeInR=mfeInR*(1-stressMfe/100);
      if(maeInR!==null) maeInR=maeInR*(1+stressMae/100);
    }
    // prima controlla se MAE tocca SL prima che MFE tocchi TP
    if(maeInR!==null&&maeInR<=-1){
      if(beR>0&&mfeInR>=beR) return 0; // BE preso
      return -1; // SL pieno
    }
    // MFE raggiunge TP?
    if(mfeInR>=tpR) return tpR;
    // MFE non raggiunge TP — esce all'exit reale
    return stressTest?t.r_result*(1-stressMfe/100):t.r_result;
  }

  // calcola metriche simulate
  function calcSimMetrics(tradeList,tpR,beR){
    const results=tradeList.map(function(t){
      const r=simTrade(t,tpR,beR);
      const pnl=t.pnl_eur!=null?(r/t.r_result)*t.pnl_eur:null;
      return {r,pnl_eur:pnl};
    });
    const wins=results.filter(function(x){return x.r>0;});
    const losses=results.filter(function(x){return x.r<0;});
    const bes=results.filter(function(x){return x.r===0;});
    const totalR=parseFloat(results.reduce(function(s,x){return s+x.r;},0).toFixed(2));
    const totalEur=results.reduce(function(s,x){return s+(x.pnl_eur||0);},0);
    const wr=results.length>0?Math.round((wins.length/results.length)*100):0;
    const grossW=wins.reduce(function(s,x){return s+x.r;},0);
    const grossL=Math.abs(losses.reduce(function(s,x){return s+x.r;},0));
    const pf=grossL>0?parseFloat((grossW/grossL).toFixed(2)):grossW>0?999:0;
    const exp=results.length>0?parseFloat((totalR/results.length).toFixed(2)):0;
    // equity curve
    let eq=0;
    const curve=[{i:0,r:0,eur:0}];
    let eqEur=0;
    results.forEach(function(x,i){eq+=x.r;eqEur+=(x.pnl_eur||0);curve.push({i:i+1,r:parseFloat(eq.toFixed(2)),eur:parseFloat(eqEur.toFixed(2))});});
    // drawdown
    let peak=0,maxDD=0;
    curve.forEach(function(p){if(p.r>peak)peak=p.r;const dd=peak-p.r;if(dd>maxDD)maxDD=dd;});
    return {total:results.length,wins:wins.length,losses:losses.length,be:bes.length,wr,pf,exp,totalR,totalEur:parseFloat(totalEur.toFixed(2)),maxDD:parseFloat(maxDD.toFixed(2)),curve};
  }

  const simCurrent=calcSimMetrics(filtered,tp,be);

  // metriche reali per confronto
  const realMetrics=calcMetrics(filtered);
  const realEur=filtered.reduce(function(s,t){return s+(t.pnl_eur||0);},0);

  // BOT: trova combinazione ottimale TP+BE
  function findOptimal(targetWrPct){
    let best=null;
    tpSteps.forEach(function(tpR){
      const beOpts=[0,...tpSteps.filter(function(s){return s<tpR;})];
      beOpts.forEach(function(beR){
        const m=calcSimMetrics(filtered,tpR,beR);
        if(!best) {best={tpR,beR,m};return;}
        if(targetWrPct!=null){
          // cerca combo più profittevole con WR >= target
          if(m.wr>=targetWrPct&&m.totalR>best.m.totalR) best={tpR,beR,m};
          else if(best.m.wr<targetWrPct&&m.wr>best.m.wr) best={tpR,beR,m};
        } else {
          if(m.totalR>best.m.totalR) best={tpR,beR,m};
        }
      });
    });
    return best;
  }
  const optimal=filtered.length>0?findOptimal(targetWr):null;

  // proiezione futura: usa distribuzione R simulata
  function calcProiezione(){
    if(filtered.length===0) return [];
    const base=filtered.map(function(t){return simTrade(t,tp,be);});
    const proj=[];
    for(let i=0;i<nProj;i++){
      const idx=Math.floor(Math.random()*base.length);
      proj.push(base[idx]);
    }
    let eq=0;
    return [{i:0,r:0}].concat(proj.map(function(r,i){eq+=r;return {i:i+1,r:parseFloat(eq.toFixed(2))};}));
  }
  const [projCurve,setProjCurve]=useState([]);
  useEffect(function(){if(tab==="proiezione")setProjCurve(calcProiezione());},[tab,tp,be,nProj,filtered.length]);

  const capMap=makeCapMap(conti);
  const capContOtt=conti.filter(function(cn){return selConti.length===0||selConti.includes(cn.id);}).reduce(function(s,cn){return s+(cn.capitale_iniziale||cn.cap_iniz||0);},0);
  const totalPnlOtt=filtered.reduce(function(s,t){return s+(t.pnl_eur||0);},0);
  const totalPctOtt=calcTotalPct(filtered,capMap);
  function fmtVal(r,eur){
    if(unit==="R") return fmtR(r);
    if(unit==="$"&&eur!=null) return (eur>=0?"+":"")+"$"+Math.abs(eur).toFixed(0);
    if(unit==="%"){
      // usa pnl_eur/cap se disponibile, altrimenti mostra R
      if(eur!=null&&capContOtt>0) return (eur>=0?"+":"")+((eur/capContOtt)*100).toFixed(2)+"%";
      return fmtR(r);
    }
    return fmtR(r);
  }

  function toggleConto(id){setSelConti(function(p){return p.includes(id)?p.filter(function(x){return x!==id;}):[...p,id];});}
  function toggleStrat(id){setSelStrat(function(p){return p.includes(id)?p.filter(function(x){return x!==id;}):[...p,id];});}

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <ModuleHeader
        title="Ottimizzazione"
        subtitle={filtered.length+" trade nel campione"}
        tooltip="L'Ottimizzazione ti mostra come avresti dovuto gestire ogni trade — dove mettere il Take Profit, quando spostare lo Stop Loss a breakeven, se fare parziali — per massimizzare il risultato sui tuoi dati storici reali. Il Bot Automatico testa tutte le combinazioni possibili e ti dice quale avrebbe prodotto la curva equity migliore. La modalità Manuale ti permette di testare scenari specifici che hai in mente. Lo Stress Test simula condizioni di mercato peggiori (MFE ridotto, MAE peggiorato) per vedere quanto è robusta la tua strategia. Richiede che i trade abbiano il campo MFE compilato."
        c={c}
        right={
          <div style={{display:"flex",gap:2,background:c.tag,borderRadius:8,padding:2}}>
            {["R","$","%"].map(function(u){return(
              <button key={u} onClick={function(){setUnit(u);}} style={{padding:"4px 10px",borderRadius:6,border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:11,fontWeight:unit===u?700:400,background:unit===u?c.ac:"transparent",color:unit===u?"#fff":c.txm}}>{u}</button>
            );})}
          </div>
        }
      />
      {/* FILTRI MULTI-SELEZIONE */}
      <div style={{padding:"10px 20px",borderBottom:"1px solid "+c.bd,background:c.sb,display:"flex",gap:16,flexShrink:0}}>
        <div>
          <div style={{fontSize:9,fontWeight:700,color:c.txm,marginBottom:5,letterSpacing:"0.06em"}}>CONTI</div>
          <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
            {conti.map(function(cn){const sel=selConti.includes(cn.id);return(
              <button key={cn.id} onClick={function(){toggleConto(cn.id);}} style={{padding:"4px 10px",borderRadius:20,border:"1px solid "+(sel?c.ac:c.bd),background:sel?c.ac+"15":"transparent",color:sel?c.ac:c.txm,fontSize:11,fontWeight:sel?700:400,cursor:"pointer",fontFamily:"inherit"}}>{cn.nome}</button>
            );})}
            {conti.length===0&&<span style={{fontSize:10,color:c.txm}}>Nessun conto</span>}
          </div>
        </div>
        <div style={{width:1,background:c.bd}}/>
        <div>
          <div style={{fontSize:9,fontWeight:700,color:c.txm,marginBottom:5,letterSpacing:"0.06em"}}>STRATEGIE</div>
          <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
            {strategie.map(function(s){const sel=selStrat.includes(s.id);return(
              <button key={s.id} onClick={function(){toggleStrat(s.id);}} style={{padding:"4px 10px",borderRadius:20,border:"1px solid "+(sel?c.ac:c.bd),background:sel?c.ac+"15":"transparent",color:sel?c.ac:c.txm,fontSize:11,fontWeight:sel?700:400,cursor:"pointer",fontFamily:"inherit"}}>{s.nome}</button>
            );})}
            {strategie.length===0&&<span style={{fontSize:10,color:c.txm}}>Nessuna strategia</span>}
          </div>
        </div>
      </div>
      {/* TABS + STRESS TEST */}
      <div style={{padding:"0 20px",borderBottom:"1px solid "+c.bd,background:c.sb,display:"flex",gap:4,alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
        <div style={{display:"flex",gap:4,alignItems:"center"}}>
          {[{k:"storico",l:"📊 Storico"},{k:"proiezione",l:"🔮 Proiezione"}].map(function(t){const a=tab===t.k;return(
            <button key={t.k} onClick={function(){setTab(t.k);}} style={{padding:"8px 14px",border:"none",borderBottom:"2px solid "+(a?c.ac:"transparent"),background:"transparent",color:a?c.ac:c.txm,fontSize:12,fontWeight:a?700:400,cursor:"pointer",fontFamily:"inherit"}}>{t.l}</button>
          );})}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8,marginRight:4}}>
          {stressTest&&(
            <div style={{display:"flex",alignItems:"center",gap:10,padding:"4px 10px",borderRadius:8,background:c.rd+"10",border:"1px solid "+c.rd+"30"}}>
              <div style={{display:"flex",alignItems:"center",gap:5}}>
                <span style={{fontSize:9,fontWeight:700,color:c.rd}}>MFE -</span>
                <input type="range" min={5} max={50} step={5} value={stressMfe} onChange={function(e){setStressMfe(Number(e.target.value));}} style={{width:70,accentColor:c.rd}}/>
                <span style={{fontSize:10,fontWeight:700,color:c.rd,minWidth:28}}>{stressMfe}%</span>
              </div>
              <div style={{width:1,height:16,background:c.rd+"40"}}/>
              <div style={{display:"flex",alignItems:"center",gap:5}}>
                <span style={{fontSize:9,fontWeight:700,color:c.rd}}>MAE +</span>
                <input type="range" min={5} max={50} step={5} value={stressMae} onChange={function(e){setStressMae(Number(e.target.value));}} style={{width:70,accentColor:c.rd}}/>
                <span style={{fontSize:10,fontWeight:700,color:c.rd,minWidth:28}}>{stressMae}%</span>
              </div>
            </div>
          )}
          <button
            onClick={function(){setStressTest(!stressTest);}}
            title="Stress Test: simula slippage e imprecisione umana riducendo MFE e peggiorando MAE"
            style={{display:"flex",alignItems:"center",gap:5,padding:"5px 12px",borderRadius:20,border:"1px solid "+(stressTest?c.rd:c.bd),background:stressTest?c.rd+"15":"transparent",color:stressTest?c.rd:c.txm,fontSize:11,fontWeight:stressTest?700:400,cursor:"pointer",fontFamily:"inherit"}}
          >
            🔥 Stress {stressTest?"ON":"OFF"}
          </button>
        </div>
      </div>

      <div style={{flex:1,overflow:"auto",padding:"14px 20px"}}>
        <DisclaimerCampione n={filtered.length} c={c}/>
        {filtered.length===0?(
          <div style={{textAlign:"center",padding:"60px",color:c.txm,fontSize:13}}>Nessun trade nel campione. Seleziona un conto o inserisci dei trade.</div>
        ):(
          <>
            {/* STRESS TEST BANNER */}
            {stressTest&&(
              <div style={{padding:"8px 14px",borderRadius:9,background:c.rd+"10",border:"1px solid "+c.rd+"40",marginBottom:12,display:"flex",gap:8,alignItems:"center"}}>
                <span style={{fontSize:14}}>🔥</span>
                <span style={{fontSize:11,color:c.rd,fontWeight:600}}>Stress Test Attivo — MFE ridotto del {stressMfe}%, MAE peggiorato del {stressMae}%. I valori MFE/MAE sono modificati per simulare condizioni reali peggiori (slippage, uscite imprecise).</span>
              </div>
            )}
            {/* WARNING MFE */}
            {lowMfeWarning&&(
              <div style={{padding:"8px 14px",borderRadius:9,background:c.am+"12",border:"1px solid "+c.am+"40",marginBottom:12,display:"flex",gap:8,alignItems:"center"}}>
                <span style={{fontSize:14}}>⚠️</span>
                <span style={{fontSize:11,color:c.am,fontWeight:500}}>Solo {pctMfe}% dei trade ha MFE inserito. I risultati simulati potrebbero non essere accurati. Inserisci MFE su più trade per migliorare la qualità dell'analisi.</span>
              </div>
            )}

            {/* BOT BANNER */}
            {optimal&&(
              <div style={{marginBottom:12}}>
                <div onClick={function(){setBotOpen(!botOpen);}} style={{padding:"12px 16px",borderRadius:10,background:"linear-gradient(135deg,#0F766E15,#0D948815)",border:"1px solid #0F766E40",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <span style={{fontSize:18}}>🤖</span>
                    <div>
                      <div style={{fontSize:12,fontWeight:700,color:"#0F766E"}}>Bot Ottimizzazione — Combinazione Migliore Trovata</div>
                      <div style={{fontSize:11,color:"#0F766E",opacity:0.8}}>TP: {optimal.tpR}R · BE: {optimal.beR>0?optimal.beR+"R":"Nessuno"} → {fmtVal(optimal.m.totalR,optimal.m.totalEur)} · WR {optimal.m.wr}% · PF {optimal.m.pf}</div>
                    </div>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <button onClick={function(e){e.stopPropagation();setTp(optimal.tpR);setBe(optimal.beR);}} style={{padding:"5px 12px",borderRadius:7,background:"#0F766E",border:"none",color:"#fff",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>Applica</button>
                    <span style={{fontSize:12,color:"#0F766E"}}>{botOpen?"▲":"▼"}</span>
                  </div>
                </div>
                {botOpen&&(
                  <div style={{padding:"14px 16px",borderRadius:"0 0 10px 10px",background:c.card,border:"1px solid "+c.bd,borderTop:"none"}}>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
                      <div>
                        <div style={{fontSize:11,fontWeight:700,marginBottom:8}}>Parametri Ottimali</div>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                          {[{l:"TP",v:optimal.tpR+"R"},{l:"BE",v:optimal.beR>0?optimal.beR+"R":"Nessuno"},{l:"P/L",v:fmtVal(optimal.m.totalR,optimal.m.totalEur)},{l:"Win Rate",v:optimal.m.wr+"%"},{l:"Profit Factor",v:optimal.m.pf},{l:"Expectancy",v:fmtVal(optimal.m.exp,null)}].map(function(f,i){return(
                            <div key={i} style={{background:c.bg,borderRadius:7,padding:"7px 9px"}}><div style={{fontSize:8,color:c.txm,fontWeight:600}}>{f.l}</div><div style={{fontSize:12,fontWeight:700,color:"#0F766E"}}>{f.v}</div></div>
                          );})}
                        </div>
                      </div>
                      <div>
                        <div style={{fontSize:11,fontWeight:700,marginBottom:8}}>Personalizza Win Rate Target</div>
                        <div style={{fontSize:10,color:c.txm,marginBottom:8}}>Seleziona il win rate che preferisci — il bot trova la combo più profittevole con quel vincolo.</div>
                        <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:8}}>
                          {[null,40,50,55,60,65,70].map(function(w){const sel=targetWr===w;return(
                            <button key={w===null?"auto":w} onClick={function(){setTargetWr(w);}} style={{padding:"4px 9px",borderRadius:20,border:"1px solid "+(sel?"#0F766E":c.bd),background:sel?"#0F766E15":"transparent",color:sel?"#0F766E":c.txm,fontSize:11,fontWeight:sel?700:400,cursor:"pointer",fontFamily:"inherit"}}>{w===null?"Auto":w+"%"}</button>
                          );})}
                        </div>
                        {targetWr&&(function(){const cOpt=findOptimal(targetWr);return cOpt?(
                          <div style={{padding:"8px 10px",borderRadius:8,background:"#0F766E10",border:"1px solid #0F766E30"}}>
                            <div style={{fontSize:10,color:"#0F766E",fontWeight:600,marginBottom:4}}>Per WR ≥ {targetWr}% la combo migliore è:</div>
                            <div style={{fontSize:11,fontWeight:700,color:"#0F766E"}}>TP {cOpt.tpR}R · BE {cOpt.beR>0?cOpt.beR+"R":"Nessuno"} → {fmtVal(cOpt.m.totalR,cOpt.m.totalEur)} · WR {cOpt.m.wr}%</div>
                          </div>
                        ):null;})()}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* PARAMETRI */}
            <div style={{background:c.card,borderRadius:11,padding:"13px 16px",border:"1px solid "+c.bd,marginBottom:12}}>
              <div style={{fontSize:11,fontWeight:700,marginBottom:10}}>Parametri Simulazione</div>
              <div style={{display:"flex",gap:16,alignItems:"flex-end",flexWrap:"wrap"}}>
                <div>
                  <div style={{fontSize:9,fontWeight:700,color:c.txm,marginBottom:5}}>TAKE PROFIT</div>
                  <select value={tp} onChange={function(e){setTp(parseFloat(e.target.value));}} style={{padding:"7px 10px",borderRadius:8,border:"1px solid "+c.ac+"50",background:c.inp,color:c.tx,fontSize:12,fontFamily:"inherit",outline:"none",cursor:"pointer",minWidth:90}}>
                    {tpSteps.map(function(s){return <option key={s} value={s}>{s}R{s<=maxMfe&&mfeR.length>0?" ✓":""}</option>;})}
                  </select>
                  {mfeR.length>0&&<div style={{fontSize:9,color:c.gr,marginTop:3}}>MFE max reale: {maxMfe}R</div>}
                </div>
                <div>
                  <div style={{fontSize:9,fontWeight:700,color:c.txm,marginBottom:5}}>BREAKEVEN</div>
                  <select value={be} onChange={function(e){setBe(parseFloat(e.target.value));}} style={{padding:"7px 10px",borderRadius:8,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:12,fontFamily:"inherit",outline:"none",cursor:"pointer",minWidth:120}}>
                    {beSteps.map(function(s){return <option key={s} value={s}>{s===0?"Nessun BE":s+"R"}</option>;})}
                  </select>
                </div>
                {tab==="proiezione"&&(
                  <div>
                    <div style={{fontSize:9,fontWeight:700,color:c.txm,marginBottom:5}}>TRADE DA PROIETTARE</div>
                    <div style={{display:"flex",gap:5}}>
                      {[20,50,100,200,500].map(function(n){return(
                        <button key={n} onClick={function(){setNProj(n);}} style={{padding:"6px 10px",borderRadius:7,border:"1px solid "+(nProj===n?c.ac:c.bd),background:nProj===n?c.ac+"15":"transparent",color:nProj===n?c.ac:c.txm,fontSize:11,cursor:"pointer",fontFamily:"inherit",fontWeight:nProj===n?700:400}}>{n}</button>
                      );})}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* METRICHE SIMULATE VS REALI */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
              {[
                {l:"SIMULATO",m:simCurrent,eur:simCurrent.totalEur,col:"#0F766E"},
                {l:"REALE",m:realMetrics,eur:realEur,col:c.txm}
              ].map(function(block){return(
                <div key={block.l} style={{background:c.card,borderRadius:11,padding:"13px 15px",border:"1px solid "+(block.l==="SIMULATO"?"#0F766E40":c.bd)}}>
                  <div style={{fontSize:9,fontWeight:700,color:block.col,letterSpacing:"0.08em",marginBottom:10}}>{block.l}</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6}}>
                    {[
                      {l:"P/L",v:fmtVal(block.m.totalR,block.eur),col:block.m.totalR>=0?"#0F766E":c.rd},
                      {l:"Win Rate",v:block.m.wr+"%",col:block.m.wr>=50?"#0F766E":c.rd},
                      {l:"Profit Factor",v:block.m.pf,col:block.m.pf>=1.5?"#0F766E":block.m.pf>=1?c.am:c.rd},
                      {l:"Expectancy",v:fmtVal(block.m.exp,null),col:block.m.exp>=0?"#0F766E":c.rd},
                      {l:"Max DD",v:"-"+block.m.maxDD+"R",col:c.rd},
                      {l:"Trade",v:block.m.total,col:c.tx}
                    ].map(function(mm,i){return(
                      <div key={i} style={{background:c.bg,borderRadius:7,padding:"7px 9px"}}><div style={{fontSize:8,color:c.txm,fontWeight:600,marginBottom:2}}>{mm.l}</div><div style={{fontSize:12,fontWeight:700,color:mm.col}}>{mm.v}</div></div>
                    );})}
                  </div>
                </div>
              );})}
            </div>

            {/* EQUITY CURVE COMPARATIVA */}
            <div style={{background:c.card,borderRadius:11,padding:"13px 15px",border:"1px solid "+c.bd,marginBottom:12}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <div style={{fontSize:12,fontWeight:700}}>Equity Curve {tab==="storico"?"Storica":"Proiettata"}</div>
                <div style={{display:"flex",gap:10,fontSize:10,color:c.txm}}>
                  <span style={{display:"flex",alignItems:"center",gap:4}}><span style={{width:12,height:2,background:"#0F766E",display:"inline-block",borderRadius:2}}/> Simulato</span>
                  <span style={{display:"flex",alignItems:"center",gap:4}}><span style={{width:12,height:2,background:c.txm,display:"inline-block",borderRadius:2,opacity:0.5}}/> Reale</span>
                </div>
              </div>
              {(function(){
                const curve=tab==="storico"?simCurrent.curve:projCurve;
                const realCurve=buildEquityCurve(filtered,capMap);
                if(!curve||curve.length<2) return <div style={{height:120,display:"flex",alignItems:"center",justifyContent:"center",color:c.txm,fontSize:11}}>Nessun dato</div>;
                const W=500; const H=120; const PL=36; const PB=18;
                const allVals=[...curve.map(function(p){return unit==="$"?p.eur||p.r:p.r;}),...realCurve.map(function(p){return p.r;})];
                const minV=Math.min.apply(null,allVals);
                const maxV=Math.max.apply(null,allVals);
                const range=maxV-minV||1;
                const cH=H-PB; const cW=W-PL;
                const toX=function(i,len){return PL+(i/(len-1))*cW;};
                const toY=function(v){return cH-8-((v-minV)/range)*(cH-16);};
                const simPts=curve.map(function(p,i){return toX(i,curve.length)+","+toY(unit==="$"?(p.eur||p.r):p.r);}).join(" ");
                const realPts=realCurve.map(function(p,i){return toX(i,realCurve.length)+","+toY(p.r);}).join(" ");
                const lastSim=unit==="$"?(curve[curve.length-1].eur||curve[curve.length-1].r):curve[curve.length-1].r;
                const suffix=unit==="$"?"$":unit==="%"?"%":"R";
                return(
                  <svg width="100%" viewBox={"0 0 "+W+" "+H} style={{overflow:"visible"}}>
                    <text x={PL-3} y={toY(maxV)+3} textAnchor="end" fontSize="8" fill={c.txm}>{maxV>0?"+":""}{maxV}{suffix}</text>
                    <text x={PL-3} y={toY((maxV+minV)/2)+3} textAnchor="end" fontSize="8" fill={c.txm}>{((maxV+minV)/2).toFixed(1)}{suffix}</text>
                    <text x={PL-3} y={toY(minV)+3} textAnchor="end" fontSize="8" fill={c.txm}>{minV>0?"+":""}{minV}{suffix}</text>
                    {minV<0&&maxV>0&&<line x1={PL} y1={toY(0)} x2={W} y2={toY(0)} stroke={c.bd} strokeWidth="1" strokeDasharray="3,3"/>}
                    <text x={toX(0,realCurve.length)} y={H-3} textAnchor="middle" fontSize="7" fill={c.txm}>0</text>
                    <text x={toX(realCurve.length-1,realCurve.length)} y={H-3} textAnchor="middle" fontSize="7" fill={c.txm}>{realCurve.length-1}</text>
                    <polyline points={realPts} fill="none" stroke={c.txm} strokeWidth="1.5" strokeDasharray="4,3" strokeLinejoin="round" opacity="0.5"/>
                    <polyline points={simPts} fill="none" stroke="#0F766E" strokeWidth="2" strokeLinejoin="round"/>
                    <circle cx={toX(curve.length-1,curve.length)} cy={toY(lastSim)} r="4" fill="#0F766E"/>
                  </svg>
                );
              })()}
            </div>

            {/* DISTRIBUZIONE WIN/LOSS SIMULATA */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
              {[{l:"✓ Win",n:simCurrent.wins,tot:simCurrent.total,col:"#0F766E"},{l:"✗ Loss",n:simCurrent.losses,tot:simCurrent.total,col:c.rd},{l:"— BE",n:simCurrent.be,tot:simCurrent.total,col:c.am}].map(function(r,i){
                const pct=r.tot>0?Math.round((r.n/r.tot)*100):0;
                return(
                  <div key={i} style={{background:c.card,borderRadius:10,padding:"11px 13px",border:"1px solid "+c.bd}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}><span style={{fontSize:11,fontWeight:700,color:r.col}}>{r.l}</span><span style={{fontSize:12,fontWeight:700,color:r.col}}>{pct}%</span></div>
                    <div style={{height:4,borderRadius:3,background:c.bd}}><div style={{height:"100%",width:pct+"%",background:r.col,borderRadius:3}}/></div>
                    <div style={{fontSize:10,color:c.txm,marginTop:4}}>{r.n} trade</div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── SIM CAPITALE ─────────────────────────────────────────────────────────────
function SimCapitale({c,trades,strategie,conti}){
  const [selConti,setSelConti]=useState([]);
  const [selStrat,setSelStrat]=useState([]);
  const [capitale,setCapitale]=useState("10000");
  const [rischio,setRischio]=useState("1");
  const [modo,setModo]=useState("fisso");
  const [unit,setUnit]=useState("$");

  function toggleC(id){setSelConti(function(p){return p.includes(id)?p.filter(function(x){return x!==id;}):[...p,id];});}
  function toggleS(id){setSelStrat(function(p){return p.includes(id)?p.filter(function(x){return x!==id;}):[...p,id];});}

  const filtered=trades.filter(function(t){
    if(selConti.length>0&&!selConti.includes(t.conto_id)) return false;
    if(selStrat.length>0&&!selStrat.includes(t.strategia_id)) return false;
    return true;
  }).sort(function(a,b){return new Date(a.data_apertura)-new Date(b.data_apertura);});

  function simulate(tradeList,cap0,riskPct,compound){
    let cap=cap0; const curve=[{i:0,v:cap0}]; let peak=cap0,maxDD=0,maxDDpct=0;
    let curW=0,curL=0,maxW=0,maxL=0;
    tradeList.forEach(function(t,i){
      const base=compound?cap:cap0;
      const riskAmt=base*(riskPct/100);
      const gain=riskAmt*t.r_result;
      cap+=gain;
      curve.push({i:i+1,v:parseFloat(cap.toFixed(2))});
      if(cap>peak){peak=cap;}
      const dd=peak-cap; const ddPct=peak>0?(dd/peak)*100:0;
      if(dd>maxDD){maxDD=dd;maxDDpct=ddPct;}
      if(t.r_result>0){curW++;curL=0;if(curW>maxW)maxW=curW;}
      else if(t.r_result<0){curL++;curW=0;if(curL>maxL)maxL=curL;}
      else{curW=0;curL=0;}
    });
    return {curve,final:parseFloat(cap.toFixed(2)),profit:parseFloat((cap-cap0).toFixed(2)),profitPct:parseFloat(((cap-cap0)/cap0*100).toFixed(2)),maxDD:parseFloat(maxDD.toFixed(2)),maxDDpct:parseFloat(maxDDpct.toFixed(2)),maxW,maxL};
  }

  const cap0=parseFloat(capitale)||10000;
  const rsk=parseFloat(rischio)||1;

  const sim=filtered.length>0?simulate(filtered,cap0,rsk,modo==="compound"):null;
  // scenari: ottimistico (+20% rischio), pessimistico (-20% rischio, solo win)
  const simOtt=filtered.length>0?simulate(filtered,cap0,rsk*1.2,modo==="compound"):null;
  const simPess=filtered.length>0?simulate(filtered.map(function(t){return {...t,r_result:t.r_result<0?t.r_result*1.3:t.r_result*0.8};}),cap0,rsk,modo==="compound"):null;

  function fmtEur(v){return (v>=0?"+":"")+"$"+Math.abs(v).toLocaleString("it-IT",{minimumFractionDigits:0,maximumFractionDigits:0});}
  function fmtPct(v){return (v>=0?"+":"")+v.toFixed(1)+"%";}
  function dispVal(v,pct){return unit==="$"?fmtEur(v):unit==="%"?fmtPct(pct):fmtR(pct/100*2);}

  return(
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <ModuleHeader
        title="Simulatore Capitale"
        subtitle={filtered.length+" trade nel campione"}
        tooltip="Il Simulatore Capitale ti mostra come sarebbe cresciuto (o sceso) il tuo conto se avessi usato una gestione del rischio precisa e costante — ad esempio rischiando sempre l'1% o il 2% per trade. In modalità Composta il rischio si ricalcola sul capitale aggiornato dopo ogni trade, amplificando sia i guadagni che le perdite. In modalità Fissa usi sempre la stessa size in valore assoluto. Confronta la curva simulata con quella reale per capire se il tuo sizing attuale è ottimale. Mostra 3 scenari (base, ottimistico, prudente) con equity curve, drawdown e risultato finale. I risultati sono basati su performance passate: non garantiscono risultati futuri."
        c={c}
        right={
          <div style={{display:"flex",gap:2,background:c.tag,borderRadius:8,padding:2}}>
            {["$","%","R"].map(function(u){return <button key={u} onClick={function(){setUnit(u);}} style={{padding:"4px 10px",borderRadius:6,border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:11,fontWeight:unit===u?700:400,background:unit===u?c.ac:"transparent",color:unit===u?"#fff":c.txm}}>{u}</button>;})}
          </div>
        }
      />
      <div style={{padding:"10px 20px",borderBottom:"1px solid "+c.bd,background:c.sb,display:"flex",gap:16,flexShrink:0,flexWrap:"wrap"}}>
        <div><div style={{fontSize:9,fontWeight:700,color:c.txm,marginBottom:5}}>CONTI</div><div style={{display:"flex",gap:5,flexWrap:"wrap"}}>{conti.map(function(cn){const s=selConti.includes(cn.id);return <button key={cn.id} onClick={function(){toggleC(cn.id);}} style={{padding:"4px 10px",borderRadius:20,border:"1px solid "+(s?c.ac:c.bd),background:s?c.ac+"15":"transparent",color:s?c.ac:c.txm,fontSize:11,fontWeight:s?700:400,cursor:"pointer",fontFamily:"inherit"}}>{cn.nome}</button>;})}</div></div>
        <div style={{width:1,background:c.bd}}/>
        <div><div style={{fontSize:9,fontWeight:700,color:c.txm,marginBottom:5}}>STRATEGIE</div><div style={{display:"flex",gap:5,flexWrap:"wrap"}}>{strategie.map(function(s){const sel=selStrat.includes(s.id);return <button key={s.id} onClick={function(){toggleS(s.id);}} style={{padding:"4px 10px",borderRadius:20,border:"1px solid "+(sel?c.ac:c.bd),background:sel?c.ac+"15":"transparent",color:sel?c.ac:c.txm,fontSize:11,fontWeight:sel?700:400,cursor:"pointer",fontFamily:"inherit"}}>{s.nome}</button>;})}</div></div>
      </div>
      <div style={{flex:1,overflow:"auto",padding:"14px 20px"}}>
        <DisclaimerCampione n={filtered.length} c={c}/>
        <div style={{background:c.card,borderRadius:11,padding:"13px 16px",border:"1px solid "+c.bd,marginBottom:12,display:"flex",gap:16,alignItems:"flex-end",flexWrap:"wrap"}}>
          <div><div style={{fontSize:9,fontWeight:700,color:c.txm,marginBottom:4}}>CAPITALE INIZIALE ($)</div><input value={capitale} onChange={function(e){setCapitale(e.target.value);}} style={{padding:"7px 10px",borderRadius:8,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:13,fontFamily:"inherit",outline:"none",width:120}}/></div>
          <div><div style={{fontSize:9,fontWeight:700,color:c.txm,marginBottom:4}}>RISCHIO PER TRADE (%)</div><input value={rischio} onChange={function(e){setRischio(e.target.value);}} style={{padding:"7px 10px",borderRadius:8,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:13,fontFamily:"inherit",outline:"none",width:80}}/></div>
          <div><div style={{fontSize:9,fontWeight:700,color:c.txm,marginBottom:4}}>MODALITÀ</div><div style={{display:"flex",gap:6}}>{[{v:"fisso",l:"Fisso"},{v:"compound",l:"Compound"}].map(function(m){const a=modo===m.v;return <button key={m.v} onClick={function(){setModo(m.v);}} style={{padding:"6px 14px",borderRadius:8,border:"1px solid "+(a?c.ac:c.bd),background:a?c.ac+"15":"transparent",color:a?c.ac:c.txm,fontSize:12,fontWeight:a?700:400,cursor:"pointer",fontFamily:"inherit"}}>{m.l}</button>;})}</div></div>
        </div>
        {!sim?(
          <div style={{textAlign:"center",padding:"60px",color:c.txm,fontSize:13}}>Nessun trade nel campione.</div>
        ):(
          <>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:12}}>
              {[
                {l:"🎯 Base",s:sim,col:c.ac},
                {l:"📈 Ottimistico (+20% size)",s:simOtt,col:c.gr},
                {l:"📉 Pessimistico",s:simPess,col:c.rd}
              ].map(function(sc){return(
                <div key={sc.l} style={{background:c.card,borderRadius:11,padding:"12px 14px",border:"1px solid "+(sc.col+"40")}}>
                  <div style={{fontSize:10,fontWeight:700,color:sc.col,marginBottom:8}}>{sc.l}</div>
                  <div style={{fontSize:20,fontWeight:800,color:sc.s.profit>=0?c.gr:c.rd,marginBottom:4}}>{fmtEur(sc.s.profit)}</div>
                  <div style={{fontSize:11,color:sc.s.profitPct>=0?c.gr:c.rd,fontWeight:600,marginBottom:8}}>{fmtPct(sc.s.profitPct)}</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:5}}>
                    {[{l:"Capitale Finale",v:"$"+sc.s.final.toLocaleString("it-IT",{maximumFractionDigits:0}),tt:"Il tuo capitale al termine di tutti i trade nel campione, applicando il sizing simulato. Se è maggiore del capitale reale, questo sizing avrebbe fatto meglio di come hai operato realmente."},{l:"Max DD",v:"−$"+sc.s.maxDD.toLocaleString("it-IT",{maximumFractionDigits:0})+" ("+sc.s.maxDDpct.toFixed(1)+"%)",tt:"La perdita massima dal picco al minimo con questo sizing. Un sizing aggressivo produce più profitto ma anche drawdown più profondi — valuta se psicologicamente potresti reggere questo drawdown senza smettere di tradare."},{l:"Max Win Streak",v:sc.s.maxW,tt:"Il numero massimo di trade vincenti consecutivi con questo sizing. Ti dà un'idea dei periodi di euforia che potresti vivere — attenzione a non aumentare la size durante le serie positive."},{l:"Max Loss Streak",v:sc.s.maxL,tt:"Il numero massimo di trade perdenti consecutivi con questo sizing. Questo è il momento più duro da superare psicologicamente — avere una regola di stop preventiva per le serie negative è fondamentale."}].map(function(f,i){return(
                      <div key={i} style={{background:c.bg,borderRadius:6,padding:"6px 8px"}}><div style={{fontSize:8,color:c.txm,fontWeight:600,display:"flex",alignItems:"center",gap:2}}>{f.l}{f.tt&&<Tooltip c={c} text={f.tt}/>}</div><div style={{fontSize:11,fontWeight:700,color:c.tx}}>{f.v}</div></div>
                    );})}
                  </div>
                </div>
              );})}
            </div>
            {(function(){
              const curves=[{curve:sim.curve,col:c.ac,label:"Base"},{curve:simOtt.curve,col:c.gr,label:"Ottimistico"},{curve:simPess.curve,col:c.rd,label:"Pessimistico"}];
              const allV=curves.flatMap(function(sc){return sc.curve.map(function(p){return p.v;});});
              const minV=Math.min.apply(null,allV); const maxV=Math.max.apply(null,allV);
              const W=500,H=140,PL=56,PB=18;
              const cH=H-PB; const cW=W-PL;
              const toX=function(i,len){return PL+(i/(Math.max(len-1,1)))*cW;};
              const toY=function(v){return cH-8-((v-minV)/(maxV-minV||1))*(cH-16);};
              return(
                <div style={{background:c.card,borderRadius:11,padding:"13px 15px",border:"1px solid "+c.bd,marginBottom:12}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                    <div style={{fontSize:12,fontWeight:700}}>Equity Curve — Tutti gli Scenari</div>
                    <div style={{display:"flex",gap:10}}>
                      {curves.map(function(sc){return <span key={sc.label} style={{display:"flex",alignItems:"center",gap:4,fontSize:10,color:c.txm}}><span style={{width:12,height:2,background:sc.col,display:"inline-block",borderRadius:2}}/>{sc.label}</span>;})}
                    </div>
                  </div>
                  <svg width="100%" viewBox={"0 0 "+W+" "+H} style={{overflow:"visible"}}>
                    {[minV,(minV+maxV)/2,maxV].map(function(v,i){return(
                      <g key={i}>
                        <line x1={PL} y1={toY(v)} x2={W} y2={toY(v)} stroke={c.bd} strokeWidth="0.5" strokeDasharray="3,3"/>
                        <text x={PL-3} y={toY(v)+3} textAnchor="end" fontSize="8" fill={c.txm}>${Math.round(v).toLocaleString("it-IT")}</text>
                      </g>
                    );})}
                    {[0,Math.floor((sim.curve.length-1)/2),sim.curve.length-1].map(function(i){return <text key={i} x={toX(i,sim.curve.length)} y={H-3} textAnchor="middle" fontSize="7" fill={c.txm}>{i}</text>;})}
                    {curves.map(function(sc){const pts=sc.curve.map(function(p,i){return toX(i,sc.curve.length)+","+toY(p.v);}).join(" ");return <polyline key={sc.label} points={pts} fill="none" stroke={sc.col} strokeWidth="2" strokeLinejoin="round"/>;})}
                  </svg>
                </div>
              );
            })()}
          </>
        )}
      </div>
    </div>
  );
}

// ── MONTE CARLO ───────────────────────────────────────────────────────────────
function MonteCarlo({c,trades,strategie,conti}){
  const [selConti,setSelConti]=useState([]);
  const [selStrat,setSelStrat]=useState([]);
  const [capitale,setCapitale]=useState("10000");
  const [rischio,setRischio]=useState("1");
  const [nTrade,setNTrade]=useState(100);
  const [nSim,setNSim]=useState(500);
  const [ruinPct,setRuinPct]=useState(20);
  const [running,setRunning]=useState(false);
  const [results,setResults]=useState(null);
  const [showTooltip,setShowTooltip]=useState(false);

  function toggleC(id){setSelConti(function(p){return p.includes(id)?p.filter(function(x){return x!==id;}):[...p,id];});}
  function toggleS(id){setSelStrat(function(p){return p.includes(id)?p.filter(function(x){return x!==id;}):[...p,id];});}

  const filtered=trades.filter(function(t){
    if(selConti.length>0&&!selConti.includes(t.conto_id)) return false;
    if(selStrat.length>0&&!selStrat.includes(t.strategia_id)) return false;
    return true;
  });

  function runMC(){
    if(filtered.length===0) return;
    setRunning(true);
    setTimeout(function(){
      const cap0=parseFloat(capitale)||10000;
      const rsk=parseFloat(rischio)||1;
      const ruinThresh=cap0*(1-ruinPct/100);
      const rDist=filtered.map(function(t){return t.r_result;});
      const simResults=[];
      const sampleCurves=[];
      for(let s=0;s<nSim;s++){
        let cap=cap0; let peak=cap0; let maxDD=0; let maxW=0,maxL=0,curW=0,curL=0;
        let ruined=false;
        const curve=[cap0];
        for(let i=0;i<nTrade;i++){
          const r=rDist[Math.floor(Math.random()*rDist.length)];
          const gain=(cap*rsk/100)*r;
          cap+=gain;
          curve.push(parseFloat(cap.toFixed(2)));
          if(cap>peak)peak=cap;
          const dd=(peak-cap)/peak*100;
          if(dd>maxDD)maxDD=dd;
          if(r>0){curW++;curL=0;if(curW>maxW)maxW=curW;}
          else if(r<0){curL++;curW=0;if(curL>maxL)maxL=curL;}
          else{curW=0;curL=0;}
          if(cap<=ruinThresh)ruined=true;
        }
        simResults.push({final:parseFloat(cap.toFixed(2)),maxDD:parseFloat(maxDD.toFixed(1)),maxW,maxL,ruined,profit:parseFloat((cap-cap0).toFixed(2))});
        if(s<80) sampleCurves.push(curve);
      }
      simResults.sort(function(a,b){return a.final-b.final;});
      const finals=simResults.map(function(r){return r.final;});
      function perc(arr,p){return arr[Math.floor(arr.length*(p/100))];}
      const p5=perc(finals,5),p25=perc(finals,25),p50=perc(finals,50),p75=perc(finals,75),p95=perc(finals,95);
      const avgFinal=parseFloat((finals.reduce(function(s,v){return s+v;},0)/finals.length).toFixed(2));
      const avgDD=parseFloat((simResults.reduce(function(s,r){return s+r.maxDD;},0)/simResults.length).toFixed(1));
      const ruin=parseFloat((simResults.filter(function(r){return r.ruined;}).length/nSim*100).toFixed(1));
      const avgMaxL=parseFloat((simResults.reduce(function(s,r){return s+r.maxL;},0)/simResults.length).toFixed(1));
      setResults({finals,sampleCurves,p5,p25,p50,p75,p95,avgFinal,avgDD,ruin,avgMaxL,cap0,nTrade});
      setRunning(false);
    },50);
  }

  return(
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <ModuleHeader
        title="Monte Carlo"
        subtitle={filtered.length+" trade nel campione"}
        tooltip="Il Monte Carlo esegue migliaia di simulazioni rimescolando casualmente i tuoi trade storici per mostrarti la gamma di possibili futuri del tuo conto. Ti risponde a domande come: qual è la probabilità di andare in drawdown del 20%? Qual è il peggior scenario realistico con questa strategia? Quanto posso aspettarmi di guadagnare nei prossimi 100 trade? Il Fan Chart mostra tutte le traiettorie possibili — più le linee sono sparse, più il tuo sistema è volatile. Il Risk of Ruin indica la percentuale di simulazioni che portano il conto sotto zero o sotto una soglia critica — tienilo il più basso possibile."
        c={c}
      />
      <div style={{padding:"10px 20px",borderBottom:"1px solid "+c.bd,background:c.sb,display:"flex",gap:16,flexShrink:0,flexWrap:"wrap"}}>
        <div><div style={{fontSize:9,fontWeight:700,color:c.txm,marginBottom:5}}>CONTI</div><div style={{display:"flex",gap:5}}>{conti.map(function(cn){const s=selConti.includes(cn.id);return <button key={cn.id} onClick={function(){toggleC(cn.id);}} style={{padding:"4px 10px",borderRadius:20,border:"1px solid "+(s?c.ac:c.bd),background:s?c.ac+"15":"transparent",color:s?c.ac:c.txm,fontSize:11,fontWeight:s?700:400,cursor:"pointer",fontFamily:"inherit"}}>{cn.nome}</button>;})}</div></div>
        <div style={{width:1,background:c.bd}}/>
        <div><div style={{fontSize:9,fontWeight:700,color:c.txm,marginBottom:5}}>STRATEGIE</div><div style={{display:"flex",gap:5}}>{strategie.map(function(s){const sel=selStrat.includes(s.id);return <button key={s.id} onClick={function(){toggleS(s.id);}} style={{padding:"4px 10px",borderRadius:20,border:"1px solid "+(sel?c.ac:c.bd),background:sel?c.ac+"15":"transparent",color:sel?c.ac:c.txm,fontSize:11,fontWeight:sel?700:400,cursor:"pointer",fontFamily:"inherit"}}>{s.nome}</button>;})}</div></div>
      </div>
      <div style={{flex:1,overflow:"auto",padding:"14px 20px"}}>
        <DisclaimerCampione n={filtered.length} c={c}/>
        <div style={{background:c.card,borderRadius:11,padding:"13px 16px",border:"1px solid "+c.bd,marginBottom:12,display:"flex",gap:14,alignItems:"flex-end",flexWrap:"wrap"}}>
          {[{l:"CAPITALE ($)",v:capitale,set:setCapitale,w:100},{l:"RISCHIO %",v:rischio,set:setRischio,w:70}].map(function(f){return(
            <div key={f.l}><div style={{fontSize:9,fontWeight:700,color:c.txm,marginBottom:4}}>{f.l}</div><input value={f.v} onChange={function(e){f.set(e.target.value);}} style={{padding:"7px 10px",borderRadius:8,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:12,fontFamily:"inherit",outline:"none",width:f.w}}/></div>
          );})}
          <div><div style={{fontSize:9,fontWeight:700,color:c.txm,marginBottom:4}}>TRADE DA SIMULARE</div><div style={{display:"flex",gap:5}}>{[50,100,200,500].map(function(n){return <button key={n} onClick={function(){setNTrade(n);}} style={{padding:"5px 9px",borderRadius:7,border:"1px solid "+(nTrade===n?c.ac:c.bd),background:nTrade===n?c.ac+"15":"transparent",color:nTrade===n?c.ac:c.txm,fontSize:11,cursor:"pointer",fontFamily:"inherit",fontWeight:nTrade===n?700:400}}>{n}</button>;})}</div></div>
          <div><div style={{fontSize:9,fontWeight:700,color:c.txm,marginBottom:4}}>SIMULAZIONI</div><div style={{display:"flex",gap:5}}>{[100,500,1000].map(function(n){return <button key={n} onClick={function(){setNSim(n);}} style={{padding:"5px 9px",borderRadius:7,border:"1px solid "+(nSim===n?c.ac:c.bd),background:nSim===n?c.ac+"15":"transparent",color:nSim===n?c.ac:c.txm,fontSize:11,cursor:"pointer",fontFamily:"inherit",fontWeight:nSim===n?700:400}}>{n}</button>;})}</div></div>
          <div><div style={{fontSize:9,fontWeight:700,color:c.txm,marginBottom:4}}>SOGLIA RUIN (%DD)</div><div style={{display:"flex",gap:5}}>{[10,20,30,50].map(function(n){return <button key={n} onClick={function(){setRuinPct(n);}} style={{padding:"5px 9px",borderRadius:7,border:"1px solid "+(ruinPct===n?c.rd:c.bd),background:ruinPct===n?c.rd+"15":"transparent",color:ruinPct===n?c.rd:c.txm,fontSize:11,cursor:"pointer",fontFamily:"inherit",fontWeight:ruinPct===n?700:400}}>{n}%</button>;})}</div></div>
          <button onClick={runMC} disabled={running||filtered.length===0} style={{padding:"8px 20px",borderRadius:8,background:filtered.length===0?"#6366F150":"linear-gradient(135deg,#4F46E5,#7C3AED)",border:"none",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>{running?"⏳ Calcolo...":"▶ Avvia"}</button>
        </div>

        {results&&(
          <>
            <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8,marginBottom:12}}>
              {[
                {l:"Capitale Medio Finale",v:"$"+results.avgFinal.toLocaleString("it-IT",{maximumFractionDigits:0}),col:results.avgFinal>=results.cap0?c.gr:c.rd,tt:"Il capitale medio con cui finisci attraverso tutte le simulazioni. Se è sopra il capitale iniziale la tua strategia è mediamente profittevole. È la tua aspettativa realistica più probabile, ma ricorda che metà delle simulazioni finisce sotto questo valore e metà sopra."},
                {l:"Max DD Medio",v:"-"+results.avgDD+"%",col:c.rd,tt:"Il drawdown massimo medio che subisci nelle simulazioni — cioè la perdita più grande dal picco al minimo prima del recupero. In media, anche con una strategia vincente, subirai questa perdita prima di tornare ai massimi. Prepara la tua psicologia a sopportarla senza abbandonare la strategia."},
                {l:"Risk of Ruin",v:results.ruin+"%",col:results.ruin>10?c.rd:results.ruin>5?c.am:c.gr,tt:"La percentuale di simulazioni in cui il conto scende sotto la soglia di ruin che hai impostato (default 20% di perdita). Se è 5% significa che in 5 casi su 100 la tua strategia porta a perdite devastanti. Sotto il 2% è accettabile. Sopra il 10% dovresti ridurre il rischio per trade o rivedere la strategia."},
                {l:"Max Loss Streak Medio",v:results.avgMaxL,col:c.am,tt:"Il numero medio di trade perdenti consecutivi nelle simulazioni. Anche con una strategia vincente, avrai periodi di perdite consecutive — questo numero ti dice quante ne devi aspettare in media nel peggior momento. Usalo per calibrare la tua regola di stop: se arrivi a N perdite consecutive, fai una pausa e analizza."},
                {l:"Scenario Peggiore",v:"$"+results.finals[0].toLocaleString("it-IT",{maximumFractionDigits:0}),col:c.rd,tt:"Il capitale finale nella simulazione andata peggio tra tutte quelle eseguite. Non significa che accadrà sicuramente, ma è il worst case realistico basato sui tuoi dati storici. Se questo numero ti spaventa troppo, considera di ridurre il rischio per trade o di fermarti prima al raggiungimento di uno stop loss mensile."}
              ].map(function(m,i){return(
                <div key={i} style={{background:c.card,borderRadius:10,padding:"11px 12px",border:"1px solid "+c.bd}}>
                  <div style={{fontSize:8,color:c.txm,fontWeight:600,marginBottom:3,display:"flex",alignItems:"center",gap:2}}>{m.l}<Tooltip c={c} text={m.tt}/></div>
                  <div style={{fontSize:14,fontWeight:700,color:m.col}}>{m.v}</div>
                </div>
              );})}
            </div>

            {/* PERCENTILI con tooltip */}
            <div style={{background:c.card,borderRadius:11,padding:"13px 15px",border:"1px solid "+c.bd,marginBottom:12}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                <div style={{fontSize:12,fontWeight:700}}>Distribuzione Percentili</div>
                <div style={{position:"relative"}}>
                  <button onMouseEnter={function(){setShowTooltip(true);}} onMouseLeave={function(){setShowTooltip(false);}} style={{width:18,height:18,borderRadius:"50%",border:"1px solid "+c.bd,background:c.tag,color:c.txm,fontSize:10,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700}}>?</button>
                  {showTooltip&&(
                    <div style={{position:"absolute",left:"calc(100% + 8px)",top:"50%",transform:"translateY(-50%)",background:c.card,border:"1px solid "+c.bd,borderRadius:9,padding:"10px 12px",width:260,zIndex:200,boxShadow:"0 8px 24px rgba(0,0,0,0.15)"}}>
                      <div style={{fontSize:11,fontWeight:700,marginBottom:6}}>Cosa sono i percentili?</div>
                      <div style={{fontSize:10,color:c.txm,lineHeight:1.6}}>Su {nSim} simulazioni casuali dei tuoi trade:<br/><b style={{color:c.rd}}>5°</b> = nel 5% dei casi peggiori finisci qui<br/><b style={{color:c.am}}>25°</b> = scenario sfavorevole<br/><b style={{color:c.tx}}>50°</b> = risultato mediano (metà sopra, metà sotto)<br/><b style={{color:c.ac}}>75°</b> = scenario favorevole<br/><b style={{color:c.gr}}>95°</b> = nel 5% dei casi migliori finisci qui</div>
                    </div>
                  )}
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:6}}>
                {[{l:"5° percentile",v:results.p5,col:c.rd},{l:"25° percentile",v:results.p25,col:c.am},{l:"50° (mediana)",v:results.p50,col:c.tx},{l:"75° percentile",v:results.p75,col:c.ac},{l:"95° percentile",v:results.p95,col:c.gr}].map(function(p,i){return(
                  <div key={i} style={{background:c.bg,borderRadius:8,padding:"10px 12px",border:"1px solid "+(p.col+"30"),textAlign:"center"}}>
                    <div style={{fontSize:8,color:c.txm,fontWeight:600,marginBottom:3}}>{p.l}</div>
                    <div style={{fontSize:13,fontWeight:700,color:p.col}}>${p.v.toLocaleString("it-IT",{maximumFractionDigits:0})}</div>
                    <div style={{fontSize:9,color:p.v>=results.cap0?c.gr:c.rd}}>{p.v>=results.cap0?"+":""}{((p.v-results.cap0)/results.cap0*100).toFixed(1)}%</div>
                  </div>
                );})}
              </div>
            </div>

            {/* FAN CHART */}
            {(function(){
              const W=500,H=150,PL=56,PB=18;
              const cH=H-PB; const cW=W-PL;
              const allV=results.sampleCurves.flatMap(function(cv){return cv;});
              const minV=Math.min.apply(null,allV); const maxV=Math.max.apply(null,allV);
              const toX=function(i,len){return PL+(i/(Math.max(len-1,1)))*cW;};
              const toY=function(v){return cH-8-((v-minV)/(maxV-minV||1))*(cH-16);};
              const percCurves=[[results.p5],[results.p25],[results.p50],[results.p75],[results.p95]].map(function(p){return p[0];});
              return(
                <div style={{background:c.card,borderRadius:11,padding:"13px 15px",border:"1px solid "+c.bd}}>
                  <div style={{fontSize:12,fontWeight:700,marginBottom:10,display:"flex",alignItems:"center",gap:4}}>Fan Chart — {results.sampleCurves.length} simulazioni campione + percentili<Tooltip c={c} text="Questo grafico mostra migliaia di possibili futuri del tuo conto, simulati mescolando casualmente i tuoi trade storici. Ogni linea sottile è una possibile traiettoria. Le linee colorate mostrano i percentili: la linea rossa è il 5° percentile (le cose vanno male nel 95% dei casi meglio di così), la linea verde è il 95° percentile (le cose vanno bene), la linea grigia è la mediana (risultato più probabile). Più le linee sono sparse, più il tuo trading è volatile e imprevedibile."/></div>
                  <svg width="100%" viewBox={"0 0 "+W+" "+H} style={{overflow:"visible"}}>
                    {[minV,(minV+maxV)/2,maxV].map(function(v,i){return <text key={i} x={PL-3} y={toY(v)+3} textAnchor="end" fontSize="8" fill={c.txm}>${Math.round(v).toLocaleString("it-IT")}</text>;})}
                    {results.cap0!==undefined&&minV<results.cap0&&maxV>results.cap0&&<line x1={PL} y1={toY(results.cap0)} x2={W} y2={toY(results.cap0)} stroke={c.bd} strokeWidth="1" strokeDasharray="4,3"/>}
                    {results.sampleCurves.map(function(cv,si){const pts=cv.map(function(v,i){return toX(i,cv.length)+","+toY(v);}).join(" ");return <polyline key={si} points={pts} fill="none" stroke={c.ac} strokeWidth="0.8" strokeLinejoin="round" opacity="0.12"/>;})}
                    {[{p:results.p5,col:c.rd},{p:results.p95,col:c.gr},{p:results.p50,col:c.tx}].map(function(pk,i){
                      const idx=results.finals.indexOf(pk.p);
                      if(idx<0||!results.sampleCurves[Math.min(idx,results.sampleCurves.length-1)]) return null;
                      const cv=results.sampleCurves[Math.min(Math.floor(idx/nSim*results.sampleCurves.length),results.sampleCurves.length-1)];
                      const pts=cv.map(function(v,i){return toX(i,cv.length)+","+toY(v);}).join(" ");
                      return <polyline key={i} points={pts} fill="none" stroke={pk.col} strokeWidth="2" strokeLinejoin="round"/>;
                    })}
                  </svg>
                </div>
              );
            })()}
          </>
        )}
        {!results&&!running&&filtered.length>0&&(
          <div style={{textAlign:"center",padding:"60px",color:c.txm,fontSize:13}}>Configura i parametri e clicca ▶ Avvia per eseguire la simulazione.</div>
        )}
      </div>
    </div>
  );
}

// ── COACH ─────────────────────────────────────────────────────────────────────
function Coach({c,trades,strategie,conti}){
  const [selConti,setSelConti]=useState([]);
  const [selStrat,setSelStrat]=useState([]);
  const [tab,setTab]=useState("insight"); // insight | chat | report
  // Chat AI
  const [chatMessages,setChatMessages]=useState([]);
  const [chatInput,setChatInput]=useState("");
  const [chatLoading,setChatLoading]=useState(false);
  // Report AI
  const [aiReport,setAiReport]=useState("");
  const [reportLoading,setReportLoading]=useState(false);

  function toggleC(id){setSelConti(function(p){return p.includes(id)?p.filter(function(x){return x!==id;}):[...p,id];});}
  function toggleS(id){setSelStrat(function(p){return p.includes(id)?p.filter(function(x){return x!==id;}):[...p,id];});}
  const filtered=trades.filter(function(t){
    if(selConti.length>0&&!selConti.includes(t.conto_id)) return false;
    if(selStrat.length>0&&!selStrat.includes(t.strategia_id)) return false;
    return true;
  });

  // ── Costruisce contesto dati da mandare all'AI ──
  function buildDataContext(){
    const m=calcMetrics(filtered);
    const moods=["😌 Calmo","😐 Neutro","😰 Ansioso","😤 Frustrato","😵 Euforico","😴 Stanco"];
    const moodStats=moods.map(function(mood){
      const mt=filtered.filter(function(t){return t.mood===mood;});
      const mm=calcMetrics(mt);
      return {mood:mood.replace(/[^\w\s]/g,"").trim(),n:mt.length,wr:mm.wr,exp:mm.exp};
    }).filter(function(x){return x.n>0;});
    const stratStats=strategie.map(function(s){
      const st=filtered.filter(function(t){return t.strategia_id===s.id;});
      if(st.length===0) return null;
      const sm=calcMetrics(st);
      return {nome:s.nome,trade:st.length,wr:sm.wr,pf:sm.pf,exp:sm.exp,totalR:sm.totalR};
    }).filter(Boolean);
    const days=["Dom","Lun","Mar","Mer","Gio","Ven","Sab"];
    const dayStats=days.map(function(d,i){
      const dt=filtered.filter(function(t){return t.data_apertura&&new Date(t.data_apertura).getDay()===i;});
      if(dt.length<2) return null;
      const dm=calcMetrics(dt);
      return {giorno:d,n:dt.length,wr:dm.wr,exp:dm.exp};
    }).filter(Boolean);
    const recentTrades=filtered.slice(-10).map(function(t){return {data:t.data_apertura?t.data_apertura.slice(0,10):"?",asset:t.asset,dir:t.direzione,r:t.r_result,mood:t.mood||"",voto:t.sc_esecuzione||"?"};});
    return JSON.stringify({
      totale_trade:filtered.length,
      win_rate:m.wr,
      profit_factor:m.pf,
      expectancy:m.exp,
      total_r:m.totalR,
      max_drawdown:m.maxDD,
      streak:{maxWin:m.streak.maxW,maxLoss:m.streak.maxL},
      per_stato_mentale:moodStats,
      per_strategia:stratStats,
      per_giorno:dayStats,
      ultimi_10_trade:recentTrades,
    },null,2);
  }

  // ── Insight statici (esistenti) ──
  function genInsights(){
    const insights=[];
    if(filtered.length<3) return insights;
    const m=calcMetrics(filtered);
    const moods=["😌 Calmo","😐 Neutro","😰 Ansioso","😤 Frustrato","😵 Euforico","😴 Stanco"];
    moods.forEach(function(mood){
      const mt=filtered.filter(function(t){return t.mood===mood;});
      if(mt.length<2) return;
      const mm=calcMetrics(mt);
      if(mm.wr<m.wr-10) insights.push({type:"alert",cat:"🧠 Comportamento",text:"Con stato mentale "+mood+" il tuo win rate scende al "+mm.wr+"% vs "+m.wr+"% medio.",col:"#DC2626"});
      if(mm.wr>m.wr+10) insights.push({type:"positive",cat:"🧠 Comportamento",text:"Rendi meglio quando sei "+mood+": win rate "+mm.wr+"% vs "+m.wr+"% medio.",col:"#16A34A"});
    });
    const highExec=filtered.filter(function(t){return t.sc_esecuzione>=8;});
    const lowExec=filtered.filter(function(t){return t.sc_esecuzione!=null&&t.sc_esecuzione<=5;});
    if(highExec.length>=2&&lowExec.length>=2){
      const mH=calcMetrics(highExec); const mL=calcMetrics(lowExec);
      if(mH.wr>mL.wr+5) insights.push({type:"positive",cat:"🧠 Comportamento",text:"Con voto esecuzione ≥8 il WR è "+mH.wr+"% vs "+mL.wr+"% con voto ≤5. Il piano funziona.",col:"#16A34A"});
    }
    let streak=0,maxStreak=0;
    filtered.forEach(function(t){if(t.r_result<0){streak++;maxStreak=Math.max(maxStreak,streak);}else{streak=0;}});
    if(maxStreak>=4) insights.push({type:"alert",cat:"⚡ Alert",text:"Hai raggiunto una losing streak di "+maxStreak+" trade consecutivi. Considera uno stop giornaliero.",col:"#DC2626"});
    for(let i=2;i<filtered.length;i++){
      const prev2=filtered.slice(i-2,i);
      if(prev2.every(function(t){return t.r_result<0;})&&filtered[i].sc_esecuzione!=null&&filtered[i].sc_esecuzione<=5){
        insights.push({type:"alert",cat:"⚡ Alert",text:"Pattern tilt: dopo 2 loss consecutive il voto di esecuzione scende sotto 5. Pausa obbligatoria.",col:"#D97706"});
        break;
      }
    }
    const days=["Dom","Lun","Mar","Mer","Gio","Ven","Sab"];
    const dayStats=days.map(function(d,i){
      const dt=filtered.filter(function(t){return t.data_apertura&&new Date(t.data_apertura).getDay()===i;});
      if(dt.length<2) return null;
      const dm=calcMetrics(dt);
      return {d,n:dt.length,wr:dm.wr,exp:dm.exp};
    }).filter(Boolean);
    if(dayStats.length>1){
      const bestDay=dayStats.reduce(function(a,b){return b.exp>a.exp?b:a;});
      const worstDay=dayStats.reduce(function(a,b){return b.exp<a.exp?b:a;});
      const bestDayWR=dayStats.reduce(function(a,b){return b.wr>a.wr?b:a;});
      insights.push({type:"positive",cat:"📅 Giorni",text:"Giorno migliore per expectancy: "+bestDay.d+" (Exp "+fmtR(bestDay.exp)+", WR "+bestDay.wr+"%, "+bestDay.n+" trade).",col:"#16A34A"});
      if(bestDayWR.d!==bestDay.d) insights.push({type:"positive",cat:"📅 Giorni",text:"Giorno migliore per win rate: "+bestDayWR.d+" (WR "+bestDayWR.wr+"%). Utile se il tuo obiettivo è la consistenza.",col:"#16A34A"});
      if(worstDay.exp<0) insights.push({type:"alert",cat:"📅 Giorni",text:worstDay.d+": expectancy negativa ("+fmtR(worstDay.exp)+", WR "+worstDay.wr+"%). Valuta di evitarlo o ridurre la size.",col:"#DC2626"});
    }

    // ── ORE MIGLIORI ──
    const hours=Array.from({length:24},function(_,h){return h;});
    const hourStats=hours.map(function(h){
      const ht=filtered.filter(function(t){return t.data_apertura&&new Date(t.data_apertura).getUTCHours()===h;});
      if(ht.length<2) return null;
      const hm=calcMetrics(ht);
      return {h,n:ht.length,wr:hm.wr,exp:hm.exp};
    }).filter(Boolean);
    if(hourStats.length>1){
      const bestHour=hourStats.reduce(function(a,b){return b.exp>a.exp?b:a;});
      const worstHour=hourStats.reduce(function(a,b){return b.exp<a.exp?b:a;});
      const bestSess=bestHour.h<8?"Asian":bestHour.h<13?"London":bestHour.h<22?"NY":"Asian";
      insights.push({type:"positive",cat:"🕐 Orari",text:"Ora migliore: "+bestHour.h+":00 UTC (sessione "+bestSess+") — Exp "+fmtR(bestHour.exp)+", WR "+bestHour.wr+"%, "+bestHour.n+" trade. Concentra l'attività in questa fascia.",col:"#16A34A"});
      if(worstHour.exp<-0.2) insights.push({type:"alert",cat:"🕐 Orari",text:"Ora peggiore: "+worstHour.h+":00 UTC — Exp "+fmtR(worstHour.exp)+", WR "+worstHour.wr+"%, "+worstHour.n+" trade. Evita di entrare in questa fascia.",col:"#DC2626"});
    }

    // ── DURATA TRADE ──
    const durAll=filtered.filter(function(t){return t.data_apertura&&t.data_chiusura;});
    if(durAll.length>=3){
      const durWin=durAll.filter(function(t){return t.r_result>0;});
      const durLoss=durAll.filter(function(t){return t.r_result<0;});
      const avgAll=durAll.reduce(function(s,t){return s+(new Date(t.data_chiusura)-new Date(t.data_apertura))/60000;},0)/durAll.length;
      const avgWin=durWin.length>0?durWin.reduce(function(s,t){return s+(new Date(t.data_chiusura)-new Date(t.data_apertura))/60000;},0)/durWin.length:0;
      const avgLoss=durLoss.length>0?durLoss.reduce(function(s,t){return s+(new Date(t.data_chiusura)-new Date(t.data_apertura))/60000;},0)/durLoss.length:0;
      function fmtDurI(min){if(min<60)return Math.round(min)+"min";return Math.floor(min/60)+"h "+Math.round(min%60)+"m";}
      if(avgWin>0&&avgLoss>0){
        if(avgLoss>avgWin*1.4) insights.push({type:"alert",cat:"⏱ Durata",text:"I trade perdenti durano "+fmtDurI(avgLoss)+" vs "+fmtDurI(avgWin)+" dei vincenti. Tieni le perdite aperte troppo a lungo — stai sperando in un recupero. Rispetta lo SL.",col:"#DC2626"});
        if(avgWin>avgLoss*1.4) insights.push({type:"positive",cat:"⏱ Durata",text:"I trade vincenti durano "+fmtDurI(avgWin)+" vs "+fmtDurI(avgLoss)+" dei perdenti. Ottimo: lasci correre i profitti e tagli veloce le perdite.",col:"#16A34A"});
      }
      insights.push({type:"positive",cat:"⏱ Durata",text:"Durata media trade: "+fmtDurI(avgAll)+" (Win: "+fmtDurI(avgWin)+" | Loss: "+fmtDurI(avgLoss)+").",col:c.tx||"#6B7280"});
    }

    const mfeArr=filtered.filter(function(t){return t.mfe!=null&&t.entry&&t.sl;}).map(function(t){
      const risk=Math.abs(t.entry-t.sl); if(risk===0) return null;
      const pnl=t.direzione==="L"?(t.mfe-t.entry):(t.entry-t.mfe);
      return pnl/risk;
    }).filter(function(r){return r!=null&&r>0;});
    if(mfeArr.length>=3){
      const avgMfe=parseFloat((mfeArr.reduce(function(s,v){return s+v;},0)/mfeArr.length).toFixed(2));
      const avgExit=parseFloat((filtered.reduce(function(s,t){return s+t.r_result;},0)/filtered.length).toFixed(2));
      if(avgMfe>avgExit+0.5) insights.push({type:"positive",cat:"📊 Ottimizzazione",text:"MFE medio "+avgMfe+"R vs uscita media "+avgExit+"R. Lasci "+parseFloat((avgMfe-avgExit).toFixed(2))+"R per trade sul tavolo.",col:"#2563EB"});
    }
    strategie.forEach(function(s){
      const st=filtered.filter(function(t){return t.strategia_id===s.id;});
      if(st.length<3) return;
      const sm=calcMetrics(st);
      if(sm.pf>2) insights.push({type:"positive",cat:"◈ Strategia",text:"'"+s.nome+"' — PF "+sm.pf+" su "+st.length+" trade. La tua edge più forte.",col:"#16A34A"});
      if(sm.pf<0.8) insights.push({type:"alert",cat:"◈ Strategia",text:"'"+s.nome+"' — PF "+sm.pf+" su "+st.length+" trade. Metti in pausa e analizza.",col:"#DC2626"});
    });
    const avgIntegrity=filtered.length>0?Math.round(filtered.reduce(function(s,t){return s+calcIntegrityScore(t);},0)/filtered.length):0;
    if(avgIntegrity<50&&filtered.length>=5) insights.push({type:"alert",cat:"🔍 Audit",text:"Integrity Score medio "+avgIntegrity+"/100. Completa MAE/MFE e note per analisi più accurate.",col:"#7C3AED"});
    if(avgIntegrity>=80&&filtered.length>=5) insights.push({type:"positive",cat:"🔍 Audit",text:"Integrity Score medio "+avgIntegrity+"/100 — ottima disciplina nella documentazione.",col:"#16A34A"});
    return insights;
  }

  // ── Chat AI ──
  async function sendChat(){
    if(!chatInput.trim()||chatLoading) return;
    const userMsg=chatInput.trim();
    setChatInput("");
    const newMessages=[...chatMessages,{role:"user",content:userMsg}];
    setChatMessages(newMessages);
    setChatLoading(true);
    try{
      const ctx=buildDataContext();
      const systemPrompt=`Sei EdgeLab Coach, un assistente esperto di trading psychology e analisi statistica. 
Hai accesso ai dati reali del trader. Rispondi in italiano, in modo conciso e diretto.
Usa sempre numeri concreti dai dati. Evita consigli generici.
Dati del trader (JSON):
${ctx}`;
      const res=await fetch("https://api.anthropic.com/v1/messages",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          model:"claude-sonnet-4-20250514",
          max_tokens:1000,
          system:systemPrompt,
          messages:newMessages.map(function(m){return {role:m.role,content:m.content};})
        })
      });
      const data=await res.json();
      const reply=data.content?data.content.map(function(b){return b.text||"";}).join(""):"Errore nella risposta AI.";
      setChatMessages(function(p){return [...p,{role:"assistant",content:reply}];});
    }catch(err){
      setChatMessages(function(p){return [...p,{role:"assistant",content:"⚠ Errore di connessione: "+err.message}];});
    }
    setChatLoading(false);
  }

  // ── Report AI settimanale ──
  async function generateReport(){
    if(reportLoading) return;
    setReportLoading(true);
    setAiReport("");
    try{
      const ctx=buildDataContext();
      const prompt=`Analizza i dati di trading qui sotto e produci un report settimanale professionale in italiano.
Struttura il report con queste sezioni:
1. SINTESI PERFORMANCE (2-3 frasi chiave sui numeri)
2. PUNTI DI FORZA (cosa sta funzionando bene, con dati specifici)
3. AREE DI MIGLIORAMENTO (problemi concreti rilevati dai dati)
4. COMPORTAMENTO E PSICOLOGIA (analisi stato mentale, pattern tilt)
5. RACCOMANDAZIONI (3-5 azioni concrete e specifiche per la prossima settimana)

Usa numeri reali dai dati. Sii diretto e specifico. Evita frasi generiche.
Dati del trader:
${ctx}`;
      const res=await fetch("https://api.anthropic.com/v1/messages",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:1000,messages:[{role:"user",content:prompt}]})
      });
      const data=await res.json();
      const reply=data.content?data.content.map(function(b){return b.text||"";}).join(""):"Errore nella risposta AI.";
      setAiReport(reply);
    }catch(err){
      setAiReport("⚠ Errore: "+err.message);
    }
    setReportLoading(false);
  }

  const insights=genInsights();
  const alerts=insights.filter(function(i){return i.type==="alert";});
  const positives=insights.filter(function(i){return i.type==="positive";});

  return(
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <ModuleHeader
        title="Coach"
        subtitle={filtered.length+" trade · "+insights.length+" insight"}
        tooltip="Il Coach analizza tutti i tuoi dati e ti segnala pattern che altrimenti non vedresti mai. Tab Insight: regole statistiche calcolate in automatico su comportamento, timing, esecuzione e qualità dati — zero AI, puro calcolo sui tuoi numeri reali. Tab AI Chat: puoi fare domande libere come 'perché perdo il lunedì?' o 'qual è la mia ora migliore?' e Claude ti risponde usando i tuoi dati reali come contesto. Tab AI Report: genera un report completo settimanale con analisi, punti di forza, aree di miglioramento e raccomandazioni concrete per la settimana successiva."
        c={c}
      />
      <div style={{padding:"8px 20px",borderBottom:"1px solid "+c.bd,background:c.sb,display:"flex",gap:12,flexShrink:0,flexWrap:"wrap",alignItems:"center"}}>
        <div style={{display:"flex",gap:5}}>{conti.map(function(cn){const s=selConti.includes(cn.id);return <button key={cn.id} onClick={function(){toggleC(cn.id);}} style={{padding:"3px 9px",borderRadius:20,border:"1px solid "+(s?c.ac:c.bd),background:s?c.ac+"15":"transparent",color:s?c.ac:c.txm,fontSize:11,fontWeight:s?700:400,cursor:"pointer",fontFamily:"inherit"}}>{cn.nome}</button>;})}</div>
        <div style={{width:1,background:c.bd,height:16}}/>
        <div style={{display:"flex",gap:5}}>{strategie.map(function(s){const sel=selStrat.includes(s.id);return <button key={s.id} onClick={function(){toggleS(s.id);}} style={{padding:"3px 9px",borderRadius:20,border:"1px solid "+(sel?c.ac:c.bd),background:sel?c.ac+"15":"transparent",color:sel?c.ac:c.txm,fontSize:11,fontWeight:sel?700:400,cursor:"pointer",fontFamily:"inherit"}}>{s.nome}</button>;})}</div>
      </div>
      {/* TABS */}
      <div style={{padding:"0 20px",borderBottom:"1px solid "+c.bd,background:c.sb,display:"flex",flexShrink:0}}>
        {[["insight","💡 Insight"],["chat","🤖 AI Chat"],["report","📄 AI Report"]].map(function(t){const active=tab===t[0];return(
          <button key={t[0]} onClick={function(){setTab(t[0]);}} style={{padding:"9px 16px",border:"none",borderBottom:active?"2px solid "+c.ac:"2px solid transparent",background:"transparent",color:active?c.ac:c.txm,fontSize:11,fontWeight:active?700:400,cursor:"pointer",fontFamily:"inherit"}}>{t[1]}</button>
        );})}
      </div>
      <div style={{flex:1,overflow:"auto",padding:"14px 20px"}}>
        <DisclaimerCampione n={filtered.length} c={c}/>

        {/* ── TAB: INSIGHT STATISTICI ── */}
        {tab==="insight"&&(
          filtered.length<3?(
            <div style={{textAlign:"center",padding:"60px",color:c.txm,fontSize:13}}>Inserisci almeno 3 trade per generare insight.</div>
          ):(
            <>
              {insights.length===0&&<div style={{textAlign:"center",padding:"40px",color:c.txm,fontSize:13}}>Nessun pattern significativo. Inserisci più trade con dati completi.</div>}
              {alerts.length>0&&(
                <div style={{marginBottom:14}}>
                  <div style={{fontSize:11,fontWeight:700,color:c.rd,marginBottom:8,letterSpacing:"0.06em"}}>⚠ ALERT — DA CORREGGERE</div>
                  <div style={{display:"flex",flexDirection:"column",gap:7}}>
                    {alerts.map(function(ins,i){return(
                      <div key={i} style={{padding:"11px 14px",borderRadius:10,background:ins.col+"0D",border:"1px solid "+ins.col+"30",display:"flex",gap:10}}>
                        <span style={{fontSize:11,fontWeight:700,color:ins.col,flexShrink:0,paddingTop:1}}>{ins.cat}</span>
                        <span style={{fontSize:11,color:c.tx,lineHeight:1.6}}>{ins.text}</span>
                      </div>
                    );})}
                  </div>
                </div>
              )}
              {positives.length>0&&(
                <div>
                  <div style={{fontSize:11,fontWeight:700,color:c.gr,marginBottom:8,letterSpacing:"0.06em"}}>✓ PUNTI DI FORZA</div>
                  <div style={{display:"flex",flexDirection:"column",gap:7}}>
                    {positives.map(function(ins,i){return(
                      <div key={i} style={{padding:"11px 14px",borderRadius:10,background:ins.col+"0D",border:"1px solid "+ins.col+"30",display:"flex",gap:10}}>
                        <span style={{fontSize:11,fontWeight:700,color:ins.col,flexShrink:0,paddingTop:1}}>{ins.cat}</span>
                        <span style={{fontSize:11,color:c.tx,lineHeight:1.6}}>{ins.text}</span>
                      </div>
                    );})}
                  </div>
                </div>
              )}
            </>
          )
        )}

        {/* ── TAB: AI CHAT ── */}
        {tab==="chat"&&(
          <div style={{display:"flex",flexDirection:"column",height:"calc(100vh - 260px)",gap:0}}>
            <div style={{background:c.ac+"08",borderRadius:10,padding:"10px 14px",marginBottom:12,border:"1px solid "+c.ac+"20"}}>
              <div style={{fontSize:11,color:c.ac,fontWeight:600,marginBottom:2}}>🤖 Coach AI — Chat sui tuoi dati</div>
              <div style={{fontSize:10,color:c.txm,lineHeight:1.6}}>Fai domande sui tuoi trade, pattern, strategie. L'AI ha accesso ai tuoi dati reali. Es: "Perché perdo il lunedì?", "Qual è la mia strategia migliore?", "Come migliorare l'esecuzione?"</div>
            </div>
            <div style={{flex:1,overflow:"auto",display:"flex",flexDirection:"column",gap:10,paddingBottom:12}}>
              {chatMessages.length===0&&(
                <div style={{display:"flex",flexDirection:"column",gap:8,marginTop:8}}>
                  <div style={{fontSize:10,color:c.txm,fontWeight:600,marginBottom:4}}>Domande suggerite:</div>
                  {["Qual è il mio stato mentale più profittevole?","Quale strategia dovrei usare di più?","Dove sto lasciando più R sul tavolo?","Cosa succede dopo una losing streak?","Quale giorno della settimana è il mio migliore?"].map(function(q){return(
                    <button key={q} onClick={function(){setChatInput(q);}} style={{textAlign:"left",padding:"8px 12px",borderRadius:9,border:"1px solid "+c.bd,background:c.card,color:c.tx,fontSize:11,cursor:"pointer",fontFamily:"inherit",lineHeight:1.5}}>{q}</button>
                  );})}
                </div>
              )}
              {chatMessages.map(function(msg,i){return(
                <div key={i} style={{display:"flex",justifyContent:msg.role==="user"?"flex-end":"flex-start"}}>
                  <div style={{maxWidth:"80%",padding:"10px 14px",borderRadius:msg.role==="user"?"14px 14px 4px 14px":"14px 14px 14px 4px",background:msg.role==="user"?c.ac:c.card,color:msg.role==="user"?"#fff":c.tx,fontSize:12,lineHeight:1.65,border:msg.role==="user"?"none":"1px solid "+c.bd,whiteSpace:"pre-wrap"}}>
                    {msg.content}
                  </div>
                </div>
              );})}
              {chatLoading&&(
                <div style={{display:"flex",justifyContent:"flex-start"}}>
                  <div style={{padding:"10px 14px",borderRadius:"14px 14px 14px 4px",background:c.card,border:"1px solid "+c.bd,fontSize:12,color:c.txm}}>
                    <span>⟳ Coach sta analizzando i dati</span>
                  </div>
                </div>
              )}
            </div>
            <div style={{display:"flex",gap:8,flexShrink:0,borderTop:"1px solid "+c.bd,paddingTop:12}}>
              <input
                value={chatInput}
                onChange={function(e){setChatInput(e.target.value);}}
                onKeyDown={function(e){if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendChat();}}}
                placeholder="Scrivi una domanda sui tuoi trade..."
                style={{flex:1,padding:"10px 14px",borderRadius:10,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:12,fontFamily:"inherit",outline:"none"}}
              />
              <button onClick={sendChat} disabled={chatLoading||!chatInput.trim()} style={{padding:"10px 18px",borderRadius:10,background:chatLoading||!chatInput.trim()?c.bd:c.ac,border:"none",color:chatLoading||!chatInput.trim()?c.txm:"#fff",fontSize:12,fontWeight:600,cursor:chatLoading||!chatInput.trim()?"not-allowed":"pointer",fontFamily:"inherit"}}>
                {chatLoading?"...":"Invia"}
              </button>
            </div>
          </div>
        )}

        {/* ── TAB: AI REPORT ── */}
        {tab==="report"&&(
          <div>
            <div style={{background:c.card,borderRadius:11,padding:"14px 16px",border:"1px solid "+c.bd,marginBottom:14}}>
              <div style={{fontSize:12,fontWeight:700,marginBottom:6}}>📄 Report AI Settimanale</div>
              <div style={{fontSize:11,color:c.txm,marginBottom:14,lineHeight:1.65}}>Claude analizza i tuoi {filtered.length} trade e produce un report completo con sintesi performance, punti di forza, aree di miglioramento e raccomandazioni concrete per la prossima settimana.</div>
              <button onClick={generateReport} disabled={reportLoading||filtered.length<3} style={{padding:"10px 20px",borderRadius:9,background:reportLoading||filtered.length<3?c.bd:c.ac,border:"none",color:reportLoading||filtered.length<3?c.txm:"#fff",fontSize:12,fontWeight:600,cursor:reportLoading||filtered.length<3?"not-allowed":"pointer",fontFamily:"inherit"}}>
                {reportLoading?"⟳ Generando report...":"🚀 Genera Report AI"}
              </button>
              {filtered.length<3&&<div style={{fontSize:10,color:c.txm,marginTop:6}}>Servono almeno 3 trade per generare il report.</div>}
            </div>
            {aiReport&&(
              <div style={{background:c.card,borderRadius:11,padding:"16px 18px",border:"1px solid "+c.bd}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                  <div style={{fontSize:12,fontWeight:700}}>Report generato</div>
                  <button onClick={function(){navigator.clipboard.writeText(aiReport);}} style={{padding:"5px 12px",borderRadius:7,border:"1px solid "+c.bd,background:"transparent",color:c.txm,fontSize:10,cursor:"pointer",fontFamily:"inherit"}}>📋 Copia</button>
                </div>
                <div style={{fontSize:12,color:c.tx,lineHeight:1.75,whiteSpace:"pre-wrap"}}>{aiReport}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── REPORT ────────────────────────────────────────────────────────────────────
function Report({c,trades,strategie,conti}){
  const [selConti,setSelConti]=useState([]);
  const [selStrat,setSelStrat]=useState([]);
  const [dateFrom,setDateFrom]=useState("");
  const [dateTo,setDateTo]=useState("");
  const [printing,setPrinting]=useState(false);
  function toggleC(id){setSelConti(function(p){return p.includes(id)?p.filter(function(x){return x!==id;}):[...p,id];});}
  function toggleS(id){setSelStrat(function(p){return p.includes(id)?p.filter(function(x){return x!==id;}):[...p,id];});}

  const filtered=trades.filter(function(t){
    if(selConti.length>0&&!selConti.includes(t.conto_id)) return false;
    if(selStrat.length>0&&!selStrat.includes(t.strategia_id)) return false;
    if(dateFrom&&t.data_apertura&&t.data_apertura<dateFrom) return false;
    if(dateTo&&t.data_apertura&&t.data_apertura>dateTo+"T23:59:59") return false;
    return true;
  }).sort(function(a,b){return new Date(a.data_apertura)-new Date(b.data_apertura);});

  const m=calcMetrics(filtered);
  const capMap=makeCapMap(conti);
  const curve=buildEquityCurve(filtered,capMap);
  const totalEur=filtered.reduce(function(s,t){return s+(t.pnl_eur||0);},0);
  const stratPerf=strategie.map(function(s){const st=filtered.filter(function(t){return t.strategia_id===s.id;});return {...s,...calcMetrics(st)};}).filter(function(s){return s.total>0;});
  const moods=["😌 Calmo","😐 Neutro","😰 Ansioso","😤 Frustrato","😵 Euforico","😴 Stanco"];
  const moodStats=moods.map(function(mood){const mt=filtered.filter(function(t){return t.mood===mood;});const mm=calcMetrics(mt);return {mood,n:mt.length,wr:mm.wr,exp:mm.exp};}).filter(function(x){return x.n>0;});
  const days=["Dom","Lun","Mar","Mer","Gio","Ven","Sab"];
  const dayStats=days.map(function(d,i){const dt=filtered.filter(function(t){return t.data_apertura&&new Date(t.data_apertura).getDay()===i;});if(dt.length===0) return null;const dm=calcMetrics(dt);return {d,n:dt.length,wr:dm.wr,exp:dm.exp};}).filter(Boolean);

  function printReport(){window.print();}

  return(
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{padding:"11px 20px",borderBottom:"1px solid "+c.bd,display:"flex",alignItems:"center",justifyContent:"space-between",background:c.sb,flexShrink:0}}>
        <div><div style={{fontSize:15,fontWeight:700,letterSpacing:"-0.02em"}}>Report</div><div style={{fontSize:10,color:c.txm}}>{filtered.length} trade nel periodo</div></div>
        <button onClick={printReport} style={{padding:"7px 16px",borderRadius:8,background:"linear-gradient(135deg,#4F46E5,#7C3AED)",border:"none",color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>🖨 Stampa / PDF</button>
      </div>
      {/* FILTRI */}
      <div style={{padding:"10px 20px",borderBottom:"1px solid "+c.bd,background:c.sb,display:"flex",gap:14,flexShrink:0,flexWrap:"wrap",alignItems:"flex-end"}}>
        <div><div style={{fontSize:9,fontWeight:700,color:c.txm,marginBottom:5}}>CONTI</div><div style={{display:"flex",gap:5,flexWrap:"wrap"}}>{conti.map(function(cn){const s=selConti.includes(cn.id);return <button key={cn.id} onClick={function(){toggleC(cn.id);}} style={{padding:"4px 10px",borderRadius:20,border:"1px solid "+(s?c.ac:c.bd),background:s?c.ac+"15":"transparent",color:s?c.ac:c.txm,fontSize:11,fontWeight:s?700:400,cursor:"pointer",fontFamily:"inherit"}}>{cn.nome}</button>;})}</div></div>
        <div style={{width:1,background:c.bd,alignSelf:"stretch"}}/>
        <div><div style={{fontSize:9,fontWeight:700,color:c.txm,marginBottom:5}}>STRATEGIE</div><div style={{display:"flex",gap:5,flexWrap:"wrap"}}>{strategie.map(function(s){const sel=selStrat.includes(s.id);return <button key={s.id} onClick={function(){toggleS(s.id);}} style={{padding:"4px 10px",borderRadius:20,border:"1px solid "+(sel?c.ac:c.bd),background:sel?c.ac+"15":"transparent",color:sel?c.ac:c.txm,fontSize:11,fontWeight:sel?700:400,cursor:"pointer",fontFamily:"inherit"}}>{s.nome}</button>;})}</div></div>
        <div style={{width:1,background:c.bd,alignSelf:"stretch"}}/>
        <div style={{display:"flex",gap:8,alignItems:"flex-end"}}>
          <div><div style={{fontSize:9,fontWeight:700,color:c.txm,marginBottom:4}}>DAL</div><input type="date" value={dateFrom} onChange={function(e){setDateFrom(e.target.value);}} style={{padding:"5px 8px",borderRadius:7,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:11,fontFamily:"inherit",outline:"none"}}/></div>
          <div><div style={{fontSize:9,fontWeight:700,color:c.txm,marginBottom:4}}>AL</div><input type="date" value={dateTo} onChange={function(e){setDateTo(e.target.value);}} style={{padding:"5px 8px",borderRadius:7,border:"1px solid "+c.inpb,background:c.inp,color:c.tx,fontSize:11,fontFamily:"inherit",outline:"none"}}/></div>
          {(dateFrom||dateTo)&&<button onClick={function(){setDateFrom("");setDateTo("");}} style={{padding:"5px 10px",borderRadius:7,border:"1px solid "+c.bd,background:"transparent",color:c.txm,fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>✕ Reset</button>}
        </div>
      </div>
      <div style={{flex:1,overflow:"auto",padding:"14px 20px"}}>
        {filtered.length===0?(
          <div style={{textAlign:"center",padding:"60px",color:c.txm,fontSize:13}}>Nessun trade nel periodo selezionato.</div>
        ):(
          <div id="report-content">
            {/* HEADER REPORT */}
            <div style={{background:"linear-gradient(135deg,#4F46E5,#7C3AED)",borderRadius:12,padding:"16px 20px",marginBottom:14,color:"#fff"}}>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:4}}>
                  <EdgeLabLogo size={24}/>
                  <div style={{fontSize:16,fontWeight:800,letterSpacing:"-0.03em"}}>EdgeLab — Report Trading</div>
                </div>
              <div style={{fontSize:11,opacity:0.85}}>
                {dateFrom||dateTo?((dateFrom?fmtDate(dateFrom):"inizio")+" → "+(dateTo?fmtDate(dateTo):"oggi")):"Tutti i trade"}
                {selConti.length>0?" · "+conti.filter(function(cn){return selConti.includes(cn.id);}).map(function(cn){return cn.nome;}).join(", "):""}
                {selStrat.length>0?" · "+strategie.filter(function(s){return selStrat.includes(s.id);}).map(function(s){return s.nome;}).join(", "):""}
              </div>
            </div>
            {/* METRICHE CHIAVE */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:8,marginBottom:12}}>
              {[{l:"Trade Totali",v:m.total,col:c.tx},{l:"Win Rate",v:m.wr+"%",col:m.wr>=50?c.gr:c.rd},{l:"Profit Factor",v:m.pf,col:m.pf>=1.5?c.gr:m.pf>=1?c.am:c.rd},{l:"Expectancy",v:fmtR(m.exp),col:m.exp>=0?c.gr:c.rd},{l:"Max Drawdown",v:"-"+m.maxDD+"R",col:c.rd},{l:"P/L $",v:totalEur!==0?"$"+totalEur.toFixed(0):"—",col:totalEur>=0?c.gr:c.rd}].map(function(mm,i){return(
                <div key={i} style={{background:c.card,borderRadius:10,padding:"10px 12px",border:"1px solid "+c.bd,textAlign:"center"}}><div style={{fontSize:8,color:c.txm,fontWeight:600,marginBottom:3}}>{mm.l}</div><div style={{fontSize:14,fontWeight:700,color:mm.col}}>{mm.v}</div></div>
              );})}
            </div>
            {/* EQUITY CURVE */}
            <div style={{background:c.card,borderRadius:11,padding:"13px 15px",border:"1px solid "+c.bd,marginBottom:12}}>
              <div style={{fontSize:12,fontWeight:700,marginBottom:10}}>Equity Curve</div>
              <EqChartSVG curve={curve} c={c} h={110} unit="R"/>
            </div>
            {/* STRATEGIE */}
            {stratPerf.length>0&&(
              <div style={{background:c.card,borderRadius:11,padding:"13px 15px",border:"1px solid "+c.bd,marginBottom:12}}>
                <div style={{fontSize:12,fontWeight:700,marginBottom:10,display:"flex",alignItems:"center",gap:4}}>Performance per Strategia<Tooltip c={c} text="Confronto delle metriche chiave tra le tue strategie nel periodo analizzato. Ti permette di vedere quale strategia sta effettivamente portando risultati e quale invece pesa sul tuo P/L complessivo. Una strategia con molti trade ma bassa expectancy potrebbe valere la pena di essere messa in pausa, mentre dovresti aumentare la frequenza su quella con il profit factor più alto."/></div>
                <div style={{display:"grid",gridTemplateColumns:"repeat("+Math.min(stratPerf.length,3)+",1fr)",gap:8}}>
                  {stratPerf.map(function(s){return(
                    <div key={s.id} style={{background:c.bg,borderRadius:8,padding:"10px 12px"}}>
                      <div style={{fontSize:11,fontWeight:700,marginBottom:6}}>{s.nome}</div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:5}}>
                        {[{l:"Trade",v:s.total},{l:"Win Rate",v:s.wr+"%"},{l:"PF",v:s.pf},{l:"P/L",v:fmtR(s.totalR)}].map(function(mm,i){return(
                          <div key={i}><div style={{fontSize:8,color:c.txm,fontWeight:600}}>{mm.l}</div><div style={{fontSize:11,fontWeight:700,color:i===3?(s.totalR>=0?c.gr:c.rd):c.tx}}>{mm.v}</div></div>
                        );})}
                      </div>
                    </div>
                  );})}
                </div>
              </div>
            )}
            {/* COMPORTAMENTALE */}
            {moodStats.length>0&&(
              <div style={{background:c.card,borderRadius:11,padding:"13px 15px",border:"1px solid "+c.bd,marginBottom:12}}>
                <div style={{fontSize:12,fontWeight:700,marginBottom:10,display:"flex",alignItems:"center",gap:4}}>Stato Mentale vs Risultati<Tooltip c={c} text="Confronta le tue performance in base a come ti sentivi prima di entrare in trade. Se quando sei ansioso o frustrato i risultati peggiorano sensibilmente, è un segnale chiaro che il tuo stato emotivo influenza le tue decisioni. Usa questa sezione per capire in quale condizione mentale sei più lucido e disciplinato, e considera di saltare il trading nei giorni negativi."/></div>
                {moodStats.map(function(x,i){return(
                  <div key={i} style={{marginBottom:i<moodStats.length-1?8:0}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}><span style={{fontSize:11,fontWeight:600}}>{x.mood}</span><div style={{display:"flex",gap:10}}><span style={{fontSize:11,fontWeight:700,color:x.wr>=50?c.gr:c.rd}}>WR {x.wr}%</span><span style={{fontSize:11,fontWeight:700,color:x.exp>=0?c.gr:c.rd}}>{fmtR(x.exp)}</span><span style={{fontSize:10,color:c.txm}}>{x.n} trade</span></div></div>
                    <div style={{height:4,borderRadius:3,background:c.bd}}><div style={{height:"100%",width:x.wr+"%",background:x.wr>=60?c.gr:x.wr>=40?c.am:c.rd,borderRadius:3}}/></div>
                  </div>
                );})}
              </div>
            )}
            {/* PATTERN TEMPORALI */}
            {dayStats.length>0&&(
              <div style={{background:c.card,borderRadius:11,padding:"13px 15px",border:"1px solid "+c.bd}}>
                <div style={{fontSize:12,fontWeight:700,marginBottom:10,display:"flex",alignItems:"center",gap:4}}>Performance per Giorno<Tooltip c={c} text="Analisi delle tue performance divise per giorno della settimana nel periodo del report. Se un giorno appare sistematicamente negativo mese dopo mese, è un segnale che qualcosa in quel giorno — la liquidità del mercato, le notizie economiche ricorrenti, o il tuo stato mentale — penalizza i tuoi risultati. Considera di ridurre o eliminare il trading in quel giorno specifico."/></div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {dayStats.map(function(d){return(
                    <div key={d.d} style={{background:c.bg,borderRadius:8,padding:"8px 12px",textAlign:"center",minWidth:60}}>
                      <div style={{fontSize:11,fontWeight:700,marginBottom:3}}>{d.d}</div>
                      <div style={{fontSize:11,fontWeight:700,color:d.wr>=50?c.gr:c.rd}}>{d.wr}%</div>
                      <div style={{fontSize:9,color:d.exp>=0?c.gr:c.rd}}>{fmtR(d.exp)}</div>
                      <div style={{fontSize:9,color:c.txm}}>{d.n} trade</div>
                    </div>
                  );})}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── TOOLTIP & DISCLAIMER ──────────────────────────────────────────────────────
function Tooltip({text,c}){
  const [show,setShow]=useState(false);
  return(
    <span style={{position:"relative",display:"inline-flex",alignItems:"center",marginLeft:5}}>
      <button
        onMouseEnter={function(){setShow(true);}}
        onMouseLeave={function(){setShow(false);}}
        onClick={function(){setShow(!show);}}
        style={{width:16,height:16,borderRadius:"50%",border:"1px solid "+c.bd,background:c.tag,color:c.txm,fontSize:9,cursor:"pointer",fontFamily:"inherit",display:"inline-flex",alignItems:"center",justifyContent:"center",fontWeight:700,flexShrink:0,padding:0}}
      >?</button>
      {show&&(
        <div style={{position:"absolute",left:"calc(100% + 8px)",top:"50%",transform:"translateY(-50%)",background:c.card,border:"1px solid "+c.bd,borderRadius:9,padding:"10px 13px",width:260,zIndex:500,boxShadow:"0 8px 24px rgba(0,0,0,0.18)",fontSize:11,color:c.txm,lineHeight:1.65}}>
          {text}
        </div>
      )}
    </span>
  );
}

function ModuleHeader({title,subtitle,tooltip,c,right}){
  return(
    <div style={{padding:"11px 20px",borderBottom:"1px solid "+c.bd,display:"flex",alignItems:"center",justifyContent:"space-between",background:c.sb,flexShrink:0}}>
      <div style={{display:"flex",alignItems:"center",gap:0}}>
        <div>
          <div style={{fontSize:15,fontWeight:700,letterSpacing:"-0.02em",display:"flex",alignItems:"center",gap:4}}>
            {title}
            {tooltip&&<Tooltip text={tooltip} c={c}/>}
          </div>
          {subtitle&&<div style={{fontSize:10,color:c.txm}}>{subtitle}</div>}
        </div>
      </div>
      {right&&<div style={{display:"flex",gap:6,alignItems:"center"}}>{right}</div>}
    </div>
  );
}

function DisclaimerCampione({n,c}){
  const min=300;
  if(n>=min) return null;
  const pct=Math.round((n/min)*100);
  return(
    <div style={{margin:"0 0 10px 0",padding:"8px 13px",borderRadius:9,background:c.am+"10",border:"1px solid "+c.am+"35",display:"flex",alignItems:"flex-start",gap:9}}>
      <span style={{fontSize:13,flexShrink:0,marginTop:1}}>⚠️</span>
      <div style={{fontSize:10,color:c.am,lineHeight:1.65}}>
        <strong>Validità statistica limitata:</strong> hai {n} trade su {min} minimi consigliati ({pct}%). Con meno di 300 campioni i pattern potrebbero non essere rappresentativi. Continua ad inserire trade per aumentare l'affidabilità delle analisi.
      </div>
    </div>
  );
}

// ── BACKTEST ──────────────────────────────────────────────────────────────────
function Backtest({c,trades}){
  const [view,setView]=useState("lista"); // lista | progetto
  const [progetti,setProgetti]=useState([]);
  const [btTrades,setBtTrades]=useState([]);
  const [selProgetto,setSelProgetto]=useState(null);
  const [showNuovoProg,setShowNuovoProg]=useState(false);
  const [showNuovoTrade,setShowNuovoTrade]=useState(false);
  const [showImport,setShowImport]=useState(false);
  const [anTab,setAnTab]=useState("overview");

  // form nuovo progetto
  const [pForm,setPForm]=useState({nome:"",asset:"",timeframe:"",note:""});
  // parametri del progetto corrente (3 famiglie)
  const [editParams,setEditParams]=useState(false);
  const [newParam,setNewParam]=useState({famiglia:"direzionalita",nome:""});

  // form nuovo trade backtest
  const initTForm={data:"",direzione:"L",entry:"",sl:"",exit:"",mae:"",mfe:"",params:[],note:""};
  const [tForm,setTForm]=useState(initTForm);

  // carica dati da IndexedDB
  async function loadBt(){
    const [p,t]=await Promise.all([db.bt_progetti.toArray(),db.bt_trade.toArray()]);
    setProgetti(p);setBtTrades(t);
  }
  useEffect(function(){loadBt();},[]);

  const progettoCorrente=progetti.find(function(p){return p.id===selProgetto;})||null;
  const tradesCorrente=btTrades.filter(function(t){return t.progetto_id===selProgetto;});

  // ── salva progetto ──
  async function salvaProgetto(){
    if(!pForm.nome.trim()){alert("Inserisci un nome per il progetto.");return;}
    const prog={
      nome:pForm.nome.trim(),
      asset:pForm.asset||"",
      timeframe:pForm.timeframe||"",
      note:pForm.note||"",
      created_at:new Date().toISOString(),
      parametri:{direzionalita:[],trigger:[],extra:[]},
    };
    const id=await db.bt_progetti.add(prog);
    await loadBt();
    setSelProgetto(id);
    setView("progetto");
    setShowNuovoProg(false);
    setPForm({nome:"",asset:"",timeframe:"",note:""});
  }

  // ── aggiungi parametro ──
  async function addParametro(){
    if(!newParam.nome.trim()||!progettoCorrente) return;
    const updated={...progettoCorrente};
    updated.parametri={...updated.parametri};
    updated.parametri[newParam.famiglia]=[...(updated.parametri[newParam.famiglia]||[]),newParam.nome.trim()];
    await db.bt_progetti.update(progettoCorrente.id,{parametri:updated.parametri});
    await loadBt();
    setNewParam({famiglia:"direzionalita",nome:""});
  }

  async function removeParametro(famiglia,idx){
    if(!progettoCorrente) return;
    const updated={...progettoCorrente};
    updated.parametri={...updated.parametri};
    updated.parametri[famiglia]=updated.parametri[famiglia].filter(function(_,i){return i!==idx;});
    await db.bt_progetti.update(progettoCorrente.id,{parametri:updated.parametri});
    await loadBt();
  }

  // ── calcola R trade bt ──
  function calcBtR(t){
    if(!t.entry||!t.sl||!t.exit) return t.r_result||0;
    const e=parseFloat(t.entry),s=parseFloat(t.sl),x=parseFloat(t.exit);
    if(isNaN(e)||isNaN(s)||isNaN(x)||e===s) return 0;
    const risk=Math.abs(e-s);
    const pnl=t.direzione==="L"?(x-e):(e-x);
    return parseFloat((pnl/risk).toFixed(2));
  }

  // ── salva trade backtest ──
  async function salvaTrade(){
    if(!tForm.entry||!tForm.sl||!tForm.exit){alert("Entry, SL ed Exit sono obbligatori.");return;}
    const r=calcBtR(tForm);
    const td={
      progetto_id:selProgetto,
      data_apertura:tForm.data||new Date().toISOString(),
      direzione:tForm.direzione,
      entry:parseFloat(tForm.entry),
      sl:parseFloat(tForm.sl),
      exit:parseFloat(tForm.exit),
      mae:tForm.mae?parseFloat(tForm.mae):null,
      mfe:tForm.mfe?parseFloat(tForm.mfe):null,
      params:tForm.params||[],
      note:tForm.note||"",
      r_result:r,
    };
    await db.bt_trade.add(td);
    await loadBt();
    setShowNuovoTrade(false);
    setTForm(initTForm);
  }

  // ── importa trade live ──
  async function importaLive(){
    const liveTrades=trades.filter(function(t){return !t.draft&&t.entry&&t.sl&&t.exit;});
    let importati=0;
    for(const t of liveTrades){
      const exists=await db.bt_trade.where("progetto_id").equals(selProgetto).filter(function(bt){return bt._live_id===t.id;}).first();
      if(!exists){
        await db.bt_trade.add({
          progetto_id:selProgetto,
          _live_id:t.id,
          data_apertura:t.data_apertura,
          direzione:t.direzione,
          entry:t.entry,sl:t.sl,exit:t.exit,
          mae:t.mae,mfe:t.mfe,
          params:[],note:"[importato da live]",
          r_result:t.r_result||calcBtR(t),
        });
        importati++;
      }
    }
    await loadBt();
    setShowImport(false);
    alert("Importati "+importati+" trade live. Puoi ora assegnare i parametri a ciascuno.");
  }

  async function eliminaTrade(id){if(!window.confirm("Eliminare questo trade?"))return;await db.bt_trade.delete(id);await loadBt();}
  async function eliminaProgetto(id){if(!window.confirm("Eliminare il progetto e tutti i suoi trade?"))return;await db.bt_trade.where("progetto_id").equals(id).delete();await db.bt_progetti.delete(id);await loadBt();setSelProgetto(null);setView("lista");}

  // ── ANALYTICS BACKTEST ──
  const allParams=progettoCorrente?[
    ...(progettoCorrente.parametri.direzionalita||[]).map(function(p){return {nome:p,famiglia:"direzionalita"};}),
    ...(progettoCorrente.parametri.trigger||[]).map(function(p){return {nome:p,famiglia:"trigger"};}),
    ...(progettoCorrente.parametri.extra||[]).map(function(p){return {nome:p,famiglia:"extra"};}),
  ]:[];

  const famColors={"direzionalita":"#4F46E5","trigger":"#0F766E","extra":"#D97706"};
  const famLabels={"direzionalita":"Direzionalità","trigger":"Trigger","extra":"Extra"};

  function metricsPerParam(paramNome){
    const ts=tradesCorrente.filter(function(t){return (t.params||[]).includes(paramNome);});
    return {n:ts.length,...calcMetrics(ts)};
  }

  // top combinazioni: 2-param e 3-param
  function topCombinazioni(maxK=2){
    if(allParams.length<2||tradesCorrente.length<3) return [];
    const combos=[];
    // genera tutte le coppie
    for(let i=0;i<allParams.length;i++){
      for(let j=i+1;j<allParams.length;j++){
        const names=[allParams[i].nome,allParams[j].nome];
        const ts=tradesCorrente.filter(function(t){return names.every(function(n){return (t.params||[]).includes(n);});});
        if(ts.length>=2){const m=calcMetrics(ts);combos.push({nomi:names,n:ts.length,...m});}
      }
    }
    if(maxK>=3){
      for(let i=0;i<allParams.length;i++){
        for(let j=i+1;j<allParams.length;j++){
          for(let k=j+1;k<allParams.length;k++){
            const names=[allParams[i].nome,allParams[j].nome,allParams[k].nome];
            const ts=tradesCorrente.filter(function(t){return names.every(function(n){return (t.params||[]).includes(n);});});
            if(ts.length>=2){const m=calcMetrics(ts);combos.push({nomi:names,n:ts.length,...m});}
          }
        }
      }
    }
    return combos.sort(function(a,b){return b.exp-a.exp;}).slice(0,8);
  }

  const paramStats=allParams.map(function(p){return {nome:p.nome,famiglia:p.famiglia,...metricsPerParam(p.nome)};}).filter(function(p){return p.n>0;}).sort(function(a,b){return b.exp-a.exp;});
  const topCombo=topCombinazioni(3);
  const metGlobali=calcMetrics(tradesCorrente);
  const eqCurve=buildEquityCurve(tradesCorrente.slice().sort(function(a,b){return new Date(a.data_apertura)-new Date(b.data_apertura);}),{});

  // ── VISTA LISTA PROGETTI ──
  if(view==="lista"){
    return(
      <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
        <ModuleHeader
          title="Backtest"
          subtitle={progetti.length+" progetti"}
          tooltip="Il Backtest ti permette di rispondere a 'e se?': cosa sarebbe successo se avessi usato parametri diversi — uno SL più largo, un filtro diverso per il bias, un trigger alternativo? Il sistema ricalcola i risultati su tutti i tuoi trade reali per ogni combinazione di parametri che specifichi, e confronta le metriche fianco a fianco per trovare la configurazione ottimale. Crea un progetto, definisci le famiglie di parametri da testare (Direzionalità, Trigger, Filtri Extra), inserisci i trade e ottieni analytics complete su ogni variante. Attenzione: ottimizzare troppo sui dati passati (overfitting) può dare risultati illusori — usa campioni ampi e valida su periodi diversi."
          c={c}
          right={<button onClick={function(){setShowNuovoProg(true);}} style={{padding:"7px 16px",borderRadius:8,background:"linear-gradient(135deg,#4F46E5,#7C3AED)",border:"none",color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>+ Nuovo Progetto</button>}
        />
        <div style={{flex:1,overflow:"auto",padding:"14px 20px"}}>
          {progetti.length===0?(
            <div style={{textAlign:"center",padding:"60px",color:c.txm}}>
              <div style={{fontSize:32,marginBottom:12}}>◧</div>
              <div style={{fontSize:14,fontWeight:700,marginBottom:6}}>Nessun progetto Backtest</div>
              <div style={{fontSize:12,color:c.txm,marginBottom:20}}>Crea un progetto per testare setup e trigger su dati storici o live.</div>
              <button onClick={function(){setShowNuovoProg(true);}} style={{padding:"8px 20px",borderRadius:8,background:"linear-gradient(135deg,#4F46E5,#7C3AED)",border:"none",color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>+ Nuovo Progetto</button>
            </div>
          ):(
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:12}}>
              {progetti.map(function(p){
                const pts=btTrades.filter(function(t){return t.progetto_id===p.id;});
                const m=calcMetrics(pts);
                const nParams=(p.parametri.direzionalita||[]).length+(p.parametri.trigger||[]).length+(p.parametri.extra||[]).length;
                return(
                  <div key={p.id} style={{background:c.card,borderRadius:12,border:"1px solid "+c.bd,padding:"16px",cursor:"pointer",transition:"all 0.15s"}}
                    onClick={function(){setSelProgetto(p.id);setView("progetto");}}
                    onMouseEnter={function(e){e.currentTarget.style.borderColor=c.ac+"60";e.currentTarget.style.boxShadow="0 4px 12px rgba(79,70,229,0.12)";}}
                    onMouseLeave={function(e){e.currentTarget.style.borderColor=c.bd;e.currentTarget.style.boxShadow="none";}}
                  >
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                      <div>
                        <div style={{fontSize:13,fontWeight:700}}>{p.nome}</div>
                        <div style={{fontSize:10,color:c.txm,marginTop:2}}>{p.asset||"—"}{p.timeframe?" · "+p.timeframe:""}</div>
                      </div>
                      <button onClick={function(e){e.stopPropagation();eliminaProgetto(p.id);}} style={{color:c.rd,background:"none",border:"none",cursor:"pointer",fontSize:12,opacity:0.6,padding:2}}
                        onMouseEnter={function(e){e.currentTarget.style.opacity=1;}} onMouseLeave={function(e){e.currentTarget.style.opacity=0.6;}}>✕</button>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:10}}>
                      {[{l:"Trade",v:pts.length},{l:"WR",v:m.wr+"%"},{l:"Expectancy",v:fmtR(m.exp)}].map(function(s,i){return(
                        <div key={i} style={{background:c.bg,borderRadius:7,padding:"7px 9px",textAlign:"center"}}>
                          <div style={{fontSize:8,color:c.txm,fontWeight:600}}>{s.l}</div>
                          <div style={{fontSize:13,fontWeight:700,color:c.tx}}>{s.v}</div>
                        </div>
                      );})}
                    </div>
                    <div style={{fontSize:9,color:c.txm}}>{nParams} parametri definiti · {p.created_at?fmtDate(p.created_at):""}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* MODALE NUOVO PROGETTO */}
        {showNuovoProg&&(
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:600,display:"flex",alignItems:"center",justifyContent:"center"}}>
            <div style={{background:c.card,borderRadius:14,padding:24,width:420,boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}}>
              <div style={{fontSize:15,fontWeight:700,marginBottom:16}}>Nuovo Progetto Backtest</div>
              {[{l:"Nome progetto *",k:"nome",ph:"es. NAS100 Backtest 2024"},{l:"Asset principale",k:"asset",ph:"es. NAS100"},{l:"Timeframe",k:"timeframe",ph:"es. M15, H1"},{l:"Note",k:"note",ph:"Descrizione opzionale"}].map(function(f){return(
                <div key={f.k} style={{marginBottom:12}}>
                  <div style={{fontSize:11,fontWeight:600,marginBottom:4}}>{f.l}</div>
                  <input value={pForm[f.k]} onChange={function(e){setPForm(function(p){return {...p,[f.k]:e.target.value};});}} placeholder={f.ph} style={{width:"100%",padding:"8px 10px",borderRadius:8,border:"1px solid "+c.bd,background:c.inp,color:c.tx,fontSize:12,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
                </div>
              );})}
              <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:16}}>
                <button onClick={function(){setShowNuovoProg(false);}} style={{padding:"8px 16px",borderRadius:8,border:"1px solid "+c.bd,background:"transparent",color:c.txm,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Annulla</button>
                <button onClick={salvaProgetto} style={{padding:"8px 20px",borderRadius:8,background:"linear-gradient(135deg,#4F46E5,#7C3AED)",border:"none",color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>Crea Progetto</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── VISTA PROGETTO ──
  const TABS_PROG=[{k:"overview",l:"📊 Overview"},{k:"parametri",l:"⚙ Parametri"},{k:"trade",l:"📋 Trade"},{k:"combinazioni",l:"🔬 Combinazioni"},{k:"ottimizzazione",l:"⇌ Ottimizzazione"}];

  return(
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      {/* HEADER */}
      <div style={{padding:"11px 20px",borderBottom:"1px solid "+c.bd,display:"flex",alignItems:"center",justifyContent:"space-between",background:c.sb,flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <button onClick={function(){setView("lista");}} style={{padding:"4px 9px",borderRadius:6,border:"1px solid "+c.bd,background:"transparent",color:c.txm,fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>← Backtest</button>
          <div>
            <div style={{fontSize:14,fontWeight:700,display:"flex",alignItems:"center",gap:4}}>
              {progettoCorrente?.nome||"—"}
              <Tooltip text="Progetto Backtest: inserisci trade storici o importa quelli live, assegna i parametri usati per ogni trade e analizza quali combinazioni performano meglio." c={c}/>
            </div>
            <div style={{fontSize:9,color:c.txm}}>{progettoCorrente?.asset||""}{progettoCorrente?.timeframe?" · "+progettoCorrente.timeframe:""} · {tradesCorrente.length} trade</div>
          </div>
        </div>
        <div style={{display:"flex",gap:6}}>
          <button onClick={function(){setShowImport(true);}} style={{padding:"6px 12px",borderRadius:7,border:"1px solid "+c.bd,background:"transparent",color:c.txm,fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>⬇ Importa Live</button>
          <button onClick={function(){setShowNuovoTrade(true);}} style={{padding:"6px 14px",borderRadius:7,background:"linear-gradient(135deg,#4F46E5,#7C3AED)",border:"none",color:"#fff",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>+ Trade</button>
        </div>
      </div>

      {/* TABS */}
      <div style={{padding:"0 20px",borderBottom:"1px solid "+c.bd,background:c.sb,display:"flex",gap:2,flexShrink:0,overflowX:"auto"}}>
        {TABS_PROG.map(function(t){const a=anTab===t.k;return(
          <button key={t.k} onClick={function(){setAnTab(t.k);}} style={{padding:"8px 14px",border:"none",borderBottom:"2px solid "+(a?c.ac:"transparent"),background:"transparent",color:a?c.ac:c.txm,fontSize:11,fontWeight:a?700:400,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>{t.l}</button>
        );})}
      </div>

      <div style={{flex:1,overflow:"auto",padding:"14px 20px"}}>
        <DisclaimerCampione n={tradesCorrente.length} c={c}/>

        {/* ── OVERVIEW ── */}
        {anTab==="overview"&&(
          <div>
            {tradesCorrente.length===0?(
              <div style={{textAlign:"center",padding:"40px",color:c.txm,fontSize:12}}>Inserisci o importa trade per vedere le analisi.</div>
            ):(
              <>
                <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:8,marginBottom:12}}>
                  {[
                    {l:"Trade Totali",v:metGlobali.total,col:c.tx,tt:"Numero totale di trade nel campione backtest."},
                    {l:"Win Rate",v:metGlobali.wr+"%",col:metGlobali.wr>=50?c.gr:c.rd,tt:"% trade chiusi in profitto (R>0) sul totale."},
                    {l:"Profit Factor",v:metGlobali.pf,col:metGlobali.pf>=1.5?c.gr:metGlobali.pf>=1?c.am:c.rd,tt:"Gross Profit / Gross Loss. >1.5 = edge solida. <1 = strategia perdente."},
                    {l:"Expectancy",v:fmtR(metGlobali.exp),col:metGlobali.exp>=0?c.gr:c.rd,tt:"R medio per trade. Expectancy positiva = sistema profittevole a lungo termine."},
                    {l:"Max Drawdown",v:"-"+metGlobali.maxDD+"R",col:c.rd,tt:"Massima perdita cumulativa dal picco. Misura il rischio di perdita sostenuta."},
                    {l:"Total R",v:fmtR(metGlobali.totalR),col:metGlobali.totalR>=0?c.gr:c.rd,tt:"Somma totale di tutti gli R risultato. La misura più diretta della profittabilità."},
                  ].map(function(m,i){return(
                    <div key={i} style={{background:c.card,borderRadius:10,padding:"11px 12px",border:"1px solid "+c.bd}}>
                      <div style={{fontSize:8,color:c.txm,fontWeight:600,marginBottom:3,display:"flex",alignItems:"center"}}>{m.l}<Tooltip text={m.tt} c={c}/></div>
                      <div style={{fontSize:15,fontWeight:800,color:m.col}}>{m.v}</div>
                    </div>
                  );})}
                </div>
                {/* Equity curve */}
                {eqCurve.length>1&&(
                  <div style={{background:c.card,borderRadius:11,padding:"13px 15px",border:"1px solid "+c.bd,marginBottom:12}}>
                    <div style={{fontSize:11,fontWeight:700,marginBottom:8}}>Equity Curve</div>
                    <EqChartSVG curve={eqCurve} c={c} h={120} unit="R"/>
                  </div>
                )}
                {/* Per-parametro overview */}
                {paramStats.length>0&&(
                  <div style={{background:c.card,borderRadius:11,padding:"13px 15px",border:"1px solid "+c.bd}}>
                    <div style={{fontSize:11,fontWeight:700,marginBottom:10}}>Performance per Parametro</div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                      {paramStats.map(function(p,i){return(
                        <div key={i} style={{padding:"9px 12px",borderRadius:9,background:c.bg,border:"1px solid "+c.bd,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                          <div>
                            <span style={{fontSize:9,fontWeight:700,color:famColors[p.famiglia]||c.ac,background:(famColors[p.famiglia]||c.ac)+"15",padding:"2px 6px",borderRadius:4}}>{famLabels[p.famiglia]}</span>
                            <div style={{fontSize:12,fontWeight:600,marginTop:4}}>{p.nome}</div>
                            <div style={{fontSize:10,color:c.txm}}>n={p.n} · WR {p.wr}%</div>
                          </div>
                          <div style={{textAlign:"right"}}>
                            <div style={{fontSize:14,fontWeight:800,color:p.exp>=0?c.gr:c.rd}}>{fmtR(p.exp)}</div>
                            <div style={{fontSize:9,color:c.txm}}>PF {p.pf}</div>
                          </div>
                        </div>
                      );})}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── PARAMETRI ── */}
        {anTab==="parametri"&&(
          <div style={{maxWidth:600}}>
            <div style={{fontSize:11,color:c.txm,marginBottom:12,lineHeight:1.6}}>
              Definisci i parametri del tuo sistema di trading in 3 famiglie. Per ogni trade backtest potrai spuntare quali parametri erano presenti, e EdgeLab calcolerà automaticamente le performance per ogni combinazione.
            </div>
            {["direzionalita","trigger","extra"].map(function(fam){
              const items=progettoCorrente?.parametri?.[fam]||[];
              return(
                <div key={fam} style={{background:c.card,borderRadius:11,padding:"14px 16px",border:"1px solid "+c.bd,marginBottom:10}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                    <span style={{fontSize:11,fontWeight:700,color:famColors[fam],background:famColors[fam]+"15",padding:"3px 10px",borderRadius:20}}>{famLabels[fam]}</span>
                    <span style={{fontSize:10,color:c.txm}}>{items.length} parametri</span>
                  </div>
                  {items.length===0&&<div style={{fontSize:11,color:c.txs,marginBottom:8}}>Nessun parametro ancora. Aggiungine uno sotto.</div>}
                  <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
                    {items.map(function(item,idx){return(
                      <span key={idx} style={{display:"inline-flex",alignItems:"center",gap:4,padding:"4px 10px",borderRadius:20,background:famColors[fam]+"15",border:"1px solid "+famColors[fam]+"40",fontSize:11,color:famColors[fam]}}>
                        {item}
                        <button onClick={function(){removeParametro(fam,idx);}} style={{background:"none",border:"none",color:famColors[fam],cursor:"pointer",fontSize:10,padding:0,opacity:0.7}}
                          onMouseEnter={function(e){e.currentTarget.style.opacity=1;}} onMouseLeave={function(e){e.currentTarget.style.opacity=0.7;}}>✕</button>
                      </span>
                    );})}
                  </div>
                  <div style={{display:"flex",gap:6}}>
                    <input
                      value={newParam.famiglia===fam?newParam.nome:""}
                      onFocus={function(){setNewParam(function(p){return {...p,famiglia:fam};});}}
                      onChange={function(e){setNewParam({famiglia:fam,nome:e.target.value});}}
                      onKeyDown={function(e){if(e.key==="Enter")addParametro();}}
                      placeholder={"+ Aggiungi "+famLabels[fam].toLowerCase()+"..."}
                      style={{flex:1,padding:"6px 10px",borderRadius:7,border:"1px solid "+c.bd,background:c.inp,color:c.tx,fontSize:11,fontFamily:"inherit",outline:"none"}}
                    />
                    <button onClick={addParametro} style={{padding:"6px 12px",borderRadius:7,background:famColors[fam],border:"none",color:"#fff",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>+</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── TRADE ── */}
        {anTab==="trade"&&(
          <div>
            {tradesCorrente.length===0?(
              <div style={{textAlign:"center",padding:"40px",color:c.txm,fontSize:12}}>Nessun trade. Aggiungine uno o importa da live.</div>
            ):(
              <div style={{background:c.card,borderRadius:12,border:"1px solid "+c.bd,overflow:"hidden"}}>
                <div style={{display:"grid",gridTemplateColumns:"90px 50px 80px 60px auto 60px",gap:0,padding:"8px 14px",background:c.bg,borderBottom:"1px solid "+c.bd}}>
                  {["Data","Dir.","R","WR","Parametri",""].map(function(h,i){return <div key={i} style={{fontSize:8,color:c.txs,fontWeight:700,letterSpacing:"0.05em"}}>{h}</div>;})}
                </div>
                {tradesCorrente.slice().sort(function(a,b){return new Date(b.data_apertura)-new Date(a.data_apertura);}).map(function(t,i,arr){return(
                  <div key={t.id} style={{display:"grid",gridTemplateColumns:"90px 50px 80px 60px auto 60px",gap:0,padding:"9px 14px",borderBottom:i<arr.length-1?"1px solid "+c.bdl:"none",alignItems:"center"}}>
                    <div style={{fontSize:11,fontWeight:600}}>{fmtDate(t.data_apertura)}</div>
                    <div><span style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:26,height:16,borderRadius:3,fontSize:9,fontWeight:700,background:t.direzione==="L"?c.gr+"18":c.rd+"18",color:t.direzione==="L"?c.gr:c.rd}}>{t.direzione==="L"?"▲L":"▼S"}</span></div>
                    <div><Badge v={t.r_result} c={c}/></div>
                    <div style={{fontSize:10,color:c.txm}}>—</div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:3}}>
                      {(t.params||[]).length===0?<span style={{fontSize:9,color:c.txs}}>nessuno</span>:(t.params||[]).map(function(p,pi){
                        const fam=allParams.find(function(a){return a.nome===p;})?.famiglia||"extra";
                        return <span key={pi} style={{fontSize:9,padding:"2px 6px",borderRadius:10,background:(famColors[fam]||c.ac)+"15",color:(famColors[fam]||c.ac),border:"1px solid "+(famColors[fam]||c.ac)+"30"}}>{p}</span>;
                      })}
                    </div>
                    <div onClick={function(){eliminaTrade(t.id);}} style={{fontSize:11,color:c.rd,cursor:"pointer",opacity:0.5,textAlign:"right"}}
                      onMouseEnter={function(e){e.currentTarget.style.opacity=1;}} onMouseLeave={function(e){e.currentTarget.style.opacity=0.5;}}>✕</div>
                  </div>
                );})}
              </div>
            )}
          </div>
        )}

        {/* ── COMBINAZIONI ── */}
        {anTab==="combinazioni"&&(
          <div>
            <div style={{fontSize:11,color:c.txm,marginBottom:12,lineHeight:1.6}}>
              Combinazioni di parametri più performanti, ordinate per Expectancy decrescente. Richiede almeno 2 trade per combinazione.
            </div>
            {topCombo.length===0?(
              <div style={{textAlign:"center",padding:"40px",color:c.txm,fontSize:12}}>Inserisci più trade con parametri assegnati per vedere le combinazioni migliori.</div>
            ):(
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {topCombo.map(function(combo,i){return(
                  <div key={i} style={{background:c.card,borderRadius:11,padding:"13px 16px",border:"1px solid "+c.bd,display:"flex",alignItems:"center",gap:14}}>
                    <div style={{width:26,height:26,borderRadius:7,background:i===0?"linear-gradient(135deg,#F59E0B,#D97706)":i===1?"linear-gradient(135deg,#9CA3AF,#6B7280)":i===2?"linear-gradient(135deg,#B45309,#92400E)":c.tag,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,color:i<3?"#fff":c.txm,flexShrink:0}}>#{i+1}</div>
                    <div style={{flex:1}}>
                      <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:4}}>
                        {combo.nomi.map(function(n,ni){
                          const fam=allParams.find(function(a){return a.nome===n;})?.famiglia||"extra";
                          return <span key={ni} style={{fontSize:10,padding:"2px 8px",borderRadius:20,background:(famColors[fam]||c.ac)+"15",color:(famColors[fam]||c.ac),border:"1px solid "+(famColors[fam]||c.ac)+"30",fontWeight:600}}>{n}</span>;
                        })}
                      </div>
                      <div style={{fontSize:10,color:c.txm}}>n={combo.n} trade · WR {combo.wr}% · PF {combo.pf} · MaxDD -{combo.maxDD}R</div>
                    </div>
                    <div style={{textAlign:"right",flexShrink:0}}>
                      <div style={{fontSize:16,fontWeight:800,color:combo.exp>=0?c.gr:c.rd}}>{fmtR(combo.exp)}</div>
                      <div style={{fontSize:9,color:c.txm}}>per trade</div>
                    </div>
                  </div>
                );})}
              </div>
            )}
          </div>
        )}

        {/* ── OTTIMIZZAZIONE ── */}
        {anTab==="ottimizzazione"&&(
          <div>
            <div style={{fontSize:11,color:c.txm,marginBottom:12,lineHeight:1.6}}>
              Analisi MFE-based per trovare il TP e BE ottimali sul campione backtest. Richiede che i trade abbiano MFE inserito.
            </div>
            {tradesCorrente.filter(function(t){return t.mfe!=null;}).length<3?(
              <div style={{textAlign:"center",padding:"40px",color:c.txm,fontSize:12}}>Inserisci MAE/MFE su almeno 3 trade per abilitare l'ottimizzazione.</div>
            ):(
              <div style={{background:c.card,borderRadius:11,padding:"14px 16px",border:"1px solid "+c.bd}}>
                <div style={{fontSize:11,fontWeight:700,marginBottom:8}}>MFE Distribution</div>
                {tradesCorrente.filter(function(t){return t.mfe!=null&&t.entry&&t.sl;}).map(function(t){
                  const risk=Math.abs(t.entry-t.sl); if(risk===0) return null;
                  const mfeR=parseFloat(((t.direzione==="L"?(t.mfe-t.entry):(t.entry-t.mfe))/risk).toFixed(2));
                  return {mfeR,r:t.r_result};
                }).filter(Boolean).sort(function(a,b){return a.mfeR-b.mfeR;}).map(function(d,i){return(
                  <div key={i} style={{display:"flex",alignItems:"center",gap:8,marginBottom:3}}>
                    <div style={{width:50,fontSize:9,color:c.txm,textAlign:"right"}}>{d.mfeR}R MFE</div>
                    <div style={{flex:1,height:6,borderRadius:3,background:c.bd,overflow:"hidden"}}>
                      <div style={{width:Math.min(100,(d.mfeR/5)*100)+"%",height:"100%",background:d.r>0?c.gr:c.rd,borderRadius:3}}/>
                    </div>
                    <div style={{width:40,fontSize:9,color:d.r>0?c.gr:c.rd,fontWeight:700}}>{fmtR(d.r)}</div>
                  </div>
                );})}
              </div>
            )}
          </div>
        )}
      </div>

      {/* MODALE NUOVO TRADE */}
      {showNuovoTrade&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:600,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:c.card,borderRadius:14,padding:24,width:500,maxHeight:"85vh",overflow:"auto",boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}}>
            <div style={{fontSize:15,fontWeight:700,marginBottom:16}}>Aggiungi Trade Backtest</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
              {[{l:"Data apertura",k:"data",type:"datetime-local"},{l:"Entry *",k:"entry",type:"number",ph:"1.2345"},{l:"Stop Loss *",k:"sl",type:"number",ph:"1.2300"},{l:"Exit *",k:"exit",type:"number",ph:"1.2400"},{l:"MAE (opz.)",k:"mae",type:"number",ph:"prezzo peggiore"},{l:"MFE (opz.)",k:"mfe",type:"number",ph:"prezzo migliore"}].map(function(f){return(
                <div key={f.k}>
                  <div style={{fontSize:10,fontWeight:600,marginBottom:3}}>{f.l}</div>
                  <input type={f.type||"text"} value={tForm[f.k]||""} onChange={function(e){setTForm(function(p){return {...p,[f.k]:e.target.value};});}} placeholder={f.ph||""} style={{width:"100%",padding:"7px 9px",borderRadius:7,border:"1px solid "+c.bd,background:c.inp,color:c.tx,fontSize:12,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
                </div>
              );})}
            </div>
            <div style={{marginBottom:12}}>
              <div style={{fontSize:10,fontWeight:600,marginBottom:5}}>Direzione</div>
              <div style={{display:"flex",gap:6}}>
                {[{v:"L",l:"▲ Long"},{v:"S",l:"▼ Short"}].map(function(d){const a=tForm.direzione===d.v;return(
                  <button key={d.v} onClick={function(){setTForm(function(p){return {...p,direzione:d.v};});}} style={{padding:"6px 16px",borderRadius:7,border:"1px solid "+(a?c.gr:c.bd),background:a?c.gr+"15":"transparent",color:a?c.gr:c.txm,fontSize:11,fontWeight:a?700:400,cursor:"pointer",fontFamily:"inherit"}}>{d.l}</button>
                );})}
              </div>
            </div>
            {allParams.length>0&&(
              <div style={{marginBottom:12}}>
                <div style={{fontSize:10,fontWeight:600,marginBottom:6}}>Parametri presenti in questo trade</div>
                {["direzionalita","trigger","extra"].map(function(fam){
                  const items=progettoCorrente?.parametri?.[fam]||[];
                  if(items.length===0) return null;
                  return(
                    <div key={fam} style={{marginBottom:8}}>
                      <div style={{fontSize:9,fontWeight:700,color:famColors[fam],marginBottom:4}}>{famLabels[fam]}</div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                        {items.map(function(item){const sel=(tForm.params||[]).includes(item);return(
                          <button key={item} onClick={function(){setTForm(function(p){const ps=p.params||[];return {...p,params:sel?ps.filter(function(x){return x!==item;}):[...ps,item]};});}} style={{padding:"4px 10px",borderRadius:20,border:"1px solid "+(sel?famColors[fam]:c.bd),background:sel?famColors[fam]+"15":"transparent",color:sel?famColors[fam]:c.txm,fontSize:10,fontWeight:sel?700:400,cursor:"pointer",fontFamily:"inherit"}}>{item}</button>
                        );})}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div style={{marginBottom:12}}>
              <div style={{fontSize:10,fontWeight:600,marginBottom:3}}>Note</div>
              <textarea value={tForm.note||""} onChange={function(e){setTForm(function(p){return {...p,note:e.target.value};});}} placeholder="Osservazioni sul trade..." style={{width:"100%",padding:"7px 9px",borderRadius:7,border:"1px solid "+c.bd,background:c.inp,color:c.tx,fontSize:12,fontFamily:"inherit",outline:"none",resize:"vertical",minHeight:50,boxSizing:"border-box"}}/>
            </div>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button onClick={function(){setShowNuovoTrade(false);setTForm(initTForm);}} style={{padding:"8px 16px",borderRadius:8,border:"1px solid "+c.bd,background:"transparent",color:c.txm,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Annulla</button>
              <button onClick={salvaTrade} style={{padding:"8px 20px",borderRadius:8,background:"linear-gradient(135deg,#4F46E5,#7C3AED)",border:"none",color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>Salva Trade</button>
            </div>
          </div>
        </div>
      )}

      {/* MODALE IMPORT LIVE */}
      {showImport&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:600,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:c.card,borderRadius:14,padding:24,width:380,boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}}>
            <div style={{fontSize:15,fontWeight:700,marginBottom:8}}>Importa Trade Live</div>
            <div style={{fontSize:12,color:c.txm,marginBottom:20,lineHeight:1.6}}>
              Importa {trades.filter(function(t){return !t.draft&&t.entry&&t.sl&&t.exit;}).length} trade live (con entry/SL/exit) in questo progetto backtest. I duplicati vengono ignorati automaticamente.<br/><br/>
              <strong style={{color:c.am}}>Nota:</strong> dopo l'importazione potrai assegnare i parametri a ciascun trade nel tab Trade.
            </div>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button onClick={function(){setShowImport(false);}} style={{padding:"8px 16px",borderRadius:8,border:"1px solid "+c.bd,background:"transparent",color:c.txm,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Annulla</button>
              <button onClick={importaLive} style={{padding:"8px 20px",borderRadius:8,background:"linear-gradient(135deg,#4F46E5,#7C3AED)",border:"none",color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>Importa</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── APP ROOT ──────────────────────────────────────────────────────────────────
export default function App(){
  const [dark,setDark]=useState(false);
  const [active,setActive]=useState("dashboard");
  const [screen,setScreen]=useState("dashboard");
  const [strategie,setStrategie]=useState([]);
  const [conti,setConti]=useState([]);
  const [trades,setTrades]=useState([]);
  const [loading,setLoading]=useState(true);
  const c=dark?D:L;

  const reload=useCallback(async function(){
    const [s,cn,t]=await Promise.all([db.strategie.toArray(),db.conti.toArray(),db.trade.toArray()]);
    setStrategie(s);setConti(cn);setTrades(t);
  },[]);

  useEffect(function(){
    reload().then(function(){setLoading(false);});
  },[reload]);

  function renderScreen(){
    if(loading) return <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:c.txm,fontSize:14}}>Caricamento...</div>;
    if(screen==="form") return <TradeForm c={c} strategie={strategie} conti={conti} reload={reload} setScreen={setScreen}/>;
    if(screen==="strategie") return <Strategie c={c} strategie={strategie} reload={reload}/>;
    if(screen==="conti") return <Conti c={c} conti={conti} strategie={strategie} trades={trades} reload={reload}/>;
    if(screen==="journal") return <Journal c={c} trades={trades} strategie={strategie} conti={conti} reload={reload}/>;
    if(screen==="analytics") return <Analytics c={c} trades={trades} strategie={strategie} conti={conti}/>;
    if(screen==="ottimizzazione") return <Ottimizzazione c={c} trades={trades} strategie={strategie} conti={conti}/>;
    if(screen==="sim-cap") return <SimCapitale c={c} trades={trades} strategie={strategie} conti={conti}/>;
    if(screen==="monte-carlo") return <MonteCarlo c={c} trades={trades} strategie={strategie} conti={conti}/>;
    if(screen==="backtest") return <Backtest c={c} trades={trades}/>;
    if(screen==="coach") return <Coach c={c} trades={trades} strategie={strategie} conti={conti}/>;
    if(screen==="report") return <Report c={c} trades={trades} strategie={strategie} conti={conti}/>;
    if(screen==="impostazioni") return <Impostazioni c={c} dark={dark} setDark={setDark} reload={reload}/>;
    return <Dashboard c={c} setScreen={setScreen} trades={trades} strategie={strategie} conti={conti}/>;
  }

  return (
    <div style={{display:"flex",height:"100vh",width:"100vw",background:c.bg,fontFamily:"system-ui,sans-serif",color:c.tx,overflow:"hidden",fontSize:14}}>
      <Sidebar active={active} setActive={setActive} setScreen={setScreen} dark={dark} setDark={setDark} c={c} trades={trades} strategie={strategie} conti={conti}/>
      <div style={{flex:1,overflow:"hidden",display:"flex"}}>{renderScreen()}</div>
    </div>
  );
}