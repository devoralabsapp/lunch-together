'use client';
import {Fragment,useCallback,useEffect,useRef,useState} from 'react';
import {readActivityPage,readActivityNames,type ActivityEntry,type ActivityCursor} from '../lib/activity-reader';
import {RefreshCw,Search,LoaderCircle,ChevronDown,ChevronRight} from 'lucide-react';
import {useI18n} from '../components/i18n-provider';
import type {MealClient} from '../lib/meal-client';
import {friendlyFirebaseError} from '../lib/firebase-client';
const enumLabels:Record<string,string>={carry:'Để hôm sau',refund:'Hoàn lại',menu:'Thực đơn',orders:'Danh sách đặt cơm',summary:'Tổng hợp & thanh toán',statistics:'Thống kê',pickup:'Vòng quay lấy cơm',history:'Lịch sử đặt cơm',users:'Quản trị người dùng',activity:'Nhật ký hoạt động',profile:'Thông tin cá nhân',departments:'Phòng ban',admin:'Quản trị',open:'Đang mở nhận đơn',closed:'Đã chốt đơn',auto:'Tự động',paid:'Đã thanh toán',unmatched:'Chưa khớp',duplicate:'Đã xử lý',error:'Lỗi'};
const labels:Record<string,string>={adminUid:'Quản trị thực hiện',before:'Trước thay đổi',after:'Sau thay đổi',changes:'Các món thay đổi',name:'Người đặt',ownerId:'Chủ đơn',targetUid:'Tài khoản được thay đổi',dish:'Món ăn',dishId:'Mã món',quantity:'Số suất',price:'Đơn giá',note:'Ghi chú',paid:'Đã thanh toán',cancelled:'Đã hủy',receivedAmount:'Đã nhận',refundedAmount:'Đã hoàn',voidedAmount:'Đã bỏ xác nhận',creditInAmount:'Đã dùng số dư',creditOutAmount:'Đã chuyển số dư',surplusChoice:'Lựa chọn tiền thừa',amount:'Số tiền',choice:'Lựa chọn',transferId:'Mã sử dụng số dư',source:'Nguồn số dư',order:'Đơn cơm',orderId:'Mã đơn',dayId:'Ngày đặt cơm',reference:'Nội dung chuyển khoản',count:'Số dòng món',orders:'Các đơn',eventId:'Mã đối soát',date:'Ngày',status:'Trạng thái',menu:'Thực đơn',rowCount:'Số món',rows:'Các món',selectedNames:'Người được chọn',blocked:'Khóa đặt cơm',enabled:'Bật quyền',signedIn:'Đăng nhập Google',linkedGuest:'Liên kết đơn khách',bankName:'Ngân hàng',accountLast4:'Bốn số cuối tài khoản',reason:'Kết quả',httpStatus:'Mã phản hồi',action:'Thao tác',code:'Mã lỗi',page:'Mục đã xem'};
function Details({text}:{text:string}){const {t,money}=useI18n();let data:unknown;try{data=JSON.parse(text);}catch{return <p>{t('Không đọc được chi tiết nhật ký.')}</p>;}
 function value(v:unknown,key='',depth=0):React.ReactNode{if(v===null||v===undefined||v==='')return '—';if(depth>5)return t('Xem mục cha để biết chi tiết.');if(Array.isArray(v))return <ol>{v.map((item,i)=><li key={i}>{value(item,key,depth+1)}</li>)}</ol>;if(typeof v==='object')return <dl>{Object.entries(v).map(([k,item])=><div key={k}><dt>{t(Object.hasOwn(labels,k)?labels[k]:k)}</dt><dd>{value(item,k,depth+1)}</dd></div>)}</dl>;if(typeof v==='boolean')return t(v?'Có':'Không');if(typeof v==='number')return /Amount$|^amount$|^price$/.test(key)?money(v):v;return ['choice','surplusChoice','page','status'].includes(key)?t(Object.hasOwn(enumLabels,String(v))?enumLabels[String(v)]:String(v)):String(v);}
 return <div className="activity-detail">{value(data)}</div>;
}
export default function ActivityPanel({client,userId,admin=false}:{client:MealClient;userId:string;admin?:boolean}){
 const {t,timestamp}=useI18n();
 const [entries,setEntries]=useState<ActivityEntry[]>([]),[busy,setBusy]=useState(true),[error,setError]=useState(''),[more,setMore]=useState(false),[search,setSearch]=useState(''),[category,setCategory]=useState('all'),[names,setNames]=useState<Record<string,string>>({}),[expanded,setExpanded]=useState<string|null>(null);
 const cursor=useRef<ActivityCursor|undefined>(undefined),generation=useRef(0),loading=useRef(false);
 const load=useCallback(async(reset=false)=>{
  if(loading.current)return;
  const seq=++generation.current;loading.current=true;setBusy(true);setError('');
  try{
   const [page,profiles]=await Promise.all([readActivityPage(client,userId,admin,reset?undefined:cursor.current),reset?readActivityNames(client,userId,admin):Promise.resolve(null)]);
   if(seq!==generation.current||client.auth.currentUser?.uid!==userId)return;
   if(profiles)setNames(profiles);cursor.current=page.cursor;
   setEntries(previous=>reset?page.entries:[...previous,...page.entries]);setMore(page.more);if(reset)setExpanded(null);
  }catch(e){if(seq===generation.current)setError((e as {code?:string}).code==='failed-precondition'?'Nhật ký cá nhân đang được chuẩn bị. Vui lòng thử lại sau.':friendlyFirebaseError(e));}
  finally{if(seq===generation.current){loading.current=false;setBusy(false);}}
 },[client,userId,admin]);
 useEffect(()=>{void load(true);return()=>{generation.current++;loading.current=false;};},[load]);
 const actorName=(entry:ActivityEntry)=>Object.hasOwn(names,entry.actorId)&&names[entry.actorId]?names[entry.actorId]:entry.source==='bank'?t('Kết nối ngân hàng'):admin?t('Khách'):t('Bạn');
 const visible=entries.filter(e=>(category==='all'||e.kind.startsWith(category+'.'))&&[actorName(e),e.summary,e.actorId,e.reference,e.details].join(' ').toLocaleLowerCase('vi').includes(search.toLocaleLowerCase('vi')));
 return <section className="activity-panel" aria-label={admin?t('Nhật ký hoạt động'):t('Nhật ký của tôi')} aria-busy={busy}>
  <div className="section-heading"><div><h2>{admin?t('Nhật ký hoạt động'):t('Nhật ký của tôi')}</h2><p>{admin?t('Quản trị xem được hoạt động của tất cả tài khoản.'):t('Bạn chỉ xem được các hoạt động do tài khoản của mình thực hiện.')}</p><p>{t('Tìm kiếm và bộ lọc áp dụng cho {0} bản ghi đã tải.',{'0':entries.length})}</p></div><button className="outline-btn" disabled={busy} onClick={()=>void load(true)}><RefreshCw size={15} className={busy?'spin':''}/>{t('Cập nhật')}</button></div>
  <p className="activity-note">{t('Nhật ký trình duyệt có thể thiếu khi mất mạng hoặc thao tác ngoài ứng dụng. Biên nhận ngân hàng và sổ sử dụng số dư là căn cứ đối soát tiền.')}</p>
  <div className="activity-controls"><label>{t('Loại hoạt động')}<select value={category} onChange={e=>setCategory(e.target.value)}>{[['all','Tất cả'],['order','Đơn cơm'],['payment','Thanh toán'],['bank','Ngân hàng'],['credit','Số dư'],['app','Truy cập'],['page','Xem mục'],['auth','Đăng nhập'],['user','Quản trị người dùng'],['menu','Thực đơn'],['share','Chia sẻ'],['export','Xuất file'],['pickup','Vòng quay'],['profile','Hồ sơ'],['organization','Phòng ban'],['import','Nhập / xuất dữ liệu']].map(([value,label])=><option key={value} value={value}>{t(label)}</option>)}</select></label><div className="searchbox"><Search size={16}/><input aria-label={t('Tìm trong nhật ký')} placeholder={t('Tên, món ăn, tài khoản hoặc mã thanh toán…')} value={search} onChange={e=>setSearch(e.target.value)}/></div></div>
  {error?<p role="alert" className="error-banner">{t(error)}</p>:null}
  {busy&&!entries.length?<p className="activity-loading" role="status"><LoaderCircle size={17} className="spin"/>{t('Đang tải nhật ký…')}</p>:null}
  <div className="table-scroll"><table className="activity-table"><colgroup><col className="activity-time-col"/><col className="activity-action-col"/><col className="activity-actor-col"/><col className="activity-detail-col"/></colgroup><thead><tr><th scope="col">{t('Thời gian')}</th><th scope="col">{t('Hoạt động')}</th><th scope="col">{t('Người thực hiện')}</th><th scope="col">{t('Chi tiết')}</th></tr></thead><tbody>{visible.map(entry=><Fragment key={entry.id}>
   <tr className="activity-row"><td className="activity-time">{entry.time?<time dateTime={entry.time}>{timestamp(entry.time)}</time>:<span>{t('Chưa có thời gian')}</span>}</td><td className="activity-action"><strong>{t(entry.summary)}</strong><small>{entry.source==='bank'?t('Ngân hàng qua API'):t('Từ ứng dụng')}{entry.dayId?' · '+entry.dayId.replace(/^day-/,''):''}</small>{entry.reference?<code>{entry.reference}</code>:null}</td><td className="activity-actor"><strong>{actorName(entry)}</strong><code>{entry.actorId}</code></td><td className="activity-detail-cell"><button className="text-btn activity-detail-toggle" aria-expanded={expanded===entry.id} aria-controls={'activity-detail-'+entry.id} onClick={()=>setExpanded(value=>value===entry.id?null:entry.id)}>{expanded===entry.id?<ChevronDown size={14}/>:<ChevronRight size={14}/>}<span>{expanded===entry.id?t('Ẩn chi tiết'):t('Xem chi tiết')}</span></button></td></tr>
   {expanded===entry.id?<tr className="activity-expanded-row"><td colSpan={4}><div id={'activity-detail-'+entry.id} className="activity-expanded"><Details text={entry.details}/></div></td></tr>:null}
  </Fragment>)}</tbody></table></div>
  {!visible.length&&!busy&&!error?<p className="empty-state">{t('Chưa có hoạt động phù hợp.')}</p>:null}
  <div className="activity-footer"><span>{t('{0} bản ghi đang hiển thị',{'0':visible.length})}</span>{more?<button className="outline-btn" disabled={busy} onClick={()=>void load()}>{busy?<LoaderCircle size={15} className="spin"/>:null}{t('Tải thêm 50 bản ghi')}</button>:null}</div>
 </section>;
}
