import {registerHooks} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(process.env.OPENCODE_ALLOWED_MODULE_ROOT)+path.sep;
registerHooks({resolve(specifier,context,nextResolve){const result=nextResolve(specifier,context);if(result.url.startsWith('file:')&&!fileURLToPath(result.url).startsWith(root))throw new Error('Unpackaged runtime dependency: '+result.url);return result;}});
