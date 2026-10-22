package cn.g.opencode;
public final class ScreenFrameCheck {
    static int checks;
    interface Job{void run();}
    static void accepts(Job job){job.run();checks++;}
    static void rejects(Job job){try{job.run();}catch(IllegalStateException e){checks++;return;}throw new AssertionError("expected rejection");}
    public static void main(String[] args){
        ScreenFrame frame=new ScreenFrame("screen-a","com.example.app",7,1440,3200,1000);
        accepts(()->frame.check("screen-a","com.example.app",7,1440,3200,21000)); // A model response taking >15s used to be rejected.
        accepts(()->frame.check("screen-a","com.example.app",7,1440,3200,121000));
        rejects(()->frame.check("screen-a","com.example.app",7,1440,3200,121001));
        rejects(()->frame.check("old-screen","com.example.app",7,1440,3200,2000));
        rejects(()->frame.check("screen-a","com.other.app",7,1440,3200,2000));
        rejects(()->frame.check("screen-a","com.example.app",8,1440,3200,2000));
        rejects(()->frame.check("screen-a","com.example.app",7,3200,1440,2000));
        String target="[20,100,200,200]|menu_food|Button|拼好饭";
        accepts(()->ScreenFrame.target(target,target)); // Same target remains valid after unrelated page content updates.
        rejects(()->ScreenFrame.target(target,"[20,300,200,400]|menu_food|Button|拼好饭"));
        rejects(()->ScreenFrame.target(target,"[20,100,200,200]|menu_food|Button|确认支付"));
        rejects(()->ScreenFrame.target(null,target));
        System.out.println("PASS: "+checks+" production frame/target checks: slow model response, unchanged target, moved/changed target, page switch, rotation and expiration");
    }
}
