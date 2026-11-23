from pathlib import Path
import concurrent.futures,hashlib,io,json,re,sqlite3,urllib.request,zipfile
root=Path(__file__).resolve().parent.parent; cache=root/'.work/geonames-downloads';cache.mkdir(parents=True,exist_ok=True)
codes='RU UA BY KZ KG UZ TJ TM AM AZ GE MD EE LV LT'.split()
names=dict(zip(codes,['Россия','Украина','Беларусь','Казахстан','Кыргызстан','Узбекистан','Таджикистан','Туркменистан','Армения','Азербайджан','Грузия','Молдова','Эстония','Латвия','Литва']))
base='https://download.geonames.org/export/dump/'
files=[c+'.zip' for c in codes]+['cities500.zip','admin1CodesASCII.txt','admin2Codes.txt','countryInfo.txt','readme.txt']+['alternatenames/'+c+'.zip' for c in codes]
def fetch(name):
    path=cache/name;path.parent.mkdir(parents=True,exist_ok=True)
    if not path.exists():
        req=urllib.request.Request(base+name,headers={'User-Agent':'Rodoslovnaya-data-preparation/1.5'})
        with urllib.request.urlopen(req,timeout=120) as response,path.with_suffix(path.suffix+'.part').open('wb') as f:
            while chunk:=response.read(1024*1024):f.write(chunk)
        path.with_suffix(path.suffix+'.part').replace(path)
    return name,path.stat().st_size
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    for name,size in pool.map(fetch,files):print(name,size,flush=True)
def lines(name):
    if name.endswith('.zip'):
        with zipfile.ZipFile(cache/name) as z, z.open(name[:-4]+'.txt') as f:
            for line in io.TextIOWrapper(f,encoding='utf-8'):yield line.rstrip('\n').split('\t')
    else:
        for line in (cache/name).read_text('utf-8').splitlines():
            if not line.startswith('#'):yield line.split('\t')
russian={};ru_variants={}
for code in codes:
    with zipfile.ZipFile(cache/'alternatenames'/f'{code}.zip') as z:
        for filename in z.namelist():
            if not filename.endswith('.txt'):continue
            with z.open(filename) as f:
                for line in io.TextIOWrapper(f,encoding='utf-8'):
                    r=line.rstrip('\n').split('\t')
                    if len(r)<8 or r[2]!='ru':continue
                    score=(r[7]!='1',r[4]=='1',r[5]=='1',r[6]!='1',-len(r[3]))
                    ru_variants.setdefault(r[1],[]).append(r[3])
                    if r[1] not in russian or score>russian[r[1]][0]:russian[r[1]]=(score,r[3])
def display(row):return russian.get(row[0],(None,row[1]))[1]
def admin_aliases(row):return ' '.join([row[1],*ru_variants.get(row[0],[])])
admin1={r[0]:(r[1],r[1]) for r in lines('admin1CodesASCII.txt') if len(r)>2}
admin2={r[0]:(r[1],r[1]) for r in lines('admin2Codes.txt') if len(r)>2}
countries={r[0]:names.get(r[0],r[4]) for r in lines('countryInfo.txt') if len(r)>5}
for code in codes:
    for r in lines(code+'.zip'):
        if len(r)<19 or r[6]!='A':continue
        if r[7]=='ADM1':admin1[f'{r[8]}.{r[10]}']=(display(r),admin_aliases(r))
        if r[7]=='ADM2':admin2[f'{r[8]}.{r[10]}.{r[11]}']=(display(r),admin_aliases(r))
dest=root/'app/assets';dest.mkdir(exist_ok=True);path=dest/'places.sqlite'
assert not path.exists(),'Catalog already exists; preserve it before rebuilding'
db=sqlite3.connect(path)
db.executescript('PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; CREATE TABLE places(id INTEGER PRIMARY KEY,name TEXT,aliases TEXT,lat REAL,lon REAL,country TEXT,region TEXT,district TEXT,kind TEXT,population INTEGER,search_name TEXT); CREATE VIRTUAL TABLE search USING fts5(words,content="",detail=none,columnsize=0);')
seen=set();counts={}
for name in ['cities500.zip',*[c+'.zip' for c in codes]]:
    n=0
    for r in lines(name):
        if len(r)<19 or r[6]!='P' or r[0] in seen:continue
        seen.add(r[0]);country=countries.get(r[8],r[8]);region,ra=admin1.get(f'{r[8]}.{r[10]}',('',''));district,da=admin2.get(f'{r[8]}.{r[10]}.{r[11]}',('',''))
        title=display(r);aliases=' '.join([r[1],r[2],r[3]])[:6000];words=' '.join(sorted(set(re.findall(r'[^\W_]+',' '.join([title,aliases,country,region,district,ra,da]).casefold().replace('ё','е')))))
        kind='историческое поселение' if r[7]=='PPLH' else 'бывший населённый пункт' if r[7] in ['PPLQ','PPLW'] else 'столица' if r[7]=='PPLC' else 'населённый пункт'
        db.execute('INSERT INTO places VALUES(?,?,?,?,?,?,?,?,?,?,?)',(int(r[0]),title,aliases,float(r[4]),float(r[5]),country,region,district,kind,int(r[14] or 0),title.casefold().replace('ё','е')))
        db.execute('INSERT INTO search(rowid,words) VALUES(?,?)',(int(r[0]),words));n+=1
    counts[name]=n;db.commit();print('Indexed',name,n,flush=True)
db.execute("INSERT INTO search(search) VALUES('optimize')");db.commit()
db.execute('VACUUM')
assert db.execute('pragma integrity_check').fetchone()[0]=='ok';db.close()
meta={'source':base,'license':'CC BY 4.0','coverage':{'country_archives':codes,'other_countries':'cities500'},'counts':counts,'total':len(seen),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'bytes':path.stat().st_size}
(dest/'places-manifest.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2),'utf-8')
(dest/'GeoNames-NOTICE.txt').write_text('Населённые пункты: GeoNames — https://www.geonames.org/\nЛицензия CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/\nИсточник: '+base+'\nКаталог подготовлен при сборке установщика. Полные выгрузки населённых пунктов: '+', '.join(codes)+'. Остальной мир: cities500.\nНазвания и варианты написания объединены для локального поиска; сведения могут быть неполными или историческими.\n','utf-8')
print(json.dumps(meta,ensure_ascii=False),flush=True)
