use super::maintenance::visible_data;
use super::*;

fn num(v: &Value, k: &str) -> f64 {
    v[k].as_f64().unwrap_or(f64::NAN)
}
fn rect_valid(v: &Value) -> bool {
    let a = [num(v, "x"), num(v, "y"), num(v, "w"), num(v, "h")];
    a.iter().all(|n| n.is_finite())
        && a[0] >= 0.0
        && a[1] >= 0.0
        && a[2] > 0.0
        && a[3] > 0.0
        && a[0] + a[2] <= 1.00001
        && a[1] + a[3] <= 1.00001
}
fn overlap(a: &Value, b: &Value) -> f64 {
    if !rect_valid(a) || !rect_valid(b) {
        return 0.0;
    }
    let w =
        (num(a, "x") + num(a, "w")).min(num(b, "x") + num(b, "w")) - num(a, "x").max(num(b, "x"));
    let h =
        (num(a, "y") + num(a, "h")).min(num(b, "y") + num(b, "h")) - num(a, "y").max(num(b, "y"));
    let area = w.max(0.0) * h.max(0.0);
    area / (num(a, "w") * num(a, "h") + num(b, "w") * num(b, "h") - area).max(1e-9)
}
pub(super) fn validate_faces(payload: &Value) -> Result<()> {
    let faces = payload["faces"]
        .as_array()
        .ok_or("Нет результатов поиска лиц")?;
    if faces.len() > 300 {
        return Err("Слишком много лиц на одной фотографии".into());
    }
    let mut ids = BTreeSet::new();
    for f in faces {
        if s(f, "id").is_empty()
            || s(f, "id").len() > 180
            || !ids.insert(s(f, "id"))
            || !rect_valid(f)
            || !num(f, "score").is_finite()
            || !(0.0..=1.0).contains(&num(f, "score"))
        {
            return Err("Некорректная область лица".into());
        }
        let descriptor = f["descriptor"].as_array().ok_or("Нет признаков лица")?;
        if descriptor.len() != 128
            || descriptor
                .iter()
                .any(|v| !v.as_f64().is_some_and(|n| n.is_finite() && n.abs() < 10.0))
        {
            return Err("Некорректные признаки лица".into());
        }
    }
    for k in ["width", "height"] {
        if !num(payload, k).is_finite() || num(payload, k) <= 0.0 || num(payload, k) > 100000.0 {
            return Err("Некорректный размер фотографии".into());
        }
    }
    Ok(())
}
#[derive(Clone)]
struct Face {
    id: String,
    media: String,
    hash: String,
    rect: Value,
    descriptor: Vec<f64>,
    person: String,
    tag: String,
    confirmed: bool,
    quality: bool,
}
impl Face {
    fn public(&self) -> Value {
        json!({"id":self.id,"media_id":self.media,"x":self.rect["x"],"y":self.rect["y"],"w":self.rect["w"],"h":self.rect["h"],"person_id":self.person,"confirmed":self.confirmed,"tag_id":self.tag})
    }
}
fn distance(a: &Face, b: &Face) -> f64 {
    a.descriptor
        .iter()
        .zip(&b.descriptor)
        .map(|(x, y)| (x - y) * (x - y))
        .sum::<f64>()
        .sqrt()
}
fn rank(face: &Face, all: &[Face]) -> Vec<(String, f64, usize)> {
    let mut by_person: BTreeMap<String, BTreeMap<String, f64>> = BTreeMap::new();
    for sample in all
        .iter()
        .filter(|f| f.confirmed && !f.person.is_empty() && f.hash != face.hash)
    {
        let value = distance(face, sample);
        let entry = by_person
            .entry(sample.person.clone())
            .or_default()
            .entry(sample.hash.clone())
            .or_insert(value);
        *entry = entry.min(value);
    }
    let mut result: Vec<_> = by_person
        .into_iter()
        .map(|(person, values)| {
            let best = values.values().copied().fold(f64::INFINITY, f64::min);
            let support = values.values().filter(|&&v| v <= 0.50).count();
            (person, best, support)
        })
        .collect();
    result.sort_by(|a, b| a.1.total_cmp(&b.1));
    result
}
fn confident(face: &Face, ranks: &[(String, f64, usize)]) -> bool {
    face.quality
        && ranks.first().is_some_and(|first| {
            first.1 <= 0.45
                && first.2 >= 2
                && ranks.get(1).is_none_or(|next| next.1 - first.1 >= 0.10)
        })
}
impl Engine {
    fn cached_faces(&self, version: &str, d: &Data) -> Result<Vec<Face>> {
        let cached = self.analysis_get(&json!({"kind":"faces","version":version}))?;
        let mut result = vec![];
        for entry in cached.as_array().unwrap() {
            let mid = s(entry, "media_id");
            let payload = &entry["payload"];
            for f in payload["faces"]
                .as_array()
                .ok_or("Повторите обработку фото")?
            {
                let mut tags: Vec<&Value> = rows(d, "tags")
                    .filter(|t| {
                        s(t, "media_id") == mid
                            && !s(t, "person_id").is_empty()
                            && overlap(t, f) >= 0.25
                    })
                    .collect();
                tags.sort_by(|a, b| overlap(b, f).total_cmp(&overlap(a, f)));
                let first = tags.first().copied();
                let ambiguous = tags
                    .iter()
                    .any(|t| first.is_some_and(|a| s(a, "person_id") != s(t, "person_id")));
                let owner = if ambiguous { None } else { first };
                result.push(Face {
                    id: format!("{mid}:{}", s(f, "id")),
                    media: mid.into(),
                    hash: s(entry, "sha256").into(),
                    rect: f.clone(),
                    descriptor: f["descriptor"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|n| n.as_f64().unwrap())
                        .collect(),
                    person: owner.map(|t| s(t, "person_id")).unwrap_or("").into(),
                    tag: owner.map(|t| s(t, "id")).unwrap_or("").into(),
                    confirmed: owner.is_some_and(|t| {
                        s(t, "recognition_mode") != "auto" || t["recognition_confirmed"] == true
                    }),
                    quality: num(f, "score") >= 0.80
                        && num(f, "w") * num(payload, "width") >= 40.0
                        && num(f, "h") * num(payload, "height") >= 40.0,
                });
            }
        }
        Ok(result)
    }
    pub(super) fn face_matches(&self, p: &Value) -> Result<Value> {
        let d = visible_data(&self.data()?);
        let faces = self.cached_faces(s(p, "version"), &d)?;
        let target = s(p, "person_id");
        let threshold = p["threshold"].as_f64().unwrap_or(0.56).clamp(0.35, 0.65);
        let mut people: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
        for f in &faces {
            if f.confirmed && !f.person.is_empty() {
                people
                    .entry(f.person.clone())
                    .or_default()
                    .insert(f.hash.clone());
            }
        }
        let mut found = vec![];
        let mut automatic = vec![];
        for face in &faces {
            if !face.person.is_empty() {
                if target == face.person {
                    let mut v = face.public();
                    v["known"] = json!(true);
                    found.push(v);
                }
                continue;
            }
            let ranks = rank(face, &faces);
            let strong = confident(face, &ranks);
            if strong {
                let mut v = face.public();
                v["suggested_person_id"] = json!(ranks[0].0);
                v["strong"] = json!(true);
                automatic.push(v);
            }
            if let Some(match_) = ranks
                .iter()
                .find(|(pid, dist, _)| pid == target && *dist <= threshold)
            {
                let mut v = face.public();
                v["distance"] = json!(match_.1);
                v["strong"] = json!(strong && ranks[0].0 == target);
                v["known"] = json!(false);
                found.push(v);
            }
        }
        found.sort_by(|a, b| num(a, "distance").total_cmp(&num(b, "distance")));
        let mut groups: Vec<Vec<&Face>> = vec![];
        if p["groups"] == true {
            for face in faces.iter().filter(|f| f.person.is_empty()) {
                let existing = groups.iter_mut().find(|g| {
                    distance(face, g[0]) <= 0.46
                        && g.iter().take(4).all(|m| distance(face, m) <= 0.55)
                });
                if let Some(group) = existing {
                    group.push(face);
                } else {
                    groups.push(vec![face]);
                }
            }
            groups.sort_by_key(|g| std::cmp::Reverse(g.len()));
        }
        Ok(
            json!({"faces":found,"automatic":automatic,"groups":groups.into_iter().map(|g|g.into_iter().map(Face::public).collect::<Vec<_>>()).collect::<Vec<_>>(),"people":people.into_iter().map(|(id,photos)|json!({"id":id,"examples":photos.len()})).collect::<Vec<_>>(),"indexed_faces":faces.len(),"indexed_photos":faces.iter().map(|f|&f.media).collect::<BTreeSet<_>>().len()}),
        )
    }
    pub(super) fn face_tag_batch(&mut self, p: &Value) -> Result<Value> {
        if !s(p, "tree_id").is_empty() && s(p, "tree_id") != self.meta("tree_id") {
            return Err("Открыт другой архив. Повторите поиск.".into());
        }
        let mut d = self.data()?;
        let view = visible_data(&d);
        let faces = self.cached_faces(s(p, "version"), &view)?;
        let automatic = s(p, "mode") == "auto";
        if !automatic && s(p, "mode") != "review" {
            return Err("Выберите режим разметки".into());
        }
        let requests: Vec<(String, String)> = if automatic {
            faces
                .iter()
                .filter(|f| f.person.is_empty())
                .filter_map(|f| {
                    let ranks = rank(f, &faces);
                    confident(f, &ranks).then(|| (f.id.clone(), ranks[0].0.clone()))
                })
                .collect()
        } else {
            let person = s(p, "person_id");
            if !has(&d, "people", person) {
                return Err("Выберите человека".into());
            }
            let ids = string_ids(p, "face_ids");
            if ids.is_empty() || ids.len() > 2000 {
                return Err("Выберите лица для групповой отметки".into());
            }
            ids.into_iter()
                .collect::<BTreeSet<_>>()
                .into_iter()
                .map(|id| (id, person.into()))
                .collect()
        };
        let mut assigned = 0;
        let mut confirmed = 0;
        let mut skipped = 0;
        let mut conflicts = 0;
        for (fid, person) in requests {
            let face = faces
                .iter()
                .find(|f| f.id == fid)
                .ok_or("Результаты поиска устарели. Повторите поиск.")?;
            let current = visible_data(&d);
            let related: Vec<Value> = rows(&current, "tags")
                .filter(|t| s(t, "media_id") == face.media && overlap(t, &face.rect) >= 0.25)
                .cloned()
                .collect();
            if related
                .iter()
                .any(|t| !s(t, "person_id").is_empty() && s(t, "person_id") != person)
            {
                conflicts += 1;
                continue;
            }
            let existing = related
                .iter()
                .find(|t| s(t, "person_id") == person)
                .or_else(|| related.iter().find(|t| s(t, "person_id").is_empty()))
                .cloned()
                .or_else(|| {
                    rows(&current, "tags")
                        .find(|t| {
                            s(t, "media_id") == face.media
                                && s(t, "person_id") == person
                                && !rect_valid(t)
                        })
                        .cloned()
                });
            if let Some(tag) = &existing {
                if s(tag, "person_id") == person && rect_valid(tag) {
                    if !automatic
                        && s(tag, "recognition_mode") == "auto"
                        && tag["recognition_confirmed"] != true
                    {
                        let mut v = d["tags"][s(tag, "id")].clone();
                        v["recognition_confirmed"] = json!(true);
                        v["recognition_mode"] = json!("review");
                        put(&mut d, "tags", v);
                        confirmed += 1;
                    } else {
                        skipped += 1;
                    }
                    continue;
                }
            }
            let mut tag = existing.unwrap_or(json!({"id":id(),"comment":""}));
            tag["media_id"] = json!(face.media);
            tag["person_id"] = json!(person);
            tag["label"] = json!(name(&d["people"][&person]));
            for key in ["x", "y", "w", "h"] {
                tag[key] = face.rect[key].clone();
            }
            tag["face_id"] = json!(face.id);
            tag["recognition_mode"] = json!(if automatic { "auto" } else { "review" });
            tag["recognition_confirmed"] = json!(!automatic);
            tag["updated_at"] = json!(now());
            put(&mut d, "tags", tag);
            assigned += 1;
        }
        if assigned + confirmed > 0 {
            self.commit(
                &d,
                if automatic {
                    "Автоматически отмечены похожие лица"
                } else {
                    "Подтверждена групповая разметка лиц"
                },
            )?;
        }
        Ok(
            json!({"assigned":assigned,"confirmed":confirmed,"skipped":skipped,"conflicts":conflicts}),
        )
    }
}
