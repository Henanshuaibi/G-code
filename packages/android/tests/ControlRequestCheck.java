package cn.g.opencode;
import java.util.concurrent.CompletableFuture;
public final class ControlRequestCheck {
    static int count;
    interface Job{void run();}
    static void check(boolean value){count++;if(!value)throw new AssertionError("check "+count);}
    static void rejects(Job job){try{job.run();}catch(IllegalStateException e){count++;return;}throw new AssertionError("must reject cancelled or stale request");}
    public static void main(String[] args){
        ControlGate gate=new ControlGate();gate.grant("a",1000);long lease=gate.lease("a",1001);
        ControlRequest first=new ControlRequest("r1","a",lease,10000);CompletableFuture<Boolean> callback=new CompletableFuture<>();first.bind(callback);first.cancel();check(callback.isCancelled());rejects(()->first.check(gate,1002,2000));check(gate.active(1003));
        ControlRequest next=new ControlRequest("r2","a",lease,10000);next.check(gate,1004,2000);check(gate.active(1005));
        ControlRequest late=new ControlRequest("late","a",lease,3000);rejects(()->late.check(gate,1005,3000));check(gate.active(1006));
        gate.stopSession("a");rejects(()->next.check(gate,1007,2000));gate.grant("a",1008);rejects(()->next.check(gate,1009,2001));
        ControlRequest queued=new ControlRequest("queued","a",gate.lease("a",1010),10000);queued.cancel();CompletableFuture<Boolean> pending=new CompletableFuture<>();queued.bind(pending);check(pending.isCancelled());rejects(()->queued.check(gate,1011,2002));check(gate.active(1012));
        queued.clearPending();CompletableFuture<Boolean> unrelated=new CompletableFuture<>();check(!unrelated.isDone());
        System.out.println("PASS: "+count+" request cancellation checks: deadline/abort preserve conversation grant, late actions rejected, queued requests cannot cross regrant, callback cancellation before/after binding");
    }
}
