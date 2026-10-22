"""Post-deploy, authenticated read-only report API checks; never prints session tokens."""
import json,sqlite3,time,urllib.request,urllib.parse
from pathlib import Path
root=Path('/srv/apps/spotlight-planner')
db_path=next((root/'data/v3/d1/miniflare-D1DatabaseObject').glob('faaf*.sqlite'))
with sqlite3.connect(f'file:{db_path}?mode=ro',uri=True) as db:
 row=db.execute("SELECT s.token, u.id FROM sessions s JOIN users u ON u.id=s.user_id WHERE u.role='admin' AND s.expires_at>? ORDER BY s.expires_at DESC LIMIT 1",(int(time.time()*1000),)).fetchone()
 assert row,'No active admin session is available for the read-only report check'
 token,user_id=row
 project=db.execute('SELECT id FROM projects ORDER BY id LIMIT 1').fetchone()
 assert project,'No project available for report check'
 project_id=project[0]
req=urllib.request.Request('http://127.0.0.1:3100/api/reports?'+urllib.parse.urlencode({'projectId':project_id}),headers={'Cookie':'kmk_session='+token})
with urllib.request.urlopen(req,timeout=30) as response:
 assert response.status==200
 data=json.load(response)
 assert data['project']['id']==project_id and data['assets'] and data['settings']['title']
 assert 'share_code' not in data['project']
 assert data['version']==0 and isinstance(data['campaigns'],list)
 print('Authenticated project report API passed; project',project_id,'assets',len(data['assets']),'campaigns',len(data['campaigns']),'map protection',data['project']['protected'])
req=urllib.request.Request('http://127.0.0.1:3100/api/reports?projectId='+str(project_id),headers={'Cookie':'kmk_session=invalid'})
try:
 with urllib.request.urlopen(req,timeout=15):raise AssertionError('Unauthenticated report data was returned')
except urllib.error.HTTPError as error:assert error.code==401
print('Unauthenticated access is denied')
