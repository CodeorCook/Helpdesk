"""Small-corpus retrieval without extensions/migrations; active FAQ only."""
import re
import unicodedata
from psycopg import sql
from core.database import database_schema

def execute(cur,statement,params=()):
    cur.execute(sql.SQL(statement).format(**{t:sql.Identifier(database_schema(),t) for t in ('cau_hoi_mau','phien_chat','tin_nhan_chatbot')}),params)

def words(text):
    value=unicodedata.normalize('NFD',text.casefold().replace('đ','d'))
    return set(re.findall(r'[a-z0-9]{2,}', ''.join(c for c in value if not unicodedata.combining(c))))-{'toi','ban','cua','cho','voi','nay','the','nao','mot','cac','khong','duoc','can','muon','nhung','khi','thi','hay','nhu','lam'}

def retrieve(cur,query):
    execute(cur,'SELECT ch_ma::text id,noi_dung question,tu_khoa keywords,cau_tra_loi answer FROM {cau_hoi_mau} WHERE dang_hoat_dong ORDER BY ch_ma LIMIT 500')
    ranked=[];terms=words(query)
    for row in cur.fetchall():
        score=len(terms&words(row['question']+' '+(row['keywords'] or '')))*3+len(terms&words(row['answer']))
        if score:ranked.append((score,row))
    return [r for _,r in sorted(ranked,key=lambda item:-item[0])[:4]]
