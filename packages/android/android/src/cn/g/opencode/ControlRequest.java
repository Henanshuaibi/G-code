package cn.g.opencode;
import java.util.concurrent.CompletableFuture;

/** Cancellation belongs to one request, while the conversation grant stays separate. */
final class ControlRequest {
    final String id,session;final long lease,deadline;
    private boolean cancelled;private CompletableFuture<?> pending;
    ControlRequest(String id,String session,long lease,long deadline){this.id=id;this.session=session;this.lease=lease;this.deadline=deadline;}
    synchronized void cancel(){cancelled=true;if(pending!=null)pending.cancel(false);}
    synchronized void bind(CompletableFuture<?> value){pending=value;if(cancelled&&value!=null)value.cancel(false);}
    synchronized void clearPending(){pending=null;}
    synchronized void check(ControlGate gate,long elapsed,long wall){
        gate.validate(session,lease,elapsed);
        if(cancelled)throw new IllegalStateException("本次操作已取消，请重新观察；当前会话授权没有因此撤销");
        if(wall>=deadline)throw new IllegalStateException("本次操作超时，请重新观察；当前会话授权没有因此撤销");
    }
}
