import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useToast } from "@/lib/toast";

type IconId = "claude" | "claudeCode" | "claudeCodePlayful" | "pacman" | "logo";
interface BubbleCfg { icon: IconId; color: string; size: number; x: number | null; y: number | null; }

const DEFAULT: BubbleCfg = { icon: "logo", color: "#ef4444", size: 60, x: null, y: null };
const COLORS = [
  "#ef4444", // red-500 — DEFAULT
  "#f97316", // orange-500
  "#f59e0b", // amber-500
  "#ca8a04", // yellow-600
  "#65a30d", // lime-600
  "#16a34a", // green-600
  "#059669", // emerald-600
  "#0d9488", // teal-600
  "#0891b2", // cyan-600
  "#0284c7", // sky-600
  "#0070f3", // vercel blue
  "#4f46e5", // indigo-600
  "#7c3aed", // violet-600
  "#9333ea", // purple-600
  "#c026d3", // fuchsia-600
  "#db2777", // pink-600
  "#e11d48", // rose-600
  "#1e293b", // slate-800
  "#92400e", // amber-800
  "#0f766e", // teal-800
  "#1d4ed8", // blue-700
  "#be185d", // rose-700
  "#eab308", // yellow-500 — +7 to reach 29, fills 3rd row
  "#84cc16", // lime-500
  "#22d3ee", // cyan-400
  "#a3e635", // lime-400
  "#fb7185", // rose-400
  "#f43f5e", // rose-500
  "#38bdf8", // sky-400
];

