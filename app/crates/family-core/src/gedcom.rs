//! Imports GEDCOM 5.x / 7 data into the existing review-and-merge workflow.
//! Specification: https://gedcom.io/specifications/FamilySearchGEDCOMv7.html
use super::*;

#[derive(Clone, Debug)]
struct Node {
    tag: String,
    xref: String,
    value: String,
    children: Vec<usize>,
}
struct Document {
    nodes: Vec<Node>,
    roots: Vec<usize>,
    refs: HashMap<String, usize>,
}
impl Document {
    fn child(&self, i: usize, tag: &str) -> Option<usize> {
        self.nodes[i]
            .children
            .iter()
            .copied()
            .find(|j| self.nodes[*j].tag == tag)
    }
    fn value(&self, i: usize, tag: &str) -> String {
        self.child(i, tag)
            .map(|j| self.nodes[j].value.trim().to_owned())
            .unwrap_or_default()
    }
    fn children(&self, i: usize, tag: &str) -> Vec<usize> {
        self.nodes[i]
            .children
            .iter()
            .copied()
            .filter(|j| self.nodes[*j].tag == tag)
            .collect()
    }
    fn note(&self, i: usize, seen: &mut BTreeSet<usize>) -> String {
        if !seen.insert(i) || seen.len() > 32 {
            return "[Повторная ссылка на заметку]".into();
        }
        let n = &self.nodes[i];
        let text = if let Some(j) = self.refs.get(n.value.trim()) {
            self.note(*j, seen)
        } else {
            let v7 = self
                .child(self.roots[0], "GEDC")
                .is_some_and(|i| self.value(i, "VERS").starts_with("7."));
            if v7 {
                n.value
                    .split('\n')
                    .map(|line| {
                        line.strip_prefix("@@")
                            .map(|s| format!("@{s}"))
                            .unwrap_or_else(|| line.to_owned())
                    })
                    .collect::<Vec<_>>()
                    .join("\n")
            } else {
                n.value.replace("@@", "@")
            }
        };
        let mut parts = vec![text];
        for j in &n.children {
            if ["NOTE", "SNOTE", "TEXT"].contains(&self.nodes[*j].tag.as_str()) {
                parts.push(self.note(*j, seen));
            }
        }
        parts
            .into_iter()
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("\n")
    }
    fn notes(&self, i: usize) -> String {
        self.nodes[i]
            .children
            .iter()
            .filter(|j| ["NOTE", "SNOTE"].contains(&self.nodes[**j].tag.as_str()))
            .map(|j| self.note(*j, &mut BTreeSet::new()))
            .collect::<Vec<_>>()
            .join("\n\n")
    }
}
fn parse(text: &str) -> Result<Document> {
    let mut d = Document {
        nodes: vec![],
        roots: vec![],
        refs: HashMap::new(),
    };
    let mut stack: Vec<usize> = vec![];
    for (number, line) in text.lines().enumerate() {
        if line.trim().is_empty() {
            continue;
        }
        if number >= 250_000 {
            return Err("В GEDCOM больше 250 000 строк".into());
        }
        let error = || format!("Неверная структура GEDCOM в строке {}", number + 1);
        let (level, rest) = line.split_once(' ').ok_or_else(error)?;
        let level: usize = level.parse().map_err(|_| error())?;
        if level > 64 || level > stack.len() {
            return Err(error());
        }
        let rest = rest.trim_start();
        let (first, rest) = rest.split_once(' ').unwrap_or((rest, ""));
        let (xref, tag, value) = if first.starts_with('@') {
            if !first.ends_with('@') {
                return Err(error());
            }
            let (tag, value) = rest
                .trim_start()
                .split_once(' ')
                .unwrap_or((rest.trim(), ""));
            (first, tag, value)
        } else {
            ("", first, rest)
        };
        if tag.is_empty() || !tag.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
            return Err(error());
        }
        stack.truncate(level);
        if tag == "CONT" || tag == "CONC" {
            let parent = *stack.last().ok_or_else(error)?;
            if tag == "CONT" {
                d.nodes[parent].value.push('\n');
            }
            d.nodes[parent].value.push_str(value);
            continue;
        }
        if level == 0 && d.roots.last().is_some_and(|i| d.nodes[*i].tag == "TRLR") {
            return Err("В GEDCOM есть записи после конца файла".into());
        }
        let i = d.nodes.len();
        if !xref.is_empty() && d.refs.insert(xref.into(), i).is_some() {
            return Err(format!("Повторный идентификатор в GEDCOM: {xref}"));
        }
        d.nodes.push(Node {
            tag: tag.to_uppercase(),
            xref: xref.into(),
            value: value.into(),
            children: vec![],
        });
        if let Some(parent) = stack.last() {
            d.nodes[*parent].children.push(i);
        } else {
            d.roots.push(i);
        }
        stack.push(i);
    }
    if d.roots.first().is_none_or(|i| d.nodes[*i].tag != "HEAD")
        || d.roots.last().is_none_or(|i| d.nodes[*i].tag != "TRLR")
    {
        return Err("Ожидается GEDCOM с заголовком HEAD и завершающей записью TRLR. Повторите экспорт в исходном сервисе.".into());
    }
    Ok(d)
}
fn decode(raw: &[u8], encoding: &str) -> Result<(String, String)> {
    let (codec, start) = match encoding {
        "windows-1251" => (encoding_rs::WINDOWS_1251, 0),
        "auto" | "" | "utf-8" => {
            if raw.starts_with(&[0xff, 0xfe]) {
                (encoding_rs::UTF_16LE, 2)
            } else if raw.starts_with(&[0xfe, 0xff]) {
                (encoding_rs::UTF_16BE, 2)
            } else if raw.starts_with(&[0xef, 0xbb, 0xbf]) {
                (encoding_rs::UTF_8, 3)
            } else {
                (encoding_rs::UTF_8, 0)
            }
        }
        _ => return Err("Неизвестная кодировка GEDCOM".into()),
    };
    let text = codec.decode_without_bom_handling_and_without_replacement(&raw[start..]).ok_or(
        "Не удалось прочитать кодировку. Выгрузите GEDCOM в UTF-8 или явно выберите Windows-1251 для старого русского файла. ANSEL не поддерживается.")?;
    if text.contains('\0') {
        return Err("Неверная кодировка GEDCOM. Выгрузите файл в UTF-8.".into());
    }
    Ok((
        text.replace("\r\n", "\n").replace('\r', "\n"),
        codec.name().into(),
    ))
}
fn exact_date(raw: &str) -> String {
    let raw = raw
        .trim()
        .trim_start_matches("@#DGREGORIAN@ ")
        .trim_start_matches("GREGORIAN ");
    if date_bounds(raw).is_some() {
        return raw.into();
    }
    let parts: Vec<_> = raw.split_whitespace().collect();
    let months = [
        "JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
    ];
    let (day, month, year) = match parts.as_slice() {
        [m, y] => (None, *m, *y),
        [d, m, y] => (Some(*d), *m, *y),
        _ => return String::new(),
    };
    let Some(month) = months.iter().position(|m| *m == month.to_uppercase()) else {
        return String::new();
    };
    let Ok(year) = year.parse::<u32>() else {
        return String::new();
    };
    let mut value = format!("{year:04}-{:02}", month + 1);
    if let Some(day) = day {
        let Ok(day) = day.parse::<u32>() else {
            return String::new();
        };
        value.push_str(&format!("-{day:02}"));
    }
    if date_bounds(&value).is_some() {
        value
    } else {
        String::new()
    }
}
fn date_text(raw: &str) -> String {
    let exact = exact_date(raw);
    if !exact.is_empty() {
        return exact;
    }
    for (prefix, label) in [
        ("ABT ", "около "),
        ("CAL ", "вычислено: "),
        ("EST ", "предположительно "),
        ("BEF ", "до "),
        ("AFT ", "после "),
    ] {
        if let Some(rest) = raw.strip_prefix(prefix) {
            let d = exact_date(rest);
            return format!("{label}{}", if d.is_empty() { rest } else { &d });
        }
    }
    raw.into()
}
fn dates(raw: &str) -> (String, String) {
    for (prefix, separator) in [("FROM ", " TO "), ("BET ", " AND ")] {
        if let Some((a, b)) = raw
            .strip_prefix(prefix)
            .and_then(|s| s.split_once(separator))
        {
            let (a, b) = (exact_date(a), exact_date(b));
            if let (Some(x), Some(y)) = (date_bounds(&a), date_bounds(&b)) {
                if y.1 >= x.0 {
                    return (a, b);
                }
            }
            return (String::new(), String::new());
        }
    }
    (exact_date(raw), String::new())
}
fn coordinate(raw: &str, latitude: bool) -> Option<f64> {
    let direction = raw.chars().next()?;
    let (sign, digits) = match direction {
        'S' | 'W' => (-1., &raw[1..]),
        'N' | 'E' => (1., &raw[1..]),
        _ => (1., raw),
    };
    let v = digits.trim().replace(',', ".").parse::<f64>().ok()? * sign;
    (v.is_finite() && v.abs() <= if latitude { 90. } else { 180. }).then_some(v)
}
fn place(doc: &Document, node: usize) -> (String, Option<f64>, Option<f64>) {
    let Some(p) = doc.child(node, "PLAC") else {
        return (String::new(), None, None);
    };
    let coords = doc.child(p, "MAP").and_then(|m| {
        Some((
            coordinate(&doc.value(m, "LATI"), true)?,
            coordinate(&doc.value(m, "LONG"), false)?,
        ))
    });
    (
        doc.nodes[p].value.clone(),
        coords.map(|c| c.0),
        coords.map(|c| c.1),
    )
}
fn person_name(doc: &Document, i: usize) -> (String, String, String) {
    let raw = &doc.nodes[i].value;
    let sections: Vec<_> = raw.split('/').collect();
    let surname = doc.value(i, "SURN");
    let surname = if surname.is_empty() {
        sections.get(1).unwrap_or(&"").trim().to_owned()
    } else {
        surname
    };
    let given = doc.value(i, "GIVN");
    let mut given = if given.is_empty() {
        sections[0].trim().to_owned()
    } else {
        given
    };
    let mut patronymic = ["_PATR", "_PATRONYMIC", "_MIDL"]
        .iter()
        .map(|tag| doc.value(i, tag))
        .find(|s| !s.is_empty())
        .unwrap_or_default();
    if patronymic.is_empty() {
        if let Some((first, last)) = given.rsplit_once(' ') {
            if ["вич", "вна", "ична", "инична"]
                .iter()
                .any(|s| last.to_lowercase().ends_with(s))
            {
                patronymic = last.into();
                given = first.into();
            }
        }
    }
    (surname, given, patronymic)
}
struct Imported {
    package: Package,
    warnings: Vec<String>,
    encoding: String,
    version: String,
    files: BTreeMap<String, Vec<u8>>,
    fingerprint: String,
}

