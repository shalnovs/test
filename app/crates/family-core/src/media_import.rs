use super::*;
impl Engine {
    pub(super) fn check_import_tree(&self, p: &Value) -> Result<()> {
        if !s(p, "tree_id").is_empty() && s(p, "tree_id") != self.meta("tree_id") {
            return Err("Открыт другой архив. Повторите добавление файлов.".into());
        }
        Ok(())
    }
    pub(super) fn media_matches(&self, hash: &str) -> Result<Vec<Value>> {
        let d = self.data()?;
        let mut found = rows(&d, "media")
            .filter(|m| s(m, "sha256") == hash)
            .map(|m| {
                let mut v = m.clone();
                v["marked_count"] = json!(rows(&d, "tags")
                    .filter(|t| s(t, "media_id") == s(m, "id"))
                    .count());
                v
            })
            .collect::<Vec<_>>();
        found.sort_by_key(maintenance::trashed);
        Ok(found)
    }
    pub(super) fn check_media(&self, p: &Value) -> Result<Value> {
        self.check_import_tree(p)?;
        let raw = B64.decode(s(p, "base64")).map_err(|e| e.to_string())?;
        if raw.is_empty() || raw.len() > 256 * 1024 * 1024 {
            return Err("Размер файла должен быть от 1 байта до 256 МБ".into());
        }
        Ok(json!({"duplicates":self.media_matches(&digest(&raw))?}))
    }
}
