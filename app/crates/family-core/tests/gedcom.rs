use family_core::Engine;
use serde_json::{json, Value};
use std::{fs, path::Path};
use tempfile::TempDir;

const FAMILY:&str="0 HEAD\n1 SOUR Synthetic fixture\n1 GEDC\n2 VERS 5.5.1\n1 CHAR UTF-8\n0 @I1@ INDI\n1 NAME Анна Ивановна /Примерова/\n1 SEX F\n1 BIRT\n2 DATE 3 FEB 1980\n2 PLAC Примерное село\n3 MAP\n4 LATI N55.75\n4 LONG E37.6\n1 NOTE @N1@\n1 FAMC @F1@\n1 OBJE @M1@\n1 _CUSTOM Сохранить неизвестное поле\n1 RESI\n2 DATE FROM 2001 TO 2005\n2 PLAC Другое село\n0 @I2@ INDI\n1 NAME Иван /Примеров/\n1 SEX M\n1 BIRT\n2 DATE ABT 1950\n1 FAMS @F1@\n0 @I3@ INDI\n1 NAME Мария /Тестова/\n1 SEX F\n1 DEAT Y\n1 FAMS @F1@\n0 @F1@ FAM\n1 HUSB @I2@\n1 WIFE @I3@\n1 CHIL @I1@\n1 MARR\n2 DATE MAR 1975\n2 PLAC Тестовый город\n0 @N1@ NOTE Первая строка\n1 CONC , продолжение\n1 CONT\n1 CONT Вторая строка\n0 @M1@ OBJE\n1 FILE photos/portrait.png\n2 TITL Семейный портрет\n0 TRLR\n";
fn setup(text: &str) -> (TempDir, TempDir, Engine, std::path::PathBuf) {
    let dir = TempDir::new().unwrap();
    let input = TempDir::new().unwrap();
    let path = input.path().join("tree.ged");
    fs::write(&path, text).unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    (dir, input, engine, path)
}
fn preview(e: &mut Engine, path: &Path, media: bool) -> Value {
    e.call("gedcom_preview", json!({"path":path,"include_media":media}))
        .unwrap()
}
fn payload(path: &Path, v: &Value, media: bool) -> Value {
    let decisions: serde_json::Map<String, Value> = v["people"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| {
            (
                p["incoming"]["id"].as_str().unwrap().to_owned(),
                json!("__new__"),
            )
        })
        .collect();
    json!({"path":path,"fingerprint":v["fingerprint"],"tree_id":v["tree_id"],"decisions":decisions,"include_media":media})
}
fn who<'a>(v: &'a Value, name: &str) -> &'a Value {
    &v["people"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["incoming"]["given_name"] == name)
        .unwrap()["incoming"]
}