fn read_bounded(path: &Path, limit: u64) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    fs::File::open(path)
        .map_err(|e| e.to_string())?
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.is_empty() || bytes.len() as u64 > limit {
        return Err("Файл пуст или превышает допустимый размер".into());
    }
    Ok(bytes)
}

// Only explicitly opted-in, relative files inside the GEDCOM directory are read.
fn local_attachment(base: &Path, reference: &str) -> Result<PathBuf> {
    let reference = reference.replace('\\', "/");
    let path = Path::new(&reference);
    if path.is_absolute()
        || reference.contains(':')
        || path.components().any(|c| {
            !matches!(
                c,
                std::path::Component::Normal(_) | std::path::Component::CurDir
            )
        })
    {
        return Err("внешний или абсолютный путь".into());
    }
    let base = base.canonicalize().map_err(|e| e.to_string())?;
    let file = base
        .join(path)
        .canonicalize()
        .map_err(|_| "файл не найден".to_string())?;
    if !file.starts_with(&base) || !file.is_file() {
        return Err("файл находится вне папки GEDCOM".into());
    }
    Ok(file)
}

struct Builder<'a> {
    doc: &'a Document,
    data: Data,
    origin: String,
    source: String,
    files: BTreeMap<String, Vec<u8>>,
    warnings: Vec<String>,
    base: PathBuf,
    include_media: bool,
}
impl Builder<'_> {
    fn key(&self, kind: &str, key: &str) -> String {
        stable(&format!("{}:{kind}:{key}", self.origin))
    }
    fn person(&self, xref: &str) -> Option<String> {
        self.doc
            .refs
            .get(xref)
            .filter(|i| self.doc.nodes[**i].tag == "INDI")
            .map(|_| self.key("person", xref))
    }
    fn source_for(&self, node: usize) -> String {
        self.doc
            .children(node, "SOUR")
            .iter()
            .find_map(|i| {
                self.doc
                    .refs
                    .get(self.doc.nodes[*i].value.trim())
                    .filter(|j| self.doc.nodes[**j].tag == "SOUR")
                    .map(|j| self.key("source", &self.doc.nodes[*j].xref))
            })
            .unwrap_or_else(|| self.source.clone())
    }
    fn attachments(&mut self, node: usize, person: Option<&str>) -> Vec<String> {
        let mut media_ids = vec![];
        for object in self.doc.children(node, "OBJE") {
            let target = self
                .doc
                .refs
                .get(self.doc.nodes[object].value.trim())
                .copied()
                .unwrap_or(object);
            if self.doc.nodes[target].tag != "OBJE" {
                self.warnings
                    .push("Ссылка на медиа не указывает на OBJE".into());
                continue;
            }
            for file in self.doc.children(target, "FILE") {
                let reference = self.doc.nodes[file].value.trim();
                if !self.include_media {
                    self.warnings.push(format!("Медиа не загружено: {reference}. Можно включить загрузку файлов из папки GEDCOM."));
                    continue;
                }
                let path = match local_attachment(&self.base, reference) {
                    Ok(p) => p,
                    Err(reason) => {
                        self.warnings.push(format!("Медиа не загружено: {reference} — {reason}. Ссылка сохранена в исходном GEDCOM."));
                        continue;
                    }
                };
                let ext = path
                    .extension()
                    .and_then(|x| x.to_str())
                    .unwrap_or("")
                    .to_lowercase();
                let mime = match ext.as_str() {
                    "jpg" | "jpeg" => "image/jpeg",
                    "png" => "image/png",
                    "webp" => "image/webp",
                    "gif" => "image/gif",
                    "tif" | "tiff" => "image/tiff",
                    "heic" | "heif" => "image/heic",
                    "avif" => "image/avif",
                    "pdf" => "application/pdf",
                    "txt" => "text/plain",
                    "doc" => "application/msword",
                    "docx" => {
                        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    }
                    _ => {
                        self.warnings.push(format!(
                            "Формат вложения пока не поддерживается: {reference}"
                        ));
                        continue;
                    }
                };
                let size = match fs::metadata(&path) {
                    Ok(m) => m.len(),
                    Err(_) => {
                        self.warnings
                            .push(format!("Не удалось прочитать вложение: {reference}"));
                        continue;
                    }
                };
                if size == 0 || size > 256 * 1024 * 1024 {
                    self.warnings
                        .push(format!("Недопустимый размер вложения: {reference}"));
                    continue;
                }
                if self.files.values().map(|b| b.len()).sum::<usize>() + size as usize
                    > 512 * 1024 * 1024
                {
                    self.warnings.push("Общий размер вложений превысил 512 МБ. Остальные файлы можно добавить отдельно.".into());
                    return media_ids;
                }
                let raw = match read_bounded(&path, 256 * 1024 * 1024) {
                    Ok(v) => v,
                    Err(_) => {
                        self.warnings
                            .push(format!("Не удалось прочитать вложение: {reference}"));
                        continue;
                    }
                };
                if self.files.values().map(|b| b.len()).sum::<usize>() + raw.len()
                    > 512 * 1024 * 1024
                {
                    self.warnings.push("Общий размер вложений превысил 512 МБ. Остальные файлы можно добавить отдельно.".into());
                    return media_ids;
                }
                let hash = digest(&raw);
                let rel = format!("media/{hash}.{ext}");
                self.files.insert(rel.clone(), raw);
                let mid = self.key("media", &hash);
                let title = self.doc.value(file, "TITL");
                let title = if title.is_empty() {
                    self.doc.value(target, "TITL")
                } else {
                    title
                };
                let filename = path.file_name().unwrap().to_string_lossy().into_owned();
                put(
                    &mut self.data,
                    "media",
                    json!({"id":mid,"title":if title.is_empty(){&filename}else{&title},"filename":filename,"file":rel,"thumb":"","mime":mime,"sha256":hash,"kind":if mime.starts_with("image/"){"photo"}else{"document"},"description":self.doc.notes(target),"date":"","place":"","source_id":self.source}),
                );
                if let Some(pid) = person {
                    let tid = self.key("media-person", &format!("{mid}:{pid}"));
                    put(
                        &mut self.data,
                        "tags",
                        json!({"id":tid,"media_id":mid,"person_id":pid,"x":null,"label":"Связь из GEDCOM"}),
                    );
                }
                if !media_ids.contains(&mid) {
                    media_ids.push(mid);
                }
            }
        }
        media_ids
    }
    fn event(&mut self, node: usize, people: &[String], title: &str) {
        let raw = self.doc.value(node, "DATE");
        let (start, end) = dates(&raw);
        if !raw.is_empty() && start.is_empty() {
            self.warnings.push(format!("{title}: дата «{raw}» сохранена как неточная; точное напоминание по ней не создаётся."));
        }
        let (place, latitude, longitude) = place(self.doc, node);
        let mut description = self.doc.notes(node);
        let value = self.doc.nodes[node].value.trim();
        if !value.is_empty() && value != "Y" {
            description = format!("{value}\n{description}").trim().into();
        }
        let media = self.attachments(node, None);
        let event_id = self.key("event", &node.to_string());
        let source = self.source_for(node);
        put(
            &mut self.data,
            "events",
            json!({"id":event_id,"title":title,"description":description,"start_date":start,"end_date":end,"date_text":date_text(&raw),"date_uncertain":!raw.is_empty()&&start.is_empty(),"place":place,"latitude":latitude,"longitude":longitude,"person_ids":people,"media_ids":media,"cover_media_id":"","source_id":source}),
        );
    }
}

