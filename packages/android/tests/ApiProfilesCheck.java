package cn.g.opencode;
import org.json.JSONArray;
import org.json.JSONObject;
public final class ApiProfilesCheck {
    static int checks;
    static void check(boolean value)throws Exception{checks++;if(!value)throw new Exception("check "+checks);}
    interface Job{void run()throws Exception;}
    static void rejects(Job job)throws Exception{boolean denied=false;try{job.run();}catch(IllegalArgumentException e){denied=true;}check(denied);}
    public static void main(String[] args)throws Exception{
        JSONObject old=new JSONObject().put("name","旧中转站").put("base","https://relay.example/v1").put("model","model-old").put("protocol","responses");
        JSONObject migrated=ApiProfiles.migrate(old);JSONObject provider=migrated.getJSONArray("providers").getJSONObject(0);
        check(provider.getString("id").equals("mobile"));check(provider.getJSONArray("models").getString(0).equals("model-old"));check(provider.getString("protocol").equals("responses"));check(migrated.getJSONObject("defaultModel").getString("providerID").equals("mobile"));check(!old.has("providers"));
        provider.put("models",new JSONArray().put("model-old").put("model-new").put("model-new"));
        JSONObject second=new JSONObject(provider.toString()).put("id","p_second").put("name","第二个中转站").put("base","https://second.example/chat/completions").put("key","test-key-never-real");migrated.getJSONArray("providers").put(second);
        JSONObject valid=ApiProfiles.validate(migrated);check(valid.getJSONArray("providers").length()==2);check(valid.getJSONArray("providers").getJSONObject(0).getJSONArray("models").length()==2);check(valid.getJSONArray("providers").getJSONObject(1).getString("base").equals("https://second.example/v1"));check(!valid.toString().contains("test-key-never-real"));
        valid.put("defaultModel",new JSONObject().put("providerID","p_second").put("id","model-new"));check(ApiProfiles.validate(valid).getJSONObject("defaultModel").getString("providerID").equals("p_second"));
        valid.getJSONArray("providers").remove(1);check(ApiProfiles.validate(valid).getJSONObject("defaultModel").getString("providerID").equals("mobile"));
        JSONObject bad=new JSONObject(valid.toString());bad.getJSONArray("providers").put(new JSONObject(bad.getJSONArray("providers").getJSONObject(0).toString()));rejects(()->ApiProfiles.validate(bad));
        for(String base:new String[]{"http://relay.example","https://user:pass@relay.example","https://relay.example?key=secret"}){JSONObject test=new JSONObject(valid.toString());test.getJSONArray("providers").getJSONObject(0).put("base",base);rejects(()->ApiProfiles.validate(test));}
        JSONObject http=new JSONObject(valid.toString());http.getJSONArray("providers").getJSONObject(0).put("base","http://localhost").put("allowHttp",true);check(ApiProfiles.validate(http).getJSONArray("providers").getJSONObject(0).getString("base").equals("http://localhost/v1"));
        JSONObject models=new JSONObject(valid.toString());models.getJSONArray("providers").getJSONObject(0).put("models",new JSONArray());rejects(()->ApiProfiles.validate(models));
        check(ApiProfiles.validate(new JSONObject().put("providers",new JSONArray())).getJSONArray("providers").length()==0);
        JSONObject media=new JSONObject(valid.toString());JSONObject service=media.getJSONArray("providers").getJSONObject(0);service.put("models",new JSONArray()).put("imageModels",new JSONArray().put("image-model")).put("videoModels",new JSONArray().put("video-model"));JSONObject mediaValid=ApiProfiles.validate(media);check(mediaValid.isNull("defaultModel"));check(mediaValid.getJSONArray("providers").getJSONObject(0).getJSONArray("imageModels").getString(0).equals("image-model"));check(mediaValid.getJSONArray("providers").getJSONObject(0).getJSONArray("videoModels").getString(0).equals("video-model"));
        System.out.println("PASS: "+checks+" JVM configuration checks (JSON-java) for legacy migration, multiple providers/models, independent IDs, default fallback, public secret exclusion and URL validation");
    }
}
