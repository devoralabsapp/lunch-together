'use client';
import {useEffect,useRef,useState} from 'react';
import {LoaderCircle,Pencil} from 'lucide-react';
import {useI18n} from '../components/i18n-provider';
import type {MealClient} from '../lib/meal-client';
import type {ManagedUser} from '../lib/user-model';
import type {Organization} from '../lib/organization';
import {updateManagedUser} from '../lib/user-management';
import {friendlyFirebaseError} from '../lib/firebase-client';

export default function UserEditor({client,person,organization,onClose,onSaved}:{client:MealClient;person:ManagedUser;organization:Organization;onClose:()=>void;onSaved:()=>void}){
 const {t}=useI18n(),dialog=useRef<HTMLDialogElement>(null),inFlight=useRef(false);
 const [name,setName]=useState(person.preferredName||person.displayName),[companyId,setCompanyId]=useState(person.companyId||''),[departmentId,setDepartmentId]=useState(person.departmentId||''),[phone,setPhone]=useState(person.phone||''),[jobTitle,setJobTitle]=useState(person.jobTitle||''),[saving,setSaving]=useState(false),[error,setError]=useState('');
 useEffect(()=>{const element=dialog.current;element?.showModal();return()=>element?.close();},[]);
 async function save(e:React.FormEvent){e.preventDefault();if(inFlight.current)return;inFlight.current=true;setSaving(true);setError('');try{await updateManagedUser(client,person.uid,{preferredName:name,companyId,departmentId,phone,jobTitle});onSaved();}catch(e){setError(friendlyFirebaseError(e));}finally{inFlight.current=false;setSaving(false);}}
 const companies=organization.companies.filter(c=>c.active||c.id===companyId),departments=organization.departments.filter(d=>d.companyId===companyId&&(d.active||d.id===departmentId));
 return <dialog ref={dialog} className="users-confirm user-editor" aria-labelledby="user-editor-title" onCancel={e=>{e.preventDefault();if(!inFlight.current)onClose();}}><Pencil size={26}/><h2 id="user-editor-title">{t('Sửa thông tin người dùng')}</h2><code>{person.uid}</code><form onSubmit={save}>
  <label>{t('Tên hiển thị / tên đặt cơm')}<input autoFocus required value={name} maxLength={100} disabled={saving} onChange={e=>setName(e.target.value)}/></label>
  <label>{t('Email Google')}<input value={person.email||'—'} readOnly aria-readonly="true"/></label><small>{t('Email đăng nhập được quản lý bởi Google. Thay đổi tên không sửa các đơn đã đặt.')}</small>
  <div className="user-editor-grid"><label>{t('Công ty')}<select value={companyId} disabled={saving} onChange={e=>{setCompanyId(e.target.value);setDepartmentId('');}}><option value="">{t('Chưa chọn công ty')}</option>{companies.map(c=><option key={c.id} value={c.id} disabled={!c.active}>{c.name}{c.active?'':t(' (ngừng sử dụng)')}</option>)}</select></label><label>{t('Phòng ban')}<select value={departmentId} disabled={saving||!companyId} onChange={e=>setDepartmentId(e.target.value)}><option value="">{t('Chưa chọn phòng ban')}</option>{departments.map(d=><option key={d.id} value={d.id} disabled={!d.active}>{d.name}{d.active?'':t(' (ngừng sử dụng)')}</option>)}</select></label></div>
  <div className="user-editor-grid"><label>{t('Số điện thoại')}<input type="tel" value={phone} maxLength={30} disabled={saving} onChange={e=>setPhone(e.target.value)}/></label><label>{t('Chức danh')}<input value={jobTitle} maxLength={100} disabled={saving} onChange={e=>setJobTitle(e.target.value)}/></label></div>
  {error?<div role="alert" className="error-banner">{t(error)}</div>:null}<div className="users-confirm-actions"><button type="button" className="outline-btn" disabled={saving} onClick={onClose}>{t('Hủy')}</button><button type="submit" className="primary" disabled={saving||!name.trim()}>{saving?<LoaderCircle size={17} className="spin"/>:null}{t('Lưu thông tin')}</button></div>
 </form></dialog>;
}
