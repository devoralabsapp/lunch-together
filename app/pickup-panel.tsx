'use client';
import {useI18n} from '../components/i18n-provider';
import {useCallback,useEffect,useRef,useState} from 'react';
import {AlertCircle,CheckCheck,Dices,History,LoaderCircle,RefreshCw,ShieldCheck,Users} from 'lucide-react';
import type {MealClient} from '../lib/meal-client';
import {friendlyFirebaseError} from '../lib/firebase-client';
import {localNow} from '../lib/meal-client-model';
import {drawPickup,readPickup} from '../lib/pickup-client';
import {MAX_PICKUP_PEOPLE,pickupDateOffset,pickupPriority,type PickupPerson,type PickupSelection,type PickupState} from '../lib/pickup';

const shortDate=(s:string)=>s.slice(8)+'/'+s.slice(5,7);
const colors=['#31775d','#e4ac54','#498d76','#e8c58a','#215e4a','#c58a40','#699e86','#c5dbc9'];
function point(angle:number,r=165){const a=angle*Math.PI/180;return [180+Math.cos(a)*r,180+Math.sin(a)*r];}
function Wheel({people,rotation,duration}:{people:PickupPerson[];rotation:number;duration:number}){
 const {t}=useI18n();
 const angle=360/Math.max(people.length,1);
 return <div className="pickup-wheel" aria-label={people.length?t("Vòng quay {0} người ngang lượt ưu tiên", {"0": people.length}):t("Chưa có người tham gia")} role="img"><span className="pickup-pointer"/><svg viewBox="0 0 360 360" aria-hidden="true" style={{transform:`rotate(${rotation}deg)`,transition:duration?`transform ${duration}ms cubic-bezier(.12,.68,.12,1)`:'none'}}><circle cx="180" cy="180" r="177" fill="#f5eddb"/>{people.length?people.map((p,i)=>{const start=-90+i*angle,end=start+angle,a=point(start),b=point(end),mid=start+angle/2;return <g key={p.key}>{people.length===1?<circle cx="180" cy="180" r="165" fill={colors[0]}/>:<path d={`M180 180 L${a[0]} ${a[1]} A165 165 0 ${angle>180?1:0} 1 ${b[0]} ${b[1]} Z`} fill={colors[i%colors.length]} stroke="#fffaf0" strokeWidth="1.5"/>}{people.length<=24?<text x="312" y="180" textAnchor="end" dominantBaseline="middle" transform={`rotate(${mid} 180 180)`} fill={i%colors.length===1||i%colors.length===3||i%colors.length===7?'#3b503e':'#fff'} fontSize={`calc(${people.length>16?9:people.length>10?11:13}px + var(--text-size-offset,1px))`} fontWeight="600">{p.name.length>16?p.name.slice(0,15)+'…':p.name}</text>:null}</g>;}):<circle cx="180" cy="180" r="165" fill="#e5eee6"/>}<circle cx="180" cy="180" r="38" fill="#fffaf0" stroke="#e7d9bb" strokeWidth="5"/></svg><span className="pickup-wheel-center"><Dices size={30}/></span></div>;
}
function pause(ms:number,signal:AbortSignal){return new Promise<boolean>(resolve=>{if(signal.aborted){resolve(false);return;}const finish=(value:boolean)=>{clearTimeout(timer);signal.removeEventListener('abort',abort);resolve(value);},abort=()=>finish(false),timer=setTimeout(()=>finish(true),ms);signal.addEventListener('abort',abort,{once:true});});}
function pickupError(error:unknown){return (error as {code?:string})?.code==='permission-denied'?'Chưa được cấp quyền đọc hoặc lưu lịch sử lấy cơm. Người quản lý cần Publish bản Firestore Rules mới.':friendlyFirebaseError(error);}

