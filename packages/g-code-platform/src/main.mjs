import {configuration} from './config.mjs';
import {createPlatform} from './server.mjs';
process.umask(0o077);
const app=await createPlatform(configuration(),entry=>process.stdout.write(JSON.stringify(entry)+'\n'));
console.log(JSON.stringify({event:'listening',address:app.url,notice:'Local trial build; configure verified mappings/prices before use'}));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await app.close();process.exit(0);});