#[test]
fn preview_is_read_only_and_import_keeps_sources_dates_places_notes_and_links() {
    let (_dir, _input, mut e, path) = setup(FAMILY);
    let before = e.data().unwrap();
    let p = preview(&mut e, &path, false);
    assert_eq!(e.data().unwrap(), before);
    assert_eq!(fs::read_dir(e.root.join("media")).unwrap().count(), 0);
    assert_eq!(p["counts"]["people"], 3);
    assert_eq!(p["counts"]["relationships"], 3);
    assert_eq!(p["counts"]["events"], 1);
    let anna = who(&p, "Анна");
    assert_eq!(anna["patronymic"], "Ивановна");
    assert_eq!(anna["birth_date"], "1980-02-03");
    assert_eq!(anna["birth_latitude"], 55.75);
    assert_eq!(
        anna["comment"],
        "Первая строка, продолжение\n\nВторая строка"
    );
    assert!(who(&p, "Иван")["birth_date_uncertain"].as_bool().unwrap());
    assert!(who(&p, "Анна")["alive"].is_null());
    assert_eq!(who(&p, "Мария")["alive"], false);
    let result = e.call("gedcom_import", payload(&path, &p, false)).unwrap();
    assert_eq!(result["added"], 3);
    let data = e.data().unwrap();
    family_core::validate(&data).unwrap();
    let event = data["events"].values().next().unwrap();
    assert_eq!(event["start_date"], "2001");
    assert_eq!(event["end_date"], "2005");
    let original = data["media"]
        .values()
        .find(|m| m["mime"] == "application/x-gedcom")
        .unwrap();
    assert_eq!(
        fs::read(e.root.join(original["file"].as_str().unwrap())).unwrap(),
        FAMILY.as_bytes()
    );
    assert_eq!(
        data["texts"].values().next().unwrap()["content"]["content"][1]["content"],
        json!([])
    );
    let loaded = e.call("load", json!({})).unwrap();
    let undo = loaded["history"][0]["id"].clone();
    e.call("undo", json!({"id":undo})).unwrap();
    assert_eq!(e.data().unwrap(), before);
}
#[test]
fn repeated_file_is_idempotent_even_under_a_different_filename() {
    let (_dir, input, mut e, path) = setup(FAMILY);
    let p = preview(&mut e, &path, false);
    e.call("gedcom_import", payload(&path, &p, false)).unwrap();
    let before = e.data().unwrap();
    let renamed = input.path().join("renamed.ged");
    fs::copy(path, &renamed).unwrap();
    let p = preview(&mut e, &renamed, false);
    assert_eq!(p["already_imported"], true);
    assert_eq!(
        e.call("gedcom_import", payload(&renamed, &p, false))
            .unwrap()["duplicate"],
        true
    );
    assert_eq!(before, e.data().unwrap());
}
#[test]
fn media_opt_in_checks_paths_and_preserves_person_associations() {
    let source=FAMILY.replace("0 TRLR","0 @I4@ INDI\n1 NAME Другой /Пример/\n1 OBJE\n2 FILE ../outside.txt\n1 OBJE\n2 FILE https://example.invalid/photo.jpg\n0 TRLR");
    let (_dir, input, mut e, path) = setup(&source);
    fs::create_dir(input.path().join("photos")).unwrap();
    let image = b"synthetic image fixture";
    fs::write(input.path().join("photos/portrait.png"), image).unwrap();
    let off = preview(&mut e, &path, false);
    assert_eq!(off["counts"]["media"], 1);
    let p = preview(&mut e, &path, true);
    assert_eq!(p["counts"]["media"], 2);
    assert!(p["warnings"]
        .as_array()
        .unwrap()
        .iter()
        .any(|v| v.as_str().unwrap().contains("outside.txt")));
    e.call("gedcom_import", payload(&path, &p, true)).unwrap();
    let d = e.data().unwrap();
    let photo = d["media"].values().find(|m| m["kind"] == "photo").unwrap();
    assert_eq!(
        fs::read(e.root.join(photo["file"].as_str().unwrap())).unwrap(),
        image
    );
    assert_eq!(d["tags"].len(), 1);
    let tag = d["tags"].values().next().unwrap();
    assert_eq!(
        d["people"][tag["person_id"].as_str().unwrap()]["avatar_id"],
        photo["id"]
    );
}
#[test]
fn changed_file_or_archive_and_unconfirmed_matches_cannot_be_imported() {
    let (_dir, _input, mut e, path) = setup(FAMILY);
    let p = preview(&mut e, &path, false);
    let before = e.data().unwrap();
    let mut request = payload(&path, &p, false);
    request["tree_id"] = json!("another-archive");
    assert!(e.call("gedcom_import", request).is_err());
    let mut request = payload(&path, &p, false);
    request["decisions"] = json!({});
    assert!(e.call("gedcom_import", request).is_err());
    fs::write(&path, FAMILY.replace("1980", "1981")).unwrap();
    assert!(e.call("gedcom_import", payload(&path, &p, false)).is_err());
    assert_eq!(before, e.data().unwrap());
    assert_eq!(fs::read_dir(e.root.join("media")).unwrap().count(), 0);
}
#[test]
fn invalid_decisions_that_create_a_cycle_roll_back_files_and_records() {
    let (_dir, _input, mut e, path) = setup(FAMILY);
    e.call(
        "save",
        json!({"kind":"people","record":{"id":"local","given_name":"Локальный"}}),
    )
    .unwrap();
    let p = preview(&mut e, &path, false);
    let mut request = payload(&path, &p, false);
    for row in p["people"].as_array().unwrap() {
        request["decisions"][row["incoming"]["id"].as_str().unwrap()] = json!("local");
    }
    let before = e.data().unwrap();
    assert!(e.call("gedcom_import", request).is_err());
    assert_eq!(before, e.data().unwrap());
    assert_eq!(fs::read_dir(e.root.join("media")).unwrap().count(), 0);
}
#[test]
fn matching_keeps_local_dates_and_their_precision_until_incoming_is_chosen() {
    let (_dir, _input, mut e, path) = setup(FAMILY);
    e.call("save",json!({"kind":"people","record":{"id":"local","given_name":"Иван","surname":"Примеров","birth_date":"1949-05-10","birth_date_uncertain":false}})).unwrap();
    let p = preview(&mut e, &path, false);
    let mut request = payload(&path, &p, false);
    let incoming = who(&p, "Иван")["id"].as_str().unwrap();
    request["decisions"][incoming] = json!("local");
    let result = e.call("gedcom_import", request).unwrap();
    assert_eq!(result["matched"], 1);
    let d = e.data().unwrap();
    assert_eq!(d["people"]["local"]["birth_date"], "1949-05-10");
    assert_eq!(d["people"]["local"]["birth_date_uncertain"], false);
    assert!(d["facts"].values().any(|v| v["field"] == "birth_date"));
}
#[test]
fn unrelated_files_with_same_gedcom_identifiers_do_not_share_person_ids() {
    let (_dir, input, mut e, path) = setup(FAMILY);
    let p = preview(&mut e, &path, false);
    e.call("gedcom_import", payload(&path, &p, false)).unwrap();
    let other = input.path().join("other.ged");
    fs::write(&other, FAMILY.replace("Примеров", "ДругаяСемья")).unwrap();
    let q = preview(&mut e, &other, false);
    assert_ne!(p["origin_tree_id"], q["origin_tree_id"]);
    assert!(q["people"]
        .as_array()
        .unwrap()
        .iter()
        .all(|p| p["known_id"].is_null()));
}
#[test]
fn legacy_russian_encoding_is_explicit_and_utf16_bom_is_detected() {
    let (_dir, _input, mut e, path) = setup(FAMILY);
    let (bytes, _, errors) = encoding_rs::WINDOWS_1251.encode(FAMILY);
    assert!(!errors);
    fs::write(&path, &bytes).unwrap();
    assert!(e.call("gedcom_preview", json!({"path":path})).is_err());
    let p = e
        .call(
            "gedcom_preview",
            json!({"path":path,"encoding":"windows-1251"}),
        )
        .unwrap();
    assert_eq!(who(&p, "Анна")["surname"], "Примерова");
    let mut utf16 = vec![0xff, 0xfe];
    for code in FAMILY.encode_utf16() {
        utf16.extend(code.to_le_bytes());
    }
    fs::write(&path, utf16).unwrap();
    assert_eq!(preview(&mut e, &path, false)["encoding"], "UTF-16LE");
}
#[test]
fn malformed_gedcom_is_rejected_before_preview_changes_anything() {
    for data in [
        FAMILY.replace("0 TRLR", ""),
        FAMILY.replace("0 @I3@ INDI", "0 @I1@ INDI"),
        FAMILY.replace("2 DATE 3 FEB 1980", "65 DATE 3 FEB 1980"),
        FAMILY.replace("1 CHIL @I1@", "1 CHIL @I2@"),
    ] {
        let (_dir, _input, mut e, path) = setup(&data);
        let before = e.data().unwrap();
        assert!(e.call("gedcom_preview", json!({"path":path})).is_err());
        assert_eq!(before, e.data().unwrap());
    }
}
#[test]
fn gedcom7_shared_notes_and_adoption_keep_their_meaning() {
    let data = FAMILY
        .replace("5.5.1", "7.0")
        .replace("1 NOTE @N1@", "1 SNOTE @N1@")
        .replace(
            "0 @N1@ NOTE Первая строка\n1 CONC , продолжение",
            "0 @N1@ SNOTE me@@example.com\n1 CONT @@handle",
        )
        .replace("1 FAMC @F1@", "1 FAMC @F1@\n2 PEDI ADOPTED");
    let (_dir, _input, mut e, path) = setup(&data);
    let p = preview(&mut e, &path, false);
    assert_eq!(p["gedcom_version"], "7.0");
    assert!(who(&p, "Анна")["comment"]
        .as_str()
        .unwrap()
        .starts_with("me@@example.com\n@handle"));
    e.call("gedcom_import", payload(&path, &p, false)).unwrap();
    assert!(e.data().unwrap()["relationships"]
        .values()
        .filter(|r| r["kind"] == "parent")
        .all(|r| r["parentage"] == "adopted"));
}

#[test]
fn adoption_by_one_parent_does_not_change_the_other_parentage() {
    let data = FAMILY.replace(
        "1 FAMC @F1@",
        "1 FAMC @F1@\n1 ADOP\n2 FAMC @F1@\n3 ADOP HUSB",
    );
    let (_dir, _input, mut e, path) = setup(&data);
    let p = preview(&mut e, &path, false);
    e.call("gedcom_import", payload(&path, &p, false)).unwrap();
    let d = e.data().unwrap();
    let parents: Vec<_> = d["relationships"]
        .values()
        .filter(|r| r["kind"] == "parent")
        .collect();
    assert_eq!(
        parents.iter().find(|r| r["role"] == "father").unwrap()["parentage"],
        "adopted"
    );
    assert_eq!(
        parents.iter().find(|r| r["role"] == "mother").unwrap()["parentage"],
        "birth"
    );
}
