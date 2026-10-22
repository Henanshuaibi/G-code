package cn.g.opencode;

/** A temporary whole-device grant for one conversation. Never persisted. */
final class ControlGate {
    private String session="",reason="尚未授权";private long until,generation;private int steps;
    synchronized void grant(String id,long now){
        if(id==null||id.isEmpty()||id.length()>160)throw new IllegalArgumentException("授权会话不正确");
        generation++;session=id;until=now+900000;steps=0;reason="已授权全设备界面控制";
    }
    synchronized void stop(String message){generation++;session="";until=0;steps=0;reason=message;}
    synchronized boolean active(long now){if(!session.isEmpty()&&now>=until)stop("授权已到期，请重新开启");return !session.isEmpty();}
    synchronized long lease(String id,long now){if(!active(now)||!session.equals(id))throw new IllegalStateException("当前会话没有手机控制授权："+reason);return generation;}
    synchronized long check(String id,long now){lease(id,now);if(++steps>300){stop("已达到 300 步，请检查后重新授权");throw new IllegalStateException(reason);}return generation;}
    synchronized void validate(String id,long lease,long now){if(!active(now)||!session.equals(id)||lease!=generation)throw new IllegalStateException("手机控制已停止或重新授权");}
    synchronized void stopSession(String id){if(session.equals(id))stop("会话已停止手机控制");}
    synchronized String session(long now){active(now);return session;}
    synchronized String reason(long now){active(now);return reason;}
    synchronized long remaining(long now){return active(now)?until-now:0;}
    // Ordinary app actions (including search, editing and messaging) remain available.
    static boolean manualAction(String value){return value!=null&&value.matches("(?is).*(确认支付|立即支付|确认付款|立即付款|支付密码|提交订单|确认下单|立即下单|确认购买|立即购买|确认转账|立即转账|确认注销|永久删除|恢复出厂|清除所有数据|pay now|place order|confirm payment|factory reset).*");}
    static int coordinate(double value,int size){if(!Double.isFinite(value)||value<0||value>1||size<1)throw new IllegalArgumentException("坐标必须在 0 到 1 之间，并以本次截图为准");return Math.min(size-1,(int)Math.round(value*(size-1)));}
}
