import {readFile} from 'node:fs/promises';
import {configuration} from './config.mjs';
import {Store} from './store.mjs';
import {hashPassword,requireThat} from './primitives.mjs';
process.umask(0o077);
const store=new Store(configuration());
try{
 if(process.argv[2]==='migrate')console.log('数据库迁移已完成');
 else if(process.argv[2]==='admin'){
  requireThat(!store.get("SELECT id FROM users WHERE role='admin'"),409,'admin_exists','管理员已存在；不能通过初始化命令覆盖账号');
  requireThat(process.env.GCODE_ADMIN_PASSWORD_FILE,400,'password_file','请设置 GCODE_ADMIN_PASSWORD_FILE，文件权限应为 600');
  const password=(await readFile(process.env.GCODE_ADMIN_PASSWORD_FILE,'utf8')).trimEnd();
  const hash=await hashPassword(password);
  const user=store.tx(()=>{requireThat(!store.get("SELECT id FROM users WHERE role='admin'"),409,'admin_exists','管理员已存在');return store.createUser(process.env.GCODE_ADMIN_USERNAME,hash,'admin');});
  console.log('管理员初始化完成：'+user.username+'。余额为零；自用调用也正常计费和记录采购成本。');
 }else throw new Error('用法：npm run migrate 或 npm run admin');
}finally{store.close();}
