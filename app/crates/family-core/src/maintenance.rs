use super::*;

pub(super) fn trashed(v: &Value) -> bool {
    !s(v, "trashed_at").is_empty()
}
pub(super) fn resolve(d: &Data, kind: &str, key: &str) -> String {
    let mut key = key.to_string();
    let mut seen = BTreeSet::new();
    while !key.is_empty() && seen.insert(key.clone()) {
        let Some(v) = d.get(kind).and_then(|m| m.get(&key)) else {
            return String::new();
        };
        if !trashed(v) {
            return key;
        }
        key = s(v, "merged_into").to_string();
    }
    String::new()
}
fn unique(values: Vec<String>) -> Vec<String> {
    let mut seen = BTreeSet::new();
    values
        .into_iter()
        .filter(|x| !x.is_empty() && seen.insert(x.clone()))
        .collect()
}
pub(super) fn visible_data(raw: &Data) -> Data {
    let mut d = raw.clone();
    for kind in ["media", "texts"] {
        d.entry(kind.into()).or_default().retain(|_, v| !trashed(v));
    }
    for p in d.entry("people".into()).or_default().values_mut() {
        let avatar = resolve(raw, "media", s(p, "avatar_id"));
        if avatar.is_empty() && !s(p, "avatar_id").is_empty() {
            p["avatar_crop"] = Value::Null;
        }
        if p.get("avatar_id").is_some() {
            p["avatar_id"] = json!(avatar);
        }
    }
    let mut seen_tags = BTreeSet::new();
    let mut normalized_tags = BTreeMap::new();
    let mut tags: Vec<Value> = rows(raw, "tags").cloned().collect();
    tags.sort_by_key(|t| resolve(raw, "media", s(t, "media_id")) != s(t, "media_id"));
    for mut tag in tags {
        let mid = resolve(raw, "media", s(&tag, "media_id"));
        if mid.is_empty() {
            continue;
        }
        let alias = mid != s(&tag, "media_id");
        tag["media_id"] = json!(mid);
        let key = json!([
            mid,
            s(&tag, "person_id"),
            tag["x"],
            tag["y"],
            tag["w"],
            tag["h"],
            if s(&tag, "person_id").is_empty() {
                s(&tag, "label")
            } else {
                ""
            }
        ])
        .to_string();
        let fresh = seen_tags.insert(key);
        if !alias || fresh {
            normalized_tags.insert(s(&tag, "id").to_string(), tag);
        }
    }
    d.insert("tags".into(), normalized_tags);
    let mut seen_links = BTreeSet::new();
    let mut normalized_links = BTreeMap::new();
    let mut links: Vec<Value> = rows(raw, "text_links").cloned().collect();
    links.sort_by_key(|l| resolve(raw, "texts", s(l, "text_id")) != s(l, "text_id"));
    for mut link in links {
        let tid = resolve(raw, "texts", s(&link, "text_id"));
        if tid.is_empty() {
            continue;
        }
        let alias = tid != s(&link, "text_id");
        link["text_id"] = json!(tid);
        let fresh = seen_links.insert(format!("{tid}:{}", s(&link, "person_id")));
        if !alias || fresh {
            normalized_links.insert(s(&link, "id").to_string(), link);
        }
    }
    d.insert("text_links".into(), normalized_links);
    for event in d.entry("events".into()).or_default().values_mut() {
        if event.get("media_ids").is_some() {
            event["media_ids"] = json!(unique(
                string_ids(event, "media_ids")
                    .iter()
                    .map(|id| resolve(raw, "media", id))
                    .collect()
            ));
        }
        if event.get("cover_media_id").is_some() {
            event["cover_media_id"] = json!(resolve(raw, "media", s(event, "cover_media_id")));
        }
    }
    for source in d.entry("sources".into()).or_default().values_mut() {
        if source.get("attachment_id").is_some() {
            source["attachment_id"] = json!(resolve(raw, "media", s(source, "attachment_id")));
        }
    }
    d
}
fn text_content(v: &Value) -> String {
    if s(v, "type") == "text" {
        return s(v, "text").to_string();
    }
    if s(v, "type") == "hardBreak" {
        return "\n".into();
    }
    let text = v
        .get("content")
        .and_then(Value::as_array)
        .map(|nodes| nodes.iter().map(text_content).collect::<Vec<_>>().join(""))
        .unwrap_or_default();
    if [
        "paragraph",
        "heading",
        "listItem",
        "blockquote",
        "codeBlock",
    ]
    .contains(&s(v, "type"))
    {
        format!("{text}\n")
    } else {
        text
    }
}
fn duplicate_key(kind: &str, v: &Value) -> String {
    if kind == "media" {
        s(v, "sha256").to_string()
    } else {
        text_content(&v["content"])
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
    }
}
fn selection(p: &Value) -> Result<(&str, Vec<String>)> {
    let kind = s(p, "kind");
    if !["media", "texts"].contains(&kind) {
        return Err("Выберите фотографии, документы или тексты".into());
    }
    let ids = unique(string_ids(p, "ids"));
    if ids.is_empty() || ids.len() > 2000 {
        return Err("Выберите от 1 до 2000 материалов".into());
    }
    Ok((kind, ids))
}
pub(super) fn people_for(d: &Data, kind: &str, ids: &[String]) -> BTreeSet<String> {
    let mut people = BTreeSet::new();
    if kind == "media" {
        for tag in rows(d, "tags").filter(|t| ids.iter().any(|x| x == s(t, "media_id"))) {
            if !s(tag, "person_id").is_empty() {
                people.insert(s(tag, "person_id").into());
            }
        }
        for p in rows(d, "people").filter(|p| ids.iter().any(|x| x == s(p, "avatar_id"))) {
            people.insert(s(p, "id").into());
        }
    } else {
        for t in rows(d, "texts").filter(|t| ids.iter().any(|x| x == s(t, "id"))) {
            refs_in_doc(&t["content"], &mut people);
            if !s(t, "author_id").is_empty() {
                people.insert(s(t, "author_id").into());
            }
        }
        for l in rows(d, "text_links").filter(|l| ids.iter().any(|x| x == s(l, "text_id"))) {
            people.insert(s(l, "person_id").into());
        }
    }
    people
}
impl Engine {
    pub(super) fn trash_preview(&self, p: &Value) -> Result<Value> {
        let (kind, ids) = selection(p)?;
        let raw = self.data()?;
        let d = visible_data(&raw);
        for id in &ids {
            if !has(&d, kind, id) {
                return Err("Материал уже удалён или не найден. Обновите список.".into());
            }
        }
        let people = people_for(&d, kind, &ids);
        Ok(
            json!({"count":ids.len(),"people":people.iter().filter_map(|id|d["people"].get(id)).collect::<Vec<_>>(),"tags":if kind=="media"{rows(&d,"tags").filter(|t|ids.iter().any(|id|id==s(t,"media_id"))).count()}else{0},"events":rows(&d,"events").filter(|e|string_ids(e,"media_ids").iter().any(|id|ids.contains(id))).count()}),
        )
    }
    pub(super) fn trash_items(&mut self, p: &Value) -> Result<Value> {
        let (kind, ids) = selection(p)?;
        let preview = self.trash_preview(p)?;
        if (!preview["people"].as_array().unwrap().is_empty()
            || preview["tags"].as_u64().unwrap_or(0) > 0)
            && p["confirm_marked"] != true
        {
            return Err("В материалах отмечены люди. Подтвердите перемещение в корзину.".into());
        }
        let mut d = self.data()?;
        let time = now();
        for id in &ids {
            let v = d.get_mut(kind).unwrap().get_mut(id).unwrap();
            v["trashed_at"] = json!(time);
            v["trash_reason"] = json!("manual");
        }
        self.commit(&d, &format!("Перемещено в корзину: {}", ids.len()))?;
        Ok(json!({"count":ids.len()}))
    }
    pub(super) fn restore_items(&mut self, p: &Value) -> Result<Value> {
        let (kind, ids) = selection(p)?;
        let mut d = self.data()?;
        for id in &ids {
            let v = d
                .get_mut(kind)
                .and_then(|m| m.get_mut(id))
                .ok_or("Материал не найден в корзине")?;
            if !trashed(v) {
                return Err("Материал уже восстановлен".into());
            }
            for key in ["trashed_at", "trash_reason", "merged_into"] {
                v.as_object_mut().unwrap().remove(key);
            }
        }
        self.commit(&d, &format!("Восстановлено из корзины: {}", ids.len()))?;
        Ok(json!({"count":ids.len()}))
    }
    pub(super) fn duplicates(&self, p: &Value) -> Result<Value> {
        let kind = s(p, "kind");
        if !["media", "texts"].contains(&kind) {
            return Err("Неизвестный раздел".into());
        }
        let d = visible_data(&self.data()?);
        let mut groups: BTreeMap<String, Vec<Value>> = BTreeMap::new();
        for record in rows(&d, kind) {
            let key = duplicate_key(kind, record);
            if !key.is_empty() {
                let mut v = record.clone();
                v["linked_people"] = json!(people_for(&d, kind, &[s(record, "id").into()]).len());
                groups.entry(key).or_default().push(v);
            }
        }
        Ok(json!(groups
            .into_values()
            .filter(|g| g.len() > 1)
            .collect::<Vec<_>>()))
    }
    pub(super) fn merge_duplicates(&mut self, p: &Value) -> Result<Value> {
        let (kind, ids) = selection(p)?;
        let keep = s(p, "keep_id");
        let mut d = self.data()?;
        let view = visible_data(&d);
        let original = view[kind].get(keep).ok_or("Основной материал не найден")?;
        let key = duplicate_key(kind, original);
        if key.is_empty() || ids.iter().any(|id| id == keep) {
            return Err("Выберите основной материал и его дубли".into());
        }
        for id in &ids {
            let v = view[kind].get(id).ok_or("Дубликат уже удалён")?;
            if duplicate_key(kind, v) != key {
                return Err("Содержимое отличается. Похожие материалы можно убрать в корзину после просмотра, без объединения отметок.".into());
            }
        }
        let marked = kind == "media"
            && rows(&view, "tags").any(|t| ids.iter().any(|id| id == s(t, "media_id")));
        if (!people_for(&view, kind, &ids).is_empty() || marked) && p["confirm_marked"] != true {
            return Err("В дублях отмечены люди. Подтвердите объединение связей.".into());
        }
        let time = now();
        for id in &ids {
            // Preserve complete source records and their links; the visible projection follows aliases.
            if kind == "texts" {
                let refs = people_for(&view, kind, &[id.clone()]);
                for person in refs {
                    put(
                        &mut d,
                        "text_links",
                        json!({"id":stable(&format!("dedup-subject:{id}:{person}")),"text_id":id,"person_id":person}),
                    );
                }
            }
            let v = d.get_mut(kind).unwrap().get_mut(id).unwrap();
            v["trashed_at"] = json!(time);
            v["trash_reason"] = json!("duplicate");
            v["merged_into"] = json!(keep);
        }
        self.commit(&d, &format!("Объединены дубли: {}", ids.len()))?;
        Ok(json!({"count":ids.len(),"keep_id":keep}))
    }
    pub(super) fn analysis_get(&self, p: &Value) -> Result<Value> {
        let d = visible_data(&self.data()?);
        let kind = s(p, "kind");
        let version = s(p, "version");
        let mut stmt = self
            .conn
            .prepare(
                "SELECT media_id,sha256,payload FROM analysis_cache WHERE kind=?1 AND version=?2",
            )
            .map_err(|e| e.to_string())?;
        let records = stmt
            .query_map(params![kind, version], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        let mut result = vec![];
        for record in records {
            let (mid, hash, payload) = record.map_err(|e| e.to_string())?;
            if d["media"].get(&mid).is_some_and(|m| s(m, "sha256") == hash) {
                result.push(json!({"media_id":mid,"sha256":hash,"payload":serde_json::from_str::<Value>(&payload).map_err(|e|e.to_string())?}));
            }
        }
        Ok(json!(result))
    }
    pub(super) fn analysis_put(&mut self, p: &Value) -> Result<Value> {
        if !s(p, "tree_id").is_empty() && s(p, "tree_id") != self.meta("tree_id") {
            return Err("Открыт другой архив. Повторите обработку в нужном архиве.".into());
        }
        let d = visible_data(&self.data()?);
        let mid = s(p, "media_id");
        let m = d["media"]
            .get(mid)
            .ok_or("Фото не найдено или находится в корзине")?;
        if s(m, "sha256") != s(p, "sha256") {
            return Err("Фотография изменилась. Повторите обработку.".into());
        }
        let kind = s(p, "kind");
        let version = s(p, "version");
        if version.is_empty() || version.len() > 120 {
            return Err("Не указана версия обработки".into());
        }
        let payload = &p["payload"];
        if kind == "faces" {
            super::recognition::validate_faces(payload)?;
        } else if kind == "image" {
            let hash = s(payload, "hash");
            if hash.len() != 16 || !hash.chars().all(|c| c.is_ascii_hexdigit()) {
                return Err("Некорректный отпечаток фото".into());
            }
            if !payload["aspect"]
                .as_f64()
                .is_some_and(|x| x.is_finite() && x > 0.0 && x < 100.0)
            {
                return Err("Некорректный размер фото".into());
            }
        } else {
            return Err("Неизвестный вид обработки".into());
        }
        self.conn.execute("INSERT INTO analysis_cache(kind,media_id,sha256,version,payload,updated_at) VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(kind,media_id,version) DO UPDATE SET sha256=excluded.sha256,payload=excluded.payload,updated_at=excluded.updated_at",params![kind,mid,s(p,"sha256"),version,payload.to_string(),now()]).map_err(|e|e.to_string())?;
        Ok(json!({"saved":true}))
    }
}
