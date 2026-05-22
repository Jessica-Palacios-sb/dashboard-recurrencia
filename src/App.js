import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend,
  ComposedChart, Area, ReferenceLine
} from 'recharts';
import './App.css';

const API_URL = '/api/recurrencia';
const COLORS = ['#6366f1','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4'];
const PROC_COLORS = { 'Recurrencia':'#FFD700','Cobranza':'#111111','Up-Selling':'#3B82F6','Bootcamp & Cross':'#10B981','Comeback':'#F97316','Cuotas Mentorías':'#A855F7' };

function getGranKey(dateStr, gran) {
  if(!dateStr) return null;
  try {
    const clean = dateStr.slice(0,10);
    if(gran==='dia') return clean;
    if(gran==='mes') return clean.slice(0,7);
    if(gran==='año') return clean.slice(0,4);
    if(gran==='semana') {
      const parts = clean.split('-');
      const d = new Date(+parts[0], +parts[1]-1, +parts[2], 12, 0, 0);
      const day = d.getDay();
      const diffToMon = day===0 ? -6 : 1-day;
      d.setDate(d.getDate() + diffToMon);
      const yy = d.getFullYear();
      const mm = String(d.getMonth()+1).padStart(2,'0');
      const dd = String(d.getDate()).padStart(2,'0');
      return yy+'-'+mm+'-'+dd;
    }
  } catch(e) { return null; }
  return dateStr.slice(0,7);
}

function DateFieldSelector({value, onChange}) {
  const opts = [
    {k:'fecha_pago', l:'Fecha pago'},
    {k:'due_date',   l:'Vencimiento'},
    {k:'fecha_cierre', l:'Fecha cierre'},
  ];
  return(
    <div className="gran-selector">
      {opts.map(o=>(
        <button key={o.k} className={'gran-btn'+(value===o.k?' active':'')} onClick={()=>onChange(o.k)}>{o.l}</button>
      ))}
    </div>
  );
}

function GranSelector({value, onChange}) {
  const opts = [{k:'dia',l:'Día'},{k:'semana',l:'Semana'},{k:'mes',l:'Mes'},{k:'año',l:'Año'}];
  return(
    <div className="gran-selector">
      {opts.map(o=>(
        <button key={o.k} className={'gran-btn'+(value===o.k?' active':'')} onClick={()=>onChange(o.k)}>{o.l}</button>
      ))}
    </div>
  );
}

const fmt = n => n==null?'—':Number(n).toLocaleString('es-CO',{minimumFractionDigits:0,maximumFractionDigits:0});
const fmtUSD = n => n==null?'—':'$'+Number(n).toLocaleString('es-CO',{minimumFractionDigits:0,maximumFractionDigits:0});
const fmtPct = n => n==null?'—':Number(n).toFixed(1)+'%';
const toISO = d => d?d.toISOString().slice(0,10):'';
const startOfDay = d => { const x=new Date(d); x.setHours(0,0,0,0); return x; };

const RANGOS = [
  {label:'Hoy', fn:()=>{const d=startOfDay(new Date());return[d,d];}},
  {label:'Ayer', fn:()=>{const d=startOfDay(new Date());d.setDate(d.getDate()-1);return[d,d];}},
  {label:'Últimos 7 días', fn:()=>{const e=startOfDay(new Date());const s=new Date(e);s.setDate(s.getDate()-6);return[s,e];}},
  {label:'Últimos 30 días', fn:()=>{const e=startOfDay(new Date());const s=new Date(e);s.setDate(s.getDate()-29);return[s,e];}},
  {label:'Este mes', fn:()=>{const n=new Date();return[new Date(n.getFullYear(),n.getMonth(),1),startOfDay(n)];}},
  {label:'Mes pasado', fn:()=>{const n=new Date();const s=new Date(n.getFullYear(),n.getMonth()-1,1);const e=new Date(n.getFullYear(),n.getMonth(),0);return[s,e];}},
  {label:'Máximo', fn:()=>[null,null]},
];

