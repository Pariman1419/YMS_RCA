const {spawn}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const runtime=path.join(root,'.runtime');
fs.mkdirSync(runtime,{recursive:true});
const pidFile=path.join(runtime,'supervisor.pid');
if(fs.existsSync(pidFile)){const previous=Number(fs.readFileSync(pidFile,'utf8'));if(Number.isInteger(previous)&&previous>0){try{process.kill(previous,0);console.log('NEXUS supervisor is already running. Open http://127.0.0.1:8088/');process.exit(0);}catch{}}}
fs.writeFileSync(pidFile,String(process.pid));
const definitions={api:['apps/api/dist/apps/api/src/main.js',{}],etl:['apps/etl/dist/apps/etl/src/main.js',{}],web:['apps/web/.next/standalone/apps/web/server.js',{PORT:'8088',HOSTNAME:'127.0.0.1'}]};
const children=new Map();let stopping=false;
function launch(name){if(stopping)return;const [entry,env]=definitions[name];const log=fs.openSync(path.join(runtime,name+'.log'),'a');fs.writeSync(log,`\n${new Date().toISOString()} Starting ${name}\n`);const child=spawn(process.execPath,[entry],{cwd:root,env:{...process.env,...env},windowsHide:true,stdio:['ignore',log,log]});children.set(name,child);child.on('error',e=>fs.appendFileSync(path.join(runtime,name+'.log'),e.message+'\n'));child.on('exit',code=>{fs.closeSync(log);children.delete(name);if(!stopping){fs.appendFileSync(path.join(runtime,name+'.log'),`Exited ${code}; restarting in 5 seconds\n`);setTimeout(()=>launch(name),5000);}});}
for(const name of Object.keys(definitions))launch(name);
function stop(){stopping=true;for(const child of children.values())child.kill();try{fs.unlinkSync(path.join(runtime,'supervisor.pid'));}catch{}setTimeout(()=>process.exit(),1000);}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