export default function PickupPanel({client,dayId,userId,admin,refreshKey=0,onDrawSaved}:{client:MealClient;dayId:string;userId:string;admin:boolean;refreshKey?:number;onDrawSaved:()=>void}){
 const {t}=useI18n();
 const [snapshot,setSnapshot]=useState<PickupState|null>(null),[loading,setLoading]=useState(true),[spinning,setSpinning]=useState(false),[count,setCount]=useState(2),[error,setError]=useState(''),[notice,setNotice]=useState(''),[stage,setStage]=useState<{people:PickupPerson[];rotation:number;duration:number}|null>(null),[revealed,setRevealed]=useState<PickupSelection[]>([]),[turn,setTurn]=useState(0);
 const request=useRef(0),animation=useRef<AbortController|null>(null),inFlight=useRef(false);
 const load=useCallback(async()=>{const seq=++request.current;setLoading(true);try{const data=await readPickup(client,dayId);if(seq===request.current){setSnapshot(data);if(data.draw)setCount(data.draw.count);setError('');}}catch(e){if(seq===request.current){setSnapshot(null);setError(pickupError(e));}}finally{if(seq===request.current)setLoading(false);}},[client,dayId]);
 useEffect(()=>{if(!inFlight.current)void load();return()=>{request.current++;};},[load,refreshKey,userId]);
 useEffect(()=>()=>{animation.current?.abort();},[]);
 async function spin(){
  if(inFlight.current||!snapshot||snapshot.draw||!admin)return;inFlight.current=true;const abort=new AbortController();animation.current=abort;setSpinning(true);setError('');setNotice('');setRevealed([]);
  try{
   const result=await drawPickup(client,dayId,count);if(abort.signal.aborted)return;onDrawSaved();
   if(result.created){
    let remaining=[...result.candidates];const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches,duration=reduced?0:result.draw.count>5?700:2200;
    for(const [i,person] of result.draw.selected.entries()){
     if(abort.signal.aborted)return;setTurn(i+1);const tier=pickupPriority(remaining),index=tier.findIndex(p=>p.key===person.key);
     if(index<0)throw new Error('Kết quả đã lưu. Vui lòng cập nhật để xem lại danh sách.');
     setStage({people:tier,rotation:0,duration:0});if(!await pause(reduced?0:80,abort.signal))return;
     setStage({people:tier,rotation:1800+360-(index+.5)*360/tier.length,duration});if(!await pause(duration+80,abort.signal))return;
     setRevealed(prev=>[...prev,person]);remaining=remaining.filter(p=>p.key!==person.key);if(!await pause(reduced?0:350,abort.signal))return;
    }
    setNotice('Đã lưu kết quả lấy cơm hôm nay. Cảm ơn mọi người!');
   }else setNotice('Hôm nay đã có kết quả chung. Đã tải lại kết quả được lưu trước đó.');
   await load();
  }catch(e){if(!abort.signal.aborted){await load();setError(pickupError(e));}}
  finally{inFlight.current=false;if(!abort.signal.aborted){setSpinning(false);setTurn(0);}}
 }
 const today=localNow().date,candidates=snapshot?.candidates||[],draw=snapshot?.draw,priority=pickupPriority(candidates),wheelPeople=stage?.people||(draw?draw.selected:priority),max=Math.min(MAX_PICKUP_PEOPLE,candidates.length),validCount=Number.isInteger(count)&&count>=1&&count<=max;
 return <section className="pickup-panel" aria-label={t("Chọn người lấy cơm")} aria-busy={loading||spinning}>
  <div className="pickup-toolbar"><div><strong>{snapshot?t("Tuần {0} – {1}", {"0": shortDate(snapshot.weekStart),"1": shortDate(pickupDateOffset(snapshot.weekEnd,-1))}):t("Lịch sử lấy cơm trong tuần")}</strong><p>{t("Tuần tính từ thứ Hai, theo giờ Việt Nam.")}</p></div><button className="outline-btn" onClick={()=>void load()} disabled={loading||spinning}><RefreshCw size={16} className={loading?'spin':''}/>{t("Cập nhật")}</button></div>
  {error?<div className="error-banner" role="alert"><AlertCircle size={19}/><span>{t(error)}</span></div>:null}
  {notice?<div className="pickup-notice" role="status"><CheckCheck size={19}/>{t(notice)}</div>:null}
  {loading?<div className="statistics-loading" role="status"><LoaderCircle size={20} className="spin"/>{t("Đang đọc danh sách đặt cơm và số lượt trong tuần…")}</div>:null}
  {snapshot?<>
   <div className="pickup-layout"><article className="pickup-wheel-card"><div className="pickup-card-heading"><span className="pickup-tag"><Dices size={15}/>{t("VÒNG QUAY MAY MẮN")}</span><h2>{t("Ai mang bữa trưa lên nào?")}</h2><p>{t("Ít lượt đi trước · Ngang lượt quay ngẫu nhiên")}</p></div><Wheel people={wheelPeople} rotation={stage?.rotation??(draw?360-180/draw.count:0)} duration={stage?.duration||0}/><div className="pickup-stage-caption" aria-live="polite">{spinning?turn?t("Đang mở người thứ {0}/{1}…", {"0": turn,"1": count}):t("Đang chốt danh sách và lưu kết quả…"):draw?t("Kết quả đã được lưu, không quay lại trong ngày."):priority.length?t("{0} người có {1} lượt đang được ưu tiên", {"0": priority.length,"1": priority[0].weeklyCount}):t("Chưa có đơn trên web để tham gia vòng quay.")}</div>
    {spinning&&revealed.length?<ol className="pickup-revealed">{revealed.map(p=><li key={p.key}><CheckCheck size={16}/>{p.name}</li>)}</ol>:null}
    <div className="pickup-spin-controls"><label htmlFor="pickup-count">{t("Số người lấy cơm")}<input id="pickup-count" type="number" min="1" max={max||1} step="1" value={count} onChange={e=>setCount(e.target.value===''?0:Number(e.target.value))} disabled={!admin||spinning||!!draw}/></label><button className="primary" onClick={()=>void spin()} disabled={!admin||loading||spinning||!!draw||snapshot.date!==today||!validCount}>{spinning?<LoaderCircle size={19} className="spin"/>:<Dices size={19}/>} {draw?t("Đã có kết quả"):snapshot.closed?t("Quay chọn người"):t("Chốt danh sách & quay")}</button></div>
    <p className="pickup-helper">{!admin?t("Người quản lý sẽ quay và lưu kết quả chung cho cả nhóm."):snapshot.date!==today?t("Chỉ quay cho hôm nay; các ngày khác dùng để xem lại lịch sử."):!candidates.length?t("Cần có người đặt cơm trên web trước khi quay."):!validCount&&!draw?t("Cần từ 1 đến {0} người; mỗi người chỉ xuất hiện một lần.", {"0": max}):!snapshot.closed&&!draw?t("Quay sẽ chốt nhận đơn để cố định danh sách tham gia."):t("Mỗi ngày lưu một kết quả chung; tải lại trang vẫn giữ nguyên.")}</p>
   </article><div className="pickup-side"><article className="pickup-result-card"><div className="pickup-section-title"><span className="stat-icon amber"><Users size={22}/></span><div><h2>{t("Đội lấy cơm ")}{shortDate(snapshot.date)}</h2><p>{draw?t("{0} người được chọn từ {1} người đặt cơm", {"0": draw.count,"1": draw.candidateCount}):t("Kết quả sẽ xuất hiện tại đây")}</p></div></div>{draw&&!spinning?<><ol className="pickup-winners">{draw.selected.map((p,i)=><li key={p.key}><span>{String(i+1).padStart(2,'0')}</span><div><strong>{p.name}</strong><small>{t("Lượt thứ ")}{p.previousCount+1}{t(" trong tuần")}</small></div><CheckCheck size={21}/></li>)}</ol><div className="pickup-saved"><ShieldCheck size={17}/>{t("Đã lưu trên web · Cả nhóm cùng xem")}</div></>:<div className="pickup-result-empty"><Dices size={38}/><h3>{spinning?t("Đang mở kết quả…"):t("Chưa quay cho ngày này")}</h3><p>{spinning?t("Kết quả được lưu trước khi vòng quay dừng."):t("Mặc định chọn 2 người. Người đi ít lần hơn trong tuần sẽ được ưu tiên.")}</p></div>}</article>
    <article className="pickup-how"><h3>{t("Chia đều lượt lấy cơm")}</h3><ol><li>{t("Lấy người có đơn trên web trong ngày đang chọn; đơn hủy không tham gia.")}</li><li>{t("Ưu tiên người có ít lượt nhất từ đầu tuần. Nếu ngang lượt, chọn ngẫu nhiên.")}</li><li>{t("Mỗi người tối đa một lượt trong ngày. Tuần mới bắt đầu lại từ 0.")}</li></ol><p>{t("Số lượt được theo dõi theo tên đặt cơm. Hãy dùng cùng một tên mỗi ngày để giữ lịch sử chính xác.")}</p></article></div></div>
   <section className="table-section pickup-roster"><div className="section-heading"><div><h2>{t("Danh sách tham gia ")}<span>{candidates.length}{t(" người")}</span></h2><p>{t("Số lượt đã được chọn lấy cơm trong tuần này")}</p></div><span className="pickup-tag">{t("Chỉ dùng đơn trên web")}</span></div><div className="table-scroll"><table><thead><tr><th>{t("Người đặt cơm")}</th><th>{t("Số lượt trong tuần")}</th><th>{t("Lần gần nhất")}</th><th>{t("Trạng thái hôm nay")}</th></tr></thead><tbody>{candidates.map(p=><tr key={p.key}><td><strong>{p.name}</strong></td><td data-label={t("Số lượt trong tuần")}><span className="pickup-count-badge">{p.weeklyCount}{t(" lượt")}</span></td><td data-label={t("Lần gần nhất")}>{p.lastDate?shortDate(p.lastDate):t("Chưa có lượt")}</td><td data-label={t("Trạng thái hôm nay")}>{draw?.selectedKeys.includes(p.key)?<span className="pickup-chosen"><CheckCheck size={15}/>{t("Lấy cơm hôm nay")}</span>:!draw&&priority.some(x=>x.key===p.key)?<span className="pickup-priority">{t("Ưu tiên lượt tiếp theo")}</span>:<span className="pickup-muted">{draw?t("Không được chọn"):t("Chờ lượt")}</span>}</td></tr>)}</tbody></table></div>{!candidates.length?<div className="empty-state">{t("Chưa có người đặt cơm trên web trong ngày này.")}</div>:null}</section>
   <section className="pickup-history"><div className="pickup-section-title"><History size={22}/><div><h2>{t("Lịch sử tuần này")}</h2><p>{snapshot.history.length}{t(" ngày đã chọn người lấy cơm")}</p></div></div>{snapshot.history.length?<div className="pickup-history-list">{[...snapshot.history].reverse().map(d=><article key={d.date}><strong>{shortDate(d.date)}</strong><div>{d.selected.map(p=><span key={p.key}>{p.name}</span>)}</div><small>{d.count}{t(" người")}</small></article>)}</div>:<p className="pickup-empty-history">{t("Chưa có kết quả trong tuần. Lượt đầu tiên sẽ được chọn ngẫu nhiên giữa tất cả người tham gia.")}</p>}</section>
  </>:null}
 </section>;
}
