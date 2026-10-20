"""Per-process defense for privileged password confirmation; shared gateway limits recommended in production."""
from collections import defaultdict,deque
import threading
import time
from fastapi import HTTPException

_attempts=defaultdict(deque)
_gate=threading.Lock()


def role_confirmation(actor):
    now=time.monotonic()
    with _gate:
        attempts=_attempts[str(actor)]
        while attempts and attempts[0]<now-60:attempts.popleft()
        if len(attempts)>=5:raise HTTPException(429,'Quá nhiều lần xác nhận phân quyền. Vui lòng thử lại sau một phút.')
        attempts.append(now)
