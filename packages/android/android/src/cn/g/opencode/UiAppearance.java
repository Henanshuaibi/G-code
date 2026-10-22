package cn.g.opencode;
import android.content.Context;
import android.content.res.Configuration;
import android.graphics.Color;
import org.json.JSONObject;

/** Native loading screen follows the same stored appearance as the local web UI. */
final class UiAppearance {
    final int background,foreground;final float fontSize;
    UiAppearance(int background,int foreground,float fontSize){this.background=background;this.foreground=foreground;this.fontSize=fontSize;}
    static int color(String value){if(!value.matches("#[a-fA-F0-9]{6}"))throw new IllegalArgumentException("颜色格式不正确");return Color.parseColor(value);}
    static UiAppearance read(Context context){
        try{JSONObject data=new JSONObject(context.getSharedPreferences("ui",0).getString("appearance","{}"));String mode=data.optString("mode","light");boolean dark="dark".equals(mode)||"system".equals(mode)&&(context.getResources().getConfiguration().uiMode&Configuration.UI_MODE_NIGHT_MASK)==Configuration.UI_MODE_NIGHT_YES;
            int bg="custom".equals(mode)?color(data.optString("background","#ffffff")):dark?0xff171717:Color.WHITE;int fg="custom".equals(mode)?color(data.optString("foreground","#111111")):dark?0xfff4f4f4:0xff111111;
            return new UiAppearance(bg,fg,Math.max(12,Math.min(22,data.optInt("fontSize",15))));
        }catch(Exception ignored){return new UiAppearance(Color.WHITE,0xff111111,15);}
    }
    static boolean light(int color){return Color.luminance(color)>0.179f;}
}
