use super::*;
pub fn search_places(path: &Path, query: &str) -> Result<Value> {
    let query = norm(query);
    if query.chars().count() > 160 {
        return Err("Сократите поисковый запрос до 160 символов".into());
    }
    let tokens: Vec<_> = query
        .split(|c: char| !c.is_alphanumeric())
        .filter(|s| {
            !s.is_empty()
                && ![
                    "г",
                    "с",
                    "д",
                    "п",
                    "город",
                    "село",
                    "деревня",
                    "поселок",
                    "пгт",
                ]
                .contains(s)
        })
        .take(8)
        .collect();
    if tokens.is_empty() || tokens.iter().map(|s| s.chars().count()).sum::<usize>() < 2 {
        return Ok(json!([]));
    }
    let expr = tokens
        .iter()
        .map(|s| format!("\"{s}\"*"))
        .collect::<Vec<_>>()
        .join(" AND ");
    let db = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|_| {
            "Не найден справочник населённых пунктов places.sqlite рядом с программой".to_string()
        })?;
    let mut st = db.prepare("SELECT p.id,p.name,p.lat,p.lon,p.country,p.region,p.district,p.kind FROM search JOIN places p ON p.id=search.rowid WHERE search MATCH ?1 ORDER BY CASE WHEN p.search_name=?2 THEN 0 WHEN p.search_name LIKE ?3 THEN 1 ELSE 2 END,p.population DESC,p.id LIMIT 40").map_err(|e|e.to_string())?;
    let found = st.query_map(params![expr,tokens.join(" "),format!("{}%",tokens[0])],|r|Ok(json!({"id":r.get::<_,i64>(0)?,"name":r.get::<_,String>(1)?,"lat":r.get::<_,f64>(2)?,"lon":r.get::<_,f64>(3)?,"country":r.get::<_,String>(4)?,"region":r.get::<_,String>(5)?,"district":r.get::<_,String>(6)?,"kind":r.get::<_,String>(7)?}))).map_err(|e|e.to_string())?.collect::<std::result::Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
    Ok(json!(found))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn settlements_prefix_alias_and_region() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("places.sqlite");
        let db = Connection::open(&path).unwrap();
        db.execute_batch("CREATE TABLE places(id INTEGER PRIMARY KEY,name,lat,lon,country,region,district,kind,population,search_name); CREATE VIRTUAL TABLE search USING fts5(words,content='',detail=none,columnsize=0); INSERT INTO places VALUES(1,'Шоршелы',56.1,47.4,'Россия','Чувашия','Мариинско-Посадский','село',1000,'шоршелы'); INSERT INTO search(rowid,words) VALUES(1,'шоршелы чувашия мариинско посадский');").unwrap();
        assert_eq!(
            search_places(&path, "село Шорш Чув").unwrap()[0]["name"],
            "Шоршелы"
        );
        assert_eq!(
            search_places(&path, "деревня Мариинско Шорш")
                .unwrap()
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert!(search_places(&path, "\" OR *")
            .unwrap()
            .as_array()
            .unwrap()
            .is_empty());
        assert!(search_places(&path, "село")
            .unwrap()
            .as_array()
            .unwrap()
            .is_empty());
    }
}
