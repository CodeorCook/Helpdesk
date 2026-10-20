"""Minimal administrative audit, no credentials, message bodies or personal fields."""
from datetime import datetime, timezone
import json
import logging
import os
from pathlib import Path
import threading
from core.database import BASE_DIR

_gate=threading.Lock()


def record(actor, action, target):
    # Called only after a successful database commit. Historical assignment/state
    # audits are additionally persisted atomically in the existing SQL tables.
    event=dict(time=datetime.now(timezone.utc).isoformat(),actor=str(actor),action=action,target=str(target))
    try:
        configured=Path(os.getenv('MANAGER_AUDIT_DIR') or 'storage/audit')
        directory=(configured if configured.is_absolute() else BASE_DIR/configured).resolve()
        for forbidden in ['static','templates','frontend','docs']:
            if directory.is_relative_to((BASE_DIR/forbidden).resolve()):raise OSError('Invalid audit directory')
        with _gate:
            directory.mkdir(parents=True,exist_ok=True)
            with (directory/'manager.jsonl').open('a',encoding='utf-8') as output:output.write(json.dumps(event)+'\n')
    except OSError:
        # Do not claim a committed mutation rolled back due to log delivery failure.
        logging.getLogger('uvicorn.error').error('manager_audit_write_failed actor=%s action=%s target=%s',actor,action,target)
