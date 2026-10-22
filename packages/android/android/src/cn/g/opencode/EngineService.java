package cn.g.opencode;
import android.app.*;
import android.content.*;
import android.os.*;
import org.json.JSONObject;
import java.io.*;
import java.lang.Process;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.zip.*;

public final class EngineService extends Service {
    static volatile String ready="",error="",phase="正在准备本地引擎…";
    private final ExecutorService worker=Executors.newSingleThreadExecutor(),deviceReplies=Executors.newSingleThreadExecutor();private volatile Process process;private volatile boolean destroyed;
    private static final int NOTIFICATION=41;private Notification.Builder notice;
    @Override public void onCreate(){super.onCreate();NotificationManager manager=(NotificationManager)getSystemService(NOTIFICATION_SERVICE);manager.createNotificationChannel(new NotificationChannel("engine","本地 OpenCode 引擎",NotificationManager.IMPORTANCE_LOW));
        Intent halt=new Intent(this,EngineService.class).setAction("stop-phone");PendingIntent stop=PendingIntent.getService(this,1,halt,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        Intent open=new Intent(this,MainActivity.class);PendingIntent pending=PendingIntent.getActivity(this,0,open,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        notice=new Notification.Builder(this,"engine").setSmallIcon(R.drawable.icon).setContentTitle("G code").setContentText("本地引擎正在运行").setContentIntent(pending).addAction(R.drawable.icon,"停止手机控制",stop).setOngoing(true);startForeground(NOTIFICATION,notice.build());
    }
    @Override public int onStartCommand(Intent intent,int flags,int startId){
        if(intent!=null&&"stop-phone".equals(intent.getAction())){PhoneControlService.stopAll("你已从通知停止手机控制");return START_NOT_STICKY;}
        if(intent!=null&&"reload".equals(intent.getAction())){PhoneControlService.stopAll("引擎正在重启");ready="";error="";phase="正在应用 API 设置…";Process old=process;if(old!=null)old.destroy();worker.execute(()->start(true));}
        else if(process==null&&ready.isEmpty()&&error.isEmpty())worker.execute(()->start(false));
        return START_NOT_STICKY;
    }
    private void start(boolean reload){
        try{
            if(destroyed)return;Process old=process;if(old!=null&&old.isAlive()){if(!reload)return;if(!old.waitFor(8,TimeUnit.SECONDS)){old.destroyForcibly();old.waitFor(2,TimeUnit.SECONDS);}}
            ready="";error="";install();if(destroyed)return;phase="正在启动 OpenCode 2.0.32…";
            File mobile=new File(getFilesDir(),"mobile");mobile.mkdirs();new File(mobile,"tmp").mkdirs();File engine=new File(getFilesDir(),"engine");
            JSONObject settings=Settings.read(this,true);
            byte[] random=new byte[32];new SecureRandom().nextBytes(random);StringBuilder token=new StringBuilder();for(byte b:random)token.append(String.format(Locale.ROOT,"%02x",b&255));
            String deviceToken=UUID.randomUUID().toString()+UUID.randomUUID().toString();
            ProcessBuilder builder=new ProcessBuilder(new File(getApplicationInfo().nativeLibraryDir,"libnode-runtime.so").getPath(),"--no-warnings",new File(engine,"src/server.mjs").getPath());
            builder.directory(mobile);builder.redirectErrorStream(true);Map<String,String> env=builder.environment();env.clear();env.put("PATH","/system/bin");env.put("HOME",mobile.getPath());env.put("TMPDIR",new File(mobile,"tmp").getPath());env.put("SHELL","/system/bin/sh");env.put("LD_LIBRARY_PATH",getApplicationInfo().nativeLibraryDir);env.put("OPENSSL_CONF","/dev/null");env.put("LANG","zh_CN.UTF-8");env.put("OPENCODE_DEVICE_TOKEN",deviceToken);env.put("OPENCODE_MOBILE_ROOT",mobile.getPath());env.put("OPENCODE_MOBILE_TOKEN",token.toString());env.put("OPENCODE_MOBILE_SETTINGS",settings.toString());
            Process child=builder.start();process=child;StringBuilder tail=new StringBuilder();
            new Thread(()->{
                try(BufferedReader reader=new BufferedReader(new InputStreamReader(child.getInputStream(),StandardCharsets.UTF_8))){String line;while((line=reader.readLine())!=null){
                    if(process!=child||destroyed)break;
                    if(line.startsWith("MOBILE_TASK ")){try{JSONObject task=new JSONObject(line.substring(12));if(deviceToken.equals(task.optString("token"))){String label=task.optString("label").substring(0,Math.min(70,task.optString("label").length()));PhoneControlService.updateTask(task.optString("sessionID"),label);new Handler(Looper.getMainLooper()).post(()->{if(process==child&&!destroyed)((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).notify(NOTIFICATION,notice.setContentText(label+" · 点击查看").build());});}}catch(Exception ignored){}continue;}
                    if(line.startsWith("MOBILE_DEVICE ")){
                        try{JSONObject request=new JSONObject(line.substring(14));if(deviceToken.equals(request.optString("token")))new Handler(Looper.getMainLooper()).post(()->{
                            if(process!=child||destroyed)return;
                            PhoneControlService.Reply reply=(data,failure)->{
                                if(process!=child||destroyed)return;
                                JSONObject response=new JSONObject();try{response.put("token",deviceToken).put("id",request.getString("id"));if(failure!=null){String message=failure.getMessage()==null?"手机操作失败":failure.getMessage();JSONObject control=PhoneControlService.status();response.put("error",message).put("control",control).put("code",!control.optBoolean("active")?"AUTH_REQUIRED":message.contains("超时")?"REQUEST_TIMEOUT":"OPERATION_FAILED");}else response.put("data",data);}catch(Exception ignored){return;}
                                try{deviceReplies.execute(()->{if(process!=child||destroyed)return;try{synchronized(child){child.getOutputStream().write((response.toString()+"\n").getBytes(StandardCharsets.UTF_8));child.getOutputStream().flush();}}catch(Exception ignored){}});}catch(RejectedExecutionException ignored){}
                            };
                            PhoneControlService service=PhoneControlService.instance;if(service==null)reply.done(null,new IllegalStateException("请先在侧栏手机控制中启用无障碍服务"));else service.execute(request,reply);
                        });}catch(Exception ignored){}continue;
                    }
                    if(line.startsWith("MOBILE_READY ")){JSONObject data=new JSONObject(line.substring(13));error="";ready="http://127.0.0.1:"+data.getInt("port")+data.getString("path");phase="本地引擎已就绪";continue;}
                    String clean=Settings.redact(settings,line);tail.append(clean).append('\n');if(tail.length()>4000)tail.delete(0,tail.length()-4000);
                }child.waitFor();if(process==child&&!destroyed){PhoneControlService.stopAll("本地引擎已停止");ready="";error="本地引擎已停止（"+child.exitValue()+"）\n"+tail;}}
                catch(Exception e){if(process==child&&!destroyed){PhoneControlService.stopAll("引擎连接已中断");ready="";error="引擎连接失败："+e.getClass().getSimpleName();}}
            },"opencode-output").start();
        }catch(Exception e){ready="";error="引擎启动失败："+(e.getMessage()==null?e.getClass().getSimpleName():e.getMessage());}
    }
    private void install()throws Exception{
        File engine=new File(getFilesDir(),"engine"),marker=new File(engine,"bundle.sha256");String expected;
        try(InputStream in=getAssets().open("engine.sha256")){expected=new String(readAll(in),StandardCharsets.US_ASCII).trim();}
        if(marker.isFile()){String current=new String(java.nio.file.Files.readAllBytes(marker.toPath()),StandardCharsets.US_ASCII).trim();if(current.equals(expected))return;}
        phase="首次启动，正在解压引擎与依赖…";File staging=new File(getFilesDir(),"engine-staging");ProjectFiles.remove(staging);if(!staging.mkdirs())throw new IOException("无法准备引擎目录");
        try(InputStream raw=getAssets().open("engine.zip");java.security.DigestInputStream digest=new java.security.DigestInputStream(raw,MessageDigest.getInstance("SHA-256"));ZipInputStream zip=new ZipInputStream(digest)){
            ZipEntry entry;byte[] bytes=new byte[65536];String base=staging.getCanonicalPath()+File.separator;
            while((entry=zip.getNextEntry())!=null){File file=new File(staging,entry.getName());if(!file.getCanonicalPath().startsWith(base))throw new IOException("引擎包路径无效");if(entry.isDirectory()){file.mkdirs();continue;}file.getParentFile().mkdirs();try(OutputStream out=new FileOutputStream(file)){int n;while((n=zip.read(bytes))!=-1)out.write(bytes,0,n);}}
            while(digest.read(bytes)!=-1){}StringBuilder hash=new StringBuilder();for(byte b:digest.getMessageDigest().digest())hash.append(String.format(Locale.ROOT,"%02x",b&255));if(!hash.toString().equals(expected))throw new IOException("引擎资源校验失败");
        }catch(Exception e){ProjectFiles.remove(staging);throw e;}
        java.nio.file.Files.write(new File(staging,"bundle.sha256").toPath(),expected.getBytes(StandardCharsets.US_ASCII));ProjectFiles.remove(engine);if(!staging.renameTo(engine))throw new IOException("引擎安装失败");
    }
    private static byte[] readAll(InputStream in)throws IOException{ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] bytes=new byte[1024];int n;while((n=in.read(bytes))!=-1)out.write(bytes,0,n);return out.toByteArray();}
    @Override public IBinder onBind(Intent intent){return null;}
    @Override public void onTaskRemoved(Intent intent){stopSelf();}
    public void onTimeout(int startId,int type){stopSelf();}
    @Override public void onDestroy(){PhoneControlService.stopAll("本地引擎已关闭");destroyed=true;ready="";Process old=process;process=null;if(old!=null){old.destroy();new Thread(()->{try{if(!old.waitFor(3,TimeUnit.SECONDS))old.destroyForcibly();}catch(InterruptedException ignored){old.destroyForcibly();}}).start();}worker.shutdownNow();deviceReplies.shutdownNow();super.onDestroy();}
}
