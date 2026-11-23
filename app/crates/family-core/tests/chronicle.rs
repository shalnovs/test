use family_core::Engine;
use serde_json::{json, Value};
use tempfile::TempDir;
fn engine() -> (TempDir, Engine) {
    let d = TempDir::new().unwrap();
    let e = Engine::open(d.path()).unwrap();
    (d, e)
}
fn save(e: &mut Engine, kind: &str, record: Value) {
    e.call("save", json!({"kind":kind,"record":record}))
        .unwrap();
}

#[test]
fn typed_media_dates_validate_calendar_days_and_preserve_legacy_source_dates() {
    let (_d, mut e) = engine();
    save(
        &mut e,
        "media",
        json!({"id":"m","title":"Фото","date":"25 Март 1953 г.","comment":"Сохранить"}),
    );
    save(
        &mut e,
        "media",
        json!({"id":"m","date":"1953-03-25","date_precision":"day","date_source_text":"25 Март 1953 г."}),
    );
    let before = e.data().unwrap();
    for patch in [
        json!({"date":"1900-02-29"}),
        json!({"date":"2024-04-31"}),
        json!({"date":"1953"}),
        json!({"date_precision":"text"}),
        json!({"date":53}),
    ] {
        let mut record = patch;
        record["id"] = json!("m");
        assert!(e
            .call("save", json!({"kind":"media","record":record}))
            .is_err());
        assert_eq!(before, e.data().unwrap());
    }
    save(&mut e, "media", json!({"id":"m","date":"2024-02-29"}));
    save(
        &mut e,
        "media",
        json!({"id":"m","date":"1947-03","date_precision":"month"}),
    );
    save(
        &mut e,
        "media",
        json!({"id":"m","date":"1947","date_precision":"year"}),
    );
    assert_eq!(
        e.data().unwrap()["media"]["m"]["date_source_text"],
        "25 Март 1953 г."
    );
    assert_eq!(e.data().unwrap()["media"]["m"]["comment"], "Сохранить");
    save(&mut e, "media", json!({"id":"m","date":""}));
}

#[test]
fn media_coordinates_require_a_valid_pair_and_can_be_cleared() {
    let (_d, mut e) = engine();
    save(
        &mut e,
        "media",
        json!({"id":"m","title":"Фото","place":"Чебоксары","latitude":56.1,"longitude":47.2,"location_precision":"point"}),
    );
    let before = e.data().unwrap();
    for patch in [
        json!({"latitude":91}),
        json!({"longitude":181}),
        json!({"longitude":null}),
        json!({"latitude":"56.1"}),
    ] {
        let mut record = patch;
        record["id"] = json!("m");
        assert!(e
            .call("save", json!({"kind":"media","record":record}))
            .is_err());
        assert_eq!(before, e.data().unwrap());
    }
    save(
        &mut e,
        "media",
        json!({"id":"m","latitude":null,"longitude":null}),
    );
}

#[test]
fn autobiography_date_and_place_survive_branch_exchange_and_undo() {
    let (_a, mut a) = engine();
    let (_b, mut b) = engine();
    save(
        &mut a,
        "people",
        json!({"id":"p","given_name":"Анна","autobiography":"Я родилась в деревне.\nМоя семья."}),
    );
    save(
        &mut a,
        "media",
        json!({"id":"m","title":"Фото","sha256":"hash","date":"1953-03-25","date_precision":"day","place":"Чебоксары","latitude":56.1,"longitude":47.2}),
    );
    save(
        &mut a,
        "tags",
        json!({"id":"t","person_id":"p","media_id":"m"}),
    );
    let branch = a
        .branch(&json!({"mode":"ancestors","root_id":"p"}))
        .unwrap();
    b.merge(&branch, &json!({"decisions":{"p":"__new__"}}))
        .unwrap();
    assert_eq!(
        b.data().unwrap()["people"]["p"]["autobiography"],
        a.data().unwrap()["people"]["p"]["autobiography"]
    );
    assert_eq!(b.data().unwrap()["media"]["m"]["date_precision"], "day");
    assert_eq!(b.data().unwrap()["media"]["m"]["latitude"], 56.1);
    let before = b.data().unwrap();
    save(
        &mut b,
        "people",
        json!({"id":"p","autobiography":"Другая глава"}),
    );
    assert_eq!(b.data().unwrap()["people"]["p"]["given_name"], "Анна");
    let history = b.call("load", json!({})).unwrap()["history"][0]["id"].clone();
    b.call("undo", json!({"id":history})).unwrap();
    assert_eq!(before, b.data().unwrap());
}
