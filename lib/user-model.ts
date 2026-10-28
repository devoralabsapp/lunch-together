export const PRIMARY_ADMIN_UID='PRIMARY_ADMIN_UID_HERE';
export function validUserId(uid:string){return /^[A-Za-z0-9_-]{1,128}$/.test(uid);}
export type ManagedUser={uid:string;displayName:string;preferredName:string;email:string;provider:'anonymous'|'google.com'|'unknown';createdAt:string;lastSeenAt:string;admin:boolean;blocked:boolean;orderCount:number;lastOrderDate:string;aliases:string[];affiliation?:string;companyId?:string;departmentId?:string;phone?:string;jobTitle?:string;hasOrderHistory?:boolean;deleted?:boolean};
export type UserDirectory={users:ManagedUser[];canManageRoles:boolean;organization:import('./organization').Organization};
export function filterManagedUsers(users:ManagedUser[],input:{status:string;companyId:string;departmentId:string;search:string}){
 const text=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/đ/g,'d');
 const search=text(input.search.trim());
 return users.filter(p=>(input.status==='all'||(input.status==='admin'?p.admin:input.status==='blocked'?p.blocked:p.provider==='anonymous'))
  && (!input.companyId||(input.companyId==='!none'?!p.companyId:p.companyId===input.companyId))
  && (!input.departmentId||(input.departmentId==='!none'?!p.departmentId:p.departmentId===input.departmentId))
  && text([p.displayName,p.email,p.uid,...p.aliases].join(' ')).includes(search));
}
