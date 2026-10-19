"""Regression tests against a checkout with the actual patch applied.

Set ODYSSEUS_AUDIT_ROOT to patched checkout and ODYSSEUS_BASELINE_ROOT
to the unchanged pinned checkout. Uses a Chroma test double.
"""
import ast
from pathlib import Path
import sys
import os

ROOT = Path(os.environ["ODYSSEUS_AUDIT_ROOT"])
sys.path.insert(0,str(ROOT))
from src.rag_vector import VectorRAG
from src.embedding_lanes import dedupe_results

baseline=Path(os.environ["ODYSSEUS_BASELINE_ROOT"])
source=(baseline/"src/rag_vector.py").read_text()
tree=ast.parse(source)
klass=next(n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=="VectorRAG")
method=next(n for n in klass.body if isinstance(n,ast.FunctionDef) and n.name=="_keyword_search_fallback")
import logging
namespace={"List":list,"Dict":dict,"Any":object,"Optional":__import__('typing').Optional,"dedupe_results":dedupe_results,"logger":logging.getLogger('audit')}
exec(compile(ast.Module(body=[method],type_ignores=[]),"baseline_fallback","exec"),namespace)
unpatched=namespace[method.name]

class Collection:
    def __init__(self):
        self.calls=[]
        self.rows=[('a','prazo sintético',{'owner':'alice'}),('b','prazo sintético',{'owner':'bob'}),('c','prazo sintético',{})]
    def count(self): return len(self.rows)
    def get(self,include=None,where=None):
        selected=[r for r in self.rows if not where or r[2].get('owner')==where['owner']]
        self.calls.append((where,len(selected)))
        return {'ids':[r[0] for r in selected],'documents':[r[1] for r in selected],'metadatas':[r[2] for r in selected]}
def store():
    c=Collection();r=VectorRAG.__new__(VectorRAG);r._collection=c;r._lanes=[]
    return r,c
def test_scopes_backend_and_preserves_alice_results():
    r,c=store();before=unpatched(r,'prazo',owner='alice');after=r._keyword_search_fallback('prazo',owner='alice')
    assert before==after and {v['id'] for v in after}=={'a'}
    assert c.calls==[(None,3),({'owner':'alice'},1)]
def test_empty_owner_result_does_not_fall_back_to_cross_owner():
    r,c=store();assert r._keyword_search_fallback('prazo',owner='carol')==[]
    assert c.calls==[({'owner':'carol'},0)]
def test_unscoped_legacy_behavior_is_explicitly_preserved():
    r,c=store();assert {v['id'] for v in r._keyword_search_fallback('prazo',owner=None)}=={'a','b','c'}
    assert c.calls==[(None,3)]
