import unittest
from analyze import analyze_records, estimate, classify
class AnalysisTests(unittest.TestCase):
 def test_dedup_not_cumulative(self):
  user={'type':'response_item','payload':{'type':'message','role':'user','content':[{'text':'hello'}]}}
  record={'type':'token_usage_record','timestamp':'2026-09-09','payload':{'turn_id':'t','response_id':'r','usage':{'input_tokens':100,'cached_input_tokens':80,'output_tokens':5},'turn_token_usage':{'input_tokens':999}}}
  data=analyze_records([user,record,record,{'type':'event_msg','payload':{'type':'token_count','info':{'total_token_usage':{'input_tokens':9999}}}}])
  self.assertEqual(data['turns'][0]['input'],100)
  self.assertEqual(data['turns'][0]['requests'][0]['fresh'],20)
  self.assertEqual(len(data['turns'][0]['requests']),1)
 def test_missing_usage_not_zero(self):
  self.assertEqual(analyze_records([{'type':'event_msg','payload':{'type':'token_count'}}])['turns'],[])
 def test_classification(self):
  self.assertEqual(classify('developer','<skills_instructions>abc</skills_instructions>'),'Skills 清单/说明')
  self.assertEqual(classify('user','# AGENTS.md instructions for /x'),'项目/全局规则')
 def test_compaction_discards_old_visible_snapshot(self):
  records=[{'type':'response_item','payload':{'role':'user','type':'message','content':[{'text':'long history'}]}},{'type':'compacted','payload':{'message':'summary'}},{'type':'token_usage_record','payload':{'turn_id':'t','response_id':'r','usage':{'input_tokens':100,'output_tokens':1}}}]
  d=analyze_records(records)['turns'][0]['requests'][0]
  self.assertEqual(d['sources'].get('历史消息',0),0)
  self.assertGreater(d['sources']['压缩摘要'],0)
 def test_invalid_cache_unknown(self):
  d=analyze_records([{'type':'token_usage_record','payload':{'turn_id':'t','response_id':'r','usage':{'input_tokens':10,'cached_input_tokens':20,'output_tokens':1}}}])
  self.assertIsNone(d['turns'][0]['requests'][0]['cached'])
 def test_safe_label(self):
  d=analyze_records([{'type':'response_item','payload':{'role':'user','content':[{'text':'sk-abcdefghijklmnopqrstuvwx'}]}},{'type':'token_usage_record','payload':{'turn_id':'t','response_id':'r','usage':{'input_tokens':10,'output_tokens':1}}}])
  self.assertNotIn('abcdefghijkl',d['turns'][0]['label'])
if __name__=='__main__':unittest.main()
