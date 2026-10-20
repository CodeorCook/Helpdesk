"""Serialize assignment and administrative eligibility changes across workers.

Advisory transaction lock uses PostgreSQL, not an in-process mutex. Always acquire
before ticket/group/account row locks. Customer status mutations use only ticket locks.
"""
def lock_operations(cur):
    cur.execute('SELECT pg_advisory_xact_lock(%s)', (741032026,))
