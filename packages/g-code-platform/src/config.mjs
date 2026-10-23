import path from 'node:path';
import {masterKey,integer,requireThat} from './primitives.mjs';
export function configuration(env=process.env){
 const production=env.GCODE_PRODUCTION!=='false',origin=new URL(env.GCODE_PUBLIC_ORIGIN??'http://127.0.0.1:8787');
 requireThat(!production||origin.protocol==='https:',500,'configuration','生产模式须配置 HTTPS 的 GCODE_PUBLIC_ORIGIN');
 requireThat(!production||env.GCODE_ALLOW_LOOPBACK_UPSTREAM!=='true',500,'configuration','生产模式不允许本机 HTTP 模拟上游');
 return {key:masterKey(env.GCODE_MASTER_KEY),db:path.resolve(env.GCODE_DB??'./data/platform.db'),host:env.GCODE_HOST??'127.0.0.1',port:integer(Number(env.GCODE_PORT??8787),'监听端口',0,65535),origin:origin.origin,production,allowLoopback:env.GCODE_ALLOW_LOOPBACK_UPSTREAM==='true',registration:env.GCODE_ALLOW_REGISTRATION!=='false',dailyCostLimit:integer(Number(env.GCODE_DAILY_COST_LIMIT_MICROS),'每日采购成本预算（微 CNY）',1),authConcurrency:integer(Number(env.GCODE_AUTH_CONCURRENCY??2),'密码哈希并发上限',1,4),userRpm:integer(Number(env.GCODE_USER_RPM??10),'默认用户 RPM',1,600),userConcurrency:integer(Number(env.GCODE_USER_CONCURRENCY??2),'默认用户并发',1,20),maxAttempts:integer(Number(env.GCODE_MAX_ATTEMPTS??3),'最大尝试次数',1,5),routeDeadline:integer(Number(env.GCODE_ROUTE_DEADLINE_MS??60000),'路由总时限',100,120000)};
}
