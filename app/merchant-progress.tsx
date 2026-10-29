'use client';
import {Check} from 'lucide-react';
import {useI18n} from '../components/i18n-provider';

export const merchantStages=[['accepted','Đã nhận đơn'],['cooking','Đang nấu'],['ready','Sẵn sàng'],['delivering','Đang giao'],['completed','Hoàn tất']] as const;

export default function MerchantProgress({index}:{index:number}){
 const {t}=useI18n();
 return <ol className="merchant-progress" aria-label={t('Trạng thái')}>{merchantStages.map(([state,text],i)=><li key={state} className={i<=index?'done':''} aria-current={i===index?'step':undefined}><span className="merchant-progress-marker" aria-hidden="true">{i<=index?<Check size={14}/>:i+1}</span><span className="merchant-progress-label">{t(text)}</span></li>)}</ol>;
}
