// Android process adapter. Command streams are supported; interactive TTY resize is not.
const {spawn}=require('node:child_process');
exports.spawn=(file,args,opts)=>{
  const child=spawn(file,args,{cwd:opts.cwd,env:opts.env,stdio:['pipe','pipe','pipe']});
  const listeners=new Set(),exits=new Set();
  child.stdout.on('data',data=>listeners.forEach(fn=>fn(data.toString())));
  child.stderr.on('data',data=>listeners.forEach(fn=>fn(data.toString())));
  child.on('exit',(exitCode,signal)=>exits.forEach(fn=>fn({exitCode:exitCode??1,signal})));
  child.on('error',error=>{listeners.forEach(fn=>fn(error.message));exits.forEach(fn=>fn({exitCode:1}));});
  return {pid:child.pid,onData(fn){listeners.add(fn);return {dispose(){listeners.delete(fn);}}},onExit(fn){exits.add(fn);return {dispose(){exits.delete(fn);}}},write(data){child.stdin.write(data);},resize(){},kill(signal){child.kill(signal);}};
};
