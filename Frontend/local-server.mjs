import {createServer} from './node_modules/vite/dist/node/index.js';
import react from './node_modules/@vitejs/plugin-react/dist/index.mjs';
process.chdir('R:/criscomgroup/Frontend');
const server=await createServer({root:'R:/criscomgroup/Frontend',configFile:false,base:'/erp/',plugins:[react()],resolve:{preserveSymlinks:true,alias:{'@zxing/library':'R:/erp-extra/node_modules/@zxing/library','@':'R:/criscomgroup/Frontend/src'}},server:{host:'127.0.0.1',port:5173,proxy:{'/api':'http://127.0.0.1:3100','/uploads':'http://127.0.0.1:3100'}}});
await server.listen();server.printUrls();