const ICON_CLAUDE = `<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><rect width="1024" height="1024" rx="230" fill="currentColor"/><g fill="#111111"><rect x="250" y="350" width="120" height="240" rx="20"/><rect x="650" y="350" width="120" height="240" rx="20"/></g><g fill="#FFFFFF"><rect x="270" y="380" width="40" height="60" rx="10"/><rect x="670" y="380" width="40" height="60" rx="10"/></g><path d="M -50 600 L 150 600 L 150 800 L -50 800 Z" fill="#C46044"/><path d="M 874 600 L 1074 600 L 1074 800 L 874 800 Z" fill="#C46044"/></svg>`;
const ICON_PACMAN = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300" width="100%" height="100%"><path fill="currentColor" d="M 150,150 L 236.6,100 A 100 100 0 1 0 236.6,200 Z"/><circle cx="180" cy="110" r="12" fill="#000"/><circle cx="183" cy="106" r="3.5" fill="#fff" opacity="0.9"/></svg>`;
const ICON_LOGO = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"><rect x="2" y="2" width="20" height="20" rx="5" fill="currentColor"/><path d="M7 8h10M7 12h10M7 16h7" stroke="white" stroke-width="1.6" stroke-linecap="round"/></svg>`;
const ICONS: Record<string,string> = { claude: ICON_CLAUDE, pacman: ICON_PACMAN, logo: ICON_LOGO, claudeCodePlayful: "" };
const CLAUDE_CODE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 3 16 13" width="100%" height="100%" style="display:block"><defs><style>.action-body{transform-origin:7.5px 13px;animation:action-body 16s infinite ease-in-out}.breathe-anim{transform-origin:7.5px 13px;animation:breathe 3.2s infinite ease-in-out}.shadow-anim{transform-origin:7.5px 15.5px;animation:shadow-action 16s infinite ease-in-out}.arm-l{transform-origin:1px 10px;animation:arm-l-idle 16s infinite ease-in-out}.arm-r{transform-origin:14px 10px;animation:arm-r-idle 16s infinite ease-in-out}.eyes-look{animation:eye-track 16s infinite ease-in-out}.eyes-blink{transform-origin:7.5px 9px;animation:eye-blink 16s infinite linear}.yawn-mouth{transform-origin:7.5px 11px;animation:yawn-mouth-anim 16s infinite ease-in-out;opacity:0}.yawn-tear{animation:tear-fall 16s infinite ease-in-out;opacity:0}@keyframes breathe{0%,100%{transform:scale(1,1) translate(0,0)}50%{transform:scale(1.02,0.98) translate(0,0.5px)}}@keyframes action-body{0%,8%,26%,38%,55%,80%,100%{transform:scale(1,1) translate(0,0)}12%,22%{transform:scale(1,1) translate(1px,0)}42%,50%{transform:scale(1,1) translate(-1px,0)}30%,36%{transform:scale(1,1) translate(0.5px,0)}60%{transform:scale(0.95,1.05) translate(0px,-1px)}65%{transform:scale(0.9,1.1) translate(0px,-2px)}72%{transform:scale(1.05,0.95) translate(0px,1px)}76%{transform:scale(1,1) translate(0px,0px)}}@keyframes shadow-action{0%,8%,26%,38%,55%,80%,100%{transform:scaleX(1) translate(0,0);opacity:0.5}12%,22%{transform:scaleX(1) translate(1px,0);opacity:0.5}42%,50%{transform:scaleX(1) translate(-1px,0);opacity:0.5}30%,36%{transform:scaleX(1) translate(0.5px,0);opacity:0.5}60%{transform:scaleX(0.95) translate(0,0);opacity:0.45}65%{transform:scaleX(0.9) translate(0,0);opacity:0.4}72%{transform:scaleX(1.05) translate(0,0);opacity:0.55}76%{transform:scaleX(1) translate(0,0);opacity:0.5}}@keyframes eye-track{0%,10%,25%,38%,52%,58%,80%,100%{transform:translate(0px,0px)}12%,22%{transform:translate(3px,0px)}42%,50%{transform:translate(-3px,0px)}60%,75%{transform:translate(0px,-1px)}}@keyframes eye-blink{0%,3%,7%,18%,22%,43%,47%,56%,83%,87%,100%{transform:scaleY(1)}5%,20%,45%,85%{transform:scaleY(0.1)}60%{transform:scaleY(1)}62%,72%{transform:scaleY(0.1)}75%{transform:scaleY(1)}}@keyframes arm-l-idle{0%,28%{transform:translate(0,0) rotate(0deg)}30%{transform:translate(1px,-3px) rotate(15deg)}31%{transform:translate(1.5px,-4px) rotate(35deg)}32%{transform:translate(0.5px,-2.5px) rotate(0deg)}33%{transform:translate(1.5px,-4px) rotate(35deg)}34%{transform:translate(0.5px,-2.5px) rotate(0deg)}35%{transform:translate(1.5px,-4px) rotate(35deg)}36%{transform:translate(0.5px,-2.5px) rotate(0deg)}38%,58%{transform:translate(0,0) rotate(0deg)}62%{transform:translate(-1px,-2px) rotate(45deg)}65%{transform:translate(-2px,-3px) rotate(80deg)}72%{transform:translate(0px,1px) rotate(-15deg)}76%,100%{transform:translate(0,0) rotate(0deg)}}@keyframes arm-r-idle{0%,58%{transform:translate(0,0) rotate(0deg)}62%{transform:translate(1px,-2px) rotate(-45deg)}65%{transform:translate(2px,-3px) rotate(-80deg)}72%{transform:translate(0px,1px) rotate(15deg)}76%,100%{transform:translate(0,0) rotate(0deg)}}@keyframes yawn-mouth-anim{0%,58%,76%,100%{opacity:0;transform:scale(0.1)}60%{opacity:1;transform:scale(0.5,0.2)}65%{opacity:1;transform:scale(1.1,1.4)}72%{opacity:1;transform:scale(0.6,0.4)}75%{opacity:0;transform:scale(0.1)}}@keyframes tear-fall{0%,64%,80%,100%{opacity:0;transform:translateY(0)}66%{opacity:1;transform:translateY(0)}72%{opacity:1;transform:translateY(2.5px)}75%{opacity:0;transform:translateY(3px)}}</style></defs><rect class="shadow-anim" x="3" y="15" width="9" height="1" fill="#000000" opacity="0.5"/><g fill="currentColor"><rect x="3" y="13" width="1" height="2"/><rect x="5" y="13" width="1" height="2"/><rect x="9" y="13" width="1" height="2"/><rect x="11" y="13" width="1" height="2"/></g><g class="action-body"><g class="breathe-anim"><rect x="2" y="6" width="11" height="7" fill="currentColor"/><g class="arm-l"><rect x="0" y="9" width="2" height="2" fill="currentColor"/></g><g class="arm-r"><rect x="13" y="9" width="2" height="2" fill="currentColor"/></g><rect class="yawn-mouth" x="6" y="10" width="3" height="2" fill="#000"/><g class="eyes-look" fill="#000"><g class="eyes-blink"><rect x="4" y="8" width="1" height="2"/><rect x="10" y="8" width="1" height="2"/></g></g><rect class="yawn-tear" x="3.5" y="10" width="1" height="1" fill="#40C4FF"/></g></g></svg>`;

