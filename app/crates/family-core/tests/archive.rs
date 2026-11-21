use family_core::{Data, Engine, Package};
use serde_json::{json, Value};
use std::{collections::BTreeMap, fs};
use tempfile::TempDir;
fn engine() -> (TempDir, Engine) {
    let dir = TempDir::new().unwrap();
    let e = Engine::open(dir.path()).unwrap();
    (dir, e)
}
fn person(e: &mut Engine, id: &str, name: &str, birth: &str) {
    e.call("save",json!({"kind":"people","record":{"id":id,"given_name":name,"surname":"Иванов","birth_date":birth}})).unwrap();
}
fn save(e: &mut Engine, kind: &str, v: Value) {
    e.call("save", json!({"kind":kind,"record":v})).unwrap();
}
fn package(e: &Engine) -> Package {
    e.branch(&json!({"mode":"all","title":"Тестовая ветка"}))
        .unwrap()
}
#[test]
fn independent_trees_remap_every_person_reference() {
    let (_a, mut a) = engine();
    let (_b, mut b) = engine();
    person(&mut a, "foreign", "Иван", "1900-02-03");
    person(&mut b, "local", "Иван", "1900-02-03");
    let mid = a
        .call(
            "add_media",
            json!({"filename":"test.txt","mime":"text/plain","base64":"aGVsbG8="}),
        )
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();
    save(
        &mut a,
        "tags",
        json!({"id":"tag","media_id":mid,"person_id":"foreign","x":0.1,"y":0.2,"w":0.3,"h":0.4}),
    );
    save(
        &mut a,
        "texts",
        json!({"id":"story","title":"История","author_id":"foreign","content":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Дедушка","marks":[{"type":"personLink","attrs":{"personId":"foreign"}}]}]}]}}),
    );
    save(
        &mut a,
        "text_links",
        json!({"id":"subject","text_id":"story","person_id":"foreign"}),
    );
    let p = package(&a);
    let preview = b.preview(&p).unwrap();
    assert!(preview["people"][0]["known_id"].is_null());
    assert_eq!(preview["people"][0]["candidates"][0]["id"], "local");
    let r = b
        .merge(&p, &json!({"decisions":{"foreign":"local"}}))
        .unwrap();
    assert_eq!(r["matched"], 1);
    let d = b.data().unwrap();
    assert_eq!(d["people"].len(), 1);
    assert_eq!(d["tags"]["tag"]["person_id"], "local");
    assert_eq!(d["texts"]["story"]["author_id"], "local");
    assert_eq!(d["text_links"]["subject"]["person_id"], "local");
    assert_eq!(
        d["texts"]["story"]["content"]["content"][0]["content"][0]["marks"][0]["attrs"]["personId"],
        "local"
    );
    let before = b.data().unwrap();
    assert_eq!(b.merge(&p, &json!({})).unwrap()["duplicate"], true);
    assert_eq!(before, b.data().unwrap());
}
#[test]
fn changes_merge_three_ways_and_preserve_conflicts() {
    let (_a, mut a) = engine();
    let (_b, mut b) = engine();
    person(&mut a, "p", "Иван", "1900");
    b.merge(&package(&a), &json!({"decisions":{"p":"__new__"}}))
        .unwrap();
    person(&mut a, "p", "Иван", "1901");
    b.merge(&package(&a), &json!({})).unwrap();
    assert_eq!(b.data().unwrap()["people"]["p"]["birth_date"], "1901");
    person(&mut b, "p", "Иван", "1902");
    person(&mut a, "p", "Иван", "1903");
    let r = b.merge(&package(&a), &json!({})).unwrap();
    assert_eq!(r["conflicts"], 1);
    assert_eq!(b.data().unwrap()["people"]["p"]["birth_date"], "1902");
    assert!(b.data().unwrap()["facts"]
        .values()
        .any(|v| v["value"] == "1903"));
    let count = b.data().unwrap()["facts"].len();
    let r = b.merge(&package(&a), &json!({})).unwrap();
    assert_eq!(r["conflicts"], 0);
    assert_eq!(b.data().unwrap()["facts"].len(), count);
}
#[test]
fn explicit_conflict_resolution_keeps_previous_value() {
    let (_a, mut a) = engine();
    let (_b, mut b) = engine();
    person(&mut a, "a", "Иван", "1901");
    person(&mut b, "b", "Иван", "1902");
    b.merge(
        &package(&a),
        &json!({"decisions":{"a":"b"},"resolutions":{"a:birth_date":"incoming"}}),
    )
    .unwrap();
    assert_eq!(b.data().unwrap()["people"]["b"]["birth_date"], "1901");
    assert!(b.data().unwrap()["facts"]
        .values()
        .any(|v| v["value"] == "1902"));
}
#[test]
fn no_name_match_is_applied_without_a_decision() {
    let (_a, mut a) = engine();
    let (_b, mut b) = engine();
    person(&mut a, "a", "Иван", "1901");
    person(&mut b, "b", "Иван", "1901");
    let before = b.data().unwrap();
    assert!(b.merge(&package(&a), &json!({})).is_err());
    assert_eq!(before, b.data().unwrap());
}
#[test]
fn branch_excludes_people_and_removes_dangling_mentions() {
    let (_dir, mut e) = engine();
    for (id, name) in [
        ("child", "Ребенок"),
        ("mom", "Мать"),
        ("dad", "Отец"),
        ("grandma", "Бабушка"),
    ] {
        person(&mut e, id, name, "");
    }
    for (id, a, b, role) in [
        ("r1", "mom", "child", "mother"),
        ("r2", "dad", "child", "father"),
        ("r3", "grandma", "mom", "mother"),
    ] {
        save(
            &mut e,
            "relationships",
            json!({"id":id,"kind":"parent","from_id":a,"to_id":b,"role":role}),
        );
    }
    save(
        &mut e,
        "texts",
        json!({"id":"text","author_id":"dad","title":"Семья","content":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"папа","marks":[{"type":"personLink","attrs":{"personId":"dad"}}]}]}]}}),
    );
    save(
        &mut e,
        "text_links",
        json!({"id":"l","text_id":"text","person_id":"mom"}),
    );
    let p = e
        .branch(&json!({"mode":"maternal","root_id":"child"}))
        .unwrap();
    assert_eq!(p.data["people"].len(), 3);
    assert!(!p.data["people"].contains_key("dad"));
    assert_eq!(p.data["relationships"].len(), 2);
    assert_eq!(p.data["texts"]["text"]["author_id"], "");
    assert_eq!(
        p.data["texts"]["text"]["content"]["content"][0]["content"][0]["marks"],
        json!([])
    );
    family_core::validate(&p.data).unwrap();
}
#[test]
fn cycles_and_invalid_rectangles_are_rejected_atomically() {
    let (_dir, mut e) = engine();
    person(&mut e, "a", "А", "");
    person(&mut e, "b", "Б", "");
    save(
        &mut e,
        "relationships",
        json!({"id":"ab","kind":"parent","from_id":"a","to_id":"b"}),
    );
    let before = e.data().unwrap();
    assert!(e
        .call(
            "save",
            json!({"kind":"relationships","record":{"kind":"parent","from_id":"b","to_id":"a"}})
        )
        .is_err());
    assert_eq!(before, e.data().unwrap());
    assert!(e.call("save",json!({"kind":"tags","record":{"media_id":"missing","person_id":"a","x":0.9,"y":0.0,"w":0.5,"h":0.2}})).is_err());
}
#[test]
fn undo_restores_previous_state_and_requires_reverse_order() {
    let (_dir, mut e) = engine();
    person(&mut e, "a", "А", "");
    let first = e.call("load", json!({})).unwrap()["history"][0]["id"].clone();
    person(&mut e, "b", "Б", "");
    assert!(e.call("undo", json!({"id":first})).is_err());
    let second = e.call("load", json!({})).unwrap()["history"][0]["id"].clone();
    e.call("undo", json!({"id":second})).unwrap();
    assert_eq!(e.data().unwrap()["people"].len(), 1);
    e.call("undo", json!({"id":first})).unwrap();
    assert_eq!(e.data().unwrap()["people"].len(), 0);
}
#[test]
fn real_zip_roundtrip_checks_media_and_preserves_tags() {
    let (dir, mut a) = engine();
    let (_b, mut b) = engine();
    person(&mut a, "p", "Иван", "");
    let mid = a
        .call(
            "add_media",
            json!({"filename":"файл.txt","mime":"text/plain","base64":"aGVsbG8="}),
        )
        .unwrap()["id"]
        .clone();
    save(
        &mut a,
        "tags",
        json!({"id":"tag","media_id":mid,"person_id":"p","label":"Иван","x":null}),
    );
    let path = dir.path().join("branch.familyzip");
    a.export(&json!({"path":path,"mode":"all"})).unwrap();
    b.call("import", json!({"path":path,"decisions":{"p":"__new__"}}))
        .unwrap();
    assert_eq!(
        b.call("media_data", json!({"id":mid})).unwrap(),
        "data:text/plain;base64,aGVsbG8="
    );
    assert_eq!(b.data().unwrap()["tags"].len(), 1);
    let before = b.data().unwrap();
    b.call("import", json!({"path":path})).unwrap();
    assert_eq!(before, b.data().unwrap());
}
#[test]
fn local_duplicate_merge_remaps_links_and_can_be_undone() {
    let (_dir, mut e) = engine();
    person(&mut e, "a", "Иван", "1900");
    person(&mut e, "b", "Иван", "1901");
    save(
        &mut e,
        "texts",
        json!({"id":"t","title":"Текст","author_id":"a","content":{"type":"doc","content":[]}}),
    );
    let before = e.data().unwrap();
    e.call("merge_people", json!({"from_id":"a","to_id":"b"}))
        .unwrap();
    assert_eq!(e.data().unwrap()["people"].len(), 1);
    assert_eq!(e.data().unwrap()["texts"]["t"]["author_id"], "b");
    let hid = e.call("load", json!({})).unwrap()["history"][0]["id"].clone();
    e.call("undo", json!({"id":hid})).unwrap();
    assert_eq!(before, e.data().unwrap());
}
#[test]
fn a_person_cannot_be_merged_with_own_ancestor() {
    let (_dir, mut e) = engine();
    person(&mut e, "a", "А", "");
    person(&mut e, "b", "Б", "");
    save(
        &mut e,
        "relationships",
        json!({"id":"r","kind":"parent","from_id":"a","to_id":"b"}),
    );
    let before = e.data().unwrap();
    assert!(e
        .call("merge_people", json!({"from_id":"a","to_id":"b"}))
        .is_err());
    assert_eq!(before, e.data().unwrap());
}
#[test]
fn malicious_and_corrupt_packages_cannot_change_database() {
    use std::io::Write;
    let (dir, mut e) = engine();
    let path = dir.path().join("bad.familyzip");
    let mut data: Data = BTreeMap::new();
    data.insert(
        "media".into(),
        BTreeMap::from([(
            "m".into(),
            json!({"id":"m","file":"media/../../outside.txt","sha256":"invalid"}),
        )]),
    );
    let p = Package {
        format: "family-archive".into(),
        version: 1,
        package_id: "bad".into(),
        origin_tree_id: "bad".into(),
        title: "bad".into(),
        created_at: "".into(),
        data,
    };
    let mut zip = zip::ZipWriter::new(fs::File::create(&path).unwrap());
    zip.start_file("manifest.json", zip::write::SimpleFileOptions::default())
        .unwrap();
    zip.write_all(&serde_json::to_vec(&p).unwrap()).unwrap();
    zip.finish().unwrap();
    let before = e.data().unwrap();
    assert!(e
        .call("import", json!({"path":path,"decisions":{}}))
        .is_err());
    assert_eq!(before, e.data().unwrap());
    assert!(!dir.path().join("outside.txt").exists());
}