fn read(path: &Path, p: &Value) -> Result<Imported> {
    let size = fs::metadata(path)
        .map_err(|e| format!("Не удалось открыть GEDCOM: {e}"))?
        .len();
    if size == 0 || size > 32 * 1024 * 1024 {
        return Err("Размер GEDCOM должен быть от 1 байта до 32 МБ".into());
    }
    let raw = read_bounded(path, 32 * 1024 * 1024)?;
    let (text, encoding) = decode(&raw, s(p, "encoding"))?;
    let doc = parse(&text)?;
    let head = doc.roots[0];
    let version = doc
        .child(head, "GEDC")
        .map(|i| doc.value(i, "VERS"))
        .unwrap_or_default();
    if !version.is_empty() && !version.starts_with("5.") && !version.starts_with("7.") {
        return Err(format!(
            "Версия GEDCOM {version} пока не поддерживается. Нужен файл GEDCOM 5.x или 7."
        ));
    }
    let origin = stable(&format!("gedcom:{}:{encoding}", digest(&raw)));
    let source = stable(&format!("{origin}:source"));
    let filename = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    let mut b = Builder {
        doc: &doc,
        data: empty_data(),
        origin: origin.clone(),
        source: source.clone(),
        files: BTreeMap::new(),
        warnings: vec![],
        base: path
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .unwrap_or(Path::new("."))
            .to_path_buf(),
        include_media: p["include_media"].as_bool().unwrap_or(false),
    };
    if version.is_empty() {
        b.warnings.push(
            "В заголовке нет номера версии GEDCOM; использована совместимость с GEDCOM 5.x.".into(),
        );
    }
    let raw_hash = digest(&raw);
    let raw_rel = format!("media/{raw_hash}.ged");
    let raw_id = b.key("original", &raw_hash);
    b.files.insert(raw_rel.clone(), raw);
    put(
        &mut b.data,
        "media",
        json!({"id":raw_id,"title":format!("Исходный GEDCOM: {filename}"),"filename":filename,"file":raw_rel,"thumb":"","mime":"application/x-gedcom","sha256":raw_hash,"kind":"document","source_id":source}),
    );
    put(
        &mut b.data,
        "sources",
        json!({"id":source,"title":format!("Импорт GEDCOM: {filename}"),"kind":"gedcom","description":"Исходный файл сохранён целиком, включая сведения, для которых нет отдельных полей.","attachment_id":raw_id,"url":""}),
    );
    for node in &doc.roots {
        if doc.nodes[*node].tag == "SOUR" {
            let sid = b.key("source", &doc.nodes[*node].xref);
            let title = doc.value(*node, "TITL");
            let description = [
                doc.value(*node, "AUTH"),
                doc.value(*node, "PUBL"),
                doc.value(*node, "TEXT"),
                doc.notes(*node),
            ]
            .into_iter()
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("\n\n");
            put(
                &mut b.data,
                "sources",
                json!({"id":sid,"title":if title.is_empty(){doc.nodes[*node].xref.clone()}else{title},"kind":"gedcom","description":description,"url":doc.value(*node,"_URL"),"attachment_id":raw_id}),
            );
        }
    }
    for node in doc
        .roots
        .iter()
        .copied()
        .filter(|i| doc.nodes[*i].tag == "INDI")
    {
        let xref = &doc.nodes[node].xref;
        if xref.is_empty() {
            return Err("У персоны GEDCOM нет идентификатора".into());
        }
        let pid = b.key("person", xref);
        let names = doc.children(node, "NAME");
        let (surname, mut given, mut patronymic) = names
            .first()
            .map(|i| person_name(&doc, *i))
            .unwrap_or_default();
        if patronymic.is_empty() {
            patronymic = ["_PATR", "_PATRONYMIC", "_MIDL"]
                .iter()
                .map(|t| doc.value(node, t))
                .find(|s| !s.is_empty())
                .unwrap_or_default();
        }
        if surname.is_empty() && given.is_empty() && patronymic.is_empty() {
            given = format!("Неизвестный человек {xref}");
            b.warnings.push(format!(
                "У персоны {xref} нет имени; добавлена временная подпись."
            ));
        }
        let mut person = json!({"id":pid,"surname":surname,"given_name":given,"patronymic":patronymic,"gender":match doc.value(node,"SEX").as_str(){"M"=>"M","F"=>"F",_=>"U"},"alive":null,"birth_surname":"","second_surname":"","birth_date":"","death_date":"","birth_place":"","death_place":"","comment":doc.notes(node),"source_id":b.source_for(node),"extra":{"gedcom_id":xref}});
        for name in names.iter().copied() {
            let (last, first, patronymic) = person_name(&doc, name);
            let kind = doc.value(name, "TYPE").to_lowercase();
            if ["birth", "maiden"].contains(&kind.as_str()) {
                person["birth_surname"] = json!(last);
            } else if !last.is_empty() && last != s(&person, "surname") {
                person["second_surname"] = json!(last);
            }
            if Some(&name) != names.first() {
                person["comment"] = json!(format!(
                    "{}\nДругое имя: {}",
                    s(&person, "comment"),
                    [last, first, patronymic].join(" ")
                )
                .trim());
            }
        }
        let living = doc.value(node, "_LIVING");
        if living == "Y" {
            person["alive"] = json!(true);
        } else if living == "N" {
            person["alive"] = json!(false);
        }
        for (tag, kind) in [("BIRT", "birth"), ("DEAT", "death")] {
            if let Some(event) = doc.child(node, tag) {
                let date = doc.value(event, "DATE");
                let (place, lat, lon) = place(&doc, event);
                person[format!("{kind}_date")] = json!(date_text(&date));
                person[format!("{kind}_date_uncertain")] =
                    json!(!date.is_empty() && exact_date(&date).is_empty());
                person[format!("{kind}_place")] = json!(place);
                person[format!("{kind}_latitude")] = json!(lat);
                person[format!("{kind}_longitude")] = json!(lon);
                if !date.is_empty() && exact_date(&date).is_empty() {
                    b.warnings.push(format!("{xref}: дата «{date}» сохранена как неточная; точное напоминание по ней не создаётся."));
                }
                let notes = doc.notes(event);
                if !notes.is_empty() {
                    person["comment"] = json!(format!(
                        "{}\n{}: {notes}",
                        s(&person, "comment"),
                        if tag == "BIRT" {
                            "Рождение"
                        } else {
                            "Смерть"
                        }
                    )
                    .trim());
                }
                if tag == "DEAT" && doc.nodes[event].value != "N" {
                    person["alive"] = json!(false);
                }
                b.attachments(event, Some(&pid));
            }
        }
        person["occupation"] = json!(doc.value(node, "OCCU"));
        person["residence"] = json!(doc
            .child(node, "RESI")
            .map(|i| doc.value(i, "PLAC"))
            .unwrap_or_default());
        let media = b.attachments(node, Some(&pid));
        person["avatar_id"] = json!(media
            .iter()
            .find(|id| s(&b.data["media"][*id], "kind") == "photo")
            .cloned()
            .unwrap_or_default());
        let notes = s(&person, "comment");
        if !notes.is_empty() {
            let tid = b.key("notes", xref);
            let lid = b.key("notes-link", xref);
            put(
                &mut b.data,
                "texts",
                json!({"id":tid,"title":format!("Заметки: {}",name(&person)),"author_id":"","content":{"type":"doc","content":notes.split('\n').map(|line|json!({"type":"paragraph","content":if line.is_empty(){vec![]}else{vec![json!({"type":"text","text":line})]}})).collect::<Vec<_>>()}}),
            );
            put(
                &mut b.data,
                "text_links",
                json!({"id":lid,"text_id":tid,"person_id":pid,"kind":"subject"}),
            );
        }
        put(&mut b.data, "people", person);
        for (tag, label) in [
            ("BURI", "Погребение"),
            ("CREM", "Кремация"),
            ("BAPM", "Крещение"),
            ("CHR", "Крещение"),
            ("RESI", "Место проживания"),
            ("OCCU", "Работа"),
            ("EDUC", "Образование"),
            ("GRAD", "Окончание учёбы"),
            ("EMIG", "Эмиграция"),
            ("IMMI", "Иммиграция"),
            ("CENS", "Перепись"),
            ("EVEN", "Событие"),
        ] {
            for event in doc.children(node, tag) {
                let custom = doc.value(event, "TYPE");
                b.event(
                    event,
                    std::slice::from_ref(&pid),
                    if custom.is_empty() { label } else { &custom },
                );
            }
        }
    }
    if b.data["people"].is_empty() {
        return Err("В файле GEDCOM не найдено ни одного человека (INDI)".into());
    }
    for fam in doc
        .roots
        .iter()
        .copied()
        .filter(|i| doc.nodes[*i].tag == "FAM")
    {
        let family = &doc.nodes[fam].xref;
        let mut parents: Vec<String> = vec![];
        let mut children: Vec<String> = vec![];
        for field in ["HUSB", "WIFE", "CHIL"] {
            for pointer in doc.children(fam, field) {
                if let Some(pid) = b.person(doc.nodes[pointer].value.trim()) {
                    let list = if field == "CHIL" {
                        &mut children
                    } else {
                        &mut parents
                    };
                    if !list.contains(&pid) {
                        list.push(pid);
                    }
                } else {
                    b.warnings.push(format!(
                        "{family}: отсутствует персона {}. Эта ссылка пропущена.",
                        doc.nodes[pointer].value
                    ));
                }
            }
        }
        for indi in doc
            .roots
            .iter()
            .copied()
            .filter(|i| doc.nodes[*i].tag == "INDI")
        {
            let pid = b.key("person", &doc.nodes[indi].xref);
            for (tag, list) in [("FAMC", &mut children), ("FAMS", &mut parents)] {
                if doc
                    .children(indi, tag)
                    .iter()
                    .any(|i| doc.nodes[*i].value.trim() == family)
                    && !list.contains(&pid)
                {
                    list.push(pid.clone());
                }
            }
        }
        for parent in &parents {
            for child in &children {
                let role = match s(&b.data["people"][parent], "gender") {
                    "M" => "father",
                    "F" => "mother",
                    _ => "",
                }
                .to_owned();
                let child_xref = s(&b.data["people"][child]["extra"], "gedcom_id");
                let child_node = doc.refs[child_xref];
                let child_family = doc
                    .children(child_node, "FAMC")
                    .into_iter()
                    .find(|i| doc.nodes[*i].value.trim() == family);
                let pedigree = child_family
                    .map(|i| doc.value(i, "PEDI"))
                    .unwrap_or_default()
                    .to_lowercase();
                let adopted = doc.children(child_node, "ADOP").iter().any(|event| {
                    doc.children(*event, "FAMC").iter().any(|pointer| {
                        if doc.nodes[*pointer].value.trim() != family {
                            return false;
                        }
                        let by = doc.value(*pointer, "ADOP").to_uppercase();
                        by.is_empty()
                            || by == "BOTH"
                            || ["HUSB", "WIFE"].iter().any(|tag| {
                                by == *tag
                                    && doc.children(fam, tag).iter().any(|p| {
                                        b.person(doc.nodes[*p].value.trim()).as_ref()
                                            == Some(parent)
                                    })
                            })
                    })
                });
                let parentage = if adopted {
                    "adopted".into()
                } else if pedigree.is_empty() {
                    "birth".into()
                } else {
                    pedigree
                };
                if parentage != "birth" {
                    b.warnings.push(format!("{family}: связь типа «{parentage}» сохранена с отдельной пометкой и не используется как кровное родство."));
                }
                let rid = b.key("parent", &format!("{parent}:{child}"));
                put(
                    &mut b.data,
                    "relationships",
                    json!({"id":rid,"kind":"parent","from_id":parent,"to_id":child,"role":role,"parentage":parentage,"source_id":b.source}),
                );
            }
        }
        if parents.len() == 2 {
            let rid = b.key("partner", family);
            let marriage = doc.child(fam, "MARR");
            let divorce = doc.child(fam, "DIV");
            let date = marriage.map(|i| doc.value(i, "DATE")).unwrap_or_default();
            let end = divorce.map(|i| doc.value(i, "DATE")).unwrap_or_default();
            if !date.is_empty() && exact_date(&date).is_empty() {
                b.warnings.push(format!("{family}: дата брака «{date}» сохранена как неточная; точное напоминание по ней не создаётся."));
            }
            let (location, lat, lon) = marriage.map(|i| place(&doc, i)).unwrap_or_default();
            put(
                &mut b.data,
                "relationships",
                json!({"id":rid,"kind":"partner","from_id":parents[0],"to_id":parents[1],"start_date":date_text(&date),"end_date":date_text(&end),"date_uncertain":!date.is_empty()&&exact_date(&date).is_empty(),"place":location,"latitude":lat,"longitude":lon,"source_id":b.source}),
            );
        }
        for (tag, label) in [
            ("DIV", "Развод"),
            ("ENGA", "Помолвка"),
            ("EVEN", "Семейное событие"),
            ("RESI", "Проживание семьи"),
        ] {
            for event in doc.children(fam, tag) {
                b.event(event, &parents, label);
            }
        }
    }
    // Unknown and vendor-specific fields remain recoverable in the original GEDCOM attachment.
    b.warnings.sort();
    b.warnings.dedup();
    validate(&b.data)?;
    let fingerprint=digest(serde_json::to_vec(&json!({"raw":raw_hash,"encoding":encoding,"media":b.include_media,"files":b.files.iter().map(|(p,b)|(p,digest(b))).collect::<BTreeMap<_,_>>()})).unwrap().as_slice());
    let package = Package {
        format: "family-archive".into(),
        version: 1,
        package_id: stable(&format!("gedcom-package:{fingerprint}")),
        origin_tree_id: origin,
        title: format!("GEDCOM — {filename}"),
        created_at: doc.value(head, "DATE"),
        data: b.data,
    };
    Ok(Imported {
        package,
        warnings: b.warnings,
        encoding,
        version,
        files: b.files,
        fingerprint,
    })
}

