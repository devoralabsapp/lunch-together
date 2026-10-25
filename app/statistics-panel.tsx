'use client';
import {useI18n} from '../components/i18n-provider';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Bar,BarChart,CartesianGrid,ResponsiveContainer,Tooltip,XAxis,YAxis} from 'recharts';
import {AlertCircle,CheckCheck,ChartNoAxesCombined,LoaderCircle,Receipt,RefreshCw,Search,Users,Wallet} from 'lucide-react';
import type {MealClient} from '../lib/meal-client';
import {ensureUser,friendlyFirebaseError} from '../lib/firebase-client';
import {combineStatistics,statisticsPeriods,summarizeStatistics,personKey,type SheetsStatistics,type StatisticsOrder,type StatisticsPeriod,type StatisticsSource} from '../lib/statistics';
import type {PaymentTarget} from '../lib/payment-group';

type Snapshot={web:StatisticsOrder[];sheets:SheetsStatistics|null;webError:string;sheetError:string;checkedAt:string};

export default function StatisticsPanel({client,userId,refreshKey=0,admin=false,onPay}:{client:MealClient;userId:string;refreshKey?:number;admin?:boolean;onPay:(target:PaymentTarget)=>void}){
 const {t,money,compact,timestamp}=useI18n();
 const [period,setPeriod]=useState<StatisticsPeriod>('today'),[source,setSource]=useState<StatisticsSource>('web'),[snapshot,setSnapshot]=useState<Snapshot|null>(null),[busy,setBusy]=useState(true),[search,setSearch]=useState('');
 const request=useRef(0),controller=useRef<AbortController|null>(null);
 const load=useCallback(async()=>{
  const sequence=++request.current;controller.current?.abort();const abort=new AbortController();controller.current=abort;setBusy(true);
  try{
   const user=await ensureUser(client.auth);if(user.uid!==userId)return;
   const sheets=async()=>{
    if(source==='web')return null;
    const token=await user.getIdToken();
    const response=await fetch('/api/statistics/sheets',{headers:{Authorization:'Bearer '+token},cache:'no-store',signal:abort.signal});
    const data=await response.json();if(!response.ok)throw new Error(data.error||'Chưa đọc được Google Sheets.');
    return data as SheetsStatistics;
   };
   const [webResult,sheetsResult]=await Promise.allSettled([source==='sheets'?Promise.resolve([]):client.statistics(),sheets()]);
   if(sequence!==request.current)return;
   setSnapshot({web:webResult.status==='fulfilled'?webResult.value:[],sheets:sheetsResult.status==='fulfilled'?sheetsResult.value:null,webError:webResult.status==='rejected'?friendlyFirebaseError(webResult.reason):'',sheetError:sheetsResult.status==='rejected'?friendlyFirebaseError(sheetsResult.reason):'',checkedAt:new Date().toISOString()});
  }catch(e){if(sequence===request.current)setSnapshot({web:[],sheets:null,webError:friendlyFirebaseError(e),sheetError:source!=='web'?friendlyFirebaseError(e):'',checkedAt:new Date().toISOString()});}
  finally{if(sequence===request.current)setBusy(false);}
 },[client,userId,source]);
 useEffect(()=>{void load();return()=>{request.current++;controller.current?.abort();};},[load,refreshKey]);
 const combined=useMemo(()=>combineStatistics(snapshot?.sheets?.orders||[],snapshot?.web||[]),[snapshot]);
 const orders=source==='sheets'?snapshot?.sheets?.orders||[]:source==='web'?snapshot?.web||[]:combined.orders;
 const result=useMemo(()=>summarizeStatistics(orders,period),[orders,period]);
 const sourceError=snapshot?[(source!=='sheets'?snapshot.webError:''),(source!=='web'?snapshot.sheetError:'')].filter(Boolean).join(' '):'';
 const ready=!!snapshot&&!sourceError&&!busy;
 const warnings=source==='web'?[]:(snapshot?.sheets?.warnings||[]).filter(w=>!w.date||((!result.range.start||w.date>=result.range.start)&&(!result.range.end||w.date<result.range.end)));
 const debtors=result.people.filter(p=>p.unpaid>0);
 const people=result.people.filter(p=>p.name.toLocaleLowerCase('vi-VN').includes(search.trim().toLocaleLowerCase('vi-VN')));
 const tooltip=(value:unknown)=>money(Number(value));
 const metric=(n:number)=>ready?money(n):'—';
  const payable=(key:string)=>result.selected.filter(o=>o.source==='web'&&!o.cancelled&&o.amount>(o.appliedAmount||0)&&!o.paid&&o.orderId&&personKey(o.name)===key&&(admin||o.ownerId===userId));

 return <section className="statistics-panel" aria-label={t("Thống kê tiền cơm cả nhóm")} aria-busy={busy}>
  <p className="refund-summary">{t('Tổng cần hoàn: ')}<strong>{metric(result.refundDue)}</strong> · {t('Tiền chọn để hôm sau được trừ dự kiến trong kỳ đang xem; số dư chỉ ghi sử dụng thực tế khi đặt hoặc thanh toán.')}</p><div className="statistics-controls">
   <div className="period-tabs" role="tablist" aria-label={t("Khoảng thời gian thống kê")}>{statisticsPeriods.map(p=><button key={p.id} id={'period-'+p.id} type="button" role="tab" aria-selected={period===p.id} aria-controls="statistics-results" onClick={()=>setPeriod(p.id)}>{t(p.label)}</button>)}</div>
   <div className="statistics-source-controls"><label className="statistics-source-label" htmlFor="statistics-source">{t("Nguồn dữ liệu")}<select id="statistics-source" value={source} onChange={e=>{setBusy(true);setSource(e.target.value as StatisticsSource);}}><option value="web">{t("Đơn trên web")}</option><option value="sheets">{t("Google Sheets (dữ liệu cũ)")}</option><option value="all">{t("Sheets và đơn trên web")}</option></select></label><button className="outline-btn" onClick={()=>void load()} disabled={busy}><RefreshCw size={17} className={busy?'spin':''}/>{t("Cập nhật")}</button></div>
  </div>
  <div className="statistics-context"><strong>{t(result.range.label)}</strong><span>{snapshot&&!busy?t('Cập nhật lúc {0}',{'0':timestamp(snapshot.checkedAt)}):t("Đang đọc dữ liệu…")}{t(" · Giờ Việt Nam")}</span></div>
  {busy?<div className="statistics-loading" role="status"><LoaderCircle className="spin" size={20}/><span>{t("Đang lấy dữ liệu thanh toán từ ")}{source==='web'?t("đơn trên web"):source==='sheets'?'Google Sheets':t("Sheets và web")}…</span></div>:null}
  {sourceError&&!busy?<div className="error-banner" role="alert"><AlertCircle size={20}/><span>{t(sourceError)}{t(" Chưa thể hiển thị đầy đủ số liệu cho nguồn đã chọn.")}</span></div>:null}
  {ready&&warnings.length?<div className="statistics-integrity-note" role="note"><AlertCircle size={18}/><span>{warnings.length}{t(" mục dữ liệu cần đối chiếu. Những dòng thiếu giá hoặc trạng thái chưa rõ chưa được cộng vào tổng. Xem chi tiết bên dưới.")}</span></div>:null}
  <div id="statistics-results" role="tabpanel" aria-labelledby={'period-'+period}>
   <div className="statistics-metrics">
    <article className="statistics-metric"><span className="stat-icon green"><Receipt size={22}/></span><span>{t("Tổng tiền")}</span><strong>{metric(result.total)}</strong><small>{ready?result.orderCount+t(" đơn đặt cơm"):t("Đang đối chiếu dữ liệu")}</small></article>
    <article className="statistics-metric"><span className="stat-icon teal"><CheckCheck size={22}/></span><span>{t("Đã trả")}</span><strong>{metric(result.paid)}</strong><small>{ready?(result.total?Math.round(result.paid/result.total*100):0)+t("% tổng tiền"):'—'}</small></article>
    <article className="statistics-metric outstanding"><span className="stat-icon amber"><Wallet size={22}/></span><span>{t("Chưa trả")}</span><strong>{metric(result.unpaid)}</strong><small>{t("Đã trừ số dư dự kiến: ")}{metric(result.creditOffset)}</small><small>{ready?debtors.length+t(" người còn nợ"):'—'}</small></article>
    <article className="statistics-metric"><span className="stat-icon orange"><Users size={22}/></span><span>{t("Người đặt cơm")}</span><strong>{ready?result.peopleCount:'—'}</strong><small>{t("Trong khoảng thời gian đã chọn")}</small></article>
   </div>
   {ready?<>
    {!result.orderCount?<div className="statistics-empty"><ChartNoAxesCombined size={36}/><h2>{t("Chưa có đơn trong khoảng thời gian này")}</h2><p>{t("Chọn khoảng thời gian khác hoặc cập nhật lại sau.")}</p></div>:<>
     <div className="statistics-chart-grid">
      <article className="statistics-chart-card"><div className="statistics-chart-heading"><div><h2>{t("Thanh toán theo ")}{result.byMonth?t("tháng"):t("ngày")}</h2><p>{t("Tổng tiền = Đã trả + Số dư trừ + Chưa trả")}</p></div></div><div className="statistics-legend"><span><i className="paid-color"/>{t("Đã trả")}</span><span><i className="credit-color"/>{t("Số dư trừ")}</span><span><i className="unpaid-color"/>{t("Chưa trả")}</span></div><div className="statistics-trend-chart">
       <ResponsiveContainer width="100%" height="100%" minWidth={0}><BarChart data={result.trend} accessibilityLayer margin={{top:12,right:12,left:0,bottom:8}}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--chart-grid,#e5ebe6)"/><XAxis dataKey="label" tick={{fontSize:'calc(12px + var(--text-size-offset,1px))',fill:'var(--muted,#60736a)'}} axisLine={false} tickLine={false} minTickGap={18}/><YAxis tickFormatter={compact} tick={{fontSize:'calc(12px + var(--text-size-offset,1px))',fill:'var(--muted,#60736a)'}} axisLine={false} tickLine={false} width={58}/><Tooltip formatter={tooltip} contentStyle={{borderRadius:10,borderColor:'var(--line,#dfe7e1)',background:'var(--theme-surface,#fff)',color:'var(--ink,#1c3028)',fontSize:'calc(14px + var(--text-size-offset,1px))'}}/><Bar dataKey="paid" name={t("Đã trả")} stackId="payment" fill="var(--chart-paid,#31775d)" maxBarSize={42}/><Bar dataKey="creditOffset" name={t("Số dư trừ")} stackId="payment" fill="var(--chart-credit,#548fb8)" maxBarSize={42}/><Bar dataKey="unpaid" name={t("Chưa trả")} stackId="payment" fill="var(--chart-unpaid,#c28a36)" radius={[4,4,0,0]} maxBarSize={42}/></BarChart></ResponsiveContainer>
      </div><details className="statistics-data-details"><summary>{t("Xem số liệu theo ")}{result.byMonth?t("tháng"):t("ngày")}</summary><div className="table-scroll"><table><thead><tr><th>{t("Thời gian")}</th><th>{t("Tổng tiền")}</th><th>{t("Đã trả")}</th><th>{t("Số dư trừ")}</th><th>{t("Chưa trả")}</th></tr></thead><tbody>{result.trend.map(p=><tr key={p.key}><td>{t(p.label)}</td><td>{money(p.total)}</td><td>{money(p.paid)}</td><td>{money(p.creditOffset)}</td><td>{money(p.unpaid)}</td></tr>)}</tbody></table></div></details></article>
      <article className="statistics-chart-card"><div className="statistics-chart-heading"><div><h2>{t("Tiền chưa trả theo người")}</h2><p>{debtors.length}{t(" người · ")}{money(result.unpaid)}</p></div></div>{debtors.length?<div className="statistics-debt-scroll"><div style={{height:Math.max(230,debtors.length*42)}}><ResponsiveContainer width="100%" height="100%" minWidth={0}><BarChart data={debtors} layout="vertical" accessibilityLayer margin={{top:10,right:28,left:0,bottom:10}}><CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--chart-grid,#e5ebe6)"/><XAxis type="number" tickFormatter={compact} tick={{fontSize:'calc(12px + var(--text-size-offset,1px))',fill:'var(--muted,#60736a)'}} axisLine={false} tickLine={false}/><YAxis type="category" dataKey="name" width={116} tickFormatter={name=>String(name).length>17?String(name).slice(0,16)+'…':String(name)} tick={{fontSize:'calc(12px + var(--text-size-offset,1px))',fill:'var(--ink,#334d3e)'}} axisLine={false} tickLine={false}/><Tooltip formatter={tooltip} contentStyle={{borderRadius:10,borderColor:'var(--line,#dfe7e1)',background:'var(--theme-surface,#fff)',color:'var(--ink,#1c3028)',fontSize:'calc(14px + var(--text-size-offset,1px))'}}/><Bar dataKey="unpaid" name={t("Chưa trả")} fill="var(--chart-unpaid,#c28a36)" radius={[0,4,4,0]} maxBarSize={24}/></BarChart></ResponsiveContainer></div></div>:<div className="statistics-paid-empty"><CheckCheck size={32}/><h3>{t("Đã thanh toán đầy đủ")}</h3><p>{t("Không còn khoản chưa trả trong khoảng thời gian này.")}</p></div>}</article>
     </div>
     <section className="table-section statistics-people"><div className="section-heading"><div><h2>{t("Chi tiết theo người ")}<span>{result.peopleCount}{t(" người")}</span></h2><p>{t("Sắp xếp theo số tiền chưa trả giảm dần")}</p><p>{t("Nút thanh toán gộp các đơn web chưa trả trong khoảng đang chọn. Người dùng chỉ thanh toán khoản của mình; quản trị có thể làm hộ.")}</p></div><div className="searchbox"><Search size={18}/><input aria-label={t("Tìm người trong thống kê")} placeholder={t("Tìm người đặt cơm…")} value={search} onChange={e=>setSearch(e.target.value)}/></div></div><div className="table-scroll"><table><thead><tr><th scope="col">{t("Người đặt")}</th><th scope="col">{t("Tổng tiền")}</th><th scope="col">{t("Đã trả")}</th><th scope="col">{t("Số dư trừ")}</th><th scope="col">{t("Chưa trả")}</th><th scope="col">{t("Cần hoàn")}</th><th scope="col">{t("Số đơn")}</th><th scope="col">{t("Thanh toán")}</th></tr></thead><tbody>{people.map(p=><tr key={p.key}><td><strong>{p.name}</strong></td><td data-label={t("Tổng tiền")}>{money(p.total)}</td><td data-label={t("Đã trả")} className="statistics-paid">{money(p.paid)}</td><td data-label={t("Số dư trừ")} className="finance-credit">{money(p.creditOffset)}</td><td data-label={t("Chưa trả")} className={p.unpaid?'statistics-unpaid':'statistics-zero'}>{money(p.unpaid)}</td><td data-label={t("Cần hoàn")} className="finance-refund">{money(p.refundDue)}</td><td data-label={t("Số đơn")}>{p.orders}</td><td data-label={t("Thanh toán")}>{payable(p.key).length?<button className="row-pay-button" onClick={()=>onPay({name:p.name,orders:payable(p.key).map(o=>({dayId:o.dayId,orderId:o.orderId!}))})}>{p.unpaid>0?t("Thanh toán"):t("Dùng số dư")}</button>:null}</td></tr>)}</tbody></table></div>{!people.length?<div className="empty-state">{t("Không tìm thấy người phù hợp.")}</div>:null}<div className="table-footer"><span>{result.orderCount}{t(" đơn trong khoảng đã chọn")}</span><strong>{t("Tổng chưa trả: ")}{money(result.unpaid)}</strong></div></section>
    </>}
    {warnings.length?<details className="statistics-warnings"><summary><AlertCircle size={18}/>{warnings.length}{t(" mục dữ liệu cần kiểm tra")}</summary><p>{t("Các dòng thiếu giá hoặc trạng thái chưa xác định chưa được cộng vào số tiền.")}</p><ul>{warnings.map((warning,i)=><li key={i}>Sheet {warning.sheet}{warning.row?t(", dòng ")+warning.row:''}: {t(warning.message)}</li>)}</ul>{snapshot.sheets?.sourceUrl?<a className="text-btn" href={snapshot.sheets.sourceUrl} target="_blank" rel="noreferrer">{t("Mở Google Sheets để đối chiếu")}</a>:null}</details>:null}
    <div className="statistics-footnote">{source==='all'?<>{t("Kết hợp ")}{snapshot.sheets?.sheetCount||0}{t(" sheet và đơn trên web. Đơn trên web trùng ngày, tên và bữa ăn được ưu tiên")}{combined.replaced?' ('+combined.replaced+t(" dòng Sheets được thay thế)"):''}.</>:source==='sheets'?<>{t("Đang đọc ")}{snapshot.sheets?.sheetCount||0}{t(" sheet, bao gồm các sheet ẩn.")}</>:<>{t("Số liệu từ đơn đã lưu trên web; đơn đã hủy được loại khỏi thống kê.")}</>}{t(" Tuần bắt đầu từ thứ Hai. Tiền được tính theo ngày đặt cơm.")}</div>
   </>:null}
  </div>
 </section>;
}
