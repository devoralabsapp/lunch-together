import {translate,type Locale} from './i18n';
import {parseRestaurantSummary,type RestaurantSummary} from './restaurant-summary';

export type RestaurantDisplayRow={dish:string;quantity:number;unitPrice:number;notes:{text:string;quantity:number}[]};

/** Present one dish/price total while retaining exactly how many servings each note covers. */
export function restaurantDisplayRows(input:RestaurantSummary):RestaurantDisplayRow[]{
 const summary=parseRestaurantSummary(input),groups=new Map<string,RestaurantDisplayRow>();
 for(const row of summary.rows){
  const key=JSON.stringify([row.dish,row.unitPrice]);
  const group=groups.get(key)||{dish:row.dish,quantity:0,unitPrice:row.unitPrice,notes:[]};
  group.quantity+=row.quantity;
  const text=row.note.trim();
  if(text){const note=group.notes.find(note=>note.text===text);if(note)note.quantity+=row.quantity;else group.notes.push({text,quantity:row.quantity});}
  groups.set(key,group);
 }
 return [...groups.values()].sort((a,b)=>a.dish.localeCompare(b.dish,'vi')||a.unitPrice-b.unitPrice).map(row=>({...row,notes:row.notes.sort((a,b)=>a.text.localeCompare(b.text,'vi'))}));
}

export function restaurantNoteLines(row:RestaurantDisplayRow,locale:Locale):string[]{
 return row.notes.map(note=>note.quantity===1?translate(locale,'1 suất: {0}',{'0':note.text}):translate(locale,'{0} suất: {1}',{'0':note.quantity,'1':note.text}));
}
