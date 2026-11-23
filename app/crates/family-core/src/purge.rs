use super::*;

fn selection(d: &Data, p: &Value) -> Result<(String, BTreeSet<String>)> {
    let kind = s(p, "kind");
    let ids: BTreeSet<_> = string_ids(p, "ids").into_iter().collect();
    if !["media", "texts"].contains(&kind) || ids.is_empty() || ids.len() > 2000 {
        return Err("Выберите материалы в корзине".into());
    }
    for id in &ids {
        if !d
            .get(kind)
            .and_then(|m| m.get(id))
            .is_some_and(maintenance::trashed)
        {
            return Err("Окончательно удалить можно только материалы из корзины".into());
        }
    }
    Ok((kind.into(), ids))
}
fn file_refs(d: &Data) -> BTreeSet<String> {
    rows(d, "media")
        .flat_map(|m| [s(m, "file"), s(m, "thumb")])
        .filter(|p| !p.is_empty())
        .map(str::to_owned)
        .collect()
}
fn sanitize(d: &mut Data, kind: &str, ids: &BTreeSet<String>, aliases: &HashMap<String, String>) {
    let mapped: HashMap<String, String> = ids
        .iter()
        .map(|id| {
            let target = aliases
                .get(id)
                .filter(|v| !ids.contains(*v) && has(d, kind, v))
                .cloned()
                .unwrap_or_default();
            (id.clone(), target)
        })
        .collect();
    let resolve = |id: &str| mapped.get(id).cloned().unwrap_or_else(|| id.to_owned());
    d.entry(kind.into())
        .or_default()
        .retain(|id, _| !ids.contains(id));
    for v in d.entry(kind.into()).or_default().values_mut() {
        if ids.contains(s(v, "merged_into")) {
            v["merged_into"] = json!(resolve(s(v, "merged_into")));
        }
    }
    let (links, field) = if kind == "media" {
        ("tags", "media_id")
    } else {
        ("text_links", "text_id")
    };
    d.entry(links.into()).or_default().retain(|_, v| {
        let target = resolve(s(v, field));
        v[field] = json!(target);
        !target.is_empty()
    });
    if kind == "media" {
        for p in d.entry("people".into()).or_default().values_mut() {
            if ids.contains(s(p, "avatar_id")) {
                let target = resolve(s(p, "avatar_id"));
                if target.is_empty() {
                    p["avatar_crop"] = Value::Null;
                }
                p["avatar_id"] = json!(target);
            }
        }
        for e in d.entry("events".into()).or_default().values_mut() {
            if e.get("media_ids").is_some() {
                let mut seen = BTreeSet::new();
                e["media_ids"] = json!(string_ids(e, "media_ids")
                    .iter()
                    .map(|id| resolve(id))
                    .filter(|id| !id.is_empty() && seen.insert(id.clone()))
                    .collect::<Vec<_>>());
            }
            if ids.contains(s(e, "cover_media_id")) {
                e["cover_media_id"] = json!(resolve(s(e, "cover_media_id")));
            }
        }
        for v in d.entry("sources".into()).or_default().values_mut() {
            if ids.contains(s(v, "attachment_id")) {
                v["attachment_id"] = json!(resolve(s(v, "attachment_id")));
            }
        }
    }
}
impl Engine {
    pub(super) fn purge_preview(&self, p: &Value) -> Result<Value> {
        let d = self.data()?;
        let (kind, ids) = selection(&d, p)?;
        let people = maintenance::people_for(&d, &kind, &ids.iter().cloned().collect::<Vec<_>>());
        Ok(
            json!({"count":ids.len(),"people":people.iter().filter_map(|id|d["people"].get(id)).collect::<Vec<_>>(),"tags":if kind=="media"{rows(&d,"tags").filter(|t|ids.contains(s(t,"media_id"))).count()}else{0},"events":rows(&d,"events").filter(|e|string_ids(e,"media_ids").iter().any(|id|ids.contains(id))).count()}),
        )
    }
    fn purge_path(&self, rel: &str) -> Result<PathBuf> {
        let path = self.safe_file(rel)?;
        let root = fs::canonicalize(&self.root).map_err(|e| e.to_string())?;
        let parent =
            fs::canonicalize(path.parent().ok_or("Нет папки файла")?).map_err(|e| e.to_string())?;
        if !parent.starts_with(&root) {
            return Err("Путь удаляемого файла выходит за пределы архива".into());
        }
        if path.exists() {
            let actual = fs::canonicalize(&path).map_err(|e| e.to_string())?;
            if !actual.starts_with(&root) || !actual.is_file() {
                return Err("Недопустимый путь удаляемого файла".into());
            }
        }
        Ok(path)
    }
    pub(super) fn drain_file_deletions(&mut self) -> Result<usize> {
        let pending = {
            let mut st = self
                .conn
                .prepare("SELECT path FROM pending_file_deletions")
                .map_err(|e| e.to_string())?;
            let rows = st
                .query_map([], |r| r.get::<_, String>(0))
                .map_err(|e| e.to_string())?;
            rows.collect::<std::result::Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?
        };
        if pending.is_empty() {
            return Ok(0);
        }
        let mut referenced = file_refs(&self.data()?);
        {
            let mut st = self
                .conn
                .prepare("SELECT before_json FROM history")
                .map_err(|e| e.to_string())?;
            let history = st
                .query_map([], |r| r.get::<_, String>(0))
                .map_err(|e| e.to_string())?;
            for h in history {
                let d: Data = serde_json::from_str(&h.map_err(|e| e.to_string())?)
                    .map_err(|e| e.to_string())?;
                referenced.extend(file_refs(&d));
            }
        }
        let mut remaining = 0;
        for rel in pending {
            let done = if referenced.contains(&rel) {
                true
            } else {
                match self.purge_path(&rel) {
                    Ok(path) => match fs::remove_file(path) {
                        Ok(()) => true,
                        Err(e) if e.kind() == std::io::ErrorKind::NotFound => true,
                        Err(_) => false,
                    },
                    Err(_) => false,
                }
            };
            if done {
                self.conn
                    .execute("DELETE FROM pending_file_deletions WHERE path=?1", [rel])
                    .map_err(|e| e.to_string())?;
            } else {
                remaining += 1;
            }
        }
        Ok(remaining)
    }
    pub(super) fn purge_items(&mut self, p: &Value) -> Result<Value> {
        let before = self.data()?;
        let (kind, ids) = selection(&before, p)?;
        if p["confirm_permanent"] != true {
            return Err("Подтвердите окончательное удаление без возможности отмены".into());
        }
        let aliases = ids
            .iter()
            .map(|id| (id.clone(), maintenance::resolve(&before, &kind, id)))
            .collect::<HashMap<_, _>>();
        let mut after = before.clone();
        sanitize(&mut after, &kind, &ids, &aliases);
        validate(&after)?;
        let candidates = if kind == "media" {
            rows(&before, "media")
                .filter(|m| ids.contains(s(m, "id")))
                .flat_map(|m| [s(m, "file").to_string(), s(m, "thumb").to_string()])
                .filter(|s| !s.is_empty())
                .collect::<BTreeSet<_>>()
        } else {
            BTreeSet::new()
        };
        let mut hashes = HashMap::from([(snapshot_hash(&before), snapshot_hash(&after))]);
        let history = {
            let mut st = self
                .conn
                .prepare("SELECT id,before_json,after_hash FROM history")
                .map_err(|e| e.to_string())?;
            let rows = st
                .query_map([], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                    ))
                })
                .map_err(|e| e.to_string())?;
            rows.collect::<std::result::Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?
        };
        let mut rewritten = Vec::new();
        let mut referenced = file_refs(&after);
        for (id, raw, after_hash) in history {
            let mut d: Data = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
            let old = snapshot_hash(&d);
            sanitize(&mut d, &kind, &ids, &aliases);
            validate(&d)?;
            hashes.insert(old, snapshot_hash(&d));
            referenced.extend(file_refs(&d));
            rewritten.push((
                id,
                serde_json::to_string(&d).map_err(|e| e.to_string())?,
                after_hash,
            ));
        }
        let removable = candidates
            .difference(&referenced)
            .cloned()
            .collect::<Vec<_>>();
        for path in &removable {
            self.purge_path(path)?;
        }
        let tx = self.conn.transaction().map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM entities", [])
            .map_err(|e| e.to_string())?;
        for (k, items) in &after {
            for (id, v) in items {
                tx.execute(
                    "INSERT INTO entities VALUES(?1,?2,?3)",
                    params![k, id, v.to_string()],
                )
                .map_err(|e| e.to_string())?;
            }
        }
        for (id, raw, old_hash) in rewritten {
            tx.execute(
                "UPDATE history SET before_json=?1,after_hash=?2 WHERE id=?3",
                params![raw, hashes.get(&old_hash).unwrap_or(&old_hash), id],
            )
            .map_err(|e| e.to_string())?;
        }
        if kind == "media" {
            for id in &ids {
                tx.execute("DELETE FROM analysis_cache WHERE media_id=?1", [id])
                    .map_err(|e| e.to_string())?;
            }
        }
        for path in &removable {
            tx.execute(
                "INSERT OR IGNORE INTO pending_file_deletions VALUES(?1)",
                [path],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        let pending = self.drain_file_deletions()?;
        Ok(
            json!({"count":ids.len(),"pending_files":pending,"shared_files":candidates.len()-removable.len()}),
        )
    }
}
