"""One bounded, authenticated location backfill pass. Does not send notifications."""
import json, subprocess, urllib.request
config=json.loads(subprocess.check_output(['docker','inspect','spotlight-planner'],text=True))[0]['Config']
values=dict(line.split('=',1) for line in config['Env'] if '=' in line)
secret=values.get('AUTOMATION_SECRET') or values.get('SESSION_SECRET')
if not secret: raise RuntimeError('Automation authentication unavailable')
request=urllib.request.Request('http://127.0.0.1:3100/api/app?action=populate-locations',headers={'x-automation-secret':secret})
with urllib.request.urlopen(request,timeout=90) as response:
    result=json.load(response)
print(json.dumps({key:result.get(key) for key in ['state','updated','lookedUp']}))
