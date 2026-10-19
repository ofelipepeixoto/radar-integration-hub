# Copyright (c) 2026 Carlos Felipe. MIT. Original Radar adapter.
import hashlib
import json
import re
import urllib.request
from urllib.parse import urlsplit

TOOL = "radar_crm_preview"
SCHEMA = {"name": TOOL, "description": "Contagens de uma amostra CRM de até 10 negócios; não representa receita ou o funil completo.", "parameters": {"type": "object", "properties": {}, "additionalProperties": False}}

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

def preview(args, *, task_id=None, secret_reader=None):
    # All authority is operator-owned. Tool args never contain tenant, URL or credentials.
    if type(args) is not dict or args or not isinstance(task_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", task_id):
        return json.dumps({"error": "INVALID_RADAR_REQUEST"})
    try:
        if secret_reader is None:
            from agent.secret_scope import get_secret
            secret_reader = get_secret
        endpoint = secret_reader("RADAR_HUB_ENDPOINT")
        token = secret_reader("RADAR_SERVICE_TOKEN")
        u = urlsplit(endpoint or "")
        if u.scheme != "http" or u.hostname != "127.0.0.1" or u.username or u.password or u.path != "/v1/crm/deals/preview" or u.query or u.fragment or not u.port:
            raise ValueError()
        if not isinstance(token, str) or not re.fullmatch(r"[A-Za-z0-9_-]{43,128}", token):
            raise ValueError()
        request_id = hashlib.sha256(task_id.encode()).hexdigest()
        req = urllib.request.Request(endpoint, data=json.dumps({"requestId": request_id}).encode(), method="POST", headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
        # No proxy, redirect or automatic retry. Deadline also enforced by the worker supervisor.
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        with opener.open(req, timeout=6) as response:
            if response.status != 200 or response.headers.get_content_type() != "application/json":
                raise ValueError()
            raw = response.read(16385)
            if len(raw) > 16384:
                raise ValueError()
            value = json.loads(raw.decode("utf-8"), parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
        stages = value.get("stages")
        count = value.get("sampleCount")
        if value.get("action") != "crm.deals.preview" or value.get("scope") != "sample-only" or type(count) is not int or not 0 <= count <= 10 or type(value.get("hasMore")) is not bool or type(stages) is not dict or len(stages) > 10:
            raise ValueError()
        if any(not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", k) or k in {"__proto__", "constructor", "prototype"} or type(v) is not int or not 1 <= v <= 10 for k, v in stages.items()) or sum(stages.values()) != count:
            raise ValueError()
        return json.dumps({"scope": "sample-only", "sampleCount": count, "stages": stages, "hasMore": value["hasMore"]})
    except Exception:
        return json.dumps({"error": "HUB_REQUEST_FAILED"})

def register(ctx):
    def handler(args, **kwargs):
        return preview(args, task_id=kwargs.get("task_id"))
    ctx.register_tool(name=TOOL, toolset="radar_readonly", schema=SCHEMA, handler=handler)
