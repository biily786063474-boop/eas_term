"""Local-only Codex usage audit. Provider counts are exact; visible text attribution is a proxy.
No prompts/tool bodies are exported. No credentials/configs/network are read.
"""
import collections, hashlib, json, re, os, tempfile
from pathlib import Path
try:
 cache=Path(os.environ.get('TIKTOKEN_CACHE_DIR',os.environ.get('DATA_GYM_CACHE_DIR',str(Path(tempfile.gettempdir())/'data-gym-cache'))))
 key=hashlib.sha1(b'https://openaipublic.blob.core.windows.net/encodings/o200k_base.tiktoken').hexdigest()
 if not (cache/key).is_file():raise RuntimeError('Use offline fallback; never download tokenizer')
 import tiktoken
 ENCODER=tiktoken.get_encoding('o200k_base')
except Exception:
 ENCODER=None
METHOD='o200k_base 代理分词（非 Astra 精确 tokenizer）' if ENCODER else '字符启发式（中文≈1/字，其余≈1/4字符）'
def estimate(text):
 text=str(text or '')
 if ENCODER:return len(ENCODER.encode(text,disallowed_special=()))
 return sum(1 if '\u3400'<=c<='\u9fff' else .25 for c in text).__ceil__()
def redact(text):
 text=re.sub(r'(?:sk-|gh[pousr]_)[A-Za-z0-9_-]{12,}','[凭证已隐藏]',text)
 text=re.sub(r'(?i)(?:api[_ -]?key|token|password|secret)\s*[:=]\s*\S+','[敏感字段已隐藏]',text)
 return text[:100]
def classify(role,text):
 if '<skills_instructions>' in text:return 'Skills 清单/说明'
 if 'AGENTS.md instructions' in text or text.startswith('# Biily 全局'):return '项目/全局规则'
 if '<recommended_plugins>' in text:return '插件目录'
 if 'Eas-Term 内置能力' in text:return 'Eas-Term 能力指引'
 if role in ('system','developer'):return '系统/开发者规则'
 if text.startswith('<environment_context>'):return '环境信息'
 return '历史消息'
def text_of(p):
 content=p.get('content',p.get('output',''))
 if isinstance(content,str):return content
 if isinstance(content,list):return '\n'.join(x.get('text','') for x in content if isinstance(x,dict))
 return ''
def valid(n):return isinstance(n,(int,float)) and not isinstance(n,bool) and n>=0

def analyze_records(records):
 turns={};seen=set();sources=collections.Counter();pending=collections.Counter();label='未记录用户消息';model='未知';meta={};tool_names={};malformed=0;latest_message=None
 def material(p):
  typ=p.get('type','');text=text_of(p);role=p.get('role','')
  if typ in ('function_call','custom_tool_call'):
   name=p.get('name','工具');tool_names[p.get('call_id')]=name
   return '工具调用参数',estimate(p.get('arguments',p.get('input','')))
  if typ in ('function_call_output','custom_tool_call_output'):
   name=tool_names.get(p.get('call_id'),'')
   return ('工具返回（含读文件）' if name else '工具返回（来源未记录）'),estimate(text)
  return classify(role,text),estimate(text)
 for d in records:
  p=d.get('payload',{});typ=d.get('type')
  if not isinstance(p,dict):continue
  if typ=='session_meta':
   meta={k:p.get(k) for k in ['id','cwd','originator','timestamp']}
   base=p.get('base_instructions',{})
   if base:sources['基础系统指令']=estimate(base.get('text','') if isinstance(base,dict) else base)
  elif typ=='turn_context':model=p.get('model',model)
  elif typ=='compacted':
   sources.clear();pending.clear()
   replacement=p.get('replacement_history')
   if isinstance(replacement,list):
    for item in replacement:
     if isinstance(item,dict):
      cat,n=material(item);sources[cat]+=n
   else:sources['压缩摘要']=estimate(p.get('message',''))
  elif typ=='response_item':
   role=p.get('role');text=text_of(p);cat,n=material(p)
   if role=='user' and cat=='历史消息' and text:
    label=redact(text);latest_message=n
   # Response output is not input to that same response. Defer until usage has been observed.
   if role=='assistant' or p.get('type') in ('function_call','custom_tool_call','reasoning','agent_message'):
    pending[cat if p.get('type') not in ('reasoning',) else '模型历史/推理记录']+=n
   else:
    sources.update(pending);pending.clear();sources[cat]+=n
  elif typ=='token_usage_record':
   uid=p.get('response_id') or hashlib.sha256(json.dumps(d,sort_keys=True).encode()).hexdigest()
   if uid in seen:continue
   seen.add(uid);u=p.get('usage',{});i=u.get('input_tokens');o=u.get('output_tokens')
   if not valid(i) or not valid(o):malformed+=1;continue
   c=u.get('cached_input_tokens');c=c if valid(c) and c<=i else None
   w=u.get('cache_write_input_tokens',0);w=w if valid(w) and w<=i-(c or 0) else None
   tid=p.get('turn_id') or 'unknown'
   t=turns.setdefault(tid,{'id':tid,'label':label,'model':model,'time':d.get('timestamp'),'requests':[],'input':0,'cached':0,'output':0,'cacheKnown':True,'messageEstimate':latest_message})
   visible=dict(sources);req={'time':d.get('timestamp'),'input':i,'cached':c,'fresh':i-c if c is not None else None,'output':o,'cacheWrite':w,'sources':visible,'visibleEstimate':sum(visible.values()),'unattributed':None}
   # Reference only; service tier/auth billing not present in logs. Never label as invoice.
   if model=='gpt-6-astra' and c is not None and w is not None:
    mult=2 if i>272000 else 1;om=1.5 if i>272000 else 1
    req['standardUsd']=((i-c-w)*10*mult+c*mult+w*12.5*mult+o*50*om)/1e6
   t['requests'].append(req);t['input']+=i;t['cached']+=c or 0;t['output']+=o;t['cacheKnown'] &= c is not None
   sources.update(pending);pending.clear()
 return {'meta':meta,'turns':list(turns.values()),'invalidUsage':malformed,'method':METHOD}