impl Engine {
    pub(crate) fn gedcom_preview(&self, p: &Value) -> Result<Value> {
        let imported = read(Path::new(s(p, "path")), p)?;
        let mut preview = self.preview(&imported.package)?;
        preview["fingerprint"] = json!(imported.fingerprint);
        preview["tree_id"] = json!(self.meta("tree_id"));
        preview["warnings"] = json!(imported.warnings);
        preview["encoding"] = json!(imported.encoding);
        preview["gedcom_version"] = json!(imported.version);
        Ok(preview)
    }
    pub(crate) fn gedcom_import(&mut self, p: &Value) -> Result<Value> {
        if s(p, "tree_id") != self.meta("tree_id") {
            return Err("Архив изменился. Повторите предварительный просмотр GEDCOM.".into());
        }
        let imported = read(Path::new(s(p, "path")), p)?;
        if s(p, "fingerprint") != imported.fingerprint {
            return Err(
                "Файл или вложения изменились после просмотра. Откройте GEDCOM заново.".into(),
            );
        }
        let existing = self.data()?;
        if has(&existing, "_imports", &imported.package.package_id) {
            return Ok(json!({"duplicate":true,"added":0,"matched":0,"conflicts":0}));
        }
        if rows(&imported.package.data, "people")
            .all(|person| s(&p["decisions"], s(person, "id")) == "__skip__")
        {
            return Err("Выберите хотя бы одного человека для импорта".into());
        }
        // Decisions are required for every individual; no name match is accepted silently.
        for person in rows(&imported.package.data, "people") {
            let choice = s(&p["decisions"], s(person, "id"));
            if choice.is_empty()
                || (choice != "__new__"
                    && choice != "__skip__"
                    && !has(&existing, "people", choice))
            {
                return Err("Подтвердите сопоставление каждого человека".into());
            }
        }
        let mut created = Vec::new();
        let result = (|| {
            for (relative, raw) in &imported.files {
                let target = self.safe_file(relative)?;
                if target.exists() {
                    if digest(&fs::read(&target).map_err(|e| e.to_string())?) != digest(raw) {
                        return Err("Обнаружено повреждённое вложение архива".into());
                    }
                } else {
                    created.push(target.clone());
                    fs::write(&target, raw).map_err(|e| e.to_string())?;
                }
            }
            self.merge(&imported.package, p)
        })();
        if result.is_err() {
            for file in created {
                let _ = fs::remove_file(file);
            }
        }
        result
    }
}
