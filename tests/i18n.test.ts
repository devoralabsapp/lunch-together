import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import english from '../lib/locales/en.json';
import {defaultLocale,parseLocale,translate,formatMoney,formatLongDate,formatTimestamp,formatCompact} from '../lib/i18n';

test('Vietnamese is the default and only an explicit supported choice enables English',()=>{
 assert.equal(defaultLocale,'vi');
 for(const value of [undefined,null,'','en-US','EN','fr','<script>'])assert.equal(parseLocale(value),'vi');
 assert.equal(parseLocale('vi'),'vi');assert.equal(parseLocale('en'),'en');
 assert.equal(translate('vi','Chưa trả'),'Chưa trả');assert.equal(translate('en','Chưa trả'),'Unpaid');
});

test('translated placeholders preserve entered content and unique payment references',()=>{
 const reference='COM0123456789ABCDEF0123';
 assert.equal(translate('en',reference),reference);
 const entered='Ngọc {0} <b>mẫu</b>';
 assert.equal(translate('en','Tuần {0} – {1}',{'0':entered,'1':reference}),`Week ${entered} – ${reference}`);
 assert.equal(translate('en','  Chưa trả '),'  Unpaid ');
 assert.equal(translate('en','Unmapped source'),'Unmapped source');
 assert.equal(translate('en','toString'),'toString');
 assert.equal(translate('en','Đã cập nhật quyền của Ngọc.'),'Updated permissions for Ngọc.');
});

test('localized money stays in VND and dates use Vietnam time across midnight',()=>{
 assert.equal(formatMoney('vi',40000),'40.000 ₫');assert.equal(formatMoney('en',40000),'40,000 ₫');
 assert.equal(formatLongDate('en','2026-10-23'),'Friday, 23 October 2026');
 assert.match(formatLongDate('vi','2026-10-23'),/23.*2026/);
 assert.match(formatTimestamp('en','2026-10-22T17:30:00Z'),/23\/10\/2026.*00:30/);
 assert.equal(formatCompact('vi',1500000),'1,5tr');assert.equal(formatCompact('en',1500000),'1.5m');
});

test('all literal UI translations and lazy loading messages have English copy',()=>{
 const dictionary:Record<string,string>=english;
 const files=['app/rice-app.tsx','app/statistics-panel.tsx','app/pickup-panel.tsx','app/users-panel.tsx','app/payment-panel.tsx','components/google-login.tsx','components/i18n-provider.tsx','components/theme-provider.tsx','app/signin/page.tsx','app/group-payment-panel.tsx','app/order-cart-fields.tsx','app/restaurant-actions.tsx','app/restaurant-share-view.tsx','app/order-payment-status.tsx','app/order-edit-finance.tsx','app/activity-panel.tsx','app/my-orders-payment.tsx','app/account-button.tsx','app/personal-panel.tsx','app/organization-panel.tsx','app/personal-import-review.tsx'];
 const missing:string[]=[];
 for(const file of files){
  const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  function check(text:string){const key=text.replace(/\s+/g,' ').trim();if(!dictionary[key])missing.push(`${file}: ${key}`);}
  function visit(node:ts.Node){
   if(ts.isCallExpression(node)&&node.expression.getText(source)==='t'&&node.arguments[0]&&ts.isStringLiteral(node.arguments[0]))check(node.arguments[0].text);
   if(ts.isJsxAttribute(node)&&node.name.getText(source)==='text'&&node.initializer&&ts.isJsxExpression(node.initializer)&&node.initializer.expression&&ts.isStringLiteral(node.initializer.expression))check(node.initializer.expression.text);
   // Language names stay in their native language so the selector is recognizable.
   const nativeLanguageName=node.parent&&ts.isJsxElement(node.parent)&&node.parent.openingElement.attributes.properties.some(p=>ts.isJsxAttribute(p)&&p.name.getText(source)==='lang');
   if(ts.isJsxText(node)&&!nativeLanguageName&&/[\u00c0-\u024f\u1e00-\u1eff]/u.test(node.text))missing.push(`${file}: untranslated JSX ${node.text.trim()}`);
   ts.forEachChild(node,visit);
  }
  visit(source);
 }
 assert.deepEqual(missing,[]);
});
