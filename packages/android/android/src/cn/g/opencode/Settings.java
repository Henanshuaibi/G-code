package cn.g.opencode;
import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;

final class Settings {
    private static JSONObject secrets(SharedPreferences prefs)throws Exception{
        JSONObject keys=new JSONObject(prefs.getString("secrets","{}"));String legacy=prefs.getString("secret","");if(!keys.has("mobile")&&!legacy.isEmpty())keys.put("mobile",legacy);return keys;
    }
    static synchronized JSONObject read(Context context,boolean secret)throws Exception{
        SharedPreferences prefs=context.getSharedPreferences("api",0);JSONObject data=ApiProfiles.migrate(new JSONObject(prefs.getString("public","{}"))),keys=secrets(prefs);JSONArray providers=data.getJSONArray("providers");
        for(int i=0;i<providers.length();i++){JSONObject item=providers.getJSONObject(i);String encrypted=keys.optString(item.getString("id"));item.put("hasKey",!encrypted.isEmpty());if(secret)item.put("key",new SecureKey().open(encrypted));}
        return data;
    }
    static synchronized void save(Context context,String json)throws Exception{
        JSONObject input=new JSONObject(json),data=ApiProfiles.validate(input);SharedPreferences prefs=context.getSharedPreferences("api",0);JSONObject previous=secrets(prefs),keys=new JSONObject();JSONArray providers=data.getJSONArray("providers"),source=ApiProfiles.migrate(input).getJSONArray("providers");
        for(int i=0;i<providers.length();i++){String id=providers.getJSONObject(i).getString("id");JSONObject item=source.getJSONObject(i);String key=item.optString("key").trim();String encrypted=item.optBoolean("clearKey")?"":key.isEmpty()?previous.optString(id):new SecureKey().seal(key);if(!encrypted.isEmpty())keys.put(id,encrypted);}
        if(!prefs.edit().putString("public",data.toString()).putString("secrets",keys.toString()).remove("secret").commit())throw new java.io.IOException("配置保存失败");
    }
    static String redact(JSONObject settings,String value){
        JSONArray providers=settings.optJSONArray("providers");if(providers!=null)for(int i=0;i<providers.length();i++){String key=providers.optJSONObject(i).optString("key");if(!key.isEmpty())value=value.replace(key,"[API Key 已隐藏]");}return value;
    }
}
