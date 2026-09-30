create or replace function public.normalize_job_url(u text) returns text language plpgsql immutable set search_path='' as $$
declare base text; query text; authority text; path text; scheme text; host text; part text; parts text[]='{}'; segments text[]; idx integer; port text; hostname text; bytes bytea; encoded text; n integer; begin
 u=split_part(trim(u),'#',1);
 if u is null or u ~ '[[:cntrl:]]' then raise exception 'Valid HTTP(S) job URL required'; end if;
 if length(u)>4096 or u !~* '^https?://[^/?#[:space:]@]+([/?]|$)' or position(chr(92) in u)>0 then raise exception 'Valid HTTP(S) job URL required'; end if;
 base=split_part(u,'?',1); authority=substring(base from '(?i)^https?://[^/]+');
 scheme=lower(split_part(authority,':',1));host=lower(substring(authority from position('://' in authority)+3));
 if host !~ '^([a-z0-9.-]+|\[[a-f0-9:]+\])(:[0-9]+)?$' then raise exception 'Use an ASCII or encoded domain name'; end if;
 port=substring(host from ':([0-9]+)$');
 if port is not null then
  if length(port)>10 or port::numeric>65535 then raise exception 'Invalid URL port'; end if;
  host=regexp_replace(host,':[0-9]+$',':'||(port::integer)::text);
 end if;
 hostname=regexp_replace(host,':[0-9]+$','');
 if hostname like '[%' then
  hostname='['||pg_catalog.host(trim(both '[]' from hostname)::inet)||']';
 elsif hostname ~ '^(0x[0-9a-f]+|[0-9]+)(\.(0x[0-9a-f]+|[0-9]+))*$' then
  if hostname !~ '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' or pg_catalog.host(hostname::inet)<>hostname then raise exception 'Use a canonical IPv4 address'; end if;
 end if;
 host=hostname||case when port is not null then ':'||(port::integer)::text else '' end;
 if scheme='https' then host=regexp_replace(host,':0*443$','');else host=regexp_replace(host,':0*80$','');end if;
 path=substring(base from length(authority)+1);
 bytes=convert_to(path,'UTF8'); encoded='';
 for idx in 0..length(bytes)-1 loop
  n=get_byte(bytes,idx);
  if n between 33 and 126 and n not in (34,60,62,96,123,125) then encoded=encoded||chr(n);
  else encoded=encoded||'%'||upper(lpad(to_hex(n),2,'0')); end if;
 end loop;
 path=encoded;
 segments=string_to_array(case when path='' then '/' else path end,'/');
 for idx in 2..coalesce(array_length(segments,1),1) loop
  part=segments[idx];
  if replace(lower(part),'%2e','.')='..' then parts=parts[1:greatest(coalesce(array_length(parts,1),0)-1,0)];if idx=array_length(segments,1) then parts=array_append(parts,'');end if;
  elsif replace(lower(part),'%2e','.')='.' then if idx=array_length(segments,1) then parts=array_append(parts,'');end if;
  else parts=array_append(parts,part);end if;
 end loop;
 base=scheme||'://'||host||'/'||coalesce(array_to_string(parts,'/'),'');
 if position('?' in u)>0 then
  select string_agg(public.url_encode(k)||'='||public.url_encode(v),'&' order by k collate "C",ord) into query from (
   select public.url_decode(split_part(param,'=',1)) k,public.url_decode(case when position('=' in param)>0 then substring(param from position('=' in param)+1) else '' end) v,ord
   from unnest(string_to_array(substring(u from position('?' in u)+1),'&')) with ordinality as q(param,ord) where param<>''
  ) q where lower(k) !~ '^utm_' and lower(k) not in ('gclid','fbclid','msclkid');
 end if;
 return base||case when query is null or query='' then '' else '?'||query end;
end $$;

-- Rebuild internal duplicate keys only; public URLs and historical timestamps stay intact.
-- A pre-existing collision aborts this migration rather than deleting any historical bid.
update public.bids set normalized_url=public.normalize_job_url(url) where normalized_url is distinct from public.normalize_job_url(url);
