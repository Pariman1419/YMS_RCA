const ts = require('typescript');
const fs = require('node:fs');
const path = require('node:path');
const files = [];
function walk(dir) {
 for (const e of fs.readdirSync(dir,{withFileTypes:true})) {
  const full=path.join(dir,e.name);
  if (e.isDirectory()) { if(!['node_modules','.next','dist'].includes(e.name))walk(full); }
  else if (/\.tsx?$/.test(e.name))files.push(path.resolve(full));
 }
}
for(const dir of ['apps','packages','tests','database'])walk(dir);
const host={getScriptFileNames:()=>files,getScriptVersion:()=> '0',getScriptSnapshot:f=>fs.existsSync(f)?ts.ScriptSnapshot.fromString(fs.readFileSync(f,'utf8')):undefined,getCurrentDirectory:()=>process.cwd(),getCompilationSettings:()=>({target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,experimentalDecorators:true,esModuleInterop:true}),getDefaultLibFileName:o=>ts.getDefaultLibFilePath(o),fileExists:fs.existsSync,readFile:f=>fs.readFileSync(f,'utf8'),readDirectory:ts.sys.readDirectory};
const service=ts.createLanguageService(host);
for(const file of files){const edits=service.organizeImports({type:'file',fileName:file},{},{});for(const edit of edits){let text=fs.readFileSync(edit.fileName,'utf8');for(const change of [...edit.textChanges].sort((a,b)=>b.span.start-a.span.start))text=text.slice(0,change.span.start)+change.newText+text.slice(change.span.start+change.span.length);fs.writeFileSync(edit.fileName,text);}}
