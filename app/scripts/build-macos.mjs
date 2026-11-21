import {existsSync,readFileSync,mkdirSync,copyFileSync,readdirSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const appRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
process.chdir(appRoot);
const publicBuild=process.argv.includes('--public');
const checkOnly=process.argv.includes('--check');
const base=JSON.parse(readFileSync('src-tauri/tauri.conf.json','utf8'));
const mac=JSON.parse(readFileSync('src-tauri/tauri.macos.conf.json','utf8'));
if(!mac.bundle.targets.includes('dmg'))throw new Error('macOS packaging is not configured');
for(const icon of mac.bundle.icon){if(!existsSync(join('src-tauri',icon)))throw new Error('Missing icon: '+icon);}
const resourcePaths=Array.isArray(base.bundle.resources)?base.bundle.resources:Object.keys(base.bundle.resources||{});
if(!publicBuild){for(const source of resourcePaths){if(!existsSync(resolve('src-tauri',source)))throw new Error('Missing local archive: '+source);}}
if(checkOnly){console.log(JSON.stringify({configuration:'ok',target:'universal-apple-darwin',containsFamilyData:!publicBuild&&resourcePaths.length>0,requiresMacOS:true},null,2));process.exit(0);}
if(process.platform!=='darwin')throw new Error('This build must run on macOS. It cannot create a Mac installer on Windows.');
function run(command,args){const r=spawnSync(command,args,{stdio:'inherit',env:process.env});if(r.error)throw r.error;if(r.status!==0)throw new Error(command+' exited with code '+r.status);}
run('xcode-select',['-p']);
run('rustup',['target','add','aarch64-apple-darwin','x86_64-apple-darwin']);
run('cargo',['test','--locked','-p','family-core']);
const args=['node_modules/@tauri-apps/cli/tauri.js','build','--ci','--target','universal-apple-darwin','--bundles','app,dmg'];
if(publicBuild)args.push('--config','src-tauri/tauri.ci.conf.json');
args.push('--','--locked');
run(process.execPath,args);
const bundle=resolve('target/universal-apple-darwin/release/bundle');
const application=join(bundle,'macos',base.productName+'.app');
const executable=spawnSync('/usr/libexec/PlistBuddy',['-c','Print :CFBundleExecutable',join(application,'Contents/Info.plist')],{encoding:'utf8'});
if(executable.status!==0||!executable.stdout.trim())throw new Error('Cannot read application executable from Info.plist');
const executablePath=join(application,'Contents/MacOS',executable.stdout.trim());
run('lipo',[executablePath,'-archs']);
run('lipo',[executablePath,'-verify_arch','arm64','x86_64']);
run('codesign',['--verify','--deep','--strict','--verbose=2',application]);
const output=resolve('../Mac-готово');mkdirSync(output,{recursive:true});
const dmgs=readdirSync(join(bundle,'dmg')).filter(n=>n.endsWith('.dmg'));
if(!dmgs.length)throw new Error('No DMG was produced');
for(const file of dmgs){run('hdiutil',['verify',join(bundle,'dmg',file)]);copyFileSync(join(bundle,'dmg',file),join(output,file));}
console.log('Готовый установщик: '+output);
