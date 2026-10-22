package cn.g.opencode;

/** Validate page identity and the chosen target, rather than unrelated content events. */
final class ScreenFrame {
    final String token,app;final int window,width,height;final long observed;
    ScreenFrame(String token,String app,int window,int width,int height,long observed){this.token=token;this.app=app;this.window=window;this.width=width;this.height=height;this.observed=observed;}
    void check(String token,String app,int window,int width,int height,long now){
        if(this.token.isEmpty()||!this.token.equals(token)||!this.app.equals(app)||this.window!=window||this.width!=width||this.height!=height||now-observed>120000||now<observed)throw new IllegalStateException("页面已改变或观察已过期，请重新 read 或 screenshot");
    }
    static void target(String original,String current){if(original==null||!original.equals(current))throw new IllegalStateException("目标控件的文字或位置已变化，请重新 read 定位");}
}
