use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use chrono::Utc;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};
use uuid::Uuid;
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};
pub mod geography;
mod maintenance;
mod purge;
mod media_import;
mod recognition;

pub type Result<T> = std::result::Result<T, String>;
pub type Data = BTreeMap<String, BTreeMap<String, Value>>;
pub const KINDS: &[&str] = &[
    "people",
    "relationships",
    "media",
    "tags",
    "texts",
    "text_links",
    "sources",
    "facts",
    "events",
];

/// Populate a new installation from its read-only bundled archive, without replacing user data.
pub fn initialize_seed(root: &Path, seed: &Path) -> Result<bool> {
    if root.join("family.sqlite").exists() || !seed.join("family.sqlite").is_file() {
        return Ok(false);
    }
    if root.exists()
        && fs::read_dir(root)
            .map_err(|e| e.to_string())?
            .next()
            .is_some()
    {
        return Err("Выбранная папка уже содержит файлы. Откройте её как отдельный архив.".into());
    }
    let parent = root.parent().ok_or("Не найдена папка архива")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let staging = parent.join(format!(".family-setup-{}", Uuid::new_v4()));
    fs::create_dir(&staging).map_err(|e| e.to_string())?;
    fn copy_dir(source: &Path, target: &Path) -> Result<()> {
        fs::create_dir_all(target).map_err(|e| e.to_string())?;
        for entry in fs::read_dir(source).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let ty = entry.file_type().map_err(|e| e.to_string())?;
            if ty.is_dir() {
                copy_dir(&entry.path(), &target.join(entry.file_name()))?;
            } else if ty.is_file() {
                fs::copy(entry.path(), target.join(entry.file_name()))
                    .map_err(|e| e.to_string())?;
            } else {
                return Err("Недопустимый файл начального архива".into());
            }
        }
        Ok(())
    }
    for part in ["media", "thumbs"] {
        let source = seed.join(part);
        if source.is_dir() {
            copy_dir(&source, &staging.join(part))?;
        }
    }
    fs::copy(seed.join("family.sqlite"), staging.join("family.sqlite"))
        .map_err(|e| e.to_string())?;
    if root.exists() {
        fs::remove_dir(root).map_err(|e| e.to_string())?;
    }
    fs::rename(&staging, root).map_err(|e| e.to_string())?;
    Ok(true)
}
fn now() -> String {
    Utc::now().to_rfc3339()
}
fn id() -> String {
    Uuid::new_v4().to_string()
}
fn stable(s: &str) -> String {
    Uuid::new_v5(&Uuid::NAMESPACE_URL, s.as_bytes()).to_string()
}
fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn snapshot_hash(d: &Data) -> String {
    let mut compatible = d.clone();
    if compatible.get("events").is_some_and(|v| v.is_empty()) {
        compatible.remove("events");
    }
    digest(&serde_json::to_vec(&compatible).unwrap())
}
fn string_ids(v: &Value, key: &str) -> Vec<String> {
    v.get(key)
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_owned)
        .collect()
}
fn date_bounds(value: &str) -> Option<(chrono::NaiveDate, chrono::NaiveDate)> {
    let parts: Vec<&str> = value.split('-').collect();
    if parts.is_empty()
        || parts.len() > 3
        || parts[0].len() != 4
        || parts.iter().skip(1).any(|p| p.len() != 2)
    {
        return None;
    }
    let year = parts[0].parse::<i32>().ok()?;
    if !(1..=9999).contains(&year) {
        return None;
    }
    let month = if parts.len() > 1 {
        parts[1].parse::<u32>().ok()?
    } else {
        1
    };
    let day = if parts.len() > 2 {
        parts[2].parse::<u32>().ok()?
    } else {
        1
    };
    let start = chrono::NaiveDate::from_ymd_opt(year, month, day)?;
    let end = if parts.len() == 3 {
        start
    } else if parts.len() == 1 {
        chrono::NaiveDate::from_ymd_opt(year, 12, 31)?
    } else {
        (28..=31)
            .rev()
            .find_map(|d| chrono::NaiveDate::from_ymd_opt(year, month, d))?
    };
    Some((start, end))
}
fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v.get(k).and_then(Value::as_str).unwrap_or("")
}
fn blank(v: &Value) -> bool {
    v.is_null() || v.as_str().is_some_and(|x| x.trim().is_empty())
}
fn rows<'a>(d: &'a Data, kind: &str) -> impl Iterator<Item = &'a Value> {
    d.get(kind).into_iter().flat_map(|m| m.values())
}
fn put(d: &mut Data, kind: &str, v: Value) {
    d.entry(kind.into())
        .or_default()
        .insert(s(&v, "id").to_owned(), v);
}
fn has(d: &Data, kind: &str, key: &str) -> bool {
    d.get(kind).is_some_and(|m| m.contains_key(key))
}
fn norm(x: &str) -> String {
    x.to_lowercase()
        .replace('ё', "е")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}
fn name(p: &Value) -> String {
    [s(p, "surname"), s(p, "given_name"), s(p, "patronymic")]
        .iter()
        .filter(|x| !x.is_empty())
        .cloned()
        .collect::<Vec<_>>()
        .join(" ")
}
fn empty_data() -> Data {
    KINDS
        .iter()
        .map(|k| (k.to_string(), BTreeMap::new()))
        .collect()
}
fn refs_in_doc(v: &Value, output: &mut BTreeSet<String>) {
    if let Some(o) = v.as_object() {
        if s(v, "type") == "personLink" {
            if let Some(p) = v.pointer("/attrs/personId").and_then(Value::as_str) {
                output.insert(p.into());
            }
        }
        for child in o.values() {
            refs_in_doc(child, output);
        }
    }
    if let Some(a) = v.as_array() {
        for child in a {
            refs_in_doc(child, output);
        }
    }
}
fn map_doc(v: &mut Value, map: &HashMap<String, String>, keep_unknown: bool) {
    if let Some(a) = v.as_array_mut() {
        a.retain(|x| {
            s(x, "type") != "personLink"
                || keep_unknown
                || x.pointer("/attrs/personId")
                    .and_then(Value::as_str)
                    .is_some_and(|p| map.contains_key(p))
        });
        for x in a {
            map_doc(x, map, keep_unknown);
        }
    }
    if let Some(o) = v.as_object_mut() {
        if o.get("type").and_then(Value::as_str) == Some("personLink") {
            if let Some(p) = o.get_mut("attrs").and_then(|a| a.get_mut("personId")) {
                if let Some(to) = p.as_str().and_then(|x| map.get(x)) {
                    *p = json!(to);
                }
            }
        }
        for x in o.values_mut() {
            map_doc(x, map, keep_unknown);
        }
    }
}

