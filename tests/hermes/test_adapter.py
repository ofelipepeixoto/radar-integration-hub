import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch
root=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('radar',root/'plugins/hermes-radar/__init__.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class AdapterTests(unittest.TestCase):
    def test_model_authority_rejected_before_secret_or_network(self):
        def forbidden(*args): self.fail('must not read credentials')
        for args in ({'tenantId':'other'},{'paidCallsEnabled':True},None,[]):
            self.assertEqual(json.loads(m.preview(args,task_id='job',secret_reader=forbidden)),{'error':'INVALID_RADAR_REQUEST'})
    def test_remote_endpoint_and_credentials_fail_before_network(self):
        for endpoint,token in [('https://example.com/v1/crm/deals/preview','x'*43),('http://127.0.0.1:8787/v1/crm/deals/preview','weak')]:
            values={'RADAR_HUB_ENDPOINT':endpoint,'RADAR_SERVICE_TOKEN':token}
            with patch.object(m.urllib.request,'build_opener',side_effect=AssertionError('NETWORK_CALLED')) as network:
                self.assertEqual(json.loads(m.preview({},task_id='job',secret_reader=values.get)),{'error':'HUB_REQUEST_FAILED'})
                network.assert_not_called()
    def test_schema_has_no_authority_fields(self):
        self.assertEqual(m.SCHEMA['parameters'],{'type':'object','properties':{},'additionalProperties':False})
if __name__=='__main__':unittest.main()
