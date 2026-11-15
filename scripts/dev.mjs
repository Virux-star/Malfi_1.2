import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const children=[spawn(process.execPath,['--env-file-if-exists=Backend/.env','--watch','Backend/server.js'],{cwd:root,stdio:'inherit'}),spawn(process.execPath,['node_modules/vite/bin/vite.js'],{cwd:root+'Frontend',stdio:'inherit'})];
let stopping=false;
function stop(){if(stopping)return;stopping=true;for(const c of children)c.kill('SIGTERM');}
for(const c of children)c.on('exit',code=>{stop();process.exitCode=code||0;});
process.on('SIGINT',stop);process.on('SIGTERM',stop);
