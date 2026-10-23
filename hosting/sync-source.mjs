// Run from the canonical SATY checkout after staging the reviewed source files.
// The destination must be the existing Site checkout opened by the Sites helper.
// Its identity, Git history, untracked private data and credentials are preserved.
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir,unlink,stat} from 'node:fs/promises';
import {resolve,dirname,join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const destination=process.argv[2]&&resolve(process.argv[2]);
const check=process.argv.includes('--check');
if(!destination||destination===root||relative(root,destination)===''||!relative(root,destination).startsWith('..'))throw new Error('Use a separate existing Site checkout');
const manifest=JSON.parse(await readFile(join(destination,'.openai/hosting.json'),'utf8'));
if(!manifest.project_id||manifest.r2!=='BUCKET'||manifest.static)throw new Error('Expected the existing Worker Site manifest and BUCKET binding');
await stat(join(destination,'.git'));
const tracked=cwd=>execFileSync('git',['ls-files','-z'],{cwd,encoding:'utf8'}).split('\0').filter(Boolean);
const files=tracked(root).filter(path=>!path.startsWith('.openai/'));
if(!files.includes('hosting/worker.mjs')||!files.includes('site/desk.mjs'))throw new Error('Stage the complete merged source before synchronizing');
const forbidden=/^(?:data|state|qa|\.dashboard-state|node_modules|dist)\/|(?:^|\/)\.env(?:\.|$)|\.(?:pem|key)$/;
if(files.some(path=>forbidden.test(path)))throw new Error('Private/runtime files must not enter the source bundle');
const changed=[];
for(const file of files){
  const source=await readFile(join(root,file));let target=null;
  try{target=await readFile(join(destination,file));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(!target||!source.equals(target)){
    changed.push(file);
    if(!check){await mkdir(dirname(join(destination,file)),{recursive:true});await writeFile(join(destination,file),source);}
  }
}
const sourceSet=new Set(files);
const obsolete=tracked(destination).filter(path=>!path.startsWith('.openai/')&&!sourceSet.has(path)&&!forbidden.test(path));
if(!check)for(const file of obsolete){try{await unlink(join(destination,file));}catch(error){if(error.code!=='ENOENT')throw error;}}
const digest=createHash('sha256');
for(const file of files.sort()){digest.update(file+'\0');digest.update(await readFile(join(root,file)));}
console.log(JSON.stringify({mode:check?'check':'sync',files:files.length,changed:changed.length,obsolete:obsolete.length,source_sha256:digest.digest('hex'),site_identity_preserved:true,private_runtime_untouched:true}));
if(check&&(changed.length||obsolete.length))process.exitCode=1;
