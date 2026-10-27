import {formatMoney,formatLongDate,formatTimestamp,translate,type Locale} from './i18n';
import {parseRestaurantSummary,restaurantTotals,type RestaurantSummary} from './restaurant-summary';
import {restaurantDisplayRows,restaurantNoteLines} from './restaurant-presentation';

function wrap(ctx:CanvasRenderingContext2D,text:string,width:number){
 const lines:string[]=[];let line='';
 for(const word of text.split(/\s+/)){const candidate=line?line+' '+word:word;if(ctx.measureText(candidate).width<=width)line=candidate;else{if(line)lines.push(line);line='';for(const char of Array.from(word)){if(ctx.measureText(line+char).width>width){lines.push(line);line='';}line+=char;}}}
 if(line)lines.push(line);return lines.length?lines:[''];
}
export async function restaurantCanvases(input:RestaurantSummary,locale:Locale){
 const summary=parseRestaurantSummary(input);await document.fonts.ready;
 const t=(text:string)=>translate(locale,text),money=(n:number)=>formatMoney(locale,n),width=1240,height=1754,pages:HTMLCanvasElement[]=[];
 let canvas:HTMLCanvasElement,ctx:CanvasRenderingContext2D,y=0;
 function text(value:string,x:number,top:number,size=25,color='#203d32',weight='400',align:CanvasTextAlign='left'){ctx.font=`${weight} ${size}px Arial, sans-serif`;ctx.fillStyle=color;ctx.textAlign=align;ctx.fillText(value,x,top);ctx.textAlign='left';}
 function page(){canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;ctx=canvas.getContext('2d')!;if(!ctx)throw new Error('Chưa xuất được ảnh. Vui lòng thử trình duyệt khác.');ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);ctx.fillStyle='#255c46';ctx.fillRect(0,0,width,22);text(t('Cơm Nhà').toLocaleUpperCase(locale),65,95,27,'#31775d','700');text(t('Danh sách gửi nhà hàng'),65,162,43,'#203d32','700');text(formatLongDate(locale,summary.date),65,210,25,'#61746a');text(t('Bản chốt lúc ')+formatTimestamp(locale,summary.generatedAt),65,252,21,'#61746a');ctx.fillStyle='#edf4ee';ctx.fillRect(60,285,1120,56);text(t('Món ăn / ghi chú'),78,322,23,'#315b46','700');text(t('Số suất'),770,322,23,'#315b46','700','right');text(t('Đơn giá'),963,322,23,'#315b46','700','right');text(t('Thành tiền'),1160,322,23,'#315b46','700','right');y=365;pages.push(canvas);}
 page();
 for(const row of restaurantDisplayRows(summary)){
  ctx!.font='600 26px Arial, sans-serif';const names=wrap(ctx!,row.dish,620);ctx!.font='400 22px Arial, sans-serif';const notes=restaurantNoteLines(row,locale).map(note=>wrap(ctx!,note,620));
  const rowHeight=Math.max(74,names.length*34+notes.reduce((n,lines)=>n+lines.length*29,0)+28),minimumHeight=Math.max(74,names.length*34+(notes[0]?.length||0)*29+28);
  if(y+minimumHeight>1545||(rowHeight<=1180&&y+rowHeight>1545))page();
  let segmentStart=y;
  function heading(continued=false){
   ctx!.font='600 26px Arial, sans-serif';const lines=continued?wrap(ctx!,row.dish+' '+t('(tiếp theo)'),620):names;
   lines.forEach((line,i)=>text(line,78,y+i*34,26,'#203d32','600'));
   if(!continued){text(String(row.quantity),770,y,26,'#203d32','700','right');text(money(row.unitPrice),963,y,23,'#50675b','400','right');text(money(row.quantity*row.unitPrice),1160,y,24,'#203d32','600','right');}
   y+=lines.length*34;
  }
  function finishSegment(){y=Math.max(segmentStart+74,y+28);ctx!.strokeStyle='#e1e9e3';ctx!.beginPath();ctx!.moveTo(65,y-32);ctx!.lineTo(1175,y-32);ctx!.stroke();}
  heading();
  for(const lines of notes){
   // Keep each counted note together; repeat dish context when a long list spans pages.
   if(y+lines.length*29+28>1545){finishSegment();page();segmentStart=y;heading(true);}
   lines.forEach((line,i)=>text(line,78,y+i*29,22,'#61746a'));y+=lines.length*29;
  }
  finishSegment();
 }
 if(y>1445)page();const totals=restaurantTotals(summary);ctx!.fillStyle='#edf4ee';ctx!.fillRect(60,y+4,1120,104);text(t('Tổng cộng'),78,y+68,27,'#255c46','700');text(String(totals.quantity),770,y+68,29,'#255c46','700','right');text(money(totals.amount),1160,y+68,31,'#255c46','700','right');
 pages.forEach((pageCanvas,i)=>{ctx=pageCanvas.getContext('2d')!;text(t('Chỉ gồm món, số lượng và ghi chú; không có thông tin thanh toán cá nhân.'),65,1650,20,'#7a8b80');text(`${i+1} / ${pages.length}`,1175,1695,20,'#7a8b80','400','right');});
 return pages;
}
function download(blob:Blob,name:string){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
export async function exportRestaurant(summary:RestaurantSummary,locale:Locale,format:'pdf'|'jpg'){
 const pages=await restaurantCanvases(summary,locale),base='com-nha-'+summary.date;
 const images=await Promise.all(pages.map(canvas=>new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Chưa xuất được ảnh. Vui lòng thử trình duyệt khác.')),'image/jpeg',.94))));
 if(format==='jpg'){
  if(images.length===1)download(images[0],base+'.jpg');else{const {zipSync}=await import('fflate'),files:Record<string,Uint8Array>={};for(const [i,image] of images.entries())files[base+'-'+(i+1)+'.jpg']=new Uint8Array(await image.arrayBuffer());download(new Blob([new Uint8Array(zipSync(files,{level:0}))],{type:'application/zip'}),base+'-jpg.zip');}return;
 }
 const {PDFDocument}=await import('pdf-lib'),pdf=await PDFDocument.create();pdf.setTitle(translate(locale,'Cơm Nhà')+' '+summary.date);pdf.setLanguage(locale);for(const image of images){const jpg=await pdf.embedJpg(await image.arrayBuffer()),page=pdf.addPage([595.28,841.89]);page.drawImage(jpg,{x:0,y:0,width:595.28,height:841.89});}download(new Blob([new Uint8Array(await pdf.save())],{type:'application/pdf'}),base+'.pdf');
}
