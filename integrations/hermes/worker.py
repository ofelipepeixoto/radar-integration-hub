# Copyright (c) 2026 Carlos Felipe. MIT. One-shot deterministic worker; no LLM execution.
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import tempfile

PIN = "c225c4a04e8b517a357804ebb27367b0c961fd0e"
ROOT = Path(__file__).resolve().parents[2]

def reject_duplicates(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError()
        result[key] = value
    return result

def main():
    # Read one bounded job, exit afterwards. The caller must close stdin and enforce a deadline.
    raw = sys.stdin.buffer.read(4097)
    try:
        if len(raw) > 4096:
            raise ValueError()
        job = json.loads(raw.decode("utf-8"), object_pairs_hook=reject_duplicates)
        if type(job) is not dict or set(job) != {"version", "id", "tool", "arguments"} or job["version"] != "radar.hermes.job.v1" or not isinstance(job["id"], str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", job["id"]) or job["tool"] != "radar_crm_preview" or type(job["arguments"]) is not dict or job["arguments"]:
            raise ValueError()
    except Exception:
        print(json.dumps({"ok": False, "error": "INVALID_WORKER_JOB", "paidCallsEnabled": False}))
        return 2
    # Require explicitly provisioned Hermes checkout; never clone/install/update at runtime.
    source = Path(os.environ.get("RADAR_HERMES_SOURCE", "/nonexistent"))
    try:
        metadata = source / ".git" / "HEAD"
        head = (metadata if metadata.exists() else source / ".radar-upstream-pin").read_text().strip()
        if head.startswith("ref: "):
            ref = head[5:]
            try:
                head = (source / ".git" / ref).read_text().strip()
            except FileNotFoundError:
                head = next(line.split()[0] for line in (source / ".git" / "packed-refs").read_text().splitlines() if line.endswith(" " + ref))
        if head != PIN:
            raise ValueError()
        sys.path.insert(0, str(source))
        spec = importlib.util.spec_from_file_location("radar_hermes_plugin", ROOT / "plugins/hermes-radar/__init__.py")
        plugin = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(plugin)
        # Real PluginContext + registry, with no model_tools/builtin-tool discovery.
        from hermes_cli.plugins import PluginContext, PluginManager, PluginManifest
        from tools.registry import registry
        from agent.secret_scope import set_secret_scope, reset_secret_scope
        with tempfile.TemporaryDirectory(prefix="radar-hermes-job-") as home:
            os.environ["HERMES_HOME"] = home
            ctx = PluginContext(PluginManifest(name="radar-hub-readonly", version="0.1.0"), PluginManager(scope_key=home))
            plugin.register(ctx)
            scope_token = set_secret_scope({k: os.environ.get(k, "") for k in ("RADAR_SERVICE_TOKEN", "RADAR_HUB_ENDPOINT")}, profile_home=home)
            try:
                result = json.loads(registry.dispatch(plugin.TOOL, job["arguments"], scope=home, task_id=job["id"]))
            finally:
                reset_secret_scope(scope_token)
        ok = "error" not in result
        print(json.dumps({"version": "radar.hermes.result.v1", "id": job["id"], "ok": ok, "paidCallsEnabled": False, **({"result": result} if ok else {"error": "HUB_REQUEST_FAILED"})}))
        return 0 if ok else 1
    except Exception:
        print(json.dumps({"ok": False, "error": "HERMES_RUNTIME_UNAVAILABLE", "paidCallsEnabled": False}))
        return 3

if __name__ == "__main__":
    raise SystemExit(main())
