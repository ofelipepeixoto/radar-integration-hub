"""Original audit probes by Carlos Felipe with AI assistance; synthetic data only.

Usage: python reproduce_audit.py /absolute/path/to/odysseus
These assertions reproduce limitations; success does NOT mean secure software.
"""
import ast
import asyncio
import ipaddress
import importlib.util
import json
import os
from pathlib import Path
import shlex
import sys
import tempfile
from types import SimpleNamespace
from unittest.mock import patch

root = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(root))
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
from src import url_security
from src.rag_vector import VectorRAG
spec = importlib.util.spec_from_file_location("audit_shell_service", root / "services/shell/service.py")
shell_module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = shell_module
spec.loader.exec_module(shell_module)
ShellService = shell_module.ShellService

findings = []

class Collection:
    def __init__(self):
        self.rows = {}
        self.calls = []
    def count(self):
        return len(self.rows)
    def get(self, ids=None, include=None, where=None):
        self.calls.append({"ids": ids, "where": where})
        selected = [(k,v) for k,v in self.rows.items() if ids is None or k in ids]
        if where:
            selected = [(k,v) for k,v in selected if v[1].get("owner") == where["owner"]]
        return {"ids":[k for k,v in selected], "documents":[v[0] for k,v in selected], "metadatas":[v[1] for k,v in selected]}
    def add(self, ids, embeddings, documents, metadatas):
        for k,t,m in zip(ids,documents,metadatas):
            self.rows[k] = (t,dict(m))

collection = Collection()
rag = VectorRAG.__new__(VectorRAG)
rag._healthy = True
rag._collection = collection
rag._lanes = [SimpleNamespace(name="synthetic", collection=collection, encode=lambda texts:[[0.0] for _ in texts])]
assert rag.add_document("Cláusula sintética: prazo de 30 dias.", {"owner":"alice", "source":"a.pdf"})
assert rag.add_document("Cláusula sintética: prazo de 30 dias.", {"owner":"alice", "source":"b.pdf"})
assert len(collection.rows) == 1
assert {m[1]["source"] for m in collection.rows.values()} == {"a.pdf"}
findings.append({"id":"RAG_SOURCE_COLLAPSE", "observed":"second source discarded for equal owner/text", "records":len(collection.rows)})

collection.add(["bob"], [[0.0]], ["prazo de outro cliente"], [{"owner":"bob", "source":"bob.pdf"}])
collection.calls.clear()
result = rag._keyword_search_fallback("prazo", k=5, owner="alice")
assert result and all(x["metadata"]["owner"] == "alice" for x in result)
assert collection.calls[0]["where"] is None
findings.append({"id":"RAG_SCAN_ALL_OWNERS", "observed":"backend fetch unscoped; output correctly scoped", "records_fetched":len(collection.rows)})

with patch.object(url_security, "_resolve_hostname_ips", return_value=[ipaddress.ip_address("93.184.216.34")]):
    endpoint = "https://synthetic-provider.example/v1"
    assert url_security.validate_public_http_url(endpoint) == endpoint
with patch.object(url_security, "_resolve_hostname_ips", return_value=[ipaddress.ip_address("127.0.0.1")]):
    try:
        url_security.validate_public_http_url(endpoint)
    except ValueError:
        pass
    else:
        raise AssertionError("private DNS result was not rejected")
findings.append({"id":"DNS_VALIDATION_NOT_PINNING", "observed":"validated output is only URL; later private DNS is rejected by new validation", "live_network_exploit":False})

tree = ast.parse((root / "core/database.py").read_text())
function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "_migrate_add_last_message_at_column")
namespace = {"DATABASE_URL":"postgresql://synthetic.invalid/demo", "os":os}
exec(compile(ast.Module(body=[function], type_ignores=[]), "migration_probe", "exec"), namespace)
with patch("os.path.exists", return_value=False) as exists, patch("sqlite3.connect") as connect:
    namespace[function.name]()
    connect.assert_not_called()
    assert exists.call_args.args[0] == namespace["DATABASE_URL"]
findings.append({"id":"POSTGRES_MIGRATION_SKIPPED", "observed":"legacy migration checks DSN as filesystem path and returns", "postgres_connected":False})

async def shell_probe():
    with tempfile.TemporaryDirectory() as directory:
        base=Path(directory); workspace=base/"workspace"; workspace.mkdir()
        external=base/"outside.txt"; external.write_text("SYNTHETIC_OUTSIDE_WORKSPACE")
        command = shlex.join([sys.executable,"-c","import pathlib,sys; print(pathlib.Path(sys.argv[1]).read_text())",str(external)])
        result = await ShellService(timeout=5).execute(command,cwd=str(workspace))
        assert result.exit_code == 0 and "SYNTHETIC_OUTSIDE_WORKSPACE" in result.stdout
        findings.append({"id":"SHELL_CWD_NOT_SANDBOX", "observed":"synthetic file outside cwd readable", "real_user_data":False})
asyncio.run(shell_probe())
print(json.dumps({"snapshot":"2992bf6d368a11472323e47d3bfed91e79cefc6b", "probe_count":len(findings), "findings":findings},ensure_ascii=False,indent=2))
