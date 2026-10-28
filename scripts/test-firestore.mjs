import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import net from 'node:net';
import {randomUUID} from 'node:crypto';
const project=process.cwd();
const cachedJava=path.join(project,'.test-tools','jre-21');
const javaHome=fs.existsSync(path.join(cachedJava,'bin',process.platform==='win32'?'java.exe':'java'))?cachedJava:(process.env.JAVA_HOME||'');
const env={...process.env,NEXT_TELEMETRY_DISABLED:'1'};
if(fs.existsSync(path.join(javaHome,'bin',process.platform==='win32'?'java.exe':'java'))){env.JAVA_HOME=javaHome;env.PATH=path.join(javaHome,'bin')+path.delimiter+env.PATH;}
// Auth API-key sign-in belongs to the configured emulator project. Serialize
// suites that reset that project's fixtures, including API token verification.
const command=`"${process.execPath}" "${path.join(project,'node_modules/tsx/dist/cli.mjs')}" --test --test-concurrency=1 "${path.join(project,'tests/*.test.ts')}"`;
const config=JSON.parse(fs.readFileSync('firebase.json','utf8'));
const ports=new Set();
async function availablePort(){let p;do{p=await new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const address=server.address();server.close(()=>resolve(address.port));});});}while(ports.has(p));ports.add(p);return p;}
for(const name of ['auth','firestore','hub','logging'])config.emulators[name]={host:'127.0.0.1',port:await availablePort()};
const configPath=path.join(project,'firebase.test-'+randomUUID()+'.json');fs.writeFileSync(configPath,JSON.stringify(config));
const child=spawn(process.execPath,['node_modules/firebase-tools/lib/bin/firebase.js','emulators:exec','--config',configPath,'--only','auth,firestore','--project','demo-datcom-tests',command],{env,stdio:'inherit',windowsHide:true});
child.on('error',error=>{fs.unlinkSync(configPath);console.error(error.message);process.exitCode=1;});child.on('exit',code=>{fs.unlinkSync(configPath);process.exitCode=code??1;});
