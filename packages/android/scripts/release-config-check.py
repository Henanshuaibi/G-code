from pathlib import Path
from tempfile import TemporaryDirectory
import json
from release_config import release_configuration
with TemporaryDirectory(dir=Path(__file__).resolve().parents[1]/'build') as folder:
    root=Path(folder)
    assert release_configuration(root,{}) == {'base_url':None}
    assert release_configuration(root,{'GCODE_PLATFORM_URL':'https://operator.invalid/'}) == {'base_url':'https://operator.invalid'}
    assert release_configuration(root,{'GCODE_LOCAL_TEST':'true'})=={'base_url':'http://127.0.0.1:8787','local_test':True}
    for address in ['http://outside.invalid','https://outside.invalid']:
        try: release_configuration(root,{'GCODE_LOCAL_TEST':'true','GCODE_PLATFORM_URL':address})
        except ValueError: pass
        else: raise AssertionError('Local test flag must never allow a remote endpoint')
    file=root/'platform-release.json'
    file.write_text(json.dumps({'base_url':'https://operator.invalid'}))
    assert release_configuration(root,{})['base_url']=='https://operator.invalid'
    assert release_configuration(root,{'GCODE_PLATFORM_URL':'https://new-operator.invalid'})['base_url']=='https://new-operator.invalid'
    for value in ['http://operator.invalid','https://user:password@operator.invalid','https://operator.invalid?key=secret','https://operator.invalid/#token','https://operator.invalid/v1','https://YOUR-GCODE-DOMAIN.example']:
        try: release_configuration(root,{'GCODE_PLATFORM_URL':value})
        except ValueError: pass
        else: raise AssertionError('Invalid public release endpoint accepted')
    file.write_text(json.dumps({'base_url':'https://operator.invalid','api_key':'synthetic-secret'}))
    try: release_configuration(root,{})
    except ValueError: pass
    else: raise AssertionError('Credential field must never enter the public release config')
print('PASS: operator endpoint release config, empty/unopened state, HTTPS root validation, environment override and credential-field rejection')