function DateRangePicker({desde,hasta,onChange,titulo='Fecha'}){
  const [open,setOpen]=useState(false);
  const [td,setTd]=useState(desde);
  const [th,setTh]=useState(hasta);
  const wrapRef=useRef(null);
  const [panelStyle,setPanelStyle]=useState({});
  useEffect(()=>{
    if(!open||!wrapRef.current){setPanelStyle({});return;}
    // Always open left-to-right from the button
    setPanelStyle({left:0,right:'auto',position:'absolute',top:'calc(100% + 6px)',zIndex:400});
  },[open]);
  const [active,setActive]=useState('Máximo');
  const ref=useRef();
  useEffect(()=>{
    const h=e=>{if(ref.current&&!ref.current.contains(e.target))setOpen(false);};
    document.addEventListener('mousedown',h);
    return()=>document.removeEventListener('mousedown',h);
  },[]);
  const label=desde&&hasta?`${desde} → ${hasta}`:desde?`Desde ${desde}`:'Todas las fechas';
  return(
    <div className="drp-wrapper" ref={ref}>
      <button className={`filter-btn${(desde||hasta)?' active':''}`} onClick={()=>setOpen(o=>!o)}>
        <span className="filter-btn-label">{titulo}</span>
        <span className="filter-btn-value">{label}</span>
        <span className="filter-btn-arrow">▾</span>
      </button>
      {open&&(
        <div className="drp-panel">
          <div className="drp-left">
            <div className="drp-left-title">Accesos rápidos</div>
            {RANGOS.map(r=>(
              <button key={r.label} className={`drp-rango${active===r.label?' selected':''}`} onClick={()=>{
                setActive(r.label);const[s,e]=r.fn();setTd(s?toISO(s):'');setTh(e?toISO(e):'');
              }}>{r.label}</button>
            ))}
          </div>
          <div className="drp-right">
            <div className="drp-right-title">Rango personalizado</div>
            <div className="drp-inputs">
              <div className="drp-input-group"><label>Desde</label><input type="date" value={td} onChange={e=>{setTd(e.target.value);setActive('');}}/></div>
              <div className="drp-input-group"><label>Hasta</label><input type="date" value={th} onChange={e=>{setTh(e.target.value);setActive('');}}/></div>
            </div>
            {(td||th)&&<div className="drp-preview"><div className="drp-preview-label">Período seleccionado</div><div className="drp-preview-value">{td||'…'} → {th||'…'}</div></div>}
            <div className="drp-actions">
              <button className="drp-btn-cancel" onClick={()=>{setTd(desde);setTh(hasta);setOpen(false);}}>Cancelar</button>
              <button className="drp-btn-apply" onClick={()=>{onChange(td,th);setOpen(false);}}>Actualizar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FilterSelect({label,value,options,onChange,allLabel,multi=false}){
  const [open,setOpen]=useState(false);
  const wrapRef=useRef(null);
  const allLbl=allLabel||label;
  // value is array if multi, string otherwise
  const isActive=multi?(value.length>0):(value!=='Todos');
  // plural label for multi
  const pluralLabel=label.endsWith('s')?label:label+'s';
  const displayLabel=multi
    ?(value.length===0?allLbl:value.length===1?value[0]:value.length+' '+pluralLabel)
    :(value==='Todos'?allLbl:value);
  useEffect(()=>{
    if(!open)return;
    const handler=(e)=>{if(wrapRef.current&&!wrapRef.current.contains(e.target))setOpen(false);};
    document.addEventListener('mousedown',handler);
    return()=>document.removeEventListener('mousedown',handler);
  },[open]);
  const toggleMulti=(o)=>{
    if(value.includes(o)) onChange(value.filter(x=>x!==o));
    else onChange([...value,o]);
  };
  return(
    <div className="filter-wrapper" ref={wrapRef}>
      <button className={`filter-btn${isActive?' active':''}`} onClick={()=>setOpen(o=>!o)}>
        <span className="filter-btn-label">{displayLabel}</span>
        <span>▾</span>
      </button>
      {open&&(
        <div className="filter-dropdown">
          {multi?(
            <>
              <button className={`filter-option${value.length===0?' selected':''}`}
                onClick={()=>{onChange([]);setOpen(false);}}>
                {allLbl}
              </button>
              {options.filter(o=>o!=='Todos').map(o=>(
                <button key={o} className={`filter-option${value.includes(o)?' selected':''}`}
                  onClick={()=>toggleMulti(o)}
                  style={{display:'flex',alignItems:'center',gap:8}}>
                  <span style={{width:14,height:14,border:'1.5px solid #ddd',borderRadius:3,background:value.includes(o)?'#FFD700':'transparent',flexShrink:0,display:'inline-flex',alignItems:'center',justifyContent:'center',fontSize:10,color:'#1a1600'}}>
                    {value.includes(o)?'✓':''}
                  </span>
                  {o}
                </button>
              ))}
              {value.length>0&&<button className="filter-option" style={{borderTop:'1px solid #f0f0f0',color:'#e00',fontSize:11}} onClick={()=>{onChange([]);setOpen(false);}}>✕ Limpiar</button>}
            </>
          ):(
            <>
              <button className={`filter-option${value==='Todos'?' selected':''}`} onClick={()=>{onChange('Todos');setOpen(false);}}>{allLbl}</button>
              {options.filter(o=>o!=='Todos').map(o=>(
                <button key={o} className={`filter-option${value===o?' selected':''}`} onClick={()=>{onChange(o);setOpen(false);}}>{o}</button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── MonthRangePicker ────────────────────────────────────────────────────────
const _MRP_MESES=['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
function _mrpKey(y,m){return`${y}-${String(m+1).padStart(2,'0')}`;}
function _mrpParse(k){const[y,m]=k.split('-');return{y:+y,m:+m-1};}
function _mrpLabel(k){const{y,m}=_mrpParse(k);return`${_MRP_MESES[m]} ${y}`;}
function _mrpAdd(k,n){const{y,m}=_mrpParse(k);const d=new Date(y,m+n,1);return _mrpKey(d.getFullYear(),d.getMonth());}
function _mrpBetween(a,b){const f=a<b?a:b,t=a<b?b:a;const{y:fy,m:fm}=_mrpParse(f);const{y:ty,m:tm}=_mrpParse(t);return(ty-fy)*12+(tm-fm);}
const _MRP_TODAY=new Date();
const _MRP_THIS=_mrpKey(_MRP_TODAY.getFullYear(),_MRP_TODAY.getMonth());
const _MRP_LAST=_mrpAdd(_MRP_THIS,-1);
const _MRP_QUICK=[
  {label:'Último mes',    fn:()=>({from:_MRP_LAST,to:_MRP_LAST})},
  {label:'Últimos 3 m',   fn:()=>({from:_mrpAdd(_MRP_LAST,-2),to:_MRP_LAST})},
  {label:'Últimos 6 m',   fn:()=>({from:_mrpAdd(_MRP_LAST,-5),to:_MRP_LAST})},
  {label:'Último año',    fn:()=>({from:_mrpAdd(_MRP_LAST,-11),to:_MRP_LAST})},
  {label:'Todo',          fn:()=>({from:'',to:''})},
];

function MonthRangePicker({value={from:'',to:''},onChange}){
  const[open,setOpen]=useState(false);
  const[year,setYear]=useState(_MRP_TODAY.getFullYear());
  const[hover,setHover]=useState(null);
  const[anchor,setAnchor]=useState(null);
  const[activeQ,setActiveQ]=useState(null);
  const ref=useRef();
  useEffect(()=>{
    const h=e=>{if(ref.current&&!ref.current.contains(e.target)){setOpen(false);setAnchor(null);setHover(null);}};
    document.addEventListener('mousedown',h);
    return()=>document.removeEventListener('mousedown',h);
  },[]);
  const apply=(from,to)=>{onChange({from,to});setAnchor(null);setHover(null);};
  const handleQuick=(rng,label)=>{
    setActiveQ(label);setAnchor(null);
    const{from,to}=rng.fn();
    apply(from,to);
    if(from)setYear(_mrpParse(from).y);
    setTimeout(()=>setOpen(false),130);
  };
  const handleCell=(key)=>{
    if(key>=_MRP_THIS)return;
    setActiveQ(null);
    if(!anchor){setAnchor(key);onChange({from:key,to:key});}
    else{
      const from=anchor<key?anchor:key,to=anchor<key?key:anchor;
      apply(from,to);
      setTimeout(()=>setOpen(false),130);
    }
  };
  const inRange=(key)=>{
    const f=anchor||value.from,t=hover||value.to;
    if(!f||!t)return false;
    return key>=Math.min(f,t)&&key<=Math.max(f,t);
  };
  const isEdge=(key)=>key===value.from||key===value.to;
  const displayLabel=()=>{
    if(!value.from&&!value.to)return'Todo el período';
    if(value.from===value.to)return _mrpLabel(value.from);
    if(value.from&&value.to)return`${_mrpLabel(value.from)} → ${_mrpLabel(value.to)}`;
    return _mrpLabel(value.from||value.to);
  };
  const hasFilter=value.from||value.to;
  const navBtnSt={background:'none',border:'1px solid #e5e7eb',borderRadius:6,padding:'4px 10px',cursor:'pointer',fontSize:12,color:'#555',fontFamily:'inherit'};
  return(
    <div ref={ref} style={{position:'relative',display:'inline-block'}}>
      <button
        onClick={()=>setOpen(o=>!o)}
        className={`filter-btn${hasFilter?' active':''}`}
        style={{display:'flex',alignItems:'center',gap:6,whiteSpace:'nowrap'}}>
        <span className="filter-btn-label">Período</span>
        <span className="filter-btn-value" style={{maxWidth:180,overflow:'hidden',textOverflow:'ellipsis'}}>{displayLabel()}</span>
        <span style={{transform:open?'rotate(180deg)':'none',transition:'transform .2s',display:'inline-block'}}>▾</span>
      </button>
      {open&&(
        <div style={{
          position:'absolute',top:'calc(100% + 8px)',left:0,zIndex:500,
          background:'#fff',border:'1px solid #e5e7eb',borderRadius:12,
          boxShadow:'0 12px 40px rgba(0,0,0,0.13)',
          display:'flex',minWidth:460,overflow:'hidden',
        }}>
          {/* Quick ranges */}
          <div style={{width:148,borderRight:'1px solid #f0f0f0',padding:'12px 8px',background:'#fafafa',display:'flex',flexDirection:'column',gap:2}}>
            <div style={{fontSize:10,fontWeight:700,color:'#aaa',letterSpacing:1,padding:'4px 8px 8px',textTransform:'uppercase'}}>Acceso rápido</div>
            {_MRP_QUICK.map(r=>(
              <button key={r.label} onClick={()=>handleQuick(r,r.label)} style={{
                textAlign:'left',padding:'8px 12px',borderRadius:7,border:'none',
                background:activeQ===r.label?'#FFD700':'transparent',
                color:activeQ===r.label?'#1a1600':'#333',
                fontWeight:activeQ===r.label?700:400,
                fontSize:13,cursor:'pointer',fontFamily:'inherit',transition:'all .12s',
              }}
              onMouseEnter={e=>{if(activeQ!==r.label)e.currentTarget.style.background='#fff3a0';}}
              onMouseLeave={e=>{if(activeQ!==r.label)e.currentTarget.style.background='transparent';}}
              >{r.label}</button>
            ))}
            {hasFilter&&(
              <button onClick={()=>{apply('','');setActiveQ(null);setOpen(false);}} style={{
                marginTop:'auto',textAlign:'left',padding:'8px 12px',borderRadius:7,
                border:'none',background:'transparent',color:'#ef4444',fontSize:12,cursor:'pointer',fontFamily:'inherit',
              }}>✕ Limpiar</button>
            )}
          </div>
          {/* Calendar */}
          <div style={{padding:'16px 18px',flex:1}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
              <button onClick={()=>setYear(y=>y-1)} style={navBtnSt}>‹ {year-1}</button>
              <span style={{fontWeight:700,fontSize:15,color:'#111'}}>{year}</span>
              <button onClick={()=>setYear(y=>y+1)} disabled={year>=_MRP_TODAY.getFullYear()} style={{...navBtnSt,opacity:year>=_MRP_TODAY.getFullYear()?.4:1}}>
                {year+1} ›
              </button>
            </div>
            <div style={{fontSize:11,color:'#bbb',marginBottom:10,textAlign:'center'}}>
              {anchor?'Selecciona el mes final':'Haz clic para iniciar un rango'}
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:5}}>
              {Array.from({length:12},(_,i)=>{
                const key=_mrpKey(year,i);
                const isFuture=key>=_MRP_THIS;
                const inR=inRange(key);
                const edge=isEdge(key);
                const isAnch=anchor===key;
                return(
                  <button key={key} disabled={isFuture}
                    onClick={()=>handleCell(key)}
                    onMouseEnter={()=>{if(anchor)setHover(key);}}
                    onMouseLeave={()=>{if(anchor)setHover(null);}}
                    style={{
                      padding:'9px 4px',borderRadius:7,border:'none',
                      fontSize:12,fontWeight:edge||isAnch?700:500,
                      cursor:isFuture?'not-allowed':'pointer',fontFamily:'inherit',
                      background:edge||isAnch?'#FFD700':inR?'#FFF9C4':'transparent',
                      color:edge||isAnch?'#1a1600':isFuture?'#d1d5db':inR?'#7a5800':'#333',
                      outline:isAnch?'2px solid #e6c200':'none',outlineOffset:2,
                      transition:'all .1s',position:'relative',
                    }}>
                    {_MRP_MESES[i]}
                    {key===_MRP_LAST&&<span style={{position:'absolute',top:2,right:3,width:5,height:5,borderRadius:'50%',background:'#10b981'}}/>}
                  </button>
                );
              })}
            </div>
            {hasFilter&&(
              <div style={{
                marginTop:12,padding:'8px 12px',background:'#f9fafb',
                borderRadius:8,border:'1px solid #f0f0f0',
                display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,
              }}>
                <div style={{fontSize:12,color:'#555'}}>
                  {value.from&&value.to&&value.from!==value.to
                    ?<><strong style={{color:'#111'}}>{_mrpLabel(value.from)}</strong>{' → '}<strong style={{color:'#111'}}>{_mrpLabel(value.to)}</strong>{` · ${_mrpBetween(value.from,value.to)+1} meses`}</>
                    :<strong style={{color:'#111'}}>{_mrpLabel(value.from||value.to)}</strong>
                  }
                </div>
                <button onClick={()=>{apply(value.from,value.to);setOpen(false);}} style={{
                  padding:'5px 14px',background:'#FFD700',border:'none',
                  borderRadius:6,fontWeight:700,fontSize:12,cursor:'pointer',color:'#1a1600',fontFamily:'inherit',flexShrink:0,
                }}>Aplicar</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function KPICard({label,value,sub,tooltip}){
  const [show,setShow]=useState(false);
  return(
    <div className="kpi-card">
      <div className="kpi-label">
        {label}
        {tooltip&&(
          <span className="kpi-info" onMouseEnter={()=>setShow(true)} onMouseLeave={()=>setShow(false)}>
            ?{show&&<span className="kpi-tooltip">{tooltip}</span>}
          </span>
        )}
      </div>
      <div className="kpi-value">{value}</div>
      {sub&&<div className="kpi-sub">{sub}</div>}
    </div>
  );
}

function SectionTitle({children}){return <h2 className="section-title">{children}</h2>;}

function Semaforo({pct}){
  const color=pct>=90?'#10b981':pct>=70?'#f59e0b':'#ef4444';
  const label=pct>=90?'En meta':'#10b981'?pct>=70?'En riesgo':'Bajo meta':'Bajo meta';
  const emoji=pct>=90?'🟢':pct>=70?'🟡':'🔴';
  return <span className="semaforo" style={{background:color+'22',color,border:`1px solid ${color}44`}}>{emoji} {label} {fmtPct(pct)}</span>;
}






const NAV_ICONS = {
  'Recurrencia':   <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><rect x="1" y="7" width="3" height="7" rx="1"/><rect x="6" y="4" width="3" height="10" rx="1"/><rect x="11" y="1" width="3" height="13" rx="1"/></svg>,
  'Upgrades':      <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M2 11L6 7l3 3 4-5"/><path d="M10 6h3v3"/></svg>,
  'Salud':         <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><circle cx="7.5" cy="7.5" r="5.5"/><path d="M7.5 4.5v3l2 1.5"/></svg>,
  'Cancelaciones': <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M2 4h11M2 7.5h8M2 11h5"/><circle cx="12" cy="11" r="2.5"/><path d="M11 10l1 1 1.5-1.5"/></svg>,
  'Churn':         <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M2 12L5 8l2.5 2L10 6l3 4"/><path d="M2 12h11"/></svg>,
  'Usuarios':      <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><circle cx="5.5" cy="4.5" r="2.5"/><path d="M1 13c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4"/><circle cx="11.5" cy="5.5" r="2"/><path d="M11 13c0-1.5.8-2.8 2.5-3.5"/></svg>,
  'Sincronización': <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M2 7.5a5.5 5.5 0 0 1 9.5-3.8"/><path d="M13 7.5a5.5 5.5 0 0 1-9.5 3.8"/><path d="M10.5 3l1.5 1-1 1.5"/><path d="M4.5 12l-1.5-1 1-1.5"/></svg>,
};
function NavTab({tabs, active, onChange, badges={}}){
  return(
    <div className="sidebar-nav">
      {tabs.map(t=>(
        <button key={t} className={'sidebar-item'+(active===t?' active':'')} onClick={()=>onChange(t)}>
          <div className="sidebar-item-left">
            <span className="sidebar-item-icon">{NAV_ICONS[t]}</span>
            <span className="sidebar-item-name">{t}</span>
          </div>
          {badges[t]&&<span className="sidebar-item-badge">{badges[t]}</span>}
        </button>
      ))}
    </div>
  );
}

function ChurnTab({data}){
  const fmt    = n => n==null?'—':Number(n).toLocaleString('es-CO',{minimumFractionDigits:0,maximumFractionDigits:0});
  const fmtUSD = n => n==null?'—':'$'+Number(n).toLocaleString('es-CO',{minimumFractionDigits:0,maximumFractionDigits:0});
  const fmtPct = n => n==null?'—':Number(n).toFixed(1)+'%';
  const COLORS = ['#6366f1','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4'];
  const TIPO_C = {'Por mora':'#ef4444','Voluntaria':'#f59e0b','Chargeback':'#8b5cf6','Desenrolada':'#06b6d4','Otro':'#94a3b8'};

  // Nuevos por mes (total)
  const nuevosMes = {};
  (data.nuevos||[]).forEach(r=>{
    if(!nuevosMes[r.mes])nuevosMes[r.mes]={mes:r.mes,nuevos:0,revenue:0};
    nuevosMes[r.mes].nuevos += +r.nuevos_clientes;
    nuevosMes[r.mes].revenue += +r.revenue;
  });

  // Cancelaciones por mes (total)
  const cancelMes = {};
  (data.cancelaciones||[]).forEach(r=>{
    if(!cancelMes[r.mes])cancelMes[r.mes]={mes:r.mes,'Por mora':0,'Voluntaria':0,'Chargeback':0,'Desenrolada':0,total:0};
    const n = +r.cancelaciones;
    cancelMes[r.mes].total += n;
    if(cancelMes[r.mes][r.tipo_cancelacion]!==undefined) cancelMes[r.mes][r.tipo_cancelacion] += n;
  });

  // Flujo combinado
  const mesesSet = new Set([...Object.keys(nuevosMes), ...Object.keys(cancelMes)]);
  const flujoData = Array.from(mesesSet).sort()
    .filter(m => m >= '2024-05' && m <= '2026-04')
    .map(m => ({
      mes: m,
      nuevos:     nuevosMes[m]?.nuevos || 0,
      cancelados: cancelMes[m]?.total  || 0,
      neto:       (nuevosMes[m]?.nuevos||0) - (cancelMes[m]?.total||0),
    }));

  // Tasa de churn por mes
  const tasaData = (data.tasaChurn||[])
    .filter(r => r.mes >= '2024-05' && r.mes <= '2026-04')
    .map(r => ({mes:r.mes, tasa:+r.tasa_churn, clientes:+r.clientes_activos, cancelaciones:+r.cancelaciones}));

  // Cancelaciones apiladas por tipo y mes
  const cancelStack = Object.values(cancelMes)
    .filter(d => d.mes >= '2024-05' && d.mes <= '2026-04')
    .sort((a,b) => a.mes.localeCompare(b.mes));

  // Tiempo de vida — agrupar por rango
  const vidaRangos = {};
  (data.tiempoVida||[]).forEach(r=>{
    if(!vidaRangos[r.rango_vida])vidaRangos[r.rango_vida]={rango:r.rango_vida,total:0,'Por mora':0,'Voluntaria':0,'Chargeback':0,'Otro':0};
    vidaRangos[r.rango_vida].total += +r.cantidad;
    if(vidaRangos[r.rango_vida][r.tipo_cancelacion]!==undefined) vidaRangos[r.rango_vida][r.tipo_cancelacion] += +r.cantidad;
  });
  const ORDEN_VIDA = ['Mes 1','Mes 2-3','Mes 4-6','Mes 7-12','+12 meses'];
  const vidaData = ORDEN_VIDA.map(k => vidaRangos[k]||{rango:k,total:0}).filter(d=>d.total>0);
  const totalVida = vidaData.reduce((s,d)=>s+d.total,0);

  // Motivos top
  const motivosAgg = {};
  (data.motivos||[]).forEach(r=>{
    const k = r.motivo_cancelacion||'Sin motivo';
    if(!motivosAgg[k])motivosAgg[k]={motivo:k,casos:0};
    motivosAgg[k].casos += +r.casos;
  });
  const motivosData = Object.values(motivosAgg).sort((a,b)=>b.casos-a.casos).slice(0,10);

  // Churn por país
  const paisData = (data.churnPais||[])
    .filter(r=>r.pais_agrupado)
    .sort((a,b)=>+b.cancelaciones - +a.cancelaciones)
    .slice(0,10)
    .map(r=>({
      pais: r.pais_agrupado,
      clientes: +r.clientes_totales,
      cancelaciones: +r.cancelaciones,
      por_mora: +r.por_mora,
      voluntaria: +r.voluntaria,
      tasa: +r.tasa_churn_pct,
    }));

  // KPIs globales
  const totalNuevos = Object.values(nuevosMes).reduce((s,d)=>s+d.nuevos,0);
  const totalCancel = Object.values(cancelMes).reduce((s,d)=>s+d.total,0);
  const avgTasa = tasaData.length>0 ? tasaData.reduce((s,d)=>s+d.tasa,0)/tasaData.length : 0;
  const lastTasa = tasaData.length>0 ? tasaData[tasaData.length-1] : null;
  const totalPorMora = (data.cancelaciones||[]).filter(r=>r.tipo_cancelacion==='Por mora').reduce((s,r)=>s+(+r.cancelaciones),0);

  return(
    <>
      {/* KPIs */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">Nuevos clientes</div>
          <div className="kpi-value" style={{color:'#10b981'}}>{fmt(totalNuevos)}</div>
          <div className="kpi-sub">Facturas 1 pagadas desde may 2024</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Cancelaciones totales</div>
          <div className="kpi-value" style={{color:'#ef4444'}}>{fmt(totalCancel)}</div>
          <div className="kpi-sub">Desde enero 2025</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Tasa churn promedio</div>
          <div className="kpi-value" style={{color:avgTasa>10?'#ef4444':avgTasa>5?'#f59e0b':'#10b981'}}>{fmtPct(avgTasa)}</div>
          <div className="kpi-sub">Mensual histórico</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Tasa churn último mes</div>
          <div className="kpi-value" style={{color:lastTasa?.tasa>10?'#ef4444':lastTasa?.tasa>5?'#f59e0b':'#10b981'}}>{lastTasa?fmtPct(lastTasa.tasa):'—'}</div>
          <div className="kpi-sub">{lastTasa?.mes||''}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Cancelan por mora</div>
          <div className="kpi-value" style={{color:'#ef4444'}}>{fmtPct(totalCancel>0?totalPorMora/totalCancel*100:0)}</div>
          <div className="kpi-sub">{fmt(totalPorMora)} casos</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Neto acumulado</div>
          <div className="kpi-value" style={{color:totalNuevos-totalCancel>=0?'#10b981':'#ef4444'}}>{totalNuevos-totalCancel>=0?'+':''}{fmt(totalNuevos-totalCancel)}</div>
          <div className="kpi-sub">Nuevos − cancelaciones</div>
        </div>
      </div>

      {/* Insight */}
      <div className="insight-banner" style={{background:'#fef2f2',borderColor:'#fecaca'}}>
        <div className="insight-icon">🔍</div>
        <div>
          <strong>Ciclo de vida del cliente:</strong> Desde enero 2025 entraron <strong>{fmt(totalNuevos)}</strong> clientes nuevos y se cancelaron <strong>{fmt(totalCancel)}</strong> suscripciones — un neto de <strong>{totalNuevos-totalCancel>=0?'+':''}{fmt(totalNuevos-totalCancel)}</strong>. El <strong>{fmtPct(totalCancel>0?totalPorMora/totalCancel*100:0)}</strong> de las cancelaciones son por mora, lo que significa que son potencialmente recuperables con gestión de cobranza temprana.
        </div>
      </div>

      {/* Flujo nuevos vs cancelaciones */}
      <section className="chart-section">
        <h2 className="section-title">Nuevos clientes vs cancelaciones — clientes únicos por mes</h2>
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={flujoData} margin={{top:10,right:20,left:20,bottom:0}}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb"/>
            <XAxis dataKey="mes" tick={{fontSize:11}}/>
            <YAxis tick={{fontSize:11}}/>
            <Tooltip formatter={v=>fmt(v)}/>
            <Legend/>
            <Bar dataKey="nuevos" fill="#10b981" name="Nuevos (adq + comeback)" radius={[4,4,0,0]}/>
            <Bar dataKey="cancelados" fill="#ef4444" name="Cancelados (únicos)" radius={[4,4,0,0]}/>
            <Line type="monotone" dataKey="neto" stroke="#6366f1" strokeWidth={2.5} dot={{r:3}} name="Neto"/>
            <ReferenceLine y={0} stroke="#94a3b8" strokeWidth={1}/>
          </ComposedChart>
        </ResponsiveContainer>
      </section>

      {/* Tasa de churn + Cancelaciones por tipo */}
      <div className="chart-row">
        <section className="chart-section half">
          <h2 className="section-title">Tasa de churn mensual</h2>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={tasaData} margin={{left:10,right:20}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb"/>
              <XAxis dataKey="mes" tick={{fontSize:10}}/>
              <YAxis tickFormatter={v=>v+'%'} tick={{fontSize:11}}/>
              <Tooltip formatter={(v,n)=>n==='Tasa churn'?fmtPct(v):fmt(v)}/>
              <Legend/>
              <Bar dataKey="cancelaciones" fill="#fca5a5" name="Cancelados (únicos)" radius={[4,4,0,0]}/>
              <Line type="monotone" dataKey="tasa" stroke="#ef4444" strokeWidth={2.5} dot={{r:3}} name="Tasa churn"/>
              <ReferenceLine y={5} stroke="#f59e0b" strokeDasharray="4 4" label={{value:'5%',position:'right',fontSize:11}}/>
            </ComposedChart>
          </ResponsiveContainer>
        </section>

        <section className="chart-section half">
          <h2 className="section-title">Cancelaciones por tipo — mensual</h2>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={cancelStack} margin={{left:10,right:20}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb"/>
              <XAxis dataKey="mes" tick={{fontSize:10}}/>
              <YAxis tick={{fontSize:11}}/>
              <Tooltip/>
              <Legend/>
              <Bar dataKey="Por mora"    stackId="a" fill={TIPO_C['Por mora']}    name="Por mora"/>
              <Bar dataKey="Voluntaria"  stackId="a" fill={TIPO_C['Voluntaria']}  name="Voluntaria"/>
              <Bar dataKey="Chargeback"  stackId="a" fill={TIPO_C['Chargeback']}  name="Chargeback"/>
              <Bar dataKey="Desenrolada" stackId="a" fill={TIPO_C['Desenrolada']} name="Desenrolada" radius={[4,4,0,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </section>
      </div>

      {/* Tiempo de vida + Motivos */}
      <div className="chart-row">
        <section className="chart-section half">
          <h2 className="section-title">¿Cuándo cancelan? — tiempo de vida</h2>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={vidaData} margin={{left:10,right:20}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb"/>
              <XAxis dataKey="rango" tick={{fontSize:11}}/>
              <YAxis tickFormatter={v=>fmt(v)} tick={{fontSize:11}}/>
              <Tooltip formatter={(v,n)=>[fmt(v), n]}/>
              <Legend/>
              <Bar dataKey="Por mora"   stackId="a" fill={TIPO_C['Por mora']}   name="Por mora"/>
              <Bar dataKey="Voluntaria" stackId="a" fill={TIPO_C['Voluntaria']} name="Voluntaria"/>
              <Bar dataKey="Chargeback" stackId="a" fill={TIPO_C['Chargeback']} name="Chargeback" radius={[4,4,0,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </section>

        <section className="chart-section half">
          <h2 className="section-title">Top 10 motivos de cancelación</h2>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={motivosData} layout="vertical" margin={{left:10,right:20}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb"/>
              <XAxis type="number" tickFormatter={v=>fmt(v)} tick={{fontSize:11}}/>
              <YAxis type="category" dataKey="motivo" tick={{fontSize:10}} width={130}/>
              <Tooltip formatter={v=>fmt(v)+' casos'}/>
              <Bar dataKey="casos" name="Casos" radius={[0,4,4,0]}>
                {motivosData.map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </section>
      </div>

      {/* Churn por país */}
      <section className="chart-section">
        <h2 className="section-title">Churn por país</h2>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>País</th>
                <th>Clientes</th>
                <th>Cancelaciones</th>
                <th>Por mora</th>
                <th>Voluntaria</th>
                <th>Tasa churn</th>
              </tr>
            </thead>
            <tbody>
              {paisData.map(d=>(
                <tr key={d.pais}>
                  <td>{d.pais}</td>
                  <td>{fmt(d.clientes)}</td>
                  <td style={{color:'#ef4444'}}>{fmt(d.cancelaciones)}</td>
                  <td>{fmt(d.por_mora)}</td>
                  <td>{fmt(d.voluntaria)}</td>
                  <td>
                    <div className="pct-bar-wrap">
                      <div className="pct-bar" style={{width:Math.min(d.tasa,100)+'%',background:d.tasa>15?'#ef4444':d.tasa>8?'#f59e0b':'#10b981'}}/>
                      <span>{fmtPct(d.tasa)}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}


function InsightCards({insights, data}){
  const [open, setOpen] = useState(-1);
  const fmtUSD = n => '$'+Math.round(n).toLocaleString('es-CO');
  const fmtPct = n => Number(n).toFixed(1)+'%';

  const toggle = idx => setOpen(prev => prev===idx ? -1 : idx);

  // Calcular datos por mes para las gráficas
  const porMes = useMemo(()=>{
    const ticket={}, flujo={}, noCobrado={}, retenPais={};
    const mesActual = new Date().toISOString().slice(0,7);

    data.forEach(r=>{
      const m = r.mes;
      if(!m || m >= mesActual) return;
      const esRec = r.proceso_clasificado==='Recurrencia' || r.proceso_clasificado==='Cobranza';

      if(esRec){
        if(!ticket[m])ticket[m]={cobrado:0,clientes:0};
        ticket[m].cobrado += (+r.payment_amount_usd||0);
        ticket[m].clientes += (+r.clientes||0);
      }
      if(esRec){
        flujo[m]=(flujo[m]||0)+(+r.clientes||0);
      }
      if(esRec){
        if(!noCobrado[m])noCobrado[m]={facturado:0,noPagado:0};
        noCobrado[m].facturado += (+r.total_amount_usd||0);
        if(r.estado && r.estado !== 'Pagada') noCobrado[m].noPagado += (+r.total_amount_usd||0);
      }
      if(esRec){
        const p = r.pais_agrupado||'Otros';
        if(!retenPais[p])retenPais[p]={};
        retenPais[p][m]=(retenPais[p][m]||0)+(+r.clientes||0);
      }
    });

    const mesesTicket = Object.keys(ticket).sort();
    const ticketData = mesesTicket.map(m=>({
      mes:m, val: ticket[m].clientes>0 ? Math.round(ticket[m].cobrado/ticket[m].clientes) : 0
    }));

    const mesesFlujo = Object.keys(flujo).sort();
    const flujoData = mesesFlujo.map((m,i)=>{
      if(i===0) return {mes:m, neto:0};
      const ant = flujo[mesesFlujo[i-1]];
      const act = flujo[m];
      return {mes:m, neto:act-ant};
    }).slice(1);

    const mesesNoCob = Object.keys(noCobrado).sort();
    const noCobData = mesesNoCob.map(m=>({
      mes:m, pct: noCobrado[m].facturado>0 ? Math.round(noCobrado[m].noPagado/noCobrado[m].facturado*100) : 0
    }));

    const paises = ['México','Colombia','Estados Unidos','Otros'];
    const retenData = {};
    paises.forEach(p=>{
      if(!retenPais[p]) return;
      const mm = Object.keys(retenPais[p]).sort();
      retenData[p] = mm.map((m,i)=>{
        if(i===0) return {mes:m, pct:null};
        const ant = retenPais[p][mm[i-1]];
        const act = retenPais[p][m];
        const ret = ant>0 ? Math.round(Math.min(act/ant*100,100)) : null;
        return {mes:m, pct:ret};
      }).filter(d=>d.pct!==null);
    });

    return {ticketData, flujoData, noCobData, retenData};
  },[data]);

  const CARDS = [
    {
      id:0, tipo: insights.ticketCambio<-20?'alert':'warn',
      titulo:'Ticket promedio',
      valor: <span>${insights.ticketActual} <span className={insights.ticketCambio<0?'neg':'pos'} style={{fontSize:13}}>{insights.ticketCambio>=0?'▲':'▼'} {Math.abs(insights.ticketCambio).toFixed(1)}% vs inicio</span></span>,
      sub: `Inicio: $${insights.ticketInicio} · Recurrencia real por cliente`,
      verBtn: 'Ver evolución mensual →'
    },
    {
      id:1, tipo: insights.mesesNegativo>insights.totalMeses*0.5?'alert':'warn',
      titulo:'Flujo neto de clientes',
      valor: <span className={insights.mesesNegativo>insights.totalMeses*0.5?'neg':'pos'}>{insights.mesesNegativo} de {insights.totalMeses} meses negativos</span>,
      sub: 'Meses donde perdidos superaron nuevos en recurrencia',
      verBtn: 'Ver nuevos vs perdidos →'
    },
    {
      id:2, tipo: insights.pctNoCobrado>20?'alert':insights.pctNoCobrado>10?'warn':'ok',
      titulo:'Facturas sin cobrar',
      valor: <span className={insights.pctNoCobrado>20?'neg':insights.pctNoCobrado>10?'warn-text':'pos'}>{insights.pctNoCobrado.toFixed(1)}% del total</span>,
      sub: `${fmtUSD(insights.montoNoCobrado)} en No Pagada / En Mora`,
      verBtn: 'Ver evolución mensual →'
    },
    {
      id:3, tipo:'warn',
      titulo:'Retención por país',
      valor: <span style={{fontSize:13}}><span className="pos">▲ {insights.mejorPais?insights.mejorPais[0]:'-'} {insights.mejorPais?fmtPct(insights.mejorPais[1]):'-'}</span>{' · '}<span className="neg">▼ {insights.peorPais?insights.peorPais[0]:'-'} {insights.peorPais?fmtPct(insights.peorPais[1]):'-'}</span></span>,
      sub: 'Mejor vs peor retención (últimos 3 meses)',
      verBtn: 'Ver por país →'
    },
  ];

  const renderChart = (idx) => {
    const {ticketData, flujoData, noCobData, retenData} = porMes;
    const fmtUSD2 = n => '$'+Math.round(n).toLocaleString('es-CO');
    const COLORS_PAIS = {'México':'#f59e0b','Colombia':'#ef4444','Estados Unidos':'#6366f1','Otros':'#94a3b8'};

    if(idx===0 && ticketData.length>1){
      return(
        <ResponsiveContainer width="100%" height={180}>
          <ComposedChart data={ticketData} margin={{left:10,right:20,top:5,bottom:5}}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb"/>
            <XAxis dataKey="mes" tick={{fontSize:10}}/>
            <YAxis tickFormatter={v=>'$'+v} tick={{fontSize:11}}/>
            <Tooltip formatter={(v)=>[fmtUSD2(v),'Ticket promedio']}/>
            <ReferenceLine y={ticketData[0]?.val} stroke="#ef4444" strokeDasharray="4 4" label={{value:'inicio',position:'right',fontSize:10,fill:'#ef4444'}}/>
            <Area type="monotone" dataKey="val" stroke="#FFD700" strokeWidth={2.5} fill="#fffbe0" name="Ticket promedio"/>
          </ComposedChart>
        </ResponsiveContainer>
      );
    }
    if(idx===1 && flujoData.length>0){
      return(
        <ResponsiveContainer width="100%" height={180}>
          <ComposedChart data={flujoData} margin={{left:10,right:20,top:5,bottom:5}}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb"/>
            <XAxis dataKey="mes" tick={{fontSize:10}}/>
            <YAxis tick={{fontSize:11}}/>
            <Tooltip formatter={(v,n)=>[v.toLocaleString('es-CO'), n]}/>
            <ReferenceLine y={0} stroke="#94a3b8" strokeWidth={1}/>
            <Bar dataKey="neto" name="Neto" radius={[3,3,0,0]}>
              {flujoData.map((d,i)=><Cell key={i} fill={d.neto>=0?'#FFD700':'#ef4444'}/>)}
            </Bar>
          </ComposedChart>
        </ResponsiveContainer>
      );
    }
    if(idx===2 && noCobData.length>0){
      return(
        <ResponsiveContainer width="100%" height={180}>
          <ComposedChart data={noCobData} margin={{left:10,right:20,top:5,bottom:5}}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb"/>
            <XAxis dataKey="mes" tick={{fontSize:10}}/>
            <YAxis tickFormatter={v=>v+'%'} tick={{fontSize:11}}/>
            <Tooltip formatter={(v)=>[v.toFixed(1)+'%','Sin cobrar']}/>
            <Area type="monotone" dataKey="pct" stroke="#f59e0b" strokeWidth={2.5} fill="#fffbe0" name="% sin cobrar"/>
          </ComposedChart>
        </ResponsiveContainer>
      );
    }
    if(idx===3){
      const paisesConData = Object.keys(retenData).filter(p=>retenData[p].length>1);
      if(!paisesConData.length) return <p style={{fontSize:12,color:'var(--text3)'}}>Sin datos suficientes</p>;
      const allMeses=[...new Set(paisesConData.flatMap(p=>retenData[p].map(d=>d.mes)))].sort();
      const chartData=allMeses.map(m=>{
        const row={mes:m};
        paisesConData.forEach(p=>{const d=retenData[p].find(x=>x.mes===m);if(d)row[p]=d.pct;});
        return row;
      });
      return(
        <ResponsiveContainer width="100%" height={180}>
          <ComposedChart data={chartData} margin={{left:10,right:20,top:5,bottom:5}}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb"/>
            <XAxis dataKey="mes" tick={{fontSize:10}}/>
            <YAxis tickFormatter={v=>v+'%'} domain={[50,90]} tick={{fontSize:11}}/>
            <Tooltip formatter={(v,n)=>[v?.toFixed(1)+'%', n]}/>
            <ReferenceLine y={70} stroke="#10b981" strokeDasharray="4 4" label={{value:'meta 70%',position:'right',fontSize:10,fill:'#10b981'}}/>
            <Legend iconSize={10} wrapperStyle={{fontSize:11}}/>
            {paisesConData.map(p=>(
              <Line key={p} type="monotone" dataKey={p} stroke={COLORS_PAIS[p]||'#888'} strokeWidth={2} dot={{r:3}} name={p}/>
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      );
    }
    return <p style={{fontSize:12,color:'var(--text3)'}}>Sin datos suficientes</p>;
  };

  return(
    <>
      <div className="insight-cards">
        {CARDS.map(c=>(
          <div key={c.id} className={`insight-card ${c.tipo}${open===c.id?' insight-card-open':''}`} onClick={()=>toggle(c.id)} style={{cursor:'pointer'}}>
            <div className="insight-card-body">
              <div className="insight-card-title">{c.titulo}</div>
              <div className="insight-card-value">{c.valor}</div>
              <div className="insight-card-sub">{c.sub}</div>
              <div style={{fontSize:11,color:'#6366f1',marginTop:6,fontWeight:500}}>{open===c.id?'▲ Cerrar':'▼ '+c.verBtn}</div>
            </div>
          </div>
        ))}
      </div>
      {open>=0&&(
        <div className="insight-panel">
          <div className="insight-panel-header">
            <span className="insight-panel-title">
              {open===0&&'Ticket promedio mensual — recurrencia real (Recurrencia + Cobranza)'}
              {open===1&&'Flujo neto mensual — nuevos vs perdidos en recurrencia'}
              {open===2&&'% facturas sin cobrar por mes de vencimiento'}
              {open===3&&'Retención mensual por país — % clientes que siguen pagando'}
            </span>
            <button className="insight-panel-close" onClick={()=>setOpen(-1)}>✕ Cerrar</button>
          </div>
          {renderChart(open)}
          <p className="insight-panel-note">
            {open===0&&`Caída del ticket promedio de $${insights.ticketInicio} a $${insights.ticketActual} desde el inicio del período analizado.`}
            {open===1&&`${insights.mesesNegativo} de ${insights.totalMeses} meses con más clientes perdidos que nuevos en recurrencia.`}
            {open===2&&`${insights.pctNoCobrado.toFixed(1)}% del total facturado en recurrencia no se cobra. Cada punto equivale a ~${fmtUSD(insights.montoNoCobrado/insights.pctNoCobrado)} mensual sin recuperar.`}
            {open===3&&`${insights.mejorPais?insights.mejorPais[0]:'-'} retiene ${insights.mejorPais?fmtPct(insights.mejorPais[1]):'-'} vs ${insights.peorPais?insights.peorPais[0]:'-'} con ${insights.peorPais?fmtPct(insights.peorPais[1]):'-'}. La línea verde es la meta del 70%.`}
          </p>
        </div>
      )}
    </>
  );
}

function CancelacionesTab({data, nuevos=[]}){
  const fmtUSD = n => n==null?'—':'$'+Number(n).toLocaleString('es-CO',{minimumFractionDigits:0,maximumFractionDigits:0});
  const fmtPct = n => n==null?'—':Number(n).toFixed(1)+'%';
  const fmt = n => n==null?'—':Number(n).toLocaleString('es-CO',{minimumFractionDigits:0,maximumFractionDigits:0});

  const COLORS=['#ef4444','#f59e0b','#8b5cf6','#06b6d4','#6366f1','#10b981'];
  const TIPO_COLORS={'Por mora':'#ef4444','Voluntaria':'#f59e0b','Chargeback':'#8b5cf6','Desenrolada':'#06b6d4','Otro':'#94a3b8'};

  // Totales por tipo de cancelación
  const porTipo = {};
  data.filter(r=>r.tipo_cancelacion!=='Otro'&&r.mes_cancelacion).forEach(r=>{
    const k=r.tipo_cancelacion;
    if(!porTipo[k])porTipo[k]={name:k,n:0};
    porTipo[k].n+=+r.suscripciones;
  });
  const tipoData=Object.values(porTipo).sort((a,b)=>b.n-a.n);
  const totalCancel=tipoData.reduce((s,d)=>s+d.n,0);

  // Cancelaciones por mes (mora vs voluntaria)
  const mesCancelData={};
  data.filter(r=>r.mes_cancelacion&&r.mes_cancelacion>='2024-05'&&r.mes_cancelacion<=new Date().toISOString().slice(0,7)).forEach(r=>{
    const m=r.mes_cancelacion;
    if(!mesCancelData[m])mesCancelData[m]={mes:m,'Por mora':0,'Voluntaria':0,'Chargeback':0,'Desenrolada':0,total:0};
    const n=+r.suscripciones;
    if(mesCancelData[m][r.tipo_cancelacion]!==undefined) mesCancelData[m][r.tipo_cancelacion]+=n;
    mesCancelData[m].total+=n;
  });
  const mesCancelArr=Object.values(mesCancelData).sort((a,b)=>a.mes.localeCompare(b.mes));

  // Duración hasta cancelación
  const duracionBuckets=[
    {rango:'Mes 1',n:0},{rango:'Mes 2-3',n:0},{rango:'Mes 4-6',n:0},
    {rango:'Mes 7-12',n:0},{rango:'+12 meses',n:0}
  ];
  data.filter(r=>r.mes_cancelacion&&r.mes_inicio).forEach(r=>{
    const meses=+r.avg_meses_activo;
    const n=+r.suscripciones;
    if(meses<=1) duracionBuckets[0].n+=n;
    else if(meses<=3) duracionBuckets[1].n+=n;
    else if(meses<=6) duracionBuckets[2].n+=n;
    else if(meses<=12) duracionBuckets[3].n+=n;
    else duracionBuckets[4].n+=n;
  });
  const totalDur=duracionBuckets.reduce((s,d)=>s+d.n,0);

  // Cancelaciones por país
  const porPais={};
  data.filter(r=>r.mes_cancelacion&&r.pais_agrupado).forEach(r=>{
    const k=r.pais_agrupado||'Sin dato';
    if(!porPais[k])porPais[k]={pais:k,total:0,mora:0};
    porPais[k].total+=+r.suscripciones;
    if(r.tipo_cancelacion==='Por mora') porPais[k].mora+=+r.suscripciones;
  });
  const paisData=Object.values(porPais).sort((a,b)=>b.total-a.total).slice(0,10).map(d=>({
    ...d, pct_mora: d.total>0?Math.round(d.mora/d.total*100):0
  }));

  // Nuevas vs cancelaciones por mes (adq + comeback únicos)
  const nuevasMes={};
  nuevos.forEach(r=>{
    const m=r.mes;
    if(!m||m<'2024-05'||m>new Date().toISOString().slice(0,7))return;
    if(!nuevasMes[m])nuevasMes[m]={mes:m,nuevas:0,canceladas:0};
    nuevasMes[m].nuevas+=+r.nuevos_clientes;
  });
  Object.values(mesCancelData).forEach(d=>{
    if(!nuevasMes[d.mes])nuevasMes[d.mes]={mes:d.mes,nuevas:0,canceladas:0};
    nuevasMes[d.mes].canceladas=d.total;
  });
  const flujoSus=Object.values(nuevasMes).sort((a,b)=>a.mes.localeCompare(b.mes)).map(d=>({
    ...d, neto: d.nuevas-d.canceladas
  }));

  // KPIs
  const moraPct=porTipo['Por mora']?porTipo['Por mora'].n/totalCancel*100:0;
  const voluntariaPct=porTipo['Voluntaria']?porTipo['Voluntaria'].n/totalCancel*100:0;
  const avgMeses=data.filter(r=>r.mes_cancelacion).reduce((s,r)=>s+(+r.avg_meses_activo * +r.suscripciones),0)/
    (data.filter(r=>r.mes_cancelacion).reduce((s,r)=>s+(+r.suscripciones),0)||1);

  // Bucket más crítico (mayor volumen) y su % real
  const bucketMax = duracionBuckets.reduce((m,b)=>b.n>m.n?b:m, duracionBuckets[0]);
  const bucketMaxPct = totalDur>0 ? bucketMax.n/totalDur*100 : 0;

  return(
    <>
      {/* KPIs */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">Total cancelaciones</div>
          <div className="kpi-value" style={{color:'#ef4444'}}>{fmt(totalCancel)}</div>
          <div className="kpi-sub">Desde enero 2025</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Por mora</div>
          <div className="kpi-value" style={{color:'#ef4444'}}>{fmtPct(moraPct)}</div>
          <div className="kpi-sub">{fmt(porTipo['Por mora']?.n||0)} suscripciones</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Voluntarias</div>
          <div className="kpi-value" style={{color:'#f59e0b'}}>{fmtPct(voluntariaPct)}</div>
          <div className="kpi-sub">{fmt(porTipo['Voluntaria']?.n||0)} suscripciones</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Duración promedio</div>
          <div className="kpi-value" style={{color:'#6366f1'}}>{avgMeses.toFixed(1)} meses</div>
          <div className="kpi-sub">Antes de cancelar</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Momento más crítico</div>
          <div className="kpi-value" style={{color:'#f59e0b'}}>{bucketMax.rango}</div>
          <div className="kpi-sub">{fmtPct(bucketMaxPct)} de todas las cancelaciones</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Chargeback</div>
          <div className="kpi-value" style={{color:'#8b5cf6'}}>{fmtPct(porTipo['Chargeback']?porTipo['Chargeback'].n/totalCancel*100:0)}</div>
          <div className="kpi-sub">{fmt(porTipo['Chargeback']?.n||0)} casos</div>
        </div>
      </div>

      {/* Insight */}
      <div className="insight-banner" style={{background:'#fef2f2',borderColor:'#fecaca'}}>
        <div className="insight-icon">🔍</div>
        <div>
          <strong>Diagnóstico de cancelaciones:</strong> El <strong>{fmtPct(moraPct)}</strong> de las cancelaciones son por mora — el cliente no cancela porque no quiere el producto, sino porque no paga. El momento más crítico es <strong>{bucketMax.rango}</strong> donde se concentra el <strong>{fmtPct(bucketMaxPct)}</strong> del churn. Activar recuperación temprana en esta ventana puede reducir significativamente la tasa de cancelación total.
        </div>
      </div>

      {/* Cancelaciones por mes mora vs voluntaria */}
      <section className="chart-section">
        <h2 className="section-title">Cancelaciones mensuales — por mora vs voluntarias</h2>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={mesCancelArr} margin={{top:10,right:20,left:20,bottom:0}}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb"/>
            <XAxis dataKey="mes" tick={{fontSize:11}}/>
            <YAxis tick={{fontSize:11}}/>
            <Tooltip/>
            <Legend/>
            <Bar dataKey="Por mora" stackId="a" fill="#ef4444" name="Por mora"/>
            <Bar dataKey="Voluntaria" stackId="a" fill="#f59e0b" name="Voluntaria"/>
            <Bar dataKey="Chargeback" stackId="a" fill="#8b5cf6" name="Chargeback"/>
            <Bar dataKey="Desenrolada" stackId="a" fill="#06b6d4" name="Desenrolada"/>
          </BarChart>
        </ResponsiveContainer>
      </section>

      <div className="chart-row">
        {/* Duración hasta cancelar */}
        <section className="chart-section half">
          <h2 className="section-title">¿Cuándo cancelan? — meses de vida</h2>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={duracionBuckets} margin={{left:10,right:20}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb"/>
              <XAxis dataKey="rango" tick={{fontSize:11}}/>
              <YAxis tickFormatter={v=>fmt(v)} tick={{fontSize:11}}/>
              <Tooltip formatter={v=>[fmt(v)+' cancelaciones', 'Cantidad']}/>
              <Bar dataKey="n" name="Cancelados (únicos)" radius={[4,4,0,0]}>
                {duracionBuckets.map((_,i)=><Cell key={i} fill={i<=1?'#ef4444':i<=2?'#f59e0b':'#10b981'}/>)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </section>

        {/* Tipo de cancelación pie */}
        <section className="chart-section half">
          <h2 className="section-title">Distribución por tipo de cancelación</h2>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={tipoData} dataKey="n" nameKey="name" cx="50%" cy="50%" outerRadius={90}
                label={({name,percent})=>`${name} ${(percent*100).toFixed(0)}%`} labelLine={false}>
                {tipoData.map((d)=><Cell key={d.name} fill={TIPO_COLORS[d.name]||'#94a3b8'}/>)}
              </Pie>
              <Tooltip formatter={v=>fmt(v)+' cancelaciones'}/>
              <Legend/>
            </PieChart>
          </ResponsiveContainer>
        </section>
      </div>

      <div className="chart-row">
        {/* Nuevas vs canceladas */}
        <section className="chart-section half">
          <h2 className="section-title">Nuevas suscripciones vs cancelaciones</h2>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={flujoSus} margin={{left:10,right:20}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb"/>
              <XAxis dataKey="mes" tick={{fontSize:10}}/>
              <YAxis tick={{fontSize:11}}/>
              <Tooltip formatter={v=>fmt(v)}/>
              <Legend/>
              <Bar dataKey="nuevas" fill="#10b981" name="Nuevas" radius={[4,4,0,0]}/>
              <Bar dataKey="canceladas" fill="#ef4444" name="Canceladas" radius={[4,4,0,0]}/>
              <Line type="monotone" dataKey="neto" stroke="#6366f1" strokeWidth={2} dot={{r:3}} name="Neto"/>
              <ReferenceLine y={0} stroke="#94a3b8"/>
            </ComposedChart>
          </ResponsiveContainer>
        </section>

        {/* Cancelaciones por país */}
        <section className="chart-section half">
          <h2 className="section-title">Cancelaciones por país — % por mora</h2>
          <div className="table-wrapper">
            <table className="data-table">
              <thead><tr><th>País</th><th>Total</th><th>Por mora</th><th>% mora</th></tr></thead>
              <tbody>
                {paisData.map(d=>(
                  <tr key={d.pais}>
                    <td>{d.pais}</td>
                    <td>{fmt(d.total)}</td>
                    <td style={{color:'#ef4444'}}>{fmt(d.mora)}</td>
                    <td>
                      <div className="pct-bar-wrap">
                        <div className="pct-bar" style={{width:d.pct_mora+'%',background:d.pct_mora>50?'#ef4444':d.pct_mora>30?'#f59e0b':'#10b981'}}/>
                        <span>{d.pct_mora}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}

function CohortTable({cohortes=[]}){
  const [modo, setModo] = useState('acum'); // 'puntual' | 'acum' | 'ambas'

  // Agrupa por cohorte sumando todas las combinaciones pais/tipo
  const map={};
  const maxN=cohortes.reduce((m,r)=>Math.max(m,+r.mes_n),0);
  cohortes.forEach(r=>{
    if(!map[r.cohorte]) map[r.cohorte]={base:0,puntual:{},acum:{}};
    const n=+r.mes_n;
    if(n===0){
      map[r.cohorte].base += +r.activos_puntual;
    } else {
      map[r.cohorte].puntual[n] = (map[r.cohorte].puntual[n]||0) + (+r.activos_puntual);
      map[r.cohorte].acum[n]    = (map[r.cohorte].acum[n]||0)    + (+r.activos_acum);
    }
  });

  const cohortList=Object.keys(map).sort();
  if(!cohortList.length) return(
    <div style={{padding:'16px',background:'#fef9c3',borderRadius:8,fontSize:13,color:'#854d0e',border:'1px solid #fde68a'}}>
      ⚠️ Sin datos de cohortes. Verifica en la consola del navegador (F12 → Console) si hay un error en <code>/api/salud-cohortes</code>.
    </div>
  );

  const cols=Array.from({length:Math.min(maxN,12)},(_,i)=>i+1);

  const getColor=(pct, isAcum=false)=>{
    if(pct==null) return '#f9fafb';
    if(isAcum){
      if(pct>=80) return '#dbeafe'; // azul claro
      if(pct>=60) return '#ede9fe'; // violeta claro
      if(pct>=40) return '#fce7f3'; // rosa claro
      return '#fdf2f8';
    }
    if(pct>=80) return '#d1fae5';
    if(pct>=60) return '#fef9c3';
    if(pct>=40) return '#fee2e2';
    return '#fecdd3';
  };

  return(
    <section className="chart-section">
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:12,marginBottom:8}}>
        <h2 className="section-title" style={{margin:0}}>Cohortes de retención — % activos por mes</h2>
        <div className="gran-selector">
          {[
            {k:'acum',    l:'Acumulada'},
            {k:'puntual', l:'Puntual'},
            {k:'ambas',   l:'Ambas'},
          ].map(o=>(
            <button key={o.k} className={`gran-btn${modo===o.k?' active':''}`} onClick={()=>setModo(o.k)}>{o.l}</button>
          ))}
        </div>
      </div>

      <div style={{display:'flex',gap:16,flexWrap:'wrap',marginBottom:10}}>
        {(modo==='acum'||modo==='ambas')&&(
          <div style={{display:'flex',alignItems:'center',gap:6,fontSize:12,color:'#555'}}>
            <span style={{width:14,height:14,borderRadius:3,background:'#dbeafe',border:'1px solid #bfdbfe',display:'inline-block'}}/>
            <strong>Acumulada</strong> — pagó al menos una vez hasta M+N (incluye atrasados)
          </div>
        )}
        {(modo==='puntual'||modo==='ambas')&&(
          <div style={{display:'flex',alignItems:'center',gap:6,fontSize:12,color:'#555'}}>
            <span style={{width:14,height:14,borderRadius:3,background:'#d1fae5',border:'1px solid #a7f3d0',display:'inline-block'}}/>
            <strong>Puntual</strong> — pagó exactamente en M+N
          </div>
        )}
        {modo==='ambas'&&(
          <div style={{display:'flex',alignItems:'center',gap:6,fontSize:12,color:'#6366f1'}}>
            <span style={{width:14,height:14,borderRadius:3,background:'#e0e7ff',border:'1px solid #c7d2fe',display:'inline-block'}}/>
            La <strong>brecha</strong> entre ambas = clientes activos que pagan tarde = oportunidad de cobranza
          </div>
        )}
      </div>

      <div style={{fontSize:11,color:'#888',marginBottom:10}}>
        <strong>Verde ≥80% · Amarillo ≥60% · Rojo &lt;60%</strong> &nbsp;·&nbsp;
        Base = clientes que pagaron factura #1 ese mes
      </div>

      <div className="table-wrapper" style={{overflowX:'auto'}}>
        <table className="data-table cohort-table">
          <thead>
            <tr>
              <th style={{minWidth:80}}>Cohorte</th>
              <th style={{minWidth:55,textAlign:'center'}}>Base</th>
              {cols.map(n=>(
                <th key={n} style={{minWidth:modo==='ambas'?90:52,textAlign:'center'}}>M+{n}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cohortList.map(c=>{
              const base=map[c].base||0;
              return(
                <tr key={c}>
                  <td style={{fontWeight:600}}>{c}</td>
                  <td style={{fontWeight:600,color:'#374151',textAlign:'center'}}>{base.toLocaleString('es-CO')}</td>
                  {cols.map(n=>{
                    const punt = map[c].puntual[n];
                    const acum = map[c].acum[n];
                    const pctP = base>0&&punt!=null ? Math.round(punt/base*100) : null;
                    const pctA = base>0&&acum!=null ? Math.round(acum/base*100) : null;

                    if(modo==='puntual'){
                      return(
                        <td key={n} style={{background:getColor(pctP),textAlign:'center',fontSize:12,fontWeight:pctP!=null?600:400,color:pctP!=null?'#1a1a1a':'#d1d5db'}}>
                          {pctP!=null?pctP+'%':'·'}
                        </td>
                      );
                    }
                    if(modo==='acum'){
                      return(
                        <td key={n} style={{background:getColor(pctA,true),textAlign:'center',fontSize:12,fontWeight:pctA!=null?600:400,color:pctA!=null?'#1a1a1a':'#d1d5db'}}>
                          {pctA!=null?pctA+'%':'·'}
                        </td>
                      );
                    }
                    // modo === 'ambas': muestra acum / puntual en la misma celda con brecha
                    const brecha = pctA!=null&&pctP!=null ? pctA-pctP : null;
                    return(
                      <td key={n} style={{textAlign:'center',fontSize:11,padding:'4px 2px',verticalAlign:'middle'}}>
                        {pctA!=null?(
                          <div style={{display:'flex',flexDirection:'column',gap:1}}>
                            <span style={{background:getColor(pctA,true),borderRadius:3,padding:'1px 4px',fontWeight:600,color:'#1e3a8a'}}>{pctA}%</span>
                            <span style={{background:getColor(pctP),borderRadius:3,padding:'1px 4px',fontWeight:500,color:'#1a1a1a'}}>{pctP!=null?pctP+'%':'·'}</span>
                            {brecha>0&&<span style={{fontSize:10,color:'#6366f1',fontWeight:600}}>+{brecha}%</span>}
                          </div>
                        ):'·'}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RetencionComparativa({data=[]}){
  const [modo, setModo] = useState('pct'); // 'pct' | 'clientes'
  const fmtPct = n => n==null?null:n+'%';

  // Preparar series para recharts
  const chartData = data.map(d=>({
    mes: d.mes,
    Recurrencia: modo==='pct' ? d.pctRec : d.cliRec,
    Cuotas:      modo==='pct' ? d.pctCuo : d.cliCuo,
  }));

  return(
    <section className="chart-section">
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:8,marginBottom:12}}>
        <h2 className="section-title" style={{margin:0}}>Retención comparativa — Cuotas vs Recurrencia</h2>
        <div className="gran-selector">
          <button className={`gran-btn${modo==='pct'?' active':''}`} onClick={()=>setModo('pct')}>% Retención</button>
          <button className={`gran-btn${modo==='clientes'?' active':''}`} onClick={()=>setModo('clientes')}>Clientes activos</button>
        </div>
      </div>
      <div style={{display:'flex',gap:16,marginBottom:10,flexWrap:'wrap'}}>
        <div style={{display:'flex',alignItems:'center',gap:5,fontSize:12,color:'var(--text2)'}}>
          <span style={{width:24,height:2,background:'#6366f1',display:'inline-block',borderRadius:2}}/>
          <span>Recurrencia</span>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:5,fontSize:12,color:'var(--text2)'}}>
          <span style={{width:24,height:2,background:'#10b981',display:'inline-block',borderRadius:2,borderTop:'2px dashed #10b981',height:0}}/>
          <span>Cuotas</span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={chartData} margin={{top:10,right:20,left:10,bottom:0}}>
          <defs>
            <linearGradient id="gradRec" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#6366f1" stopOpacity={0.18}/>
              <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
            </linearGradient>
            <linearGradient id="gradCuo" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#10b981" stopOpacity={0.18}/>
              <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb"/>
          <XAxis dataKey="mes" tick={{fontSize:10}}/>
          <YAxis
            tickFormatter={v=>modo==='pct'?v+'%':v}
            domain={modo==='pct'?[0,100]:['auto','auto']}
            tick={{fontSize:11}}/>
          <Tooltip
            formatter={(v,n)=>v==null?['—',n]:modo==='pct'?[v+'%',n]:[v+' clientes',n]}/>
          <Area
            type="monotone"
            dataKey="Recurrencia"
            stroke="#6366f1"
            strokeWidth={2}
            fill="url(#gradRec)"
            dot={{r:2,fill:'#6366f1'}}
            connectNulls={false}/>
          <Area
            type="monotone"
            dataKey="Cuotas"
            stroke="#10b981"
            strokeWidth={2}
            strokeDasharray="5 3"
            fill="url(#gradCuo)"
            dot={{r:2,fill:'#10b981'}}
            connectNulls={false}/>
          {modo==='pct'&&(
            <ReferenceLine y={70} stroke="#f59e0b" strokeDasharray="4 4"
              label={{value:'Meta 70%',position:'right',fontSize:11,fill:'#f59e0b'}}/>
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </section>
  );
}

function SaludTab({data, pais=[], tipoPago='Todos', rango={from:'',to:''}, loadingMap={}, marketingCac=[], marketingLoading=false}){
  const fmtUSD = n => n==null?'—':'$'+Number(n).toLocaleString('es-CO',{minimumFractionDigits:0,maximumFractionDigits:0});
  const fmtPct = n => n==null?'—':Number(n).toFixed(1)+'%';
  const fmt = n => n==null?'—':Number(n).toLocaleString('es-CO',{minimumFractionDigits:0,maximumFractionDigits:0});
  const COLORS=['#6366f1','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4'];

  const SectionLoader = ({skey, height=260}) => loadingMap[skey]
    ? <div style={{height,display:'flex',alignItems:'center',justifyContent:'center',color:'#aaa',fontSize:13,gap:8}}>
        <div className="loading-spinner" style={{width:18,height:18,borderWidth:2}}/> Cargando...
      </div>
    : null;

  // ── Función de filtrado de filas ──────────────────────────────────────────
  const matchFiltros = useCallback((r) => {
    if(pais.length>0 && !pais.includes(r.pais_agrupado)) return false;
    if(tipoPago!=='Todos' && r.tipo_pago!==tipoPago) return false;
    if(rango.from && r.mes && r.mes < rango.from) return false;
    if(rango.to   && r.mes && r.mes > rango.to)   return false;
    return true;
  },[pais, tipoPago, rango]);

  // ── Retención agregada por mes (suma de combinaciones filtradas) ──────────
  const retencionData = useMemo(()=>{
    const agg={};
    (data.retencion||[]).filter(matchFiltros).forEach(r=>{
      if(!agg[r.mes]) agg[r.mes]={mes:r.mes,clientes:0,mrr:0,retenidos:0,perdidos:0};
      agg[r.mes].clientes  += +r.clientes;
      agg[r.mes].mrr       += +r.mrr;
      agg[r.mes].retenidos += +r.retenidos;
      agg[r.mes].perdidos  += +r.perdidos;
    });
    return Object.values(agg).sort((a,b)=>a.mes.localeCompare(b.mes)).map(d=>({
      ...d, tasa: d.clientes>0 ? Math.round(d.retenidos/d.clientes*1000)/10 : 0
    }));
  },[data.retencion, matchFiltros]);

  // ── Ticket global por mes ─────────────────────────────────────────────────
  const ticketData = useMemo(()=>{
    const agg={};
    (data.ticket||[]).filter(matchFiltros).forEach(r=>{
      if(!agg[r.mes]) agg[r.mes]={mes:r.mes,cobrado:0,clientes:0};
      agg[r.mes].cobrado  += +r.cobrado;
      agg[r.mes].clientes += +r.clientes;
    });
    return Object.values(agg).sort((a,b)=>a.mes.localeCompare(b.mes)).map(d=>({
      mes:d.mes, ticket: d.clientes>0 ? Math.round(d.cobrado/d.clientes) : 0
    }));
  },[data.ticket, matchFiltros]);

  // ── Ticket por país (último mes) ──────────────────────────────────────────
  const ticketPais = useMemo(()=>{
    const ultimoMes = ticketData.length>0 ? ticketData[ticketData.length-1].mes : null;
    if(!ultimoMes) return [];
    const agg={};
    (data.ticket||[]).filter(r=>r.mes===ultimoMes).filter(matchFiltros).forEach(r=>{
      if(!agg[r.pais_agrupado]) agg[r.pais_agrupado]={pais:r.pais_agrupado,cobrado:0,clientes:0};
      agg[r.pais_agrupado].cobrado  += +r.cobrado;
      agg[r.pais_agrupado].clientes += +r.clientes;
    });
    return Object.values(agg).map(d=>({
      pais:d.pais, ticket: d.clientes>0 ? Math.round(d.cobrado/d.clientes) : 0, clientes:d.clientes
    })).sort((a,b)=>b.ticket-a.ticket).slice(0,8);
  },[data.ticket, ticketData, matchFiltros]);

  // ── Estados globales ──────────────────────────────────────────────────────
  const {estadoData, totalFac, totalNoPagado} = useMemo(()=>{
    const agg={};
    // para estados usamos filtro sin rango de mes (queremos el acumulado)
    (data.estados||[]).filter(r=>{
      if(pais.length>0 && !pais.includes(r.pais_agrupado)) return false;
      if(tipoPago!=='Todos' && r.tipo_pago!==tipoPago) return false;
      return true;
    }).forEach(r=>{
      const k=r.estado||'Sin dato';
      if(!agg[k]) agg[k]={name:k,facturas:0,facturado:0,cobrado:0};
      agg[k].facturas  += +r.facturas;
      agg[k].facturado += +r.total_facturado;
      agg[k].cobrado   += +r.total_cobrado;
    });
    const estadoData=Object.values(agg).sort((a,b)=>b.facturas-a.facturas);
    const totalFac=estadoData.reduce((s,d)=>s+d.facturas,0);
    const totalNoPagado=estadoData.filter(d=>d.name!=='Pagada').reduce((s,d)=>s+d.facturado,0);
    return {estadoData, totalFac, totalNoPagado};
  },[data.estados, pais, tipoPago]);

  // ── Flujo nuevos vs perdidos ──────────────────────────────────────────────
  const flujoData = useMemo(()=>{
    const agg={};
    (data.flujo||[]).filter(matchFiltros).forEach(r=>{
      if(!agg[r.mes]) agg[r.mes]={mes:r.mes,nuevos:0,perdidos:0};
      agg[r.mes].nuevos   += +r.nuevos;
      agg[r.mes].perdidos += +r.perdidos;
    });
    return Object.values(agg).sort((a,b)=>a.mes.localeCompare(b.mes)).map(d=>({
      ...d, neto: d.nuevos - d.perdidos
    }));
  },[data.flujo, matchFiltros]);

  // ── Cohortes filtradas ────────────────────────────────────────────────────
  const cohortesFiltered = useMemo(()=>{
    return (data.cohortes||[]).filter(r=>{
      if(pais.length>0 && !pais.includes(r.pais_agrupado)) return false;
      if(tipoPago!=='Todos' && r.tipo_pago!==tipoPago) return false;
      return true;
    });
  },[data.cohortes, pais, tipoPago]);

  // Retención comparativa por tipo de pago — siempre muestra Cuotas y Recurrencia
  // independiente del filtro de tipo de pago del topbar
  const retencionComparativa = useMemo(()=>{
    const agg={Cuotas:{},Recurrencia:{}};
    (data.retencion||[]).filter(r=>{
      if(pais.length>0 && !pais.includes(r.pais_agrupado)) return false;
      if(rango.from && r.mes < rango.from) return false;
      if(rango.to   && r.mes > rango.to)   return false;
      return true;
    }).forEach(r=>{
      const tp = r.tipo_pago==='Cuotas'?'Cuotas':'Recurrencia';
      if(!agg[tp][r.mes]) agg[tp][r.mes]={mes:r.mes,clientes:0,retenidos:0};
      agg[tp][r.mes].clientes  += +r.clientes;
      agg[tp][r.mes].retenidos += +r.retenidos;
    });
    const mesesSet = new Set([
      ...Object.keys(agg.Cuotas),
      ...Object.keys(agg.Recurrencia)
    ]);
    return Array.from(mesesSet).sort().map(mes=>({
      mes,
      pctRec:  agg.Recurrencia[mes]?.clientes>0
        ? Math.round(agg.Recurrencia[mes].retenidos/agg.Recurrencia[mes].clientes*100)
        : null,
      pctCuo:  agg.Cuotas[mes]?.clientes>0
        ? Math.round(agg.Cuotas[mes].retenidos/agg.Cuotas[mes].clientes*100)
        : null,
      cliRec:  agg.Recurrencia[mes]?.clientes||null,
      cliCuo:  agg.Cuotas[mes]?.clientes||null,
    }));
  },[data.retencion, pais, rango]);

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const lastRet    = retencionData.length>1 ? retencionData[retencionData.length-2] : null;
  const avgRet     = retencionData.length>0 ? retencionData.reduce((s,d)=>s+d.tasa,0)/retencionData.length : 0;
  const lastTicket = ticketData.length>0 ? ticketData[ticketData.length-1].ticket : 0;
  const firstTicket= ticketData.length>0 ? ticketData[0].ticket : 0;
  const totalFacAcum = (data.estados||[]).filter(r=>{
    if(pais.length>0&&!pais.includes(r.pais_agrupado))return false;
    if(tipoPago!=='Todos'&&r.tipo_pago!==tipoPago)return false;
    return true;
  }).reduce((s,r)=>s+(+r.total_facturado),0);
  const pctNoPagado = totalFacAcum>0 ? totalNoPagado/totalFacAcum*100 : 0;

  // ── Cancelaciones antes de recurrencia ──────────────────────────────────
  // Por cohorte: clientes que pagaron factura #1 pero nunca llegaron a M+1 (acumulado)
  const noRecurrieronData = useMemo(()=>{
    // Agrupar cohortes filtradas por cohorte
    const byCohorte={};
    cohortesFiltered.forEach(r=>{
      const c=r.cohorte;
      if(!byCohorte[c]) byCohorte[c]={cohorte:c,base:0,acumM1:null};
      const n=+r.mes_n;
      if(n===0) byCohorte[c].base += +r.activos_puntual;
      if(n===1 && r.activos_acum!=null){
        byCohorte[c].acumM1 = (byCohorte[c].acumM1||0) + +r.activos_acum;
      }
    });
    return Object.values(byCohorte)
      .filter(d=>d.base>0 && d.acumM1!=null)
      .sort((a,b)=>a.cohorte.localeCompare(b.cohorte))
      .map(d=>({
        cohorte: d.cohorte,
        base: d.base,
        noRecurrieron: d.base - d.acumM1,
        pct: Math.round((d.base - d.acumM1)/d.base*100),
      }));
  },[cohortesFiltered]);

  // KPI: promedio histórico de % que no recurre
  const avgNoRecurre = noRecurrieronData.length>0
    ? Math.round(noRecurrieronData.reduce((s,d)=>s+d.pct,0)/noRecurrieronData.length)
    : null;
  // KPI: último mes disponible
  const lastNoRecurre = noRecurrieronData.length>0
    ? noRecurrieronData[noRecurrieronData.length-1]
    : null;

  // ── LTV estimado ──────────────────────────────────────────────────────────
  // LTV = ticket_promedio / (1 - tasa_retención)
  // Usamos retención acumulada M+6 de cohortes para una estimación más real
  // que la retención mensual puntual
  const ltvData = useMemo(()=>{
    // Retención por país desde ticket (último mes) y retención global
    const ticketPorPais={};
    const retencionPorPais={};

    // Ticket por país (promedio de los últimos 3 meses para suavizar)
    const mesesTicket = [...new Set((data.ticket||[]).map(r=>r.mes))].sort().slice(-3);
    ;(data.ticket||[]).filter(r=>mesesTicket.includes(r.mes)).filter(r=>{
      if(pais.length>0&&!pais.includes(r.pais_agrupado))return false;
      if(tipoPago!=='Todos'&&r.tipo_pago!==tipoPago)return false;
      return true;
    }).forEach(r=>{
      const p=r.pais_agrupado||'Otros';
      if(!ticketPorPais[p])ticketPorPais[p]={cobrado:0,clientes:0};
      ticketPorPais[p].cobrado  += +r.cobrado;
      ticketPorPais[p].clientes += +r.clientes;
    });

    // Retención acumulada M+6 por país desde cohortes (promedio de últimas 6 cohortes)
    const cohortesPais={};
    const ultimasCohortes=[...new Set(cohortesFiltered.map(r=>r.cohorte))].sort().slice(-6);
    cohortesFiltered.filter(r=>ultimasCohortes.includes(r.cohorte)&&+r.mes_n===6).forEach(r=>{
      const p=r.pais_agrupado||'Otros';
      if(!cohortesPais[p])cohortesPais[p]={base:0,acum:0};
      cohortesPais[p].base += +r.activos_puntual; // base M+0
      cohortesPais[p].acum += +r.activos_acum;    // activos en M+6
    });
    // Para base M+0 necesitamos el mes_n=0
    cohortesFiltered.filter(r=>ultimasCohortes.includes(r.cohorte)&&+r.mes_n===0).forEach(r=>{
      const p=r.pais_agrupado||'Otros';
      if(!cohortesPais[p])cohortesPais[p]={base:0,acum:0};
      cohortesPais[p].base += +r.activos_puntual;
    });

    // Retención global acumulada M+6
    const retGlobal={};
    cohortesFiltered.filter(r=>ultimasCohortes.includes(r.cohorte)).forEach(r=>{
      const n=+r.mes_n;
      if(n===0){
        if(!retGlobal.base)retGlobal.base=0;
        retGlobal.base += +r.activos_puntual;
      }
      if(n===6){
        if(!retGlobal.acum)retGlobal.acum=0;
        retGlobal.acum += +r.activos_acum;
      }
    });
    const retGlobalPct = retGlobal.base>0 ? retGlobal.acum/retGlobal.base : null;
    // Convertir retención acumulada M+6 a retención mensual equivalente
    // ret_mensual = (ret_acum_M6)^(1/6)
    const retMensualGlobal = retGlobalPct ? Math.pow(retGlobalPct,1/6) : null;

    // Ticket global (últimos 3 meses)
    const ticketGlobal = Object.values(ticketPorPais).reduce(
      (acc,d)=>({ cobrado:acc.cobrado+d.cobrado, clientes:acc.clientes+d.clientes }),
      {cobrado:0,clientes:0}
    );
    const ticketGlobalVal = ticketGlobal.clientes>0
      ? ticketGlobal.cobrado/ticketGlobal.clientes : 0;
    const ltvGlobal = retMensualGlobal && retMensualGlobal<1 && ticketGlobalVal>0
      ? ticketGlobalVal/(1-retMensualGlobal) : null;
    const mesesRecupero = ltvGlobal && ticketGlobalVal>0
      ? Math.ceil(ltvGlobal/ticketGlobalVal) : null;

    // LTV por país
    const paisesAll=[...new Set([
      ...Object.keys(ticketPorPais),
      ...Object.keys(cohortesPais)
    ])];
    const porPais = paisesAll.map(p=>{
      const t = ticketPorPais[p];
      const ticket = t?.clientes>0 ? t.cobrado/t.clientes : null;
      const cp = cohortesPais[p];
      // Retención mensual equivalente desde M+6 acumulada
      const retAcumM6 = cp?.base>0 ? cp.acum/cp.base : null;
      const retMensual = retAcumM6 ? Math.pow(retAcumM6,1/6) : null;
      const ltv = retMensual&&retMensual<1&&ticket
        ? ticket/(1-retMensual) : null;
      const mesesRec = ltv&&ticket ? Math.ceil(ltv/ticket) : null;
      return {
        pais:p, ticket, retMensual:retMensual?retMensual*100:null,
        retAcumM6:retAcumM6?retAcumM6*100:null, ltv, mesesRec
      };
    }).filter(d=>d.ticket&&d.ltv).sort((a,b)=>b.ltv-a.ltv);

    return { global:{ticket:ticketGlobalVal,ltv:ltvGlobal,mesesRecupero,retMensual:retMensualGlobal?retMensualGlobal*100:null}, porPais };
  },[data.ticket, cohortesFiltered, pais, tipoPago]);

  // ── CAC por mes y país ────────────────────────────────────────────────────
  const cacData = useMemo(()=>{
    if(!marketingCac.length) return { global:null, porPais:[], porMes:[] };

    // Filtrar por país seleccionado
    const filtered = marketingCac.filter(r=>{
      if(pais.length>0 && !pais.includes(r.pais_agrupado)) return false;
      if(rango.from && r.mes < rango.from) return false;
      if(rango.to   && r.mes > rango.to)   return false;
      return true;
    });

    // Agregado global (últimos 3 meses)
    const ultimos3 = [...new Set(filtered.map(r=>r.mes))].sort().slice(-3);
    const global3 = filtered.filter(r=>ultimos3.includes(r.mes));
    const totalSpend   = global3.reduce((s,r)=>s+(+r.spend),0);
    const totalNuevos  = global3.reduce((s,r)=>s+(+r.nuevos),0);
    const cacGlobal    = totalNuevos>0 ? totalSpend/totalNuevos : null;

    // LTV/CAC ratio global
    const ltvCacRatio = cacGlobal && ltvData.global.ltv
      ? +(ltvData.global.ltv/cacGlobal).toFixed(2) : null;

    // Por país (últimos 3 meses)
    const byPais={};
    global3.forEach(r=>{
      if(!byPais[r.pais_agrupado]) byPais[r.pais_agrupado]={spend:0,nuevos:0};
      byPais[r.pais_agrupado].spend  += +r.spend;
      byPais[r.pais_agrupado].nuevos += +r.nuevos;
    });
    const porPais = Object.entries(byPais).map(([p,d])=>{
      const cac = d.nuevos>0 ? d.spend/d.nuevos : null;
      const ltvPais = ltvData.porPais.find(x=>x.pais===p);
      const ltv = ltvPais?.ltv || null;
      const ratio = cac && ltv ? +(ltv/cac).toFixed(2) : null;
      const payback = cac && ltvData.global.ticket ? Math.ceil(cac/ltvData.global.ticket) : null;
      return { pais:p, spend:Math.round(d.spend), nuevos:d.nuevos, cac, ltv, ratio, payback };
    }).filter(d=>d.cac).sort((a,b)=>b.spend-a.spend);

    // Por mes (para gráfico)
    const byMes={};
    filtered.forEach(r=>{
      if(!byMes[r.mes]) byMes[r.mes]={mes:r.mes,spend:0,nuevos:0};
      byMes[r.mes].spend  += +r.spend;
      byMes[r.mes].nuevos += +r.nuevos;
    });
    const porMes = Object.values(byMes).sort((a,b)=>a.mes.localeCompare(b.mes)).map(d=>({
      ...d,
      cac: d.nuevos>0 ? Math.round(d.spend/d.nuevos) : null,
    }));

    return { global:{cac:cacGlobal, spend:totalSpend, nuevos:totalNuevos, ltvCacRatio}, porPais, porMes };
  },[marketingCac, pais, rango, ltvData]);

  return(
    <>
      {/* KPIs salud */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">Retención promedio</div>
          <div className="kpi-value" style={{color:avgRet>=70?'#10b981':avgRet>=60?'#f59e0b':'#ef4444'}}>{fmtPct(avgRet)}</div>
          <div className="kpi-sub">Promedio histórico mensual</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Retención último mes</div>
          <div className="kpi-value" style={{color:lastRet?.tasa>=70?'#10b981':lastRet?.tasa>=60?'#f59e0b':'#ef4444'}}>{lastRet?fmtPct(lastRet.tasa):'—'}</div>
          <div className="kpi-sub">{lastRet?`${lastRet.retenidos} de ${lastRet.clientes} clientes`:''}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Ticket promedio actual</div>
          <div className="kpi-value" style={{color:'#6366f1'}}>{fmtUSD(lastTicket)}</div>
          <div className="kpi-sub" style={{color:lastTicket<firstTicket?'#ef4444':'#10b981'}}>
            {firstTicket>0?`${lastTicket<firstTicket?'▼':'▲'} ${Math.abs(((lastTicket-firstTicket)/firstTicket)*100).toFixed(1)}% vs inicio`:''}
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Facturas no cobradas</div>
          <div className="kpi-value" style={{color:'#ef4444'}}>{fmtPct(pctNoPagado)}</div>
          <div className="kpi-sub">{fmtUSD(totalNoPagado)} sin recuperar</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">No llegan a recurrencia</div>
          <div className="kpi-value" style={{color:avgNoRecurre==null?'#94a3b8':avgNoRecurre>=50?'#ef4444':avgNoRecurre>=30?'#f59e0b':'#10b981'}}>
            {avgNoRecurre!=null?avgNoRecurre+'%':'—'}
          </div>
          <div className="kpi-sub">
            {lastNoRecurre
              ? `Último: ${lastNoRecurre.noRecurrieron} de ${lastNoRecurre.base} en ${lastNoRecurre.cohorte}`
              : 'Promedio histórico por cohorte'}
          </div>
        </div>
      </div>

      {/* Gráfico: % que no llega a recurrencia por cohorte */}
      {noRecurrieronData.length>0&&(
      <section className="chart-section">
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:8,marginBottom:8}}>
          <div>
            <h2 className="section-title" style={{margin:0}}>Activación a recurrencia — % que no llega a pagar su 2ª factura</h2>
            <p style={{fontSize:12,color:'var(--text2)',marginTop:4}}>
              Clientes que pagaron su primera factura pero no volvieron a pagar. Problema de <strong>activación</strong>, no de retención.
            </p>
          </div>
          <div style={{display:'flex',gap:12,alignItems:'center',flexShrink:0}}>
            <div style={{display:'flex',alignItems:'center',gap:5,fontSize:12,color:'var(--text2)'}}>
              <span style={{width:12,height:12,borderRadius:2,background:'#ef4444',display:'inline-block'}}/>
              No recurrieron
            </div>
            <div style={{display:'flex',alignItems:'center',gap:5,fontSize:12,color:'var(--text2)'}}>
              <span style={{width:24,height:2,background:'#6366f1',display:'inline-block'}}/>
              % tendencia
            </div>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={noRecurrieronData} margin={{top:10,right:20,left:10,bottom:0}}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb"/>
            <XAxis dataKey="cohorte" tick={{fontSize:10}} interval="preserveStartEnd"/>
            <YAxis yAxisId="left" tickFormatter={v=>v+'%'} domain={[0,100]} tick={{fontSize:11}}/>
            <YAxis yAxisId="right" orientation="right" tick={{fontSize:11}}/>
            <Tooltip
              formatter={(v,n)=>n==='% no recurrió'?v+'%':v+' clientes'}
              labelFormatter={l=>`Cohorte ${l}`}/>
            <Bar yAxisId="right" dataKey="noRecurrieron" name="No recurrieron" fill="#ef4444" opacity={0.7} radius={[3,3,0,0]}/>
            <Line yAxisId="left" type="monotone" dataKey="pct" name="% no recurrió"
              stroke="#6366f1" strokeWidth={2.5} dot={{r:3}} connectNulls/>
            <ReferenceLine yAxisId="left" y={avgNoRecurre||0} stroke="#f59e0b"
              strokeDasharray="4 4"
              label={{value:`Prom ${avgNoRecurre}%`,position:'right',fontSize:11,fill:'#f59e0b'}}/>
          </ComposedChart>
        </ResponsiveContainer>
      </section>
      )}

      {/* Insight diagnóstico */}
      <div className="insight-banner" style={{background:'#fef2f2',borderColor:'#fecaca'}}>
        <div className="insight-icon">🔍</div>
        <div>
          <strong>Diagnóstico:</strong> La recurrencia no crece por <strong>3 factores simultáneos</strong>: (1) el ticket promedio cayó de ${fmtUSD(firstTicket).replace('$','')} a ${fmtUSD(lastTicket).replace('$','')} desde mayo 2024, (2) desde mayo 2025 los clientes perdidos superan a los nuevos cada mes, y (3) el {fmtPct(pctNoPagado)} de facturas no se cobra. La retención promedio del {fmtPct(avgRet)} significa que cada mes se pierde ~{fmtPct(100-avgRet)} de la base — para crecer, los nuevos deben superar esa pérdida.
        </div>
      </div>

      {/* Retención mes a mes */}
      <section className="chart-section">
        <div className="chart-section-header">
          <h2 className="section-title">Retención mensual — clientes que siguen pagando</h2>
        </div>
        <div className="retencion-nota">
          <strong>¿Cómo se calcula?</strong> Para cada mes se toman los clientes únicos con al menos una factura recurrente pagada (invoice #2+). Se cruza con el mes siguiente: si el cliente volvió a pagar, se cuenta como <em>retenido</em>. La tasa es <em>retenidos ÷ clientes del mes anterior</em>. Se excluyen el mes actual (incompleto) y el mes inmediatamente anterior (puede tener pagos tardíos aún por registrar).
        </div>
        {retencionData.length===0
          ? <SectionLoader skey="retencion" height={300}/>
          : <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={retencionData} margin={{top:10,right:20,left:20,bottom:0}}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb"/>
            <XAxis dataKey="mes" tick={{fontSize:11}}/>
            <YAxis yAxisId="left" tickFormatter={v=>v+'%'} domain={[0,100]} tick={{fontSize:11}}/>
            <YAxis yAxisId="right" orientation="right" tickFormatter={v=>fmt(v)} tick={{fontSize:11}}/>
            <Tooltip formatter={(v,n)=>n==='Tasa retención'?fmtPct(v):fmt(v)}/>
            <Legend/>
            <Bar yAxisId="right" dataKey="retenidos" stackId="a" fill="#10b981" name="Retenidos"/>
            <Bar yAxisId="right" dataKey="perdidos" stackId="a" fill="#ef4444" name="Perdidos"/>
            <Line yAxisId="left" type="monotone" dataKey="tasa" stroke="#6366f1" strokeWidth={2.5} dot={{r:3}} name="Tasa retención"/>
            <ReferenceLine yAxisId="left" y={70} stroke="#f59e0b" strokeDasharray="4 4" label={{value:'Meta 70%',position:'right',fontSize:11}}/>
          </ComposedChart>
        </ResponsiveContainer>}
      </section>

      {/* Retención comparativa — Cuotas vs Recurrencia */}
      {retencionComparativa.length>0&&(
      <RetencionComparativa data={retencionComparativa}/>
      )}

      {/* Nuevos vs perdidos + Ticket */}
      <div className="chart-row">
        <section className="chart-section half">
          <h2 className="section-title">Flujo mensual — nuevos vs perdidos</h2>
          {flujoData.length===0
            ? <SectionLoader skey="flujo"/>
            : <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={flujoData} margin={{left:10,right:20}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb"/>
              <XAxis dataKey="mes" tick={{fontSize:10}}/>
              <YAxis tick={{fontSize:11}}/>
              <Tooltip/>
              <Legend/>
              <Bar dataKey="nuevos" fill="#10b981" name="Nuevos" radius={[4,4,0,0]}/>
              <Bar dataKey="perdidos" fill="#ef4444" name="Perdidos" radius={[4,4,0,0]}/>
              <Line type="monotone" dataKey="neto" stroke="#6366f1" strokeWidth={2} dot={{r:3}} name="Neto"/>
              <ReferenceLine y={0} stroke="#94a3b8" strokeWidth={1}/>
            </ComposedChart>
          </ResponsiveContainer>}
        </section>

        <section className="chart-section half">
          <h2 className="section-title">Ticket promedio mensual — recurrencia</h2>
          {ticketData.length===0
            ? <SectionLoader skey="ticket"/>
            : <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={ticketData} margin={{left:10,right:20}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb"/>
              <XAxis dataKey="mes" tick={{fontSize:10}}/>
              <YAxis tickFormatter={v=>'$'+v} tick={{fontSize:11}}/>
              <Tooltip formatter={v=>fmtUSD(v)}/>
              <Area type="monotone" dataKey="ticket" fill="#eef2ff" stroke="#6366f1" strokeWidth={2} name="Ticket promedio"/>
            </ComposedChart>
          </ResponsiveContainer>}
        </section>
      </div>

      {/* Estado de facturas + Ticket por país */}
      <div className="chart-row">
        <section className="chart-section half">
          <h2 className="section-title">Estado de facturas en recurrencia</h2>
          {estadoData.length===0
            ? <SectionLoader skey="estados"/>
            : <div className="table-wrapper">
            <table className="data-table">
              <thead><tr><th>Estado</th><th>Facturas</th><th>%</th><th>Facturado</th><th>Cobrado</th></tr></thead>
              <tbody>
                {estadoData.map((d,i)=>(
                  <tr key={d.name}>
                    <td><span className="badge" style={{background:COLORS[i%COLORS.length]+'22',color:COLORS[i%COLORS.length]}}>{d.name}</span></td>
                    <td>{fmt(d.facturas)}</td>
                    <td>{fmtPct(d.facturas/totalFac*100)}</td>
                    <td>{fmtUSD(d.facturado)}</td>
                    <td className="amount">{fmtUSD(d.cobrado)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}
        </section>

        <section className="chart-section half">
          <h2 className="section-title">Ticket promedio por país — último mes</h2>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={ticketPais} layout="vertical" margin={{left:10,right:20}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb"/>
              <XAxis type="number" tickFormatter={v=>'$'+v} tick={{fontSize:11}}/>
              <YAxis type="category" dataKey="pais" tick={{fontSize:11}} width={110}/>
              <Tooltip formatter={v=>fmtUSD(v)}/>
              <Bar dataKey="ticket" name="Ticket promedio" radius={[0,4,4,0]}>
                {ticketPais.map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </section>
      </div>

      {/* LTV Estimado */}
      {ltvData.global.ltv&&(
      <section className="chart-section">
        <h2 className="section-title">LTV estimado — valor de vida del cliente</h2>
        <div className="retencion-nota" style={{marginBottom:16}}>
          <strong>¿Qué es el LTV?</strong> Es el dinero total que te pagará un cliente durante todo el tiempo que permanezca contigo.
          Se calcula como <strong>Ticket ÷ (1 − retención mensual)</strong> — por ejemplo, si un cliente paga $26/mes
          y el 76% sigue pagando cada mes, su LTV es $26 ÷ 0.24 = <strong>$108</strong>.
          La retención mensual la derivamos del comportamiento real de las últimas 6 cohortes:
          de cada 100 clientes que entraron, ¿cuántos siguen pagando 6 meses después?
          <br/><br/>
          <strong>Meses para recuperar</strong> = cuántos pagos necesita hacer el cliente para que hayas recuperado lo que invertiste en conseguirlo.
          Si el LTV es $108 y el ticket es $26, necesitas ~4 pagos para estar en positivo.
        </div>

        {/* KPIs globales LTV */}
        <div className="kpi-grid" style={{marginBottom:20}}>
          <div className="kpi-card">
            <div className="kpi-label">LTV global estimado</div>
            <div className="kpi-value" style={{color:'#6366f1'}}>{fmtUSD(ltvData.global.ltv)}</div>
            <div className="kpi-sub">Valor promedio por cliente</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Ticket promedio (últ. 3m)</div>
            <div className="kpi-value" style={{color:'#10b981'}}>{fmtUSD(ltvData.global.ticket)}</div>
            <div className="kpi-sub">Promedio últimos 3 meses</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Retención mensual equiv.</div>
            <div className="kpi-value" style={{color:ltvData.global.retMensual>=70?'#10b981':ltvData.global.retMensual>=60?'#f59e0b':'#ef4444'}}>
              {ltvData.global.retMensual!=null?ltvData.global.retMensual.toFixed(1)+'%':'—'}
            </div>
            <div className="kpi-sub">Derivada de retención M+6</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Meses para recuperar</div>
            <div className="kpi-value" style={{color:'#f59e0b'}}>{ltvData.global.mesesRecupero||'—'}</div>
            <div className="kpi-sub">A partir de 2ª factura</div>
          </div>
        </div>

        {/* Tabla por país */}
        {ltvData.porPais.length>0&&(
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>País</th>
                <th style={{textAlign:'right'}}>Ticket prom.</th>
                <th style={{textAlign:'right'}}>
                  Activos a 6 meses
                  <div style={{fontSize:10,fontWeight:400,color:'var(--text3)'}}>de cada 100 que entraron</div>
                </th>
                <th style={{textAlign:'right'}}>
                  Retención mensual
                  <div style={{fontSize:10,fontWeight:400,color:'var(--text3)'}}>% que paga el mes siguiente</div>
                </th>
                <th style={{textAlign:'right'}}>LTV estimado</th>
                <th style={{textAlign:'right'}}>Meses recupero</th>
              </tr>
            </thead>
            <tbody>
              {ltvData.porPais.map(d=>(
                <tr key={d.pais}>
                  <td style={{fontWeight:600}}>{d.pais}</td>
                  <td style={{textAlign:'right'}}>{fmtUSD(d.ticket)}</td>
                  <td style={{textAlign:'right'}}>
                    <span style={{color:d.retAcumM6>=50?'#10b981':d.retAcumM6>=35?'#f59e0b':'#ef4444',fontWeight:600}}>
                      {d.retAcumM6!=null?d.retAcumM6.toFixed(1)+'%':'—'}
                    </span>
                  </td>
                  <td style={{textAlign:'right'}}>
                    <span style={{color:d.retMensual>=80?'#10b981':d.retMensual>=70?'#f59e0b':'#ef4444',fontWeight:600}}>
                      {d.retMensual!=null?d.retMensual.toFixed(1)+'%':'—'}
                    </span>
                  </td>
                  <td style={{textAlign:'right'}}>
                    <span style={{fontWeight:700,color:'#6366f1'}}>{fmtUSD(d.ltv)}</span>
                  </td>
                  <td style={{textAlign:'right'}}>
                    <span style={{
                      padding:'2px 8px',borderRadius:12,fontSize:12,fontWeight:600,
                      background:d.mesesRec<=6?'#d1fae5':d.mesesRec<=12?'#fef9c3':'#fee2e2',
                      color:d.mesesRec<=6?'#065f46':d.mesesRec<=12?'#854d0e':'#991b1b'
                    }}>
                      {d.mesesRec} meses
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
      </section>
      )}

      {/* CAC y LTV/CAC */}
      <section className="chart-section">
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:8,marginBottom:12}}>
          <div>
            <h2 className="section-title" style={{margin:0}}>CAC y retorno de inversión en adquisición</h2>
            <p style={{fontSize:12,color:'var(--text2)',marginTop:4}}>
              <strong>CAC</strong> = Spend de marketing ÷ clientes que pagaron factura #1 ese mes (últimos 3 meses).
              <strong> LTV/CAC</strong> &gt; 3 = rentable · entre 1-3 = ajustado · &lt; 1 = pérdida por cliente.
            </p>
          </div>
        </div>

        {marketingLoading&&<div style={{padding:20,color:'var(--text3)',fontSize:13}}>Cargando datos de marketing...</div>}

        {!marketingLoading&&cacData.global&&(
          <>
            {/* KPIs globales CAC */}
            <div className="kpi-grid" style={{marginBottom:20}}>
              <div className="kpi-card">
                <div className="kpi-label">CAC global (últ. 3m)</div>
                <div className="kpi-value" style={{color:'#6366f1'}}>{fmtUSD(cacData.global.cac)}</div>
                <div className="kpi-sub">Costo por cliente adquirido</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">Spend total (últ. 3m)</div>
                <div className="kpi-value" style={{color:'#374151'}}>{fmtUSD(cacData.global.spend)}</div>
                <div className="kpi-sub">{cacData.global.nuevos?.toLocaleString('es-CO')} clientes adquiridos</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">LTV / CAC</div>
                <div className="kpi-value" style={{color:
                  cacData.global.ltvCacRatio>=3?'#10b981':
                  cacData.global.ltvCacRatio>=1?'#f59e0b':'#ef4444'}}>
                  {cacData.global.ltvCacRatio!=null?cacData.global.ltvCacRatio+'x':'—'}
                </div>
                <div className="kpi-sub">
                  {cacData.global.ltvCacRatio>=3?'✓ Rentable':
                   cacData.global.ltvCacRatio>=1?'⚠ Ajustado':'✗ Pérdida por cliente'}
                </div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">Payback global</div>
                <div className="kpi-value" style={{color:'#f59e0b'}}>
                  {cacData.global.cac&&ltvData.global.ticket
                    ? Math.ceil(cacData.global.cac/ltvData.global.ticket)+' meses'
                    : '—'}
                </div>
                <div className="kpi-sub">Meses para recuperar el CAC</div>
              </div>
            </div>

            {/* Gráfico CAC por mes */}
            {cacData.porMes.length>0&&(
              <ResponsiveContainer width="100%" height={220} style={{marginBottom:20}}>
                <ComposedChart data={cacData.porMes} margin={{top:5,right:20,left:10,bottom:0}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb"/>
                  <XAxis dataKey="mes" tick={{fontSize:10}}/>
                  <YAxis yAxisId="left" tick={{fontSize:11}} tickFormatter={v=>'$'+v}/>
                  <YAxis yAxisId="right" orientation="right" tick={{fontSize:11}}/>
                  <Tooltip formatter={(v,n)=>n==='CAC'?'$'+v:n==='Nuevos'?v+' clientes':'$'+v}/>
                  <Bar yAxisId="right" dataKey="nuevos" name="Nuevos" fill="#e0e7ff" radius={[3,3,0,0]}/>
                  <Line yAxisId="left" type="monotone" dataKey="cac" name="CAC" stroke="#6366f1" strokeWidth={2.5} dot={{r:3}}/>
                </ComposedChart>
              </ResponsiveContainer>
            )}

            {/* Tabla por país */}
            {cacData.porPais.length>0&&(
              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>País</th>
                      <th style={{textAlign:'right'}}>Spend (últ. 3m)</th>
                      <th style={{textAlign:'right'}}>Nuevos</th>
                      <th style={{textAlign:'right'}}>CAC</th>
                      <th style={{textAlign:'right'}}>LTV estimado</th>
                      <th style={{textAlign:'right'}}>LTV / CAC</th>
                      <th style={{textAlign:'right'}}>Payback</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cacData.porPais.map(d=>(
                      <tr key={d.pais}>
                        <td style={{fontWeight:600}}>{d.pais}</td>
                        <td style={{textAlign:'right'}}>{fmtUSD(d.spend)}</td>
                        <td style={{textAlign:'right'}}>{d.nuevos?.toLocaleString('es-CO')}</td>
                        <td style={{textAlign:'right',fontWeight:600,color:'#6366f1'}}>{fmtUSD(d.cac)}</td>
                        <td style={{textAlign:'right'}}>{fmtUSD(d.ltv)}</td>
                        <td style={{textAlign:'right'}}>
                          <span style={{
                            padding:'2px 8px',borderRadius:12,fontSize:12,fontWeight:700,
                            background:d.ratio>=3?'#d1fae5':d.ratio>=1?'#fef9c3':'#fee2e2',
                            color:d.ratio>=3?'#065f46':d.ratio>=1?'#854d0e':'#991b1b'
                          }}>
                            {d.ratio!=null?d.ratio+'x':'—'}
                          </span>
                        </td>
                        <td style={{textAlign:'right',fontSize:13}}>
                          {d.payback!=null?d.payback+' meses':'—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {!marketingLoading&&!cacData.global&&(
          <div style={{padding:'16px',background:'#fef9c3',borderRadius:8,fontSize:13,color:'#854d0e',border:'1px solid #fde68a'}}>
            Sin datos de marketing disponibles para el período seleccionado.
          </div>
        )}
      </section>

      {/* Cohortes de retención */}
      {loadingMap.cohortes
        ? <section className="chart-section">
            <h2 className="section-title">Cohortes de retención — % activos por mes desde primera factura</h2>
            <SectionLoader skey="cohortes" height={200}/>
          </section>
        : <CohortTable cohortes={cohortesFiltered}/>
      }
    </>
  );
}

// ── Auth Screens ─────────────────────────────────────────────────────────────
function LoginScreen({onLogin, onGoRegister, onGoReset}){
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');

  const handleSubmit = async(e)=>{
    e.preventDefault();
    setLoading(true); setError('');
    try{
      const r = await fetch('/api/auth-login',{
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({email,password})
      });
      const d = await r.json();
      if(!r.ok) throw new Error(d.error);
      onLogin(d.user, d.token);
    } catch(err){ setError(err.message); }
    finally{ setLoading(false); }
  };

  return(
    <div style={{minHeight:'100vh',background:'#0d0d0d',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'system-ui,sans-serif'}}>
      <div style={{width:'100%',maxWidth:400,padding:24}}>
        <div style={{textAlign:'center',marginBottom:32}}>
          <img src={process.env.PUBLIC_URL+"/logo.png"} alt="Beemo" style={{width:64,height:64,objectFit:"contain",marginBottom:8}}/>
          <h1 style={{color:'#FFD700',fontSize:24,fontWeight:700,margin:0}}>Dashboard Beemo</h1>
          <p style={{color:'rgba(255,255,255,0.4)',fontSize:14,margin:'8px 0 0'}}>Ingresa tus credenciales para continuar</p>
        </div>
        <form onSubmit={handleSubmit} style={{display:'flex',flexDirection:'column',gap:16}}>
          <div>
            <label style={{display:'block',color:'rgba(255,255,255,0.6)',fontSize:12,fontWeight:500,marginBottom:6}}>EMAIL</label>
            <input type="email" value={email} onChange={e=>setEmail(e.target.value)} required
              style={{width:'100%',padding:'10px 14px',background:'rgba(255,255,255,0.07)',border:'1px solid rgba(255,255,255,0.12)',borderRadius:8,color:'#fff',fontSize:14,outline:'none',boxSizing:'border-box'}}
              placeholder="tu@smartbeemo.com"/>
          </div>
          <div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
              <label style={{color:'rgba(255,255,255,0.6)',fontSize:12,fontWeight:500}}>CONTRASEÑA</label>
              <button type="button" onClick={onGoReset} style={{background:'none',border:'none',color:'rgba(255,255,255,0.4)',fontSize:12,cursor:'pointer',padding:0}}>
                ¿Olvidaste tu contraseña?
              </button>
            </div>
            <input type="password" value={password} onChange={e=>setPassword(e.target.value)} required
              style={{width:'100%',padding:'10px 14px',background:'rgba(255,255,255,0.07)',border:'1px solid rgba(255,255,255,0.12)',borderRadius:8,color:'#fff',fontSize:14,outline:'none',boxSizing:'border-box'}}
              placeholder="••••••••"/>
          </div>
          {error&&<div style={{background:'rgba(239,68,68,0.15)',border:'1px solid rgba(239,68,68,0.3)',borderRadius:8,padding:'10px 14px',color:'#fca5a5',fontSize:13}}>{error}</div>}
          <button type="submit" disabled={loading}
            style={{padding:'12px',background:'#FFD700',border:'none',borderRadius:8,fontWeight:700,fontSize:15,cursor:loading?'not-allowed':'pointer',opacity:loading?.7:1,color:'#111'}}>
            {loading?'Ingresando...':'Ingresar'}
          </button>
        </form>
        <p style={{textAlign:'center',marginTop:20,color:'rgba(255,255,255,0.4)',fontSize:13}}>
          ¿No tienes acceso?{' '}
          <button onClick={onGoRegister} style={{background:'none',border:'none',color:'#FFD700',cursor:'pointer',fontSize:13,fontWeight:600,padding:0}}>
            Solicitar acceso
          </button>
        </p>
      </div>
    </div>
  );
}

function ResetScreen({onGoLogin, resetToken=null}){
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [loading,setLoading]=useState(false);
  const [msg,setMsg]=useState('');
  const [error,setError]=useState('');
  const isConfirm = !!resetToken;

  const handleRequest = async(e)=>{
    e.preventDefault(); setLoading(true); setError(''); setMsg('');
    try{
      const r = await fetch('/api/auth-reset?action=request',{
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({email})
      });
      const d = await r.json();
      if(!r.ok) throw new Error(d.error);
      setMsg(d.message);
    } catch(err){ setError(err.message); }
    finally{ setLoading(false); }
  };

  const handleConfirm = async(e)=>{
    e.preventDefault(); setLoading(true); setError(''); setMsg('');
    try{
      const r = await fetch('/api/auth-reset?action=confirm',{
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({token:resetToken, password})
      });
      const d = await r.json();
      if(!r.ok) throw new Error(d.error);
      setMsg('¡Contraseña actualizada! Ya puedes iniciar sesión.');
      setTimeout(()=>onGoLogin(), 2000);
    } catch(err){ setError(err.message); }
    finally{ setLoading(false); }
  };

  return(
    <div style={{minHeight:'100vh',background:'#0d0d0d',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'system-ui,sans-serif'}}>
      <div style={{width:'100%',maxWidth:400,padding:24}}>
        <div style={{textAlign:'center',marginBottom:32}}>
          <img src={process.env.PUBLIC_URL+"/logo.png"} alt="Beemo" style={{width:64,height:64,objectFit:"contain",marginBottom:8}}/>
          <h1 style={{color:'#FFD700',fontSize:24,fontWeight:700,margin:0}}>{isConfirm?'Nueva contraseña':'Recuperar contraseña'}</h1>
          <p style={{color:'rgba(255,255,255,0.4)',fontSize:14,margin:'8px 0 0'}}>
            {isConfirm?'Ingresa tu nueva contraseña':'Te enviaremos un enlace a tu email'}
          </p>
        </div>
        {msg?(
          <div style={{background:'rgba(16,185,129,0.15)',border:'1px solid rgba(16,185,129,0.3)',borderRadius:12,padding:20,textAlign:'center',color:'#6ee7b7',fontSize:14}}>
            {msg}
          </div>
        ):(
          <form onSubmit={isConfirm?handleConfirm:handleRequest} style={{display:'flex',flexDirection:'column',gap:16}}>
            {!isConfirm&&(
              <div>
                <label style={{display:'block',color:'rgba(255,255,255,0.6)',fontSize:12,fontWeight:500,marginBottom:6}}>EMAIL</label>
                <input type="email" value={email} onChange={e=>setEmail(e.target.value)} required
                  style={{width:'100%',padding:'10px 14px',background:'rgba(255,255,255,0.07)',border:'1px solid rgba(255,255,255,0.12)',borderRadius:8,color:'#fff',fontSize:14,outline:'none',boxSizing:'border-box'}}
                  placeholder="tu@smartbeemo.com"/>
              </div>
            )}
            {isConfirm&&(
              <div>
                <label style={{display:'block',color:'rgba(255,255,255,0.6)',fontSize:12,fontWeight:500,marginBottom:6}}>NUEVA CONTRASEÑA</label>
                <input type="password" value={password} onChange={e=>setPassword(e.target.value)} required minLength={6}
                  style={{width:'100%',padding:'10px 14px',background:'rgba(255,255,255,0.07)',border:'1px solid rgba(255,255,255,0.12)',borderRadius:8,color:'#fff',fontSize:14,outline:'none',boxSizing:'border-box'}}
                  placeholder="Mínimo 6 caracteres"/>
              </div>
            )}
            {error&&<div style={{background:'rgba(239,68,68,0.15)',border:'1px solid rgba(239,68,68,0.3)',borderRadius:8,padding:'10px 14px',color:'#fca5a5',fontSize:13}}>{error}</div>}
            <button type="submit" disabled={loading}
              style={{padding:'12px',background:'#FFD700',border:'none',borderRadius:8,fontWeight:700,fontSize:15,cursor:loading?'not-allowed':'pointer',opacity:loading?.7:1,color:'#111'}}>
              {loading?'Enviando...':(isConfirm?'Guardar contraseña':'Enviar enlace')}
            </button>
          </form>
        )}
        <p style={{textAlign:'center',marginTop:20}}>
          <button onClick={onGoLogin} style={{background:'none',border:'none',color:'rgba(255,255,255,0.4)',cursor:'pointer',fontSize:13,padding:0}}>
            ← Volver al login
          </button>
        </p>
      </div>
    </div>
  );
}

function RegisterScreen({onGoLogin}){
  const [form,setForm]=useState({nombre:'',email:'',password:''});
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [success,setSuccess]=useState(false);

  const handleSubmit = async(e)=>{
    e.preventDefault();
    setLoading(true); setError('');
    try{
      const r = await fetch('/api/auth-register',{
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify(form)
      });
      const d = await r.json();
      if(!r.ok) throw new Error(d.error);
      setSuccess(true);
    } catch(err){ setError(err.message); }
    finally{ setLoading(false); }
  };

  return(
    <div style={{minHeight:'100vh',background:'#0d0d0d',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'system-ui,sans-serif'}}>
      <div style={{width:'100%',maxWidth:400,padding:24}}>
        <div style={{textAlign:'center',marginBottom:32}}>
          <img src={process.env.PUBLIC_URL+"/logo.png"} alt="Beemo" style={{width:64,height:64,objectFit:"contain",marginBottom:8}}/>
          <h1 style={{color:'#FFD700',fontSize:24,fontWeight:700,margin:0}}>Solicitar acceso</h1>
          <p style={{color:'rgba(255,255,255,0.4)',fontSize:14,margin:'8px 0 0'}}>Tu solicitud será revisada por el administrador</p>
        </div>
        {success?(
          <div style={{background:'rgba(16,185,129,0.15)',border:'1px solid rgba(16,185,129,0.3)',borderRadius:12,padding:24,textAlign:'center'}}>
            <div style={{fontSize:32,marginBottom:12}}>✅</div>
            <p style={{color:'#6ee7b7',fontWeight:600,margin:'0 0 8px'}}>¡Solicitud enviada!</p>
            <p style={{color:'rgba(255,255,255,0.5)',fontSize:13,margin:'0 0 16px'}}>Te notificaremos a tu email cuando sea aprobada.</p>
            <button onClick={onGoLogin} style={{background:'#FFD700',border:'none',borderRadius:8,padding:'10px 20px',fontWeight:700,cursor:'pointer',color:'#111'}}>
              Volver al login
            </button>
          </div>
        ):(
          <form onSubmit={handleSubmit} style={{display:'flex',flexDirection:'column',gap:16}}>
            {['nombre','email','password'].map(field=>(
              <div key={field}>
                <label style={{display:'block',color:'rgba(255,255,255,0.6)',fontSize:12,fontWeight:500,marginBottom:6}}>
                  {field==='nombre'?'NOMBRE COMPLETO':field==='email'?'EMAIL':'CONTRASEÑA'}
                </label>
                <input
                  type={field==='password'?'password':field==='email'?'email':'text'}
                  value={form[field]} onChange={e=>setForm(f=>({...f,[field]:e.target.value}))} required
                  style={{width:'100%',padding:'10px 14px',background:'rgba(255,255,255,0.07)',border:'1px solid rgba(255,255,255,0.12)',borderRadius:8,color:'#fff',fontSize:14,outline:'none',boxSizing:'border-box'}}
                  placeholder={field==='nombre'?'Tu nombre completo':field==='email'?'tu@smartbeemo.com':'Mínimo 6 caracteres'}/>
              </div>
            ))}
            {error&&<div style={{background:'rgba(239,68,68,0.15)',border:'1px solid rgba(239,68,68,0.3)',borderRadius:8,padding:'10px 14px',color:'#fca5a5',fontSize:13}}>{error}</div>}
            <button type="submit" disabled={loading}
              style={{padding:'12px',background:'#FFD700',border:'none',borderRadius:8,fontWeight:700,fontSize:15,cursor:loading?'not-allowed':'pointer',opacity:loading?.7:1,color:'#111'}}>
              {loading?'Enviando...':'Enviar solicitud'}
            </button>
          </form>
        )}
        {!success&&(
          <p style={{textAlign:'center',marginTop:20,color:'rgba(255,255,255,0.4)',fontSize:13}}>
            ¿Ya tienes acceso?{' '}
            <button onClick={onGoLogin} style={{background:'none',border:'none',color:'#FFD700',cursor:'pointer',fontSize:13,fontWeight:600,padding:0}}>
              Iniciar sesión
            </button>
          </p>
        )}
      </div>
    </div>
  );
}

// ── Usuarios Tab (solo admin) ─────────────────────────────────────────────────
function ChangePasswordForm({email, onClose, forced=false}){
  const [current,setCurrent]=useState('');
  const [nueva,setNueva]=useState('');
  const [confirmar,setConfirmar]=useState('');
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [success,setSuccess]=useState(false);

  const handleSubmit = async(e)=>{
    e.preventDefault();
    if(nueva!==confirmar) return setError('Las contraseñas nuevas no coinciden');
    if(nueva.length<6) return setError('La contraseña debe tener al menos 6 caracteres');
    if(!forced && !current) return setError('Ingresa tu contraseña actual');
    setLoading(true); setError('');
    try{
      // Si no es forzado, verificar contraseña actual
      if(!forced){
        const r1 = await fetch('/api/auth-login',{
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({email, password:current})
        });
        if(!r1.ok) throw new Error('Contraseña actual incorrecta');
      }
      // Guardar nueva contraseña
      const r2 = await fetch('/api/auth-reset?action=set-direct',{
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':`Bearer ${localStorage.getItem('auth_token')}`},
        body: JSON.stringify({email, password:nueva})
      });
      const d2 = await r2.json();
      if(!r2.ok) throw new Error(d2.error);
      setSuccess(true);
      setTimeout(()=>onClose(), 1500);
    } catch(err){ setError(err.message); }
    finally{ setLoading(false); }
  };

  return success?(
    <div style={{textAlign:'center',padding:'16px 0',color:'#6ee7b7',fontSize:14}}>
      ✅ Contraseña actualizada correctamente
    </div>
  ):(
    <form onSubmit={handleSubmit} style={{display:'flex',flexDirection:'column',gap:12}}>
      {!forced&&(
        <div>
          <label style={{display:'block',color:'rgba(255,255,255,0.5)',fontSize:11,fontWeight:500,marginBottom:4}}>CONTRASEÑA ACTUAL</label>
          <input type="password" value={current} onChange={e=>setCurrent(e.target.value)} required={!forced}
            style={{width:'100%',padding:'9px 12px',background:'rgba(255,255,255,0.07)',border:'1px solid rgba(255,255,255,0.12)',borderRadius:7,color:'#fff',fontSize:13,outline:'none',boxSizing:'border-box'}}/>
        </div>
      )}
      {[
        {label:'Nueva contraseña', val:nueva,     set:setNueva},
        {label:'Confirmar nueva',  val:confirmar, set:setConfirmar},
      ].map(({label,val,set})=>(
        <div key={label}>
          <label style={{display:'block',color:'rgba(255,255,255,0.5)',fontSize:11,fontWeight:500,marginBottom:4}}>{label.toUpperCase()}</label>
          <input type="password" value={val} onChange={e=>set(e.target.value)} required
            style={{width:'100%',padding:'9px 12px',background:'rgba(255,255,255,0.07)',border:'1px solid rgba(255,255,255,0.12)',borderRadius:7,color:'#fff',fontSize:13,outline:'none',boxSizing:'border-box'}}/>
        </div>
      ))}
      {error&&<div style={{background:'rgba(239,68,68,0.15)',border:'1px solid rgba(239,68,68,0.3)',borderRadius:7,padding:'8px 12px',color:'#fca5a5',fontSize:12}}>{error}</div>}
      <div style={{display:'flex',gap:8,marginTop:4}}>
        {!forced&&(
          <button type="button" onClick={onClose}
            style={{flex:1,padding:'9px',background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.1)',borderRadius:7,color:'rgba(255,255,255,0.5)',fontSize:13,cursor:'pointer'}}>
            Cancelar
          </button>
        )}
        <button type="submit" disabled={loading}
          style={{flex:1,padding:'9px',background:'#FFD700',border:'none',borderRadius:7,fontWeight:700,fontSize:13,cursor:loading?'not-allowed':'pointer',opacity:loading?.7:1,color:'#111'}}>
          {loading?'Guardando...':'Guardar contraseña'}
        </button>
      </div>
    </form>
  );
}

function UsuariosTab({currentUser}){
  const [users,setUsers]=useState([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [actionLoading,setActionLoading]=useState('');

  const fetchUsers = async()=>{
    setLoading(true);
    try{
      const token = localStorage.getItem('auth_token');
      const r = await fetch('/api/auth-users',{headers:{Authorization:`Bearer ${token}`}});
      const d = await r.json();
      if(!r.ok) throw new Error(d.error);
      setUsers(d.users);
    } catch(err){ setError(err.message); }
    finally{ setLoading(false); }
  };

  useEffect(()=>{ fetchUsers(); },[]);

  const handlePestanas = async(email, pestanas)=>{
    setActionLoading(email+'pestanas');
    try{
      const token = localStorage.getItem('auth_token');
      const r = await fetch('/api/auth-users',{
        method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
        body: JSON.stringify({email, action:'cambiar_pestanas', pestanas})
      });
      const d = await r.json();
      if(!r.ok) throw new Error(d.error);
      await fetchUsers();
    } catch(err){ alert(err.message); }
    finally{ setActionLoading(''); }
  };

  const handleAction = async(email, action, rol=null)=>{
    setActionLoading(email+action);
    try{
      const token = localStorage.getItem('auth_token');
      const r = await fetch('/api/auth-users',{
        method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
        body: JSON.stringify({email,action,rol})
      });
      const d = await r.json();
      if(!r.ok) throw new Error(d.error);
      await fetchUsers();
    } catch(err){ alert(err.message); }
    finally{ setActionLoading(''); }
  };

  const estadoBadge = estado=>{
    const cfg = {
      pendiente:  {bg:'#fef9c3',color:'#854d0e',label:'Pendiente'},
      aprobado:   {bg:'#d1fae5',color:'#065f46',label:'Aprobado'},
      rechazado:  {bg:'#fee2e2',color:'#991b1b',label:'Rechazado'},
      suspendido: {bg:'#f3f4f6',color:'#6b7280',label:'Suspendido'},
    };
    const c = cfg[estado]||cfg.pendiente;
    return <span style={{padding:'2px 10px',borderRadius:12,fontSize:12,fontWeight:600,background:c.bg,color:c.color}}>{c.label}</span>;
  };

  const rolBadge = rol=>{
    const cfg = {
      admin: {bg:'#6366f1',color:'#fff',label:'Admin'},
      viewer:{bg:'#FFD700',color:'#111',label:'Viewer'},
    };
    const c = cfg[rol]||cfg.viewer;
    return <span style={{padding:'2px 10px',borderRadius:12,fontSize:12,fontWeight:600,background:c.bg,color:c.color}}>{c.label}</span>;
  };

  const pendientes = users.filter(u=>u.estado==='pendiente').length;

  return(
    <div style={{padding:'24px 0'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:24,flexWrap:'wrap',gap:12}}>
        <div>
          <h1 style={{fontSize:24,fontWeight:700,margin:0}}>Gestión de Usuarios</h1>
          {pendientes>0&&(
            <div style={{marginTop:6,display:'inline-flex',alignItems:'center',gap:6,background:'#fef9c3',border:'1px solid #fde68a',borderRadius:8,padding:'4px 12px',fontSize:12,color:'#854d0e',fontWeight:600}}>
              ⏳ {pendientes} solicitud{pendientes>1?'es':''} pendiente{pendientes>1?'s':''}
            </div>
          )}
        </div>
        <button onClick={fetchUsers} style={{padding:'8px 16px',background:'var(--gray-bg)',border:'1px solid var(--border)',borderRadius:8,cursor:'pointer',fontSize:13,color:'var(--text)'}}>
          ↻ Actualizar
        </button>
      </div>

      {loading&&<div style={{textAlign:'center',padding:40,color:'var(--text2)'}}>Cargando usuarios...</div>}
      {error&&<div style={{color:'#ef4444',padding:16}}>{error}</div>}

      {!loading&&!error&&(
        <div className="table-wrapper">
          <table className="data-table" style={{width:'100%'}}>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Email</th>
                <th style={{textAlign:'center'}}>Rol</th>
                <th style={{textAlign:'center'}}>Estado</th>
                <th>Fecha registro</th>
                <th style={{textAlign:'center'}}>Acciones</th>
                <th>Pestañas visibles</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u=>(
                <tr key={u.email} style={{background:u.estado==='pendiente'?'rgba(254,249,195,0.3)':''}}>
                  <td style={{fontWeight:600}}>{u.nombre}</td>
                  <td style={{color:'var(--text2)',fontSize:13}}>{u.email}</td>
                  <td style={{textAlign:'center'}}>{rolBadge(u.rol)}</td>
                  <td style={{textAlign:'center'}}>{estadoBadge(u.estado)}</td>
                  <td style={{fontSize:12,color:'var(--text2)'}}>
                    {new Date(u.created_at).toLocaleDateString('es-CO',{year:'numeric',month:'short',day:'numeric'})}
                  </td>
                  <td>
                    {u.email===currentUser.email?(
                      <span style={{fontSize:12,color:'var(--text3)'}}>Tú</span>
                    ):(
                      <div style={{display:'flex',gap:6,justifyContent:'center',flexWrap:'wrap'}}>
                        {u.estado==='pendiente'&&(
                          <>
                            <button onClick={()=>handleAction(u.email,'aprobar')} disabled={!!actionLoading}
                              style={{padding:'4px 10px',background:'#d1fae5',border:'1px solid #a7f3d0',borderRadius:6,fontSize:12,fontWeight:600,color:'#065f46',cursor:'pointer'}}>
                              {actionLoading===u.email+'aprobar'?'...':'✓ Aprobar'}
                            </button>
                            <button onClick={()=>handleAction(u.email,'rechazar')} disabled={!!actionLoading}
                              style={{padding:'4px 10px',background:'#fee2e2',border:'1px solid #fecaca',borderRadius:6,fontSize:12,fontWeight:600,color:'#991b1b',cursor:'pointer'}}>
                              {actionLoading===u.email+'rechazar'?'...':'✕ Rechazar'}
                            </button>
                          </>
                        )}
                        {u.estado==='aprobado'&&(
                          <>
                            <select value={u.rol} onChange={e=>handleAction(u.email,'cambiar_rol',e.target.value)} disabled={!!actionLoading}
                              style={{padding:'4px 8px',borderRadius:6,fontSize:12,border:'1px solid var(--border)',background:'var(--gray-bg)',color:'var(--text)',cursor:'pointer'}}>
                              <option value="viewer">Viewer</option>
                              <option value="admin">Admin</option>
                            </select>
                            <button onClick={()=>{ if(window.confirm(`¿Resetear contraseña de ${u.nombre}? Le llegará una contraseña temporal por email.`)) handleAction(u.email,'reset_password'); }}
                              disabled={!!actionLoading}
                              style={{padding:'4px 10px',background:'#fef9c3',border:'1px solid #fde68a',borderRadius:6,fontSize:12,fontWeight:600,color:'#854d0e',cursor:'pointer'}}>
                              🔑 Reset
                            </button>
                            <button onClick={()=>{ if(window.confirm(`¿Suspender acceso de ${u.nombre}?`)) handleAction(u.email,'suspender'); }}
                              disabled={!!actionLoading}
                              style={{padding:'4px 10px',background:'#f3f4f6',border:'1px solid #d1d5db',borderRadius:6,fontSize:12,fontWeight:600,color:'#6b7280',cursor:'pointer'}}>
                              ⊘ Suspender
                            </button>
                          </>
                        )}
                        {u.estado==='rechazado'&&(
                          <button onClick={()=>handleAction(u.email,'aprobar')} disabled={!!actionLoading}
                            style={{padding:'4px 10px',background:'#d1fae5',border:'1px solid #a7f3d0',borderRadius:6,fontSize:12,fontWeight:600,color:'#065f46',cursor:'pointer'}}>
                            Reactivar
                          </button>
                        )}
                        {u.estado==='suspendido'&&(
                          <button onClick={()=>handleAction(u.email,'reactivar')} disabled={!!actionLoading}
                            style={{padding:'4px 10px',background:'#d1fae5',border:'1px solid #a7f3d0',borderRadius:6,fontSize:12,fontWeight:600,color:'#065f46',cursor:'pointer'}}>
                            ↺ Reactivar
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                  {/* Permisos por pestaña — solo para viewers aprobados */}
                  <td>
                    {u.rol==='admin'?(
                      <span style={{fontSize:11,color:'var(--text3)'}}>Todas</span>
                    ):u.estado==='aprobado'?(
                      <div style={{display:'flex',flexWrap:'wrap',gap:4}}>
                        {['Recurrencia','Upgrades','Salud','Cancelaciones','Churn'].map(tab=>{
                          const activa = (u.pestanas||[]).includes(tab);
                          return(
                            <button key={tab} onClick={()=>{
                              const nuevas = activa
                                ? (u.pestanas||[]).filter(p=>p!==tab)
                                : [...(u.pestanas||[]),tab];
                              handlePestanas(u.email, nuevas);
                            }}
                            style={{padding:'2px 7px',borderRadius:10,fontSize:11,fontWeight:500,cursor:'pointer',border:'none',
                              background:activa?'#6366f1':'var(--gray-bg)',
                              color:activa?'#fff':'var(--text3)'}}>
                              {tab}
                            </button>
                          );
                        })}
                      </div>
                    ):(
                      <span style={{fontSize:11,color:'var(--text3)'}}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Auth wrapper — envuelve App para manejar sesión ──────────────────────────
export default function AppWrapper(){
  const [authScreen, setAuthScreen] = useState('login');
  const [authUser, setAuthUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [resetToken, setResetToken] = useState(null);

  useEffect(()=>{
    // Check for reset token in URL
    const params = new URLSearchParams(window.location.search);
    const token = params.get('reset');
    if(token){ setResetToken(token); setAuthScreen('reset'); }

    const storedToken = localStorage.getItem('auth_token');
    if(!storedToken){ setAuthLoading(false); return; }
    fetch('/api/auth-session', { headers:{ Authorization:`Bearer ${storedToken}` } })
      .then(r=>r.json())
      .then(d=>{ if(d.ok) setAuthUser(d.user); else localStorage.removeItem('auth_token'); })
      .catch(()=>localStorage.removeItem('auth_token'))
      .finally(()=>setAuthLoading(false));
  },[]);

  const handleLogin = (user, token) => {
    localStorage.setItem('auth_token', token);
    setAuthUser(user);
  };
  const handleLogout = () => {
    localStorage.removeItem('auth_token');
    setAuthUser(null);
    setAuthScreen('login');
  };

  if(authLoading) return(
    <div style={{height:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'#0d0d0d'}}>
      <div style={{textAlign:'center'}}>
        <img src={process.env.PUBLIC_URL+"/logo.png"} alt="Beemo" style={{width:48,height:48,objectFit:"contain",marginBottom:12}}/>
        <div style={{color:'#FFD700',fontSize:14,fontWeight:600}}>Cargando...</div>
      </div>
    </div>
  );

  if(!authUser){
    if(authScreen==='register') return <RegisterScreen onGoLogin={()=>setAuthScreen('login')}/>;
    if(authScreen==='reset') return <ResetScreen resetToken={resetToken} onGoLogin={()=>{ setAuthScreen('login'); setResetToken(null); window.history.replaceState({},'','/'); }}/>;
    return <LoginScreen onLogin={handleLogin} onGoRegister={()=>setAuthScreen('register')} onGoReset={()=>setAuthScreen('reset')}/>;
  }

  return <>
    <App authUser={authUser} onLogout={handleLogout}/>
    {/* Modal obligatorio si debe cambiar contraseña */}
    {authUser?.must_change_password&&(
      <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.85)',zIndex:2000,display:'flex',alignItems:'center',justifyContent:'center'}}>
        <div style={{background:'#1a1a1a',border:'1px solid rgba(255,255,255,0.1)',borderRadius:12,padding:28,width:'100%',maxWidth:380,margin:16}}>
          <div style={{textAlign:'center',marginBottom:20}}>
            <div style={{fontSize:32,marginBottom:8}}>🔑</div>
            <h3 style={{color:'#fff',fontSize:16,fontWeight:700,margin:'0 0 6px'}}>Cambia tu contraseña</h3>
            <p style={{color:'rgba(255,255,255,0.4)',fontSize:13,margin:0}}>
              Por seguridad debes crear una contraseña personal antes de continuar.
            </p>
          </div>
          <ChangePasswordForm
            email={authUser.email}
            onClose={()=>setAuthUser(u=>({...u, must_change_password:false}))}
            forced={true}/>
        </div>
      </div>
    )}
  </>;
}

function SyncTab({authUser}){
  const [log,setLog]=useState(null);
  const [loadingStatus,setLoadingStatus]=useState(true);
  const [syncing,setSyncing]=useState(false);
  const [syncError,setSyncError]=useState(null);

  const authHeader=()=>({Authorization:`Bearer ${localStorage.getItem('auth_token')}`});

  const fetchStatus=async()=>{
    setLoadingStatus(true);
    try{
      const r=await fetch('/api/sync',{headers:authHeader()});
      const d=await r.json();
      if(d.ok) setLog(d.log);
    }catch(e){setSyncError(e.message);}
    finally{setLoadingStatus(false);}
  };

  useEffect(()=>{fetchStatus();},[]);

  const handleSync=async()=>{
    setSyncing(true); setSyncError(null);
    try{
      const r=await fetch('/api/sync',{method:'POST',headers:authHeader()});
      const d=await r.json();
      if(d.ok) setLog(d.log);
      else setSyncError(d.error||'Error al sincronizar');
    }catch(e){setSyncError(e.message);}
    finally{setSyncing(false);}
  };

  const LABELS={
    'recurrencia':'Recurrencia','salud':'Salud','salud-cohortes':'Cohortes',
    'cancelaciones':'Cancelaciones','churn':'Churn (+ Tiempo de Vida)','marketing':'Marketing / CAC',
  };

  const fmtTs=iso=>{
    if(!iso) return '—';
    return new Date(iso).toLocaleString('es-CO',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
  };
  const fmtMs=ms=>{
    if(!ms&&ms!==0) return '—';
    return ms<1000?`${ms}ms`:`${(ms/1000).toFixed(1)}s`;
  };

  const statusColor={ok:'#34d399',partial:'#fbbf24',running:'#fbbf24',error:'#f87171'};

  return(
    <div style={{maxWidth:720,padding:'24px 0'}}>
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:24,gap:16}}>
        <div>
          <h2 style={{fontSize:20,fontWeight:700,margin:0,color:'#f1f5f9'}}>Sincronización de datos</h2>
          <p style={{color:'rgba(255,255,255,0.4)',fontSize:13,margin:'4px 0 0'}}>
            Cron automático cada 4 horas · Los datos se sirven desde caché Redis
          </p>
        </div>
        <button onClick={handleSync} disabled={syncing} style={{
          padding:'10px 20px',background:syncing?'rgba(99,102,241,0.4)':'#6366f1',
          border:'none',borderRadius:8,color:'#fff',fontWeight:600,fontSize:14,
          cursor:syncing?'not-allowed':'pointer',display:'flex',alignItems:'center',
          gap:8,minWidth:172,justifyContent:'center',flexShrink:0,
        }}>
          <svg width="14" height="14" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
            style={syncing?{animation:'spin 1s linear infinite'}:{}}
          ><path d="M2 7.5a5.5 5.5 0 0 1 9.5-3.8"/><path d="M13 7.5a5.5 5.5 0 0 1-9.5 3.8"/><path d="M10.5 3l1.5 1-1 1.5"/><path d="M4.5 12l-1.5-1 1-1.5"/></svg>
          {syncing?'Sincronizando…':'Sincronizar ahora'}
        </button>
      </div>

      {syncError&&(
        <div style={{background:'rgba(239,68,68,0.12)',border:'1px solid rgba(239,68,68,0.3)',borderRadius:8,padding:'10px 14px',marginBottom:16,color:'#fca5a5',fontSize:13}}>
          {syncError}
        </div>
      )}

      {log&&(
        <div style={{background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.08)',borderRadius:10,padding:'12px 16px',marginBottom:20,fontSize:13,display:'flex',gap:24,flexWrap:'wrap'}}>
          <span style={{color:'rgba(255,255,255,0.45)'}}>Estado:&nbsp;
            <strong style={{color:statusColor[log.status]||'#94a3b8'}}>
              {log.status==='ok'?'OK':log.status==='running'?'Ejecutando…':'Parcial'}
            </strong>
          </span>
          <span style={{color:'rgba(255,255,255,0.45)'}}>Inicio:&nbsp;<strong style={{color:'#e2e8f0'}}>{fmtTs(log.startedAt)}</strong></span>
          {log.completedAt&&<span style={{color:'rgba(255,255,255,0.45)'}}>Completado:&nbsp;<strong style={{color:'#e2e8f0'}}>{fmtTs(log.completedAt)}</strong></span>}
        </div>
      )}

      {loadingStatus?(
        <div style={{color:'rgba(255,255,255,0.25)',padding:'40px 0',textAlign:'center',fontSize:14}}>Cargando estado…</div>
      ):(
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          {Object.entries(LABELS).map(([key,label])=>{
            const ep=log?.endpoints?.[key];
            const ok=ep?.status==='ok';
            const err=ep?.status==='error';
            return(
              <div key={key} style={{
                display:'flex',alignItems:'center',
                background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.07)',
                borderRadius:8,padding:'12px 16px',gap:12,
              }}>
                <span style={{
                  width:8,height:8,borderRadius:'50%',flexShrink:0,
                  background:!ep?'rgba(255,255,255,0.15)':ok?'#34d399':'#f87171',
                  boxShadow:ok?'0 0 6px #34d399':'none',
                }}/>
                <span style={{flex:1,fontWeight:600,color:'#e2e8f0',fontSize:14}}>{label}</span>
                {ep?(
                  <>
                    <span style={{color:ok?'rgba(255,255,255,0.45)':'#fca5a5',fontSize:12,maxWidth:260,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                      {ok?fmtTs(ep.syncedAt):`Error: ${ep.error}`}
                    </span>
                    <span style={{color:'rgba(255,255,255,0.3)',fontSize:12,minWidth:48,textAlign:'right'}}>{fmtMs(ep.ms)}</span>
                  </>
                ):(
                  <span style={{color:'rgba(255,255,255,0.2)',fontSize:12}}>Sin sincronizar</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function App({authUser, onLogout}){
  const [raw,setRaw]=useState([]);
  const [clientesList,setClientesList]=useState([]);
  const [lastUpdate,setLastUpdate]=useState(null);
  const [showChangePassword,setShowChangePassword]=useState(false);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState(null);
  const [activeTab,setActiveTab]=useState('Recurrencia');
  const [cancelaciones,setCancelaciones]=useState(null);
  const [churn,setChurn]=useState(null);
  const [churnLoading,setChurnLoading]=useState(false);
  const [churnError,setChurnError]=useState(null);
  const [cancelLoading,setCancelLoading]=useState(false);
  const [cancelError,setCancelError]=useState(null);
  const [saludError,setSaludError]=useState(null);
  const [saludPais,setSaludPais]=useState([]);
  const [saludTipoPago,setSaludTipoPago]=useState('Todos');
  const [saludRango,setSaludRango]=useState({from:'',to:''});
  // Cada sección carga independiente
  const [saludRetencion,setSaludRetencion]=useState(null);
  const [saludTicket,setSaludTicket]=useState(null);
  const [saludEstados,setSaludEstados]=useState(null);
  const [saludFlujo,setSaludFlujo]=useState(null);
  const [saludCohortes,setSaludCohortes]=useState(null);
  const [marketingCac,setMarketingCac]=useState(null);
  const [marketingLoading,setMarketingLoading]=useState(false);
  const [saludLoadingMap,setSaludLoadingMap]=useState({retencion:false,ticket:false,estados:false,flujo:false,cohortes:false});
  // salud agregado para compatibilidad con SaludTab
  const salud = useMemo(()=>({
    retencion: saludRetencion||[],
    ticket:    saludTicket||[],
    estados:   saludEstados||[],
    flujo:     saludFlujo||[],
    cohortes:  saludCohortes||[],
  }),[saludRetencion,saludTicket,saludEstados,saludFlujo,saludCohortes]);
  const [granularidad,setGranularidad]=useState('mes');
  // Badge dinámico de retención para el sidebar
  const saludBadge = useMemo(()=>{
    if(!saludRetencion||saludRetencion.length===0) return null;
    const agg={};
    saludRetencion.forEach(r=>{
      if(!agg[r.mes])agg[r.mes]={clientes:0,retenidos:0};
      agg[r.mes].clientes  += +r.clientes;
      agg[r.mes].retenidos += +r.retenidos;
    });
    const meses=Object.keys(agg).sort();
    if(!meses.length) return null;
    const ultimo=agg[meses[meses.length-1]];
    const tasa=ultimo.clientes>0?Math.round(ultimo.retenidos/ultimo.clientes*100):0;
    return tasa+'%';
  },[saludRetencion]);
  const NAV_BADGES = {'Upgrades':'18.6%','Salud':saludBadge,'Cancelaciones':'50%','Churn':'8.5%'};
  const [dateField,setDateField]=useState('fecha_pago');
  const [filtroPais,setFiltroPais]=useState([]);
  const [filtroTipoVenta,setFiltroTipoVenta]=useState([]);
  const [filtroEstado,setFiltroEstado]=useState([]);
  const [filtroTipoPago,setFiltroTipoPago]=useState([]);
  const [filtroTipoIngreso,setFiltroTipoIngreso]=useState('Todos');
  const [filtroFechaDesde,setFiltroFechaDesde]=useState('');
  const [filtroFechaHasta,setFiltroFechaHasta]=useState('');
  const [filtroPagoDesde,setFiltroPagoDesde]=useState('');
  const [filtroPagoHasta,setFiltroPagoHasta]=useState('');
  const [filtroCierreDesde,setFiltroCierreDesde]=useState('');
  const [filtroCierreHasta,setFiltroCierreHasta]=useState('');
  const [selectedMesRec,setSelectedMesRec]=useState(null);
  const [selectedTipoUpgrade,setSelectedTipoUpgrade]=useState(null);
  const [selectedMesUpgrade,setSelectedMesUpgrade]=useState(null);

  const saludFetchStarted = useRef(false);

  useEffect(()=>{setSelectedMesRec(null);setSelectedTipoUpgrade(null);setSelectedMesUpgrade(null);},[activeTab]);

  useEffect(()=>{
    if(activeTab!=='Salud') return;
    if(saludRetencion!==null) return; // ya cargado
    if(saludLoadingMap.retencion) return; // ya en progreso
    saludFetchStarted.current = true;
    setSaludError(null);

    // Fetch principal — retención, ticket, estados, flujo (rápido)
    setSaludLoadingMap(m=>({...m,retencion:true,ticket:true,estados:true,flujo:true}));
    fetch('/api/salud')
      .then(r=>r.json())
      .then(data=>{
        if(data.error) throw new Error(data.error);
        setSaludRetencion(data.retencion||[]);
        setSaludTicket(data.ticket||[]);
        setSaludEstados(data.estados||[]);
        setSaludFlujo(data.flujo||[]);
      })
      .catch(e=>setSaludError(e.message))
      .finally(()=>setSaludLoadingMap(m=>({...m,retencion:false,ticket:false,estados:false,flujo:false})));

    // Cohortes — endpoint separado, carga independiente
    setSaludLoadingMap(m=>({...m,cohortes:true}));
    fetch('/api/salud-cohortes')
      .then(r=>r.json())
      .then(data=>{
        if(data.error) throw new Error('Cohortes: '+data.error);
        setSaludCohortes(data.cohortes||[]);
      })
      .catch(e=>{ setSaludCohortes([]); console.error('Cohortes error:', e.message); })
      .finally(()=>setSaludLoadingMap(m=>({...m,cohortes:false})));

    // Marketing CAC — endpoint separado, no bloquea nada
    setMarketingLoading(true);
    fetch('/api/marketing')
      .then(r=>r.json())
      .then(data=>{ if(!data.error) setMarketingCac(data.cac||[]); })
      .catch(()=>{})
      .finally(()=>setMarketingLoading(false));

  },[activeTab, saludRetencion, saludLoadingMap.retencion]);

  useEffect(()=>{
    if(activeTab==='Churn' && !churn && !churnLoading && !churnError){
      setChurnLoading(true);
      // Fetch principal rápido (5 queries en paralelo)
      fetch('/api/churn').then(r=>r.json()).then(({nuevos,cancelaciones,tasaChurn,tiempoVida,motivos,churnPais,error})=>{
        if(error) throw new Error(error);
        setChurn({nuevos,cancelaciones,tasaChurn,tiempoVida:tiempoVida||[],motivos,churnPais});
      }).catch(e=>setChurnError(e.message)).finally(()=>setChurnLoading(false));
    }
    if(activeTab==='Cancelaciones' && !cancelaciones && !cancelLoading){
      setCancelLoading(true);
      fetch('/api/cancelaciones').then(r=>r.json()).then(({data,nuevos,error})=>{
        if(error)throw new Error(error);
        setCancelaciones({data:data||[], nuevos:nuevos||[]});
      }).catch(e=>setCancelError(e.message)).finally(()=>setCancelLoading(false));
    }

  },[activeTab,cancelaciones,churn]);

  useEffect(()=>{
    fetch(API_URL).then(r=>r.json()).then(({data,clientes,error})=>{
      if(error)throw new Error(error);
      setRaw(data||[]);
      setClientesList(clientes||[]);
      setLastUpdate(new Date());
    }).catch(e=>setError(e.message)).finally(()=>setLoading(false));
  },[]);

  const paises=useMemo(()=>['Todos',...new Set(raw.map(r=>r.pais_agrupado).filter(Boolean))].sort(),[raw]);
  const tiposVenta=useMemo(()=>['Todos',...new Set(raw.map(r=>r.tipo_venta).filter(Boolean))].sort(),[raw]);
  const estados=useMemo(()=>['Todos',...new Set(raw.map(r=>r.estado).filter(Boolean))].sort(),[raw]);
  const tiposPago=useMemo(()=>['Todos',...new Set(raw.map(r=>r.tipo_pago).filter(Boolean))].sort(),[raw]);

  const hayFiltros=filtroPais.length>0||filtroTipoVenta.length>0||filtroEstado.length>0||filtroTipoPago.length>0||filtroTipoIngreso!=='Todos'||filtroFechaDesde||filtroFechaHasta||filtroPagoDesde||filtroPagoHasta;
  const limpiar=()=>{setFiltroPais([]);setFiltroTipoVenta([]);setFiltroEstado([]);setFiltroTipoPago([]);setFiltroTipoIngreso('Todos');setFiltroFechaDesde('');setFiltroFechaHasta('');setFiltroPagoDesde('');setFiltroPagoHasta('');setFiltroCierreDesde('');setFiltroCierreHasta('');};

  const data=useMemo(()=>raw.filter(r=>{
    // Base: solo mostrar desde enero 2025
    if(r.mes && r.mes < '2025-01') return false;
    const mesComoFecha=r.mes?r.mes+'-01':'';
    return(
      (filtroPais.length===0||filtroPais.includes(r.pais_agrupado))&&
      (filtroTipoVenta.length===0||filtroTipoVenta.includes(r.tipo_venta))&&
      (filtroEstado.length===0||filtroEstado.includes(r.estado))&&
      (filtroTipoPago.length===0||(filtroTipoPago.includes('Recurrencia')&&(r.tipo_pago==='Contado'||r.tipo_pago==='Recurrencia'))||(filtroTipoPago.includes('Cuotas')&&r.tipo_pago==='Cuotas'))&&
      (!filtroFechaDesde||mesComoFecha>=filtroFechaDesde)&&(!filtroFechaHasta||mesComoFecha<=filtroFechaHasta)&&
      (!filtroPagoDesde||mesComoFecha>=filtroPagoDesde)&&(!filtroPagoHasta||mesComoFecha<=filtroPagoHasta)&&
      (filtroTipoIngreso==='Todos'||r.tipo_ingreso===filtroTipoIngreso)
    );
  }),[raw,filtroPais,filtroTipoVenta,filtroEstado,filtroTipoPago,filtroTipoIngreso,filtroFechaDesde,filtroFechaHasta,filtroPagoDesde,filtroPagoHasta]);

  const dataRec=useMemo(()=>{
    if(!selectedMesRec)return data;
    return data.filter(r=>getGranKey(r.mes+'-01',granularidad)===selectedMesRec);
  },[data,selectedMesRec,granularidad]);

  const dataUpg=useMemo(()=>{
    if(!selectedMesUpgrade)return data;
    return data.filter(r=>getGranKey(r.mes+'-01',granularidad)===selectedMesUpgrade);
  },[data,selectedMesUpgrade,granularidad]);

  // ── KPIs generales ──
  const kpis=useMemo(()=>{
    const totalFacturado=dataRec.reduce((s,r)=>s+(+r.total_amount_usd||0),0);
    const totalCobrado=dataRec.reduce((s,r)=>s+(+r.payment_amount_usd||0),0);
    const clientes=dataRec.reduce((s,r)=>s+(+r.clientes||0),0);
    const aov=clientes>0?totalCobrado/clientes:0;
    const tasaCobro=totalFacturado>0?(totalCobrado/totalFacturado)*100:0;
    const openBalance=dataRec.reduce((s,r)=>s+(+r.open_balance||0),0);
    const mesActualKpi=new Date().toISOString().slice(0,7);
    const mesAnteriorKpi=new Date(new Date().getFullYear(),new Date().getMonth()-1,1).toISOString().slice(0,7);
    const porMes={};
    dataRec.forEach(r=>{
      const m=r.mes;
      if(!m||m>=mesActualKpi)return;
      if(r.proceso_clasificado==='Recurrencia'||r.proceso_clasificado==='Cobranza'){
        porMes[m]=(porMes[m]||0)+(+r.payment_amount_usd||0);
      }
    });
    const meses=Object.keys(porMes).sort();
    const mrr=porMes[mesAnteriorKpi]||(meses.length>0?porMes[meses[meses.length-1]]:0);
    const mrrMesRef=meses.indexOf(mesAnteriorKpi)>0?meses[meses.indexOf(mesAnteriorKpi)-1]:meses[meses.length-2];
    const mrrAnt=mrrMesRef?porMes[mrrMesRef]:0;
    const mrrCambio=mrrAnt>0?((mrr-mrrAnt)/mrrAnt)*100:0;
    return{totalFacturado,totalCobrado,clientes,aov,tasaCobro,openBalance,mrr,mrrCambio,porMes,meses};
  },[dataRec]);

  // ── Insights: 4 factores que frenan la recurrencia ──
  const insights=useMemo(()=>{
    const ticketMes={};
    const hoy=new Date();
    const mesActual=hoy.toISOString().slice(0,7);
    data.forEach(r=>{
      const m=r.mes;
      if(!m||m>=mesActual||m<'2024-05')return;
      if(r.proceso_clasificado==='Recurrencia'||r.proceso_clasificado==='Cobranza'){
        if(!ticketMes[m])ticketMes[m]={cobrado:0,clientes:0};
        ticketMes[m].cobrado+=(+r.payment_amount_usd||0);
        ticketMes[m].clientes+=(+r.clientes||0);
      }
    });
    const mesesTicket=Object.keys(ticketMes).sort();
    const ticketInicio=mesesTicket.length>0&&ticketMes[mesesTicket[0]].clientes>0?ticketMes[mesesTicket[0]].cobrado/ticketMes[mesesTicket[0]].clientes:0;
    const ticketActual=mesesTicket.length>0&&ticketMes[mesesTicket[mesesTicket.length-1]].clientes>0?ticketMes[mesesTicket[mesesTicket.length-1]].cobrado/ticketMes[mesesTicket[mesesTicket.length-1]].clientes:0;
    const ticketCambio=ticketInicio>0?((ticketActual-ticketInicio)/ticketInicio)*100:0;
    const recMes={};
    data.forEach(r=>{
      const m=r.mes;
      if(!m)return;
      if(r.proceso_clasificado==='Recurrencia'||r.proceso_clasificado==='Cobranza'){
        recMes[m]=(recMes[m]||0)+(+r.clientes||0);
      }
    });
    const mesesRec=Object.keys(recMes).sort();
    let mesesNegativo=0;
    for(let i=1;i<mesesRec.length;i++){
      if(recMes[mesesRec[i]]<recMes[mesesRec[i-1]])mesesNegativo++;
    }
    const totalFac=data.filter(r=>r.proceso_clasificado==='Recurrencia'||r.proceso_clasificado==='Cobranza');
    const totalFacturas=totalFac.reduce((s,r)=>s+(+r.facturas||0),0);
    const noPagadas=totalFac.filter(r=>r.estado&&r.estado!=='Pagada');
    const noPagadasFacturas=noPagadas.reduce((s,r)=>s+(+r.facturas||0),0);
    const pctNoCobrado=totalFacturas>0?noPagadasFacturas/totalFacturas*100:0;
    const montoNoCobrado=noPagadas.reduce((s,r)=>s+(+r.total_amount_usd||0),0);
    const hace3=mesesRec.length>=4?mesesRec[mesesRec.length-4]:mesesRec[0];
    const retPais={};
    data.filter(r=>(r.proceso_clasificado==='Recurrencia'||r.proceso_clasificado==='Cobranza')&&r.mes).forEach(r=>{
      const m=r.mes;
      if(m<hace3)return;
      const p=r.pais_agrupado||'Otro';
      if(!retPais[p])retPais[p]={};
      retPais[p][m]=(retPais[p][m]||0)+(+r.clientes||0);
    });
    const retencionesPais={};
    Object.entries(retPais).forEach(([pais,d])=>{
      const mm=Object.keys(d).sort();
      const rets=[];
      for(let i=0;i<mm.length-1;i++){
        const ant=d[mm[i]];const act=d[mm[i+1]];
        if(ant>10)rets.push(Math.min(act/ant*100,100));
      }
      if(rets.length>0)retencionesPais[pais]=rets.reduce((s,v)=>s+v,0)/rets.length;
    });
    const paisesOrdenados=Object.entries(retencionesPais).filter(([p])=>p&&p!=='Sin dato').sort((a,b)=>b[1]-a[1]);
    return{
      ticketActual:Math.round(ticketActual),
      ticketInicio:Math.round(ticketInicio),
      ticketCambio,
      mesesNegativo,
      totalMeses:Math.max(mesesRec.length-1,1),
      pctNoCobrado,
      montoNoCobrado:Math.round(montoNoCobrado),
      mejorPais:paisesOrdenados[0]||null,
      peorPais:paisesOrdenados[paisesOrdenados.length-1]||null,
    };
  },[data]);

  // ── Datos por proceso con granularidad ──
  const monthlyData=useMemo(()=>{
    const agg={};
    const hoyCap = new Date().toISOString().slice(0,7);
    data.forEach(r=>{
      const key=getGranKey(r.mes+'-01',granularidad);
      if(!key||key.slice(0,7)>hoyCap)return;
      if(!agg[key])agg[key]={mes:key,total:0,Recurrencia:0,'Up-Selling':0,'Bootcamp & Cross':0,Cobranza:0,Comeback:0,'Cuotas Mentorías':0,Adquisicion:0,upgrades:0,upgrades_clientes:0};
      const cobrado=+r.payment_amount_usd||0;
      agg[key].total+=cobrado;
      const proc=r.proceso_clasificado||'Otro';
      if(agg[key][proc]!==undefined)agg[key][proc]+=cobrado;
      if(r.es_upgrade==='1'||r.es_upgrade===1){agg[key].upgrades+=cobrado;agg[key].upgrades_clientes+=(+r.clientes||0);}
    });
    return Object.values(agg).sort((a,b)=>a.mes.localeCompare(b.mes)).map(d=>({...d,Recurrencia:Math.round(d.Recurrencia),'Up-Selling':Math.round(d['Up-Selling']),'Bootcamp & Cross':Math.round(d['Bootcamp & Cross']),Cobranza:Math.round(d.Cobranza),Comeback:Math.round(d.Comeback),upgrades:Math.round(d.upgrades),total:Math.round(d.total)}));
  },[data,granularidad]);

  // ── Semáforo: mes anterior cerrado + mes actual en curso ──
  const semaforo=useMemo(()=>{
    const hoy=new Date();
    const mesActual=hoy.toISOString().slice(0,7);
    const mesAnterior=new Date(hoy.getFullYear(),hoy.getMonth()-1,1).toISOString().slice(0,7);

    const pagoMes={};
    data.forEach(r=>{
      const m=r.mes;
      if(!m||m>mesActual||m<'2024-05')return;
      if(!pagoMes[m])pagoMes[m]={mes:m,total:0,Recurrencia:0,upgrades:0,upgrades_clientes:0,clientes:0};
      const cobrado=+r.payment_amount_usd||0;
      pagoMes[m].total+=cobrado;
      pagoMes[m].clientes+=(+r.clientes||0);
      if(r.proceso_clasificado==='Recurrencia'||r.proceso_clasificado==='Cobranza')pagoMes[m].Recurrencia+=cobrado;
      if(r.es_upgrade==='1'||r.es_upgrade===1){pagoMes[m].upgrades+=cobrado;pagoMes[m].upgrades_clientes+=(+r.clientes||0);}
    });

    if(!Object.keys(pagoMes).length)return null;

    const mesAntData=pagoMes[mesAnterior]||null;
    const mesActData=pagoMes[mesActual]||null;
    const diasMesActual=hoy.getDate();
    const diasMesAnterior=new Date(hoy.getFullYear(),hoy.getMonth()+1,0).getDate();
    const pctMesActual=diasMesActual/diasMesAnterior;
    const proyeccion=mesActData&&pctMesActual>0?Math.round(mesActData.Recurrencia/pctMesActual):0;
    const proyeccionTotal=mesActData&&pctMesActual>0?Math.round(mesActData.total/pctMesActual):0;
    const cambioVsAnterior=mesAntData&&mesAntData.Recurrencia>0&&mesActData?
      ((mesActData.Recurrencia-mesAntData.Recurrencia)/mesAntData.Recurrencia)*100:0;

    return{
      mesAnterior,mesActual,diasMesActual,diasMesAnterior,
      pctMesActual:Math.round(pctMesActual*100),
      antRecurrencia:mesAntData?Math.round(mesAntData.Recurrencia):0,
      antTotal:mesAntData?Math.round(mesAntData.total):0,
      antUpRev:mesAntData?Math.round(mesAntData.upgrades):0,
      antUpClientes:mesAntData?mesAntData.upgrades_clientes:0,
      antClientes:mesAntData?mesAntData.clientes:0,
      actRecurrencia:mesActData?Math.round(mesActData.Recurrencia):0,
      actTotal:mesActData?Math.round(mesActData.total):0,
      actUpRev:mesActData?Math.round(mesActData.upgrades):0,
      actUpClientes:mesActData?mesActData.upgrades_clientes:0,
      actClientes:mesActData?mesActData.clientes:0,
      proyeccion,proyeccionTotal,cambioVsAnterior,
    };
  },[data]);

  // ── Upgrades ──
  const upgradeData=useMemo(()=>{
    const byTipo={};
    dataUpg.filter(r=>r.es_upgrade==='1'||r.es_upgrade===1).forEach(r=>{
      const k=r.tipo_venta||'Otro';
      if(!byTipo[k])byTipo[k]={name:k,cobrado:0,clientes:0,facturas:0};
      byTipo[k].cobrado+=(+r.payment_amount_usd||0);
      byTipo[k].clientes+=(+r.clientes||0);
      byTipo[k].facturas+=(+r.facturas||1);
    });
    return Object.values(byTipo).map(d=>({...d,cobrado:Math.round(d.cobrado)})).sort((a,b)=>b.cobrado-a.cobrado);
  },[dataUpg]);

  // ── Upgrades por mes ──
  const upgradeMes=useMemo(()=>{
    if(!selectedTipoUpgrade)
      return monthlyData.map(d=>({mes:d.mes,total:d.upgrades,clientes:d.upgrades_clientes}));
    const hoyCap=new Date().toISOString().slice(0,7);
    const agg={};
    data.filter(r=>(r.es_upgrade==='1'||r.es_upgrade===1)&&(r.tipo_venta||'Otro')===selectedTipoUpgrade).forEach(r=>{
      const key=getGranKey(r.mes+'-01',granularidad);
      if(!key||key.slice(0,7)>hoyCap)return;
      if(!agg[key])agg[key]={mes:key,total:0,clientes:0};
      agg[key].total+=(+r.payment_amount_usd||0);
      agg[key].clientes+=(+r.clientes||0);
    });
    const base=monthlyData.map(d=>({mes:d.mes,total:0,clientes:0}));
    return base.map(d=>agg[d.mes]?{...agg[d.mes],total:Math.round(agg[d.mes].total)}:d);
  },[data,monthlyData,selectedTipoUpgrade,granularidad]);

  // ── Upgrade metrics (dinámico según filtros) ──
  const upgradeMetrics=useMemo(()=>{
    const upgRecs=dataUpg.filter(r=>(r.es_upgrade==='1'||r.es_upgrade===1)&&(!selectedTipoUpgrade||(r.tipo_venta||'Otro')===selectedTipoUpgrade));
    const totalRevUpg=upgRecs.reduce((s,r)=>s+(+r.payment_amount_usd||0),0);
    // Use clientesList for unique client counts
    const filtPais=filtroPais.length>0?filtroPais:null;
    const listFilt=filtPais?clientesList.filter(c=>filtPais.includes(c.pais_agrupado)):clientesList;
    const upgClientesList=listFilt.filter(c=>c.tiene_upgrade==='1'||c.tiene_upgrade===1);
    const upgClientes=upgClientesList.length;
    const totalClientes=listFilt.length;
    const tasa=totalClientes>0?(upgClientes/totalClientes*100):0;
    const revDespues=upgClientes>0?totalRevUpg/upgClientes:0;
    // Timing: use fecha_cierre_min vs first upgrade month as proxy
    const acqDate={};
    clientesList.forEach(c=>{ if(c.fecha_cierre_min)acqDate[c.student_id]=c.fecha_cierre_min; });
    const RANGOS=['0-1 mes','1-3 meses','3-6 meses','6-12 meses','+12 meses'];
    const counts=Object.fromEntries(RANGOS.map(r=>[r,0]));
    let total=0,totalDays=0;
    upgRecs.forEach(r=>{
      const pagoProxy=r.mes?r.mes+'-15':null;
      // approximate: count clientes per row, split evenly across timing buckets isn't possible
      // just use 1 data point per aggregated row as a proxy
      const acq=null; // no per-student match possible without student_id in agg rows
      void acq; void pagoProxy;
    });
    // Fall back to clientesList timing
    upgClientesList.forEach(c=>{
      const acq=c.fecha_cierre_min;
      if(!acq)return;
      // Use first upgrade as proxy — we don't have exact date, approximate with a fixed offset
      total++;totalDays+=180; // not meaningful without exact data
    });
    const tiempoProm=0;
    const pct01=0;
    const timingDist=RANGOS.map(rango=>({rango,n:0,pct:0}));
    return{upgClientes,totalClientes,tasa,totalRevUpg:Math.round(totalRevUpg),revAntes:0,revDespues,incremento:0,tiempoProm,pct01,timingDist};
  },[dataUpg,selectedTipoUpgrade,clientesList,filtroPais]);

  // ── Estado pago pie ──
  const estadoPagoData=useMemo(()=>{
    const ESTADO_NORM={
      'no pagada':'No Pagada','no_pagada':'No Pagada',
      'en mora':'En Mora','en_mora':'En Mora',
      'pagada':'Pagada',
      'reembolsada':'Reembolsada',
      'anulada':'Anulada',
      'perdida':'Perdida',
      'verificación de pago':'Verificación de Pago',
      'verificacion de pago':'Verificación de Pago',
    };
    const agg={};
    dataRec.forEach(r=>{
      const rawEstado=(r.estado||'Desconocido').trim();
      const k=ESTADO_NORM[rawEstado.toLowerCase()]||rawEstado;
      agg[k]=(agg[k]||0)+(+r.facturas||1);
    });
    return Object.entries(agg).map(([name,value])=>({name,value})).sort((a,b)=>b.value-a.value);
  },[dataRec]);

  // ── AOV por país ──
  const aovPaisData=useMemo(()=>{
    const agg={};
    dataRec.forEach(r=>{
      const k=r.pais_agrupado||'Otros';
      if(!agg[k])agg[k]={cobrado:0,clientes:0};
      agg[k].cobrado+=(+r.payment_amount_usd||0);
      agg[k].clientes+=(+r.clientes||0);
    });
    return Object.entries(agg)
      .map(([pais,v])=>({
        pais,
        aov:v.clientes>0?Math.round(v.cobrado/v.clientes):0,
        revenue:Math.round(v.cobrado),
        clientes:v.clientes,
      }))
      .sort((a,b)=>b.revenue-a.revenue)
      .slice(0,8);
  },[dataRec]);

  // ── Top clientes ──
  const topClientes=useMemo(()=>{
    let list=clientesList;
    if(filtroPais.length>0)list=list.filter(c=>filtroPais.includes(c.pais_agrupado));
    return list.slice(0,10).map(c=>({
      student_id:c.student_id,
      pais:c.pais_agrupado,
      tipo_suscripcion:c.tipo_suscripcion,
      cobrado:+c.cobrado||0,
      facturas:+c.facturas||0,
      primera_fecha:c.fecha_cierre_min||null,
      tipo_pago:c.tipo_pago,
    }));
  },[clientesList,filtroPais]);

  const informe=useMemo(()=>{
    const topPais=aovPaisData[0]?.pais||'—';
    const topUpgrade=upgradeData[0]?.name||'—';
    const brechaCobro=kpis.totalFacturado-kpis.totalCobrado;
    const pctOpen=kpis.totalFacturado>0?(kpis.openBalance/kpis.totalFacturado*100):0;
    const estadoTop=(estadoPagoData[0]?.name)||'—';
    return{topPais,topUpgrade,brechaCobro,pctOpen,estadoTop};
  },[kpis,aovPaisData,upgradeData,estadoPagoData]);

  if(loading)return<div className="loading-screen"><div className="loading-spinner"/><p>Cargando datos desde Redshift...</p></div>;
  if(error)return<div className="error-screen"><h2>Error de conexión</h2><p>{error}</p><p className="error-hint">Verifica las variables de entorno en Vercel.</p></div>;

  return(
    <div className="app">
      <div className="app-layout">

        {/* ── SIDEBAR ── */}
        <aside className="sidebar">
          <div className="sidebar-head">
            <div className="sidebar-logo-row">
              <div className="sidebar-logo-box">
                <img src={process.env.PUBLIC_URL+"/logo.png"} alt="SmartBeemo"
                  style={{width:'100%',height:'100%',objectFit:'cover',borderRadius:10}}
                  onError={e=>{e.target.parentElement.style.background='#FFD700';e.target.style.display='none'}}/>
              </div>
              <div>
                <div className="sidebar-brand">Beemo</div>
                <div className="sidebar-brand-sub">Dashboard</div>
              </div>
            </div>
            <div className="sidebar-stats">
              <div className="sidebar-stat">
                <div className="sidebar-stat-label">MRR {semaforo?semaforo.mesAnterior:''}</div>
                <div className="sidebar-stat-val">{semaforo?fmtUSD(semaforo.antRecurrencia):'—'}</div>
              </div>
              <div className="sidebar-stat">
                <div className="sidebar-stat-label">Rec. {semaforo?semaforo.mesActual:''}</div>
                <div className="sidebar-stat-val">{semaforo?fmtUSD(semaforo.actRecurrencia):'—'}</div>
              </div>
            </div>
          </div>
          <NavTab
            tabs={[
              ...(authUser?.rol==='admin'
                ? ['Recurrencia','Upgrades','Salud','Cancelaciones','Churn','Usuarios']
                : (authUser?.pestanas || ['Recurrencia','Upgrades','Salud','Cancelaciones','Churn'])),
              ...(authUser?.superAdmin ? ['Sincronización'] : []),
            ]}
            active={activeTab} onChange={setActiveTab} badges={NAV_BADGES}/>
          <div className="sidebar-footer">
            {lastUpdate
              ? <>Actualizado · {lastUpdate.toLocaleString('es-CO',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</>
              : 'Sin datos aún'}
          </div>
          {/* User info + logout */}
          <div style={{padding:'12px 16px',borderTop:'1px solid rgba(255,255,255,0.08)',marginTop:'auto'}}>
            <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:8}}>
              <div style={{width:32,height:32,borderRadius:'50%',background:'#FFD700',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,fontSize:13,color:'#111',flexShrink:0}}>
                {authUser?.nombre?.charAt(0).toUpperCase()}
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:12,fontWeight:600,color:'#fff',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{authUser?.nombre}</div>
                <div style={{fontSize:10,color:'rgba(255,255,255,0.5)'}}>{authUser?.rol==='admin'?'Admin':'Viewer'}</div>
              </div>
              <button onClick={onLogout} title="Cerrar sesión" style={{background:'none',border:'none',cursor:'pointer',color:'rgba(255,255,255,0.4)',fontSize:16,padding:4,lineHeight:1,flexShrink:0}}>⏻</button>
            </div>
            <button onClick={()=>setShowChangePassword(true)}
              style={{width:'100%',padding:'6px 0',background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.1)',borderRadius:6,color:'rgba(255,255,255,0.5)',fontSize:11,cursor:'pointer',fontWeight:500}}>
              🔑 Cambiar contraseña
            </button>
          </div>

          {/* Modal cambiar contraseña */}
          {showChangePassword&&(
            <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center'}}
              onClick={e=>{ if(e.target===e.currentTarget) setShowChangePassword(false); }}>
              <div style={{background:'#1a1a1a',border:'1px solid rgba(255,255,255,0.1)',borderRadius:12,padding:24,width:'100%',maxWidth:380,margin:16}}>
                <h3 style={{color:'#fff',fontSize:16,fontWeight:700,margin:'0 0 16px'}}>Cambiar contraseña</h3>
                <ChangePasswordForm email={authUser?.email} onClose={()=>setShowChangePassword(false)}/>
              </div>
            </div>
          )}
        </aside>

        {/* ── MAIN ── */}
        <div className="main-area">

          {/* Topbar con filtros — solo Recurrencia y Upgrades */}
          {(activeTab==='Recurrencia'||activeTab==='Upgrades')&&(
          <div className="topbar">
            <span className="topbar-label"><strong>Filtros:</strong></span>
            <FilterSelect label="País" value={filtroPais} options={paises} onChange={setFiltroPais} multi={true}/>
            <FilterSelect label="Tipo de venta" value={filtroTipoVenta} options={tiposVenta} onChange={setFiltroTipoVenta} multi={true}/>
            <FilterSelect label="Estado" value={filtroEstado} options={estados} onChange={setFiltroEstado} multi={true}/>
            <FilterSelect label="Tipo de pago" value={filtroTipoPago} options={tiposPago} onChange={setFiltroTipoPago} multi={true}/>
            <FilterSelect label="Tipo ingreso" value={filtroTipoIngreso} onChange={setFiltroTipoIngreso} options={['Todos','Invoice','Factura']}/>
            <DateRangePicker titulo="Vencimiento" desde={filtroFechaDesde} hasta={filtroFechaHasta} onChange={(d,h)=>{setFiltroFechaDesde(d);setFiltroFechaHasta(h);}}/>
            <DateRangePicker titulo="Fecha pago" desde={filtroPagoDesde} hasta={filtroPagoHasta} onChange={(d,h)=>{setFiltroPagoDesde(d);setFiltroPagoHasta(h);}}/>
            <DateRangePicker titulo="Fecha cierre" desde={filtroCierreDesde} hasta={filtroCierreHasta} onChange={(d,h)=>{setFiltroCierreDesde(d);setFiltroCierreHasta(h);}}/>
            {hayFiltros&&<button className="btn-reset-top" onClick={limpiar}>✕</button>}
          </div>
          )}
          {activeTab==='Salud'&&(
          <div className="topbar">
            <strong className="topbar-label">Filtros:</strong>
            <FilterSelect label="País" value={saludPais} options={['Colombia','México','Estados Unidos','Otros']} onChange={setSaludPais} multi={true}/>
            <FilterSelect label="Tipo de pago" value={saludTipoPago} options={['Todos','Cuotas','Recurrencia']} onChange={setSaludTipoPago}/>
            <MonthRangePicker value={saludRango} onChange={setSaludRango}/>
            {(saludPais.length>0||saludTipoPago!=='Todos'||saludRango.from||saludRango.to)&&(
              <button className="btn-reset-top" onClick={()=>{setSaludPais([]);setSaludTipoPago('Todos');setSaludRango({from:'',to:''});}}>✕</button>
            )}
          </div>
          )}

          {/* Page header */}
          <div className="page-header">
            <h1 className="page-title">{activeTab}</h1>
            <p className="page-sub">
              {activeTab==='Recurrencia'&&<>{fmt(data.length)} facturas recurrentes · Pagos de factura #2 en adelante</>}
              {activeTab==='Upgrades'&&<>Clientes con cambio de plan o pago anticipado</>}
              {activeTab==='Salud'&&<>Retención, cohortes y LTV · Datos desde 2023</>}
              {activeTab==='Cancelaciones'&&<>Suscripciones canceladas en Zuora</>}
              {activeTab==='Churn'&&<>Tasa de cancelación mensual sobre base activa</>}
              {activeTab==='Usuarios'&&<>{fmt(data.length)} facturas en base de datos</>}
              {activeTab==='Sincronización'&&<>Cron cada 4 horas · Caché Redis de 5 horas</>}
              {(filtroFechaDesde||filtroFechaHasta)&&<span className="periodo-tag"> · 📅 {filtroFechaDesde||'…'} → {filtroFechaHasta||'…'}</span>}
              {(filtroPagoDesde||filtroPagoHasta)&&<span className="periodo-tag"> · 💳 {filtroPagoDesde||'…'} → {filtroPagoHasta||'…'}</span>}
            </p>
          </div>

          <div className="tab-content">

        {/* ── TAB: RECURRENCIA ── */}
        {activeTab==='Recurrencia'&&(
          <>
            {/* Semáforo del mes */}
            {semaforo&&(
              <div className="semaforo-banner">
                <div className="semaforo-doble">

                  {/* Mes anterior — cerrado */}
                  <div className="semaforo-bloque">
                    <span className="semaforo-label">Mes anterior — cerrado ({semaforo.mesAnterior})</span>
                    <div className="semaforo-row">
                      <div className="semaforo-stat">
                        <span className="semaforo-stat-label">Recurrencia real</span>
                        <span className="semaforo-stat-value">{fmtUSD(semaforo.antRecurrencia)}</span>
                      </div>
                      <div className="semaforo-stat">
                        <span className="semaforo-stat-label">Revenue total</span>
                        <span className="semaforo-stat-value">{fmtUSD(semaforo.antTotal)}</span>
                      </div>
                      <div className="semaforo-stat">
                        <span className="semaforo-stat-label">Clientes activos</span>
                        <span className="semaforo-stat-value">{fmt(semaforo.antClientes)}</span>
                      </div>
                      <div className="semaforo-stat">
                        <span className="semaforo-stat-label">Revenue upgrades</span>
                        <span className="semaforo-stat-value">{fmtUSD(semaforo.antUpRev)}</span>
                      </div>
                      <div className="semaforo-stat">
                        <span className="semaforo-stat-label">Clientes con upgrade</span>
                        <span className="semaforo-stat-value">{fmt(semaforo.antUpClientes)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="semaforo-divider"/>

                  {/* Mes actual — en curso */}
                  <div className="semaforo-bloque">
                    <span className="semaforo-label">
                      Mes actual — en curso ({semaforo.mesActual}) · día {semaforo.diasMesActual}/{semaforo.diasMesAnterior} · {semaforo.pctMesActual}% completado
                    </span>
                    <div className="semaforo-grid">
                      <div className="semaforo-stat">
                        <span className="semaforo-stat-label">Recurrencia real</span>
                        <span className="semaforo-stat-value">{fmtUSD(semaforo.actRecurrencia)}</span>
                        <span className="semaforo-stat-sub">Proy: {fmtUSD(semaforo.proyeccion)}</span>
                      </div>
                      <div className="semaforo-stat">
                        <span className="semaforo-stat-label">Revenue total</span>
                        <span className="semaforo-stat-value">{fmtUSD(semaforo.actTotal)}</span>
                        <span className="semaforo-stat-sub">Proy: {fmtUSD(semaforo.proyeccionTotal)}</span>
                      </div>
                      <div className="semaforo-stat">
                        <span className="semaforo-stat-label">Clientes activos</span>
                        <span className="semaforo-stat-value">{fmt(semaforo.actClientes)}</span>
                      </div>
                      <div className="semaforo-stat">
                        <span className="semaforo-stat-label">vs mismo día mes ant.</span>
                        <span className={`semaforo-stat-value ${semaforo.cambioVsAnterior>=0?'pos':'neg'}`}>
                          {semaforo.cambioVsAnterior>=0?'▲':'▼'} {fmtPct(Math.abs(semaforo.cambioVsAnterior))}
                        </span>
                      </div>
                      <div className="semaforo-stat">
                        <span className="semaforo-stat-label">Revenue upgrades</span>
                        <span className="semaforo-stat-value">{fmtUSD(semaforo.actUpRev)}</span>
                      </div>
                      <div className="semaforo-stat">
                        <span className="semaforo-stat-label">Clientes upgrade</span>
                        <span className="semaforo-stat-value">{fmt(semaforo.actUpClientes)}</span>
                      </div>
                    </div>
                  </div>

                </div>
              </div>
            )}


            {/* Insights ejecutivos */}
            <div className="exec-insights">
              <div className="exec-insight-block">
                <div className="exec-insight-icon">📊</div>
                <div>
                  <div className="exec-insight-titulo">Volumen de operación</div>
                  <p>Se analizaron <strong>{fmt(data.length)}</strong> facturas de <strong>{fmt(kpis.clientes)}</strong> clientes únicos. Total facturado <strong>{fmtUSD(kpis.totalFacturado)}</strong>, con cobro efectivo de <strong>{fmtUSD(kpis.totalCobrado)}</strong> — tasa de cobro del <strong>{fmtPct(kpis.tasaCobro)}</strong>.</p>
                </div>
              </div>
              <div className="exec-insight-block">
                <div className="exec-insight-icon">💰</div>
                <div>
                  <div className="exec-insight-titulo">Comportamiento de ingresos</div>
                  <p>El MRR del último mes cerrado es <strong>{fmtUSD(kpis.mrr)}</strong>, con variación de <strong>{kpis.mrrCambio>=0?'+':''}{fmtPct(kpis.mrrCambio)}</strong> frente al mes anterior. Ticket promedio: <strong>{fmtUSD(kpis.aov)}</strong>. Open balance acumulado: <strong>{fmtUSD(kpis.openBalance)}</strong>.</p>
                </div>
              </div>
              <div className="exec-insight-block">
                <div className="exec-insight-icon">⚠️</div>
                <div>
                  <div className="exec-insight-titulo">Alertas de cartera</div>
                  <p>La brecha entre facturado y cobrado es <strong>{fmtUSD(informe.brechaCobro)}</strong>. El estado más frecuente es <strong>{informe.estadoTop}</strong>. Activar recuperación temprana en facturas vencidas puede mejorar la tasa de cobro del <strong>{fmtPct(kpis.tasaCobro)}</strong>.</p>
                </div>
              </div>
            </div>
            {/* Insight cards expandibles */}
            <InsightCards insights={insights} data={data}/>

            <div className="kpi-grid">
              <KPICard label={`MRR — ${new Date(new Date().getFullYear(),new Date().getMonth()-1,1).toISOString().slice(0,7)}`} value={fmtUSD(kpis.mrr)} sub={kpis.mrrCambio>=0?`▲ ${fmtPct(kpis.mrrCambio)} vs anterior`:`▼ ${fmtPct(Math.abs(kpis.mrrCambio))} vs anterior`} color="#6366f1" tooltip="MRR (Monthly Recurring Revenue): ingresos del último mes completo de facturas 2+ pagadas (Recurrencia + Cobranza). Excluye el mes actual porque está incompleto. El % compara contra el mes inmediatamente anterior."/>
              <KPICard label="Total facturado" value={fmtUSD(kpis.totalFacturado)} sub="Monto total emitido" color="#10b981"/>
              <KPICard label="Total cobrado" value={fmtUSD(kpis.totalCobrado)} sub="Pagos efectivamente recibidos" color="#10b981"/>
              <KPICard label="Tasa de cobro" value={fmtPct(kpis.tasaCobro)} sub="cobrado / facturado" color={kpis.tasaCobro>=80?'#10b981':'#ef4444'} tooltip="% del monto facturado efectivamente cobrado. Saludable por encima del 80%."/>
              <KPICard label="Clientes únicos" value={fmt(kpis.clientes)} sub="Con al menos 1 factura" color="#6366f1"/>
              <KPICard label="Ticket promedio" value={fmtUSD(kpis.aov)} sub="cobrado por cliente" color="#f59e0b" tooltip="Promedio cobrado por cliente en el período."/>
              <KPICard label="Open balance" value={fmtUSD(kpis.openBalance)} sub={`${fmtPct(informe.pctOpen)} del total facturado`} color="#ef4444"/>
            </div>

            <section className="chart-section">
              <div className="chart-section-header">
                <SectionTitle>Revenue por proceso</SectionTitle>
                <div className="chart-header-controls">
                  {selectedMesRec&&<button className="cross-filter-chip" onClick={()=>setSelectedMesRec(null)}>{selectedMesRec} ×</button>}
                  <DateFieldSelector value={dateField} onChange={setDateField}/>
                  <GranSelector value={granularidad} onChange={setGranularidad}/>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={monthlyData} margin={{top:10,right:20,left:20,bottom:0}} style={{cursor:'pointer'}}
                  onClick={(e)=>{if(e&&e.activeLabel)setSelectedMesRec(p=>p===e.activeLabel?null:e.activeLabel)}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb"/>
                  <XAxis dataKey="mes" tick={{fontSize:11}}/>
                  <YAxis tickFormatter={v=>'$'+(v/1000).toFixed(0)+'k'} tick={{fontSize:11}}/>
                  <Tooltip formatter={v=>fmtUSD(v)}/>
                  <Legend/>
                  {Object.entries(PROC_COLORS).map(([proc,color])=>(
                    <Bar key={proc} dataKey={proc} stackId="a" fill={color} name={proc}>
                      {monthlyData.map((entry,i)=><Cell key={i} fill={color} fillOpacity={!selectedMesRec||entry.mes===selectedMesRec?1:0.25}/>)}
                    </Bar>
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </section>

            <div className="chart-row">
              <section className="chart-section half">
                <SectionTitle>Revenue por tipo de pago — últimos 6 meses</SectionTitle>
                {(()=>{
                  const hoy=new Date();
                  const meses6=[];
                  for(let i=5;i>=0;i--){
                    const d=new Date(hoy.getFullYear(),hoy.getMonth()-i-1,1);
                    meses6.push(d.toISOString().slice(0,7));
                  }
                  const agg={};
                  meses6.forEach(m=>{ agg[m]={mes:m.slice(5),'Rec-Recurrencia':0,'Rec-Cobranza':0,'Cuotas-Recurrencia':0,'Cuotas-Cobranza':0}; });
                  data.forEach(r=>{
                    const m=r.mes||null;
                    if(!m||!agg[m])return;
                    const proc=r.proceso_clasificado||'';
                    const tp=r.tipo_pago==='Cuotas'?'Cuotas':'Rec';
                    if(proc==='Recurrencia') agg[m][tp+'-Recurrencia']+=(+r.payment_amount_usd||0);
                    else if(proc==='Cobranza') agg[m][tp+'-Cobranza']+=(+r.payment_amount_usd||0);
                  });
                  const chartData=meses6.map(m=>({
                    mes:agg[m].mes,
                    'Rec. Recurrencia':Math.round(agg[m]['Rec-Recurrencia']),
                    'Rec. Cobranza':Math.round(agg[m]['Rec-Cobranza']),
                    'Cuotas Recurrencia':Math.round(agg[m]['Cuotas-Recurrencia']),
                    'Cuotas Cobranza':Math.round(agg[m]['Cuotas-Cobranza']),
                  }));
                  return(
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={chartData} margin={{left:10,right:10,top:5,bottom:5}}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb"/>
                        <XAxis dataKey="mes" tick={{fontSize:11}}/>
                        <YAxis tickFormatter={v=>'$'+(v/1000).toFixed(0)+'k'} tick={{fontSize:11}}/>
                        <Tooltip formatter={(v,n)=>['$'+Math.round(v).toLocaleString('es-CO'),n]}/>
                        <Legend iconSize={10} wrapperStyle={{fontSize:11}}/>
                        <Bar dataKey="Rec. Recurrencia" stackId="rec" fill="#FFD700" radius={[0,0,0,0]}/>
                        <Bar dataKey="Rec. Cobranza" stackId="rec" fill="#111111" radius={[3,3,0,0]}/>
                        <Bar dataKey="Cuotas Recurrencia" stackId="cuotas" fill="#FEF08A" radius={[0,0,0,0]}/>
                        <Bar dataKey="Cuotas Cobranza" stackId="cuotas" fill="#555555" radius={[3,3,0,0]}/>
                      </BarChart>
                    </ResponsiveContainer>
                  );
                })()}
              </section>
              <section className="chart-section half">
                <div className="section-title-row">
                  <SectionTitle>Revenue y ticket promedio por país</SectionTitle>
                  {selectedMesRec&&<span className="cross-filter-chip" style={{pointerEvents:'none'}}>{selectedMesRec}</span>}
                </div>
                <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart data={aovPaisData} margin={{left:10,right:30}}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb"/>
                    <XAxis dataKey="pais" tick={{fontSize:11}}/>
                    <YAxis yAxisId="left" tickFormatter={v=>'$'+(v/1000).toFixed(0)+'k'} tick={{fontSize:11}}/>
                    <YAxis yAxisId="right" orientation="right" tickFormatter={v=>'$'+v} tick={{fontSize:11}}/>
                    <Tooltip formatter={(v,n)=>fmtUSD(v)}/>
                    <Legend/>
                    <Bar yAxisId="left" dataKey="revenue" name="Revenue total" fill="#6366f1" radius={[4,4,0,0]} cursor="pointer"
                      onClick={(d)=>setFiltroPais(p=>p.includes(d.pais)?p.filter(x=>x!==d.pais):[...p,d.pais])}>
                      {aovPaisData.map((entry,i)=><Cell key={i} fill="#6366f1" fillOpacity={filtroPais.length===0||filtroPais.includes(entry.pais)?1:0.25}/>)}
                    </Bar>
                    <Line yAxisId="right" type="monotone" dataKey="aov" stroke="#10b981" strokeWidth={2.5} dot={{r:5}} name="Ticket promedio"/>
                  </ComposedChart>
                </ResponsiveContainer>
              </section>
            </div>

            <section className="chart-section">
              <SectionTitle>Top 10 clientes por revenue</SectionTitle>
              <div className="table-wrapper">
                <table className="data-table">
                  <thead><tr><th>#</th><th>Student ID</th><th>País</th><th>Suscripción</th><th>Facturas</th><th>Primera fecha cierre</th><th>Ticket promedio</th><th>Total cobrado</th></tr></thead>
                  <tbody>
                    {topClientes.map((c,i)=>(
                      <tr key={c.student_id}>
                        <td>{i+1}</td><td className="mono">{c.student_id}</td><td>{c.pais||'—'}</td><td>{c.tipo_suscripcion||'—'}</td><td>{fmt(c.facturas)}</td><td>{c.primera_fecha||'—'}</td><td>{c.facturas>0?fmtUSD(c.cobrado/c.facturas):'—'}</td><td className="amount">{fmtUSD(c.cobrado)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {/* ── TAB: UPGRADES ── */}
        {activeTab==='Upgrades'&&(
          <>
            <div className="kpi-grid">
              <KPICard label="Tasa de upgrade" value={upgradeMetrics.tasa.toFixed(1)+'%'} sub="del total de clientes únicos" color="#6366f1" tooltip={`Del total de ${fmt(upgradeMetrics.totalClientes)} clientes únicos, el ${upgradeMetrics.tasa.toFixed(1)}% hizo al menos un upgrade.`}/>
              <KPICard label="Tiempo promedio al upgrade" value={upgradeMetrics.tiempoProm+' días'} sub="desde la adquisición" color="#10b981" tooltip={`${upgradeMetrics.pct01}% de los upgrades ocurren en el primer mes después de la adquisición.`}/>
              <KPICard label="Revenue antes del upgrade" value={'$'+Math.round(upgradeMetrics.revAntes)} sub="ticket promedio (sin upgrade)" color="#f59e0b"/>
              <KPICard label="Revenue después del upgrade" value={'$'+Math.round(upgradeMetrics.revDespues)} sub="ticket promedio (upgrade)" color="#10b981"/>
              <KPICard label="Incremento de revenue" value={(upgradeMetrics.incremento>=0?'+':'')+upgradeMetrics.incremento.toFixed(1)+'%'} sub="en ticket al hacer upgrade" color="#10b981" tooltip="Diferencia entre el ticket promedio de facturas de upgrade vs facturas regulares."/>
              <KPICard label="Clientes con upgrade" value={fmt(upgradeMetrics.upgClientes)} sub="clientes únicos" color="#6366f1"/>
              <KPICard label="Revenue total upgrades" value={fmtUSD(upgradeMetrics.totalRevUpg||0)} sub="acumulado" color="#8b5cf6"/>
            </div>

            <div className="insight-banner">
              <div className="insight-icon">💡</div>
              <div>
                <strong>Insight clave:</strong> El {upgradeMetrics.pct01}% de los upgrades ocurren en el primer mes después de la adquisición. Esto indica que el upgrade no es una decisión posterior al uso del producto — se vende casi en simultáneo. Hay una oportunidad importante en meses 1-6 donde aún hay {(100-upgradeMetrics.pct01).toFixed(1)}% de upgrades tardíos que podrían potenciarse con estrategias de activación.
              </div>
            </div>

            <div className="chart-row">
              <section className="chart-section half">
                <div className="section-title-row">
                  <SectionTitle>Revenue de upgrades por tipo</SectionTitle>
                  {selectedMesUpgrade&&<button className="cross-filter-chip" onClick={()=>setSelectedMesUpgrade(null)}>{selectedMesUpgrade} ×</button>}
                </div>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={upgradeData} layout="vertical" margin={{left:20,right:20}} style={{cursor:'pointer'}}
                    onClick={(e)=>{if(e?.activePayload?.[0])setSelectedTipoUpgrade(p=>p===e.activePayload[0].payload.name?null:e.activePayload[0].payload.name)}}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb"/>
                    <XAxis type="number" tickFormatter={v=>'$'+(v/1000).toFixed(0)+'k'} tick={{fontSize:11}}/>
                    <YAxis type="category" dataKey="name" tick={{fontSize:11}} width={130}/>
                    <Tooltip formatter={v=>fmtUSD(v)}/>
                    <Bar dataKey="cobrado" name="Revenue" radius={[0,4,4,0]}>
                      {upgradeData.map((d,i)=><Cell key={i} fill={COLORS[i%COLORS.length]} fillOpacity={!selectedTipoUpgrade||d.name===selectedTipoUpgrade?1:0.25}/>)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </section>
              <section className="chart-section half">
                <SectionTitle>Tiempo hasta el upgrade</SectionTitle>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={upgradeMetrics.timingDist} margin={{left:10,right:20}}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb"/>
                    <XAxis dataKey="rango" tick={{fontSize:11}}/>
                    <YAxis tickFormatter={v=>v+'%'} tick={{fontSize:11}}/>
                    <Tooltip formatter={v=>v+'%'}/>
                    <Bar dataKey="pct" name="% clientes" fill="#6366f1" radius={[4,4,0,0]}/>
                  </BarChart>
                </ResponsiveContainer>
              </section>
            </div>

            <section className="chart-section">
              <div className="section-title-row">
                <SectionTitle>Upgrades mensuales — revenue y clientes</SectionTitle>
                {selectedTipoUpgrade&&<button className="cross-filter-chip" style={{background:'#8b5cf622',color:'#8b5cf6'}} onClick={()=>setSelectedTipoUpgrade(null)}>{selectedTipoUpgrade} ×</button>}
              </div>
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={upgradeMes} margin={{top:10,right:20,left:20,bottom:0}} style={{cursor:'pointer'}}
                  onClick={(e)=>{if(e&&e.activeLabel)setSelectedMesUpgrade(p=>p===e.activeLabel?null:e.activeLabel)}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb"/>
                  <XAxis dataKey="mes" tick={{fontSize:11}}/>
                  <YAxis yAxisId="left" tickFormatter={v=>'$'+(v/1000).toFixed(0)+'k'} tick={{fontSize:11}}/>
                  <YAxis yAxisId="right" orientation="right" tick={{fontSize:11}}/>
                  <Tooltip formatter={(v,n)=>n==='Clientes con upgrade'?fmt(v):fmtUSD(v)}/>
                  <Legend/>
                  <Bar yAxisId="left" dataKey="total" fill="#6366f1" name="Revenue upgrade" radius={[4,4,0,0]}>
                    {upgradeMes.map((entry,i)=><Cell key={i} fill="#6366f1" fillOpacity={!selectedMesUpgrade||entry.mes===selectedMesUpgrade?1:0.25}/>)}
                  </Bar>
                  <Line yAxisId="right" type="monotone" dataKey="clientes" stroke="#ef4444" strokeWidth={2} dot={{r:3}} name="Clientes con upgrade"/>
                </ComposedChart>
              </ResponsiveContainer>
            </section>

            <section className="chart-section">
              <SectionTitle>Detalle de upgrades por tipo</SectionTitle>
              <div className="table-wrapper">
                <table className="data-table">
                  <thead><tr><th>Tipo de venta</th><th>Facturas</th><th>Clientes únicos</th><th>Revenue cobrado</th><th>Revenue por cliente</th></tr></thead>
                  <tbody>
                    {(selectedTipoUpgrade?upgradeData.filter(d=>d.name===selectedTipoUpgrade):upgradeData).map(d=>(
                      <tr key={d.name}>
                        <td><span className="badge" style={{background:COLORS[upgradeData.indexOf(d)%COLORS.length]+'22',color:COLORS[upgradeData.indexOf(d)%COLORS.length]}}>{d.name}</span></td>
                        <td>{fmt(d.facturas)}</td>
                        <td>{fmt(d.clientes)}</td>
                        <td className="amount">{fmtUSD(d.cobrado)}</td>
                        <td className="amount">{fmtUSD(Math.round(d.cobrado/d.clientes))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {/* ── TAB: SALUD ── */}
        {activeTab==='Salud'&&(
          <>
            {saludError&&(
              <div className="error-screen">
                <h2>Error al cargar Salud</h2>
                <p>{saludError}</p>
                <button className="drp-btn-apply" style={{marginTop:12}} onClick={()=>{
                  setSaludError(null);
                  setSaludRetencion(null);setSaludTicket(null);
                  setSaludEstados(null);setSaludFlujo(null);setSaludCohortes(null);
                  saludFetchStarted.current=false;
                }}>Reintentar</button>
              </div>
            )}
            {/* Spinner inicial — antes de que llegue cualquier dato */}
            {!saludError&&saludRetencion===null&&(
              <div className="loading-screen">
                <div className="loading-spinner"/>
                <p>Calculando salud de recurrencia...</p>
              </div>
            )}
            {/* Contenido — aparece en cuanto llega el primer dato */}
            {!saludError&&saludRetencion!==null&&(
              <>
                <div className="exec-insights">
                  <div className="exec-insight-block">
                    <div className="exec-insight-icon">🌎</div>
                    <div>
                      <div className="exec-insight-titulo">Distribución geográfica</div>
                      <p>El país con mayor ticket promedio es <strong>{informe.topPais}</strong>. La segmentación por mercado identifica diferencias en comportamiento de pago y propensión al upgrade entre regiones, guiando la priorización de esfuerzos comerciales y de retención.</p>
                    </div>
                  </div>
                </div>
                <SaludTab
                  data={salud}
                  pais={saludPais}
                  tipoPago={saludTipoPago}
                  rango={saludRango}
                  loadingMap={saludLoadingMap}
                  marketingCac={marketingCac||[]}
                  marketingLoading={marketingLoading}/>
              </>
            )}
          </>
        )}

        {/* ── TAB: CANCELACIONES ── */}
        {activeTab==='Cancelaciones'&&(
          <>
            {cancelLoading&&<div className="loading-screen"><div className="loading-spinner"/><p>Cargando análisis de cancelaciones...</p></div>}
            {cancelError&&<div className="error-screen"><h2>Error</h2><p>{cancelError}</p></div>}
            {cancelaciones&&<CancelacionesTab data={cancelaciones.data} nuevos={cancelaciones.nuevos}/>}
          </>
        )}

        {/* ── TAB: CHURN ── */}
        {activeTab==='Churn'&&(
          <>
            {churnLoading&&<div className="loading-screen"><div className="loading-spinner"/><p>Calculando análisis de churn...</p></div>}
            {churnError&&<div className="error-screen"><h2>Error</h2><p>{churnError}</p><button className="drp-btn-apply" style={{marginTop:12}} onClick={()=>{setChurnError(null);setChurn(null);}}>Reintentar</button></div>}
            {churn&&(
              <>
                <div className="insight-banner" style={{background:'#f0f9ff',borderColor:'#bae6fd',color:'#0369a1'}}>
                  <div className="insight-icon" style={{fontSize:16}}>ℹ️</div>
                  <div style={{fontSize:12}}>Los filtros de <strong>tipo de venta</strong>, <strong>estado</strong> y <strong>tipo de pago</strong> no aplican en esta pestaña — un cliente entra una sola vez (adquisición o comeback) y luego se mueve entre procesos. Solo aplican filtros de <strong>país</strong> y <strong>fecha</strong>.</div>
                </div>
                <ChurnTab data={churn}/>
              </>
            )}
          </>
        )}

        {/* ── TAB: USUARIOS (solo admin) ── */}
        {activeTab==='Usuarios'&&authUser?.rol==='admin'&&(
          <UsuariosTab currentUser={authUser}/>
        )}

        {/* ── TAB: SINCRONIZACIÓN (solo super admin) ── */}
        {activeTab==='Sincronización'&&authUser?.superAdmin&&(
          <SyncTab authUser={authUser}/>
        )}

          </div>{/* tab-content */}
        </div>{/* main-area */}
      </div>{/* app-layout */}
      <footer className="footer">
        Datos desde Redshift · {lastUpdate
          ? <>Última actualización: {lastUpdate.toLocaleString('es-CO',{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</>
          : new Date().toLocaleDateString('es-CO',{year:'numeric',month:'long',day:'numeric'})}
      </footer>
    </div>
  );
}