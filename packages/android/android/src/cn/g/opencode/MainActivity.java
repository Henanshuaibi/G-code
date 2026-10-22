package cn.g.opencode;
import android.app.*;
import android.content.*;
import android.graphics.Color;
import android.net.Uri;
import android.os.*;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import org.json.JSONObject;
import org.json.JSONArray;
import java.io.*;
import java.util.concurrent.*;

public final class MainActivity extends Activity {
    private final Handler main=new Handler(Looper.getMainLooper());private final ExecutorService files=Executors.newSingleThreadExecutor();
    private WebView web;private LinearLayout root;private TextView status;private String loaded="",pickerScope="",saveAsset="";private volatile boolean destroyed;
    private final Runnable poll=new Runnable(){public void run(){if(destroyed)return;String url=EngineService.ready;if(!url.isEmpty()){if(!url.equals(loaded)){loaded=url;web.setVisibility(View.VISIBLE);status.setVisibility(View.GONE);web.loadUrl(url);}}
        else{web.setVisibility(View.GONE);status.setVisibility(View.VISIBLE);status.setText(EngineService.error.isEmpty()?EngineService.phase:"G code\n\n"+EngineService.error+"\n\n点击这里重试");}main.postDelayed(this,500);}};
    @Override public void onCreate(Bundle state){super.onCreate(state);if(state!=null){pickerScope=state.getString("pickerScope","");saveAsset=state.getString("saveAsset","");}UiAppearance appearance=UiAppearance.read(this);
        root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setBackgroundColor(appearance.background);status=new TextView(this);status.setTextColor(appearance.foreground);status.setTextSize(appearance.fontSize);status.setPadding(30,50,30,30);status.setText("G code\n\n正在准备本地引擎…");status.setOnClickListener(v->{if(!EngineService.error.isEmpty()){startForegroundService(new Intent(this,EngineService.class).setAction("reload"));}});root.addView(status,new LinearLayout.LayoutParams(-1,-1));
        web=new WebView(this);web.setVisibility(View.GONE);web.setBackgroundColor(appearance.background);WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);settings.setMediaPlaybackRequiresUserGesture(true);settings.setBuiltInZoomControls(false);settings.setSupportMultipleWindows(false);settings.setTextZoom(100);
        web.addJavascriptInterface(new Bridge(),"Mobile");web.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){String url=request.getUrl().toString();return !url.startsWith(loaded);}
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){String url=request.getUrl().toString();if(!loaded.isEmpty()&&url.startsWith(loaded))return null;return new WebResourceResponse("text/plain","UTF-8",new ByteArrayInputStream(new byte[0]));}
        });root.addView(web,new LinearLayout.LayoutParams(-1,-1));root.setOnApplyWindowInsetsListener((v,insets)->{root.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());return insets.consumeSystemWindowInsets();});setContentView(root);applyWindowTheme(appearance.background,appearance.foreground);root.requestApplyInsets();startForegroundService(new Intent(this,EngineService.class));
    }
    @Override protected void onResume(){super.onResume();main.removeCallbacks(poll);main.post(poll);web.evaluateJavascript("window.mobileAppearanceRefresh&&window.mobileAppearanceRefresh()",null);}
    @Override protected void onPause(){main.removeCallbacks(poll);super.onPause();}
    @Override protected void onSaveInstanceState(Bundle state){state.putString("pickerScope",pickerScope);state.putString("saveAsset",saveAsset);super.onSaveInstanceState(state);}
    @Override protected void onDestroy(){destroyed=true;main.removeCallbacks(poll);web.removeJavascriptInterface("Mobile");web.destroy();files.shutdown();super.onDestroy();}
    @Override public void onBackPressed(){if(!web.isShown()){super.onBackPressed();return;}web.evaluateJavascript("window.mobileBack?window.mobileBack():false",result->{if(!"true".equals(result)&&!destroyed)finish();});}
    private void applyWindowTheme(int background,int foreground){
        getWindow().setStatusBarColor(background);getWindow().setNavigationBarColor(background);getWindow().setStatusBarContrastEnforced(false);getWindow().setNavigationBarContrastEnforced(false);
        int flags=getWindow().getDecorView().getSystemUiVisibility();int light=View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR|View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;getWindow().getDecorView().setSystemUiVisibility(UiAppearance.light(background)?flags|light:flags&~light);
        root.setBackgroundColor(background);web.setBackgroundColor(background);status.setTextColor(foreground);status.setTextSize(UiAppearance.read(this).fontSize);PhoneControlService.theme(background,foreground);
    }
    private void updateAttachments(){main.post(()->{if(!destroyed)web.evaluateJavascript("window.mobileAttachments&&window.mobileAttachments()",null);});}
    private void notice(String message){main.post(()->{if(!destroyed)web.evaluateJavascript("window.mobileNotice&&window.mobileNotice("+JSONObject.quote(message)+")",null);});}
    private String controlCall(java.util.concurrent.Callable<String> call){
        FutureTask<String> result=new FutureTask<>(call);main.post(result);try{return result.get(5,TimeUnit.SECONDS);}catch(Exception e){result.cancel(false);return "手机控制面板暂不可用，请重试";}
    }
    private final class Bridge {
        @JavascriptInterface public String openChatGPT(String value){
            try{android.net.Uri uri=android.net.Uri.parse(value);if(!"https".equals(uri.getScheme())||!"auth.openai.com".equals(uri.getHost())||uri.getPort()!=-1||uri.getUserInfo()!=null||!"/api/accounts/authorize".equals(uri.getPath()))return "仅支持 OpenAI 官方授权地址";
                main.post(()->{try{startActivity(new Intent(Intent.ACTION_VIEW,uri).addCategory(Intent.CATEGORY_BROWSABLE));}catch(Exception e){notice("无法打开系统浏览器，请安装或启用浏览器后重试");}});return "";
            }catch(Exception e){return "授权地址无效";}
        }
        @JavascriptInterface public boolean systemDark(){return (getResources().getConfiguration().uiMode&android.content.res.Configuration.UI_MODE_NIGHT_MASK)==android.content.res.Configuration.UI_MODE_NIGHT_YES;}
        @JavascriptInterface public void themeWindow(String background,String foreground){try{int bg=UiAppearance.color(background),fg=UiAppearance.color(foreground);main.post(()->{if(!destroyed)applyWindowTheme(bg,fg);});}catch(Exception ignored){}}
        @JavascriptInterface public String phoneStatus(){return controlCall(()->PhoneControlService.status().toString());}
        @JavascriptInterface public void phoneSettings(){main.post(()->{try{startActivity(new Intent(android.provider.Settings.ACTION_ACCESSIBILITY_SETTINGS));}catch(Exception e){notice("请到系统设置中打开 G code 手机控制无障碍服务");}});}
        @JavascriptInterface public String phoneGrant(String session,String app){return controlCall(()->{try{PhoneControlService service=PhoneControlService.instance;if(service==null)return "请先启用 G code 手机控制无障碍服务";service.grant(session,app);return "";}catch(Exception e){return e.getMessage()==null?"无法开启手机控制":e.getMessage();}});}
        @JavascriptInterface public void restartEngine(){PhoneControlService.stopAll("你已重启本地引擎");main.post(()->startForegroundService(new Intent(MainActivity.this,EngineService.class).setAction("reload")));}
        @JavascriptInterface public void phoneStop(){PhoneControlService.stopAll("你已停止手机控制");}

        @JavascriptInterface public String storageGet(String key){return getSharedPreferences("ui",0).getString(key,"");}
        @JavascriptInterface public void storageSet(String key,String value){if(key.length()>160||value.length()>100000)return;getSharedPreferences("ui",0).edit().putString(key,value).apply();}
        @JavascriptInterface public String settings(){try{return Settings.read(MainActivity.this,false).toString();}catch(Exception e){return "{}";}}
        @JavascriptInterface public String saveSettings(String json){try{Settings.save(MainActivity.this,json);main.post(()->{if(!destroyed)startForegroundService(new Intent(MainActivity.this,EngineService.class).setAction("reload"));});return "";}catch(Exception e){return e.getMessage()==null?"配置保存失败":e.getMessage();}}
        @JavascriptInterface public String attachmentStatus(String scope){if(scope.length()>200)return "{}";return AttachmentFiles.status(MainActivity.this,scope);}
        @JavascriptInterface public void pickAttachments(String kind,String scope){main.post(()->{try{if(scope.length()>200)throw new IOException();pickerScope=scope;Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType("image".equals(kind)?"image/*":"video".equals(kind)?"video/*":"*/*");intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,true);startActivityForResult(intent,203);}catch(Exception e){notice("无法打开文件选择器");}});}
        @JavascriptInterface public void saveMedia(String filename){main.post(()->{try{if(!filename.matches("[a-f0-9-]{36}\\.(png|jpg|webp|gif|mp4)"))throw new IOException();File asset=new File(getFilesDir(),"mobile/media/assets/"+filename);if(!asset.isFile())throw new IOException();saveAsset=filename;Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType(filename.endsWith(".mp4")?"video/mp4":filename.endsWith(".jpg")?"image/jpeg":"image/"+filename.substring(filename.lastIndexOf('.')+1));intent.putExtra(Intent.EXTRA_TITLE,"G-code-"+filename);startActivityForResult(intent,204);}catch(Exception e){notice("生成文件尚未准备好");}});}

    }
    @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(result!=RESULT_OK||data==null)return;final ContentResolver resolver=getContentResolver();
        if(request==203){
            final String scope=pickerScope;java.util.ArrayList<Uri> uris=new java.util.ArrayList<>();if(data.getClipData()!=null){for(int i=0;i<Math.min(8,data.getClipData().getItemCount());i++)uris.add(data.getClipData().getItemAt(i).getUri());}else if(data.getData()!=null)uris.add(data.getData());
            if(uris.isEmpty()){notice("没有取得所选文件，请重新选择");return;}if(!AttachmentFiles.activeScopes.add(scope)){notice("附件仍在处理中，请稍候");return;}
            if((data.getFlags()&Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)!=0)for(Uri uri:uris)try{resolver.takePersistableUriPermission(uri,data.getFlags()&(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION));}catch(Exception ignored){}
            AttachmentFiles.progress(this,scope,true,"正在读取所选照片或视频…",false);updateAttachments();
            files.execute(()->{
                StringBuilder errors=new StringBuilder();int added=0;
                try{android.content.SharedPreferences prefs=getSharedPreferences("ui",0);
                    for(Uri uri:uris){JSONArray items=new JSONArray(prefs.getString("attachments:"+scope,"[]"));if(items.length()>=8){errors.append("每条消息最多 8 个附件");break;}
                        try{JSONObject item=AttachmentFiles.copy(MainActivity.this,uri,message->{AttachmentFiles.progress(MainActivity.this,scope,true,message,false);updateAttachments();});items=new JSONArray(prefs.getString("attachments:"+scope,"[]"));items.put(item);prefs.edit().putString("attachments:"+scope,items.toString()).commit();added++;updateAttachments();}
                        catch(Exception e){if(errors.length()>0)errors.append("\n");errors.append(e.getMessage()==null?"部分附件无法读取":e.getMessage());}
                    }
                }catch(Exception e){errors.append("附件处理失败：").append(e.getMessage()==null?e.getClass().getSimpleName():e.getMessage());}
                finally{String message=(added>0?"已添加 "+added+" 个附件；发送后才会提交给 AI。":"")+(errors.length()>0?"\n"+errors:"");AttachmentFiles.progress(MainActivity.this,scope,false,message,errors.length()>0);AttachmentFiles.activeScopes.remove(scope);for(Uri uri:uris)try{resolver.releasePersistableUriPermission(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION);}catch(Exception ignored){}updateAttachments();}
            });
        }
        if(request==204&&data.getData()!=null){final String name=saveAsset;final Uri target=data.getData();files.execute(()->{try(InputStream input=new FileInputStream(new File(getFilesDir(),"mobile/media/assets/"+name));OutputStream output=resolver.openOutputStream(target)){if(output==null)throw new IOException("无法写入所选位置");byte[] buffer=new byte[32768];int count;while((count=input.read(buffer))!=-1)output.write(buffer,0,count);notice("生成文件已保存");}catch(Exception e){notice("保存失败："+e.getMessage());}});}
    }
}
