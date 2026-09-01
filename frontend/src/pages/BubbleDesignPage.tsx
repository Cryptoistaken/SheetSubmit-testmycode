import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useToast } from "@/lib/toast";

type IconId = "claude" | "claudeCode" | "pacman" | "logo";
interface BubbleCfg { icon: IconId; color: string; size: number; x: number | null; y: number | null; }

const DEFAULT: BubbleCfg = { icon: "logo", color: "#ef4444", size: 60, x: null, y: null };
const COLORS = ["#000000","#1e293b","#334155","#64748b","#ffffff","#fff000","#fde68a","#f59e0b","#f97316","#ea580c","#ef4444","#dc2626","#e11d48","#be185d","#E89B83","#C46044","#a855f7","#7e22ce","#8b5cf6","#4f46e5","#2563eb","#1d4ed8","#06b6d4","#0891b2","#0e7490","#047857","#22c55e","#16a34a"];

const ICON_CLAUDE = `<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><rect width="1024" height="1024" rx="230" fill="currentColor"/><g fill="#111111"><rect x="250" y="350" width="120" height="240" rx="20"/><rect x="650" y="350" width="120" height="240" rx="20"/></g><g fill="#FFFFFF"><rect x="270" y="380" width="40" height="60" rx="10"/><rect x="670" y="380" width="40" height="60" rx="10"/></g><path d="M -50 600 L 150 600 L 150 800 L -50 800 Z" fill="#C46044"/><path d="M 874 600 L 1074 600 L 1074 800 L 874 800 Z" fill="#C46044"/></svg>`;
const ICON_PACMAN = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300" width="100%" height="100%"><path fill="currentColor" d="M 150,150 L 236.6,100 A 100 100 0 1 0 236.6,200 Z"/><circle cx="180" cy="110" r="12" fill="#000"/><circle cx="183" cy="106" r="3.5" fill="#fff" opacity="0.9"/></svg>`;
const ICON_LOGO = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"><rect x="2" y="2" width="20" height="20" rx="5" fill="currentColor"/><path d="M7 8h10M7 12h10M7 16h7" stroke="white" stroke-width="1.6" stroke-linecap="round"/></svg>`;
const ICONS: Record<string,string> = { claude: ICON_CLAUDE, pacman: ICON_PACMAN, logo: ICON_LOGO };
const CLAUDE_CODE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 3 16 13" width="100%" height="100%" style="display:block"><defs><style>.action-body{transform-origin:7.5px 13px;animation:action-body 16s infinite ease-in-out}.breathe-anim{transform-origin:7.5px 13px;animation:breathe 3.2s infinite ease-in-out}.shadow-anim{transform-origin:7.5px 15.5px;animation:shadow-action 16s infinite ease-in-out}.arm-l{transform-origin:1px 10px;animation:arm-l-idle 16s infinite ease-in-out}.arm-r{transform-origin:14px 10px;animation:arm-r-idle 16s infinite ease-in-out}.eyes-look{animation:eye-track 16s infinite ease-in-out}.eyes-blink{transform-origin:7.5px 9px;animation:eye-blink 16s infinite linear}.yawn-mouth{transform-origin:7.5px 11px;animation:yawn-mouth-anim 16s infinite ease-in-out;opacity:0}.yawn-tear{animation:tear-fall 16s infinite ease-in-out;opacity:0}@keyframes breathe{0%,100%{transform:scale(1,1) translate(0,0)}50%{transform:scale(1.02,0.98) translate(0,0.5px)}}@keyframes action-body{0%,8%,26%,38%,55%,80%,100%{transform:scale(1,1) translate(0,0)}12%,22%{transform:scale(1,1) translate(1px,0)}42%,50%{transform:scale(1,1) translate(-1px,0)}30%,36%{transform:scale(1,1) translate(0.5px,0)}60%{transform:scale(0.95,1.05) translate(0px,-1px)}65%{transform:scale(0.9,1.1) translate(0px,-2px)}72%{transform:scale(1.05,0.95) translate(0px,1px)}76%{transform:scale(1,1) translate(0px,0px)}}@keyframes shadow-action{0%,8%,26%,38%,55%,80%,100%{transform:scaleX(1) translate(0,0);opacity:0.5}12%,22%{transform:scaleX(1) translate(1px,0);opacity:0.5}42%,50%{transform:scaleX(1) translate(-1px,0);opacity:0.5}30%,36%{transform:scaleX(1) translate(0.5px,0);opacity:0.5}60%{transform:scaleX(0.95) translate(0,0);opacity:0.45}65%{transform:scaleX(0.9) translate(0,0);opacity:0.4}72%{transform:scaleX(1.05) translate(0,0);opacity:0.55}76%{transform:scaleX(1) translate(0,0);opacity:0.5}}@keyframes eye-track{0%,10%,25%,38%,52%,58%,80%,100%{transform:translate(0px,0px)}12%,22%{transform:translate(3px,0px)}42%,50%{transform:translate(-3px,0px)}60%,75%{transform:translate(0px,-1px)}}@keyframes eye-blink{0%,3%,7%,18%,22%,43%,47%,56%,83%,87%,100%{transform:scaleY(1)}5%,20%,45%,85%{transform:scaleY(0.1)}60%{transform:scaleY(1)}62%,72%{transform:scaleY(0.1)}75%{transform:scaleY(1)}}@keyframes arm-l-idle{0%,28%{transform:translate(0,0) rotate(0deg)}30%{transform:translate(1px,-3px) rotate(15deg)}31%{transform:translate(1.5px,-4px) rotate(35deg)}32%{transform:translate(0.5px,-2.5px) rotate(0deg)}33%{transform:translate(1.5px,-4px) rotate(35deg)}34%{transform:translate(0.5px,-2.5px) rotate(0deg)}35%{transform:translate(1.5px,-4px) rotate(35deg)}36%{transform:translate(0.5px,-2.5px) rotate(0deg)}38%,58%{transform:translate(0,0) rotate(0deg)}62%{transform:translate(-1px,-2px) rotate(45deg)}65%{transform:translate(-2px,-3px) rotate(80deg)}72%{transform:translate(0px,1px) rotate(-15deg)}76%,100%{transform:translate(0,0) rotate(0deg)}}@keyframes arm-r-idle{0%,58%{transform:translate(0,0) rotate(0deg)}62%{transform:translate(1px,-2px) rotate(-45deg)}65%{transform:translate(2px,-3px) rotate(-80deg)}72%{transform:translate(0px,1px) rotate(15deg)}76%,100%{transform:translate(0,0) rotate(0deg)}}@keyframes yawn-mouth-anim{0%,58%,76%,100%{opacity:0;transform:scale(0.1)}60%{opacity:1;transform:scale(0.5,0.2)}65%{opacity:1;transform:scale(1.1,1.4)}72%{opacity:1;transform:scale(0.6,0.4)}75%{opacity:0;transform:scale(0.1)}}@keyframes tear-fall{0%,64%,80%,100%{opacity:0;transform:translateY(0)}66%{opacity:1;transform:translateY(0)}72%{opacity:1;transform:translateY(2.5px)}75%{opacity:0;transform:translateY(3px)}}</style></defs><rect class="shadow-anim" x="3" y="15" width="9" height="1" fill="#000000" opacity="0.5"/><g fill="currentColor"><rect x="3" y="13" width="1" height="2"/><rect x="5" y="13" width="1" height="2"/><rect x="9" y="13" width="1" height="2"/><rect x="11" y="13" width="1" height="2"/></g><g class="action-body"><g class="breathe-anim"><rect x="2" y="6" width="11" height="7" fill="currentColor"/><g class="arm-l"><rect x="0" y="9" width="2" height="2" fill="currentColor"/></g><g class="arm-r"><rect x="13" y="9" width="2" height="2" fill="currentColor"/></g><rect class="yawn-mouth" x="6" y="10" width="3" height="2" fill="#000"/><g class="eyes-look" fill="#000"><g class="eyes-blink"><rect x="4" y="8" width="1" height="2"/><rect x="10" y="8" width="1" height="2"/></g></g><rect class="yawn-tear" x="3.5" y="10" width="1" height="1" fill="#40C4FF"/></g></g></svg>`;