pub fn validate(d: &Data) -> Result<()> {
    for (kind, entries) in d {
        for (key, v) in entries {
            if key.is_empty() || key.len() > 200 || s(v, "id") != key || !v.is_object() {
                return Err(format!("Некорректная запись {kind}"));
            }
        }
    }
    for p in rows(d, "people") {
        if p.get("autobiography").is_some_and(|v| !v.is_string()) {
            return Err("Автобиография должна содержать текст".into());
        }
        if name(p).trim().is_empty() {
            return Err("У человека должно быть указано имя или фамилия".into());
        }
        if !s(p, "avatar_id").is_empty() && !has(d, "media", s(p, "avatar_id")) {
            return Err("Портрет ссылается на отсутствующий файл".into());
        }
        if let Some(crop) = p.get("avatar_crop").filter(|v| !v.is_null()) {
            let n = |k| crop.get(k).and_then(Value::as_f64).unwrap_or(f64::NAN);
            if s(p, "avatar_id").is_empty()
                || ![n("x"), n("y"), n("w"), n("h")]
                    .iter()
                    .all(|v| v.is_finite())
                || n("x") < 0.0
                || n("y") < 0.0
                || n("w") <= 0.0
                || n("h") <= 0.0
                || n("x") + n("w") > 1.00001
                || n("y") + n("h") > 1.00001
            {
                return Err(
                    "Область портрета должна находиться внутри выбранной фотографии".into(),
                );
            }
        }
    }
    for media in rows(d, "media") {
        // Legacy free-form dates stay readable. Edited dates carry explicit precision.
        if let Some(precision) = media.get("date_precision") {
            let precision = precision.as_str().unwrap_or("");
            let length = match precision {
                "day" => 10,
                "month" => 7,
                "year" => 4,
                _ => return Err("Выберите точность даты фотографии".into()),
            };
            let value = media
                .get("date")
                .and_then(Value::as_str)
                .ok_or("Укажите дату фотографии")?;
            if !value.is_empty() && (value.len() != length || date_bounds(value).is_none()) {
                return Err("Некорректная дата фотографии или документа".into());
            }
        }
        let lat = media.get("latitude").filter(|v| !v.is_null());
        let lon = media.get("longitude").filter(|v| !v.is_null());
        if (lat.is_some() || lon.is_some())
            && (!lat
                .and_then(Value::as_f64)
                .is_some_and(|x| x.is_finite() && (-90.0..=90.0).contains(&x))
                || !lon
                    .and_then(Value::as_f64)
                    .is_some_and(|x| x.is_finite() && (-180.0..=180.0).contains(&x)))
        {
            return Err("Проверьте координаты фотографии или документа".into());
        }
    }
    let mut graph: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for r in rows(d, "relationships") {
        let (a, b) = (s(r, "from_id"), s(r, "to_id"));
        if !["parent", "partner"].contains(&s(r, "kind")) {
            return Err("Неизвестный вид родства".into());
        }
        if a == b || !has(d, "people", a) || !has(d, "people", b) {
            return Err(
                "Родственная связь ссылается на отсутствующего человека или на себя".into(),
            );
        }
        if s(r, "kind") == "parent" {
            graph.entry(a.into()).or_default().push(b.into());
        }
    }
    fn visit(
        p: &str,
        g: &BTreeMap<String, Vec<String>>,
        active: &mut BTreeSet<String>,
        done: &mut BTreeSet<String>,
    ) -> bool {
        if done.contains(p) {
            return true;
        }
        if !active.insert(p.into()) {
            return false;
        }
        for ch in g.get(p).into_iter().flatten() {
            if !visit(ch, g, active, done) {
                return false;
            }
        }
        active.remove(p);
        done.insert(p.into());
        true
    }
    let mut done = BTreeSet::new();
    for p in graph.keys() {
        if !visit(p, &graph, &mut BTreeSet::new(), &mut done) {
            return Err("Связь образует цикл: человек не может быть своим предком".into());
        }
    }
    for t in rows(d, "tags") {
        if !has(d, "media", s(t, "media_id")) {
            return Err("Отметка без фотографии".into());
        }
        if !s(t, "person_id").is_empty() && !has(d, "people", s(t, "person_id")) {
            return Err("Отметка ссылается на отсутствующего человека".into());
        }
        if !t.get("x").unwrap_or(&Value::Null).is_null() {
            let n = |k| t.get(k).and_then(Value::as_f64).unwrap_or(f64::NAN);
            if ![n("x"), n("y"), n("w"), n("h")]
                .iter()
                .all(|v| v.is_finite())
                || n("x") < 0.0
                || n("y") < 0.0
                || n("w") <= 0.0
                || n("h") <= 0.0
                || n("x") + n("w") > 1.00001
                || n("y") + n("h") > 1.00001
            {
                return Err("Рамка должна находиться внутри фотографии".into());
            }
        }
    }
    for t in rows(d, "texts") {
        if !s(t, "author_id").is_empty() && !has(d, "people", s(t, "author_id")) {
            return Err("Автор текста не найден".into());
        }
        let mut refs = BTreeSet::new();
        refs_in_doc(&t["content"], &mut refs);
        if refs.iter().any(|p| !has(d, "people", p)) {
            return Err("В тексте есть ссылка на отсутствующего человека".into());
        }
    }
    for t in rows(d, "text_links") {
        if !has(d, "texts", s(t, "text_id")) || !has(d, "people", s(t, "person_id")) {
            return Err("Некорректная связь текста и человека".into());
        }
    }
    for f in rows(d, "facts") {
        if !has(d, "people", s(f, "person_id")) {
            return Err("Сведения ссылаются на отсутствующего человека".into());
        }
    }
    for e in rows(d, "events") {
        if s(e, "title").trim().is_empty() {
            return Err("Укажите заголовок события".into());
        }
        for key in ["start_date", "end_date"] {
            if !s(e, key).is_empty() && date_bounds(s(e, key)).is_none() {
                return Err("Дата события: укажите ГГГГ, ГГГГ-ММ или ГГГГ-ММ-ДД".into());
            }
        }
        if !s(e, "end_date").is_empty() {
            let start = date_bounds(s(e, "start_date")).ok_or("Укажите начало события")?;
            if date_bounds(s(e, "end_date")).unwrap().1 < start.0 {
                return Err("Окончание события раньше начала".into());
            }
        }
        for (key, kind) in [("person_ids", "people"), ("media_ids", "media")] {
            if let Some(value) = e.get(key) {
                let list = value
                    .as_array()
                    .ok_or("Некорректный список участников или фотографий")?;
                if list
                    .iter()
                    .any(|x| x.as_str().is_none_or(|id| !has(d, kind, id)))
                {
                    return Err(
                        "Событие ссылается на отсутствующего участника или фотографию".into(),
                    );
                }
            }
        }
        if !s(e, "cover_media_id").is_empty()
            && !string_ids(e, "media_ids").contains(&s(e, "cover_media_id").to_string())
        {
            return Err("Главное фото должно входить в фотографии события".into());
        }
        let lat = e.get("latitude").filter(|v| !v.is_null());
        let lon = e.get("longitude").filter(|v| !v.is_null());
        if lat.is_some() || lon.is_some() {
            if !lat
                .and_then(Value::as_f64)
                .is_some_and(|x| x.is_finite() && (-90.0..=90.0).contains(&x))
                || !lon
                    .and_then(Value::as_f64)
                    .is_some_and(|x| x.is_finite() && (-180.0..=180.0).contains(&x))
            {
                return Err("Проверьте координаты события".into());
            }
        }
    }
    Ok(())
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Package {
    pub format: String,
    pub version: u32,
    pub package_id: String,
    pub origin_tree_id: String,
    pub title: String,
    pub created_at: String,
    pub data: Data,
}
pub struct Engine {
    pub root: PathBuf,
    conn: Connection,
}
impl Engine {
    pub fn open(root: impl AsRef<Path>) -> Result<Self> {
        let root = root.as_ref().to_path_buf();
        fs::create_dir_all(root.join("media")).map_err(|e| e.to_string())?;
        fs::create_dir_all(root.join("thumbs")).map_err(|e| e.to_string())?;
        let conn = Connection::open(root.join("family.sqlite")).map_err(|e| e.to_string())?;
        conn.execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
          CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS pending_file_deletions(path TEXT PRIMARY KEY);
          CREATE TABLE IF NOT EXISTS entities(kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL CHECK(json_valid(data)),PRIMARY KEY(kind,id));
          CREATE INDEX IF NOT EXISTS entity_person ON entities(kind,json_extract(data,'$.person_id'));
          CREATE TABLE IF NOT EXISTS history(id TEXT PRIMARY KEY,title TEXT NOT NULL,created_at TEXT NOT NULL,before_json TEXT NOT NULL,after_hash TEXT NOT NULL,undone INTEGER NOT NULL DEFAULT 0);
          CREATE TABLE IF NOT EXISTS analysis_cache(kind TEXT NOT NULL,media_id TEXT NOT NULL,sha256 TEXT NOT NULL,version TEXT NOT NULL,payload TEXT NOT NULL CHECK(json_valid(payload)),updated_at TEXT NOT NULL,PRIMARY KEY(kind,media_id,version));
          PRAGMA user_version=1;").map_err(|e|e.to_string())?;
        conn.execute("INSERT OR IGNORE INTO meta VALUES('tree_id',?1)", [id()])
            .map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR IGNORE INTO meta VALUES('title','Семейный архив')",
            [],
        )
        .map_err(|e| e.to_string())?;
        let mut engine = Self { root, conn };
        engine.drain_file_deletions()?;
        Ok(engine)
    }
    fn meta(&self, key: &str) -> String {
        self.conn
            .query_row("SELECT value FROM meta WHERE key=?1", [key], |r| r.get(0))
            .unwrap_or_default()
    }
    pub fn data(&self) -> Result<Data> {
        let mut d = empty_data();
        let mut st = self
            .conn
            .prepare("SELECT kind,id,data FROM entities ORDER BY kind,id")
            .map_err(|e| e.to_string())?;
        let it = st
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for row in it {
            let (k, i, v) = row.map_err(|e| e.to_string())?;
            d.entry(k)
                .or_default()
                .insert(i, serde_json::from_str(&v).map_err(|e| e.to_string())?);
        }
        Ok(d)
    }
    fn commit(&mut self, d: &Data, title: &str) -> Result<Value> {
        let mut normalized = d.clone();
        normalized.retain(|kind, entries| KINDS.contains(&kind.as_str()) || !entries.is_empty());
        for kind in KINDS {
            normalized.entry((*kind).into()).or_default();
        }
        let d = &normalized;
        validate(d)?;
        let before = self.data()?;
        if before == *d {
            return Ok(json!({"changed":false}));
        }
        let hid = id();
        let hash = snapshot_hash(d);
        let tx = self.conn.transaction().map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM entities", [])
            .map_err(|e| e.to_string())?;
        for (k, entries) in d {
            for (i, v) in entries {
                tx.execute(
                    "INSERT INTO entities VALUES(?1,?2,?3)",
                    params![k, i, v.to_string()],
                )
                .map_err(|e| e.to_string())?;
            }
        }
        tx.execute("INSERT INTO history(id,title,created_at,before_json,after_hash) VALUES(?1,?2,?3,?4,?5)",params![hid,title,now(),serde_json::to_string(&before).unwrap(),hash]).map_err(|e|e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(json!({"changed":true,"history_id":hid}))
    }
    fn history(&self) -> Result<Value> {
        let mut st=self.conn.prepare("SELECT id,title,created_at,undone,after_hash FROM history ORDER BY rowid DESC LIMIT 100").map_err(|e|e.to_string())?;
        let current = snapshot_hash(&self.data()?);
        let rows=st.query_map([],|r|{let h:String=r.get(4)?;let undone:i32=r.get(3)?;Ok(json!({"id":r.get::<_,String>(0)?,"title":r.get::<_,String>(1)?,"created_at":r.get::<_,String>(2)?,"undone":undone!=0,"can_undo":undone==0&&h==current}))}).map_err(|e|e.to_string())?;
        Ok(Value::Array(
            rows.collect::<std::result::Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?,
        ))
    }
    fn undo(&mut self, key: &str) -> Result<Value> {
        let (before, hash, undone): (String, String, i32) = self
            .conn
            .query_row(
                "SELECT before_json,after_hash,undone FROM history WHERE id=?1",
                [key],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .map_err(|e| e.to_string())?;
        if undone != 0 || snapshot_hash(&self.data()?) != hash {
            return Err(
                "После этого действия появились другие изменения. Сначала отмените их.".into(),
            );
        }
        let d: Data = serde_json::from_str(&before).map_err(|e| e.to_string())?;
        validate(&d)?;
        let tx = self.conn.transaction().map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM entities", [])
            .map_err(|e| e.to_string())?;
        for (k, items) in d {
            for (i, v) in items {
                tx.execute(
                    "INSERT INTO entities VALUES(?1,?2,?3)",
                    params![k, i, v.to_string()],
                )
                .map_err(|e| e.to_string())?;
            }
        }
        tx.execute("UPDATE history SET undone=1 WHERE id=?1", [key])
            .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(json!({"undone":true}))
    }
    fn safe_file(&self, rel: &str) -> Result<PathBuf> {
        let p = Path::new(rel);
        if p.is_absolute()
            || p.components()
                .any(|c| !matches!(c, std::path::Component::Normal(_)))
        {
            return Err("Недопустимый путь файла".into());
        }
        if (!rel.starts_with("media/") && !rel.starts_with("thumbs/"))
            || rel.contains('\\')
            || rel.contains(':')
            || p.components().count() != 2
        {
            return Err("Файл находится вне архива".into());
        }
        Ok(self.root.join(p))
    }
    fn add_media(&mut self, p: &Value) -> Result<Value> {
        self.check_import_tree(p)?;
        let raw = B64.decode(s(p, "base64")).map_err(|e| e.to_string())?;
        if raw.is_empty() || raw.len() > 256 * 1024 * 1024 {
            return Err("Размер файла должен быть от 1 байта до 256 МБ".into());
        }
        let hash = digest(&raw);
        let requested_kind = s(p, "kind");
        if !requested_kind.is_empty() && !["photo", "document"].contains(&requested_kind) {
            return Err("Выберите фотоальбом или документы".into());
        }
        let media_kind = if requested_kind == "document" || !s(p, "mime").starts_with("image/") {
            "document"
        } else {
            "photo"
        };
        let mut d = self.data()?;
        let duplicates=self.media_matches(&hash)?;
        if !duplicates.is_empty(){
            let action=s(p,"duplicate_action");
            if action.is_empty(){return Ok(json!({"needs_confirmation":true,"duplicates":duplicates}));}
            let existing=duplicates.iter().find(|m|s(m,"id")==s(p,"duplicate_id")).ok_or("Выбранный дубликат изменился. Повторите проверку.")?;
            if action=="use"{
                if maintenance::trashed(existing){return Err("Этот материал находится в корзине. Выберите восстановление или отдельную копию.".into());}
                return Ok(json!({"id":s(existing,"id"),"reused":true}));
            }
            if action=="restore"{
                if !maintenance::trashed(existing){return Err("Материал уже восстановлен. Повторите проверку.".into());}
                self.restore_items(&json!({"kind":"media","ids":[s(existing,"id")]}))?;
                return Ok(json!({"id":s(existing,"id"),"restored":true}));
            }
            if action!="copy"{return Err("Подтвердите действие с найденным дубликатом".into());}
        }
        let filename = s(p, "filename");
        let ext = Path::new(filename)
            .extension()
            .and_then(|x| x.to_str())
            .unwrap_or("bin")
            .to_lowercase();
        if ext.len() > 12 || !ext.chars().all(|c| c.is_ascii_alphanumeric()) {
            return Err("Некорректное расширение файла".into());
        }
        let rel = format!("media/{hash}.{ext}");
        let file_path=self.safe_file(&rel)?;
        if !file_path.exists(){fs::write(file_path, raw).map_err(|e| e.to_string())?;}
        let mut thumb = String::new();
        if let Some(t) = p.get("thumbnail").and_then(Value::as_str) {
            if !t.is_empty() {
                let bytes = B64.decode(t).map_err(|e| e.to_string())?;
                if bytes.len() > 2 * 1024 * 1024 {
                    return Err("Слишком большая миниатюра".into());
                }
                thumb = format!("thumbs/{hash}.jpg");
                let thumb_path=self.safe_file(&thumb)?;
                if !thumb_path.exists(){fs::write(thumb_path, bytes).map_err(|e| e.to_string())?;}
            }
        }
        let mid = id();
        put(
            &mut d,
            "media",
            json!({"id":mid,"title":p.get("title").and_then(Value::as_str).unwrap_or(filename),"filename":filename,"file":rel,"thumb":thumb,"mime":s(p,"mime"),"sha256":hash,"kind":media_kind,"description":"","date":"","place":"","source_id":"","created_at":now()}),
        );
        self.commit(&d, "Добавлен файл в архив")?;
        Ok(json!({"id":mid}))
    }
    fn save(&mut self, p: &Value) -> Result<Value> {
        let kind = s(p, "kind");
        if !KINDS.contains(&kind) {
            return Err("Неизвестный раздел".into());
        }
        let mut d = self.data()?;
        let mut v = p["record"].clone();
        if !v.is_object() {
            return Err("Некорректные данные".into());
        }
        if s(&v, "id").is_empty() {
            v["id"] = json!(id());
        }
        v["updated_at"] = json!(now());
        let key = s(&v, "id").to_string();
        {
            if let Some(existing) = d[kind].get(&key) {
                let mut merged = existing.clone();
                for (k, val) in v.as_object().unwrap() {
                    merged[k] = val.clone();
                }
                v = merged;
            }
        }
        put(&mut d, kind, v);
        if kind == "texts" {
            if let Some(subjects) = p.get("subjects").and_then(Value::as_array) {
                let remove_links: BTreeSet<String> = rows(&d, "text_links")
                    .filter(|l| maintenance::resolve(&d, "texts", s(l, "text_id")) == key)
                    .map(|l| s(l, "id").to_string())
                    .collect();
                d.entry("text_links".into())
                    .or_default()
                    .retain(|id, _| !remove_links.contains(id));
                for person in subjects.iter().filter_map(Value::as_str) {
                    put(
                        &mut d,
                        "text_links",
                        json!({"id":stable(&format!("{key}:{person}:subject")),"text_id":key,"person_id":person,"kind":"subject"}),
                    );
                }
            }
        }
        let result = self.commit(
            &d,
            p.get("title")
                .and_then(Value::as_str)
                .unwrap_or("Изменение архива"),
        )?;
        Ok(json!({"id":key,"result":result}))
    }
    fn remove(&mut self, p: &Value) -> Result<Value> {
        if ["media", "texts"].contains(&s(p, "kind")) {
            return self.trash_items(
                &json!({"kind":s(p,"kind"),"ids":[s(p,"id")],"confirm_marked":p["confirm_marked"]}),
            );
        }
        let kind = s(p, "kind");
        if !KINDS.contains(&kind) {
            return Err("Неизвестный раздел".into());
        }
        let key = s(p, "id");
        let mut d = self.data()?;
        if kind == "people" {
            return Err("Чтобы сохранить родственные связи, удаление человека выполняется через объединение записей".into());
        }
        if let Some(items) = d.get_mut(kind) {
            items.remove(key);
        }
        if kind == "media" {
            for event in d.entry("events".into()).or_default().values_mut() {
                event["media_ids"] = json!(string_ids(event, "media_ids")
                    .into_iter()
                    .filter(|x| x != key)
                    .collect::<Vec<_>>());
                if s(event, "cover_media_id") == key {
                    event["cover_media_id"] = json!("");
                }
            }
            d.entry("tags".into())
                .or_default()
                .retain(|_, v| s(v, "media_id") != key);
            for person in d.entry("people".into()).or_default().values_mut() {
                if s(person, "avatar_id") == key {
                    person["avatar_id"] = json!("");
                    person["avatar_crop"] = Value::Null;
                }
            }
            for source in d.entry("sources".into()).or_default().values_mut() {
                if s(source, "attachment_id") == key {
                    source["attachment_id"] = json!("");
                }
            }
        }
        if kind == "texts" {
            d.entry("text_links".into())
                .or_default()
                .retain(|_, v| s(v, "text_id") != key);
        }
        self.commit(&d, "Удаление записи")
    }
    fn merge_people(&mut self, p: &Value) -> Result<Value> {
        let (from, to) = (s(p, "from_id"), s(p, "to_id"));
        let mut d = self.data()?;
        if from == to || !has(&d, "people", from) || !has(&d, "people", to) {
            return Err("Выберите две разные карточки".into());
        }
        let old = d["people"][from].clone();
        let target = d["people"][to].clone();
        let mut updated = target.clone();
        for (k, v) in old.as_object().unwrap() {
            if ["id", "extra", "source_id", "external_id", "updated_at"].contains(&k.as_str()) {
                continue;
            }
            if k == "avatar_crop"
                && !s(&target, "avatar_id").is_empty()
                && s(&target, "avatar_id") != s(&old, "avatar_id")
            {
                continue;
            }
            if blank(updated.get(k).unwrap_or(&Value::Null)) {
                updated[k] = v.clone();
            } else if !blank(v) && target.get(k) != Some(v) {
                put(
                    &mut d,
                    "facts",
                    json!({"id":stable(&format!("local-merge:{from}:{to}:{k}:{}",v)),"person_id":to,"kind":"alternative","field":k,"title":format!("Сведения объединённой карточки: {k}"),"value":v,"source_id":s(&old,"source_id")}),
                );
            }
        }
        let merged_id = stable(&format!("merged-record:{from}:{to}"));
        put(
            &mut d,
            "facts",
            json!({"id":merged_id,"person_id":to,"kind":"merged_record","title":"Исходная объединённая карточка","value":old,"source_id":s(&old,"source_id")}),
        );
        d.get_mut("people").unwrap().remove(from);
        put(&mut d, "people", updated);
        let mapping = HashMap::from([(from.to_string(), to.to_string())]);
        for event in d.entry("events".into()).or_default().values_mut() {
            event["person_ids"] = json!(string_ids(event, "person_ids")
                .into_iter()
                .map(|x| if x == from { to.to_string() } else { x })
                .collect::<BTreeSet<_>>());
        }
        for kind in ["relationships", "tags", "text_links", "facts"] {
            for v in d.entry(kind.into()).or_default().values_mut() {
                for key in ["person_id", "from_id", "to_id"] {
                    if s(v, key) == from {
                        v[key] = json!(to);
                    }
                }
            }
        }
        for v in d.entry("texts".into()).or_default().values_mut() {
            if s(v, "author_id") == from {
                v["author_id"] = json!(to);
            }
            map_doc(&mut v["content"], &mapping, true);
        }
        for v in d.entry("_maps".into()).or_default().values_mut() {
            if s(v, "local_id") == from {
                v["local_id"] = json!(to);
            }
        }
        for kind in ["relationships", "text_links"] {
            let mut seen = BTreeSet::new();
            d.entry(kind.into()).or_default().retain(|_, v| {
                let mut ends = [s(v, "from_id").to_string(), s(v, "to_id").to_string()];
                if s(v, "kind") == "partner" {
                    ends.sort();
                }
                let signature = if kind == "relationships" {
                    format!("{}:{ends:?}", s(v, "kind"))
                } else {
                    format!("{}:{}", s(v, "text_id"), s(v, "person_id"))
                };
                seen.insert(signature)
            });
        }
        self.commit(&d, &format!("Объединены карточки: {}", name(&old)))
    }
    pub fn branch(&self, p: &Value) -> Result<Package> {
        let all = maintenance::visible_data(&self.data()?);
        let mut selected: BTreeSet<String> = p
            .get("people_ids")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect();
        let root = s(p, "root_id");
        let mode = s(p, "mode");
        if selected.is_empty() {
            if mode == "all" {
                selected.extend(all["people"].keys().cloned());
            } else {
                if !has(&all, "people", root) {
                    return Err("Выберите человека для ветки".into());
                }
                selected.insert(root.into());
                let mut frontier = vec![root.to_string()];
                if mode == "maternal" || mode == "paternal" {
                    frontier = rows(&all, "relationships")
                        .filter(|r| s(r, "kind") == "parent" && s(r, "to_id") == root)
                        .filter(|r| {
                            let par = &all["people"][s(r, "from_id")];
                            if mode == "maternal" {
                                s(r, "role") == "mother" || s(par, "gender") == "F"
                            } else {
                                s(r, "role") == "father" || s(par, "gender") == "M"
                            }
                        })
                        .map(|r| s(r, "from_id").to_string())
                        .collect();
                    selected.extend(frontier.iter().cloned());
                }
                while let Some(cur) = frontier.pop() {
                    for r in rows(&all, "relationships").filter(|r| s(r, "kind") == "parent") {
                        let next = if mode == "descendants" && s(r, "from_id") == cur {
                            Some(s(r, "to_id"))
                        } else if mode != "descendants" && s(r, "to_id") == cur {
                            Some(s(r, "from_id"))
                        } else {
                            None
                        };
                        if let Some(next) = next {
                            if selected.insert(next.into()) {
                                frontier.push(next.into());
                            }
                        }
                    }
                }
            }
        }
        if selected.iter().any(|p| !has(&all, "people", p)) {
            return Err("В выбранной ветке есть неизвестный человек".into());
        }
        let mut d = empty_data();
        let include_media = p
            .get("include_media")
            .and_then(Value::as_bool)
            .unwrap_or(true);
        let include_texts = p
            .get("include_texts")
            .and_then(Value::as_bool)
            .unwrap_or(true);
        for person in rows(&all, "people").filter(|v| selected.contains(s(v, "id"))) {
            let mut person = person.clone();
            if !include_media {
                person["avatar_id"] = json!("");
                person["avatar_crop"] = Value::Null;
            }
            put(&mut d, "people", person);
        }
        for r in rows(&all, "relationships")
            .filter(|v| selected.contains(s(v, "from_id")) && selected.contains(s(v, "to_id")))
        {
            put(&mut d, "relationships", r.clone());
        }
        for f in rows(&all, "facts").filter(|v| selected.contains(s(v, "person_id"))) {
            put(&mut d, "facts", f.clone());
        }
        for event in rows(&all, "events").filter(|v| {
            mode == "all"
                || string_ids(v, "person_ids")
                    .iter()
                    .any(|x| selected.contains(x))
        }) {
            let mut event = event.clone();
            event["person_ids"] = json!(string_ids(&event, "person_ids")
                .into_iter()
                .filter(|x| selected.contains(x))
                .collect::<Vec<_>>());
            if !include_media {
                event["media_ids"] = json!([]);
                event["cover_media_id"] = json!("");
            }
            put(&mut d, "events", event);
        }
        if include_media {
            for t in rows(&all, "tags").filter(|v| selected.contains(s(v, "person_id"))) {
                put(&mut d, "tags", t.clone());
            }
            let mut mids: BTreeSet<String> =
                rows(&d, "tags").map(|t| s(t, "media_id").into()).collect();
            mids.extend(rows(&d, "events").flat_map(|e| string_ids(e, "media_ids")));
            mids.extend(
                rows(&d, "people")
                    .map(|p| s(p, "avatar_id").to_string())
                    .filter(|x| !x.is_empty()),
            );
            if mode == "all" {
                mids.extend(all["media"].keys().cloned());
            }
            for m in rows(&all, "media").filter(|v| mids.contains(s(v, "id"))) {
                put(&mut d, "media", m.clone());
            }
            if mode == "all" {
                for t in rows(&all, "tags") {
                    put(&mut d, "tags", t.clone());
                }
            }
        }
        if include_texts {
            let mut tids: BTreeSet<String> = rows(&all, "text_links")
                .filter(|l| selected.contains(s(l, "person_id")))
                .map(|l| s(l, "text_id").into())
                .collect();
            for t in rows(&all, "texts") {
                let mut refs = BTreeSet::new();
                refs_in_doc(&t["content"], &mut refs);
                if mode == "all"
                    || selected.contains(s(t, "author_id"))
                    || !refs.is_disjoint(&selected)
                {
                    tids.insert(s(t, "id").into());
                }
            }
            let mapping = selected.iter().map(|x| (x.clone(), x.clone())).collect();
            for t in rows(&all, "texts").filter(|t| tids.contains(s(t, "id"))) {
                let mut t = t.clone();
                map_doc(&mut t["content"], &mapping, false);
                if !selected.contains(s(&t, "author_id")) {
                    t["author_id"] = json!("");
                }
                put(&mut d, "texts", t);
            }
            for l in rows(&all, "text_links")
                .filter(|l| tids.contains(s(l, "text_id")) && selected.contains(s(l, "person_id")))
            {
                put(&mut d, "text_links", l.clone());
            }
        }
        for source in rows(&all, "sources") {
            let mut v = source.clone();
            if mode != "all" {
                v["attachment_id"] = json!("");
            }
            put(&mut d, "sources", v);
        }
        if d.get("events").is_some_and(|events| events.is_empty()) {
            d.remove("events");
        }
        Ok(Package {
            format: "family-archive".into(),
            version: 1,
            package_id: id(),
            origin_tree_id: self.meta("tree_id"),
            title: p
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or("Ветка семьи")
                .into(),
            created_at: now(),
            data: d,
        })
    }
    pub fn export(&self, p: &Value) -> Result<Value> {
        let package = self.branch(p)?;
        validate(&package.data)?;
        let path = PathBuf::from(s(p, "path"));
        if path.as_os_str().is_empty() {
            return Err("Не указан файл".into());
        }
        if path.exists() {
            return Err(
                "Файл уже существует. Выберите новое имя, чтобы сохранить предыдущую копию.".into(),
            );
        }
        let temp = path.with_extension(format!("{}.tmp", id()));
        let file = fs::File::create(&temp).map_err(|e| e.to_string())?;
        let mut z = ZipWriter::new(file);
        let opt = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        z.start_file("manifest.json", opt)
            .map_err(|e| e.to_string())?;
        z.write_all(&serde_json::to_vec(&package).unwrap())
            .map_err(|e| e.to_string())?;
        let mut files = BTreeSet::new();
        for m in rows(&package.data, "media") {
            for key in ["file", "thumb"] {
                if !s(m, key).is_empty() {
                    files.insert(s(m, key).to_string());
                }
            }
        }
        for rel in files {
            let src = self.safe_file(&rel)?;
            if !src.exists() {
                return Err(format!("Не найден файл: {rel}"));
            }
            z.start_file(&rel, opt).map_err(|e| e.to_string())?;
            let mut input = fs::File::open(src).map_err(|e| e.to_string())?;
            std::io::copy(&mut input, &mut z).map_err(|e| e.to_string())?;
        }
        z.finish()
            .map_err(|e| e.to_string())?
            .sync_all()
            .map_err(|e| e.to_string())?;
        if path.exists() {
            return Err(
                "Файл уже существует. Выберите новое имя, чтобы сохранить предыдущую копию.".into(),
            );
        }
        fs::rename(temp, &path).map_err(|e| e.to_string())?;
        Ok(
            json!({"path":path,"people":package.data["people"].len(),"media":package.data["media"].len(),"texts":package.data["texts"].len()}),
        )
    }
    pub fn read_package(path: &Path) -> Result<Package> {
        let f = fs::File::open(path).map_err(|e| e.to_string())?;
        let mut z = ZipArchive::new(f).map_err(|e| e.to_string())?;
        if z.len() > 50000 {
            return Err("В пакете слишком много файлов".into());
        }
        let mut m = z
            .by_name("manifest.json")
            .map_err(|_| "Пакет не содержит manifest.json".to_string())?;
        if m.size() > 64 * 1024 * 1024 {
            return Err("Слишком большой манифест".into());
        }
        let mut raw = String::new();
        m.read_to_string(&mut raw).map_err(|e| e.to_string())?;
        let mut p: Package =
            serde_json::from_str(&raw).map_err(|e| format!("Неверный формат пакета: {e}"))?;
        if p.format != "family-archive" || p.version != 1 {
            return Err("Эта версия пакета не поддерживается".into());
        }
        if p.data.keys().any(|k| !KINDS.contains(&k.as_str())) {
            return Err("Пакет содержит служебные разделы".into());
        }
        for kind in KINDS {
            p.data.entry(kind.to_string()).or_default();
        }
        validate(&p.data)?;
        Ok(p)
    }
    fn known(d: &Data, origin: &str, incoming: &Value) -> Option<String> {
        let mid = format!("{origin}:people:{}", s(incoming, "id"));
        if let Some(map) = d.get("_maps").and_then(|m| m.get(&mid)) {
            let key = s(map, "local_id");
            if has(d, "people", key) {
                return Some(key.into());
            }
        }
        if has(d, "people", s(incoming, "id")) {
            Some(s(incoming, "id").into())
        } else {
            None
        }
    }
    pub fn preview(&self, package: &Package) -> Result<Value> {
        let d = self.data()?;
        let mut people = Vec::new();
        for incoming in rows(&package.data, "people") {
            let known = Self::known(&d, &package.origin_tree_id, incoming);
            let mut candidates = Vec::new();
            for local in rows(&d, "people") {
                let mut score = 0;
                let mut reasons = vec![];
                if norm(s(incoming, "given_name")) == norm(s(local, "given_name"))
                    && !s(local, "given_name").is_empty()
                {
                    score += 2;
                    reasons.push("имя");
                }
                let last = [norm(s(local, "surname")), norm(s(local, "birth_surname"))];
                if [
                    norm(s(incoming, "surname")),
                    norm(s(incoming, "birth_surname")),
                ]
                .iter()
                .any(|n| !n.is_empty() && last.contains(n))
                {
                    score += 3;
                    reasons.push("фамилия");
                }
                if !s(incoming, "birth_date").is_empty()
                    && s(incoming, "birth_date") == s(local, "birth_date")
                {
                    score += 5;
                    reasons.push("дата рождения");
                }
                if !s(incoming, "patronymic").is_empty()
                    && norm(s(incoming, "patronymic")) == norm(s(local, "patronymic"))
                {
                    score += 2;
                    reasons.push("отчество");
                }
                if score >= 5 {
                    candidates.push(json!({"id":s(local,"id"),"name":name(local),"score":score,"reasons":reasons}));
                }
            }
            candidates.sort_by_key(|v| std::cmp::Reverse(v["score"].as_i64().unwrap_or(0)));
            candidates.truncate(6);
            people.push(json!({"incoming":incoming,"known_id":known,"candidates":candidates}));
        }
        Ok(
            json!({"package_id":package.package_id,"title":package.title,"origin_tree_id":package.origin_tree_id,"already_imported":has(&d,"_imports",&package.package_id),"people":people,"counts":package.data.iter().map(|(k,v)|(k,v.len())).collect::<BTreeMap<_,_>>()}),
        )
    }
    pub fn merge(&mut self, package: &Package, p: &Value) -> Result<Value> {
        let mut d = self.data()?;
        if has(&d, "_imports", &package.package_id) {
            return Ok(json!({"duplicate":true,"added":0,"matched":0,"conflicts":0}));
        }
        let decisions = &p["decisions"];
        let resolutions = &p["resolutions"];
        let mut people_map = HashMap::new();
        let (mut added, mut matched, mut conflicts) = (0, 0, 0);
        let source_id = stable(&format!("import-source:{}", package.package_id));
        // Keep the complete received metadata as a source, including fields without a dedicated editor.
        let manifest = serde_json::to_vec_pretty(package).map_err(|e| e.to_string())?;
        let hash = digest(&manifest);
        let manifest_id = stable(&format!("received-manifest:{hash}"));
        let manifest_file = format!("media/{hash}.json");
        fs::write(self.safe_file(&manifest_file)?, &manifest).map_err(|e| e.to_string())?;
        put(
            &mut d,
            "media",
            json!({"id":manifest_id,"title":format!("Сведения полученной ветки: {}",package.title),"filename":"received-branch.json","file":manifest_file,"thumb":"","mime":"application/json","sha256":hash,"kind":"document","source_id":source_id}),
        );
        put(
            &mut d,
            "sources",
            json!({"id":source_id,"title":package.title,"kind":"exchange","description":format!("Получено {}. Дерево {}. Полные сведения сохранены во вложении.",package.created_at,package.origin_tree_id),"url":"","attachment_id":manifest_id}),
        );
        for incoming in rows(&package.data, "people") {
            let iid = s(incoming, "id");
            let choice = decisions
                .get(iid)
                .and_then(Value::as_str)
                .map(str::to_owned)
                .or_else(|| Self::known(&d, &package.origin_tree_id, incoming))
                .ok_or_else(|| format!("Не выбрано действие для {}", name(incoming)))?;
            if choice == "__skip__" {
                continue;
            }
            let local_id = if choice == "__new__" {
                if has(&d, "people", iid) {
                    id()
                } else {
                    iid.into()
                }
            } else {
                if !has(&d, "people", &choice) {
                    return Err("Выбранный человек не найден".into());
                }
                choice
            };
            people_map.insert(iid.to_string(), local_id.clone());
            let map_id = format!("{}:people:{iid}", package.origin_tree_id);
            let baseline = d
                .get("_maps")
                .and_then(|m| m.get(&map_id))
                .map(|m| m["baseline"].clone())
                .unwrap_or(Value::Null);
            if let Some(local) = d["people"].get(&local_id).cloned() {
                matched += 1;
                let mut updated = local.clone();
                for (k, v) in incoming.as_object().unwrap() {
                    if [
                        "id",
                        "updated_at",
                        "avatar_id",
                        "avatar_crop",
                        "source_id",
                        "external_id",
                        "extra",
                    ]
                    .contains(&k.as_str())
                    {
                        continue;
                    }
                    let old = local.get(k).unwrap_or(&Value::Null);
                    if old == v || (!baseline.is_null() && baseline.get(k) == Some(v)) {
                        continue;
                    }
                    if blank(old) || (!baseline.is_null() && baseline.get(k) == Some(old)) {
                        updated[k] = v.clone();
                        continue;
                    }
                    if blank(v) {
                        continue;
                    }
                    conflicts += 1;
                    let take_incoming = resolutions
                        .get(format!("{iid}:{k}"))
                        .and_then(Value::as_str)
                        == Some("incoming");
                    let alt = if take_incoming {
                        updated[k] = v.clone();
                        old
                    } else {
                        v
                    };
                    let fact_id = stable(&format!("{source_id}:{local_id}:{k}:{}", alt));
                    put(
                        &mut d,
                        "facts",
                        json!({"id":fact_id,"person_id":local_id,"kind":"alternative","field":k,"value":alt,"source_id":source_id,"title":format!("Другая версия: {k}"),"date":"","place":""}),
                    );
                }
                put(&mut d, "people", updated);
            } else {
                let mut v = incoming.clone();
                v["id"] = json!(local_id);
                v["avatar_id"] = json!("");
                v["avatar_crop"] = Value::Null;
                put(&mut d, "people", v);
                added += 1;
            }
            put(
                &mut d,
                "_maps",
                json!({"id":map_id,"local_id":local_id,"baseline":incoming}),
            );
        }
        let mut media_map = HashMap::new();
        for m in rows(&package.data, "media") {
            let existing = rows(&d, "media")
                .find(|local| {
                    !maintenance::trashed(local)
                        && !s(m, "sha256").is_empty()
                        && s(local, "sha256") == s(m, "sha256")
                })
                .map(|m| s(m, "id").to_string());
            let mut mid = existing.unwrap_or_else(|| {
                if has(&d, "media", s(m, "id")) {
                    stable(&format!(
                        "{}:media:{}:{}",
                        package.origin_tree_id,
                        s(m, "id"),
                        s(m, "sha256")
                    ))
                } else {
                    s(m, "id").into()
                }
            });
            if d["media"].get(&mid).is_some_and(maintenance::trashed) {
                mid = id();
            }
            media_map.insert(s(m, "id").to_string(), mid.clone());
            if !has(&d, "media", &mid) {
                let mut v = m.clone();
                v["id"] = json!(mid);
                put(&mut d, "media", v);
            }
        }
        for incoming in rows(&package.data, "people") {
            if let Some(local) = people_map.get(s(incoming, "id")) {
                if let Some(mid) = media_map.get(s(incoming, "avatar_id")) {
                    let person = d.get_mut("people").unwrap().get_mut(local).unwrap();
                    if s(person, "avatar_id").is_empty() {
                        person["avatar_id"] = json!(mid);
                        person["avatar_crop"] =
                            incoming.get("avatar_crop").cloned().unwrap_or(Value::Null);
                    }
                }
            }
        }
        let mut text_map = HashMap::new();
        for t in rows(&package.data, "texts") {
            let mut v = t.clone();
            map_doc(&mut v["content"], &people_map, false);
            v["author_id"] = json!(people_map
                .get(s(t, "author_id"))
                .cloned()
                .unwrap_or_default());
            let iid = s(t, "id");
            let mut key = if let Some(local) = d["texts"].get(iid) {
                if maintenance::trashed(local) || local["content"] != v["content"] {
                    stable(&format!(
                        "{}:{iid}:{}",
                        package.origin_tree_id,
                        digest(v["content"].to_string().as_bytes())
                    ))
                } else {
                    iid.into()
                }
            } else {
                iid.into()
            };
            if d["texts"].get(&key).is_some_and(maintenance::trashed) {
                key = id();
            }
            text_map.insert(iid.to_string(), key.clone());
            v["id"] = json!(key);
            if key != iid {
                v["title"] = json!(format!("{} — полученная версия", s(t, "title")));
                conflicts += 1;
            }
            if !has(&d, "texts", &key) {
                put(&mut d, "texts", v);
            }
        }
        for record in rows(&package.data, "events") {
            let mut v = record.clone();
            let participants = string_ids(record, "person_ids");
            let mut seen_people = BTreeSet::new();
            let mapped: Vec<String> = participants
                .iter()
                .filter_map(|p| people_map.get(p).cloned())
                .filter(|id| seen_people.insert(id.clone()))
                .collect();
            if !participants.is_empty() && mapped.is_empty() {
                continue;
            }
            v["person_ids"] = json!(mapped);
            let mut seen_media = BTreeSet::new();
            v["media_ids"] = json!(string_ids(record, "media_ids")
                .iter()
                .filter_map(|m| media_map.get(m).cloned())
                .filter(|id| seen_media.insert(id.clone()))
                .collect::<Vec<_>>());
            v["cover_media_id"] = json!(media_map
                .get(s(record, "cover_media_id"))
                .cloned()
                .unwrap_or_default());
            let key = s(&v, "id").to_string();
            if let Some(local) = d["events"].get(&key) {
                let mut a = local.clone();
                let mut b = v.clone();
                a.as_object_mut().unwrap().remove("updated_at");
                b.as_object_mut().unwrap().remove("updated_at");
                if a == b {
                    continue;
                }
                v["id"] = json!(stable(&format!(
                    "{}:event:{key}:{}",
                    package.origin_tree_id,
                    digest(b.to_string().as_bytes())
                )));
                if has(&d, "events", s(&v, "id")) {
                    continue;
                }
                v["title"] = json!(format!("{} — полученная версия", s(record, "title")));
                conflicts += 1;
            }
            put(&mut d, "events", v);
        }
        for kind in ["relationships", "tags", "text_links", "facts", "sources"] {
            for record in rows(&package.data, kind) {
                let mut v = record.clone();
                let mut skip = false;
                for key in ["person_id", "from_id", "to_id"] {
                    if !s(&v, key).is_empty() {
                        if let Some(to) = people_map.get(s(&v, key)) {
                            v[key] = json!(to);
                        } else {
                            skip = true;
                        }
                    }
                }
                if skip {
                    continue;
                }
                for (key, map) in [
                    ("media_id", &media_map),
                    ("text_id", &text_map),
                    ("attachment_id", &media_map),
                ] {
                    if !s(&v, key).is_empty() {
                        if let Some(to) = map.get(s(&v, key)) {
                            v[key] = json!(to);
                        } else {
                            v[key] = json!("");
                            if key != "attachment_id" {
                                skip = true;
                            }
                        }
                    }
                }
                if skip {
                    continue;
                }
                let duplicate = rows(&d, kind).any(|local| match kind {
                    "relationships" => {
                        s(local, "kind") == s(&v, "kind")
                            && ((s(local, "from_id") == s(&v, "from_id")
                                && s(local, "to_id") == s(&v, "to_id"))
                                || (s(&v, "kind") == "partner"
                                    && s(local, "from_id") == s(&v, "to_id")
                                    && s(local, "to_id") == s(&v, "from_id")))
                    }
                    "text_links" => {
                        s(local, "text_id") == s(&v, "text_id")
                            && s(local, "person_id") == s(&v, "person_id")
                    }
                    "tags" => ["media_id", "person_id", "x", "y", "w", "h", "label"]
                        .iter()
                        .all(|k| local.get(k) == v.get(k)),
                    _ => s(local, "id") == s(&v, "id"),
                });
                if !duplicate {
                    let incoming_key = s(&v, "id").to_string();
                    if has(&d, kind, &incoming_key) {
                        v["id"] = json!(stable(&format!(
                            "{}:{kind}:{incoming_key}:{}",
                            package.origin_tree_id,
                            digest(v.to_string().as_bytes())
                        )));
                    }
                    put(&mut d, kind, v);
                }
            }
        }
        put(
            &mut d,
            "_imports",
            json!({"id":package.package_id,"title":package.title,"at":now()}),
        );
        self.commit(&d, &format!("Объединение ветки: {}", package.title))?;
        Ok(json!({"added":added,"matched":matched,"conflicts":conflicts}))
    }
    fn import(&mut self, p: &Value) -> Result<Value> {
        let path = Path::new(s(p, "path"));
        let package = Self::read_package(path)?;
        // Validate every file before changing any database records. Files are content-addressed.
        let mut z = ZipArchive::new(fs::File::open(path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        let mut total = 0u64;
        for m in rows(&package.data, "media") {
            for field in ["file", "thumb"] {
                let rel = s(m, field);
                if rel.is_empty() {
                    continue;
                }
                let target = self.safe_file(rel)?;
                let mut entry = z
                    .by_name(rel)
                    .map_err(|_| format!("В пакете нет файла {rel}"))?;
                total += entry.size();
                if entry.size() > 256 * 1024 * 1024 || total > 2 * 1024 * 1024 * 1024 {
                    return Err("Пакет превышает допустимый размер".into());
                }
                let mut bytes = Vec::new();
                entry
                    .by_ref()
                    .take(256 * 1024 * 1024 + 1)
                    .read_to_end(&mut bytes)
                    .map_err(|e| e.to_string())?;
                if field == "file" && digest(&bytes) != s(m, "sha256") {
                    return Err("Контрольная сумма вложения не совпадает".into());
                }
                if target.exists() {
                    if fs::read(&target).map_err(|e| e.to_string())? != bytes {
                        return Err("Файл с таким именем уже существует и отличается".into());
                    }
                } else {
                    fs::write(target, bytes).map_err(|e| e.to_string())?;
                }
            }
        }
        self.merge(&package, p)
    }
    pub fn call(&mut self, op: &str, p: Value) -> Result<Value> {
        match op {
            "load" => {
                let raw = self.data()?;
                let d = maintenance::visible_data(&raw);
                let mut public = json!({});
                for k in KINDS {
                    public[*k] = json!(rows(&d, k).collect::<Vec<_>>());
                }
                Ok(
                    json!({"data":public,"trash":{"media":rows(&raw,"media").filter(|v|maintenance::trashed(v)).collect::<Vec<_>>(),"texts":rows(&raw,"texts").filter(|v|maintenance::trashed(v)).collect::<Vec<_>>()},"tree_id":self.meta("tree_id"),"title":self.meta("title"),"root":self.root,"history":self.history()?}),
                )
            }
            "save" => self.save(&p),
            "trash_preview" => self.trash_preview(&p),
            "trash_items" => self.trash_items(&p),
            "restore_items" => self.restore_items(&p),
            "purge_preview" => self.purge_preview(&p),
            "purge_items" => self.purge_items(&p),
            "find_duplicates" => self.duplicates(&p),
            "merge_duplicates" => self.merge_duplicates(&p),
            "analysis_get" => self.analysis_get(&p),
            "analysis_put" => self.analysis_put(&p),
            "face_matches" => self.face_matches(&p),
            "face_tag_batch" => self.face_tag_batch(&p),
            "remove" => self.remove(&p),
            "undo" => self.undo(s(&p, "id")),
            "add_media" => self.add_media(&p),
            "check_media" => self.check_media(&p),
            "merge_people" => self.merge_people(&p),
            "switch_library" => {
                let path = s(&p, "path");
                if path.trim().is_empty() {
                    return Err("Выберите папку архива".into());
                }
                let next = Self::open(path)?;
                validate(&next.data()?)?;
                *self = next;
                self.call("load", json!({}))
            }
            "export_media" => {
                let d = self.data()?;
                let m = d["media"].get(s(&p, "id")).ok_or("Файл не найден")?;
                let target = Path::new(s(&p, "path"));
                if target.exists() {
                    return Err("Файл уже существует. Выберите новое имя.".into());
                }
                let copied =
                    fs::copy(self.safe_file(s(m, "file"))?, target).map_err(|e| e.to_string())?;
                Ok(json!({"bytes":copied}))
            }
            "media_data" => {
                let d = self.data()?;
                let m = d["media"].get(s(&p, "id")).ok_or("Файл не найден")?;
                let thumb = p["thumbnail"].as_bool().unwrap_or(false) && !s(m, "thumb").is_empty();
                let rel = s(m, if thumb { "thumb" } else { "file" });
                let bytes = fs::read(self.safe_file(rel)?).map_err(|e| e.to_string())?;
                Ok(json!(format!(
                    "data:{};base64,{}",
                    if thumb { "image/jpeg" } else { s(m, "mime") },
                    B64.encode(bytes)
                )))
            }
            "branch_preview" => {
                let b = self.branch(&p)?;
                Ok(
                    json!({"people":rows(&b.data,"people").collect::<Vec<_>>(),"counts":b.data.iter().map(|(k,v)|(k,v.len())).collect::<BTreeMap<_,_>>()}),
                )
            }
            "export" => self.export(&p),
            "import_preview" => self.preview(&Self::read_package(Path::new(s(&p, "path")))?),
            "import" => self.import(&p),
            "integrity" => {
                validate(&self.data()?)?;
                let check: String = self
                    .conn
                    .query_row("PRAGMA integrity_check", [], |r| r.get(0))
                    .map_err(|e| e.to_string())?;
                Ok(json!({"database":check,"links":"ok"}))
            }
            _ => Err(format!("Неизвестная команда: {op}")),
        }
    }
}
