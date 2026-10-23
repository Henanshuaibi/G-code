"""Public operator endpoint only; never bundle upstream credentials in the APK."""
import json, os
from pathlib import Path
from urllib.parse import urlsplit

def release_configuration(root, environ=None):
    env = os.environ if environ is None else environ
    path = Path(root) / 'platform-release.json'
    saved = json.loads(path.read_text()) if path.exists() else {}
    if not isinstance(saved, dict) or set(saved) - {'base_url','local_test'}:
        raise ValueError('platform-release.json 只允许公开的 base_url，禁止加入 Key、密码或其他配置')
    local = env.get('GCODE_LOCAL_TEST') == 'true' or saved.get('local_test') is True
    base = env.get('GCODE_PLATFORM_URL', saved.get('base_url'))
    if local and not base: base = 'http://127.0.0.1:8787'
    if base is None or base == '':
        return {'base_url': None}
    if not isinstance(base, str):
        raise ValueError('平台地址须为 HTTPS 根地址')
    url = urlsplit(base)
    if ((url.scheme != 'https' and not (local and url.scheme == 'http' and url.hostname in ('127.0.0.1','::1'))) or (local and url.hostname not in ('127.0.0.1','::1')) or not url.hostname or url.username is not None or url.password is not None
        or url.query or url.fragment or url.path not in ('', '/') or url.hostname.endswith('.example')):
        raise ValueError('请填写真实平台 HTTPS 根地址；不能包含密钥、账号密码、查询参数或 /v1')
    return {'base_url': base.rstrip('/'), **({'local_test':True} if local else {})}

if __name__ == '__main__':
    print(json.dumps(release_configuration(Path(__file__).resolve().parents[1]), ensure_ascii=False))