interface AndroidBridge2 { getBubbleConfig?:()=>string; setBubbleConfig?:(s:string)=>void; }
function getAndroid2(): AndroidBridge2|null{
  try{return (window as unknown as {Android?:AndroidBridge2}).Android ?? null;}catch{return null;}
}
function loadState(): BubbleCfg{
  // Android bridge first, fallback to localStorage, else default
  try{
    const a=getAndroid2();
    if(a?.getBubbleConfig){
      const raw=a.getBubbleConfig();
      if(raw){ const p=JSON.parse(raw) as BubbleCfg; if(p?.icon && p?.color && p?.size) return {icon:p.icon as IconId, color:p.color, size:p.size, x:p.x??null, y:p.y??null};}
    }
  }catch{/* ignore */}
  try{
    const ls=localStorage.getItem("mock_bubble");
    if(ls){ const p=JSON.parse(ls) as BubbleCfg; if(p?.icon && p?.color && p?.size) return {icon:p.icon as IconId, color:p.color, size:p.size, x:p.x??null, y:p.y??null};}
  }catch{/* ignore */}
  return {...DEFAULT};
}
function persist(s:BubbleCfg){
  try{localStorage.setItem("mock_bubble",JSON.stringify(s));}catch{/* */}
  try{getAndroid2()?.setBubbleConfig?.(JSON.stringify(s));}catch{/* */}
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
    <>
      <style>{`
        .bd-wrap{max-width:100%;margin:0 auto;padding:12px 12px 90px;background:var(--bg,#f8fafc);min-height:calc(100dvh - 56px);overflow-y:auto;overflow-x:hidden;box-sizing:border-box}
        .bd-wrap *{box-sizing:border-box;max-width:100%}
        .bd-top{position:sticky;top:0;z-index:5;background:rgba(248,250,252,.96);backdrop-filter:blur(8px);display:flex;align-items:center;gap:10px;padding:10px 0 10px;margin:0 -12px 8px;border-bottom:1px solid var(--border,#e2e8f0);padding-left:12px;padding-right:12px}
        .bd-back{width:34px;height:34px;border-radius:999px;border:1px solid var(--border,#e2e8f0);background:#fff;display:grid;place-items:center;cursor:pointer;font-size:20px;line-height:1}
        .bd-card{background:var(--card,#fff);border:1px solid var(--border,#e2e8f0);border-radius:14px;padding:12px;margin-top:10px;overflow:hidden}
        .bd-card h3{margin:0;font-size:13px;letter-spacing:-.01em;display:flex;align-items:center;gap:8px}
        .bd-card h3 i{width:24px;height:24px;border-radius:7px;background:#f1f5f9;display:grid;place-items:center;font-style:normal;font-size:13px}
        .bd-iconOpt{width:48px;height:48px;border-radius:12px;border:2px solid var(--border,#e2e8f0);display:grid;place-items:center;cursor:pointer;background:#fff;transition:.15s;flex-shrink:0;overflow:hidden}
        .bd-iconOpt svg{width:100%!important;height:100%!important;display:block;max-width:28px;max-height:28px}
        .bd-iconOpt.on{border-color:#0f172a}
        .bd-sw{width:20px;height:30px;border-radius:0;border:2px solid transparent;cursor:pointer;flex-shrink:0}
        .bd-sw.on{border-color:#0f172a}
        .bd-range{width:100%;accent-color:#0f172a}
        .bd-foot{position:fixed;left:0;right:0;bottom:0;background:rgba(255,255,255,.92);backdrop-filter:blur(10px);border-top:1px solid var(--border,#e2e8f0);padding:10px 14px;display:flex;gap:10px;max-width:640px;margin:0 auto;z-index:30}
        .bd-btn{flex:1;padding:12px;border-radius:12px;border:1px solid var(--border,#e2e8f0);background:#fff;font-weight:700;font-size:13px;cursor:pointer}
        .bd-btnPrimary{background:#0f172a;color:#fff;border-color:#0f172a}
      `}</style>
      <div className="bd-wrap">
        <div className="bd-top">
          <button className="bd-back" aria-label="Back" onClick={()=>{ if(window.history.length>1) navigate(-1); else navigate("/"); }}>‹</button>
          <b style={{fontSize:15,letterSpacing:"-.02em"}}>Sheet Submit</b>
          <span style={{marginLeft:"auto",fontSize:11,fontWeight:700,letterSpacing:".06em",textTransform:"uppercase",color:"#64748b",background:"#fff",border:"1px solid var(--border,#e2e8f0)",padding:"4px 8px",borderRadius:999}}>Bubble design</span>
        </div>
        <h1 style={{margin:"10px 0 2px",fontSize:18,letterSpacing:"-.02em"}}>Bubble design</h1>

        <div className="bd-card">
          <h3><i>⬢</i> Icon</h3>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:10}}>
            {([
              {id:"logo" as IconId},{id:"claude" as IconId},{id:"claudeCode" as IconId},{id:"pacman" as IconId},
            ]).map(m=>(
              <button key={m.id} className={`bd-iconOpt${state.icon===m.id?" on":""}`} aria-label={m.id} onClick={()=>update({icon:m.id})}>
                <div style={{width:28,height:28,color:state.color,display:"grid",placeItems:"center"}} dangerouslySetInnerHTML={{__html: m.id==="claudeCode" ? CLAUDE_CODE_SVG : (ICONS[m.id] ?? ICON_CLAUDE)}} />
              </button>
            ))}
          </div>
        </div>

        <div className="bd-card">
          <h3><i>◉</i> Color</h3>
          <div style={{display:"flex",gap:0,flexWrap:"nowrap",overflowX:"auto",overflowY:"hidden",marginTop:10,paddingBottom:4,scrollbarWidth:"none"}}>
            <button className="bd-sw" aria-label="Custom" title="Custom" onClick={()=>{ setCustomOpen(o=>!o); setCpText(state.color); }} style={{width:20,height:30,padding:0,display:"grid",placeItems:"center",background:"#fff",border:"1px solid var(--border,#e2e8f0)",borderRadius:0,flexShrink:0}}>
              <span style={{width:10,height:10,borderRadius:0,background:"conic-gradient(from 0deg,#ef4444,#f59e0b,#22c55e,#06b6d4,#8b5cf6,#ef4444)",border:"1px solid rgba(0,0,0,.15)",display:"block"}}/>
            </button>
            {COLORS.map(c=>(
              <button key={c} className={`bd-sw${c.toLowerCase()===state.color.toLowerCase()?" on":""}`} aria-label={c} title={c} onClick={()=>update({color:c.toLowerCase()})} style={{background:c,borderColor:c.toLowerCase()==="#ffffff"?"var(--border,#e2e8f0)":undefined}} />
            ))}
          </div>
          {customOpen && (
            <div style={{display:"flex",gap:8,alignItems:"center",marginTop:10}}>
              <input type="color" value={/^#[0-9a-f]{6}$/i.test(cpText) ? cpText.toLowerCase() : state.color} onChange={e=>{ const v=e.target.value.toLowerCase(); setCpText(v); update({color:v}); }} style={{width:40,height:36,padding:3,border:"1px solid var(--border,#e2e8f0)",borderRadius:8,background:"#fff"}}/>
              <input type="text" value={cpText} maxLength={7} spellCheck={false} onChange={e=>{ let v=e.target.value.trim(); if(!v.startsWith("#")) v="#"+v; v=v.toLowerCase(); setCpText(e.target.value); if(/^#[0-9a-f]{6}$/.test(v)){ update({color:v}); } if(/^#[0-9a-f]{6}$/i.test(v)) setCpText(v); }} style={{flex:1,padding:"8px 10px",border:"1px solid var(--border,#e2e8f0)",borderRadius:8,fontSize:13,fontFamily:"ui-monospace,monospace"}}/>
              <button className="bd-btn bd-btnPrimary" style={{padding:"8px 14px",flex:"0 0 auto"}} onClick={applyCustom}>Use</button>
            </div>
          )}
        </div>

        <div className="bd-card">
          <h3><i>↔</i> Size</h3>
          <div style={{marginTop:12}}>
            <input type="range" className="bd-range" min={36} max={84} step={2} value={state.size} onChange={e=>update({size:+e.target.value})}/>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"#64748b",marginTop:4}}><span>Small</span><b style={{color:"#0f172a",fontSize:12,fontFamily:"ui-monospace,monospace"}}>{state.size} dp</b><span>Large</span></div>
          </div>
        </div>
      </div>

      <div className="bd-foot">
        <button className="bd-btn" onClick={()=>{ const n={...DEFAULT}; setState(n); persist(n); showToast("Reset to default"); }}>Reset</button>
        <button className="bd-btn bd-btnPrimary" onClick={()=>{ persist(state); showToast(`Saved — bubble_icon=${state.icon} bubble_color=${state.color} bubble_size=${state.size}`); }}>Save</button>
      </div>
    </>
  );
}
