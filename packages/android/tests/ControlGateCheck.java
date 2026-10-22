package cn.g.opencode;
public final class ControlGateCheck {
    static int checks;
    static void check(boolean value){checks++;if(!value)throw new AssertionError("check "+checks);}
    interface Job{void run();}
    static void rejects(Job job){boolean denied=false;try{job.run();}catch(IllegalArgumentException|IllegalStateException e){denied=true;}check(denied);}
    public static void main(String[] args){
        ControlGate gate=new ControlGate();check(!gate.active(0));rejects(()->gate.check("a",0));rejects(()->gate.grant("",0));
        gate.grant("a",1000);long lease=gate.check("a",1001);gate.validate("a",lease,1002);rejects(()->gate.check("b",1002));gate.stopSession("b");check(gate.active(1003));gate.stopSession("a");rejects(()->gate.validate("a",lease,1004));
        gate.grant("b",2000);check(gate.active(901999));check(!gate.active(902000));rejects(()->gate.check("b",902001));
        gate.grant("c",1000000);for(int i=0;i<300;i++)gate.check("c",1000001);rejects(()->gate.check("c",1000002));check(!gate.active(1000003));
        gate.grant("d",2000000);long old=gate.check("d",2000001);gate.grant("d",2000002);rejects(()->gate.validate("d",old,2000003));gate.stop("用户已停止");check(gate.reason(2000004).equals("用户已停止"));check(!new ControlGate().active(2000004));
        for(String label:new String[]{"确认支付 ￥28","立即下单","确认转账","恢复出厂设置","输入支付密码","Place order","Confirm payment"})check(ControlGate.manualAction(label));
        for(String label:new String[]{"搜索","拼好饭","加入购物车","备注","少辣","发送","删除草稿","打开设置","订阅列表","支付设置"})check(!ControlGate.manualAction(label));
        check(ControlGate.coordinate(0,1440)==0);check(ControlGate.coordinate(1,1440)==1439);check(ControlGate.coordinate(0.5,1441)==720);check(ControlGate.coordinate(1,1)==0);
        for(double value:new double[]{Double.NaN,Double.POSITIVE_INFINITY,-0.1,1.1})rejects(()->ControlGate.coordinate(value,1440));rejects(()->ControlGate.coordinate(0.5,0));
        System.out.println("PASS: "+checks+" whole-device session, stop, expiration, 300-step budget, cancelled callback lease and coordinate checks");
    }
}
