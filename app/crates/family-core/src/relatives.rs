use super::*;

impl Engine {
    pub(crate) fn save_relative(&mut self, p: &Value) -> Result<Value> {
        if s(p, "tree_id") != self.meta("tree_id") {
            return Err("Архив изменился. Откройте форму связи заново.".into());
        }
        let mut d = self.data()?;
        let root = s(p, "root_id");
        if !has(&d, "people", root) {
            return Err("Человек, для которого добавляется связь, не найден".into());
        }
        let kind = s(p, "relation");
        if !["mother", "father", "child", "partner"].contains(&kind) {
            return Err("Выберите вид родственной связи".into());
        }
        let mut target = s(p, "target_id").to_owned();
        let creating = p.get("new_person").is_some_and(|v| !v.is_null());
        if creating {
            if !target.is_empty() {
                return Err("Выберите существующего человека или создайте нового".into());
            }
            let mut person = p["new_person"].clone();
            if !person.is_object()
                || !s(&person, "id").is_empty()
                || name(&person).trim().is_empty()
            {
                return Err("Укажите имя или фамилию нового человека".into());
            }
            for field in ["birth_date", "death_date"] {
                if !s(&person, field).is_empty() && date_bounds(s(&person, field)).is_none() {
                    return Err("Дата человека: укажите ГГГГ, ГГГГ-ММ или ГГГГ-ММ-ДД".into());
                }
            }
            if let (Some(birth), Some(death)) = (
                date_bounds(s(&person, "birth_date")),
                date_bounds(s(&person, "death_date")),
            ) {
                if death.1 < birth.0 {
                    return Err("Дата смерти раньше даты рождения".into());
                }
            }
            target = id();
            person["id"] = json!(target);
            person["updated_at"] = json!(now());
            put(&mut d, "people", person);
        }
        if target == root || !has(&d, "people", &target) {
            return Err("Выберите другого человека".into());
        }
        let (from, to) = if ["mother", "father"].contains(&kind) {
            (target.as_str(), root)
        } else {
            (root, target.as_str())
        };
        let relation_kind = if kind == "partner" {
            "partner"
        } else {
            "parent"
        };
        if rows(&d, "relationships").any(|r| {
            s(r, "kind") == relation_kind
                && ((s(r, "from_id") == from && s(r, "to_id") == to)
                    || (kind == "partner" && s(r, "from_id") == to && s(r, "to_id") == from))
        }) {
            return Err("Такая родственная связь уже существует".into());
        }
        let date = if kind == "partner" {
            s(p, "start_date")
        } else {
            ""
        };
        if !date.is_empty() && date_bounds(date).is_none() {
            return Err("Дата брака: укажите ГГГГ, ГГГГ-ММ или ГГГГ-ММ-ДД".into());
        }
        let role = match kind {
            "mother" | "father" => kind,
            "child" => match s(&d["people"][root], "gender") {
                "F" => "mother",
                "M" => "father",
                _ => "",
            },
            _ => "",
        };
        let rid = id();
        put(
            &mut d,
            "relationships",
            json!({"id":rid,"kind":relation_kind,"from_id":from,"to_id":to,"role":role,"start_date":date,"updated_at":now()}),
        );
        self.commit(
            &d,
            if creating {
                "Добавлены человек и родственная связь"
            } else {
                "Добавлена родственная связь"
            },
        )?;
        Ok(json!({"id":target,"relationship_id":rid,"created":creating}))
    }
}