interface AndroidBridge2 { getBubbleConfig?:()=>string; setBubbleConfig?:(s:string)=>void; }
function getAndroid2(): AndroidBridge2|null{
  try{return (window as unknown as {Android?:AndroidBridge2}).Android ?? null;}catch{return null;}
}
function loadState(): BubbleCfg{
  try{
    const a=getAndroid2();
    if(a?.getBubbleConfig){
      const raw=a.getBubbleConfig();
      if(raw){ const p=JSON.parse(raw) as BubbleCfg; if(p?.icon && p?.color && p?.size) return {icon:p.icon as IconId, color:p.color, size:p.size, x:p.x??null, y:p.y??null};}
    }
  }catch{}
  try{
    const ls=localStorage.getItem("mock_bubble");
    if(ls){ const p=JSON.parse(ls) as BubbleCfg; if(p?.icon && p?.color && p?.size) return {icon:p.icon as IconId, color:p.color, size:p.size, x:p.x??null, y:p.y??null};}
  }catch{}
  return {...DEFAULT};
}
function persist(s:BubbleCfg){
  try{localStorage.setItem("mock_bubble",JSON.stringify(s));}catch{}
  try{getAndroid2()?.setBubbleConfig?.(JSON.stringify(s));}catch{}
}

export default function BubbleDesignPage(){
  const navigate=useNavigate();
  const showToast=useToast();
  const [state,setState]=useState<BubbleCfg>(()=>loadState());
  const [customOpen,setCustomOpen]=useState(false);
  const [cpText,setCpText]=useState(state.color);
  useEffect(()=>{ setCpText(state.color); },[state.color]);
  const update=(patch:Partial<BubbleCfg>)=>{
    setState(prev=>{ const next={...prev,...patch}; persist(next); return next; });
  };
  const applyCustom=()=>{
    let v=cpText.trim().toLowerCase();
    if(!v.startsWith("#")) v="#"+v;
    if(/^#[0-9a-f]{6}$/.test(v)){ update({color:v}); }
    setCustomOpen(false);
  };
  return (
    <div style={{flex:1,overflowY:"auto",background:"var(--bg)"}}>
      <div style={{maxWidth:960,margin:"0 auto",padding:"24px 24px 96px",width:"100%"}}>
        {/* Header — matches sheet header */}
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:24}}>
          <button className="btn btn-ghost" aria-label="Back" onClick={()=>{ if(window.history.length>1) navigate(-1); else navigate("/"); }} style={{width:32,height:32,padding:0,justifyContent:"center"}}>
            <span style={{fontSize:18,lineHeight:1}}>‹</span>
          </button>
          <h1 style={{fontSize:16,fontWeight:700,letterSpacing:"-0.02em",color:"var(--text)"}}>Bubble design</h1>
        </div>

        {/* Icon — same card as admin-stat-card / file-card */}
        <div style={{border:"1px solid var(--border)",borderRadius:"var(--rl)",background:"var(--bg)",padding:16,marginBottom:12}}>
          <div style={{fontSize:12,fontWeight:600,letterSpacing:"0.04em",textTransform:"uppercase",color:"var(--text3)",marginBottom:12}}>Icon</div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            {([
              {id:"logo" as IconId,label:"Logo"},{id:"claude" as IconId,label:"Claude"},{id:"claudeCode" as IconId,label:"Claude Code · Regular"},{id:"claudeCodePlayful" as IconId,label:"Claude Code · Playful"},{id:"pacman" as IconId,label:"Pac-Man"},
            ]).map(m=>(
              <button key={m.id} onClick={()=>update({icon:m.id})} title={m.label} aria-label={m.label}
                style={{
                  width:64,height:64,borderRadius:"var(--r)",border: m.id===state.icon ? "1.5px solid var(--text)" : "1px solid var(--border)",
                  background: m.id===state.icon ? "var(--bg2)" : "var(--bg)", display:"grid",placeItems:"center", cursor:"pointer", transition:"border-color 0.12s, background 0.12s"
                }}>
                <div style={{width:28,height:28,color:state.color,display:"grid",placeItems:"center"}} dangerouslySetInnerHTML={{__html: (m.id==="claudeCode"||m.id==="claudeCodePlayful") ? CLAUDE_CODE_SVG : (ICONS[m.id] ?? ICON_CLAUDE)}} />
              </button>
            ))}
          </div>
          <div style={{fontSize:11,color:"var(--text3)",marginTop:8}}>Changes apply instantly to the floating bubble if enabled</div>
        </div>

        {/* Color — Vercel minimal, no rounded, 2 lines wrap, bigger */}
        <div style={{border:"1px solid var(--border)",borderRadius:"var(--rl)",background:"var(--bg)",padding:16,marginBottom:12}}>
          <div style={{fontSize:12,fontWeight:600,letterSpacing:"0.04em",textTransform:"uppercase",color:"var(--text3)",marginBottom:12}}>Color</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(28px, 1fr))",gap:0}}>
            <button aria-label="Custom" title="Custom" onClick={()=>{ setCustomOpen(o=>!o); setCpText(state.color); }}
              style={{height:38,display:"grid",placeItems:"center",background:"var(--bg)",border:"1px solid var(--border)",cursor:"pointer"}}>
              <span style={{width:14,height:14,background:"conic-gradient(from 0deg,#ef4444,#f59e0b,#22c55e,#06b6d4,#8b5cf6,#ef4444)",border:"1px solid rgba(0,0,0,.12)",display:"block"}}/>
            </button>
            {COLORS.map(c=>(
              <button key={c} aria-label={c} title={c} onClick={()=>update({color:c.toLowerCase()})}
                style={{
                  height:38, background:c, cursor:"pointer",
                  border: c.toLowerCase()===state.color.toLowerCase() ? "1.5px solid var(--text)" : "1px solid rgba(0,0,0,0.06)",
                  outline: c.toLowerCase()===state.color.toLowerCase() ? "1px solid var(--text)" : "none", outlineOffset:-2
                }} />
            ))}
          </div>
          {customOpen && (
            <div style={{display:"flex",gap:8,alignItems:"center",marginTop:12}}>
              <input type="color" value={/^#[0-9a-f]{6}$/i.test(cpText) ? cpText.toLowerCase() : state.color} onChange={e=>{ const v=e.target.value.toLowerCase(); setCpText(v); update({color:v}); }} style={{width:40,height:36,padding:3,border:"1px solid var(--border)",borderRadius:"var(--r)",background:"var(--bg)"}}/>
              <input type="text" value={cpText} maxLength={7} spellCheck={false} onChange={e=>{ let v=e.target.value.trim(); if(!v.startsWith("#")) v="#"+v; v=v.toLowerCase(); setCpText(e.target.value); if(/^#[0-9a-f]{6}$/.test(v)){ update({color:v}); } }} placeholder="#ef4444" style={{flex:1,padding:"8px 10px",border:"1px solid var(--border)",borderRadius:"var(--r)",fontSize:13,fontFamily:"var(--mono)",background:"var(--bg)",color:"var(--text)"}}/>
              <button className="btn btn-primary btn-sm" onClick={applyCustom}>Use</button>
            </div>
          )}
        </div>

        {/* Size — same slider style as site */}
        <div style={{border:"1px solid var(--border)",borderRadius:"var(--rl)",background:"var(--bg)",padding:16,marginBottom:12}}>
          <div style={{fontSize:12,fontWeight:600,letterSpacing:"0.04em",textTransform:"uppercase",color:"var(--text3)",marginBottom:12}}>Size</div>
          <input type="range" min={36} max={84} step={2} value={state.size} onChange={e=>update({size:+e.target.value})} style={{width:"100%",accentColor:"var(--text)"}}/>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"var(--text3)",marginTop:8}}><span>Small</span><span style={{color:"var(--text)",fontFamily:"var(--mono)",fontWeight:600}}>{state.size} dp</span><span>Large</span></div>
        </div>

        <div style={{display:"flex",gap:8,marginTop:20}}>
          <button className="btn btn-ghost" style={{flex:1}} onClick={()=>{ const n={...DEFAULT}; setState(n); persist(n); showToast("Reset to default"); }}>Reset</button>
          <button className="btn btn-primary" style={{flex:1}} onClick={()=>{ persist(state); showToast(`Saved — ${state.icon} ${state.color} ${state.size}dp`); }}>Save</button>
        </div>
      </div>
    </div>
  );
}
