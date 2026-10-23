package cn.g.opencode;
import android.content.Context;
import android.content.ContentResolver;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Matrix;
import android.media.ExifInterface;
import android.media.MediaMetadataRetriever;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Locale;
import java.util.UUID;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

final class AttachmentFiles {
    static final Set<String> activeScopes=ConcurrentHashMap.newKeySet();
    interface Progress {void update(String message);}
    static void progress(Context context,String scope,boolean loading,String message,boolean error){try{context.getSharedPreferences("ui",0).edit().putString("attachment-job:"+scope,new JSONObject().put("loading",loading).put("message",message).put("error",error).toString()).apply();}catch(Exception ignored){}}
    static String status(Context context,String scope){String value=context.getSharedPreferences("ui",0).getString("attachment-job:"+scope,"{}");try{JSONObject job=new JSONObject(value);if(job.optBoolean("loading")&&!activeScopes.contains(scope)){progress(context,scope,false,"上次附件处理已中断，请重新选择",true);return context.getSharedPreferences("ui",0).getString("attachment-job:"+scope,"{}");}}catch(Exception ignored){}return value;}
    static JSONObject copy(Context context,Uri uri,Progress progress)throws Exception{
        ContentResolver resolver=context.getContentResolver();String name="附件";
        try(Cursor cursor=resolver.query(uri,new String[]{OpenableColumns.DISPLAY_NAME},null,null,null)){if(cursor!=null&&cursor.moveToFirst())name=cursor.getString(0);}catch(Exception ignored){}
        if(name==null||name.isEmpty())name="附件";name=name.replaceAll("[\\x00-\\x1f/\\\\]","_");if(name.length()>160)name=name.substring(0,160);
        String mime="";try{mime=resolver.getType(uri);}catch(Exception ignored){}if(mime==null)mime="";String lower=name.toLowerCase(Locale.ROOT);
        File directory=new File(context.getFilesDir(),"mobile/uploads");if(!directory.isDirectory()&&!directory.mkdirs())throw new IOException("无法准备附件目录");String id=UUID.randomUUID().toString();File target=new File(directory,id+".data"),metadata=new File(directory,id+".json"),frames=new File(directory,id+".frames"),source=new File(directory,id+".source");
        try{
            JSONObject info=new JSONObject().put("id",id).put("name",name).put("mime",mime);
            if(mime.startsWith("video/")||lower.matches(".*\\.(mp4|mov|m4v|mkv|webm|3gp|avi)$"))video(resolver,uri,source,target,frames,info,progress);
            else if((mime.startsWith("image/")&&!mime.equals("image/svg+xml"))||lower.matches(".*\\.(jpe?g|png|gif|webp|heic|heif|avif|bmp)$"))photo(resolver,uri,target,info,progress);
            else{progress.update("正在复制 "+name);copyBytes(resolver,uri,target,10*1048576L);info.put("size",target.length());}
            Files.write(metadata.toPath(),info.toString().getBytes(StandardCharsets.UTF_8));return info;
        }catch(OutOfMemoryError e){target.delete();new File(directory,id+".thumb").delete();metadata.delete();ProjectFiles.remove(frames);throw new IOException("照片或视频解码占用过大，请选择较小的文件");}
        catch(Exception e){target.delete();new File(directory,id+".thumb").delete();metadata.delete();ProjectFiles.remove(frames);throw new IOException(name+"："+(e instanceof SecurityException?"读取授权已失效，请重新选择":e.getMessage()==null?"系统无法读取此文件":e.getMessage()),e);}
        finally{source.delete();}
    }
    private static void copyBytes(ContentResolver resolver,Uri uri,File target,long max)throws Exception{
        try(InputStream input=resolver.openInputStream(uri);OutputStream output=new FileOutputStream(target)){
            if(input==null)throw new IOException("无法读取所选文件，请重新选择或先下载到本机");byte[] buffer=new byte[32768];long size=0;int count;while((count=input.read(buffer))!=-1){size+=count;if(size>max)throw new IOException(max>10*1048576?"视频原文件最多 100 MB":"单个普通文件最多 10 MB");output.write(buffer,0,count);}if(size==0)throw new IOException("所选文件为空，或云端文件尚未下载完成");
        }
    }
    private static void photo(ContentResolver resolver,Uri uri,File target,JSONObject info,Progress progress)throws Exception{
        progress.update("正在缩放并转换照片："+info.optString("name"));BitmapFactory.Options options=new BitmapFactory.Options();options.inJustDecodeBounds=true;
        try(InputStream input=resolver.openInputStream(uri)){if(input==null)throw new IOException("无法读取照片");BitmapFactory.decodeStream(input,null,options);}
        if(options.outWidth<=0||options.outHeight<=0)throw new IOException("系统无法解码这张照片，请先转成 JPEG 或 PNG；可能是未下载完成或不支持的格式");
        if((long)options.outWidth*options.outHeight>220000000L)throw new IOException("照片尺寸过大，请先缩小后重试");
        int sample=1;while(Math.max(options.outWidth,options.outHeight)/sample>2048)sample*=2;options.inJustDecodeBounds=false;options.inSampleSize=sample;options.inPreferredConfig=Bitmap.Config.ARGB_8888;
        int orientation=1;try(InputStream input=resolver.openInputStream(uri)){if(input!=null)orientation=new ExifInterface(input).getAttributeInt(ExifInterface.TAG_ORIENTATION,1);}catch(Exception ignored){}
        Bitmap bitmap=null;try{
            try(InputStream input=resolver.openInputStream(uri)){if(input!=null)bitmap=BitmapFactory.decodeStream(input,null,options);}if(bitmap==null)throw new IOException("照片解码失败，请换成 JPEG 或 PNG 后重试");
            Matrix matrix=new Matrix();switch(orientation){case 2:matrix.setScale(-1,1);break;case 3:matrix.setRotate(180);break;case 4:matrix.setScale(1,-1);break;case 5:matrix.setRotate(90);matrix.postScale(-1,1);break;case 6:matrix.setRotate(90);break;case 7:matrix.setRotate(-90);matrix.postScale(-1,1);break;case 8:matrix.setRotate(-90);break;default:break;}
            if(!matrix.isIdentity()){Bitmap rotated=Bitmap.createBitmap(bitmap,0,0,bitmap.getWidth(),bitmap.getHeight(),matrix,true);if(rotated!=bitmap){bitmap.recycle();bitmap=rotated;}}
            boolean alpha=bitmap.hasAlpha()&&"image/png".equals(options.outMimeType);String format=alpha?"image/png":"image/jpeg";writeBitmap(bitmap,target,alpha);writeThumbnail(bitmap,new File(target.getParentFile(),target.getName().replace(".data",".thumb")));
            if(target.length()>10*1048576L){writeBitmap(bitmap,target,false);format="image/jpeg";}
            if(target.length()>10*1048576L)throw new IOException("处理后的照片仍过大，请先裁剪后重试");
            String original=info.optString("name"),base=original.replaceFirst("(?i)\\.[a-z0-9]{1,8}$","");String note="已在本机缩放为 "+bitmap.getWidth()+"×"+bitmap.getHeight()+(format.endsWith("png")?" PNG":" JPEG");if("image/gif".equals(options.outMimeType))note+="；动画仅取首帧";
            info.put("originalName",original).put("name",base+(format.endsWith("png")?".png":".jpg")).put("mime",format).put("kind","image").put("size",target.length()).put("note",note);
        }finally{if(bitmap!=null)bitmap.recycle();}
    }
    private static void writeThumbnail(Bitmap bitmap,File target)throws Exception{
        double ratio=Math.min(1d,512d/Math.max(bitmap.getWidth(),bitmap.getHeight()));Bitmap small=Bitmap.createScaledBitmap(bitmap,Math.max(1,(int)Math.round(bitmap.getWidth()*ratio)),Math.max(1,(int)Math.round(bitmap.getHeight()*ratio)),true);
        try{writeBitmap(small,target,false);}finally{if(small!=bitmap)small.recycle();}
    }
    private static void writeBitmap(Bitmap bitmap,File file,boolean png)throws Exception{
        Bitmap flattened=null;try{Bitmap output=bitmap;if(!png&&bitmap.hasAlpha()){flattened=Bitmap.createBitmap(bitmap.getWidth(),bitmap.getHeight(),Bitmap.Config.ARGB_8888);Canvas canvas=new Canvas(flattened);canvas.drawColor(Color.WHITE);canvas.drawBitmap(bitmap,0,0,null);output=flattened;}try(OutputStream out=new FileOutputStream(file)){if(!output.compress(png?Bitmap.CompressFormat.PNG:Bitmap.CompressFormat.JPEG,82,out))throw new IOException("图片编码失败");}}finally{if(flattened!=null)flattened.recycle();}
    }
    private static void video(ContentResolver resolver,Uri uri,File source,File target,File frames,JSONObject info,Progress progress)throws Exception{
        progress.update("正在读取视频（最多 100 MB）："+info.optString("name"));copyBytes(resolver,uri,source,100*1048576L);MediaMetadataRetriever retriever=new MediaMetadataRetriever();
        try{
            retriever.setDataSource(source.getPath());long duration;try{duration=Long.parseLong(retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION));}catch(Exception e){throw new IOException("无法读取视频时长，请选择已下载到本机的普通视频");}if(duration<=0)throw new IOException("视频时长无效");
            if(!frames.mkdirs())throw new IOException("无法准备视频抽帧目录");int count=(int)Math.min(8,Math.max(1,Math.ceil(duration/3000d)));JSONArray items=new JSONArray();long size=0;
            for(int i=0;i<count;i++){
                long time=count==1?0:Math.round(i*(Math.max(0,duration-100d))/(count-1));progress.update("视频抽帧 "+(i+1)+"/"+count+"（不含音频）");Bitmap frame=null;
                try{try{frame=retriever.getScaledFrameAtTime(time*1000,MediaMetadataRetriever.OPTION_CLOSEST,1280,1280);}catch(RuntimeException ignored){}if(frame==null)frame=retriever.getScaledFrameAtTime(time*1000,MediaMetadataRetriever.OPTION_CLOSEST_SYNC,1280,1280);if(frame==null)continue;File image=new File(frames,i+".jpg");writeBitmap(frame,image,false);if(image.length()>10*1048576L)throw new IOException("视频帧过大");size+=image.length();if(size>20*1048576L)throw new IOException("视频抽帧结果过大，请选较短的视频");items.put(new JSONObject().put("file",image.getName()).put("timeMs",time));if(items.length()==1){Files.copy(image.toPath(),target.toPath());writeThumbnail(frame,new File(target.getParentFile(),target.getName().replace(".data",".thumb")));}}
                finally{if(frame!=null)frame.recycle();}
            }
            if(items.length()==0)throw new IOException("系统无法从该视频读取画面，请转成 MP4 后重试");info.put("kind","video").put("mime","video/mp4").put("durationMs",duration).put("frames",items).put("size",size).put("sourceSize",source.length()).put("note","视频抽帧 · "+items.length()+" 张画面 · 不含音频");
        }finally{retriever.release();}
    }
}
