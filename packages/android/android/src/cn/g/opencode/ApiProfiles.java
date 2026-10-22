package cn.g.opencode;
import org.json.JSONArray;
import org.json.JSONObject;
import java.net.URI;
import java.util.HashSet;
import java.util.Set;

/** Public schema migration and validation, shared by UI storage and engine startup. */
final class ApiProfiles {
    static JSONObject migrate(JSONObject raw)throws Exception{
        if(raw.has("providers"))return new JSONObject(raw.toString());
        JSONArray providers=new JSONArray();if(!raw.optString("base").isEmpty()&&!raw.optString("model").isEmpty())providers.put(new JSONObject().put("id","mobile").put("name",raw.optString("name","我的 API 服务")).put("base",raw.getString("base")).put("protocol",raw.optString("protocol","chat")).put("allowHttp",raw.optBoolean("allowHttp")).put("models",new JSONArray().put(raw.getString("model"))));
        return new JSONObject().put("version",2).put("providers",providers).put("defaultModel",providers.length()>0?new JSONObject().put("providerID","mobile").put("id",raw.getString("model")):JSONObject.NULL);
    }
    private static JSONArray cleanModels(JSONObject item,String field)throws Exception{
        JSONArray source=item.optJSONArray(field),clean=new JSONArray();Set<String> seen=new HashSet<>();if(source==null)return clean;if(source.length()>100)throw new IllegalArgumentException("每类最多填写 100 个模型 ID");
        for(int i=0;i<source.length();i++){String model=source.getString(i).trim();if(model.isEmpty()||model.length()>200||model.matches("(?s).*[\\x00-\\x1f].*"))throw new IllegalArgumentException("模型 ID 格式不正确");if(seen.add(model))clean.put(model);}return clean;
    }
    static JSONObject validate(JSONObject input)throws Exception{
        JSONArray source=migrate(input).getJSONArray("providers"),providers=new JSONArray();if(source.length()>30)throw new IllegalArgumentException("最多保存 30 个 API 服务");Set<String> ids=new HashSet<>();
        for(int i=0;i<source.length();i++){
            JSONObject item=source.getJSONObject(i);String id=item.optString("id"),name=item.optString("name").trim();
            if(!id.matches("[a-z][a-z0-9_-]{0,79}")||!ids.add(id))throw new IllegalArgumentException("API 服务标识不正确或重复");if(name.isEmpty()||name.length()>80)throw new IllegalArgumentException("服务名称请填写 1～80 个字符");
            String base=item.optString("base").trim();boolean http=item.optBoolean("allowHttp");URI uri=new URI(base);
            if(!"https".equalsIgnoreCase(uri.getScheme())&&!(http&&"http".equalsIgnoreCase(uri.getScheme())))throw new IllegalArgumentException("API 地址需使用 HTTPS；HTTP 需要明确允许");
            if(uri.getHost()==null||uri.getUserInfo()!=null||uri.getQuery()!=null||uri.getFragment()!=null)throw new IllegalArgumentException("请填写纯 API 地址，不包含账号或查询参数");
            while(base.endsWith("/"))base=base.substring(0,base.length()-1);for(String suffix:new String[]{"/chat/completions","/responses"})if(base.endsWith(suffix))base=base.substring(0,base.length()-suffix.length());if(new URI(base).getPath().isEmpty())base+="/v1";
            String protocol=item.optString("protocol","chat");if(!protocol.equals("chat")&&!protocol.equals("responses"))throw new IllegalArgumentException("请选择接口类型");
            JSONArray clean=cleanModels(item,"models"),images=cleanModels(item,"imageModels"),videos=cleanModels(item,"videoModels");if(clean.length()+images.length()+videos.length()==0)throw new IllegalArgumentException("至少填写一个对话、生图或视频模型 ID");
            String key=item.optString("key").trim();if(key.length()>8192||key.contains("\n")||key.contains("\r"))throw new IllegalArgumentException("API Key 格式不正确");
            providers.put(new JSONObject().put("id",id).put("name",name).put("base",base).put("protocol",protocol).put("allowHttp",http).put("models",clean).put("imageModels",images).put("videoModels",videos));
        }
        JSONObject selected=input.optJSONObject("defaultModel");boolean found=false;
        if(selected!=null)for(int i=0;i<providers.length();i++){JSONObject p=providers.getJSONObject(i);for(int j=0;j<p.getJSONArray("models").length();j++)if(p.getString("id").equals(selected.optString("providerID"))&&p.getJSONArray("models").getString(j).equals(selected.optString("id")))found=true;}
        if(!found){selected=null;for(int i=0;i<providers.length();i++){JSONObject p=providers.getJSONObject(i);if(p.getJSONArray("models").length()>0){selected=new JSONObject().put("providerID",p.getString("id")).put("id",p.getJSONArray("models").getString(0));break;}}}
        return new JSONObject().put("version",2).put("providers",providers).put("defaultModel",selected==null?JSONObject.NULL:selected);
    }
}
